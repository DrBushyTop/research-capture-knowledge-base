import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { hash, sourceId, type Note } from '../../../shared/corpus.js';
import { assignmentSchema, categoryId, templateSchema, type CategoryAssignment, type Registry, type Template, type TemplateAnalysis } from '../../../shared/categories.js';
import { chatCorpusSchema, type ChatCorpus } from '../../../shared/chat.js';
import { AnalysisInputs } from './analysis-input.js';
import type { SourceArtifacts } from './source-artifacts.js';
import type { SourceImage } from './image-input.js';
import type { Job, PipelineStore, SourceState } from './pipeline.js';
import { categoryRegistry, CategoryError } from './category-registry.js';
import { SourceGenerations } from './source-generations.js';

interface Entry { sourceId: string; expected: string; jobId: string; assignment?: CategoryAssignment; preserveExisting: boolean; dispatched?: boolean; skipped?: boolean; }
interface Batch { id: string; registry: Registry; mode: 'apply' | 'reclassify'; categoryId?: string; createdAt: string; entries: Entry[]; cancelled?: boolean; }
interface Preview { id: string; owner: string; sourceId: string; generationId: string; template: Template; status: 'pending' | 'complete' | 'failed'; createdAt: string; attempts: number; result?: TemplateAnalysis; error?: string; }
const batchInput = z.strictObject({ requestId: z.string().uuid(), registryRevision: z.number().int().positive(), mode: z.enum(['apply', 'reclassify']), categoryId: categoryId.optional(), sourceIds: z.array(sourceId).min(1).max(200) })
  .refine(input => new Set(input.sourceIds).size === input.sourceIds.length, 'Select each document once');
const batchKey = (id: string) => { if (!/^b_[a-f0-9]{32}$/.test(id)) throw new CategoryError(404, 'Update not found'); return `categories/batches/${id}.json`; };
const previewKey = (id: string) => { if (!/^p_[a-f0-9]{32}$/.test(id)) throw new CategoryError(404, 'Preview not found'); return `chat/assets/category-previews/${id}.json`; };
async function deployed(store: PipelineStore): Promise<ChatCorpus | undefined> {
  const current = await store.read<{ revision: string }>('chat/current.json');
  return current ? chatCorpusSchema.parse(await store.read(`chat/corpora/${current.revision}.json`)) : undefined;
}
export async function categoryOverview(store: PipelineStore) {
  const registry = await categoryRegistry(store);
  const corpus = await deployed(store);
  const sources = await Promise.all((corpus?.sources || []).filter(s => s.note.source.active).map(async ({ note }) => {
    const assignment = await store.read<CategoryAssignment>(`categories/assignments/${note.source.id}.json`);
    const state = await store.read<SourceState>(`sources/${note.source.id}.json`);
    const job = state ? await store.read<Job>(`jobs/${state.generationId}.json`) : undefined;
    const category = note.schemaVersion === 2 ? note.category : null;
    return { id: note.source.id, title: note.source.title, category, assignment, needsUpdate: !category || registry.categories.find(c => c.id === category.id)?.revision !== category.templateRevision,
      status: state?.generationId === note.generationId ? 'complete' : job?.status === 'failed' ? 'failed' : job?.status === 'pending' ? 'processing' : 'updating-reader' };
  }));
  const batches = (await Promise.all((await store.list('categories/batches/')).map(key => store.read<Batch>(key))))
    .filter((batch): batch is Batch => !!batch).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
  return { registry, sources, batches: await Promise.all(batches.map(batch => batchProgress(store, batch, corpus))) };
}
export async function startBatch(store: PipelineStore, input: unknown, send: (id: string) => Promise<void>) {
  const parsed = batchInput.safeParse(input);
  if (!parsed.success) throw new CategoryError(400, 'Choose up to 200 documents and a saved category revision');
  const request = parsed.data;
  const id = 'b_' + hash(request.requestId).slice(0, 32);
  const key = batchKey(id);
  return store.withLease(`category-batch-${id}`, async () => {
    if (await store.read<Batch>(key)) return { id };
    const registry = await categoryRegistry(store);
    if (registry.revision !== request.registryRevision) throw new CategoryError(409, 'Categories changed. Reload before starting the update.');
    const selected = request.categoryId ? registry.categories.find(c => c.id === request.categoryId && !c.archived) : undefined;
    if (request.categoryId && !selected) throw new CategoryError(400, 'Choose an available category');
    const corpus = await deployed(store);
    const entries: Entry[] = [];
    for (const source of request.sourceIds) {
      const note = corpus?.sources.find(s => s.note.source.id === source)?.note;
      const state = await store.read<SourceState>(`sources/${source}.json`);
      if (!note || !state?.source.active) throw new CategoryError(400, 'A selected document is no longer available. Reload the list.');
      const previous = await store.read<CategoryAssignment>(`categories/assignments/${source}.json`);
      if (request.mode === 'reclassify' && previous?.method === 'manual') continue;
      let assignment: CategoryAssignment | undefined;
      if (request.mode === 'apply') {
        const assigned = selected?.id || previous?.categoryId || (note.schemaVersion === 2 ? note.category.id : undefined);
        if (!assigned) throw new CategoryError(400, 'Choose a category for documents that have not been categorised');
        assignment = assignmentSchema.parse({ categoryId: assigned, revision: selected ? (previous?.revision || 0) + 1 : previous?.revision || 1, method: selected ? 'manual' : previous?.method || 'automatic', reason: selected ? 'Selected by an admin' : previous?.reason || 'Existing category' });
        if (!registry.categories.some(c => c.id === assigned)) throw new CategoryError(400, 'The assigned category is unavailable');
      }
      entries.push({ sourceId: source, expected: state.generationId, jobId: hash(`${id}:${source}`), ...(assignment ? { assignment } : {}), preserveExisting: !!note.analysis });
    }
    if (!entries.length) throw new CategoryError(400, 'These documents have manually selected categories. Change them individually to reclassify them.');
    await store.write(key, { id, registry, mode: request.mode, categoryId: request.categoryId, createdAt: new Date().toISOString(), entries } satisfies Batch);
    await send(id);
    return { id };
  });
}
// Dispatch five documents per delivery. The batch and source snapshots make retries idempotent.
export async function dispatchBatch(store: PipelineStore, id: string, send: (id: string) => Promise<void>) {
  const key = batchKey(id);
  await store.withLease(`category-batch-${id}`, async () => {
    const batch = await store.read<Batch>(key);
    if (!batch || batch.cancelled) return;
    const generations = new SourceGenerations(store);
    for (const entry of batch.entries.filter(e => !e.dispatched && !e.skipped).slice(0, 5)) {
      const template = entry.assignment ? batch.registry.categories.find(c => c.id === entry.assignment!.categoryId) : undefined;
      const advanced = await generations.dispatchBatch({ sourceId: entry.sourceId, expected: entry.expected, jobId: entry.jobId,
        categoryPlan: { registry: batch.registry, assignment: entry.assignment, template, batchId: id, preserveExisting: entry.preserveExisting } }, send);
      if (advanced) entry.dispatched = true;
      else entry.skipped = true;
      await store.write(key, batch);
    }
    if (batch.entries.some(e => !e.dispatched && !e.skipped)) await send(id);
  });
}
async function batchProgress(store: PipelineStore, batch: Batch, corpus?: ChatCorpus) {
  const entries = await Promise.all(batch.entries.map(async entry => {
    const job = await store.read<Job>(`jobs/${entry.jobId}.json`);
    const state = await store.read<SourceState>(`sources/${entry.sourceId}.json`);
    const note = corpus?.sources.find(s => s.note.source.id === entry.sourceId)?.note;
    const status = note?.generationId === entry.jobId ? 'complete' : entry.skipped || (entry.dispatched && state?.generationId !== entry.jobId) ? 'superseded' : job?.status === 'failed' ? 'failed' : job?.status === 'pending' ? 'processing' : job ? 'updating-reader' : batch.cancelled ? 'cancelled' : 'pending';
    return { sourceId: entry.sourceId, status, error: job?.error };
  }));
  return { id: batch.id, createdAt: batch.createdAt, cancelled: !!batch.cancelled, entries };
}
export async function changeBatch(store: PipelineStore, id: string, action: 'cancel' | 'retry', send: (id: string) => Promise<void>, source?: string) {
  const key = batchKey(id);
  await store.withLease(`category-batch-${id}`, async () => {
    const batch = await store.read<Batch>(key); if (!batch) throw new CategoryError(404, 'Update not found');
    if (action === 'cancel') { batch.cancelled = true; await store.write(key, batch); }
    const generations = new SourceGenerations(store);
    for (const entry of batch.entries.filter(e => !source || e.sourceId === source)) {
      if (await generations.change(entry.jobId, action, send) === 'cancelled') throw new CategoryError(409, 'Start a new update after cancelling this one');
    }
  });
  return { id };
}
export async function recoverCategoryWork(store: PipelineStore, send: (id: string) => Promise<void>) {
  for (const key of await store.list('categories/batches/')) {
    const batch = await store.read<Batch>(key);
    if (batch && !batch.cancelled && batch.entries.some(e => !e.dispatched && !e.skipped)) await send(batch.id);
  }
  for (const key of await store.list('chat/assets/category-previews/')) {
    const preview = await store.read<Preview>(key);
    if (preview?.status === 'pending' && Date.now() - Date.parse(preview.createdAt) < 24 * 60 * 60_000) await send(preview.id);
  }
}
export async function startPreview(store: PipelineStore, owner: string, source: string, input: unknown, send: (id: string) => Promise<void>) {
  const template = templateSchema.safeParse(input);
  if (!template.success || !sourceId.safeParse(source).success) throw new CategoryError(400, 'Choose a document and complete the template');
  const corpus = await deployed(store);
  const note = corpus?.sources.find(s => s.note.source.id === source)?.note;
  if (!note?.source.active) throw new CategoryError(404, 'Document not found');
  const id = 'p_' + randomUUID().replaceAll('-', '');
  await store.withLease(`category-preview-${owner}`, async () => {
    const recent = await Promise.all((await store.list('chat/assets/category-previews/')).map(key => store.read<Preview>(key)));
    if (recent.filter(p => p?.owner === owner && Date.now() - Date.parse(p.createdAt) < 60 * 60_000).length >= 20) throw new CategoryError(429, 'Preview limit reached. Try again in an hour.');
    await store.create(previewKey(id), { id, owner, sourceId: source, generationId: note.generationId, template: template.data, status: 'pending', createdAt: new Date().toISOString(), attempts: 0 } satisfies Preview);
    await send(id);
  });
  return { id };
}
export async function getPreview(store: PipelineStore, owner: string, id: string) {
  const preview = await store.read<Preview>(previewKey(id));
  if (!preview || preview.owner !== owner) throw new CategoryError(404, 'Preview not found');
  return { id, status: preview.status, result: preview.result, error: preview.error };
}
export async function processPreview(store: PipelineStore, id: string, analyze: (text: string, template: Template, signal?: AbortSignal, source?: Note['source'], images?: SourceImage[]) => Promise<TemplateAnalysis>, artifacts?: Pick<SourceArtifacts, 'readForNote'>) {
  const key = previewKey(id);
  await store.withLease(`category-preview-${id}`, async () => {
    const preview = await store.read<Preview>(key);
    if (!preview || preview.status !== 'pending') return;
    if (preview.attempts >= 3 || Date.now() - Date.parse(preview.createdAt) >= 24 * 60 * 60_000) {
      await store.write(key, { ...preview, status: 'failed', error: 'Preview expired. Start a new preview.' }); return;
    }
    preview.attempts++;
    await store.write(key, preview);
    try {
      const input = await new AnalysisInputs(store, artifacts).read(preview.sourceId, preview.generationId);
      const result = await analyze(input.text, preview.template, store.leaseSignal, input.source, input.images);
      await store.write(key, { ...preview, status: 'complete', result });
    } catch {
      store.leaseSignal?.throwIfAborted();
      await store.write(key, { ...preview, status: 'failed', error: 'Preview unavailable. Check that this document has readable text or a retained PNG, JPEG or WebP image, then try again.' });
    }
  });
}
