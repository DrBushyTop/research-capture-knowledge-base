import { canonical, hash, processingVersion, type Note, type SourceSnapshot } from '../../../shared/corpus.js';
import type { CategoryAssignment, Registry, Template } from '../../../shared/categories.js';

export interface PipelineStore {
  readonly leaseSignal?: AbortSignal;
  read<T>(key: string): Promise<T | undefined>;
  write(key: string, value: unknown): Promise<void>;
  create(key: string, value: unknown): Promise<void>;
  list(prefix: string): Promise<string[]>;
  withLease<T>(key: string, fn: () => Promise<T>): Promise<T>;
  publishNote?(note: Note): Promise<void>;
}
export interface CategoryPlan { registry: Registry; assignment?: CategoryAssignment; template?: Template; batchId?: string; preserveExisting?: boolean; }
export interface Job { id: string; source: SourceSnapshot['source']; snapshotKey: string; status: 'pending' | 'staged' | 'imported' | 'failed'; attempts: number; dispatches?: number; observedAt: string; lastQueuedAt?: string; error?: string; retryAt?: string; categoryPlan?: CategoryPlan; }
export interface SourceState { generationId: string; source: SourceSnapshot['source']; processingVersion?: string; }
type Send = (id: string) => Promise<void>;
export interface BatchGeneration { sourceId: string; expected: string; jobId: string; categoryPlan: CategoryPlan; }

const jobKey = (id: string) => `jobs/${id}.json`;
const stateKey = (id: string) => `sources/${id}.json`;
const assignmentKey = (id: string) => `categories/assignments/${id}.json`;
const cancelledError = 'Update cancelled. The existing note is still available.';

// Every source transition uses the same lease as processing and publication.
// Records precede the current generation. Recovery never adopts orphan records.
export class SourceGenerations {
  constructor(private readonly store: PipelineStore) {}

  async observe(snapshot: SourceSnapshot, version: string, registry?: Registry) {
    const observed = await this.store.read<SourceState>(stateKey(snapshot.source.id));
    if (observed?.source.fingerprint === snapshot.source.fingerprint && observed.processingVersion === version) return;
    return this.store.withLease(`source-${snapshot.source.id}`, async () => {
      const current = await this.store.read<SourceState>(stateKey(snapshot.source.id));
      if (current?.source.fingerprint === snapshot.source.fingerprint && current.processingVersion === version) return;
      const assignment = registry ? await this.store.read<CategoryAssignment>(assignmentKey(snapshot.source.id)) : undefined;
      const manual = assignment?.method === 'manual' ? assignment : undefined;
      const id = hash(`${snapshot.source.id}:${snapshot.source.fingerprint}:${version}:${registry ? canonical({ registry, manual }) : 'legacy'}`);
      await this.advance(snapshot, id, version, registry ? { registry, ...(manual ? { assignment: manual } : {}) } : undefined);
      return id;
    });
  }

  async reprocess(source: string, registry: Registry, version: string, send: Send) {
    return this.store.withLease(`source-${source}`, async () => {
      const current = await this.store.read<SourceState>(stateKey(source));
      if (!current?.source.active) throw new Error('Unknown or inactive source');
      const snapshot = await this.store.read<SourceSnapshot>(`snapshots/${current.generationId}.json`);
      if (!snapshot) throw new Error('Missing source snapshot');
      const assignment = await this.store.read<CategoryAssignment>(assignmentKey(source));
      const id = hash(`${source}:${snapshot.source.fingerprint}:${crypto.randomUUID()}:manual-reprocess`);
      await this.advance(snapshot, id, version, { registry, preserveExisting: true, ...(assignment?.method === 'manual' ? { assignment } : {}) });
      await this.handoff(id, send, new Date());
      return id;
    });
  }

  async dispatchBatch(entry: BatchGeneration, send: Send, now = new Date()): Promise<boolean> {
    return this.store.withLease(`source-${entry.sourceId}`, async () => {
      const current = await this.store.read<SourceState>(stateKey(entry.sourceId));
      if (!current?.source.active || ![entry.expected, entry.jobId].includes(current.generationId)) return false;
      if (current.generationId !== entry.jobId) {
        const snapshot = await this.store.read<SourceSnapshot>(`snapshots/${entry.expected}.json`);
        if (!snapshot) return false;
        const previous = await this.store.read<CategoryAssignment>(assignmentKey(entry.sourceId));
        const assignment = entry.categoryPlan.assignment;
        // Planning cannot overwrite a manual choice made after the batch was saved.
        if (previous?.method === 'manual') {
          if (!assignment || assignment.method !== 'manual') return false;
          if (assignment.revision <= previous.revision && canonical(assignment) !== canonical(previous)) return false;
        }
        await this.create(snapshot, entry.jobId, entry.categoryPlan);
        if (assignment) await this.store.write(assignmentKey(entry.sourceId), assignment);
        await this.store.write(stateKey(entry.sourceId), { ...current, generationId: entry.jobId, processingVersion: current.processingVersion || processingVersion } satisfies SourceState);
      }
      // A resumed entry must not recreate its job, reset budgets or restore an old assignment.
      await this.handoff(entry.jobId, send, now);
      return true;
    });
  }

  async recover(send: Send, now = new Date()) {
    for (const key of await this.store.list('jobs/')) {
      const job = await this.store.read<Job>(key);
      if (!job || job.status !== 'pending') continue;
      const current = await this.store.read<SourceState>(stateKey(job.source.id));
      if (current?.generationId !== job.id) continue;
      if (!this.due(job, now) && !await this.cancelled(job)) continue;
      await this.store.withLease(`source-${job.source.id}`, () => this.handoff(job.id, send, now));
    }
  }

  async change(id: string, action: 'cancel' | 'retry', send: Send) {
    const found = await this.store.read<Job>(jobKey(id));
    if (!found) return;
    return this.store.withLease(`source-${found.source.id}`, async () => {
      const job = await this.store.read<Job>(jobKey(id));
      const current = await this.store.read<SourceState>(stateKey(found.source.id));
      if (!job || current?.generationId !== id) return;
      if (action === 'cancel' && job.status === 'pending') {
        await this.store.write(jobKey(id), { ...job, status: 'failed', error: cancelledError });
      } else if (action === 'retry' && job.status === 'failed') {
        if (await this.cancelled(job)) return 'cancelled';
        await this.store.write(jobKey(id), { ...job, status: 'pending', attempts: 0, dispatches: 0, lastQueuedAt: undefined, retryAt: undefined, error: undefined });
        await this.handoff(id, send, new Date());
      }
    });
  }

  // Processing already owns the source lease. Recheck before paid work and publication.
  async canProcess(job: Job): Promise<boolean> {
    this.store.leaseSignal?.throwIfAborted();
    const current = await this.store.read<SourceState>(stateKey(job.source.id));
    if (current?.generationId !== job.id) return false;
    if (await this.cancelled(job)) {
      await this.store.write(jobKey(job.id), { ...job, status: 'failed', error: cancelledError });
      return false;
    }
    this.store.leaseSignal?.throwIfAborted();
    return true;
  }

  private async cancelled(job: Job) {
    return !!job.categoryPlan?.batchId && !!(await this.store.read<{ cancelled?: boolean }>(`categories/batches/${job.categoryPlan.batchId}.json`))?.cancelled;
  }
  private async create(snapshot: SourceSnapshot, id: string, categoryPlan?: CategoryPlan) {
    const snapshotKey = `snapshots/${id}.json`;
    await this.store.create(snapshotKey, snapshot);
    await this.store.create(jobKey(id), { id, source: snapshot.source, snapshotKey, status: 'pending', attempts: 0, observedAt: new Date().toISOString(), ...(categoryPlan ? { categoryPlan } : {}) } satisfies Job);
  }
  private async advance(snapshot: SourceSnapshot, id: string, version: string, categoryPlan?: CategoryPlan) {
    await this.create(snapshot, id, categoryPlan);
    await this.store.write(stateKey(snapshot.source.id), { generationId: id, source: snapshot.source, processingVersion: version } satisfies SourceState);
  }
  private async handoff(id: string, send: Send, now: Date) {
    const job = await this.store.read<Job>(jobKey(id));
    if (!job || job.status !== 'pending' || !await this.canProcess(job)) return;
    if (!this.due(job, now)) return;
    if ((job.dispatches || 0) >= 20 || job.attempts >= 5) {
      await this.store.write(jobKey(id), { ...job, status: 'failed', error: 'Automatic recovery budget exhausted; operator replay required' });
      return;
    }
    const queued = { ...job, dispatches: (job.dispatches || 0) + 1, lastQueuedAt: now.toISOString() };
    await this.store.write(jobKey(id), queued);
    this.store.leaseSignal?.throwIfAborted();
    try { await send(id); }
    catch (error) {
      // A rejected handoff can retry immediately, but still consumes its durable budget.
      await this.store.write(jobKey(id), { ...queued, lastQueuedAt: undefined });
      throw error;
    }
  }
  private due(job: Job, now: Date) {
    return !(job.retryAt && new Date(job.retryAt) > now)
      && !(job.lastQueuedAt && now.getTime() - new Date(job.lastQueuedAt).getTime() < 10 * 60_000);
  }
}
