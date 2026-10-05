import { noteSchema, type Analysis, type Note, type SourceSnapshot } from '../../../shared/corpus.js';
import { MissingArtifact, type Extracted } from './extraction.js';
import { TransientInference } from './enrichment.js';
import type { Job, PipelineStore, SourceState } from './pipeline.js';

export interface Processor {
  version: string; model: string;
  extract(snapshot: SourceSnapshot): Promise<Extracted>;
  enrich(text: string, signal?: AbortSignal): Promise<Analysis>;
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
        extracted = { text: '', evidence: { status: 'needs-review', method: 'none', reason: 'Source extraction unavailable; review or replay this capture.', truncated: false, retrievedAt: new Date().toISOString(), artifactHash: null } };
      }
      let analysis: Analysis | null = null;
      if (extracted.text) {
        try { analysis = await processor.enrich(extracted.text, store.leaseSignal); }
        catch (error) {
          store.leaseSignal?.throwIfAborted();
          if (error instanceof TransientInference && job.attempts < 3) {
            await store.write(`jobs/${id}.json`, { ...job, retryAt: new Date(Date.now() + 10 * 60_000).toISOString(), error: 'Transient inference failure' });
            return;
          }
          extracted.evidence.status = 'needs-review'; extracted.evidence.reason = 'Machine analysis unavailable or invalid; source retained privately for reprocessing.';
        }
      }
      note = noteSchema.parse({ schemaVersion: 1, generationId: id, source: snapshot.source, extraction: extracted.evidence, analysis,
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
