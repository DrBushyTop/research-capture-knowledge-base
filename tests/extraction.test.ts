import { expect, it } from 'vitest';
import { downloadPublic, extract } from '../apps/worker/src/extraction.js';
import { normalize } from '../shared/corpus.js';
import { snapshot } from './fixtures.js';
import { Zotero } from '../apps/worker/src/zotero.js';
const screenshot = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

it('retains synced screenshot bytes and passes them to vision with an honest evidence label', async () => {
  const source = normalize(structuredClone(snapshot))[0];
  source.children[0].data.contentType = 'image/png';
  source.root.data.abstractNote = '<p>The saved caption.</p>';
  const zotero = new Zotero('12345', 'synthetic-read-key');
  zotero.request = async () => new Response(screenshot, { headers: { 'content-type': 'image/png' } });
  let retained: Uint8Array | undefined;
  const result = await extract(source, zotero, async (_hash, bytes) => { retained = bytes; });
  expect(result.images?.[0].bytes).toEqual(retained);
  expect(result.images?.[0].mime).toBe('image/png');
  expect(result.text).toBe('The saved caption.');
  expect(result.evidence.status).toBe('image');
  expect(result.evidence.method).toBe('image-vision');
  expect(result.evidence.reason).toContain('not a verified text transcription');
});

it('can analyze a retained image again without the original Zotero file', async () => {
  const source = normalize(structuredClone(snapshot))[0];
  const zotero = new Zotero('12345', 'synthetic-read-key');
  zotero.request = async () => { throw new Error('File unavailable'); };
  const result = await extract(source, zotero, async () => {}, async () => ({ bytes: screenshot, mime: 'image/png', retrievedAt: '2026-10-05T10:00:00Z' }));
  expect(result.text).toBe('');
  expect(result.images?.[0].bytes).toEqual(screenshot);
  expect(result.evidence.retrievedAt).toBe('2026-10-05T10:00:00Z');
});

it('retains invalid or unsupported images without pretending that vision evidence is available', async () => {
  const source = normalize(structuredClone(snapshot))[0]; source.children[0].data.contentType = 'image/svg+xml';
  const zotero = new Zotero('12345', 'synthetic-read-key');
  zotero.request = async () => new Response('<svg></svg>');
  let retained = false;
  const result = await extract(source, zotero, async () => { retained = true; });
  expect(retained).toBe(true);
  expect(result.images).toBeUndefined();
  expect(result.evidence.status).toBe('needs-review');
  expect(result.evidence.reason).toContain('not supported');
});

it('uses a synced screenshot when a saved page snapshot has no readable article text', async () => {
  const source = normalize(structuredClone(snapshot))[0];
  source.children = [{ key: 'AAAAAA11', version: 1, data: { linkMode: 'imported_url', contentType: 'text/html' } },
    { key: 'BBBBBB11', version: 1, data: { linkMode: 'imported_file', contentType: 'image/png' } }];
  const zotero = new Zotero('12345', 'synthetic-read-key');
  const requests: string[] = [];
  zotero.request = async path => {
    requests.push(path);
    return path.includes('AAAAAA11') ? new Response('<html><body>Sign in</body></html>') : new Response(screenshot);
  };
  const result = await extract(source, zotero, async () => {});
  expect(requests).toEqual(['items/AAAAAA11/file', 'items/BBBBBB11/file']);
  expect(result.evidence.method).toBe('image-vision');
  expect(result.images?.[0].bytes).toEqual(screenshot);
});

it('marks retained videos as unsupported and directs the user to save a still image', async () => {
  const source = normalize(structuredClone(snapshot))[0]; source.children[0].data.contentType = 'video/mp4';
  const zotero = new Zotero('12345', 'synthetic-read-key');
  zotero.request = async () => new Response('synthetic unsupported video');
  const result = await extract(source, zotero, async () => {});
  expect(result.images).toBeUndefined();
  expect(result.evidence.status).toBe('needs-review');
  expect(result.evidence.reason).toContain('Video analysis is not supported');
});
it('rejects loopback, mapped IPv6 and credential-bearing destinations before downloading', async () => {
  for (const url of ['http://127.0.0.1/', 'http://[::ffff:127.0.0.1]/', 'http://10.0.0.1/', 'https://name:password@example.org/']) {
    await expect(downloadPublic(url)).rejects.toThrow();
  }
});
it('extracts HTML evidence without executing source scripts or loading external resources', async () => {
  const source = normalize(snapshot)[0]; source.children[0].data.contentType = 'text/html';
  const zotero = new Zotero('12345', 'synthetic-read-key');
  zotero.request = async () => new Response('<html><head><title>Synthetic methods</title></head><body><article><h1>Methods</h1><p>This synthetic source describes how to distinguish reported observations from interpretations when reading a research paper. It deliberately includes enough text to be an extractable article.</p><script>throw new Error("source code executed")</script><img src="http://127.0.0.1/private"></article></body></html>', { headers: { 'content-type': 'text/html' } });
  const retained: Uint8Array[] = [];
  const result = await extract(source, zotero, async (_hash, bytes) => { retained.push(bytes); });
  expect(result.text).toContain('distinguish reported observations from interpretations');
  expect(result.text).not.toContain('source code executed');
  expect(result.evidence.status).toBe('text');
  expect(retained).toHaveLength(1);
});
it('can reprocess an archived input after the original file becomes unavailable', async () => {
  const source = normalize(snapshot)[0];
  const zotero = new Zotero('12345', 'synthetic-read-key');
  zotero.request = async () => { throw new Error('Original source was removed'); };
  const html = new TextEncoder().encode('<article><h1>Archived methods</h1><p>This retained source contains a synthetic description of a research method, sufficient to extract usable evidence and reproduce a note after the original source becomes unavailable.</p></article>');
  const result = await extract(source, zotero, async () => {}, async () => ({ bytes: html, mime: 'text/html', retrievedAt: '2026-10-05T10:00:00Z' }));
  expect(result.text).toContain('reproduce a note after the original source becomes unavailable');
  expect(result.evidence.retrievedAt).toBe('2026-10-05T10:00:00Z');
});
it('prefers readable text over an image attachment on the same source', async () => {
  const source = normalize(snapshot)[0];
  source.children = [{ key: 'AAAAAA11', version: 1, data: { linkMode: 'imported_file', contentType: 'image/png' } },
    { key: 'BBBBBB11', version: 1, data: { linkMode: 'imported_file', contentType: 'text/plain' } }];
  const zotero = new Zotero('12345', 'synthetic-read-key');
  zotero.request = async path => { expect(path).toBe('items/BBBBBB11/file'); return new Response('Readable document evidence should remain available when the same capture contains an image attachment before its text file.'); };
  expect((await extract(source, zotero, async () => {})).text).toContain('Readable document evidence');
});

it('uses saved captions as labelled metadata without treating them as extracted page text', async () => {
  const { savedMetadata } = await import('../apps/worker/src/extraction.js');
  const { normalize } = await import('../shared/corpus.js');
  const { snapshot } = await import('./fixtures.js');
  const source = normalize(snapshot)[0];
  source.root.data.abstractNote = '<p>A saved social caption about a satellite.</p><script>Never run this</script>';
  const evidence = { status: 'needs-review' as const, method: 'html' as const, reason: 'No page text', truncated: false, retrievedAt: new Date().toISOString(), artifactHash: null };
  const result = savedMetadata(source, evidence);
  expect(result.text).toBe('A saved social caption about a satellite.');
  expect(result.evidence.method).toBe('zotero-metadata');
  expect(result.evidence.status).toBe('metadata-only');
  expect(result.evidence.reason).toContain('original document or post text was unavailable');
});
it('recovers a language gate through bounded browser evidence without replacing the original artifact', async () => {
  const source = normalize(snapshot)[0]; source.children[0].data.contentType = 'text/html';
  const zotero = new Zotero('12345', 'synthetic-read-key');
  zotero.request = async () => new Response('<html><body>Choose your language</body></html>');
  let originals = 0;
  const result = await extract(source, zotero, async () => { originals++; }, undefined, async () => ({
    version: 'browser-1', sourceUrl: source.source.url!, retrievedAt: '2026-10-06T12:00:00Z', text: 'Pizza section\nMargherita: tomato, mozzarella, basil. Price 10 EUR. Some menu sections were not inspected.'.repeat(2), views: [{ url: source.source.url!, title: 'Menu', text: 'Menu dishes and prices captured. '.repeat(5), controls: [], blockedRequests: 0 }], actions: [], complete: false, stopReason: 'view-limit', coverage: 'Desserts not captured.'
  }));
  expect(result.evidence.method).toBe('browser');
  expect(result.evidence.truncated).toBe(true);
  expect(result.evidence.reason).toContain('Desserts not captured');
  expect(result.text).toContain('Margherita');
  expect(originals).toBe(1);
});
it('keeps metadata fallback when browser recovery fails, without losing the original', async () => {
  const source = normalize(snapshot)[0]; source.children[0].data.contentType = 'text/html';
  const zotero = new Zotero('12345', 'synthetic-read-key');
  zotero.request = async () => new Response('<html><body>Choose language</body></html>');
  const result = await extract(source, zotero, async () => {}, undefined, async () => { throw new Error('Browser blocked'); });
  expect(result.evidence.method).not.toBe('browser');
  expect(result.evidence.status).not.toBe('text');
});
