import { vi } from 'vitest';
import { hash, normalize, type Note } from '../shared/corpus.js';
import type { ReaderStore } from '../apps/worker/src/reader-actions.js';
import { sourceText } from '../shared/source-text.js';
import { MemorySourceArtifactStore, blobArtifactStore } from './source-artifacts-fixture.js';
import { snapshot } from './fixtures.js';

export async function readerStore() {
  const state = new MemorySourceArtifactStore();
  const bytes = Buffer.from('%PDF-1.7\nReader fixture');
  const note: Note = { schemaVersion: 1, source: normalize(snapshot)[0].source, generationId: hash('reader generation'),
    extraction: { status: 'text', method: 'pdf-text', reason: null, truncated: false, retrievedAt: '2026-10-09T08:00:00Z', artifactHash: hash(bytes), artifactMime: 'application/pdf' },
    analysis: null, processing: { version: '4', model: null, processedAt: '2026-10-09T08:00:00Z' }, rightsEvidence: [] };
  const saved = { note, humanMarkdown: 'Human commentary' };
  const binaries = new Map<string, Buffer>();
  const store = Object.assign(state, {
    sources: async () => [saved],
    sourceInputs: async () => new Map<string, { generationId: string; text?: unknown; readerNote?: { markdown: string } }>(),
    retainedSource: async (id: string) => id === note.source.id ? saved : undefined,
    container: blobArtifactStore().raw,
    createBinary: async (key: string, bytes: Uint8Array) => { if (!binaries.has(key)) binaries.set(key, Buffer.from(bytes)); },
    readBinary: async (key: string) => binaries.get(key),
    remove: async (key: string) => { state.data.delete(key); binaries.delete(key); },
    send: vi.fn(async (_id: string) => {}),
    sendChat: vi.fn(async (_id: string) => {})
  }) satisfies ReaderStore;
  const revision = hash('reader corpus');
  await store.create('chat/current.json', { revision });
  await store.create(`chat/corpora/${revision}.json`, { revision, sources: [saved] });
  await store.create(`sources/${note.source.id}.json`, { source: note.source, generationId: note.generationId });
  await store.create(`source-text/${note.generationId}.json`, sourceText(note, 'Original source text'));
  await store.retain(hash(bytes), bytes, 'application/pdf');
  return { store, note, bytes, binaries, revision };
}
