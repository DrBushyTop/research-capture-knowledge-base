import { expect, it } from 'vitest';
import { MemoryStore, snapshot } from './fixtures.js';
import { discover, reconcile, type Job } from '../apps/worker/src/pipeline.js';
import { processJob, type Processor } from '../apps/worker/src/processing.js';
import type { Analysis, Note } from '../shared/corpus.js';
const analysis: Analysis = { summary: 'A narrative review reports uncertainty in the evidence.', topics: ['research-methods'], sourceCategory: 'research-paper', studyType: 'narrative review', keyFindings: [], limitations: ['Not a randomized trial.'], claims: [], relevance: [], population: null, participantCount: null, intervention: null, comparator: null, outcomes: [], funding: null, suggestedRelationships: [] };
const processor: Processor = { version: 'v1', model: 'test-deployment', extract: async () => ({ text: 'Available source evidence.', evidence: { status: 'text', method: 'pdf-text', reason: null, truncated: false, retrievedAt: '2026-10-05T10:00:00Z', artifactHash: null } }), enrich: async () => analysis, rights: async () => [] };
it('keeps the saved analysis and original when a later Zotero update loses its attachment', async () => {
  const store = new MemoryStore();
  let published: Note | undefined;
  const adapter = Object.assign(store, { publishNote: async (note: Note) => { published = note; }, retainedSource: async () => published ? { note: published, humanMarkdown: 'Human notes' } : undefined });
  await discover(adapter, snapshot, 'v1');
  const original = (await adapter.read<Job>((await adapter.list('jobs/'))[0]))!;
  await processJob(adapter, original.id, { ...processor, extract: async () => ({ text: 'Available source evidence.', evidence: { status: 'text', method: 'pdf-text', reason: null, truncated: false, retrievedAt: '2026-10-05T10:00:00Z', artifactHash: 'a'.repeat(64) } }) });
  const updated = structuredClone(snapshot);
  updated.version++;
  updated.items = [updated.items[0]];
  updated.items[0].version++;
  await discover(adapter, updated, 'v1');
  const current = (await adapter.read<{ generationId: string }>(`sources/${original.source.id}.json`))!;
  await processJob(adapter, current.generationId, processor);
  expect(published?.generationId).toBe(original.id);
  expect(published?.analysis?.summary).toBe(analysis.summary);
  expect((await adapter.read<Job>(`jobs/${current.generationId}.json`))?.status).toBe('failed');
});
it('stages a validated note once despite duplicate delivery', async () => {
  const store = new MemoryStore(); await discover(store, snapshot, 'v1');
  const key = (await store.list('jobs/'))[0]; const job = (await store.read<Job>(key))!;
  await processJob(store, job.id, processor);
  await processJob(store, job.id, { ...processor, enrich: async () => { throw new Error('duplicate paid inference'); } });
  const note = await store.read<Note>(`staged/${job.id}.json`);
  expect(note?.analysis?.summary).toBe('A narrative review reports uncertainty in the evidence.');
  expect((await store.read<{ text: string }>(`source-text/${job.id}.json`))?.text).toBe('Available source evidence.');
  expect((await store.read<Job>(key))?.status).toBe('staged');
});
it('publishes SQL-backed notes immediately and marks the job imported without a Git round trip', async () => {
  const store = new MemoryStore();
  let published: Note | undefined;
  const sqlStore = Object.assign(store, { publishNote: async (note: Note) => { published = note; } });
  await discover(sqlStore, snapshot, 'v1');
  const key = (await sqlStore.list('jobs/'))[0];
  const job = (await sqlStore.read<Job>(key))!;
  await processJob(sqlStore, job.id, processor);
  expect(published?.analysis?.summary).toBe(analysis.summary);
  expect((await sqlStore.read<Job>(key))?.status).toBe('imported');
});
it('a failed model produces an honest review note without invented analysis', async () => {
  const store = new MemoryStore(); await discover(store, snapshot, 'v1');
  const job = (await store.read<Job>((await store.list('jobs/'))[0]))!;
  await processJob(store, job.id, { ...processor, enrich: async () => { throw new Error('provider unavailable'); } });
  const note = await store.read<Note>(`staged/${job.id}.json`);
  expect(note?.analysis).toBeNull();
  expect(note?.extraction.status).toBe('needs-review');
});
it('does not stage an old generation after a newer attachment was observed', async () => {
  const store = new MemoryStore(); await discover(store, snapshot, 'v1');
  const job = (await store.read<Job>((await store.list('jobs/'))[0]))!;
  await processJob(store, job.id, { ...processor, enrich: async () => {
    const newer = structuredClone(snapshot); newer.version = 9; newer.items[1].version = 9;
    await discover(store, newer, 'v1'); return analysis;
  } });
  expect(await store.list('staged/')).toHaveLength(0);
});
it('rate limits leave a durable retry instead of caching a failed interpretation', async () => {
  const { TransientInference } = await import('../apps/worker/src/enrichment.js');
  const store = new MemoryStore(); await discover(store, snapshot, 'v1');
  const job = (await store.read<Job>((await store.list('jobs/'))[0]))!;
  await processJob(store, job.id, { ...processor, enrich: async () => { throw new TransientInference('rate limited'); } });
  const pending = (await store.read<Job>(`jobs/${job.id}.json`))!;
  expect(pending.status).toBe('pending');
  expect(await store.list('staged/')).toHaveLength(0);
  await store.write(`jobs/${job.id}.json`, { ...pending, retryAt: undefined });
  await processJob(store, job.id, processor);
  expect((await store.read<Note>(`staged/${job.id}.json`))?.analysis?.summary).toBe(analysis.summary);
});
it('stops automatically delivering a job after repeated unexpected failures', async () => {
  const store = new MemoryStore(); await discover(store, snapshot, 'v1');
  const key = (await store.list('jobs/'))[0]; const job = (await store.read<Job>(key))!;
  const broken = { ...processor, rights: async () => { throw new Error('permanent configuration failure'); } };
  for (let attempt = 0; attempt < 5; attempt++) {
    await expect(processJob(store, job.id, broken)).rejects.toThrow();
    const pending = (await store.read<Job>(key))!;
    await store.write(key, { ...pending, retryAt: undefined });
  }
  expect((await store.read<Job>(key))?.status).toBe('failed');
  let deliveries = 0;
  await reconcile(store, async () => { deliveries++; });
  expect(deliveries).toBe(0);
});
