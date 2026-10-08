import { describe, expect, it } from 'vitest';
import { SourceLifecycleService, sourceLifecycle } from '../apps/worker/src/source-lifecycle.js';
import { SourceGenerations } from '../apps/worker/src/source-generations.js';
import { hash, normalize, type Note } from '../shared/corpus.js';
import { purgeSourceContent } from '../apps/worker/src/source-purge.js';
import { browserCaptureVersion } from '../apps/worker/src/browser-capture.js';
import { MemoryStore } from './fixtures.js';
import { GenerationStore } from './generation-store.js';
import { snapshot } from './fixtures.js';

describe('shared source lifecycle', () => {
  it('keeps Trash through polls and restores without consulting Zotero', async () => {
    const store = new GenerationStore();
    const capture = normalize(snapshot)[0]!;
    const generations = new SourceGenerations(store);
    const original = (await generations.observe(capture, 'v1'))!;
    const lifecycle = new SourceLifecycleService(store);
    const trashed = await lifecycle.change(capture.source.id, 'trash', 0, 'admin-a');
    expect(trashed.state).toBe('trashed');
    expect(await generations.observe({ ...capture, source: { ...capture.source, fingerprint: 'f'.repeat(64) } }, 'v2')).toBeUndefined();
    await expect(lifecycle.change(capture.source.id, 'restore', 0, 'admin-b')).rejects.toMatchObject({ status: 409 });
    expect((await lifecycle.change(capture.source.id, 'restore', 1, 'admin-b')).state).toBe('active');
    expect((await sourceLifecycle(store, capture.source.id)).revision).toBe(2);
    expect(await generations.canProcess((await store.read(`jobs/${original}.json`))!)).toBe(false);
    expect(await generations.observe(capture, 'v1')).not.toBe(original);
  });
  it.each(['analysis', 'index', 'legacy'])('resumes a purge after an interrupted %s removal and keeps conversations', async failure => {
    const store = new MemoryStore();
    const capture = normalize(snapshot)[0]!;
    const generationId = hash('old generation');
    const artifact = hash('original bytes');
    const note: Note = { schemaVersion: 1, generationId, source: capture.source,
      extraction: { status: 'text', method: 'text', artifactHash: artifact, artifactMime: 'text/plain', retrievedAt: new Date().toISOString(), reason: null, truncated: false },
      analysis: null, processing: { version: 'test', model: null, processedAt: new Date().toISOString() }, rightsEvidence: [] };
    const removedArtifacts: string[] = [];
    const screenshot = hash('shared legacy browser screenshot');
    const ownBrowserKey = `browser-captures/${hash(`${capture.source.fingerprint}:${browserCaptureVersion}`)}.json`;
    const legacy = new Map<string, unknown>([
      ['chat/corpora/old.json', { revision: 'old', sources: [{ note, humanMarkdown: 'Legacy human commentary' }] }],
      [ownBrowserKey, { views: [{ screenshot }] }],
      ['browser-workspaces/old.json', { sourceId: capture.source.id, createdAt: '2026-10-08T00:00:00Z' }],
      ['browser-captures/retained.json', { views: [{ screenshot }] }]
    ]);
    let interrupted = false;
    const adapter = Object.assign(store, {
      retainedSource: async () => undefined,
      removeSource: async () => undefined,
      removeArtifact: async (hash: string) => { removedArtifacts.push(hash); },
      legacyKeys: async () => [...legacy.keys()],
      legacyRead: async <T>(key: string) => legacy.get(key) as T | undefined,
      removeLegacy: async (key: string) => {
        if (!interrupted && failure === 'legacy') { interrupted = true; throw new Error('Blob removal failed'); }
        legacy.delete(key);
      },
      remove: async (key: string) => {
        if (!interrupted && failure === 'index' && key === 'chat/indexes/old.json') { interrupted = true; throw new Error('Index removal failed'); }
        store.data.delete(key);
        legacy.delete(key);
        if (!interrupted && failure === 'analysis' && key === `analysis/${generationId}.json`) { interrupted = true; throw new Error('Worker stopped'); }
      },
      purgeSourceContent: async (id: string) => purgeSourceContent(adapter, id)
    });
    await store.create(`sources/${capture.source.id}.json`, { generationId, source: capture.source });
    await store.create(`analysis/${generationId}.json`, note);
    await store.create(`source-text/${generationId}.json`, { text: 'Private source text' });
    await store.create(`document-text/${generationId}/${artifact}/manifest.json`, { sourceId: capture.source.id, text: 'Private full text' });
    await store.create(`chat/corpora/old.json`, { revision: 'old', sources: [{ note, humanMarkdown: 'Human commentary' }] });
    await store.create('chat/indexes/old.json', { privateText: 'Private full text' });
    await store.create('chat/conversations/admin/saved.json', { text: 'A quoted passage' });
    const lifecycle = new SourceLifecycleService(adapter);
    await lifecycle.change(capture.source.id, 'trash', 0, 'admin-a');
    await lifecycle.change(capture.source.id, 'purge', 1, 'admin-b');
    await lifecycle.cleanup(capture.source.id);
    const failed = await sourceLifecycle(store, capture.source.id);
    expect(failed).toMatchObject({ state: 'purging', error: expect.any(String) });
    expect(await store.read(`source-purges/${capture.source.id}.json`)).toBeDefined();
    await lifecycle.change(capture.source.id, 'retry', failed.revision, 'admin-b');
    await lifecycle.cleanup(capture.source.id);
    expect((await sourceLifecycle(store, capture.source.id)).state).toBe('deleted');
    expect(removedArtifacts).toEqual([artifact]);
    expect(await store.list('document-text/')).toEqual([]);
    expect(await store.read('chat/indexes/old.json')).toBeUndefined();
    expect(await store.read('chat/corpora/old.json')).toMatchObject({ sources: [] });
    expect([...legacy.keys()]).toEqual(['browser-captures/retained.json']);
    expect(await store.read('chat/conversations/admin/saved.json')).toEqual({ text: 'A quoted passage' });
    expect(await store.read(`source-purges/${capture.source.id}.json`)).toBeUndefined();
    expect(await new SourceGenerations(store).observe(capture, 'new-processing-version')).toBeUndefined();
    const newCapture = structuredClone(snapshot);
    newCapture.items[0].key = 'NEWITEM1';
    newCapture.items[1].data.parentItem = 'NEWITEM1';
    expect(await new SourceGenerations(store).observe(normalize(newCapture)[0], 'new-processing-version')).toBeDefined();
  });
});
