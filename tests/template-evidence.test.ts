import { describe, expect, it, vi } from 'vitest';
import { discover, type Job } from '../apps/worker/src/pipeline.js';
import { processJob, type Processor } from '../apps/worker/src/processing.js';
import { getPreview, processPreview, startPreview } from '../apps/worker/src/category-work.js';
import { categoryRegistry } from '../apps/worker/src/category-registry.js';
import { SourceArtifacts } from '../apps/worker/src/source-artifacts.js';
import { hash, normalize, type Note } from '../shared/corpus.js';
import { AnalysisInputs } from '../apps/worker/src/analysis-input.js';
import { sourceText } from '../shared/source-text.js';
import { type Template, type TemplateAnalysis } from '../shared/categories.js';
import { MemoryStore, snapshot } from './fixtures.js';
import { blobArtifactStore, MemorySourceArtifactStore, screenshot } from './source-artifacts-fixture.js';

const analyze = async (_text: string, template: Template): Promise<TemplateAnalysis> => ({ summary: 'Visible evidence', topics: [],
  sections: template.sections.map(section => ({ id: section.id, heading: section.heading, format: section.format, text: section.format === 'text' ? 'Visible evidence' : null,
    items: section.format === 'text' ? [] : ['Visible evidence'] })) });

for (const [adapter, makeArtifacts] of [['memory', () => new MemorySourceArtifactStore()], ['Blob', blobArtifactStore]] as const) {
  describe(`${adapter} template evidence`, () => {
    async function library(caption = '') {
      const raw = makeArtifacts();
      const store = Object.assign(new MemoryStore(), { retain: raw.retain.bind(raw), readArtifact: raw.readArtifact.bind(raw),
        publishNote: vi.fn(async (_note: Note) => {}) });
      const saved = structuredClone(snapshot);
      saved.items[1].data.contentType = 'image/png';
      if (caption) saved.items[0].data.abstractNote = `<p>${caption}</p>`;
      const artifacts = new SourceArtifacts(store);
      const originals = { request: vi.fn(async () => new Response(screenshot)) };
      const classify = vi.fn(async () => ({ categoryId: 'other', reason: 'Visible screenshot' }));
      const analyzeTemplate: NonNullable<Processor['analyzeTemplate']> = vi.fn(analyze);
      const registry = await categoryRegistry(store);
      const processor: Processor = { version: 'template-evidence-test', model: 'vision-test',
        extract: source => artifacts.extract(source, originals), classify, analyzeTemplate,
        enrich: async () => { throw new Error('Use template analysis'); }, rights: async () => [] };
      await discover(store, saved, processor.version, undefined, registry);
      const job = (await store.read<Job>((await store.list('jobs/'))[0]))!;
      await processJob(store, job.id, processor);
      const note = (await store.read<Note>(`analysis/${job.id}.json`))!;
      const revision = hash('published corpus');
      await store.write('chat/current.json', { revision });
      await store.create(`chat/corpora/${revision}.json`, { revision, sources: [{ note, humanMarkdown: '# Human notes\nKeep my comments.' }] });
      store.publishNote.mockClear(); originals.request.mockClear();
      const template = { ...registry.categories.find(category => category.id === 'other')!, name: 'Unsaved preview' };
      return { store, raw, artifacts, note, originals, classify, analyzeTemplate, template, revision };
    }

    it.each(['', 'Saved caption, separate from pixels.'])('previews the same image and caption as processing, caption %s', async caption => {
      const { store, artifacts, note, originals, classify, analyzeTemplate, template } = await library(caption);
      const processingInput = vi.mocked(analyzeTemplate).mock.calls[0];
      expect(classify.mock.calls[0]?.at(-1)).toEqual([{ bytes: screenshot, mime: 'image/png' }]);
      const preview = await startPreview(store, 'admin-a', note.source.id, template, async () => {});
      const protectedRecords = () => [...store.data].filter(([key]) => !key.startsWith('chat/assets/category-previews/'));
      const before = structuredClone(protectedRecords());
      const previewAnalysis: NonNullable<Processor['analyzeTemplate']> = vi.fn(analyze);
      await processPreview(store, preview.id, previewAnalysis, artifacts);
      expect(await getPreview(store, 'admin-a', preview.id)).toMatchObject({ status: 'complete' });
      expect(vi.mocked(previewAnalysis).mock.calls[0]).toEqual([processingInput[0], template, undefined, note.source, processingInput[4]]);
      expect(processingInput[0]).toBe(caption);
      expect(protectedRecords()).toEqual(before);
      expect(originals.request).not.toHaveBeenCalled();
      expect(store.publishNote).not.toHaveBeenCalled();
      expect(await store.list('source-text/')).toHaveLength(caption ? 1 : 0);
    });

    it('uses the preview generation after a newer capture becomes current', async () => {
      const { store, artifacts, note, template, revision } = await library('Original saved caption');
      const preview = await startPreview(store, 'admin-a', note.source.id, template, async () => {});
      const newer = { ...note, generationId: hash('new generation'), source: { ...note.source, fingerprint: hash('new capture') } };
      await store.create(`analysis/${newer.generationId}.json`, newer);
      await store.write(`sources/${note.source.id}.json`, { source: newer.source, generationId: newer.generationId });
      await store.write(`chat/corpora/${revision}.json`, { revision, sources: [{ note: newer, humanMarkdown: '# Updated human notes' }] });
      await store.create(`source-text/${newer.generationId}.json`, sourceText(newer, 'New generation caption'));
      const previewAnalysis: NonNullable<Processor['analyzeTemplate']> = vi.fn(analyze);
      await processPreview(store, preview.id, previewAnalysis, artifacts);
      expect(await getPreview(store, 'admin-a', preview.id)).toMatchObject({ status: 'complete' });
      expect(vi.mocked(previewAnalysis).mock.calls[0]).toEqual(['Original saved caption', template, undefined, note.source,
        [{ bytes: screenshot, mime: 'image/png' }]]);
    });

    it.each([undefined, 'IMAGE/PNG; charset=binary'])('reads historical pinned images with MIME %s', async mime => {
      const { store, artifacts, note, template } = await library();
      await store.write(`analysis/${note.generationId}.json`, { ...note, extraction: { ...note.extraction, artifactMime: mime } });
      const preview = await startPreview(store, 'admin-a', note.source.id, template, async () => {});
      const previewAnalysis: NonNullable<Processor['analyzeTemplate']> = vi.fn(analyze);
      await processPreview(store, preview.id, previewAnalysis, artifacts);
      expect(await getPreview(store, 'admin-a', preview.id)).toMatchObject({ status: 'complete' });
      expect(vi.mocked(previewAnalysis).mock.calls[0][4]).toEqual([{ bytes: screenshot, mime: 'image/png' }]);
    });

    it.each(['sourceId', 'generationId', 'artifactHash'] as const)('rejects mismatched cached text %s before image inference', async field => {
      const { store, artifacts, note, template } = await library('Saved caption');
      const cached = sourceText(note, 'Saved caption');
      await store.write(`source-text/${note.generationId}.json`, { ...cached,
        [field]: field === 'sourceId' ? 'zotero-users-12345-OTHER123' : hash('wrong provenance') });
      const preview = await startPreview(store, 'admin-a', note.source.id, template, async () => {});
      const previewAnalysis = vi.fn(analyze);
      await processPreview(store, preview.id, previewAnalysis, artifacts);
      expect(await getPreview(store, 'admin-a', preview.id)).toMatchObject({ status: 'failed' });
      expect(previewAnalysis).not.toHaveBeenCalled();
    });

    it.each(['source', 'generation'] as const)('rejects a pinned analysis record with the wrong %s identity', async field => {
      const { store, artifacts, note, template } = await library('Saved caption');
      const preview = await startPreview(store, 'admin-a', note.source.id, template, async () => {});
      await store.write(`analysis/${note.generationId}.json`, { ...note,
        ...(field === 'source' ? { source: { ...note.source, id: 'zotero-users-12345-OTHER123' } } : { generationId: hash('wrong generation') }) });
      const previewAnalysis = vi.fn(analyze);
      await processPreview(store, preview.id, previewAnalysis, artifacts);
      expect(await getPreview(store, 'admin-a', preview.id)).toMatchObject({ status: 'failed' });
      expect(previewAnalysis).not.toHaveBeenCalled();
    });

    it.each(['missing', 'bytes', 'mime'] as const)('fails closed for a %s pinned image even when its caption exists', async failure => {
      const { store, raw, artifacts, note, template, originals } = await library('Caption must not replace unavailable pixels');
      const file = raw.files.get(hash(screenshot))!;
      if (failure === 'missing') raw.files.delete(hash(screenshot));
      else if (failure === 'bytes') file.bytes = Buffer.from('Different retained bytes');
      else file.mime = 'text/plain';
      const preview = await startPreview(store, 'admin-a', note.source.id, template, async () => {});
      const previewAnalysis = vi.fn(analyze);
      await processPreview(store, preview.id, previewAnalysis, artifacts);
      expect(await getPreview(store, 'admin-a', preview.id)).toMatchObject({ status: 'failed' });
      expect(previewAnalysis).not.toHaveBeenCalled();
      expect(originals.request).not.toHaveBeenCalled();
    });
  });
}

function textNote(method: 'browser' | 'zotero-metadata'): Note {
  return { schemaVersion: 1, generationId: hash(`generation ${method}`), source: normalize(structuredClone(snapshot))[0].source,
    extraction: { status: method === 'browser' ? 'text' : 'metadata-only', method, artifactHash: method === 'browser' ? hash('Original saved HTML') : null,
      artifactMime: method === 'browser' ? 'text/html' : undefined, reason: null, truncated: false, retrievedAt: '2026-10-07T10:00:00Z' },
    analysis: null, processing: { version: 'test', model: 'test', processedAt: '2026-10-07T10:00:00Z' }, rightsEvidence: [] };
}

it.each(['browser', 'zotero-metadata'] as const)('replays pinned %s text without reparsing or requesting an artifact', async method => {
  const store = new MemoryStore();
  const note = textNote(method);
  const artifacts = { readForNote: vi.fn(async () => { throw new Error('Text must come from the pinned record'); }) };
  const inputs = new AnalysisInputs(store, artifacts);
  const text = method === 'browser' ? 'Captured browser evidence, absent from the original saved HTML.' : 'Caption saved in Zotero.';
  const processing = await inputs.retain(note, { text });
  await store.create(`analysis/${note.generationId}.json`, note);
  expect(await inputs.read(note.source.id, note.generationId)).toEqual({ ...processing, source: note.source });
  expect(artifacts.readForNote).not.toHaveBeenCalled();
  store.data.delete(`source-text/${note.generationId}.json`);
  await expect(inputs.read(note.source.id, note.generationId)).rejects.toThrow('No readable text');
});

it('uses previously retained text after an interrupted attempt produces changed or empty text', async () => {
  const store = new MemoryStore();
  const note = textNote('browser');
  const inputs = new AnalysisInputs(store);
  expect((await inputs.retain(note, { text: 'First retained browser evidence' })).text).toBe('First retained browser evidence');
  for (const text of ['Later changed browser evidence', '']) {
    expect(await inputs.retain(note, { text })).toMatchObject({ text: 'First retained browser evidence', available: true });
  }
});

it('rejects mismatched fresh image evidence before classification or analysis', async () => {
  const store = new MemoryStore();
  const registry = await categoryRegistry(store);
  const classify = vi.fn(async () => ({ categoryId: 'other', reason: 'Image' }));
  const analyzeTemplate = vi.fn(analyze);
  const processor: Processor = { version: 'test', model: 'test', classify, analyzeTemplate, rights: async () => [],
    enrich: async () => { throw new Error('No inference allowed'); },
    extract: async () => ({ text: '', images: [{ bytes: screenshot, mime: 'image/png' }], evidence: {
      status: 'image', method: 'image-vision', artifactHash: hash('Different artifact'), artifactMime: 'image/png',
      retrievedAt: '2026-10-07T10:00:00Z', reason: null, truncated: false } }) };
  await discover(store, snapshot, processor.version, undefined, registry);
  const job = (await store.read<Job>((await store.list('jobs/'))[0]))!;
  await expect(processJob(store, job.id, processor)).rejects.toThrow('does not match the pinned artifact');
  expect(classify).not.toHaveBeenCalled();
  expect(analyzeTemplate).not.toHaveBeenCalled();
  expect(await store.list('analysis/')).toEqual([]);
});
