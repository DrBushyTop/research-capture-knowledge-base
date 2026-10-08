import { sourceId, type Note } from '../../../shared/corpus.js';
import { activeSourceLifecycle, sourceLifecycleSchema, type SourceLifecycle, type SourceLifecycleAction } from '../../../shared/source-lifecycle.js';
import type { PipelineStore, SourceState } from './source-generations.js';

export const lifecycleKey = (id: string) => `source-lifecycle/${sourceId.parse(id)}.json`;
export class SourceAccessError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export async function sourceLifecycle(store: Pick<PipelineStore, 'read'>, id: string) {
  return sourceLifecycleSchema.parse(await store.read(lifecycleKey(id)) ?? activeSourceLifecycle(id));
}
export async function requireSourceState(store: Pick<PipelineStore, 'read'>, id: string, retained = false) {
  const lifecycle = await sourceLifecycle(store, id);
  if (lifecycle.state !== 'active' && !(retained && lifecycle.state === 'trashed'))
    throw new SourceAccessError(410, lifecycle.state === 'trashed' ? 'This source is in Trash. Restore it to continue.' : 'This source was permanently deleted.');
  return lifecycle;
}
export async function sourceLifecycles(store: Pick<PipelineStore, 'read' | 'list'>) {
  const result: Record<string, SourceLifecycle> = {};
  for (const key of await store.list('source-lifecycle/')) {
    const value = sourceLifecycleSchema.parse(await store.read(key));
    result[value.sourceId] = value;
  }
  return result;
}

export interface LifecycleStore extends PipelineStore {
  retainedSource?(id: string): Promise<{ note: Note; humanMarkdown: string } | undefined>;
  remove?(key: string): Promise<void>;
  removeSource?(id: string): Promise<void>;
  purgeSourceContent?(id: string): Promise<void>;
}
export class SourceLifecycleService {
  constructor(private readonly store: LifecycleStore) {}
  async change(id: string, action: SourceLifecycleAction, revision: number, actor: string) {
    sourceId.parse(id);
    return this.store.withLease(`lifecycle-${id}`, async () => {
      const current = await sourceLifecycle(this.store, id);
      if (current.revision !== revision) throw new SourceAccessError(409, 'This source was changed in another session. Reload and try again.');
      const next = action === 'trash' && current.state === 'active' ? 'trashed'
        : action === 'restore' && current.state === 'trashed' ? 'active'
        : action === 'purge' && current.state === 'trashed' ? 'purging'
        : action === 'retry' && current.state === 'purging' ? 'purging' : undefined;
      if (!next) throw new SourceAccessError(409, 'This action is no longer available.');
      const saved = await this.store.retainedSource?.(id);
      const state = await this.store.read<SourceState>(`sources/${id}.json`);
      if (current.state === 'active' && !saved && !state) throw new SourceAccessError(404, 'Unknown source');
      // Restore the last readable publication, rather than a half-finished update.
      if (action === 'restore' && saved && state)
        await this.store.write(`sources/${id}.json`, { ...state, generationId: saved.note.generationId, source: saved.note.source, processingVersion: saved.note.processing.version });
      if (action === 'restore' && !saved && state) await this.store.write(`sources/${id}.json`, { ...state, processingVersion: undefined });
      const updated: SourceLifecycle = { sourceId: id, state: next, revision: revision + 1, changedAt: new Date().toISOString(), changedBy: actor, error: null };
      await this.store.write(lifecycleKey(id), updated);
      return updated;
    });
  }
  async cleanup(id: string) {
    if ((await sourceLifecycle(this.store, id)).state !== 'purging') return;
    try {
      await this.store.withLease(`purge-${id}`, () => this.store.withLease(`source-${id}`, async () => {
        if ((await sourceLifecycle(this.store, id)).state !== 'purging') return;
        if (!this.store.purgeSourceContent) throw new Error('Source cleanup is unavailable');
        await this.store.purgeSourceContent(id);
        await this.store.withLease(`lifecycle-${id}`, async () => {
          const current = await sourceLifecycle(this.store, id);
          if (current.state === 'purging') await this.store.write(lifecycleKey(id), { ...current, state: 'deleted', revision: current.revision + 1, error: null });
        });
      }));
    } catch (error) {
      // Busy processing leases are transient. The durable state already revokes access.
      if ((error as { number?: number }).number === 51003) return;
      await this.store.withLease(`lifecycle-${id}`, async () => {
        const current = await sourceLifecycle(this.store, id);
        if (current.state === 'purging') await this.store.write(lifecycleKey(id), { ...current, error: 'Cleanup failed. Retry to finish deleting the retained files.', revision: current.revision + 1 });
      });
    }
  }
  async recover() {
    for (const value of Object.values(await sourceLifecycles(this.store)))
      if (value.state === 'purging' && !value.error) await this.cleanup(value.sourceId);
  }
}
