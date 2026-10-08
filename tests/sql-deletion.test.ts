import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqlStore } from '../apps/worker/src/sql-store.js';
import { closeSql, sqlPool } from '../apps/worker/src/sql-connection.js';
import { SourceLifecycleService, sourceLifecycle } from '../apps/worker/src/source-lifecycle.js';
import { SourceGenerations } from '../apps/worker/src/source-generations.js';
import { hash, normalize, type Note } from '../shared/corpus.js';
import { snapshot } from './fixtures.js';
import { readSourceDocument } from '../apps/worker/src/source-reader.js';

afterAll(closeSql);
it.skipIf(!process.env.TEST_SQL)('SQL lifecycle fences old workers and purges originals without deleting a shared retained copy', async () => {
  const first = new SqlStore('devstoreaccount1'), second = new SqlStore('devstoreaccount1');
  const originals = Buffer.from('deletion fixture ' + randomUUID());
  const artifact = hash(originals);
  const notes: Note[] = [];
  for (let i = 0; i < 2; i++) {
    const library = structuredClone(snapshot);
    library.items[0].key = hash(randomUUID()).slice(0, 8).toUpperCase();
    library.items[1].data.parentItem = library.items[0].key;
    const capture = normalize(library)[0]!;
    const generationId = (await new SourceGenerations(first).observe(capture, 'test'))!;
    const note: Note = { schemaVersion: 1, generationId, source: capture.source,
      extraction: { status: 'text', method: 'text', artifactHash: artifact, artifactMime: 'text/plain', retrievedAt: new Date().toISOString(), reason: null, truncated: false },
      analysis: null, processing: { version: 'test', model: null, processedAt: new Date().toISOString() }, rightsEvidence: [] };
    notes.push(note);
    await first.withLease(`source-${note.source.id}`, async () => {
      await first.retain(artifact, originals, 'text/plain');
      await first.create(`analysis/${generationId}.json`, note);
      await first.publishNote(note);
    });
  }
  const service = new SourceLifecycleService(second);
  const legacyRevision = hash(randomUUID());
  const legacyCorpusKey = `chat/corpora/${legacyRevision}.json`;
  const staleBatchKey = `categories/batches/${legacyRevision}.json`;
  try {
    const [a, b] = notes;
    await first.container.getBlockBlobClient(legacyCorpusKey).uploadData(Buffer.from(JSON.stringify({ revision: legacyRevision, sources: notes.map(note => ({ note, humanMarkdown: 'Legacy source notes' })) })));
    await first.create(`chat/indexes/${legacyRevision}.json`, { revision: legacyRevision, privateText: 'Original searchable source content' });
    await first.withLease(`source-${a.source.id}`, async () => {
      await service.change(a.source.id, 'trash', 0, 'admin-b');
      expect(await first.source(a.source.id)).toBeUndefined();
      expect((await readSourceDocument(first, a.source.id)).bytes).toEqual(originals);
      await expect(first.publishNote(a)).rejects.toThrow('Source lifecycle changed');
      await service.change(a.source.id, 'restore', 1, 'admin-b');
      await expect(first.publishNote(a)).rejects.toThrow('Source lifecycle changed');
    }).catch(error => { if (!String(error).includes('Source lifecycle changed')) throw error; });
    expect((await first.source(a.source.id))?.note.generationId).toBe(a.generationId);
    await service.change(b.source.id, 'trash', 0, 'admin-b');
    await service.change(a.source.id, 'trash', 2, 'admin-a');
    await service.change(a.source.id, 'purge', 3, 'admin-a');
    await expect(readSourceDocument(first, a.source.id)).rejects.toMatchObject({ status: 410 });
    await expect(first.create(staleBatchKey, { entries: [{ sourceId: a.source.id }] })).rejects.toThrow('Source lifecycle changed');
    expect(await first.read(staleBatchKey)).toBeUndefined();
    await service.cleanup(a.source.id);
    expect((await sourceLifecycle(first, a.source.id)).state).toBe('deleted');
    expect(await first.container.getBlockBlobClient(legacyCorpusKey).exists()).toBe(false);
    expect(await first.read(`chat/indexes/${legacyRevision}.json`)).toBeUndefined();
    expect(await first.read(legacyCorpusKey)).toMatchObject({ sources: [{ note: { source: { id: b.source.id } } }] });
    expect(await first.read(`analysis/${a.generationId}.json`)).toBeUndefined();
    expect((await readSourceDocument(first, b.source.id)).bytes).toEqual(originals);
    await service.change(b.source.id, 'purge', 1, 'admin-a');
    await service.cleanup(b.source.id);
    expect((await sourceLifecycle(first, b.source.id)).state).toBe('deleted');
    expect(await first.readArtifact(artifact)).toBeUndefined();
  } finally {
    for (const note of notes) {
      const state = await sourceLifecycle(first, note.source.id);
      if (state.state === 'active') await service.change(note.source.id, 'trash', state.revision, 'test');
      const current = await sourceLifecycle(first, note.source.id);
      if (current.state === 'trashed') await service.change(note.source.id, 'purge', current.revision, 'test');
      await service.cleanup(note.source.id);
      await first.remove(`source-lifecycle/${note.source.id}.json`);
      await (await sqlPool()).request().input('id', note.source.id).query('DELETE dbo.Sources WHERE source_id=@id');
    }
    await first.raw.getBlockBlobClient(artifact).deleteIfExists();
    await first.remove(legacyCorpusKey);
    await first.remove(`chat/indexes/${legacyRevision}.json`);
    await first.remove(staleBatchKey);
  }
}, 120000);
