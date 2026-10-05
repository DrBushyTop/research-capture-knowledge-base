import { describe, expect, it } from 'vitest';
import { discover, reconcile, type PipelineStore } from '../apps/worker/src/pipeline.js';
import type { LibrarySnapshot } from '../shared/corpus.js';

import { MemoryStore, snapshot } from './fixtures.js';
describe('durable observation', () => {
  it('recovers a failed queue handoff without losing the observed capture', async () => {
    const store = new MemoryStore();
    await discover(store, snapshot, 'v1');
    await expect(reconcile(store, async () => { throw new Error('queue unavailable'); })).rejects.toThrow('queue unavailable');
    const delivered: string[] = [];
    await reconcile(store, async id => { delivered.push(id); });
    expect(delivered).toHaveLength(1);
    const job = await store.read<{ source: { id: string }; status: string }>(`jobs/${delivered[0]}.json`);
    expect(job?.source.id).toBe('zotero-users-12345-PBA4T3PN');
    expect(job?.status).toBe('pending');
  });
});

it('observes a child-only change and does not duplicate an unchanged observation', async () => {
  const store = new MemoryStore();
  await discover(store, snapshot, 'v1');
  await discover(store, snapshot, 'v1');
  expect(await store.list('jobs/')).toHaveLength(1);
  const changed = structuredClone(snapshot);
  changed.version = 9; changed.items[1].version = 9;
  await discover(store, changed, 'v1');
  const delivered: string[] = [];
  await reconcile(store, async id => { delivered.push(id); });
  expect(delivered).toHaveLength(1);
  expect(await store.list('jobs/')).toHaveLength(2);
});
it('records a tombstone without destroying the previous capture', async () => {
  const store = new MemoryStore();
  await discover(store, snapshot, 'v1');
  await discover(store, { ...snapshot, version: 9, items: [] }, 'v1');
  const current = await store.read<{source: {active: boolean}}>('sources/zotero-users-12345-PBA4T3PN.json');
  expect(current?.source.active).toBe(false);
  expect(await store.list('snapshots/')).toHaveLength(2);
});
it('does not roll the corpus back when an older poll finishes late', async () => {
  const store = new MemoryStore();
  const newer = structuredClone(snapshot); newer.version = 9; newer.items[1].version = 9;
  await discover(store, newer, 'v1');
  await discover(store, snapshot, 'v1');
  const checkpoint = await store.read<{ libraryVersion: number }>('checkpoint.json');
  expect(checkpoint?.libraryVersion).toBe(9);
  expect(await store.list('jobs/')).toHaveLength(1);
});
it('tracks standalone PDFs and annotations under child attachments', async () => {
  const store = new MemoryStore();
  await discover(store, { ...snapshot, items: [...snapshot.items,
    { key: 'ANN88888', version: 2, data: { itemType: 'annotation', parentItem: '4WISI6AR', annotationText: 'A human highlight' } },
    { key: 'PDF88888', version: 2, data: { itemType: 'attachment', contentType: 'application/pdf', linkMode: 'imported_file', title: 'Standalone PDF' } }
  ] }, 'v1');
  expect(await store.list('sources/')).toHaveLength(2);
  const first = await store.read<{ source: { id: string }; children: { key: string }[] }>((await store.list('snapshots/'))[0]);
  expect(first?.children.map(c => c.key)).toContain('ANN88888');
});
