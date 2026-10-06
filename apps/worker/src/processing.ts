import { canonical, hash, noteSchema, type Analysis, type Note, type SourceSnapshot } from '../../../shared/corpus.js';
import { assignmentSchema, classificationSchema, registrySchema, templateSchema, type Registry, type Template, type TemplateAnalysis, type CategoryAssignment } from '../../../shared/categories.js';
import { MissingArtifact, savedMetadata, type Extracted } from './extraction.js';
import { TransientInference } from './enrichment.js';
import type { Job, PipelineStore, SourceState } from './pipeline.js';
import { sourceText } from '../../../shared/source-text.js';

export interface Processor {
  version: string; model: string;
  extract(snapshot: SourceSnapshot): Promise<Extracted>;
  enrich(text: string, signal?: AbortSignal): Promise<Analysis>;
  classify?(source: SourceSnapshot['source'], text: string, registry: Registry, signal?: AbortSignal): Promise<{ categoryId: string; reason: string }>;
  analyzeTemplate?(text: string, template: Template, signal?: AbortSignal, source?: Note['source']): Promise<TemplateAnalysis>;
  rights(doi: string | null): Promise<Note['rightsEvidence']>;
}
export async function processJob(store: PipelineStore, id: string, processor: Processor) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid job ID');
  const found = await store.read<Job>(`jobs/${id}.json`);
  if (!found) return;
  return store.withLease(`source-${found.source.id}`, async () => {
    let job = await store.read<Job>(`jobs/${id}.json`);
    const current = await store.read<SourceState>(`sources/${found.source.id}.json`);
    if (!job || job.status !== 'pending' || current?.generationId !== id || (job.retryAt && new Date(job.retryAt) > new Date())) return;
    if (job.categoryPlan?.batchId && (await store.read<{ cancelled?: boolean }>(`categories/batches/${job.categoryPlan.batchId}.json`))?.cancelled) {
      await store.write(`jobs/${id}.json`, { ...job, status: 'failed', error: 'Update cancelled. The existing note is still available.' }); return;
    }
    if (job.attempts >= 5) { await store.write(`jobs/${id}.json`, { ...job, status: 'failed', error: 'Worker retry budget exhausted; operator replay required' }); return; }
    job = { ...job, attempts: job.attempts + 1 };
    await store.write(`jobs/${id}.json`, job);
    try {
    const snapshot = await store.read<SourceSnapshot>(job.snapshotKey);
    if (!snapshot) throw new Error('Durable source snapshot is missing');
    let note = await store.read<Note>(`analysis/${id}.json`);
    if (!note) {
      let extracted: Extracted;
      try { extracted = await processor.extract(snapshot); }
      catch (error) {
        store.leaseSignal?.throwIfAborted();
        if (error instanceof MissingArtifact && job.attempts < 4) {
          await store.write(`jobs/${id}.json`, { ...job, retryAt: new Date(Date.now() + 5 * 60_000).toISOString(), error: 'Waiting for cloud file sync' }); return;
        }
        extracted = savedMetadata(snapshot, { status: 'needs-review', method: 'none', reason: 'Source extraction unavailable; review or replay this capture.', truncated: false, retrievedAt: new Date().toISOString(), artifactHash: null });
      }
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
          const cacheKey = `categories/classifications/${hash(canonical({ fingerprint: snapshot.source.fingerprint, routing, version: processor.version, model: processor.model }))}.json`;
          let classified = await store.read<{ categoryId: string; reason: string }>(cacheKey);
          if (!classified) {
            if (!processor.classify) throw new Error('Category classification is not configured');
            classified = await processor.classify(snapshot.source, extracted.text, registry, store.leaseSignal);
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
        if ((await store.read<SourceState>(`sources/${snapshot.source.id}.json`))?.generationId !== id) return;
        await store.write(`categories/assignments/${snapshot.source.id}.json`, assignment);
      }
      if (extracted.text) {
        await store.create(`source-text/${id}.json`, sourceText({ source: snapshot.source, generationId: id, extraction: extracted.evidence }, extracted.text));
        try { analysis = template ? await processor.analyzeTemplate!(extracted.text, template, store.leaseSignal, snapshot.source) : await processor.enrich(extracted.text, store.leaseSignal); }
        catch (error) {
          store.leaseSignal?.throwIfAborted();
          if (error instanceof TransientInference && job.attempts < 3) {
            await store.write(`jobs/${id}.json`, { ...job, retryAt: new Date(Date.now() + 10 * 60_000).toISOString(), error: 'Transient inference failure' });
            return;
          }
          extracted.evidence.status = 'needs-review'; extracted.evidence.reason = 'Machine analysis unavailable or invalid; source retained privately for reprocessing.';
        }
      }
      if (job.categoryPlan?.preserveExisting && !analysis) {
        await store.write(`jobs/${id}.json`, { ...job, status: 'failed', error: 'Analysis could not be generated. The existing note is still available. Retry this document.' }); return;
      }
      note = noteSchema.parse({ schemaVersion: category ? 2 : 1, ...(category ? { category } : {}), generationId: id, source: snapshot.source, extraction: extracted.evidence, analysis,
        processing: { version: processor.version, model: extracted.text ? processor.model : null, processedAt: new Date().toISOString() },
        rightsEvidence: await processor.rights(snapshot.source.doi) });
      await store.create(`analysis/${id}.json`, note);
    }
    const desired = await store.read<SourceState>(`sources/${found.source.id}.json`);
    if (desired?.generationId !== id) return;
    await store.create(`staged/${id}.json`, noteSchema.parse(note));
    await store.write(`jobs/${id}.json`, { ...job, status: 'staged', retryAt: undefined, error: undefined });
    } catch (error) {
      await store.write(`jobs/${id}.json`, { ...job, status: job.attempts >= 5 ? 'failed' : 'pending',
        retryAt: new Date(Date.now() + 5 * 60_000).toISOString(), error: 'Worker failed; source snapshot retained for operator recovery' });
      throw error;
    }
  });
}
