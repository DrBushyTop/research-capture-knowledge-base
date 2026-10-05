import { expect, it } from 'vitest';
import { downloadPublic, extract } from '../apps/worker/src/extraction.js';
import { normalize } from '../shared/corpus.js';
import { snapshot } from './fixtures.js';
import { Zotero } from '../apps/worker/src/zotero.js';
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
