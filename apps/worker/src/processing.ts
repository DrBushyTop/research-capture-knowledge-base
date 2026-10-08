import { canonical, hash, noteSchema, type Analysis, type Note, type SourceSnapshot } from '../../../shared/corpus.js';
import { assignmentSchema, classificationSchema, registrySchema, templateSchema, type Registry, type Template, type TemplateAnalysis, type CategoryAssignment } from '../../../shared/categories.js';
import { MissingArtifact, savedMetadata, type Extracted } from './extraction.js';
import { TransientInference } from './enrichment.js';
import { SourceGenerations, type Job, type PipelineStore } from './source-generations.js';
import { AnalysisInputs } from './analysis-input.js';
import type { SourceImage } from './image-input.js';

export interface Processor {
  version: string; model: string;
  extract(snapshot: SourceSnapshot, generationId?: string): Promise<Extracted>;
  enrich(text: string, signal?: AbortSignal, images?: SourceImage[]): Promise<Analysis>;
  classify?(source: SourceSnapshot['source'], text: string, registry: Registry, signal?: AbortSignal, images?: SourceImage[]): Promise<{ categoryId: string; reason: string }>;
  analyzeTemplate?(text: string, template: Template, signal?: AbortSignal, source?: Note['source'], images?: SourceImage[]): Promise<TemplateAnalysis>;
  rights(doi: string | null): Promise<Note['rightsEvidence']>;
}
export async function processJob(store: PipelineStore, id: string, processor: Processor) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid job ID');
  const found = await store.read<Job>(`jobs/${id}.json`);
  if (!found) return;
  const generations = new SourceGenerations(store);
  return store.withLease(`source-${found.source.id}`, async () => {
    let job = await store.read<Job>(`jobs/${id}.json`);
    if (!job || job.status !== 'pending' || !await generations.canProcess(job) || (job.retryAt && new Date(job.retryAt) > new Date())) return;
    if (job.attempts >= 5) { await store.write(`jobs/${id}.json`, { ...job, status: 'failed', error: 'Worker retry budget exhausted; operator replay required' }); return; }
    job = { ...job, attempts: job.attempts + 1 };
    await store.write(`jobs/${id}.json`, job);
    try {
    const snapshot = await store.read<SourceSnapshot>(job.snapshotKey);
    if (!snapshot) throw new Error('Durable source snapshot is missing');
    let note = await store.read<Note>(`analysis/${id}.json`);
    if (!note) {
      let extracted: Extracted;
      try { extracted = await processor.extract(snapshot, id); }
      catch (error) {
        store.leaseSignal?.throwIfAborted();
        if (error instanceof MissingArtifact && job.attempts < 4) {
          await store.write(`jobs/${id}.json`, { ...job, retryAt: new Date(Date.now() + 5 * 60_000).toISOString(), error: 'Waiting for cloud file sync' }); return;
        }
        extracted = savedMetadata(snapshot, { status: 'needs-review', method: 'none', reason: 'Source extraction unavailable; review or replay this capture.', truncated: false, retrievedAt: new Date().toISOString(), artifactHash: null });
      }
      if (!await generations.canProcess(job)) return;
      const input = await new AnalysisInputs(store).retain({ source: snapshot.source, generationId: id, extraction: extracted.evidence }, extracted);
      let analysis: Analysis | TemplateAnalysis | null = null;
      let category: Extract<Note, { schemaVersion: 2 }>['category'] | undefined;
      let template: Template | undefined;
      if (job.categoryPlan) {
        const plan = job.categoryPlan;
        const registry = registrySchema.parse(plan.registry);
        let assignment = plan.assignment ? assignmentSchema.parse(plan.assignment) : undefined;
        if (!assignment && !snapshot.source.active) {
          const previous = await store.read<CategoryAssignment>(`categories/assignments/${snapshot.source.id}.json`);
          assignment = previous ? assignmentSchema.parse(previous) : { categoryId: 'other', revision: 1, method: 'automatic', reason: 'Source removed from the library' };
        }
        if (!assignment) {
          const routing = registry.categories.filter(category => !category.archived).map(({ id, name, description }) => ({ id, name, description }));
          const cacheKey = `categories/classifications/${hash(canonical({ fingerprint: snapshot.source.fingerprint, routing, version: processor.version, model: processor.model,
            textHash: hash(input.text), images: input.images?.map(image => hash(image.bytes)) || [] }))}.json`;
          let classified = await store.read<{ categoryId: string; reason: string }>(cacheKey);
          if (!classified) {
            if (!processor.classify) throw new Error('Category classification is not configured');
            if (!await generations.canProcess(job)) return;
            classified = await processor.classify(snapshot.source, input.text, registry, store.leaseSignal, input.images);
            if (!registry.categories.some(category => category.id === classified!.categoryId && !category.archived)) throw new Error('Invalid category classification');
            await store.create(cacheKey, classified);
          }
          classified = classificationSchema.parse(classified);
          if (!registry.categories.some(category => category.id === classified!.categoryId && !category.archived)) throw new Error('Invalid category classification');
          const previous = await store.read<CategoryAssignment>(`categories/assignments/${snapshot.source.id}.json`);
          assignment = assignmentSchema.parse({ ...classified, method: 'automatic', revision: (previous?.revision || 0) + 1 });
        }
        const selected = plan.template || registry.categories.find(category => category.id === assignment!.categoryId);
        if (!selected) throw new Error('Assigned category is unavailable');
        template = templateSchema.parse(selected);
        if (template.id !== assignment.categoryId) throw new Error('Template does not match assigned category');
        category = { id: template.id, name: template.name, templateRevision: template.revision, assignmentRevision: assignment.revision, assignment: assignment.method, reason: assignment.reason };
        // A late classifier cannot replace an admin's newer assignment.
        if (!await generations.canProcess(job)) return;
        await store.write(`categories/assignments/${snapshot.source.id}.json`, assignment);
      }
      if (input.available) {
        if (!await generations.canProcess(job)) return;
        try { analysis = template ? await processor.analyzeTemplate!(input.text, template, store.leaseSignal, snapshot.source, input.images) : await processor.enrich(input.text, store.leaseSignal, input.images); }
        catch (error) {
          store.leaseSignal?.throwIfAborted();
          if (error instanceof TransientInference && job.attempts < 3) {
            await store.write(`jobs/${id}.json`, { ...job, retryAt: new Date(Date.now() + 10 * 60_000).toISOString(), error: 'Transient inference failure' });
            return;
          }
          input.extraction.status = 'needs-review'; input.extraction.reason = 'Machine analysis unavailable or invalid; source retained privately for reprocessing.';
        }
      }
      if (job.categoryPlan?.preserveExisting && !analysis) {
        await store.write(`jobs/${id}.json`, { ...job, status: 'failed', error: 'Analysis could not be generated. The existing note is still available. Retry this document.' }); return;
      }
      note = noteSchema.parse({ schemaVersion: category ? 2 : 1, ...(category ? { category } : {}), generationId: id, source: snapshot.source, extraction: input.extraction, analysis,
        processing: { version: processor.version, model: input.available ? processor.model : null, processedAt: new Date().toISOString() },
        rightsEvidence: await processor.rights(snapshot.source.doi) });
      await store.create(`analysis/${id}.json`, note);
    }
    if (!await generations.canProcess(job)) return;
    await store.create(`staged/${id}.json`, noteSchema.parse(note));
    if (store.publishNote) {
      if (!await generations.canProcess(job)) return;
      await store.publishNote(note);
    }
    await store.write(`jobs/${id}.json`, { ...job, status: store.publishNote ? 'imported' : 'staged', retryAt: undefined, error: undefined });
    } catch (error) {
      await store.write(`jobs/${id}.json`, { ...job, status: job.attempts >= 5 ? 'failed' : 'pending',
        retryAt: new Date(Date.now() + 5 * 60_000).toISOString(), error: 'Worker failed; source snapshot retained for operator recovery' });
      throw error;
    }
  });
}
