import { randomBytes } from 'node:crypto';
import { canonical, hash, noteArtifacts } from '../../../shared/corpus.js';
import { chatCorpusSchema, chatRequestSchema, validateAnswer, type ChatJob, type ChatCorpus, type Evidence, type ChatConversation, type ChatActivity, type ChatAsset, type ChatSourceContext } from '../../../shared/chat.js';
import { withReaderNotes } from './reader-notes.js';
import type { PipelineStore } from './pipeline.js';
import { requireSourceState, sourceLifecycle, SourceAccessError } from './source-lifecycle.js';
import { ownedUpload, uploadKey } from './chat-uploads.js';
export class ChatAccessError extends Error { constructor(public status: number, message: string) { super(message); } }
async function savedAnswer(store: PipelineStore, job: ChatJob) {
  if (!job.conversationId) return undefined;
  const conversation = await store.read<ChatConversation>(`chat/conversations/${job.owner}/${job.conversationId}.json`);
  return conversation?.owner === job.owner ? conversation.turns.find(turn => turn.jobId === job.id)?.result : undefined;
}
/** Configured GitHub logins allowed into the private app. A missing list admits nobody. */
export function readerAllowlist(value = process.env.READER_GITHUB_USERS) {
  return new Set((value || '').split(',').map(name => name.trim().toLowerCase()).filter(Boolean));
}
export function readerIdentity(encoded: string | null, allowed = readerAllowlist()): string {
  try {
    if (!encoded || encoded.length > 8192 || !allowed.size) throw new Error();
    const user = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as { identityProvider: string; userId: string; userDetails: string; userRoles: string[] };
    if (user.identityProvider !== 'github' || typeof user.userId !== 'string' || !user.userId.trim() || typeof user.userDetails !== 'string' || !allowed.has(user.userDetails.toLowerCase())
      || !Array.isArray(user.userRoles) || !user.userRoles.includes('authenticated')) throw new Error();
    return hash(`${user.identityProvider}:${user.userId}`);
  } catch { throw new ChatAccessError(403, 'Reader access required'); }
}
export async function submitChat(store: PipelineStore, owner: string, input: unknown, send: (id: string) => Promise<void>) {
  const parsed = chatRequestSchema.safeParse(input);
  if (!parsed.success) throw new ChatAccessError(400, parsed.error.issues.some(issue => issue.path[0] === 'images') ? 'Attach up to 4 images per message'
    : parsed.error.issues.some(issue => issue.code === 'custom') ? 'Write a message or attach an image' : 'Question or history exceeds chat limits');
  return store.withLease(`chat-user-${owner}`, async () => {
    const now = new Date();
    const key = `chat/users/${owner}.json`;
    const previous = await store.read<{ startedAt: string; count: number; activeId: string }>(key);
    if (previous) {
      const active = await store.read<ChatJob>(`chat/jobs/${previous.activeId}.json`);
      if (active && ['pending', 'running'].includes(active.status) && !await store.read(`chat/cancellations/${active.id}.json`) && now.getTime() - Date.parse(active.createdAt) < 10 * 60_000 && !await savedAnswer(store, active)) {
        if (canonical(active.request) === canonical(parsed.data)) return { id: active.id, conversationId: active.conversationId, status: active.status };
        throw new ChatAccessError(429, 'A question is already running. Wait for its answer.');
      }
    }
    const startedAt = previous && now.getTime() - Date.parse(previous.startedAt) < 60 * 60_000 ? previous.startedAt : now.toISOString();
    const count = startedAt === previous?.startedAt ? previous.count : 0;
    if (count >= 20) throw new ChatAccessError(429, 'Hourly question limit reached. Try again later.');
    const current = await store.read<{ revision: string }>('chat/current.json');
    if (!current) throw new ChatAccessError(503, 'The dataset is not ready for chat yet');
    const corpus = chatCorpusSchema.parse(await store.read<ChatCorpus>(`chat/corpora/${current.revision}.json`));
    const images = [];
    for (const imageId of parsed.data.images) { const { id, mime, width, height } = await ownedUpload(store, owner, imageId); images.push({ id, mime, width, height }); }
    for (const id of [parsed.data.sourceId, parsed.data.visual?.sourceId].filter((id): id is string => !!id)) {
      await requireSourceState(store, id);
      if (!corpus.sources.some(source => source.note.source.id === id && source.note.source.active)) throw new ChatAccessError(400, 'Source is unavailable in this dataset');
    }
    if (parsed.data.visual) {
      const note = corpus.sources.find(source => source.note.source.id === parsed.data.visual!.sourceId)!.note;
      const original = noteArtifacts(note).find(artifact => parsed.data.visual!.attachmentKey ? artifact.key === parsed.data.visual!.attachmentKey : artifact.hash === note.extraction.artifactHash);
      if (!original || !(original.mime === 'application/pdf' || original.mime.startsWith('image/'))) throw new ChatAccessError(400, 'Choose a retained PDF or image for visual evidence');
      if (original.mime.startsWith('image/') && parsed.data.visual.page !== 1) throw new ChatAccessError(400, 'Images have only page 1');
    }
    const conversationId = parsed.data.conversationId || randomBytes(16).toString('hex');
    if (parsed.data.conversationId) {
      const conversation = await getConversation(store, owner, conversationId);
      if (conversation.sourceContext) await requireSourceState(store, conversation.sourceContext.sourceId);
    }
    else {
      const source = corpus.sources.find(source => source.note.source.id === parsed.data.sourceId)?.note.source;
      await store.create(`chat/conversations/${owner}/${conversationId}.json`, { id: conversationId, owner, createdAt: now.toISOString(), updatedAt: now.toISOString(),
        ...(source ? { sourceContext: { sourceId: source.id, title: source.title } } : {}), turns: [] } satisfies ChatConversation);
    }
    const id = randomBytes(16).toString('hex');
    const job: ChatJob = { id, owner, corpusRevision: current.revision, conversationId, request: parsed.data, images, createdAt: now.toISOString(), status: 'pending', attempts: 0, lastQueuedAt: now.toISOString() };
    await store.create(`chat/jobs/${id}.json`, job);
    await store.write(key, { startedAt, count: count + 1, activeId: id });
    // The discovery timer also reconciles this durable handoff after a queue outage.
    await send(id).catch(() => undefined);
    return { id, conversationId, status: 'pending' };
  });
}
export async function chatStatus(store: PipelineStore, owner: string, id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new ChatAccessError(404, 'Question not found');
  const job = await store.read<ChatJob>(`chat/jobs/${id}.json`);
  if (!job || job.owner !== owner || Date.now() - Date.parse(job.createdAt) > 24 * 60 * 60_000 || (job.conversationId && await deleted(store, owner, job.conversationId))) throw new ChatAccessError(404, 'Question not found');
  const saved = job.status !== 'complete' ? await savedAnswer(store, job) : undefined;
  if (saved) return { id: job.id, conversationId: job.conversationId, status: 'complete' as const, result: saved, activities: job.activities, error: undefined };
  if (['pending', 'running'].includes(job.status)) {
    const ids = [job.request.sourceId, job.request.visual?.sourceId, ...job.activities?.map(activity => activity.sourceId) || []].filter((id): id is string => !!id);
    for (const source of ids) if (['purging', 'deleted'].includes((await sourceLifecycle(store, source)).state)) return { id: job.id, conversationId: job.conversationId, status: 'failed' as const, error: 'A source was removed while this answer was running. Retry the question using the remaining library.' };
  }
  return { id: job.id, conversationId: job.conversationId, status: job.status, result: job.result, activities: job.activities, draft: job.draft, error: job.error };
}
const tombstone = (owner: string, id: string) => `chat/conversations/${owner}/${id}.deleted.json`;
const deleted = async (store: PipelineStore, owner: string, id: string) => !!await store.read(tombstone(owner, id));
export async function getConversation(store: PipelineStore, owner: string, id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new ChatAccessError(404, 'Conversation not found');
  const conversation = await store.read<ChatConversation>(`chat/conversations/${owner}/${id}.json`);
  if (!conversation || conversation.owner !== owner || await deleted(store, owner, id)) throw new ChatAccessError(404, 'Conversation not found');
  return conversation;
}
export async function listConversations(store: PipelineStore, owner: string) {
  const conversations: { id: string; title: string; updatedAt: string; sourceContext?: ChatSourceContext }[] = [];
  for (const key of await store.list(`chat/conversations/${owner}/`)) {
    if (key.endsWith('.deleted.json') || await deleted(store, owner, key.split('/').at(-1)!.replace(/\.json$/, ''))) continue;
    const conversation = await store.read<ChatConversation>(key);
    if (conversation?.owner === owner && conversation.turns.length) conversations.push({ id: conversation.id, title: conversation.turns[0].question.slice(0, 100) || conversation.sourceContext?.title || 'Image discussion', updatedAt: conversation.updatedAt,
      ...(conversation.sourceContext ? { sourceContext: conversation.sourceContext } : {}) });
  }
  return conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 50);
}
export async function cancelChat(store: PipelineStore, owner: string, id: string) {
  const job = await chatStatus(store, owner, id);
  if (['pending', 'running'].includes(job.status)) await store.create(`chat/cancellations/${id}.json`, { cancelledAt: new Date().toISOString() });
  if (job.status === 'pending') await store.withLease(`chat-job-${id}`, async () => {
    const current = await store.read<ChatJob>(`chat/jobs/${id}.json`);
    if (current?.status === 'pending') await store.write(`chat/jobs/${id}.json`, { ...current, status: 'cancelled' });
  }).catch(error => { if ((error as { statusCode?: number }).statusCode !== 409) throw error; });
  return { id, cancelled: true };
}
/**
 * Deletes an owned conversation. The tombstone blocks a running answer from saving into it,
 * and the cancellation markers stop its jobs. Remaining job records expire with the lifecycle rule.
 */
export async function deleteConversation(store: PipelineStore & { remove(key: string): Promise<void> }, owner: string, id: string) {
  return store.withLease(`chat-user-${owner}`, async () => {
  const conversation = await getConversation(store, owner, id);
  await store.create(tombstone(owner, id), { deletedAt: new Date().toISOString() });
  const jobs = new Set(conversation.turns.map(turn => turn.jobId));
  const user = await store.read<{ activeId: string }>(`chat/users/${owner}.json`);
  if (user?.activeId) jobs.add(user.activeId);
  const retainedUploads = new Set<string>();
  for (const key of await store.list(`chat/conversations/${owner}/`)) {
    if (key.endsWith('.deleted.json')) continue;
    const other = await store.read<ChatConversation>(key);
    if (other?.id !== id && other?.owner === owner && !await deleted(store, owner, other.id)) for (const turn of other.turns) for (const image of turn.images || []) retainedUploads.add(image.id);
  }
  const active = user?.activeId ? await store.read<ChatJob>(`chat/jobs/${user.activeId}.json`) : undefined;
  if (active?.owner === owner && active.conversationId !== id) for (const image of active.images || []) retainedUploads.add(image.id);
  for (const jobId of jobs) {
    const job = await store.read<ChatJob>(`chat/jobs/${jobId}.json`);
    if (job?.owner !== owner || job.conversationId !== id) continue;
    if (['pending', 'running'].includes(job.status)) await store.create(`chat/cancellations/${jobId}.json`, { cancelledAt: new Date().toISOString() });
    else await store.remove(`chat/jobs/${jobId}.json`);
    for (const key of await store.list(`chat/assets/${jobId}/`)) await store.remove(key);
    for (const image of job.images || []) if (!retainedUploads.has(image.id)) for (const suffix of ['.json', '.bin']) await store.remove(uploadKey(owner, image.id) + suffix);
  }
  await store.remove(`chat/conversations/${owner}/${id}.json`);
  return { id, deleted: true };
  });
}
export async function reconcileChat(store: PipelineStore, send: (id: string) => Promise<void>) {
  for (const key of await store.list('chat/jobs/')) {
    const found = await store.read<ChatJob>(key);
    if (!found || !['pending', 'running', 'failed'].includes(found.status)) continue;
    await store.withLease(`chat-job-${found.id}`, async () => {
      const job = await store.read<ChatJob>(key);
      if (!job || !['pending', 'running', 'failed'].includes(job.status)) return;
      const saved = await savedAnswer(store, job);
      if (saved) { await store.write(key, { ...job, status: 'complete', result: saved, error: undefined }); return; }
      if (job.status === 'failed') return;
      if (Date.now() - Date.parse(job.createdAt) >= 10 * 60_000 || job.attempts >= 2) {
        await store.write(key, { ...job, status: 'failed', error: 'The question timed out. Submit it again.' }); return;
      }
      if (job.retryAt && Date.parse(job.retryAt) > Date.now()) return;
      if (job.lastQueuedAt && Date.now() - Date.parse(job.lastQueuedAt) < 2 * 60_000) return;
      await store.write(key, { ...job, status: 'pending', lastQueuedAt: new Date().toISOString() });
      await send(job.id);
    }).catch(error => { if ((error as { statusCode?: number }).statusCode !== 409) throw error; });
  }
}
export async function processChatJob(store: PipelineStore, id: string, answer: (corpus: ChatCorpus, job: ChatJob, recordSandbox: (id: string) => Promise<void>, conversation: ChatConversation | undefined, progress: (activity: ChatActivity) => Promise<void>, signal: AbortSignal, draft: (text: string) => Promise<void>) => Promise<{ answer: unknown; evidence: Evidence[]; assets?: ChatAsset[]; modelAnswer?: string }>) {
  if (!/^[a-f0-9]{32}$/.test(id)) return;
  return store.withLease(`chat-job-${id}`, async () => {
    const key = `chat/jobs/${id}.json`; let job = await store.read<ChatJob>(key);
    if (!job || job.status === 'complete') return;
    const saved = await savedAnswer(store, job);
    if (saved) { await store.write(key, { ...job, status: 'complete', result: saved, error: undefined }); return; }
    if (['failed', 'cancelled'].includes(job.status) || (job.retryAt && Date.parse(job.retryAt) > Date.now())) return;
    if (await store.read(`chat/cancellations/${id}.json`)) { await store.write(key, { ...job, status: 'cancelled' }); return; }
    if (job.attempts >= 2 || Date.now() - Date.parse(job.createdAt) > 10 * 60_000) { await store.write(key, { ...job, status: 'failed', error: 'The question timed out. Submit it again.' }); return; }
    // A new attempt starts a clean draft and step list so a retry never repeats earlier blocks.
    job = { ...job, attempts: job.attempts + 1, status: 'running', activities: [], draft: undefined, startedAt: new Date().toISOString() }; await store.write(key, job);
    let draftWrittenAt = 0;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(Math.max(1, 600_000 - (Date.now() - Date.parse(job.createdAt)))), ...(store.leaseSignal ? [store.leaseSignal] : [])]);
    const cancellation = setInterval(() => { void store.read(`chat/cancellations/${id}.json`).then(found => { if (found) controller.abort(new Error('Chat cancelled')); }).catch(() => undefined); }, 5000);
    try {
      const corpus = await withReaderNotes(store, chatCorpusSchema.parse(await store.read<ChatCorpus>(`chat/corpora/${job.corpusRevision}.json`)));
      const run = async () => {
        const conversation = job!.conversationId ? await getConversation(store, job!.owner, job!.conversationId) : undefined;
        const completed = conversation?.turns.find(turn => turn.jobId === id);
        if (completed) { await store.write(key, { ...job!, status: 'complete', result: completed.result, error: undefined }); return; }
        const runSignal = AbortSignal.any([signal, ...(store.leaseSignal ? [store.leaseSignal] : [])]);
        const result = await answer(corpus, job!, async sandboxId => { job = { ...job!, sandboxId }; await store.write(key, job); }, conversation,
          async activity => {
            const activities = [...(job!.activities || [])];
            const index = activity.id ? activities.findIndex(item => item.id === activity.id) : -1;
            if (index >= 0) activities[index] = activity; else activities.push(activity);
            job = { ...job!, activities: activities.slice(-24) }; await store.write(key, job);
          }, runSignal,
          async text => {
            // Each write holds a whole new block; a short gap bounds SQL writes when blocks arrive in a burst.
            const delay = text ? 500 - (Date.now() - draftWrittenAt) : 0;
            if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
            runSignal.throwIfAborted();
            draftWrittenAt = Date.now(); job = { ...job!, draft: text || undefined }; await store.write(key, job);
          });
        runSignal.throwIfAborted();
        if (await store.read(`chat/cancellations/${id}.json`) || (job!.conversationId && await deleted(store, job!.owner, job!.conversationId))) throw new Error('Chat cancelled');
        const ids = [...new Set([...result.evidence.map(item => item.sourceId), ...result.assets?.map(asset => asset.sourceId) || []])];
        for (const source of ids) await requireSourceState(store, source);
        const publish = async () => {
        const validated = validateAnswer(result.answer, result.evidence, result.assets);
        if (conversation) await store.write(`chat/conversations/${job!.owner}/${conversation.id}.json`, { ...conversation, updatedAt: new Date().toISOString(), turns: [...conversation.turns.filter(turn => turn.jobId !== id), { jobId: id, question: job!.request.question, ...(job!.images?.length ? { images: job!.images } : {}), result: validated,
          ...(job!.activities?.length ? { activities: job!.activities } : {}), ...(result.modelAnswer && result.modelAnswer.length <= 100000 ? { modelAnswer: result.modelAnswer } : {}), workedMs: Date.now() - Date.parse(job!.startedAt || job!.createdAt) }].slice(-100) });
        await store.write(key, { ...job!, status: 'complete', result: validated, draft: undefined, error: undefined });
        if (job!.conversationId && await deleted(store, job!.owner, job!.conversationId)) throw new Error('Chat cancelled');
        };
        if (store.withSourceAccess) await store.withSourceAccess(ids, publish); else await publish();
      };
      if (job.conversationId) await store.withLease(`chat-conversation-${job.owner}-${job.conversationId}`, run);
      else await run();
    } catch (error) {
      // Inner conversation writes have their own ETags. Refresh in this lease frame.
      job = (await store.read<ChatJob>(key)) || job;
      if (controller.signal.aborted || await store.read(`chat/cancellations/${id}.json`)) { await store.write(key, { ...job, status: 'cancelled', result: undefined, error: undefined }); return; }
      if (error instanceof SourceAccessError || (error as { number?: number }).number === 51004) {
        await store.write(key, { ...job, status: 'failed', draft: undefined, result: undefined, error: 'A source was removed while this answer was running. Retry the question using the remaining library.' }); return;
      }
      console.error(JSON.stringify({ event: 'chat-attempt-failed', jobId: id, attempt: job.attempts, errorType: error instanceof Error ? error.name : 'Unknown', statusCode: (error as { statusCode?: number })?.statusCode }));
      await store.write(key, { ...job, status: job.attempts >= 2 ? 'failed' : 'pending', retryAt: new Date(Date.now() + 60_000).toISOString(),
        error: 'An answer could not be verified or completed. Retry the question if this persists.' });
    } finally {
      clearInterval(cancellation);
      const files = store as PipelineStore & { remove?(key: string): Promise<void> };
      if (files.remove && job?.conversationId && await deleted(store, job.owner, job.conversationId)) {
        await files.remove(`chat/conversations/${job.owner}/${job.conversationId}.json`);
        for (const asset of await store.list(`chat/assets/${id}/`)) await files.remove(asset);
      }
    }
  });
}
