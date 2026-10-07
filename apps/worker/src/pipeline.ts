import { normalize, type LibrarySnapshot } from '../../../shared/corpus.js';
import type { Registry } from '../../../shared/categories.js';
import { SourceGenerations, type PipelineStore } from './source-generations.js';
export type { PipelineStore, CategoryPlan, Job, SourceState } from './source-generations.js';
export async function discover(store: PipelineStore, library: LibrarySnapshot, version: string, collection?: string, registry?: Registry) {
  return store.withLease('poll', async () => {
    const checkpoint = await store.read<{ libraryVersion: number }>('checkpoint.json');
    if (checkpoint && library.version < checkpoint.libraryVersion) return;
    const snapshots = normalize(library).filter(s => !collection || (s.root.data.collections as string[] | undefined)?.includes(collection));
    // Zotero transports captures. Its trash, deletions and collection membership do not delete app sources.
    const generations = new SourceGenerations(store);
    for (const snapshot of snapshots) await generations.observe(snapshot, version, registry);
    await store.write('checkpoint.json', { libraryVersion: library.version, processingVersion: version, observedAt: new Date().toISOString() });
  });
}
export async function reconcile(store: PipelineStore, send: (id: string) => Promise<void>, now = new Date()) {
  await new SourceGenerations(store).recover(send, now);
}
