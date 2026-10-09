import { expect, it, vi } from 'vitest';
import { MemoryStore, snapshot } from './fixtures.js';
import { hash, normalize, type Note } from '../shared/corpus.js';
import { sourceText } from '../shared/source-text.js';
import { readSourceDocument, readSourceText } from '../apps/worker/src/source-reader.js';
import { ArtifactTooLarge } from '../apps/worker/src/source-artifact-reader.js';
import { blobArtifactStore, screenshot } from './source-artifacts-fixture.js';
import { docxFixture } from './docx-fixture.js';

async function saved(mime = 'application/pdf', bytes = Buffer.from('%PDF-1.7\nfixture')) {
  const state = new MemoryStore();
  const note: Note = { schemaVersion: 1, generationId: 'b'.repeat(64), source: normalize(snapshot)[0].source,
    extraction: { status: 'text', method: 'pdf-text', reason: null, truncated: false, retrievedAt: new Date().toISOString(), artifactHash: hash(bytes), artifactMime: mime }, analysis: null,
    processing: { version: '2', model: null, processedAt: new Date().toISOString() }, rightsEvidence: [] };
  const revision = 'a'.repeat(64);
  await state.write('chat/current.json', { revision });
  await state.write(`chat/corpora/${revision}.json`, { revision, sources: [{ note, humanMarkdown: '' }] });
  await state.write(`source-text/${note.generationId}.json`, sourceText(note, 'Original saved text.'));
  const files = Object.assign(blobArtifactStore(), { read: state.read.bind(state) });
  await files.retain(hash(bytes), bytes, mime);
  const readArtifact = vi.spyOn(files, 'readArtifact');
  return { state, note, files, readArtifact };
}
it('serves only text matching the deployed source generation and artifact', async () => {
  const { state, note } = await saved();
  expect((await readSourceText(state, note.source.id)).text).toBe('Original saved text.');
  await state.write(`source-text/${note.generationId}.json`, { ...sourceText(note, 'Wrong artifact'), artifactHash: 'f'.repeat(64) });
  await expect(readSourceText(state, note.source.id)).rejects.toThrow('does not match');
  await expect(readSourceText(state, '../../raw/private')).rejects.toMatchObject({ status: 404 });
});
it('reads a retained original and rejects sources outside the corpus before reading bytes', async () => {
  const { note, files, readArtifact } = await saved();
  expect((await readSourceDocument(files, note.source.id)).mime).toBe('application/pdf');
  expect(readArtifact).toHaveBeenCalledWith(note.extraction.artifactHash, {});
  readArtifact.mockClear();
  await expect(readSourceDocument(files, 'zotero-users-12345-MISSING1')).rejects.toMatchObject({ status: 404 });
  expect(readArtifact).not.toHaveBeenCalled();
});
it('does not serve HTML originals', async () => {
  const html = await saved('text/html', Buffer.from('<html>private source</html>'));
  await expect(readSourceDocument(html.files, html.note.source.id)).rejects.toMatchObject({ status: 404 });
  expect(html.readArtifact).not.toHaveBeenCalled();
});
it('reports the Reader size limit when the artifact module refuses a large file', async () => {
  const { files, note, readArtifact } = await saved();
  readArtifact.mockRejectedValueOnce(new ArtifactTooLarge());
  await expect(readSourceDocument(files, note.source.id)).rejects.toMatchObject({ status: 413 });
});

it.each(['application/x-pdf', 'application/octet-stream', 'Application/PDF; charset=binary'])('downloads verified PDFs from notes declaring %s', async mime => {
  const { note, files } = await saved(mime);
  expect(await readSourceDocument(files, note.source.id)).toMatchObject({ mime: 'application/pdf', filename: `${note.source.id}.pdf`, disposition: 'inline' });
});

it('downloads a verified DOCX labeled as ZIP and an older image without artifactMime', async () => {
  const docx = await saved('application/zip', docxFixture());
  expect(await readSourceDocument(docx.files, docx.note.source.id)).toMatchObject({ mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: `${docx.note.source.id}.docx`, disposition: 'attachment' });
  const image = await saved('image/png', screenshot);
  const { artifactMime: _mime, ...extraction } = image.note.extraction;
  await image.state.write('chat/corpora/' + 'a'.repeat(64) + '.json', { revision: 'a'.repeat(64), sources: [{ note: { ...image.note, extraction: { ...extraction, method: 'image-vision', status: 'image' } }, humanMarkdown: '' }] });
  expect(await readSourceDocument(image.files, image.note.source.id)).toMatchObject({ bytes: screenshot, mime: 'image/png', filename: `${image.note.source.id}.png` });
});

it('revokes a retained read when permanent deletion starts during the download', async () => {
  const { files, note, state, readArtifact } = await saved();
  readArtifact.mockRestore();
  const original = files.readArtifact.bind(files);
  vi.spyOn(files, 'readArtifact').mockImplementation(async (...args) => {
    const result = await original(...args);
    await state.write(`source-lifecycle/${note.source.id}.json`, { sourceId: note.source.id, state: 'purging', revision: 1, changedAt: new Date().toISOString(), changedBy: 'admin' });
    return result;
  });
  await expect(readSourceDocument(files, note.source.id)).rejects.toMatchObject({ status: 410 });
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
