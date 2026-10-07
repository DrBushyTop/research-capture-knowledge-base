import { AsyncLocalStorage } from 'node:async_hooks';
import type { PipelineStore } from '../apps/worker/src/pipeline.js';
import type { Note } from '../shared/corpus.js';

type Frame = { key: string; owner: symbol; controller: AbortController; revisions: Map<string, number | undefined>; parent?: Frame };
type Operation = 'create' | 'write';

// This adapter models the record revisions and nested lease guards used by SqlStore.
// Each operation commits separately so tests can interrupt the actual recovery seams.
export class GenerationStore implements PipelineStore {
  private records = new Map<string, { value: unknown; revision: number }>();
  private leases = new Map<string, Frame>();
  private frames = new AsyncLocalStorage<Frame>();
  private hooks = new Map<string, () => Promise<void>>();
  readonly published = new Map<string, Note>();
  publications = 0;

  get leaseSignal() {
    const signals: AbortSignal[] = [];
    for (let frame = this.frames.getStore(); frame; frame = frame.parent) signals.push(frame.controller.signal);
    return signals.length ? AbortSignal.any(signals) : undefined;
  }
  private verify() {
    for (let frame = this.frames.getStore(); frame; frame = frame.parent) {
      frame.controller.signal.throwIfAborted();
      if (this.leases.get(frame.key)?.owner !== frame.owner) throw new Error('Lease lost');
    }
  }
  private async hook(operation: Operation, key: string, phase: 'before' | 'after') {
    const name = `${operation}:${key}:${phase}`;
    const hook = this.hooks.get(name);
    if (hook) { this.hooks.delete(name); await hook(); }
  }
  interrupt(operation: Operation, key: string, phase: 'before' | 'after' = 'after') {
    this.hooks.set(`${operation}:${key}:${phase}`, async () => { throw new Error('Interrupted write'); });
  }
  pause(operation: Operation, key: string, phase: 'before' | 'after' = 'after') {
    let entered!: () => void;
    let resume!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const released = new Promise<void>(resolve => { resume = resolve; });
    this.hooks.set(`${operation}:${key}:${phase}`, async () => { entered(); await released; });
    return { reached, resume };
  }
  loseLease(key: string) {
    const frame = this.leases.get(key);
    if (!frame) throw new Error('No lease to expire');
    frame.controller.abort(new Error('Lease lost'));
    this.leases.delete(key);
  }
  seed(key: string, value: unknown) {
    this.records.set(key, { value: structuredClone(value), revision: (this.records.get(key)?.revision || 0) + 1 });
  }
  async read<T>(key: string): Promise<T | undefined> {
    const record = this.records.get(key);
    this.frames.getStore()?.revisions.set(key, record?.revision);
    return record ? structuredClone(record.value) as T : undefined;
  }
  async write(key: string, value: unknown) {
    const frame = this.frames.getStore();
    if (!frame) throw new Error('Mutable writes require a lease');
    if (!frame.revisions.has(key)) await this.read(key);
    await this.hook('write', key, 'before');
    this.verify();
    if (frame.revisions.get(key) !== this.records.get(key)?.revision) throw new Error('Stale record revision');
    this.seed(key, value);
    frame.revisions.set(key, this.records.get(key)!.revision);
    await this.hook('write', key, 'after');
  }
  async create(key: string, value: unknown) {
    await this.hook('create', key, 'before');
    this.verify();
    if (!this.records.has(key)) this.seed(key, value);
    await this.hook('create', key, 'after');
  }
  async list(prefix: string) { return [...this.records.keys()].filter(key => key.startsWith(prefix)).sort(); }
  async withLease<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (this.leases.has(key)) throw new Error('Lease busy');
    const frame: Frame = { key, owner: Symbol(key), controller: new AbortController(), revisions: new Map(), parent: this.frames.getStore() };
    this.leases.set(key, frame);
    try {
      return await this.frames.run(frame, async () => { const result = await fn(); this.verify(); return result; });
    } finally {
      frame.controller.abort(new Error('Lease released'));
      if (this.leases.get(key)?.owner === frame.owner) this.leases.delete(key);
    }
  }
  async publishNote(note: Note) {
    if (!this.frames.getStore()) throw new Error('Publication requires a lease');
    this.verify();
    this.published.set(note.source.id, structuredClone(note));
    this.publications++;
  }
}
