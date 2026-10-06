import { expect, it, vi } from 'vitest';
import { MemoryStore, snapshot } from './fixtures.js';
import { discover, type Job, type SourceState } from '../apps/worker/src/pipeline.js';
import { processJob, type Processor } from '../apps/worker/src/processing.js';
import { categoryRegistry, saveCategory } from '../apps/worker/src/category-registry.js';
import { startBatch, dispatchBatch, changeBatch, categoryOverview, startPreview, processPreview, getPreview } from '../apps/worker/src/category-work.js';
import { applyTemplate, presetRegistry, type TemplateAnalysis, type CategoryAssignment } from '../shared/categories.js';
import { noteSchema, renderMarkdown, type Note } from '../shared/corpus.js';
import { reprocessSource } from '../apps/worker/src/reprocessing.js';
const processor: Processor = { version: '2', model: 'test', extract: async () => ({ text: '2 cups flour. Mix ingredients and bake.', evidence: { status: 'text', method: 'html', reason: null, truncated: false, retrievedAt: new Date().toISOString(), artifactHash: null } }), enrich: async () => { throw new Error('Research schema must not be used'); }, classify: async () => ({ categoryId: 'recipe', reason: 'Ingredients and cooking instructions' }), analyzeTemplate: async (_text, template) => ({ summary: 'A pancake recipe.', topics: ['cooking'], sections: template.sections.map(s => ({ id: s.id, heading: s.heading, format: s.format, text: s.format === 'text' ? 'Reported text' : null, items: s.format === 'text' ? [] : ['Source-supported detail'] })) }), rights: async () => [] };
it('operator reprocessing classifies legacy notes and pins manual assignments', async () => {
  const store = new MemoryStore();
  await discover(store, snapshot, '2');
  const original = (await store.read<Job>((await store.list('jobs/'))[0]))!;
  const next = await reprocessSource(store, original.source.id, async () => {});
  await processJob(store, next, processor);
  expect((await store.read<Note>(`analysis/${next}.json`))?.schemaVersion).toBe(2);
  await store.write(`categories/assignments/${original.source.id}.json`, { categoryId: 'guide', revision: 2, method: 'manual', reason: 'Admin choice' });
  const manual = await reprocessSource(store, original.source.id, async () => {});
  await processJob(store, manual, { ...processor, classify: async () => { throw new Error('Do not replace manual choice'); } });
  const note = await store.read<Note>(`analysis/${manual}.json`);
  expect(note?.schemaVersion === 2 && note.category.id).toBe('guide');
});
async function library() {
  const store = new MemoryStore(); const registry = await categoryRegistry(store);
  await discover(store, snapshot, '2', undefined, registry);
  const job = (await store.read<Job>((await store.list('jobs/'))[0]))!;
  await processJob(store, job.id, processor);
  const note = (await store.read<Note>(`analysis/${job.id}.json`))!;
  await store.write('chat/current.json', { revision: 'a'.repeat(64) });
  await store.create(`chat/corpora/${'a'.repeat(64)}.json`, { revision: 'a'.repeat(64), sources: [{ note, humanMarkdown: '# Human notes\nKeep my own comments.' }] });
  return { store, registry, job, note };
}
it('classifies a webpage by content, renders its own sections, and avoids repeated paid work', async () => {
  const { store, job, note } = await library();
  expect(note.schemaVersion).toBe(2);
  if (note.schemaVersion !== 2) throw new Error();
  expect(note.category.id).toBe('recipe');
  const markdown = renderMarkdown(note);
  expect(markdown).toContain('## Ingredients'); expect(markdown).toContain('## Steps'); expect(markdown).not.toContain('## Population');
  await processJob(store, job.id, { ...processor, classify: vi.fn(() => { throw new Error('duplicate'); }), analyzeTemplate: vi.fn(() => { throw new Error('duplicate'); }) });
  expect((await store.list('staged/')).length).toBe(1);
  expect(noteSchema.parse(note)).toEqual(note);
});
it('saves immutable revisions with optimistic conflicts and a permanent Other fallback', async () => {
  const store = new MemoryStore(); const registry = await categoryRegistry(store);
  const edited = { ...registry.categories[2], sections: [{ id: 'ingredients', heading: 'Shopping list', instructions: 'List reported ingredients', format: 'bullets' }] };
  const saved = await saveCategory(store, registry.revision, edited);
  expect(saved.categories.find(c => c.id === 'recipe')?.revision).toBe(2);
  expect((await store.read<any>('categories/templates/recipe/1.json')).sections[0].heading).toBe('Ingredients');
  await expect(saveCategory(store, registry.revision, edited)).rejects.toMatchObject({ status: 409 });
  await expect(saveCategory(store, saved.revision, { ...saved.categories.find(c => c.id === 'other'), archived: true })).rejects.toMatchObject({ status: 400 });
});
it('template edits do not automatically re-evaluate unchanged sources', async () => {
  const { store, registry, job } = await library();
  const newer = await saveCategory(store, registry.revision, { ...registry.categories[2], name: 'Cooking' });
  await discover(store, snapshot, '2', undefined, newer);
  expect((await store.read<SourceState>(`sources/${job.source.id}.json`))?.generationId).toBe(job.id);
  expect(await store.list('jobs/')).toHaveLength(1);
});
it('pins an update revision, reuses duplicate requests, and preserves the current note on failure', async () => {
  const { store, registry, job, note } = await library();
  const input = { requestId: 'ce1cf987-aa7b-43b2-a001-22eb04a59850', registryRevision: 1, mode: 'apply', sourceIds: [job.source.id] };
  const send = vi.fn(async () => {});
  const batch = await startBatch(store, input, send);
  expect(await startBatch(store, input, send)).toEqual(batch); expect(send).toHaveBeenCalledTimes(1);
  await saveCategory(store, registry.revision, { ...registry.categories[2], name: 'Cooking' });
  expect(await startBatch(store, input, send)).toEqual(batch); expect(send).toHaveBeenCalledTimes(1);
  await dispatchBatch(store, batch.id, send);
  await dispatchBatch(store, batch.id, send);
  const next = (await store.read<SourceState>(`sources/${job.source.id}.json`))!;
  const planned = (await store.read<Job>(`jobs/${next.generationId}.json`))!;
  expect(planned.categoryPlan?.template?.revision).toBe(1);
  await processJob(store, planned.id, { ...processor, analyzeTemplate: async () => { throw new Error('invalid model'); } });
  expect((await store.read<Job>(`jobs/${planned.id}.json`))?.status).toBe('failed');
  expect(await store.read(`staged/${planned.id}.json`)).toBeUndefined();
  expect((await categoryOverview(store)).sources[0].category?.name).toBe('Recipe');
  expect((await store.read<any>(`chat/corpora/${'a'.repeat(64)}.json`)).sources[0].note).toEqual(note);
  await changeBatch(store, batch.id, 'retry', send, job.source.id);
  await processJob(store, planned.id, processor);
  expect((await store.read<Job>(`jobs/${planned.id}.json`))?.status).toBe('staged');
  expect((await categoryOverview(store)).batches[0]?.entries[0].status).toBe('updating-reader');
});
it('skips a batch source superseded by a newer capture and stops pending work', async () => {
  const { store, job } = await library();
  const batch = await startBatch(store, { requestId: 'cc1cf987-aa7b-43b2-a001-22eb04a59850', registryRevision: 1, mode: 'apply', sourceIds: [job.source.id] }, async () => {});
  await store.write(`sources/${job.source.id}.json`, { generationId: 'b'.repeat(64), source: job.source, processingVersion: '2' });
  await dispatchBatch(store, batch.id, async () => {});
  expect((await categoryOverview(store)).batches[0]?.entries[0].status).toBe('superseded');
  const { store: nextStore, job: nextJob } = await library();
  const cancelled = await startBatch(nextStore, { requestId: 'cd1cf987-aa7b-43b2-a001-22eb04a59850', registryRevision: 1, mode: 'apply', sourceIds: [nextJob.source.id] }, async () => {});
  await changeBatch(nextStore, cancelled.id, 'cancel', async () => {});
  await dispatchBatch(nextStore, cancelled.id, async () => {});
  expect(await nextStore.list('jobs/')).toHaveLength(1);
  expect((await categoryOverview(nextStore)).batches[0]?.entries[0].status).toBe('cancelled');
});
it('preserves manual assignments during automatic routing and allows an explicit move', async () => {
  const { store, job } = await library();
  await store.write(`categories/assignments/${job.source.id}.json`, { categoryId: 'guide', revision: 2, method: 'manual', reason: 'Selected by admin' } satisfies CategoryAssignment);
  await expect(startBatch(store, { requestId: 'cd1cf987-aa7b-43b2-a001-22eb04a59851', registryRevision: 1, mode: 'reclassify', sourceIds: [job.source.id] }, async () => {})).rejects.toMatchObject({ status: 400 });
  const batch = await startBatch(store, { requestId: 'cd1cf987-aa7b-43b2-a001-22eb04a59852', registryRevision: 1, mode: 'apply', categoryId: 'news', sourceIds: [job.source.id] }, async () => {});
  await dispatchBatch(store, batch.id, async () => {});
  const next = (await store.read<SourceState>(`sources/${job.source.id}.json`))!;
  await processJob(store, next.generationId, { ...processor, classify: async () => { throw new Error('Manual source must not be classified'); } });
  const note = (await store.read<Note>(`analysis/${next.generationId}.json`))!;
  expect(note.schemaVersion === 2 && note.category.id).toBe('news');
});
it('previews unsaved instructions asynchronously without modifying notes or assignments', async () => {
  const { store, note, registry } = await library();
  const before = await store.read(`categories/assignments/${note.source.id}.json`);
  const template = { ...registry.categories[2], name: 'Unsaved preview' };
  const preview = await startPreview(store, 'admin-a', note.source.id, template, async () => {});
  await expect(getPreview(store, 'admin-b', preview.id)).rejects.toMatchObject({ status: 404 });
  const analyze = vi.fn(async () => ({ summary: 'Preview only', topics: [], sections: [] } as TemplateAnalysis));
  await processPreview(store, preview.id, analyze); await processPreview(store, preview.id, analyze);
  expect(analyze).toHaveBeenCalledTimes(1);
  expect((await getPreview(store, 'admin-a', preview.id)).status).toBe('complete');
  expect(await store.read(`categories/assignments/${note.source.id}.json`)).toEqual(before);
  expect(await store.read(`analysis/${note.generationId}.json`)).toEqual(note);
  expect((await categoryRegistry(store)).revision).toBe(1);
});
it('rejects mismatched sections and unsupported formats from the model', () => {
  const template = presetRegistry.categories[2];
  expect(() => applyTemplate(template, { summary: '', topics: [], sections: [{ id: 'invented', text: null, items: [] }] })).toThrow();
  expect(() => applyTemplate(template, { summary: '', topics: [], sections: template.sections.map(s => ({ id: s.id, text: 'wrong list format', items: [] })) })).toThrow();
});

it('does not reuse immutable revisions after an interrupted settings save', async () => {
  const store = new MemoryStore(); const registry = await categoryRegistry(store);
  const originalWrite = store.write.bind(store); let fail = true;
  store.write = async (key, value) => { if (key === 'categories/current.json' && fail) { fail = false; throw new Error('Interrupted after writing revision'); } await originalWrite(key, value); };
  await expect(saveCategory(store, registry.revision, { ...registry.categories[2], name: 'First draft' })).rejects.toThrow('Interrupted');
  const saved = await saveCategory(store, registry.revision, { ...registry.categories[2], name: 'Second draft' });
  expect(saved.categories.find(c => c.id === 'recipe')?.revision).toBe(3);
  expect((await store.read<any>('categories/templates/recipe/2.json')).name).toBe('First draft');
  expect((await store.read<any>('categories/templates/recipe/3.json')).name).toBe('Second draft');
});

it('removes a source without paying for classification or analysis', async () => {
  const { store, registry, job } = await library();
  const deleted = { ...snapshot, version: snapshot.version + 1, items: [] };
  await discover(store, deleted, '2', undefined, registry);
  const state = (await store.read<SourceState>(`sources/${job.source.id}.json`))!;
  const classify = vi.fn(async () => { throw new Error('Do not classify a deleted source'); });
  await processJob(store, state.generationId, { ...processor, extract: async () => ({ text: '', evidence: { status: 'metadata-only', method: 'none', reason: 'Source removed', truncated: false, retrievedAt: new Date().toISOString(), artifactHash: null } }), classify });
  expect(classify).not.toHaveBeenCalled();
  expect((await store.read<Note>(`staged/${state.generationId}.json`))?.source.active).toBe(false);
});
