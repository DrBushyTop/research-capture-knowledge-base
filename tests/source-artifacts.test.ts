import { describe, expect, it, vi } from 'vitest';
import { extractArtifact, MissingArtifact } from '../apps/worker/src/extraction.js';
import { SourceArtifacts } from '../apps/worker/src/source-artifacts.js';
import { hash, normalize, type Note } from '../shared/corpus.js';
import { snapshot } from './fixtures.js';
import { blobArtifactStore, MemorySourceArtifactStore, screenshot } from './source-artifacts-fixture.js';
import { layoutPdf } from './pdf-fixture.js';

const emptyHtml = '<html><body>Sign in</body></html>';
const readableText = 'Readable document evidence should remain available when the same capture contains an image attachment before its text file.';
const offline = { request: vi.fn(async (): Promise<Response> => { throw new Error('Original disappeared'); }) };
function sourceWithFallback() {
  const source = normalize(structuredClone(snapshot))[0];
  source.children = [
    { key: 'AAAAAA11', version: 1, data: { linkMode: 'imported_url', contentType: 'text/html' } },
    { key: 'BBBBBB11', version: 1, data: { linkMode: 'imported_file', contentType: 'image/png' } }
  ];
  return source;
}
function pinned(source: Note['source'], extraction: Note['extraction']) {
  return { source, generationId: hash('pinned generation'), extraction };
}

for (const [adapter, makeStore] of [['memory', () => new MemorySourceArtifactStore()], ['Blob', blobArtifactStore]] as const) {
  describe(`${adapter} artifact adapter`, () => {
    it('replays the retained screenshot after empty HTML falls back and both originals disappear', async () => {
      const source = sourceWithFallback();
      source.root.data.abstractNote = '<p>Saved caption, separate from source pixels.</p>';
      const store = makeStore();
      const originals = { request: vi.fn(async (path: string) => new Response(path.includes('AAAAAA11') ? emptyHtml : screenshot)) };
      const first = await new SourceArtifacts(store).extract(source, originals);
      expect(originals.request.mock.calls.map(([path]) => path)).toEqual(['items/AAAAAA11/file', 'items/BBBBBB11/file']);
      expect(first.evidence).toMatchObject({ method: 'image-vision', artifactHash: hash(screenshot), artifactMime: 'image/png' });
      expect(first.text).toBe('Saved caption, separate from source pixels.');
      expect(store.files.size).toBe(2);
      expect(store.files.get(hash(emptyHtml))?.bytes).toEqual(Buffer.from(emptyHtml));
      const originalRecord = structuredClone(store.data.get(`artifacts/${source.source.fingerprint}.json`));
      expect(originalRecord).toMatchObject({ hash: hash(emptyHtml), mime: 'text/html' });
      offline.request.mockClear();
      const replay = await new SourceArtifacts(store).extract(source, offline);
      expect(replay.evidence).toEqual(first.evidence);
      expect(replay.images?.[0].bytes).toEqual(screenshot);
      expect(replay.text).toBe(first.text);
      expect(offline.request).not.toHaveBeenCalled();
      expect(store.data.get(`artifacts/${source.source.fingerprint}.json`)).toEqual(originalRecord);
      const retained = await new SourceArtifacts(store).readForNote(pinned(source.source, first.evidence));
      expect(retained?.bytes).toEqual(screenshot);
      expect(retained?.mime).toBe('image/png');
      expect(Buffer.from(retained!.bytes).toString()).not.toContain('Saved caption');
    });

    it('replays a normal single-artifact capture with its original retrieval time', async () => {
      const source = normalize(structuredClone(snapshot))[0];
      source.children[0].data.contentType = 'text/plain';
      const store = makeStore();
      const first = await new SourceArtifacts(store).extract(source, { request: async () => new Response(readableText) });
      offline.request.mockClear();
      const replay = await new SourceArtifacts(store).extract(source, offline);
      expect(replay).toEqual(first);
      expect(replay.evidence).toMatchObject({ status: 'text', method: 'text', artifactHash: hash(readableText) });
      expect(store.files.size).toBe(1);
      expect(offline.request).not.toHaveBeenCalled();
    });

    it('prefers readable text over a screenshot and keeps that preference on replay', async () => {
      const source = sourceWithFallback();
      source.children.reverse();
      source.children[1].data.contentType = 'text/plain';
      const store = makeStore();
      const request = vi.fn(async (path: string) => { expect(path).toBe('items/AAAAAA11/file'); return new Response(readableText); });
      const first = await new SourceArtifacts(store).extract(source, { request });
      const replay = await new SourceArtifacts(store).extract(source, offline);
      expect(first.text).toBe(readableText);
      expect(first.images).toBeUndefined();
      expect(replay).toEqual(first);
      expect(request).toHaveBeenCalledTimes(1);
      expect(store.files.has(hash(screenshot))).toBe(false);
    });

    it('reads existing single-artifact records without replacing them or their bytes', async () => {
      const source = sourceWithFallback();
      const store = makeStore();
      const legacy = { hash: hash(readableText), mime: 'text/plain; charset=utf-8', retrievedAt: '2026-10-05T10:00:00Z' };
      await store.retain(legacy.hash, Buffer.from(readableText), legacy.mime);
      await store.create(`artifacts/${source.source.fingerprint}.json`, legacy);
      const replay = await new SourceArtifacts(store).extract(source, offline);
      expect(replay.text).toBe(readableText);
      expect(replay.evidence).toMatchObject({ artifactHash: legacy.hash, artifactMime: 'text/plain', retrievedAt: legacy.retrievedAt });
      expect(store.data.get(`artifacts/${source.source.fingerprint}.json`)).toEqual(legacy);
      expect(store.files.get(legacy.hash)?.mime).toBe(legacy.mime);
      expect(store.files.size).toBe(1);
    });

    it('replays a legacy PDF with an octet-stream header through LiteParse', async () => {
      const source = normalize(structuredClone(snapshot))[0];
      const bytes = layoutPdf();
      const store = makeStore();
      await store.retain(hash(bytes), bytes, 'application/octet-stream');
      await store.create(`artifacts/${source.source.fingerprint}.json`, { hash: hash(bytes), mime: 'application/octet-stream', retrievedAt: '2026-10-05T10:00:00Z' });
      const result = await new SourceArtifacts(store).extract(source, offline);
      expect(result.evidence).toMatchObject({ status: 'text', method: 'pdf-text', artifactMime: 'application/pdf' });
      expect(result.text).toContain('# Synthetic layout study');
      const retained = await new SourceArtifacts(store).readForNote(pinned(source.source, result.evidence));
      expect(retained?.mime).toBe('application/pdf');
      expect(retained?.bytes).toEqual(bytes);
      await expect(new SourceArtifacts(store).readForNote(pinned(source.source, { ...result.evidence, artifactMime: 'image/png' }))).rejects.toThrow('MIME does not match');
    });

    it('keeps HTML retained after a missing screenshot and resumes with only the screenshot fetch', async () => {
      const source = sourceWithFallback();
      const store = makeStore();
      await expect(new SourceArtifacts(store).extract(source, { request: async path => {
        if (path.includes('AAAAAA11')) return new Response(emptyHtml);
        throw new Error('Screenshot not synced yet');
      } })).rejects.toBeInstanceOf(MissingArtifact);
      expect(store.files.get(hash(emptyHtml))?.bytes).toEqual(Buffer.from(emptyHtml));
      const retry = vi.fn(async (path: string) => { expect(path).toBe('items/BBBBBB11/file'); return new Response(screenshot); });
      const recovered = await new SourceArtifacts(store).extract(source, { request: retry });
      expect(recovered.evidence.method).toBe('image-vision');
      expect(retry).toHaveBeenCalledTimes(1);
      expect((await new SourceArtifacts(store).extract(source, offline)).images?.[0].bytes).toEqual(screenshot);
    });

    it('reads a pinned legacy screenshot even if the fingerprint record names its original HTML', async () => {
      const source = sourceWithFallback();
      const store = makeStore();
      await store.retain(hash(emptyHtml), Buffer.from(emptyHtml), 'text/html');
      await store.retain(hash(screenshot), screenshot, 'image/png');
      await store.create(`artifacts/${source.source.fingerprint}.json`, { hash: hash(emptyHtml), mime: 'text/html', retrievedAt: '2026-10-05T10:00:00Z' });
      const evidence: Note['extraction'] = { artifactHash: hash(screenshot), artifactMime: 'image/png', retrievedAt: '2026-10-05T10:01:00Z',
        status: 'image', method: 'image-vision', reason: null, truncated: false };
      const artifact = await new SourceArtifacts(store).readForNote(pinned(source.source, evidence));
      expect(artifact).toMatchObject({ bytes: screenshot, mime: 'image/png', retrievedAt: evidence.retrievedAt });
      expect((await extractArtifact(source, artifact!)).evidence.artifactHash).toBe(hash(screenshot));
    });

    it('replays an existing published screenshot without fetching its missing original', async () => {
      const source = sourceWithFallback();
      const store = makeStore();
      await store.retain(hash(emptyHtml), Buffer.from(emptyHtml), 'text/html');
      await store.retain(hash(screenshot), screenshot, 'image/png');
      const legacy = { hash: hash(emptyHtml), mime: 'text/html', retrievedAt: '2026-10-05T10:00:00Z' };
      await store.create(`artifacts/${source.source.fingerprint}.json`, legacy);
      const evidence: Note['extraction'] = { artifactHash: hash(screenshot), artifactMime: 'image/png', retrievedAt: '2026-10-05T10:01:00Z',
        status: 'image', method: 'image-vision', reason: null, truncated: false };
      const published = Object.assign(store, { source: async () => ({ note: pinned(source.source, evidence) }) });
      offline.request.mockClear();
      const replay = await new SourceArtifacts(published).extract(source, offline);
      expect(replay.images?.[0].bytes).toEqual(screenshot);
      expect(replay.evidence).toMatchObject({ method: 'image-vision', artifactHash: hash(screenshot), retrievedAt: evidence.retrievedAt });
      expect(offline.request).not.toHaveBeenCalled();
      expect(store.data.get(`artifacts/${source.source.fingerprint}.json`)).toEqual(legacy);
      delete (published as Partial<typeof published>).source;
      expect((await new SourceArtifacts(store).extract(source, offline)).images?.[0].bytes).toEqual(screenshot);
    });

    it('does not replay published evidence from a different source capture', async () => {
      const source = sourceWithFallback();
      const store = makeStore();
      await store.retain(hash(readableText), Buffer.from(readableText), 'text/plain');
      await store.create(`artifacts/${source.source.fingerprint}.json`, { hash: hash(readableText), mime: 'text/plain', retrievedAt: '2026-10-05T10:00:00Z' });
      const evidence: Note['extraction'] = { artifactHash: hash(screenshot), artifactMime: 'image/png', retrievedAt: '2026-10-05T10:01:00Z',
        status: 'image', method: 'image-vision', reason: null, truncated: false };
      await store.retain(hash(screenshot), screenshot, 'image/png');
      for (const different of [{ ...source.source, fingerprint: hash('another capture') }, { ...source.source, id: 'zotero-users-12345-OTHER123' }]) {
        const published = Object.assign(store, { source: async () => ({ note: pinned(different, evidence) }) });
        const replay = await new SourceArtifacts(published).extract(source, offline);
        expect(replay.text).toBe(readableText);
        expect(replay.images).toBeUndefined();
      }
    });

    it('reads an older pinned artifact even after a different artifact becomes the replay selection', async () => {
      const source = sourceWithFallback();
      const store = makeStore();
      const current = await new SourceArtifacts(store).extract(source, { request: async path => new Response(path.includes('AAAAAA11') ? emptyHtml : screenshot) });
      const olderEvidence = { ...current.evidence, artifactHash: hash(emptyHtml), artifactMime: 'text/html' };
      const older = await new SourceArtifacts(store).readForNote(pinned(source.source, olderEvidence));
      expect(older?.bytes).toEqual(Buffer.from(emptyHtml));
      expect(older?.mime).toBe('text/html');
      expect((await new SourceArtifacts(store).readForNote(pinned(source.source, current.evidence)))?.bytes).toEqual(screenshot);
    });

    it('rejects changed retained bytes and never downloads a substitute', async () => {
      const source = sourceWithFallback();
      const store = makeStore();
      const first = await new SourceArtifacts(store).extract(source, { request: async path => new Response(path.includes('AAAAAA11') ? emptyHtml : screenshot) });
      store.files.get(hash(screenshot))!.bytes = Buffer.from('Changed retained bytes');
      offline.request.mockClear();
      await expect(new SourceArtifacts(store).extract(source, offline)).rejects.toThrow('hash does not match');
      await expect(new SourceArtifacts(store).readForNote(pinned(source.source, first.evidence))).rejects.toThrow('hash does not match');
      expect(offline.request).not.toHaveBeenCalled();
    });

    it('rejects replay MIME mismatches and mismatched pinned MIME', async () => {
      const source = sourceWithFallback();
      const store = makeStore();
      const first = await new SourceArtifacts(store).extract(source, { request: async path => new Response(path.includes('AAAAAA11') ? emptyHtml : screenshot) });
      await expect(new SourceArtifacts(store).readForNote(pinned(source.source, { ...first.evidence, artifactMime: 'text/html' }))).rejects.toThrow('MIME does not match');
      store.files.get(hash(screenshot))!.mime = 'text/plain';
      await expect(new SourceArtifacts(store).extract(source, offline)).rejects.toThrow('MIME does not match');
    });

    it('retains truly empty HTML and replays its screenshot without treating captions as page text', async () => {
      const source = sourceWithFallback();
      source.root.data.abstractNote = '<p>A caption with plenty of words that should not turn an empty source page into readable document evidence. '.repeat(3);
      const store = makeStore();
      const first = await new SourceArtifacts(store).extract(source, { request: async path => new Response(path.includes('AAAAAA11') ? '' : screenshot) });
      expect(store.files.get(hash(''))?.bytes.length).toBe(0);
      expect(first.evidence).toMatchObject({ status: 'image', method: 'image-vision', artifactHash: hash(screenshot) });
      expect((await new SourceArtifacts(store).extract(source, offline)).evidence).toEqual(first.evidence);
    });

    it('runs failed browser recovery once before retaining the synced screenshot fallback', async () => {
      const source = sourceWithFallback();
      const store = makeStore();
      const browser = vi.fn(async () => { throw new Error('Browser recovery failed'); });
      const first = await new SourceArtifacts(store).extract(source, { request: async path => new Response(path.includes('AAAAAA11') ? emptyHtml : screenshot) }, browser);
      expect(browser).toHaveBeenCalledTimes(1);
      expect(first.evidence.method).toBe('image-vision');
      expect(store.files.size).toBe(2);
      await new SourceArtifacts(store).extract(source, offline, browser);
      expect(browser).toHaveBeenCalledTimes(1);
    });

    it('reports missing retained bytes without fetching a replacement', async () => {
      const source = sourceWithFallback();
      const store = makeStore();
      const first = await new SourceArtifacts(store).extract(source, { request: async path => new Response(path.includes('AAAAAA11') ? emptyHtml : screenshot) });
      store.files.delete(hash(screenshot));
      offline.request.mockClear();
      await expect(new SourceArtifacts(store).extract(source, offline)).rejects.toBeInstanceOf(MissingArtifact);
      await expect(new SourceArtifacts(store).readForNote(pinned(source.source, first.evidence))).rejects.toBeInstanceOf(MissingArtifact);
      expect(offline.request).not.toHaveBeenCalled();
    });

    it('keeps the earlier immutable input when a concurrent retention wins', async () => {
      const source = sourceWithFallback();
      source.children[0].data.contentType = 'text/plain';
      const store = makeStore();
      let release!: () => void;
      const waiting = new Promise<void>(resolve => { release = resolve; });
      let started!: () => void;
      const fetching = new Promise<void>(resolve => { started = resolve; });
      const later = new SourceArtifacts(store).extract(source, { request: async () => { started(); await waiting; return new Response(readableText + ' Later response.'); } });
      await fetching;
      const winner = await new SourceArtifacts(store).extract(source, { request: async () => new Response(readableText) });
      release();
      expect(await later).toEqual(winner);
      expect(await new SourceArtifacts(store).extract(source, offline)).toEqual(winner);
      expect(store.files.has(hash(readableText + ' Later response.'))).toBe(true);
    });
  });
}

it('bounds Blob reads before download and rejects an ETag change', async () => {
  const store = blobArtifactStore();
  const download = vi.fn(async () => Buffer.from(readableText));
  vi.spyOn(store.raw, 'getBlockBlobClient').mockReturnValue({
    getProperties: async () => ({ contentLength: 21 * 1024 * 1024, contentType: 'text/plain', etag: 'original' }),
    downloadToBuffer: download
  } as never);
  await expect(store.readArtifact(hash(readableText))).rejects.toThrow('byte limit');
  expect(download).not.toHaveBeenCalled();
  vi.spyOn(store.raw, 'getBlockBlobClient').mockReturnValue({
    getProperties: async () => ({ contentLength: 1, contentType: 'text/plain', etag: 'original' }),
    downloadToBuffer: async (_offset: number, _length: number, options: { conditions: { ifMatch: string } }) => {
      expect(options.conditions.ifMatch).toBe('original');
      throw Object.assign(new Error('ETag changed'), { statusCode: 412 });
    }
  } as never);
  await expect(store.readArtifact(hash(readableText))).rejects.toThrow('ETag changed');
});
