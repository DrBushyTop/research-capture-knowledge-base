import { expect, it, vi } from 'vitest';
import { MemoryStore, snapshot } from './fixtures.js';
import { hash, normalize, type Note } from '../shared/corpus.js';
import { sourceText } from '../shared/source-text.js';
import { readSourceDocument, readSourceText } from '../apps/worker/src/source-reader.js';
import type { BlobStore } from '../apps/worker/src/storage.js';

async function saved(mime = 'application/pdf', bytes = Buffer.from('%PDF-1.7\nfixture')) {
  const state = new MemoryStore();
  const note: Note = { schemaVersion: 1, generationId: 'b'.repeat(64), source: normalize(snapshot)[0].source,
    extraction: { status: 'text', method: 'pdf-text', reason: null, truncated: false, retrievedAt: new Date().toISOString(), artifactHash: hash(bytes), artifactMime: mime }, analysis: null,
    processing: { version: '2', model: null, processedAt: new Date().toISOString() }, rightsEvidence: [] };
  const revision = 'a'.repeat(64);
  await state.write('chat/current.json', { revision });
  await state.write(`chat/corpora/${revision}.json`, { revision, sources: [{ note, humanMarkdown: '' }] });
  await state.write(`source-text/${note.generationId}.json`, sourceText(note, 'Original saved text.'));
  const properties = vi.fn(async () => ({ contentLength: bytes.length, etag: 'current' }));
  const download = vi.fn(async () => bytes);
  const getBlob = vi.fn(() => ({ getProperties: properties, downloadToBuffer: download }));
  const files = { read: state.read.bind(state), raw: { getBlockBlobClient: getBlob } } as unknown as Pick<BlobStore, 'read' | 'raw'>;
  return { state, note, files, properties, download, getBlob };
}
it('serves only text matching the deployed source generation and artifact', async () => {
  const { state, note } = await saved();
  expect((await readSourceText(state, note.source.id)).text).toBe('Original saved text.');
  await state.write(`source-text/${note.generationId}.json`, { ...sourceText(note, 'Wrong artifact'), artifactHash: 'f'.repeat(64) });
  await expect(readSourceText(state, note.source.id)).rejects.toThrow('does not match');
  await expect(readSourceText(state, '../../raw/private')).rejects.toMatchObject({ status: 404 });
});
it('reads a retained original with an ETag and rejects sources outside the corpus', async () => {
  const { note, files, download, getBlob } = await saved();
  expect((await readSourceDocument(files, note.source.id)).mime).toBe('application/pdf');
  expect(getBlob).toHaveBeenCalledWith(note.extraction.artifactHash);
  expect(download.mock.calls[0]).toEqual([0, undefined, expect.objectContaining({ conditions: { ifMatch: 'current' } })]);
  getBlob.mockClear();
  await expect(readSourceDocument(files, 'zotero-users-12345-MISSING1')).rejects.toMatchObject({ status: 404 });
  expect(getBlob).not.toHaveBeenCalled();
});
it('does not serve HTML originals or content mislabeled as a PDF', async () => {
  const html = await saved('text/html', Buffer.from('<html>private source</html>'));
  await expect(readSourceDocument(html.files, html.note.source.id)).rejects.toMatchObject({ status: 404 });
  expect(html.getBlob).not.toHaveBeenCalled();
  const wrong = await saved('application/pdf', Buffer.from('<script>not a PDF</script>'));
  await expect(readSourceDocument(wrong.files, wrong.note.source.id)).rejects.toMatchObject({ status: 404 });
});
it('bounds downloads before reading large raw files', async () => {
  const { files, note, properties, download } = await saved();
  properties.mockResolvedValueOnce({ contentLength: 41 * 1024 * 1024, etag: 'large' });
  await expect(readSourceDocument(files, note.source.id)).rejects.toMatchObject({ status: 413 });
  expect(download).not.toHaveBeenCalled();
});

it('reads one current SQL source without building or loading the chat retrieval snapshot', async () => {
  const { state, note } = await saved();
  const source = vi.fn(async () => ({ note, humanMarkdown: '' }));
  const read = vi.spyOn(state, 'read');
  const store = { source, read: state.read.bind(state) };
  expect((await readSourceText(store, note.source.id)).text).toBe('Original saved text.');
  expect(source).toHaveBeenCalledExactlyOnceWith(note.source.id);
  expect(read).toHaveBeenCalledWith(`source-text/${note.generationId}.json`);
  expect(read.mock.calls.some(([key]) => key.startsWith('chat/'))).toBe(false);
});

it('rejects inactive or unknown SQL sources without falling back to a stale chat snapshot', async () => {
  const { state, note } = await saved();
  const source = vi.fn(async () => undefined);
  const read = vi.spyOn(state, 'read');
  await expect(readSourceText({ source, read: state.read.bind(state) }, note.source.id)).rejects.toMatchObject({ status: 404 });
  expect(read).toHaveBeenCalledExactlyOnceWith(`source-lifecycle/${note.source.id}.json`);
});
