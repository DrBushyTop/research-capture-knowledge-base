import { expect, it, vi } from 'vitest';
import { discover, reconcile, type Job, type SourceState } from '../apps/worker/src/pipeline.js';
import { reprocessSource } from '../apps/worker/src/reprocessing.js';
import { categoryRegistry } from '../apps/worker/src/category-registry.js';
import { startBatch, dispatchBatch, changeBatch, recoverCategoryWork } from '../apps/worker/src/category-work.js';
import { processJob, type Processor } from '../apps/worker/src/processing.js';
import { canonical, hash, normalize, processingVersion } from '../shared/corpus.js';
import { presetRegistry } from '../shared/categories.js';
import { GenerationStore } from './generation-store.js';
import { snapshot } from './fixtures.js';
import { SourceGenerations } from '../apps/worker/src/source-generations.js';

const source = normalize(snapshot)[0].source;
const sourceKey = `sources/${source.id}.json`;
const processor: Processor = {
  version: '2', model: 'test',
  extract: async () => ({ text: 'Saved source text.', evidence: { status: 'text', method: 'html', reason: null, truncated: false, retrievedAt: new Date().toISOString(), artifactHash: null } }),
  enrich: async () => { throw new Error('Use the pinned template'); },
  classify: async () => ({ categoryId: 'guide', reason: 'Instructions' }),
  analyzeTemplate: async (_text, template) => ({ summary: 'Source summary', topics: [], sections: template.sections.map(s => ({ id: s.id, heading: s.heading, format: s.format, text: s.format === 'text' ? 'Source detail' : null, items: s.format === 'text' ? [] : ['Source detail'] })) }),
  rights: async () => []
};
async function captured() {
  const store = new GenerationStore();
  const registry = await categoryRegistry(store);
  await discover(store, snapshot, '2', undefined, registry);
  const state = (await store.read<SourceState>(sourceKey))!;
  await processJob(store, state.generationId, processor);
  const note = store.published.get(source.id)!;
  store.seed('chat/current.json', { revision: 'a'.repeat(64) });
  store.seed(`chat/corpora/${'a'.repeat(64)}.json`, { revision: 'a'.repeat(64), sources: [{ note, humanMarkdown: 'Keep my comments.' }] });
  store.seed(`reader-notes/${source.id}.json`, { markdown: 'Keep my reader note.' });
  store.seed('chat/conversations/owner/saved.json', { turns: ['Keep my conversation.'] });
  return { store, registry, state, note };
}
async function batch(store: GenerationStore, categoryId = 'news') {
  return startBatch(store, { requestId: crypto.randomUUID(), registryRevision: 1, mode: 'apply', categoryId, sourceIds: [source.id] }, async () => {});
}

it('discovery uses the publication lease before advancing a source', async () => {
  const { store, state } = await captured();
  const changed = structuredClone(snapshot); changed.version++; changed.items[1].version++;
  await store.withLease(`source-${source.id}`, async () => {
    await expect(discover(store, changed, '2', undefined, presetRegistry)).rejects.toThrow('Lease busy');
    expect(await store.read<SourceState>(sourceKey)).toEqual(state);
  });
  await discover(store, changed, '2', undefined, presetRegistry);
  expect((await store.read<SourceState>(sourceKey))?.generationId).not.toBe(state.generationId);
});

it('leaves an unchanged source and a recent handoff alone while its worker owns the lease', async () => {
  const { store } = await captured();
  const replay = await reprocessSource(store, source.id, async () => {});
  await store.withLease(`source-${source.id}`, async () => {
    await discover(store, snapshot, processingVersion, undefined, presetRegistry);
    await reconcile(store, async () => { throw new Error('A recent handoff must wait'); });
  });
  expect((await store.read<SourceState>(sourceKey))?.generationId).toBe(replay);
});

it('budgets manual replay handoff and recovers an outage without generating another replay', async () => {
  const { store, note } = await captured();
  await expect(reprocessSource(store, source.id, async () => { throw new Error('Queue unavailable'); })).rejects.toThrow('Queue unavailable');
  const current = (await store.read<SourceState>(sourceKey))!;
  expect(await store.read<Job>(`jobs/${current.generationId}.json`)).toMatchObject({ dispatches: 1, attempts: 0, status: 'pending' });
  const send = vi.fn(async () => {});
  await reconcile(store, send);
  expect(send).toHaveBeenCalledExactlyOnceWith(current.generationId);
  expect(store.published.get(source.id)).toEqual(note);
  expect(await store.read(`reader-notes/${source.id}.json`)).toEqual({ markdown: 'Keep my reader note.' });
  expect(await store.read('chat/conversations/owner/saved.json')).toEqual({ turns: ['Keep my conversation.'] });
  expect(await store.read(`chat/corpora/${'a'.repeat(64)}.json`)).toMatchObject({ sources: [{ humanMarkdown: 'Keep my comments.' }] });
});

it('keeps batch cancellation effective after source advancement but before progress storage', async () => {
  const { store, note } = await captured();
  const requested = await batch(store);
  store.interrupt('write', sourceKey);
  await expect(dispatchBatch(store, requested.id, async () => {})).rejects.toThrow('Interrupted write');
  const current = (await store.read<SourceState>(sourceKey))!;
  await changeBatch(store, requested.id, 'cancel', async () => {});
  expect(await store.read<Job>(`jobs/${current.generationId}.json`)).toMatchObject({ status: 'failed' });
  const send = vi.fn(async () => {});
  await reconcile(store, send);
  expect(send).not.toHaveBeenCalled();
  await processJob(store, current.generationId, { ...processor, analyzeTemplate: async () => { throw new Error('Cancelled paid work'); } });
  expect(store.published.get(source.id)).toEqual(note);
});

it('stops a batch cancelled during inference from publishing over the current note', async () => {
  const { store, note } = await captured();
  const requested = await batch(store);
  await dispatchBatch(store, requested.id, async () => {});
  const current = (await store.read<SourceState>(sourceKey))!;
  await processJob(store, current.generationId, { ...processor, analyzeTemplate: async (...args) => {
    // The batch flag commits independently, even while the worker owns its source.
    await expect(changeBatch(store, requested.id, 'cancel', async () => {})).rejects.toThrow('Lease busy');
    return processor.analyzeTemplate!(...args);
  } });
  expect(store.published.get(source.id)).toEqual(note);
  expect(await store.read<Job>(`jobs/${current.generationId}.json`)).toMatchObject({ status: 'failed' });
});

it.each([
  ['snapshot', 'before'], ['snapshot', 'after'],
  ['job', 'before'], ['job', 'after'],
  ['state', 'before'], ['state', 'after']
] as const)('recovers deterministic observation interrupted at %s %s commit', async (record, phase) => {
  const store = new GenerationStore();
  const generations = new SourceGenerations(store);
  const saved = normalize(snapshot)[0];
  const id = hash(`${source.id}:${source.fingerprint}:2:${canonical({ registry: presetRegistry, manual: undefined })}`);
  const key = record === 'snapshot' ? `snapshots/${id}.json` : record === 'job' ? `jobs/${id}.json` : sourceKey;
  store.interrupt(record === 'state' ? 'write' : 'create', key, phase);
  await expect(generations.observe(saved, '2', presetRegistry)).rejects.toThrow('Interrupted write');
  const send = vi.fn(async () => {});
  await generations.recover(send);
  expect(send).toHaveBeenCalledTimes(record === 'state' && phase === 'after' ? 1 : 0);
  await generations.observe(saved, '2', presetRegistry);
  await generations.observe(saved, '2', presetRegistry);
  await generations.recover(send);
  expect(send).toHaveBeenCalledExactlyOnceWith(id);
  expect(await store.list('snapshots/')).toHaveLength(1);
  expect(await store.read(`snapshots/${id}.json`)).toEqual(saved);
  expect(await store.list('jobs/')).toHaveLength(1);
  expect(await store.read<SourceState>(sourceKey)).toMatchObject({ generationId: id });
  expect(await store.read<Job>(`jobs/${id}.json`)).toMatchObject({ categoryPlan: { registry: presetRegistry }, dispatches: 1, attempts: 0 });
});

it('does not adopt an orphan replay and creates a fresh generation on each manual request', async () => {
  const { store, registry, state } = await captured();
  const generations = new SourceGenerations(store);
  const manual = { categoryId: 'news', revision: 2, method: 'manual', reason: 'Admin choice' } as const;
  await store.withLease(`source-${source.id}`, () => store.write(`categories/assignments/${source.id}.json`, manual));
  store.interrupt('write', sourceKey, 'before');
  const send = vi.fn(async () => {});
  await expect(generations.reprocess(source.id, registry, '2', send)).rejects.toThrow('Interrupted write');
  await generations.recover(send);
  expect(send).not.toHaveBeenCalled();
  expect((await store.read<SourceState>(sourceKey))?.generationId).toBe(state.generationId);
  const first = await generations.reprocess(source.id, registry, '2', send);
  const second = await generations.reprocess(source.id, registry, '2', send);
  expect(first).not.toBe(second);
  expect(await store.list('jobs/')).toHaveLength(4);
  expect(await store.read<Job>(`jobs/${second}.json`)).toMatchObject({ categoryPlan: { registry, assignment: manual, preserveExisting: true }, dispatches: 1 });
  const analyze = vi.fn(processor.analyzeTemplate!);
  await processJob(store, first, { ...processor, analyzeTemplate: analyze });
  expect(analyze).not.toHaveBeenCalled();
  await processJob(store, second, { ...processor, analyzeTemplate: analyze });
  await processJob(store, second, { ...processor, analyzeTemplate: analyze });
  expect(analyze).toHaveBeenCalledTimes(1);
  expect(store.published.get(source.id)).toMatchObject({ generationId: second, category: { id: 'news', assignment: 'manual' } });
});

it('recovers a crash after the handoff budget commits but before the queue sees the job', async () => {
  const store = new GenerationStore();
  const generations = new SourceGenerations(store);
  const id = (await generations.observe(normalize(snapshot)[0], '2', presetRegistry))!;
  store.interrupt('write', `jobs/${id}.json`);
  const send = vi.fn(async () => {});
  const now = new Date();
  await expect(generations.recover(send, now)).rejects.toThrow('Interrupted write');
  expect(send).not.toHaveBeenCalled();
  expect(await store.read<Job>(`jobs/${id}.json`)).toMatchObject({ dispatches: 1, lastQueuedAt: now.toISOString() });
  await generations.recover(send, now);
  expect(send).not.toHaveBeenCalled();
  await generations.recover(send, new Date(now.getTime() + 11 * 60_000));
  expect(send).toHaveBeenCalledExactlyOnceWith(id);
  expect(await store.read<Job>(`jobs/${id}.json`)).toMatchObject({ dispatches: 2 });
});

it.each([
  ['snapshot', 'before'], ['snapshot', 'after'], ['job', 'before'], ['job', 'after'],
  ['assignment', 'before'], ['assignment', 'after'], ['state', 'before'], ['state', 'after'],
  ['handoff', 'before'], ['handoff', 'after'], ['progress', 'before'], ['progress', 'after']
] as const)('resumes a batch interrupted at %s %s commit without resetting its job', async (record, phase) => {
  const { store, note } = await captured();
  const requested = await batch(store);
  const id = hash(`${requested.id}:${source.id}`);
  const key = record === 'snapshot' ? `snapshots/${id}.json` : ['job', 'handoff'].includes(record) ? `jobs/${id}.json`
    : record === 'assignment' ? `categories/assignments/${source.id}.json` : record === 'state' ? sourceKey : `categories/batches/${requested.id}.json`;
  store.interrupt(['snapshot', 'job'].includes(record) ? 'create' : 'write', key, phase);
  const send = vi.fn(async () => {});
  await expect(dispatchBatch(store, requested.id, send)).rejects.toThrow('Interrupted write');
  expect(store.published.get(source.id)).toEqual(note);
  await dispatchBatch(store, requested.id, send);
  const now = new Date(Date.now() + 11 * 60_000);
  await new SourceGenerations(store).recover(send, now);
  const before = (await store.read<Job>(`jobs/${id}.json`))!;
  expect(before.dispatches).toBeLessThanOrEqual(2);
  expect(before.categoryPlan?.template?.revision).toBe(1);
  const analyze = vi.fn(processor.analyzeTemplate!);
  await processJob(store, id, { ...processor, analyzeTemplate: analyze });
  await dispatchBatch(store, requested.id, send);
  await processJob(store, id, { ...processor, analyzeTemplate: analyze });
  expect(analyze).toHaveBeenCalledTimes(1);
  expect(await store.read<Job>(`jobs/${id}.json`)).toMatchObject({ status: 'imported', dispatches: before.dispatches, attempts: 1 });
  expect(store.published.get(source.id)?.generationId).toBe(id);
  expect(await store.read(`categories/batches/${requested.id}.json`)).toMatchObject({ entries: [{ dispatched: true }] });
});

it('resumes unsaved batch progress after the worker completes without restoring a pinned assignment', async () => {
  const { store } = await captured();
  const requested = await batch(store);
  const id = hash(`${requested.id}:${source.id}`);
  const send = vi.fn(async () => {});
  store.interrupt('write', `categories/batches/${requested.id}.json`, 'before');
  await expect(dispatchBatch(store, requested.id, send)).rejects.toThrow('Interrupted write');
  await processJob(store, id, processor);
  const newer = { categoryId: 'guide', method: 'manual', revision: 3, reason: 'New admin choice' };
  await store.withLease(`source-${source.id}`, () => store.write(`categories/assignments/${source.id}.json`, newer));
  await dispatchBatch(store, requested.id, send);
  expect(send).toHaveBeenCalledExactlyOnceWith(id);
  expect(await store.read(`categories/assignments/${source.id}.json`)).toEqual(newer);
  expect(await store.read<Job>(`jobs/${id}.json`)).toMatchObject({ attempts: 1, dispatches: 1, status: 'imported' });
});

it('skips an expected generation superseded during interrupted batch creation', async () => {
  const { store, registry } = await captured();
  const requested = await batch(store);
  const id = hash(`${requested.id}:${source.id}`);
  store.interrupt('create', `jobs/${id}.json`);
  await expect(dispatchBatch(store, requested.id, async () => {})).rejects.toThrow('Interrupted write');
  const generations = new SourceGenerations(store);
  const replay = await generations.reprocess(source.id, registry, '2', async () => {});
  const send = vi.fn(async () => {});
  await dispatchBatch(store, requested.id, send);
  await generations.recover(send);
  expect(send).not.toHaveBeenCalled();
  expect((await store.read<SourceState>(sourceKey))?.generationId).toBe(replay);
  expect(await store.read(`categories/batches/${requested.id}.json`)).toMatchObject({ entries: [{ skipped: true }] });
  const analyze = vi.fn(processor.analyzeTemplate!);
  await processJob(store, id, { ...processor, analyzeTemplate: analyze });
  expect(analyze).not.toHaveBeenCalled();
});

it('honors a manual assignment made after automatic batch planning', async () => {
  const { store, state, registry } = await captured();
  const manual = { categoryId: 'news', revision: 2, method: 'manual', reason: 'Admin choice' };
  await store.withLease(`source-${source.id}`, () => store.write(`categories/assignments/${source.id}.json`, manual));
  const send = vi.fn(async () => {});
  expect(await new SourceGenerations(store).dispatchBatch({ sourceId: source.id, expected: state.generationId, jobId: 'c'.repeat(64), categoryPlan: { registry } }, send)).toBe(false);
  expect(send).not.toHaveBeenCalled();
  expect(await store.list('jobs/')).toHaveLength(1);
  expect(await store.read(`categories/assignments/${source.id}.json`)).toEqual(manual);
});

it('bounds repeated queue outages and resets budgets only on an explicit retry', async () => {
  const { store, note } = await captured();
  const requested = await batch(store);
  const id = hash(`${requested.id}:${source.id}`);
  const fail = async () => { throw new Error('Queue unavailable'); };
  await expect(dispatchBatch(store, requested.id, fail)).rejects.toThrow('Queue unavailable');
  const generations = new SourceGenerations(store);
  for (let attempt = 1; attempt < 20; attempt++) await expect(generations.recover(fail)).rejects.toThrow('Queue unavailable');
  const send = vi.fn(async () => {});
  await generations.recover(send);
  expect(send).not.toHaveBeenCalled();
  expect(await store.read<Job>(`jobs/${id}.json`)).toMatchObject({ status: 'failed', dispatches: 20, attempts: 0 });
  await dispatchBatch(store, requested.id, send);
  expect(send).not.toHaveBeenCalled();
  expect(store.published.get(source.id)).toEqual(note);
  await changeBatch(store, requested.id, 'retry', send, source.id);
  expect(send).toHaveBeenCalledExactlyOnceWith(id);
  expect(await store.read<Job>(`jobs/${id}.json`)).toMatchObject({ status: 'pending', attempts: 0, dispatches: 1 });
});

it('checks durable cancellation before paid work after extraction returns', async () => {
  const { store, note } = await captured();
  const requested = await batch(store);
  await dispatchBatch(store, requested.id, async () => {});
  const id = (await store.read<SourceState>(sourceKey))!.generationId;
  const analyze = vi.fn(processor.analyzeTemplate!);
  await processJob(store, id, { ...processor, analyzeTemplate: analyze, extract: async saved => {
    await expect(changeBatch(store, requested.id, 'cancel', async () => {})).rejects.toThrow('Lease busy');
    return processor.extract(saved);
  } });
  expect(analyze).not.toHaveBeenCalled();
  expect(store.published.get(source.id)).toEqual(note);
  await recoverCategoryWork(store, async () => { throw new Error('Cancelled batch must not recover'); });
  await expect(changeBatch(store, requested.id, 'retry', async () => {})).rejects.toMatchObject({ status: 409 });
});

it('rechecks cancellation between staging and live publication', async () => {
  const { store, note } = await captured();
  const requested = await batch(store);
  await dispatchBatch(store, requested.id, async () => {});
  const id = (await store.read<SourceState>(sourceKey))!.generationId;
  const staging = store.pause('create', `staged/${id}.json`);
  const running = processJob(store, id, processor);
  await staging.reached;
  await expect(changeBatch(store, requested.id, 'cancel', async () => {})).rejects.toThrow('Lease busy');
  staging.resume();
  await running;
  expect(store.published.get(source.id)).toEqual(note);
  expect(await store.read<Job>(`jobs/${id}.json`)).toMatchObject({ status: 'failed' });
});

it('retains the current note on replay analysis failure and waits for explicit retry', async () => {
  const { store, registry, note } = await captured();
  const generations = new SourceGenerations(store);
  const id = await generations.reprocess(source.id, registry, '2', async () => {});
  await processJob(store, id, { ...processor, analyzeTemplate: async () => { throw new Error('Invalid analysis'); } });
  expect(await store.read<Job>(`jobs/${id}.json`)).toMatchObject({ status: 'failed', attempts: 1, dispatches: 1 });
  expect(store.published.get(source.id)).toEqual(note);
  expect(await store.read(`reader-notes/${source.id}.json`)).toEqual({ markdown: 'Keep my reader note.' });
  const send = vi.fn(async () => {});
  await generations.recover(send, new Date(Date.now() + 11 * 60_000));
  expect(send).not.toHaveBeenCalled();
  await generations.change(id, 'retry', send);
  expect(send).toHaveBeenCalledExactlyOnceWith(id);
  expect(await store.read<Job>(`jobs/${id}.json`)).toMatchObject({ status: 'pending', attempts: 0, dispatches: 1 });
  await processJob(store, id, processor);
  expect(store.published.get(source.id)?.generationId).toBe(id);
});

it('honors retry timing and the worker attempt budget through recovery', async () => {
  const { store, registry } = await captured();
  const generations = new SourceGenerations(store);
  const id = await generations.reprocess(source.id, registry, '2', async () => {});
  const key = `jobs/${id}.json`;
  const now = new Date();
  await store.withLease(`source-${source.id}`, async () => {
    const job = (await store.read<Job>(key))!;
    await store.write(key, { ...job, attempts: 5, retryAt: new Date(now.getTime() + 5 * 60_000).toISOString(), lastQueuedAt: undefined });
  });
  const send = vi.fn(async () => {});
  await generations.recover(send, now);
  expect(await store.read<Job>(key)).toMatchObject({ status: 'pending', dispatches: 1, attempts: 5 });
  await generations.recover(send, new Date(now.getTime() + 6 * 60_000));
  expect(send).not.toHaveBeenCalled();
  expect(await store.read<Job>(key)).toMatchObject({ status: 'failed', dispatches: 1, attempts: 5 });
});

it('serializes simultaneous duplicate deliveries and publishes their generation once', async () => {
  const { store, registry } = await captured();
  const id = await new SourceGenerations(store).reprocess(source.id, registry, '2', async () => {});
  let entered!: () => void;
  let resume!: () => void;
  const extracting = new Promise<void>(resolve => { entered = resolve; });
  const released = new Promise<void>(resolve => { resume = resolve; });
  const analyze = vi.fn(processor.analyzeTemplate!);
  const running = processJob(store, id, { ...processor, analyzeTemplate: analyze, extract: async saved => {
    entered(); await released; return processor.extract(saved);
  } });
  await extracting;
  await expect(processJob(store, id, { ...processor, analyzeTemplate: analyze })).rejects.toThrow('Lease busy');
  resume();
  await running;
  await processJob(store, id, { ...processor, analyzeTemplate: analyze });
  expect(analyze).toHaveBeenCalledTimes(1);
  expect(store.publications).toBe(2);
  expect(await store.read<Job>(`jobs/${id}.json`)).toMatchObject({ status: 'imported', attempts: 1 });
});

it('fences a worker whose source lease expires during extraction before it can spend or publish', async () => {
  const { store, registry, note } = await captured();
  const generations = new SourceGenerations(store);
  const id = await generations.reprocess(source.id, registry, '2', async () => {});
  let entered!: () => void;
  let resume!: () => void;
  const extracting = new Promise<void>(resolve => { entered = resolve; });
  const released = new Promise<void>(resolve => { resume = resolve; });
  const analyze = vi.fn(processor.analyzeTemplate!);
  const running = processJob(store, id, { ...processor, analyzeTemplate: analyze, extract: async saved => {
    entered(); await released; return processor.extract(saved);
  } });
  const rejected = expect(running).rejects.toThrow('Lease lost');
  await extracting;
  store.loseLease(`source-${source.id}`);
  const next = await generations.reprocess(source.id, registry, '2', async () => {});
  resume();
  await rejected;
  expect(analyze).not.toHaveBeenCalled();
  expect(store.published.get(source.id)).toEqual(note);
  expect((await store.read<SourceState>(sourceKey))?.generationId).toBe(next);
  expect(await store.read<Job>(`jobs/${id}.json`)).toMatchObject({ status: 'pending', attempts: 1 });
});

it('fences a superseded worker when its paid result returns after lease loss', async () => {
  const { store, registry, note } = await captured();
  const generations = new SourceGenerations(store);
  const id = await generations.reprocess(source.id, registry, '2', async () => {});
  let entered!: () => void;
  let resume!: () => void;
  const analyzing = new Promise<void>(resolve => { entered = resolve; });
  const released = new Promise<void>(resolve => { resume = resolve; });
  const running = processJob(store, id, { ...processor, analyzeTemplate: async (...args) => {
    entered(); await released; return processor.analyzeTemplate!(...args);
  } });
  const rejected = expect(running).rejects.toThrow('Lease lost');
  await analyzing;
  store.loseLease(`source-${source.id}`);
  const next = await generations.reprocess(source.id, registry, '2', async () => {});
  resume();
  await rejected;
  expect(store.published.get(source.id)).toEqual(note);
  expect(await store.read(`analysis/${id}.json`)).toBeUndefined();
  expect(await store.read(`staged/${id}.json`)).toBeUndefined();
  expect((await store.read<SourceState>(sourceKey))?.generationId).toBe(next);
});
