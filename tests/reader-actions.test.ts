import { expect, it, vi } from 'vitest';
import { handleReaderRequest, type ReaderRequest } from '../apps/worker/src/reader-actions.js';
import { readerStore } from './reader-actions-fixture.js';
import { evidenceChunk, validateAnswer, type ChatJob } from '../shared/chat.js';

function request(query: string, body?: unknown): ReaderRequest {
  return { method: body === undefined ? 'GET' : 'POST', query: new URLSearchParams(query), headers: new Headers(),
    body: body === undefined ? undefined : (async function* () { yield Buffer.from(JSON.stringify(body)); })() };
}

it.each([
  ['lifecycle=source', 1000, 'Action is too large'],
  ['notes=source', 100_000, 'Notes are too large'],
  ['admin=1', 40_000, 'Settings are too large'],
  ['', 40_000, 'Message is too large'],
  ['upload=1', 5 * 1024 * 1024, 'Images must be 5 MB or smaller']
])('bounds actual streamed bodies for %s without trusting Content-Length', async (query, limit, message) => {
  const { store } = await readerStore();
  const body = (async function* () { yield Buffer.alloc(limit); yield Buffer.from('x'); throw new Error('Should not read past the limit'); })();
  await expect(handleReaderRequest(store, 'owner', { ...request(query, {}), body })).rejects.toMatchObject({ status: 413, message });
  expect(store.send).not.toHaveBeenCalled();
  expect(store.sendChat).not.toHaveBeenCalled();
});

it.each(['broken JSON', 'null', '[]'])('rejects an invalid action body containing %s', async body => {
  const { store } = await readerStore();
  await expect(handleReaderRequest(store, 'owner', { ...request('admin=1', {}), body: (async function* () { yield Buffer.from(body); })() })).rejects.toMatchObject({ status: 400 });
});

it('rejects declared oversized bodies before reading them', async () => {
  const { store } = await readerStore();
  const next = vi.fn(async () => ({ value: Buffer.from('x'), done: false as const }));
  const req = { ...request('', {}), headers: new Headers({ 'content-length': '40001' }), body: { [Symbol.asyncIterator]: () => ({ next }) } };
  await expect(handleReaderRequest(store, 'owner', req)).rejects.toMatchObject({ status: 413 });
  expect(next).not.toHaveBeenCalled();
});

it('dispatches deletion only after its durable purging marker and keeps a failed handoff recoverable', async () => {
  const { store, note } = await readerStore();
  const id = note.source.id;
  await handleReaderRequest(store, 'admin', request(`lifecycle=${id}`, { action: 'trash', revision: 0 }));
  const cleanup = vi.fn(async () => {
    expect(await store.read(`source-lifecycle/${id}.json`)).toMatchObject({ state: 'purging' });
    throw new Error('Queue unavailable');
  });
  const result = await handleReaderRequest(store, 'admin', request(`lifecycle=${id}`, { action: 'purge', revision: 1 }), cleanup);
  expect(result.jsonBody).toMatchObject({ state: 'purging', revision: 2 });
  expect(cleanup).toHaveBeenCalledExactlyOnceWith(id);
});

it('dispatches cited file downloads with their pinned generation', async () => {
  const { store, note, bytes, revision } = await readerStore();
  const citation = evidenceChunk({ sourceId: note.source.id, generationId: note.generationId, title: note.source.title, kind: 'source', locator: 'PDF page 1', text: 'Original quotation', pdf: true });
  const id = 'a'.repeat(32);
  const result = validateAnswer({ answer: `Quoted [${citation.id}]`, insufficientEvidence: false, citations: [{ evidenceId: citation.id, quote: 'Original quotation' }] }, [citation]);
  await store.create(`chat/jobs/${id}.json`, { id, owner: 'owner', createdAt: new Date().toISOString(), corpusRevision: revision, request: { question: 'Original?', history: [] }, status: 'complete', attempts: 1, result } satisfies ChatJob);
  const file = await handleReaderRequest(store, 'owner', request(`id=${id}&file=${note.source.id}&evidence=${citation.id}`));
  expect(file.body).toEqual(bytes);
  expect(file.headers['Content-Type']).toBe('application/pdf');
  await expect(handleReaderRequest(store, 'other', request(`id=${id}&file=${note.source.id}`))).rejects.toMatchObject({ status: 404 });
});

it.each(['offset=-1', 'attachment=invalid'])('validates original text selection with %s', async selection => {
  const { store, note } = await readerStore();
  await expect(handleReaderRequest(store, 'owner', request(`source=${note.source.id}&${selection}`))).rejects.toMatchObject({ status: 400 });
});
