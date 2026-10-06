import { expect, it } from 'vitest';
import { MemoryStore, snapshot } from './fixtures.js';
import { normalize, type Note } from '../shared/corpus.js';
import { readReaderNote, saveReaderNote, withReaderNotes } from '../apps/worker/src/reader-notes.js';

function setup() {
  const store = new MemoryStore();
  const note: Note = { schemaVersion: 1, generationId: 'a'.repeat(64), source: normalize(snapshot)[0].source,
    extraction: { status: 'metadata-only', method: 'none', reason: null, truncated: false, retrievedAt: '', artifactHash: null },
    analysis: null, processing: { version: '2', model: null, processedAt: '' }, rightsEvidence: [] };
  const corpus = { revision: 'a'.repeat(64), sources: [{ note, humanMarkdown: '# Human notes\n\nKeep Zotero notes.' }] };
  store.data.set('chat/current.json', { revision: corpus.revision });
  store.data.set(`chat/corpora/${corpus.revision}.json`, corpus);
  return { store, corpus, id: note.source.id };
}
it('saves shared reader notes and rejects stale edits without losing either draft', async () => {
  const { store, id } = setup();
  expect((await readReaderNote(store, id)).revision).toBe(0);
  const saved = await saveReaderNote(store, 'admin', { sourceId: id, revision: 0, markdown: 'My observation' });
  expect(saved.revision).toBe(1);
  await expect(saveReaderNote(store, 'other-admin', { sourceId: id, revision: 0, markdown: 'Stale draft' })).rejects.toMatchObject({ status: 409 });
  expect((await readReaderNote(store, id)).markdown).toBe('My observation');
  await expect(saveReaderNote(store, 'admin', { sourceId: id, revision: 1, markdown: '<!-- /reader-notes -->' })).rejects.toMatchObject({ status: 400 });
  await expect(readReaderNote(store, 'zotero-users-12345-MISSING1')).rejects.toMatchObject({ status: 404 });
});
it('includes current reader notes in chat while preserving other human commentary', async () => {
  const { store, corpus, id } = setup();
  await saveReaderNote(store, 'admin', { sourceId: id, revision: 0, markdown: 'My observation' });
  expect((await withReaderNotes(store, corpus)).sources[0].humanMarkdown).toContain('Keep Zotero notes.');
  expect((await withReaderNotes(store, corpus)).sources[0].humanMarkdown).toContain('My observation');
  const imported = { ...corpus, sources: [{ ...corpus.sources[0], humanMarkdown: corpus.sources[0].humanMarkdown + '\n<!-- reader-notes -->\nOld imported reader text\n<!-- /reader-notes -->\n' }] };
  const fresh = (await withReaderNotes(store, imported)).sources[0].humanMarkdown;
  expect(fresh).not.toContain('Old imported reader text');
  expect(fresh.match(/My observation/g)).toHaveLength(1);
});
