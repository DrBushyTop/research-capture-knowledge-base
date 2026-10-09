import { expect, it, vi } from 'vitest';
import { handleReaderRequest, readerErrorResponse, type ReaderRequest } from '../apps/worker/src/reader-actions.js';
import { readerStore } from './reader-actions-fixture.js';
import { screenshot } from './source-artifacts-fixture.js';
import { evidenceChunk, validateAnswer, type ChatJob } from '../shared/chat.js';

function request(query: string, body?: unknown): ReaderRequest {
  return { method: body === undefined ? 'GET' : 'POST', query: new URLSearchParams(query), headers: new Headers(),
    body: body === undefined ? undefined : (async function* () { yield Buffer.from(JSON.stringify(body)); })() };
}

it('rejects a notes body for a different requested source without saving it', async () => {
  const { store, note } = await readerStore();
  await expect(handleReaderRequest(store, 'owner', request('notes=zotero-users-12345-OTHER123', { sourceId: note.source.id, markdown: 'Wrong target', revision: 0 }))).rejects.toMatchObject({ status: 400 });
  expect(await store.read(`reader-notes/${note.source.id}.json`)).toBeUndefined();
  const saved = await handleReaderRequest(store, 'owner', request(`notes=${note.source.id}`, { sourceId: note.source.id, markdown: 'Observation', revision: 0 }));
  expect(saved.status).toBe(200);
  expect(saved.jsonBody).toMatchObject({ markdown: 'Observation', updatedBy: 'owner', revision: 1 });
});

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

it('rejects declared oversized bodies before reading them and hides unknown storage errors', async () => {
  const { store } = await readerStore();
  const next = vi.fn(async () => ({ value: Buffer.from('x'), done: false as const }));
  const req = { ...request('', {}), headers: new Headers({ 'content-length': '40001' }), body: { [Symbol.asyncIterator]: () => ({ next }) } };
  await expect(handleReaderRequest(store, 'owner', req)).rejects.toMatchObject({ status: 413 });
  expect(next).not.toHaveBeenCalled();
  expect(readerErrorResponse(new Error('SQL credentials and private data'))).toEqual({ status: 503, jsonBody: { error: 'The service is temporarily unavailable. Try again.' }, headers: { 'Cache-Control': 'private, no-store' } });
});

it('rejects unknown category actions without dispatching work', async () => {
  const { store } = await readerStore();
  await expect(handleReaderRequest(store, 'owner', request('admin=1', { action: 'invented', id: 'b_invalid' }))).rejects.toMatchObject({ status: 400, message: 'Unknown category action' });
  expect(store.send).not.toHaveBeenCalled();
});

it('returns accepted chat work and keeps conversation ownership', async () => {
  const { store } = await readerStore();
  const result = await handleReaderRequest(store, 'owner', request('', { question: 'Read the saved source' }));
  expect(result.status).toBe(202);
  const body = result.jsonBody as { id: string; conversationId: string };
  expect(store.sendChat).toHaveBeenCalledExactlyOnceWith(body.id);
  expect(await store.read(`chat/jobs/${body.id}.json`)).toMatchObject({ owner: 'owner', status: 'pending' });
  await expect(handleReaderRequest(store, 'other', request(`conversation=${body.conversationId}`))).rejects.toMatchObject({ status: 404 });
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

it('serves original and uploaded bytes with private file headers', async () => {
  const { store, note, bytes } = await readerStore();
  const document = await handleReaderRequest(store, 'owner', request(`document=${note.source.id}`));
  expect(document.body).toEqual(bytes);
  expect(document.headers).toMatchObject({ 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  const uploaded = await handleReaderRequest(store, 'owner', { ...request('upload=1', {}), headers: new Headers({ 'content-type': 'image/png' }), body: (async function* () { yield screenshot; })() });
  expect(uploaded.status).toBe(201);
  const image = uploaded.jsonBody as { id: string };
  expect((await handleReaderRequest(store, 'owner', request(`upload=${image.id}`))).body).toEqual(screenshot);
  await expect(handleReaderRequest(store, 'other', request(`upload=${image.id}`))).rejects.toMatchObject({ status: 404 });
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
