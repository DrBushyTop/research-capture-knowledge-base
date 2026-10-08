import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { SourceArtifacts } from '../apps/worker/src/source-artifacts.js';
import { AnalysisInputs } from '../apps/worker/src/analysis-input.js';
import { sourceTextLimit } from '../apps/worker/src/pdf-text.js';
import { hash, normalize, type Note } from '../shared/corpus.js';
import { matchedSourceText, sourceText } from '../shared/source-text.js';
import { inferenceContent } from '../apps/worker/src/image-input.js';
import { MemorySourceArtifactStore } from './source-artifacts-fixture.js';
import { layoutPdf } from './pdf-fixture.js';
import { snapshot } from './fixtures.js';

function png(value: number) {
  const chunk = (kind: string, data: Buffer) => {
    const content = Buffer.concat([Buffer.from(kind), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(content));
    return Buffer.concat([length, content, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, value, 0, 0]))), chunk('IEND', Buffer.alloc(0))]);
}
function capture(files: { mime: string; bytes: Uint8Array | string; title?: string }[]) {
  const library = structuredClone(snapshot);
  library.items = [library.items[0], ...files.map((file, index) => ({ key: `FILE000${index + 1}`, version: 1,
    data: { itemType: 'attachment', parentItem: library.items[0].key, title: file.title || `File ${index + 1}`,
      contentType: file.mime, linkMode: 'imported_file' } }))];
  const source = normalize(library)[0];
  const request = vi.fn(async (path: string) => {
    const index = library.items.findIndex(item => path === `items/${item.key}/file`) - 1;
    if (index < 0 || index >= files.length) throw new Error('Missing file');
    return new Response(typeof files[index].bytes === 'string' ? files[index].bytes : Buffer.from(files[index].bytes), { headers: { 'content-type': files[index].mime } });
  });
  return { source, request };
}
const readable = (label: string) => `${label}. Retained original evidence includes enough text to describe the document and distinguish it from other attachments.`;
const offline = { request: vi.fn(async (): Promise<Response> => { throw new Error('Offline'); }) };
function note(source: Note['source'], evidence: Note['extraction'], id = hash('generation')): Note {
  return { schemaVersion: 1, source, generationId: id, extraction: evidence, analysis: null,
    processing: { version: '4', model: null, processedAt: '2026-10-08T10:00:00Z' }, rightsEvidence: [] };
}

describe('multiple Zotero attachments', () => {
  it('combines two PDFs and an image with file labels and replays every original offline', async () => {
    const { source, request } = capture([{ mime: 'application/pdf', bytes: layoutPdf(), title: 'Article' },
      { mime: 'application/pdf', bytes: layoutPdf(), title: 'Supplement' }, { mime: 'image/png', bytes: png(100), title: 'Chart' }]);
    source.children.push({ key: 'COMMENT1', version: 1, data: { itemType: 'note', parentItem: 'FILE0002', note: '<p>Check the supplementary estimate.</p>' } });
    const store = new MemorySourceArtifactStore();
    const artifacts = new SourceArtifacts(store);
    const first = await artifacts.extract(source, { request });
    expect(first.evidence).toMatchObject({ method: 'combined', status: 'text', truncated: false });
    expect(first.evidence.artifacts).toHaveLength(3);
    expect(first.evidence.artifacts?.every(item => item.analyzed)).toBe(true);
    expect(first.text).toContain('Attachment FILE0001: Article');
    expect(first.text).toContain('Attachment FILE0002: Supplement');
    expect(first.text).toContain('Attachment FILE0003: Chart');
    expect(first.text).toContain('Attachment: FILE0002');
    expect(first.images).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(3);
    expect(await artifacts.extract(source, offline)).toEqual(first);
    for (const reference of first.evidence.artifacts!) expect((await artifacts.readForNote(note(source.source, first.evidence), reference.hash))?.mime).toBe(reference.mime);
  });

  it('retains a carousel while limiting inference to four images and reporting the omitted image', async () => {
    const { source, request } = capture(Array.from({ length: 5 }, (_, index) => ({ mime: 'image/png', bytes: png(index + 1) })));
    const store = new MemorySourceArtifactStore();
    const extracted = await new SourceArtifacts(store).extract(source, { request });
    expect(extracted.images).toHaveLength(4);
    expect(extracted.evidence).toMatchObject({ status: 'image', method: 'combined', truncated: true });
    expect(extracted.evidence.artifacts?.[4]).toMatchObject({ key: 'FILE0005', analyzed: false, reason: 'Source image count limit reached.' });
    expect(store.files.size).toBe(5);
    expect(inferenceContent({ text: extracted.text }, extracted.images)).toHaveLength(5);
    const pinned = note(source.source, extracted.evidence);
    const inputs = new AnalysisInputs(store, new SourceArtifacts(store));
    await inputs.retain(pinned, extracted);
    await store.create(`analysis/${pinned.generationId}.json`, pinned);
    expect((await inputs.read(pinned.source.id, pinned.generationId)).images?.map(image => hash(image.bytes))).toEqual(extracted.images?.map(image => hash(image.bytes)));
  });

  it('gives each document part of the shared text budget and keeps attached notes visible', async () => {
    const { source, request } = capture(Array.from({ length: 8 }, (_, index) => ({ mime: 'text/plain', bytes: readable(`Document ${index + 1}`).repeat(3000) })));
    source.children.push({ key: 'COMMENT1', version: 1, data: { itemType: 'note', parentItem: 'FILE0008', note: '<p>Human commentary must remain visible.</p>' } });
    const extracted = await new SourceArtifacts(new MemorySourceArtifactStore()).extract(source, { request });
    expect(extracted.text.length).toBeLessThanOrEqual(sourceTextLimit);
    expect(extracted.evidence.truncated).toBe(true);
    for (let index = 1; index <= 8; index++) expect(extracted.text).toContain(`Document ${index}`);
    expect(extracted.text).toContain('Human commentary must remain visible.');
    expect(extracted.evidence.artifacts?.every(item => item.truncated)).toBe(true);
  });

  it('pins partial captures within a generation and expands them only in a new generation', async () => {
    const { source, request } = capture([{ mime: 'text/plain', bytes: readable('First original') }, { mime: 'text/plain', bytes: readable('Second original') }]);
    const store = new MemorySourceArtifactStore();
    const artifacts = new SourceArtifacts(store);
    const missing = { request: vi.fn(async (path: string) => path.includes('FILE0002') ? new Response(null, { status: 404 }) : request(path)) };
    const first = await artifacts.extract(source, missing, undefined, hash('generation one'));
    expect(first.evidence.reason).toContain('FILE0002: synced file is unavailable.');
    expect(first.evidence.artifacts).toHaveLength(1);
    expect(await artifacts.extract(source, offline, undefined, hash('generation one'))).toEqual(first);
    const second = await artifacts.extract(source, { request }, undefined, hash('generation two'));
    expect(second.evidence.artifacts).toHaveLength(2);
    expect(second.evidence.truncated).toBe(false);
    expect(second.text).toContain('Second original');
  });

  it('keeps readable sibling evidence when a retained PDF cannot be parsed', async () => {
    const bad = Buffer.from('%PDF-malformed native document');
    const { source, request } = capture([{ mime: 'application/pdf', bytes: bad }, { mime: 'text/plain', bytes: readable('Usable sibling') }]);
    const store = new MemorySourceArtifactStore();
    const extracted = await new SourceArtifacts(store).extract(source, { request });
    expect(extracted.evidence).toMatchObject({ method: 'text', status: 'text', truncated: true });
    expect(extracted.evidence.artifacts?.[0]).toMatchObject({ hash: hash(bad), status: 'needs-review', analyzed: false });
    expect(extracted.text).toContain('Usable sibling');
    expect(store.files.has(hash(bad))).toBe(true);
  });

  it('rejects a corrupt secondary image during replay even when other evidence is available', async () => {
    const first = png(20); const second = png(40);
    const { source, request } = capture([{ mime: 'image/png', bytes: first }, { mime: 'image/png', bytes: second }]);
    const store = new MemorySourceArtifactStore();
    const artifacts = new SourceArtifacts(store);
    const extracted = await artifacts.extract(source, { request });
    store.files.get(hash(second))!.bytes = png(60);
    await expect(artifacts.extract(source, offline)).rejects.toThrow('hash does not match');
    const pinned = note(source.source, extracted.evidence);
    await store.create(`analysis/${pinned.generationId}.json`, pinned);
    await store.create(`source-text/${pinned.generationId}.json`, sourceText(pinned, extracted.text));
    await expect(new AnalysisInputs(store, artifacts).read(pinned.source.id, pinned.generationId)).rejects.toThrow('hash does not match');
  });

  it('rejects retained text whose secondary attachment provenance changed', async () => {
    const { source, request } = capture([{ mime: 'text/plain', bytes: readable('First original') }, { mime: 'text/plain', bytes: readable('Second original') }]);
    const extracted = await new SourceArtifacts(new MemorySourceArtifactStore()).extract(source, { request });
    const pinned = note(source.source, extracted.evidence);
    const cached = sourceText(pinned, extracted.text);
    const changed = structuredClone(pinned); changed.extraction.artifacts![1].hash = hash('foreign original');
    expect(() => matchedSourceText(changed, cached)).toThrow('attachment set');
  });
});
