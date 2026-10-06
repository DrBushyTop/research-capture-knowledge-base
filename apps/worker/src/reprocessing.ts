import { hash, processingVersion, sourceId, type SourceSnapshot } from '../../../shared/corpus.js';
import type { CategoryAssignment } from '../../../shared/categories.js';
import { categoryRegistry } from './category-registry.js';
import type { Job, PipelineStore, SourceState } from './pipeline.js';

export async function reprocessSource(store: PipelineStore, id: string, send: (id: string) => Promise<void>, version = processingVersion) {
  sourceId.parse(id);
  const registry = await categoryRegistry(store);
  return store.withLease('poll', () => store.withLease(`source-${id}`, async () => {
    const current = await store.read<SourceState>(`sources/${id}.json`);
    if (!current?.source.active) throw new Error('Unknown or inactive source');
    const snapshot = await store.read<SourceSnapshot>(`snapshots/${current.generationId}.json`);
    if (!snapshot) throw new Error('Missing source snapshot');
    const assignment = await store.read<CategoryAssignment>(`categories/assignments/${id}.json`);
    const generationId = hash(`${id}:${snapshot.source.fingerprint}:${crypto.randomUUID()}:manual-reprocess`);
    const snapshotKey = `snapshots/${generationId}.json`;
    await store.create(snapshotKey, snapshot);
    await store.create(`jobs/${generationId}.json`, {
      id: generationId, source: snapshot.source, snapshotKey, status: 'pending', attempts: 0,
      observedAt: new Date().toISOString(),
      categoryPlan: { registry, preserveExisting: true, ...(assignment?.method === 'manual' ? { assignment } : {}) }
    } satisfies Job);
    await store.write(`sources/${id}.json`, { ...current, generationId, processingVersion: version });
    await send(generationId);
    return generationId;
  }));
}
