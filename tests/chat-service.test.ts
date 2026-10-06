import { expect, it } from 'vitest';
import { MemoryStore } from './fixtures.js';
import { cancelChat, chatStatus, getConversation, listConversations, processChatJob, readerIdentity, reconcileChat, submitChat } from '../apps/worker/src/chat-service.js';
import type { ChatJob } from '../shared/chat.js';
import { normalize, type Note } from '../shared/corpus.js';
import { snapshot } from './fixtures.js';
import { AsyncLocalStorage } from 'node:async_hooks';
class LeaseStore extends MemoryStore {
  private frames = new AsyncLocalStorage<Map<string, number>>();
  private versions = new Map<string, number>();
  override async read<T>(key: string) { this.frames.getStore()?.set(key, this.versions.get(key) || 0); return super.read<T>(key); }
  override async write(key: string, value: unknown) {
    const frame = this.frames.getStore();
    if (frame && !frame.has(key)) await this.read(key);
    if (frame && frame.get(key) !== (this.versions.get(key) || 0)) throw Object.assign(new Error('Stale ETag'), { statusCode: 412 });
    await super.write(key, value);
    const version = (this.versions.get(key) || 0) + 1; this.versions.set(key, version); frame?.set(key, version);
  }
  override async withLease<T>(_key: string, fn: () => Promise<T>) { return this.frames.run(new Map(), fn); }
}
async function store(state = new MemoryStore()) {
  const revision = 'a'.repeat(40);
  await state.create('chat/current.json', { revision });
  await state.create(`chat/corpora/${revision}.json`, { revision, sources: [] }); return state;
}
const insufficient = async () => ({ answer: { answer: 'No evidence.', insufficientEvidence: true, citations: [] }, evidence: [] });
it('requires the private reader role and prevents cross-reader job access', async () => {
  const allowed = new Set(['pinaatti', 'drbushytop']);
  expect(() => readerIdentity(null, allowed)).toThrow('Reader access required');
  const principal = (roles: string[], userDetails = 'DrBushyTop', identityProvider = 'github') => Buffer.from(JSON.stringify({ identityProvider, userId: 'test-user', userDetails, userRoles: roles })).toString('base64');
  expect(() => readerIdentity(principal(['authenticated']), allowed)).toThrow();
  expect(() => readerIdentity(principal(['authenticated', 'reader'], 'someone-else'), allowed)).toThrow('Reader access required');
  expect(() => readerIdentity(principal(['reader'], 'DrBushyTop', 'aad'), allowed)).toThrow('Reader access required');
  expect(() => readerIdentity(principal(['reader']), new Set())).toThrow('Reader access required');
  expect(readerIdentity(principal(['reader'], 'pinaatti'), allowed)).toMatch(/^[a-f0-9]{64}$/);
  const owner = readerIdentity(principal(['reader']), allowed);
  const state = await store(); const job = await submitChat(state, owner, { question: 'What is saved?' }, async () => undefined);
  await expect(chatStatus(state, 'someone-else', job.id)).rejects.toMatchObject({ status: 404 });
  expect((await chatStatus(state, owner, job.id)).status).toBe('pending');
  expect((await submitChat(state, owner, { question: 'What is saved?' }, async () => undefined)).id).toBe(job.id);
  await expect(submitChat(state, owner, { question: 'Another question' }, async () => undefined)).rejects.toMatchObject({ status: 429 });
});
it('bounds paid work per reader and records invalid answers as failures', async () => {
  const state = await store();
  for (let i = 0; i < 20; i++) {
    const job = await submitChat(state, 'owner', { question: 'Question ' + i }, async () => undefined);
    await processChatJob(state, job.id, insufficient);
  }
  await expect(submitChat(state, 'owner', { question: 'More' }, async () => undefined)).rejects.toMatchObject({ status: 429 });
  const invalid = await submitChat(state, 'other', { question: 'A question' }, async () => undefined);
  const response = async () => ({ answer: { answer: 'Unsupported fact [e_0000000000000000]', insufficientEvidence: false, citations: [] }, evidence: [] });
  await processChatJob(state, invalid.id, response);
  const key = `chat/jobs/${invalid.id}.json`; const pending = (await state.read<ChatJob>(key))!;
  await state.write(key, { ...pending, retryAt: undefined });
  await processChatJob(state, invalid.id, response);
  const failed = (await state.read<ChatJob>(key))!;
  expect(failed.status).toBe('failed'); expect(failed.result).toBeUndefined();
});
it('keeps conversation context private and does not repeat paid work after completion storage is recovered', async () => {
  const state = await store();
  const first = await submitChat(state, 'owner', { question: 'Remember the label Atlas.' }, async () => undefined);
  await processChatJob(state, first.id, insufficient);
  await expect(getConversation(state, 'other', first.conversationId!)).rejects.toMatchObject({ status: 404 });
  await expect(submitChat(state, 'other', { question: 'Continue', conversationId: first.conversationId }, async () => undefined)).rejects.toMatchObject({ status: 404 });
  const next = await submitChat(state, 'owner', { question: 'What was the label?', conversationId: first.conversationId }, async () => undefined);
  await processChatJob(state, next.id, async (_corpus, _job, _record, conversation, progress) => {
    expect(conversation?.turns[0].question).toBe('Remember the label Atlas.');
    await progress({ tool: 'search_corpus', title: 'Atlas' });
    return insufficient();
  });
  expect((await listConversations(state, 'owner'))[0].id).toBe(first.conversationId);
  expect(await listConversations(state, 'other')).toEqual([]);
  const key = `chat/jobs/${next.id}.json`;
  await state.write(key, { ...(await state.read<ChatJob>(key))!, status: 'pending', attempts: 0 });
  await processChatJob(state, next.id, async () => { throw new Error('Paid work must not run twice'); });
  expect((await chatStatus(state, 'owner', next.id)).status).toBe('complete');
  expect((await getConversation(state, 'owner', first.conversationId!)).turns).toHaveLength(2);
});
it('cancels pending work and stops an in-flight answer before saving it', async () => {
  const state = await store();
  const first = await submitChat(state, 'owner', { question: 'Stop before running' }, async () => undefined);
  await expect(cancelChat(state, 'other', first.id)).rejects.toMatchObject({ status: 404 });
  await cancelChat(state, 'owner', first.id);
  await processChatJob(state, first.id, async () => { throw new Error('Cancelled job must not run'); });
  expect((await chatStatus(state, 'owner', first.id)).status).toBe('cancelled');
  const next = await submitChat(state, 'owner', { question: 'Stop during an answer' }, async () => undefined);
  await processChatJob(state, next.id, async () => { await cancelChat(state, 'owner', next.id); return insufficient(); });
  expect((await chatStatus(state, 'owner', next.id)).status).toBe('cancelled');
  expect((await getConversation(state, 'owner', next.conversationId!)).turns).toEqual([]);
});
it('persists retry and cancellation after a nested conversation lease updates job progress', async () => {
  const state = await store(new LeaseStore());
  const failed = await submitChat(state, 'owner', { question: 'Fail after progress' }, async () => undefined);
  await processChatJob(state, failed.id, async (_corpus, _job, _record, _conversation, progress) => {
    await progress({ tool: 'search_corpus', title: 'Searching' }); throw new Error('Inference failed');
  });
  const retry = (await state.read<ChatJob>(`chat/jobs/${failed.id}.json`))!;
  expect(retry.status).toBe('pending'); expect(retry.retryAt).toBeDefined();
  const stopped = await submitChat(state, 'other', { question: 'Cancel after progress' }, async () => undefined);
  await processChatJob(state, stopped.id, async (_corpus, _job, _record, _conversation, progress) => {
    await progress({ tool: 'inspect_media', title: 'Viewing' }); await cancelChat(state, 'other', stopped.id); return insufficient();
  });
  expect((await chatStatus(state, 'other', stopped.id)).status).toBe('cancelled');
});
it('recovers a committed answer when the last attempt fails to update its job', async () => {
  const state = await store();
  const submitted = await submitChat(state, 'owner', { question: 'Complete once' }, async () => undefined);
  const key = `chat/jobs/${submitted.id}.json`;
  await state.write(key, { ...(await state.read<ChatJob>(key))!, attempts: 1 });
  const write = state.write.bind(state); let fail = true;
  state.write = async (path, value) => {
    if (path === key && (value as ChatJob).status === 'complete' && fail) { fail = false; throw new Error('Storage interrupted'); }
    return write(path, value);
  };
  let calls = 0;
  await processChatJob(state, submitted.id, async () => { calls++; return insufficient(); });
  expect((await state.read<ChatJob>(key))?.status).toBe('failed');
  expect((await chatStatus(state, 'owner', submitted.id)).status).toBe('complete');
  const next = await submitChat(state, 'owner', { question: 'Continue', conversationId: submitted.conversationId }, async () => undefined);
  expect(next.id).not.toBe(submitted.id);
  await reconcileChat(state, async () => { throw new Error('Saved answer must not be queued'); });
  expect((await state.read<ChatJob>(key))?.status).toBe('complete');
  await processChatJob(state, submitted.id, async () => { calls++; return insufficient(); });
  expect(calls).toBe(1);
});
it('resumes an old conversation after temporary jobs have expired', async () => {
  const state = await store();
  const submitted = await submitChat(state, 'owner', { question: 'Initial' }, async () => undefined);
  await processChatJob(state, submitted.id, insufficient);
  const conversation = await getConversation(state, 'owner', submitted.conversationId!);
  await state.write(`chat/conversations/owner/${conversation.id}.json`, { ...conversation, createdAt: new Date(Date.now() - 25 * 60 * 60_000).toISOString(), updatedAt: new Date().toISOString() });
  state.data.delete(`chat/jobs/${submitted.id}.json`);
  expect((await getConversation(state, 'owner', conversation.id)).turns).toHaveLength(1);
  expect((await listConversations(state, 'owner'))[0].id).toBe(conversation.id);
  const next = await submitChat(state, 'owner', { question: 'Continue later', conversationId: conversation.id }, async () => {});
  await processChatJob(state, next.id, async (_corpus, _job, _record, saved) => {
    expect(saved?.turns[0].question).toBe('Initial'); return insufficient();
  });
  expect((await getConversation(state, 'owner', conversation.id)).turns).toHaveLength(2);
});
it('persists document context in history without changing it when discussion moves to another source', async () => {
  const state = await store();
  const source = normalize(snapshot)[0].source;
  const other = { ...source, id: 'zotero-users-12345-OTHER123', title: 'Another saved document' };
  const makeNote = (source: Note['source']): Note => ({ schemaVersion: 1, source, generationId: 'b'.repeat(64), extraction: { status: 'metadata-only', method: 'none', reason: 'No original text', truncated: false, retrievedAt: new Date().toISOString(), artifactHash: null }, analysis: null, processing: { version: '2', model: null, processedAt: new Date().toISOString() }, rightsEvidence: [] });
  await state.write(`chat/corpora/${'a'.repeat(40)}.json`, { revision: 'a'.repeat(40), sources: [source, other].map(source => ({ note: makeNote(source), humanMarkdown: '' })) });
  await expect(submitChat(state, 'owner', { question: 'Unknown source', sourceId: 'zotero-users-12345-MISSING1' }, async () => {})).rejects.toMatchObject({ status: 400 });
  expect(await state.list('chat/conversations/')).toHaveLength(0);
  const first = await submitChat(state, 'owner', { question: 'Explain this document', sourceId: source.id }, async () => {});
  await processChatJob(state, first.id, insufficient);
  const context = { sourceId: source.id, title: source.title };
  expect((await listConversations(state, 'owner'))[0].sourceContext).toEqual(context);
  const next = await submitChat(state, 'owner', { question: 'Compare another saved file too', conversationId: first.conversationId, sourceId: other.id }, async () => {});
  await processChatJob(state, next.id, async (corpus, _job, _record, conversation) => {
    expect(conversation?.sourceContext).toEqual(context);
    expect(corpus.sources.map(s => s.note.source.id)).toEqual([source.id, other.id]);
    return insufficient();
  });
  expect((await getConversation(state, 'owner', first.conversationId!)).sourceContext).toEqual(context);
});
it('streams a draft and live steps, then saves the step history with the verified answer', async () => {
  const state = await store();
  const submitted = await submitChat(state, 'owner', { question: 'Show progress' }, async () => undefined);
  await processChatJob(state, submitted.id, async (_corpus, _job, _record, _conversation, progress, _signal, draft) => {
    await progress({ id: '1', tool: 'search_corpus', title: 'atlas' });
    expect((await chatStatus(state, 'owner', submitted.id)).activities).toEqual([{ id: '1', tool: 'search_corpus', title: 'atlas' }]);
    await progress({ id: '1', tool: 'search_corpus', title: 'atlas', detail: '2 sources found' });
    await progress({ tool: 'commentary', title: 'Comparing both.' });
    await draft('First paragraph.');
    const live = await chatStatus(state, 'owner', submitted.id);
    expect(live).toMatchObject({ status: 'running', draft: 'First paragraph.' });
    expect(live.activities).toHaveLength(2);
    return insufficient();
  });
  const done = await chatStatus(state, 'owner', submitted.id);
  expect(done.status).toBe('complete'); expect(done.draft).toBeUndefined();
  const turn = (await getConversation(state, 'owner', submitted.conversationId!)).turns[0];
  expect(turn.activities).toEqual([{ id: '1', tool: 'search_corpus', title: 'atlas', detail: '2 sources found' }, { tool: 'commentary', title: 'Comparing both.' }]);
  expect(turn.workedMs).toBeGreaterThanOrEqual(0);
});
it('keeps an interrupted draft unsaved and starts the next attempt clean', async () => {
  const state = await store();
  const failed = await submitChat(state, 'owner', { question: 'Fail midway' }, async () => undefined);
  await processChatJob(state, failed.id, async (_corpus, _job, _record, _conversation, progress, _signal, draft) => {
    await progress({ id: '1', tool: 'read_source', title: 'Paper' }); await draft('Half done.'); throw new Error('Inference failed');
  });
  const key = `chat/jobs/${failed.id}.json`;
  expect(await state.read<ChatJob>(key)).toMatchObject({ status: 'pending', draft: 'Half done.' });
  await state.write(key, { ...(await state.read<ChatJob>(key))!, retryAt: undefined });
  await processChatJob(state, failed.id, async (_corpus, job) => {
    expect(job.draft).toBeUndefined(); expect(job.activities).toEqual([]);
    return insufficient();
  });
  expect((await getConversation(state, 'owner', failed.conversationId!)).turns[0].activities).toBeUndefined();
  const stopped = await submitChat(state, 'owner', { question: 'Stop midway' }, async () => undefined);
  await processChatJob(state, stopped.id, async (_corpus, _job, _record, _conversation, _progress, _signal, draft) => {
    await draft('Partial.'); await cancelChat(state, 'owner', stopped.id); return insufficient();
  });
  expect(await chatStatus(state, 'owner', stopped.id)).toMatchObject({ status: 'cancelled', draft: 'Partial.' });
  expect((await getConversation(state, 'owner', stopped.conversationId!)).turns).toEqual([]);
});
