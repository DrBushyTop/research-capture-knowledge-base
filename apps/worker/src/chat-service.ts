import { randomBytes } from 'node:crypto';
import { canonical, hash } from '../../../shared/corpus.js';
import { chatCorpusSchema, chatRequestSchema, validateAnswer, type ChatJob, type ChatCorpus, type Evidence } from '../../../shared/chat.js';
import type { PipelineStore } from './pipeline.js';
export class ChatAccessError extends Error { constructor(public status: number, message: string) { super(message); } }
export function readerIdentity(encoded: string | null): string {
  try {
    if (!encoded || encoded.length > 8192) throw new Error();
    const user = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as { identityProvider: string; userId: string; userRoles: string[] };
    if (!user.userId || !user.identityProvider || !Array.isArray(user.userRoles) || !user.userRoles.includes('reader')) throw new Error();
    return hash(`${user.identityProvider}:${user.userId}`);
  } catch { throw new ChatAccessError(403, 'Reader access required'); }
}
export async function submitChat(store: PipelineStore, owner: string, input: unknown, send: (id: string) => Promise<void>) {
  const parsed = chatRequestSchema.safeParse(input);
  if (!parsed.success) throw new ChatAccessError(400, 'Question or history exceeds chat limits');
  return store.withLease(`chat-user-${owner}`, async () => {
    const now = new Date();
    const key = `chat/users/${owner}.json`;
    const previous = await store.read<{ startedAt: string; count: number; activeId: string }>(key);
    if (previous) {
      const active = await store.read<ChatJob>(`chat/jobs/${previous.activeId}.json`);
      if (active && ['pending', 'running'].includes(active.status) && now.getTime() - Date.parse(active.createdAt) < 10 * 60_000) {
        if (canonical(active.request) === canonical(parsed.data)) return { id: active.id, status: active.status };
        throw new ChatAccessError(429, 'A question is already running. Wait for its answer.');
      }
    }
    const startedAt = previous && now.getTime() - Date.parse(previous.startedAt) < 60 * 60_000 ? previous.startedAt : now.toISOString();
    const count = startedAt === previous?.startedAt ? previous.count : 0;
    if (count >= 20) throw new ChatAccessError(429, 'Hourly question limit reached. Try again later.');
    const current = await store.read<{ revision: string }>('chat/current.json');
    if (!current) throw new ChatAccessError(503, 'The dataset is not ready for chat yet');
    const corpus = chatCorpusSchema.parse(await store.read<ChatCorpus>(`chat/corpora/${current.revision}.json`));
    for (const id of [parsed.data.sourceId, parsed.data.visual?.sourceId].filter(Boolean)) {
      if (!corpus.sources.some(source => source.note.source.id === id)) throw new ChatAccessError(400, 'Source is unavailable in this dataset');
    }
    if (parsed.data.visual) {
      const note = corpus.sources.find(source => source.note.source.id === parsed.data.visual!.sourceId)!.note;
      if (!note.extraction.artifactHash || !(note.extraction.method === 'pdf-text' || note.extraction.artifactMime?.startsWith('image/'))) throw new ChatAccessError(400, 'Choose a retained PDF or image for visual evidence');
      if (note.extraction.artifactMime?.startsWith('image/') && parsed.data.visual.page !== 1) throw new ChatAccessError(400, 'Images have only page 1');
    }
    const id = randomBytes(16).toString('hex');
    const job: ChatJob = { id, owner, corpusRevision: current.revision, request: parsed.data, createdAt: now.toISOString(), status: 'pending', attempts: 0, lastQueuedAt: now.toISOString() };
    await store.create(`chat/jobs/${id}.json`, job);
    await store.write(key, { startedAt, count: count + 1, activeId: id });
    // The discovery timer also reconciles this durable handoff after a queue outage.
    await send(id).catch(() => undefined);
    return { id, status: 'pending' };
  });
}
export async function chatStatus(store: PipelineStore, owner: string, id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new ChatAccessError(404, 'Question not found');
  const job = await store.read<ChatJob>(`chat/jobs/${id}.json`);
  if (!job || job.owner !== owner || Date.now() - Date.parse(job.createdAt) > 24 * 60 * 60_000) throw new ChatAccessError(404, 'Question not found');
  return { id: job.id, status: job.status, result: job.result, error: job.error };
}
export async function reconcileChat(store: PipelineStore, send: (id: string) => Promise<void>) {
  for (const key of await store.list('chat/jobs/')) {
    const found = await store.read<ChatJob>(key);
    if (!found || !['pending', 'running'].includes(found.status)) continue;
    await store.withLease(`chat-job-${found.id}`, async () => {
      const job = await store.read<ChatJob>(key);
      if (!job || !['pending', 'running'].includes(job.status)) return;
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
export async function processChatJob(store: PipelineStore, id: string, answer: (corpus: ChatCorpus, job: ChatJob, recordSandbox: (id: string) => Promise<void>) => Promise<{ answer: unknown; evidence: Evidence[] }>) {
  if (!/^[a-f0-9]{32}$/.test(id)) return;
  return store.withLease(`chat-job-${id}`, async () => {
    const key = `chat/jobs/${id}.json`; let job = await store.read<ChatJob>(key);
    if (!job || ['complete', 'failed'].includes(job.status) || (job.retryAt && Date.parse(job.retryAt) > Date.now())) return;
    if (job.attempts >= 2 || Date.now() - Date.parse(job.createdAt) > 10 * 60_000) { await store.write(key, { ...job, status: 'failed', error: 'The question timed out. Submit it again.' }); return; }
    job = { ...job, attempts: job.attempts + 1, status: 'running' }; await store.write(key, job);
    try {
      const corpus = chatCorpusSchema.parse(await store.read<ChatCorpus>(`chat/corpora/${job.corpusRevision}.json`));
      const result = await answer(corpus, job, async sandboxId => { job = { ...job!, sandboxId }; await store.write(key, job); });
      await store.write(key, { ...job, status: 'complete', result: validateAnswer(result.answer, result.evidence), error: undefined });
    } catch (error) {
      console.error(JSON.stringify({ event: 'chat-attempt-failed', jobId: id, attempt: job.attempts, errorType: error instanceof Error ? error.name : 'Unknown', statusCode: (error as { statusCode?: number })?.statusCode }));
      await store.write(key, { ...job, status: job.attempts >= 2 ? 'failed' : 'pending', retryAt: new Date(Date.now() + 60_000).toISOString(),
        error: 'An answer could not be verified or completed. Retry the question if this persists.' });
    }
  });
}
