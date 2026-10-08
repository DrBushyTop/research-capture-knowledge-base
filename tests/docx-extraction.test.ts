import { expect, it } from 'vitest';
import { downloadAttachment, extractArtifact, withSavedCommentary } from '../apps/worker/src/extraction.js';
import { docxEntryLimit, docxExpandedByteLimit, docxMime, docxText, docxXmlByteLimit } from '../apps/worker/src/docx-text.js';
import { sourceTextLimit } from '../apps/worker/src/pdf-text.js';
import { SourceArtifacts } from '../apps/worker/src/source-artifacts.js';
import { hash, normalize } from '../shared/corpus.js';
import { snapshot } from './fixtures.js';
import { docxFixture, zipFixture } from './docx-fixture.js';
import { layoutPdf } from './pdf-fixture.js';
import { MemorySourceArtifactStore } from './source-artifacts-fixture.js';

const source = () => normalize(structuredClone(snapshot))[0];
const extract = (bytes: Uint8Array, mime = docxMime) => extractArtifact(source(), { bytes, mime, retrievedAt: '2026-10-08T12:00:00Z' });

it('extracts DOCX headings, paragraphs and table cells in document order', async () => {
  const bytes = docxFixture();
  const result = await extract(bytes);
  expect(result.text).toContain('# Synthetic field observations');
  expect(result.text).toContain('validation.\n\nSecond paragraph');
  expect(result.text).toContain('| Observation | Visits |');
  expect(result.text).toContain('| Morning | 12 |');
  expect(result.text).toContain('| Afternoon | 18 |');
  expect(result.text.indexOf('First paragraph')).toBeLessThan(result.text.indexOf('Second paragraph'));
  expect(result.text.indexOf('Second paragraph')).toBeLessThan(result.text.indexOf('| Observation'));
  expect(result.evidence).toMatchObject({ status: 'text', method: 'docx-text', artifactMime: docxMime, artifactHash: hash(bytes), truncated: false });
  expect(result.evidence.reason).toContain('does not preserve page layout');
});

it.each(['application/octet-stream', 'application/zip', '', `${docxMime}; charset=binary`])('recognizes DOCX bytes with %s transport MIME', async mime => {
  const result = await extract(docxFixture(), mime);
  expect(result.evidence).toMatchObject({ status: 'text', method: 'docx-text', artifactMime: docxMime });
  expect(result.text).toContain('Synthetic field observations');
});

it('recognizes a DOCX download when Zotero and the file response both omit MIME', async () => {
  const attachment = source().children[0];
  delete attachment.data.contentType;
  const downloaded = await downloadAttachment(attachment, { request: async () => new Response(docxFixture()) });
  expect(downloaded.mime).toBe('application/octet-stream');
  expect((await extract(downloaded.bytes, downloaded.mime)).evidence.method).toBe('docx-text');
});

it('retains original DOCX bytes and replays text without downloading the original again', async () => {
  const saved = source();
  saved.children[0].data.contentType = docxMime;
  saved.children[0].data.filename = 'observations.docx';
  const bytes = docxFixture();
  const store = new MemorySourceArtifactStore();
  const artifacts = new SourceArtifacts(store);
  const result = await artifacts.extract(saved, { request: async () => new Response(bytes, { headers: { 'content-type': docxMime } }) });
  expect(store.files.get(hash(bytes))?.bytes).toEqual(bytes);
  const replay = await artifacts.extract(saved, { request: async () => { throw new Error('Original unavailable'); } });
  expect(replay).toEqual(result);
  expect(result.evidence.method).toBe('docx-text');
});

it('pins a generic-MIME DOCX to matching retained bytes for reader and template replay', async () => {
  const saved = source();
  saved.children[0].data.contentType = 'application/octet-stream';
  const bytes = docxFixture();
  const store = new MemorySourceArtifactStore();
  const artifacts = new SourceArtifacts(store);
  const result = await artifacts.extract(saved, { request: async () => new Response(bytes) });
  const pinned = await artifacts.readForNote({ source: saved.source, generationId: 'b'.repeat(64), extraction: result.evidence });
  expect(pinned?.bytes).toEqual(bytes);
  expect(pinned?.mime).toBe(docxMime);
});

it('retains malformed DOCX alongside usable PDF evidence without discarding the PDF', async () => {
  const saved = source();
  saved.children.push({ key: 'BADWORD1', version: 1, data: { itemType: 'attachment', parentItem: saved.root.key, linkMode: 'imported_file', contentType: docxMime, filename: 'malformed.docx' } });
  const pdf = layoutPdf();
  const malformed = Buffer.from('Malformed DOCX bytes');
  const store = new MemorySourceArtifactStore();
  const result = await new SourceArtifacts(store).extract(saved, { request: async path => new Response(path.includes('BADWORD1') ? malformed : pdf) }, undefined, 'c'.repeat(64));
  expect(result.text).toContain('Synthetic layout study');
  expect(result.evidence.status).toBe('text');
  expect(result.evidence.artifacts).toEqual(expect.arrayContaining([
    expect.objectContaining({ hash: hash(pdf), method: 'pdf-text', analyzed: true }),
    expect.objectContaining({ hash: hash(malformed), method: 'docx-text', status: 'needs-review', analyzed: false })
  ]));
  expect(store.files.get(hash(malformed))?.bytes).toEqual(malformed);
  expect(result.evidence.reason).toContain('BADWORD1');
});

it('rejects corrupt retained DOCX bytes during a combined capture replay', async () => {
  const saved = source();
  saved.children.push({ key: 'GOODWORD', version: 1, data: { itemType: 'attachment', parentItem: saved.root.key, linkMode: 'imported_file', contentType: docxMime, filename: 'observations.docx' } });
  const bytes = docxFixture();
  const store = new MemorySourceArtifactStore();
  const artifacts = new SourceArtifacts(store);
  const generation = 'd'.repeat(64);
  await artifacts.extract(saved, { request: async path => new Response(path.includes('GOODWORD') ? bytes : layoutPdf()) }, undefined, generation);
  store.files.set(hash(bytes), { bytes: Buffer.from('Corrupt retained DOCX'), mime: docxMime });
  await expect(artifacts.extract(saved, { request: async () => { throw new Error('No new download'); } }, undefined, generation)).rejects.toThrow('hash');
});

it('labels attachment notes and highlights with the DOCX attachment key', async () => {
  const saved = source();
  saved.children[0].data.contentType = docxMime;
  saved.children[0].data.note = '<p>The observation was unusually short.</p>';
  saved.children.push({ key: 'ANNOD001', version: 1, data: { itemType: 'annotation', parentItem: saved.children[0].key, annotationText: 'twelve bees', annotationComment: 'Question the sample size', annotationPageLabel: '1' } });
  const result = withSavedCommentary(saved, await extractArtifact(saved, { bytes: docxFixture(), mime: docxMime, retrievedAt: '2026-10-08T12:00:00Z' }));
  expect(result.text).toContain(`Saved Zotero note ${saved.children[0].key}\nAttachment: ${saved.children[0].key}`);
  expect(result.text).toContain(`Saved Zotero annotation ANNOD001\nAttachment: ${saved.children[0].key}\nPage: 1`);
  expect(result.text).toContain('Human commentary, separate from the original source.');
});

it('keeps saved notes visible when original source text fills the extraction budget', () => {
  const saved = source();
  saved.children[0].data.note = '<p>A saved question about the methods.</p>';
  const result = withSavedCommentary(saved, { text: 'x'.repeat(sourceTextLimit), evidence: { status: 'text', method: 'docx-text', reason: null, truncated: false, retrievedAt: '2026-10-08T12:00:00Z', artifactHash: null } });
  expect(result.text).toContain('A saved question about the methods.');
  expect(result.text.length).toBeLessThanOrEqual(sourceTextLimit);
  expect(result.evidence.truncated).toBe(true);
  expect(result.evidence.reason).toContain('truncated to include saved notes');
});

it('labels partial commentary when saved notes exceed their reserved text budget', () => {
  const saved = source();
  saved.children[0].data.note = '<p>' + 'commentary '.repeat(3000) + 'End of commentary.</p>';
  const result = withSavedCommentary(saved, { text: 'Original document text. '.repeat(5), evidence: { status: 'text', method: 'docx-text', reason: null, truncated: false, retrievedAt: '2026-10-08T12:00:00Z', artifactHash: null } });
  expect(result.text).toContain('commentary');
  expect(result.text).not.toContain('End of commentary.');
  expect(result.evidence.truncated).toBe(true);
  expect(result.evidence.reason).toContain('first 20000 characters');
});

it('keeps DOCX embedded visuals in the original and labels their omission', async () => {
  const result = await extract(docxFixture({ extraEntries: [['word/media/image1.png', Buffer.from('synthetic image bytes')]] }));
  expect(result.images).toBeUndefined();
  expect(result.evidence.status).toBe('text');
  expect(result.evidence.truncated).toBe(true);
  expect(result.evidence.reason).toContain('Embedded images');
  expect(result.evidence.reason).toContain('were not analyzed');
  expect(result.text).not.toContain('synthetic image bytes');
});

it('retains readable DOCX headers, footers and human document comments as labelled sections', async () => {
  const namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const bytes = docxFixture({ extraEntries: [
    ['word/header1.xml', `<w:hdr xmlns:w="${namespace}"><w:p><w:r><w:t>Header study reference.</w:t></w:r></w:p></w:hdr>`],
    ['word/footer1.xml', `<w:ftr xmlns:w="${namespace}"><w:p><w:r><w:t>Footer draft status.</w:t></w:r></w:p></w:ftr>`],
    ['word/comments.xml', `<w:comments xmlns:w="${namespace}"><w:comment w:id="1" w:author="Observer"><w:p><w:r><w:t>Check the sampling window.</w:t></w:r></w:p></w:comment></w:comments>`]
  ] });
  const result = await extract(bytes);
  expect(result.text).toContain('Header study reference.');
  expect(result.text).toContain('Footer draft status.');
  expect(result.text).toContain('Human document comment 1 by Observer');
  expect(result.text).toContain('Check the sampling window.');
  expect(result.documents?.[0].complete).toBe(true);
  expect(result.documents?.[0].sections.map(section => section.locator)).toEqual(expect.arrayContaining(['DOCX running header header1.xml', 'DOCX running footer footer1.xml', 'Human document comment 1 by Observer']));
  expect(result.evidence.reason).not.toContain('headers and footers were not analyzed');
});

it('bounds DOCX text and reports partial extraction', async () => {
  const result = await extract(docxFixture({ paragraphs: ['A synthetic long observation. '.repeat(Math.ceil(sourceTextLimit / 20))] }));
  expect(result.text.length).toBeLessThanOrEqual(sourceTextLimit);
  expect(result.text.length).toBeGreaterThan(sourceTextLimit - 100);
  expect(result.evidence.truncated).toBe(true);
});

it.each([
  ['not a ZIP archive', Buffer.from('Not a DOCX file')],
  ['truncated archive', docxFixture().subarray(0, 200)],
  ['invalid document XML', docxFixture({ documentXml: '<w:document><w:body><w:p>Broken</w:body>' })],
  ['XML document declaration', docxFixture({ extraEntries: [['word/unsafe.xml', '<!DOCTYPE data [<!ENTITY example "unsafe">]><data>&example;</data>']] })],
  ['duplicate archive path', docxFixture({ extraEntries: [['word/document.xml', '<unexpected/>']] })],
  ['archive traversal', docxFixture({ extraEntries: [['../outside.xml', '<outside/>']] })]
])('retains %s DOCX with a review result instead of an analysis', async (_label, bytes) => {
  const saved = source();
  saved.children[0].data.contentType = docxMime;
  const store = new MemorySourceArtifactStore();
  const result = await new SourceArtifacts(store).extract(saved, { request: async () => new Response(bytes) });
  expect(result.text).toBe('');
  expect(result.evidence.status).toBe('needs-review');
  expect(result.evidence.reason).toContain('DOCX text extraction failed');
  expect(store.files.get(hash(bytes))?.bytes).toEqual(bytes);
});

it('rejects advertised XML and aggregate ZIP expansion beyond the limits before inflating', async () => {
  for (const size of [docxXmlByteLimit + 1, docxExpandedByteLimit + 1]) {
    const bytes = docxFixture();
    const central = bytes.indexOf(Buffer.from('504b0102', 'hex'));
    bytes.writeUInt32LE(size, central + 24);
    await expect(docxText(bytes)).rejects.toThrow('expansion limit');
  }
});

it('rejects inflated bytes that exceed their claimed uncompressed size', async () => {
  const bytes = docxFixture();
  const central = bytes.indexOf(Buffer.from('504b0102', 'hex'));
  bytes.writeUInt32LE(1, central + 24);
  await expect(docxText(bytes)).rejects.toThrow(/bytes|size/i);
});

it('rejects a corrupt ZIP entry checksum', async () => {
  const bytes = docxFixture();
  const central = bytes.indexOf(Buffer.from('504b0102', 'hex'));
  bytes.writeUInt32LE(0, central + 16);
  await expect(docxText(bytes)).rejects.toThrow('corrupt archive entry');
});

it('rejects excessive archive-entry counts', async () => {
  const bytes = docxFixture();
  bytes.writeUInt16LE(docxEntryLimit + 1, bytes.length - 12);
  bytes.writeUInt16LE(docxEntryLimit + 1, bytes.length - 14);
  await expect(docxText(bytes)).rejects.toThrow('archive-entry limit');
});

it('rejects hidden central entries that a second ZIP parser could otherwise read', async () => {
  const bytes = docxFixture({ extraEntries: [['word/document.xml', '<unvalidated/>']] });
  bytes.writeUInt16LE(4, bytes.length - 12);
  bytes.writeUInt16LE(4, bytes.length - 14);
  await expect(docxText(bytes)).rejects.toThrow('inconsistent archive-entry count');
});

it('does not mistake other ZIP archives or legacy Word files for DOCX', async () => {
  const zip = await extract(zipFixture([['plain.txt', 'A plain ZIP archive with enough text to be incorrectly treated as an Office document.']]), 'application/zip');
  expect(zip.evidence).toMatchObject({ status: 'needs-review', method: 'none' });
  const doc = await extract(Buffer.from('d0cf11e0a1b11ae1', 'hex'), 'application/msword');
  expect(doc.evidence).toMatchObject({ status: 'needs-review', method: 'none' });
  expect(doc.evidence.reason).toContain('not supported');
});
