import { expect, it, vi } from 'vitest';
import { DocumentTexts } from '../apps/worker/src/document-text.js';
import { readSourceText } from '../apps/worker/src/source-reader.js';
import { corpusTools } from '../apps/worker/src/chat-tools.js';
import { chatToolSchemas, definitions } from '../apps/worker/src/chat-agent.js';
import { hash, normalize, type Note } from '../shared/corpus.js';
import { buildSearchIndex } from '../shared/search.js';
import type { ChatCorpus, ChatJob } from '../shared/chat.js';
import type { BlobStore } from '../apps/worker/src/storage.js';
import { MemoryStore, snapshot } from './fixtures.js';

async function library() {
  const store = new MemoryStore();
  const saved = structuredClone(snapshot);
  saved.items[0].data.abstractNote = 'Saved caption remains available alongside full document text.';
  saved.items[1].key = 'PDF00001';
  saved.items.push({ key: 'COMMENT1', version: 1, data: { itemType: 'note', parentItem: 'PDF00001', note: '<p>Check the late methods section.</p>' } });
  const source = normalize(saved)[0];
  const note: Note = { schemaVersion: 1, generationId: hash('retained generation'), source: source.source,
    extraction: { status: 'text', method: 'pdf-text', artifactHash: hash('first PDF bytes'), artifactMime: 'application/pdf', reason: null, truncated: true, retrievedAt: '2026-10-08T10:00:00Z',
      artifacts: [{ hash: hash('first PDF bytes'), mime: 'application/pdf', key: 'PDF00001', title: 'Long article', retrievedAt: '2026-10-08T10:00:00Z', status: 'text', method: 'pdf-text', analyzed: true, reason: null, truncated: true }] },
    analysis: null, processing: { version: '4', model: null, processedAt: '2026-10-08T10:00:00Z' }, rightsEvidence: [] };
  await store.create(`snapshots/${note.generationId}.json`, source);
  await store.create(`analysis/${note.generationId}.json`, note);
  const corpus: ChatCorpus = { revision: hash('corpus'), sources: [{ note, humanMarkdown: '# Human notes\nApp comment.' }] };
  await store.create('chat/current.json', { revision: corpus.revision });
  await store.create(`chat/corpora/${corpus.revision}.json`, corpus);
  await store.create(`chat/indexes/${corpus.revision}.json`, { revision: corpus.revision, index: JSON.parse(JSON.stringify(buildSearchIndex([
    { id: note.source.id, title: note.source.title, authors: '', topics: '', body: 'Late evidence', type: 'journalArticle', year: '2026' }
  ]))) });
  await new DocumentTexts(store).retain(note, [{ hash: note.extraction.artifactHash!, mime: 'application/pdf', key: 'PDF00001', title: 'Long article', complete: true, totalPages: 451,
    sections: [{ page: 1, locator: 'PDF page 1', text: 'Early evidence. '.repeat(3000) }, { page: 450, locator: 'PDF page 450', text: 'Late methods evidence. '.repeat(900) },
      { page: 451, locator: 'PDF page 451', text: 'Late results evidence. '.repeat(100) }] }]);
  const job: ChatJob = { id: '1'.repeat(32), owner: 'owner', corpusRevision: corpus.revision, createdAt: '2026-10-08T10:00:00Z',
    request: { question: 'Read late methods', history: [] }, status: 'pending', attempts: 0 };
  const sandbox = vi.fn(async () => {});
  const tools = await corpusTools(store as unknown as BlobStore, corpus, job, sandbox, async () => {}, AbortSignal.timeout(30_000));
  return { store, source, note, tools, sandbox };
}

it('keeps trashed originals readable but blocks new retrieval from a previously pinned corpus', async () => {
  const { store, note, tools } = await library();
  await store.create(`source-lifecycle/${note.source.id}.json`, { sourceId: note.source.id, state: 'trashed', revision: 1, changedAt: new Date().toISOString(), changedBy: 'admin' });
  expect((await readSourceText(store, note.source.id)).text).toContain('Early evidence');
  expect((await tools.execute('search_corpus', { query: '', offset: 0, limit: 20 })).content).toMatchObject({ total: 0, results: [] });
  await expect(tools.execute('read_source', { sourceId: note.source.id, section: 'source', query: 'late', page: null })).rejects.toMatchObject({ status: 410 });
});

it('serves full original text with continuation and keeps Zotero commentary separate', async () => {
  const { store, note } = await library();
  const first = await readSourceText(store, note.source.id, { attachmentKey: 'PDF00001' });
  expect(first.text).toHaveLength(40_000);
  expect(first.nextOffset).toBe(40_000);
  expect('captureCommentary' in first && first.captureCommentary?.text).toContain('Check the late methods section.');
  expect('captureCommentary' in first && first.captureCommentary?.description).toContain('Saved caption remains available');
  expect(first.text).not.toContain('Check the late methods section.');
  const continuation = await readSourceText(store, note.source.id, { attachmentKey: 'PDF00001', offset: first.nextOffset! });
  expect(continuation.text).toContain('Late methods evidence.');
  expect('captureCommentary' in continuation).toBe(false);
});

it('reads PDF pages beyond the analysis preview with truthful tool continuation', async () => {
  const { note, tools, sandbox } = await library();
  const read = await tools.execute('read_source', { sourceId: note.source.id, section: 'source', query: '', page: null,
    pages: { start: 450, end: 451 }, attachmentKey: 'PDF00001', offset: null });
  const content = read.content as { passages: { text: string; attachmentKey: string }[]; coverage: { requested: { start: number; end: number }; returnedPages: number[]; nextOffset: number | null; charactersReturned: number } };
  expect(content.coverage.requested).toEqual({ start: 450, end: 451 });
  expect(content.coverage.returnedPages).toEqual([450]);
  expect(content.coverage.nextOffset).toBe(content.passages.reduce((length, passage) => length + passage.text.length, 0));
  expect(content.coverage.nextOffset).toBeGreaterThan(0);
  expect(content.passages.every(passage => passage.attachmentKey === 'PDF00001')).toBe(true);
  expect(JSON.stringify(content.passages).length).toBeLessThanOrEqual(18_000);
  let offset = content.coverage.nextOffset;
  const pages = new Set(content.coverage.returnedPages);
  for (let attempt = 0; offset !== null && attempt < 8; attempt++) {
    const next = (await tools.execute('read_source', { sourceId: note.source.id, section: 'source', query: '', page: null,
      pages: { start: 450, end: 451 }, attachmentKey: 'PDF00001', offset })).content as typeof content;
    for (const page of next.coverage.returnedPages) pages.add(page);
    if (next.coverage.nextOffset !== null) expect(next.coverage.nextOffset).toBeGreaterThan(offset);
    offset = next.coverage.nextOffset;
  }
  expect([...pages]).toEqual([450, 451]);
  expect(offset).toBeNull();
  expect(sandbox).not.toHaveBeenCalled();
});

it('exposes saved Zotero commentary as human notes in chat', async () => {
  const { note, tools } = await library();
  const read = await tools.execute('read_source', { sourceId: note.source.id, section: 'notes', query: 'late methods', page: null });
  const content = read.content as { passages: { text: string; kind: string; locator: string }[] };
  expect(content.passages.some(passage => passage.kind === 'human' && passage.text.includes('Check the late methods section.') && passage.locator.includes('Zotero'))).toBe(true);
});

it('finds late evidence without knowing its page number or scanning the analysis preview', async () => {
  const { note, tools, sandbox } = await library();
  const read = await tools.execute('read_source', { sourceId: note.source.id, section: 'source', query: 'Late results evidence', page: null,
    pages: null, attachmentKey: null, offset: null });
  const content = read.content as { passages: { text: string; locator: string; attachmentKey: string }[]; coverage: { offset: number; returnedPages: number[] } };
  expect(content.passages.some(passage => passage.text.includes('Late results evidence') && passage.locator.includes('PDF page 451') && passage.attachmentKey === 'PDF00001')).toBe(true);
  expect(content.coverage.offset).toBeGreaterThan(40_000);
  expect(content.coverage.returnedPages).toEqual([451]);
  expect(sandbox).not.toHaveBeenCalled();
});

it('rejects capture notes copied from a different source generation', async () => {
  const { store, source, note } = await library();
  await store.write(`snapshots/${note.generationId}.json`, { ...source, source: { ...source.source, fingerprint: hash('different capture') } });
  await expect(readSourceText(store, note.source.id)).rejects.toThrow('pinned source generation');
});

it('bounds page ranges and exposes nullable new fields as required strict tool properties', () => {
  const valid = { sourceId: 'zotero-users-12345-PBA4T3PN', section: 'source', query: '', page: null, pages: { start: 450, end: 469 }, attachmentKey: 'PDF00001', offset: null };
  expect(chatToolSchemas.read_source.safeParse(valid).success).toBe(true);
  expect(chatToolSchemas.read_source.safeParse({ ...valid, pages: { start: 450, end: 470 } }).success).toBe(false);
  expect(chatToolSchemas.read_source.safeParse({ ...valid, pages: { start: 450, end: 449 } }).success).toBe(false);
  expect(chatToolSchemas.read_source.safeParse({ ...valid, page: 450 }).success).toBe(false);
  for (const definition of definitions) expect(definition.function.parameters.required).toEqual(Object.keys(definition.function.parameters.properties));
});
