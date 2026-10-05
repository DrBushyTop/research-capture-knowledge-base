import { expect, it } from 'vitest';
import { MemoryStore, snapshot } from './fixtures.js';
import { discover, type Job } from '../apps/worker/src/pipeline.js';
import { processJob, type Processor } from '../apps/worker/src/processing.js';
import type { Analysis, Note } from '../shared/corpus.js';
const analysis: Analysis = { summary: 'A narrative review reports uncertainty in the evidence.', topics: ['research-methods'], sourceCategory: 'research-paper', studyType: 'narrative review', keyFindings: [], limitations: ['Not a randomized trial.'], claims: [], relevance: [], population: null, participantCount: null, intervention: null, comparator: null, outcomes: [], funding: null, suggestedRelationships: [] };
const processor: Processor = { version: 'v1', model: 'test-deployment', extract: async () => ({ text: 'Available source evidence.', evidence: { status: 'text', method: 'pdf-text', reason: null, truncated: false, retrievedAt: '2026-10-05T10:00:00Z', artifactHash: null } }), enrich: async () => analysis, rights: async () => [] };
it('stages a validated note once despite duplicate delivery', async () => {
  const store = new MemoryStore(); await discover(store, snapshot, 'v1');
  const key = (await store.list('jobs/'))[0]; const job = (await store.read<Job>(key))!;
  await processJob(store, job.id, processor);
  await processJob(store, job.id, { ...processor, enrich: async () => { throw new Error('duplicate paid inference'); } });
  const note = await store.read<Note>(`staged/${job.id}.json`);
  expect(note?.analysis?.summary).toBe('A narrative review reports uncertainty in the evidence.');
  expect((await store.read<Job>(key))?.status).toBe('staged');
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
