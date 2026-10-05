import { canonical, hash, normalize, type LibrarySnapshot, type SourceSnapshot } from '../../../shared/corpus.js';

export interface PipelineStore {
  readonly leaseSignal?: AbortSignal;
  read<T>(key: string): Promise<T | undefined>;
  write(key: string, value: unknown): Promise<void>;
  create(key: string, value: unknown): Promise<void>;
  list(prefix: string): Promise<string[]>;
  withLease<T>(key: string, fn: () => Promise<T>): Promise<T>;
}
export interface Job { id: string; source: SourceSnapshot['source']; snapshotKey: string; status: 'pending' | 'staged' | 'imported' | 'failed'; attempts: number; dispatches?: number; observedAt: string; lastQueuedAt?: string; error?: string; retryAt?: string; }
export interface SourceState { generationId: string; source: SourceSnapshot['source']; processingVersion?: string; }
export async function discover(store: PipelineStore, library: LibrarySnapshot, version: string, collection?: string) {
  return store.withLease('poll', async () => {
    const checkpoint = await store.read<{ libraryVersion: number }>('checkpoint.json');
    if (checkpoint && library.version < checkpoint.libraryVersion) return;
    const snapshots = normalize(library).filter(s => !collection || (s.root.data.collections as string[] | undefined)?.includes(collection));
    const seen = new Set(snapshots.map(s => s.source.id));
    for (const key of await store.list('sources/')) {
      const current = await store.read<SourceState>(key);
      if (current?.source.active && !seen.has(current.source.id)) {
        const snapshot = await store.read<SourceSnapshot>(`snapshots/${current.generationId}.json`);
        if (snapshot) snapshots.push({ ...snapshot, source: { ...snapshot.source, active: false, fingerprint: hash(canonical({ previous: snapshot.source.fingerprint, deleted: library.version })) } });
      }
    }
    for (const snapshot of snapshots) {
      const id = hash(`${snapshot.source.id}:${snapshot.source.fingerprint}:${version}`);
      const current = await store.read<SourceState>(`sources/${snapshot.source.id}.json`);
      if (current?.source.fingerprint === snapshot.source.fingerprint && current.processingVersion === version) continue;
      const snapshotKey = `snapshots/${id}.json`;
      await store.create(snapshotKey, snapshot);
      await store.create(`jobs/${id}.json`, { id, source: snapshot.source, snapshotKey, status: 'pending', attempts: 0, observedAt: new Date().toISOString() } satisfies Job);
      await store.write(`sources/${snapshot.source.id}.json`, { generationId: id, source: snapshot.source, processingVersion: version } satisfies SourceState);
    }
    await store.write('checkpoint.json', { libraryVersion: library.version, processingVersion: version, observedAt: new Date().toISOString() });
  });
}
export async function reconcile(store: PipelineStore, send: (id: string) => Promise<void>, now = new Date()) {
  for (const key of await store.list('jobs/')) {
    const job = await store.read<Job>(key);
    if (!job || job.status !== 'pending' || (job.retryAt && new Date(job.retryAt) > now)) continue;
    const desired = await store.read<SourceState>(`sources/${job.source.id}.json`);
    if (desired?.generationId !== job.id) continue;
    if (job.lastQueuedAt && now.getTime() - new Date(job.lastQueuedAt).getTime() < 10 * 60_000) continue;
    // Persist the handoff budget before sending, including crashes before worker startup.
    await store.withLease(`source-${job.source.id}`, async () => {
      const latest = await store.read<Job>(key);
      const current = await store.read<SourceState>(`sources/${job.source.id}.json`);
      if (!latest || latest.status !== 'pending' || current?.generationId !== latest.id || (latest.retryAt && new Date(latest.retryAt) > now)) return;
      if (latest.lastQueuedAt && now.getTime() - new Date(latest.lastQueuedAt).getTime() < 10 * 60_000) return;
      if ((latest.dispatches || 0) >= 20 || latest.attempts >= 5) {
        await store.write(key, { ...latest, status: 'failed', error: 'Automatic recovery budget exhausted; operator replay required' }); return;
      }
      await store.write(key, { ...latest, dispatches: (latest.dispatches || 0) + 1, lastQueuedAt: now.toISOString() });
      try { await send(job.id); }
      catch (error) {
        await store.write(key, { ...latest, dispatches: (latest.dispatches || 0) + 1, lastQueuedAt: undefined });
        throw error;
      }
    });
  }
}
