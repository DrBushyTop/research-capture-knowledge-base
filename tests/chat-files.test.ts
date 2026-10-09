import { expect, it, vi } from 'vitest';
import { MemoryStore, snapshot } from './fixtures.js';
import { hash, normalize, noteSchema } from '../shared/corpus.js';
import { evidenceChunk, validateAnswer, type ChatAsset, type ChatJob } from '../shared/chat.js';
import { readChatFile } from '../apps/worker/src/chat-files.js';
import type { BlobStore } from '../apps/worker/src/storage.js';
import { blobArtifactStore, MemorySourceArtifactStore, screenshot } from './source-artifacts-fixture.js';
const id = '1'.repeat(32); const revision = '2'.repeat(64);
it.each([undefined, 'application/x-pdf', 'application/octet-stream'])('serves a cited original generation with MIME %s and refuses another reader or uncited source', async mime => {
  const state = new MemorySourceArtifactStore(); const keys: string[] = [];
  const bytes = Buffer.from('%PDF-1.7\nSaved fixture');
  const generationId = 'a'.repeat(64); const artifactHash = hash(bytes);
  await state.retain(artifactHash, bytes, mime || 'application/pdf');
  const read = state.readArtifact.bind(state);
  state.readArtifact = async key => { keys.push(key); return read(key); };
  const source = normalize(snapshot)[0].source;
  const note = noteSchema.parse({ schemaVersion: 1, generationId, source, extraction: { status: 'text', method: 'pdf-text', reason: null, truncated: false, retrievedAt: new Date().toISOString(), artifactHash, ...(mime ? { artifactMime: mime } : {}) }, analysis: null, processing: { version: '2', model: null, processedAt: new Date().toISOString() }, rightsEvidence: [] });
  const cite = evidenceChunk({ sourceId: source.id, generationId, title: source.title, kind: 'source', locator: 'PDF page 2', text: 'Saved original text', sourceUrl: 'https://example.org/original', pdf: true });
  const result = validateAnswer({ answer: `Original [${cite.id}]`, insufficientEvidence: false, citations: [{ evidenceId: cite.id, quote: 'Saved original text' }] }, [cite]);
  const job: ChatJob = { id, owner: 'owner', createdAt: new Date().toISOString(), corpusRevision: revision, request: { question: 'Original?', history: [] }, status: 'complete', attempts: 1, result };
  await state.create(`chat/jobs/${id}.json`, job);
  await state.create(`chat/corpora/${revision}.json`, { revision, sources: [{ note: { ...note, generationId: 'c'.repeat(64), extraction: { ...note.extraction, artifactHash: 'd'.repeat(64) } }, humanMarkdown: '' }] });
  await state.create(`analysis/${generationId}.json`, note);
  const store = state as unknown as BlobStore;
  await expect(readChatFile(store, 'other', id, null, source.id)).rejects.toMatchObject({ status: 404 });
  await expect(readChatFile(store, 'owner', id, null, 'zotero-users-12345-UNKNOWN1')).rejects.toMatchObject({ status: 404 });
  await expect(readChatFile(store, 'owner', id, null, source.id, 'e_' + '0'.repeat(16))).rejects.toMatchObject({ status: 404 });
  expect(keys).toEqual([]);
  expect((await readChatFile(store, 'owner', id, null, source.id, cite.id)).mime).toBe('application/pdf');
  expect(keys).toEqual([artifactHash]);
  expect(result.citations[0].sourceUrl).toBe('https://example.org/original');
});

it.each([false, true])('reads MIME-less cited images and enforces their 5 MB limit, oversized=%s', async oversized => {
  const state = new MemorySourceArtifactStore();
  const bytes = oversized ? Buffer.concat([screenshot, Buffer.alloc(5 * 1024 * 1024)]) : screenshot;
  const source = normalize(snapshot)[0].source;
  const generationId = 'a'.repeat(64);
  const note = noteSchema.parse({ schemaVersion: 1, generationId, source, extraction: { status: 'image', method: 'image-vision', reason: null, truncated: false, retrievedAt: new Date().toISOString(), artifactHash: hash(bytes) }, analysis: null, processing: { version: '2', model: null, processedAt: new Date().toISOString() }, rightsEvidence: [] });
  const citation = evidenceChunk({ sourceId: source.id, generationId, title: source.title, kind: 'source', locator: 'Stored image', text: 'Saved chart' });
  const result = validateAnswer({ answer: `Chart [${citation.id}]`, insufficientEvidence: false, citations: [{ evidenceId: citation.id, quote: 'Saved chart' }] }, [citation]);
  await state.create(`chat/jobs/${id}.json`, { id, owner: 'owner', createdAt: new Date().toISOString(), corpusRevision: revision, request: { question: 'Chart?', history: [] }, status: 'complete', attempts: 1, result } satisfies ChatJob);
  await state.create(`chat/corpora/${revision}.json`, { revision, sources: [{ note, humanMarkdown: '' }] });
  await state.retain(hash(bytes), bytes, 'image/png');
  const read = readChatFile(state as unknown as BlobStore, 'owner', id, null, source.id);
  if (oversized) await expect(read).rejects.toMatchObject({ status: 404 });
  else expect(await read).toMatchObject({ bytes, mime: 'image/png', filename: `${source.id}.png` });
});

it('rejects oversized cited images with legacy MIME whitespace before downloading Blob bytes', async () => {
  const state = new MemorySourceArtifactStore();
  const blobs = blobArtifactStore();
  const bytes = Buffer.concat([screenshot, Buffer.alloc(5 * 1024 * 1024)]);
  const source = normalize(snapshot)[0].source;
  const generationId = 'a'.repeat(64);
  const note = noteSchema.parse({ schemaVersion: 1, generationId, source, extraction: { status: 'image', method: 'image-vision', reason: null, truncated: false, retrievedAt: new Date().toISOString(), artifactHash: hash(bytes), artifactMime: ' Image/PNG; charset=binary' }, analysis: null, processing: { version: '2', model: null, processedAt: new Date().toISOString() }, rightsEvidence: [] });
  const citation = evidenceChunk({ sourceId: source.id, generationId, title: source.title, kind: 'source', locator: 'Stored image', text: 'Saved chart' });
  const result = validateAnswer({ answer: `Chart [${citation.id}]`, insufficientEvidence: false, citations: [{ evidenceId: citation.id, quote: 'Saved chart' }] }, [citation]);
  await state.create(`chat/jobs/${id}.json`, { id, owner: 'owner', createdAt: new Date().toISOString(), corpusRevision: revision, request: { question: 'Chart?', history: [] }, status: 'complete', attempts: 1, result } satisfies ChatJob);
  await state.create(`chat/corpora/${revision}.json`, { revision, sources: [{ note, humanMarkdown: '' }] });
  await blobs.retain(hash(bytes), bytes, 'image/png');
  const client = blobs.raw.getBlockBlobClient(hash(bytes));
  const download = vi.spyOn(client, 'downloadToBuffer');
  vi.spyOn(blobs.raw, 'getBlockBlobClient').mockReturnValue(client);
  const store = Object.assign(state, { readArtifact: blobs.readArtifact.bind(blobs) });
  await expect(readChatFile(store as unknown as BlobStore, 'owner', id, null, source.id)).rejects.toMatchObject({ status: 404 });
  expect(download).not.toHaveBeenCalled();
});
it('serves cited image evidence even when it is not an answer attachment', async () => {
  const state = new MemoryStore(); const asset = 'a_' + 'a'.repeat(16); const sourceId = 'zotero-users-12345-PBA4T3PN';
  const cite = evidenceChunk({ sourceId, generationId: 'b'.repeat(64), title: 'Image', kind: 'visual', locator: 'Image', text: 'Rendered image', assetId: asset });
  await state.create(`chat/jobs/${id}.json`, { id, owner: 'owner', createdAt: new Date().toISOString(), status: 'complete', result: validateAnswer({ answer: `Image [${cite.id}]`, insufficientEvidence: false, citations: [{ evidenceId: cite.id, quote: null }] }, [cite]) });
  await state.create(`chat/assets/${id}/${asset}.json`, { id: asset, sourceId, kind: 'image', blobKey: `chat/assets/${id}/${asset}.png` });
  const store = Object.assign(state, { container: { getBlockBlobClient: () => ({ getProperties: async () => ({ contentLength: 3, etag: 'version' }), downloadToBuffer: async () => Buffer.from('png') }) } }) as unknown as BlobStore;
  expect((await readChatFile(store, 'owner', id, asset, null)).mime).toBe('image/png');
  await state.create(`source-lifecycle/${sourceId}.json`, { sourceId, state: 'trashed', revision: 1, changedAt: new Date().toISOString(), changedBy: 'admin' });
  expect((await readChatFile(store, 'owner', id, asset, null)).mime).toBe('image/png');
  await state.write(`source-lifecycle/${sourceId}.json`, { sourceId, state: 'purging', revision: 2, changedAt: new Date().toISOString(), changedBy: 'admin' });
  await expect(readChatFile(store, 'owner', id, asset, null)).rejects.toMatchObject({ status: 410 });
  expect((await state.read<ChatJob>(`chat/jobs/${id}.json`))?.result?.citations[0].excerpt).toBe('Rendered image');
  await expect(readChatFile(store, 'other', id, asset, null)).rejects.toMatchObject({ status: 404 });
});

it('serves a selected original carousel image without requiring a citation', async () => {
  const state = new MemorySourceArtifactStore();
  const bytes = screenshot;
  const source = normalize(snapshot)[0].source;
  const artifactHash = hash(bytes);
  const note = noteSchema.parse({ schemaVersion: 1, generationId: 'a'.repeat(64), source,
    extraction: { status: 'image', method: 'combined', reason: null, truncated: false, retrievedAt: new Date().toISOString(), artifactHash: hash('first image'), artifactMime: 'image/png',
      artifacts: [hash('first image'), artifactHash].map((hash, index) => ({ hash, key: `IMAGE00${index + 1}`, mime: 'image/png', retrievedAt: new Date().toISOString(), status: 'image', method: 'image-vision', analyzed: true, reason: null, truncated: false })) },
    analysis: null, processing: { version: '4', model: null, processedAt: new Date().toISOString() }, rightsEvidence: [] });
  const asset: ChatAsset = { id: 'a_' + 'c'.repeat(16), sourceId: source.id, kind: 'image', mime: 'image/png', title: 'Second carousel image', page: null, artifactHash, attachmentKey: 'IMAGE002' };
  const result = validateAnswer({ answer: 'Here is the second saved chart.', insufficientEvidence: false, citations: [], attachments: [asset.id] }, [], [asset]);
  await state.create(`chat/jobs/${id}.json`, { id, owner: 'owner', createdAt: new Date().toISOString(), status: 'complete', corpusRevision: revision, result });
  await state.create(`chat/corpora/${revision}.json`, { revision, sources: [{ note, humanMarkdown: '' }] });
  await state.create(`chat/assets/${id}/${asset.id}.json`, asset);
  await state.retain(artifactHash, bytes, 'image/png');
  const store = state as unknown as BlobStore;
  expect(await readChatFile(store, 'owner', id, asset.id, null)).toMatchObject({ bytes, mime: 'image/png', filename: `${source.id}-IMAGE002.png` });
  await expect(readChatFile(store, 'other', id, asset.id, null)).rejects.toMatchObject({ status: 404 });
});
