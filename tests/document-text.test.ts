import { expect, it } from 'vitest';
import { DocumentTexts } from '../apps/worker/src/document-text.js';
import { extractArtifact } from '../apps/worker/src/extraction.js';
import { docxMime } from '../apps/worker/src/docx-text.js';
import { documentTextChunkKey, documentTextManifestKey, type DocumentTextInput } from '../shared/document-text.js';
import { hash, normalize, type Note } from '../shared/corpus.js';
import { MemoryStore, snapshot } from './fixtures.js';
import { docxFixture } from './docx-fixture.js';

const original = hash('original document bytes');
const generation = hash('full text generation');
function pinned(artifacts = [{ hash: original, key: 'TEXT0001', title: 'Saved text', mime: 'text/plain' }]): Pick<Note, 'source' | 'generationId' | 'extraction'> {
  return { source: normalize(structuredClone(snapshot))[0].source, generationId: generation,
    extraction: { artifactHash: artifacts[0].hash, artifactMime: artifacts[0].mime, retrievedAt: '2026-10-08T12:00:00Z', status: 'text', method: 'combined', reason: null, truncated: true,
      artifacts: artifacts.map(artifact => ({ ...artifact, retrievedAt: '2026-10-08T12:00:00Z', status: 'text', method: 'text', reason: null, truncated: true, analyzed: true })) } };
}
const input = (text: string): DocumentTextInput => ({ hash: original, mime: 'text/plain', key: 'TEXT0001', title: 'Saved text', complete: true, sections: [{ locator: 'Saved text document', text }] });

it('retains text beyond the analysis budget and reads every chunk through continuation', async () => {
  const store = new MemoryStore();
  const documents = new DocumentTexts(store);
  const note = pinned();
  const text = 'Methods and supplementary observations. '.repeat(6000) + 'Late retained evidence.';
  await documents.retain(note, [input(text)]);
  let offset = 0;
  let read = '';
  do {
    const result = (await documents.read(note, { offset }))!;
    expect(result.text.length).toBeLessThanOrEqual(40_000);
    expect(result).toMatchObject({ generationId: generation, complete: true, documentLength: text.length, artifact: { key: 'TEXT0001' } });
    read += result.text;
    if (result.nextOffset === null) break;
    expect(result.nextOffset).toBeGreaterThan(offset);
    offset = result.nextOffset;
  } while (true);
  expect(read).toBe(text);
  expect(await documents.readAll(note)).toContain('Late retained evidence.');
});

it('serves late PDF pages with exact locators independently of the analysis preview', async () => {
  const store = new MemoryStore();
  const documents = new DocumentTexts(store);
  const note = pinned([{ hash: original, key: 'PDF00001', title: 'Long PDF', mime: 'application/pdf' }]);
  await documents.retain(note, [{ hash: original, mime: 'application/pdf', key: 'PDF00001', title: 'Long PDF', complete: true, totalPages: 451,
    sections: [{ locator: 'PDF page 1', text: 'Early page.\n\n', page: 1 }, { locator: 'PDF page 450', text: 'Late methods.\n\n', page: 450 }, { locator: 'PDF page 451', text: 'Late results.', page: 451 }] }]);
  const late = (await documents.read(note, { startPage: 450, endPage: 451 }))!;
  expect(late.text).toBe('Late methods.\n\nLate results.');
  expect(late.sections.map(section => section.page)).toEqual([450, 451]);
  expect(late.sections.map(section => section.locator)).toEqual(['PDF page 450', 'PDF page 451']);
  expect(late.totalPages).toBe(451);
  expect(late.complete).toBe(true);
  expect(late.nextOffset).toBeNull();
  await expect(documents.read(note, { startPage: 452, endPage: 455 })).rejects.toThrow('final page 451');
  expect((await documents.read(note, { startPage: 451, endPage: 455 }))?.text).toBe('Late results.');
});

it('keeps text for several originals distinct and includes all of them in search', async () => {
  const second = hash('second original bytes');
  const store = new MemoryStore();
  const documents = new DocumentTexts(store);
  const note = pinned([{ hash: original, key: 'TEXT0001', title: 'First text', mime: 'text/plain' }, { hash: second, key: 'TEXT0002', title: 'Second text', mime: 'text/plain' }]);
  await documents.retain(note, [input('First retained original.'), { ...input('Second retained original.'), hash: second, key: 'TEXT0002', title: 'Second text' }]);
  expect((await documents.read(note, { attachmentKey: 'TEXT0002' }))?.text).toBe('Second retained original.');
  expect((await documents.read(note, { artifactHash: original }))?.text).toBe('First retained original.');
  expect(await documents.readAll(note)).toContain('First retained original.');
  expect(await documents.readAll(note)).toContain('Second retained original.');
});

it('defaults to the usable primary document before an empty sibling manifest', async () => {
  const second = hash('usable second original');
  const store = new MemoryStore();
  const documents = new DocumentTexts(store);
  const note = pinned([{ hash: original, key: 'TEXT0001', title: 'Empty text', mime: 'text/plain' }, { hash: second, key: 'TEXT0002', title: 'Usable text', mime: 'text/plain' }]);
  note.extraction.artifactHash = second;
  await documents.retain(note, [{ ...input(''), complete: false }, { ...input('Usable second original.'), hash: second, key: 'TEXT0002' }]);
  expect((await documents.read(note))?.text).toBe('Usable second original.');
  expect((await documents.read(note, { attachmentKey: 'TEXT0001' }))?.text).toBe('');
});

it('shares extraction for identical originals and returns the requested attachment alias', async () => {
  const store = new MemoryStore();
  const documents = new DocumentTexts(store);
  const note = pinned([{ hash: original, key: 'TEXT0001', title: 'First name', mime: 'text/plain' }, { hash: original, key: 'TEXT0002', title: 'Second name', mime: 'text/plain' }]);
  await documents.retain(note, [input('Shared original text.'), { ...input('Shared original text.'), key: 'TEXT0002', title: 'Second name' }]);
  const result = await documents.read(note, { attachmentKey: 'TEXT0002' });
  expect(result?.artifact).toMatchObject({ key: 'TEXT0002', title: 'Second name' });
  expect(result?.text).toBe('Shared original text.');
  expect((await documents.readAll(note))?.match(/Shared original text/g)).toHaveLength(1);
});

it('publishes a manifest only after its immutable chunks and repairs an interrupted upload', async () => {
  const base = new MemoryStore();
  let interrupt = true;
  const store = { read: base.read.bind(base), create: async (key: string, value: unknown) => {
    if (interrupt && key.endsWith('/00001.json')) { interrupt = false; throw new Error('Interrupted upload'); }
    await base.create(key, value);
  } };
  const documents = new DocumentTexts(store);
  const note = pinned();
  const text = 'a'.repeat(90_000);
  await expect(documents.retain(note, [input(text)])).rejects.toThrow('Interrupted upload');
  expect(await documents.read(note)).toBeUndefined();
  await documents.retain(note, [input(text)]);
  expect((await documents.read(note, { offset: 80_000 }))?.text).toBe('a'.repeat(10_000));
});

it('reuses committed text on a retry instead of replacing it with fresh parser output', async () => {
  const store = new MemoryStore();
  const documents = new DocumentTexts(store);
  await documents.retain(pinned(), [input('Original retained text.')]);
  await documents.retain(pinned(), [input('Different fresh parser output.')]);
  expect((await documents.read(pinned()))?.text).toBe('Original retained text.');
});

it('rejects text from a different source generation or attachment set', async () => {
  const store = new MemoryStore();
  const documents = new DocumentTexts(store);
  const note = pinned();
  await documents.retain(note, [input('Pinned original text.')]);
  const different = { ...note, generationId: hash('another generation') };
  await store.create(documentTextManifestKey(different.generationId, original), await store.read(documentTextManifestKey(generation, original)));
  await expect(documents.read(different)).rejects.toThrow('pinned source generation');
  await expect(documents.read(note, { artifactHash: hash('unrelated original') })).rejects.toThrow('pinned attachment set');
  await expect(documents.retain(note, [{ ...input('Unrelated text'), hash: hash('unrelated original') }])).rejects.toThrow('pinned attachment set');
});

it('rejects corrupt or missing chunks instead of silently returning partial text', async () => {
  const store = new MemoryStore();
  const documents = new DocumentTexts(store);
  const note = pinned();
  await documents.retain(note, [input('Verified document text.')]);
  const key = documentTextChunkKey(generation, original, 0);
  const saved = await store.read<Record<string, unknown>>(key);
  await store.write(key, { ...saved, text: 'Corrupted document text' });
  await expect(documents.read(note)).rejects.toThrow('immutable manifest');
  store.data.delete(key);
  await expect(documents.read(note)).rejects.toThrow();
});

it('supports read-only stores and preserves honest partial extraction metadata', async () => {
  const store = new MemoryStore();
  const documents = new DocumentTexts(store);
  const note = pinned();
  await documents.retain(note, [{ ...input('Some extracted text.'), complete: false, reason: 'The extractor reached its document safeguard.' }]);
  const reader = new DocumentTexts({ read: store.read.bind(store) });
  expect(await reader.read(note)).toMatchObject({ complete: false, reason: 'The extractor reached its document safeguard.' });
  await expect(reader.retain(note, [input('Text')])).rejects.toThrow('writable store');
});

it('retains complete long DOCX body separately from its bounded analysis preview', async () => {
  const saved = normalize(structuredClone(snapshot))[0];
  const bytes = docxFixture({ paragraphs: ['A synthetic observation. '.repeat(10_000) + 'Late DOCX evidence.'] });
  const result = await extractArtifact(saved, { bytes, mime: docxMime, retrievedAt: '2026-10-08T12:00:00Z' });
  expect(result.text).not.toContain('Late DOCX evidence.');
  expect(result.evidence.truncated).toBe(true);
  expect(result.documents?.[0].complete).toBe(true);
  const note = { source: saved.source, generationId: generation, extraction: result.evidence };
  const documents = new DocumentTexts(new MemoryStore());
  await documents.retain(note, result.documents!);
  expect(await documents.readAll(note)).toContain('Late DOCX evidence.');
  expect((await documents.read(note))?.sections[0].locator).toContain('DOCX section');
});
