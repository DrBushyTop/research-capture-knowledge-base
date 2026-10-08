import { expect, it } from 'vitest';
import { downloadPublic, extractArtifact, savedMetadata } from '../apps/worker/src/extraction.js';
import { SourceArtifacts } from '../apps/worker/src/source-artifacts.js';
import { hash, normalize } from '../shared/corpus.js';
import { snapshot } from './fixtures.js';
import { layoutPdf, pdfFixture } from './pdf-fixture.js';
import { MemorySourceArtifactStore, screenshot } from './source-artifacts-fixture.js';

it('preserves PDF headings, paragraph breaks and page boundaries from retained bytes', async () => {
  const source = normalize(structuredClone(snapshot))[0];
  const result = await extractArtifact(source, { bytes: layoutPdf(), mime: 'application/pdf', retrievedAt: '2026-10-05T10:00:00Z' });
  expect(result.text).toContain('# Synthetic layout study');
  expect(result.text).toContain('## Methods');
  expect(result.text).toContain('\n\n');
  expect(result.text).toContain('<!-- PDF page 1 -->');
  expect(result.text).toContain('<!-- PDF page 2 -->');
  expect(result.text.indexOf('First paragraph')).toBeLessThan(result.text.indexOf('Second paragraph'));
  expect(result.text.indexOf('Second paragraph')).toBeLessThan(result.text.indexOf('Final paragraph'));
  expect(result.evidence).toMatchObject({ method: 'pdf-text', status: 'text', truncated: false, artifactMime: 'application/pdf', retrievedAt: '2026-10-05T10:00:00Z' });
});

it('retains a blank PDF but reports that it needs OCR or review', async () => {
  const source = normalize(structuredClone(snapshot))[0];
  const bytes = pdfFixture(['']);
  const store = new MemorySourceArtifactStore();
  const result = await new SourceArtifacts(store).extract(source, { request: async () => new Response(bytes) });
  expect(store.files.get(hash(bytes))?.bytes).toEqual(bytes);
  expect(result.text).toBe('');
  expect(result.evidence).toMatchObject({ method: 'pdf-text', status: 'needs-review' });
  expect(result.evidence.reason).toContain('OCR or manual review');
  expect(result.evidence.artifactHash).toBe(hash(bytes));
});

it('retains synced screenshot bytes and passes them to vision with an honest evidence label', async () => {
  const source = normalize(structuredClone(snapshot))[0];
  source.children[0].data.contentType = 'image/png';
  source.root.data.abstractNote = '<p>The saved caption.</p>';
  const store = new MemorySourceArtifactStore();
  const result = await new SourceArtifacts(store).extract(source, { request: async () => new Response(screenshot, { headers: { 'content-type': 'image/png' } }) });
  expect(result.images?.[0].bytes).toEqual(store.files.get(hash(screenshot))?.bytes);
  expect(result.images?.[0].mime).toBe('image/png');
  expect(result.text).toBe('The saved caption.');
  expect(result.evidence.status).toBe('image');
  expect(result.evidence.method).toBe('image-vision');
  expect(result.evidence.reason).toContain('not a verified text transcription');
});

it('retains invalid or unsupported images without pretending that vision evidence is available', async () => {
  const source = normalize(structuredClone(snapshot))[0]; source.children[0].data.contentType = 'image/svg+xml';
  const store = new MemorySourceArtifactStore();
  const result = await new SourceArtifacts(store).extract(source, { request: async () => new Response('<svg></svg>') });
  expect(store.files.size).toBe(1);
  expect(result.images).toBeUndefined();
  expect(result.evidence.status).toBe('needs-review');
  expect(result.evidence.reason).toContain('not supported');
});

it('marks retained videos as unsupported and directs the user to save a still image', async () => {
  const source = normalize(structuredClone(snapshot))[0]; source.children[0].data.contentType = 'video/mp4';
  const result = await new SourceArtifacts(new MemorySourceArtifactStore()).extract(source, { request: async () => new Response('synthetic unsupported video') });
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
  const source = normalize(structuredClone(snapshot))[0]; source.children[0].data.contentType = 'text/html';
  const store = new MemorySourceArtifactStore();
  const result = await new SourceArtifacts(store).extract(source, { request: async () => new Response('<html><head><title>Synthetic methods</title></head><body><article><h1>Methods</h1><p>This synthetic source describes how to distinguish reported observations from interpretations when reading a research paper. It deliberately includes enough text to be an extractable article.</p><script>throw new Error("source code executed")</script><img src="http://127.0.0.1/private"></article></body></html>', { headers: { 'content-type': 'text/html' } }) });
  expect(result.text).toContain('distinguish reported observations from interpretations');
  expect(result.text).not.toContain('source code executed');
  expect(result.evidence.status).toBe('text');
  expect(store.files.size).toBe(1);
  const replay = await new SourceArtifacts(store).extract(source, { request: async () => { throw new Error('Original unavailable'); } });
  expect(replay).toEqual(result);
});

it('uses saved captions as labelled metadata without treating them as extracted page text', async () => {
  const source = normalize(structuredClone(snapshot))[0];
  source.root.data.abstractNote = '<p>A saved social caption about a satellite.</p><script>Never run this</script>';
  const evidence = { status: 'needs-review' as const, method: 'html' as const, reason: 'No page text', truncated: false, retrievedAt: new Date().toISOString(), artifactHash: null };
  const result = savedMetadata(source, evidence);
  expect(result.text).toBe('A saved social caption about a satellite.');
  expect(result.evidence.method).toBe('zotero-metadata');
  expect(result.evidence.status).toBe('metadata-only');
  expect(result.evidence.reason).toContain('original document or post text was unavailable');
});
it('recovers a language gate through bounded browser evidence without replacing the original artifact', async () => {
  const source = normalize(structuredClone(snapshot))[0]; source.children[0].data.contentType = 'text/html';
  const store = new MemorySourceArtifactStore();
  const original = '<html><body>Choose your language</body></html>';
  const result = await new SourceArtifacts(store).extract(source, { request: async () => new Response(original) }, async () => ({
    version: 'browser-1', sourceUrl: source.source.url!, retrievedAt: '2026-10-06T12:00:00Z', text: 'Pizza section\nMargherita: tomato, mozzarella, basil. Price 10 EUR. Some menu sections were not inspected.'.repeat(2), views: [{ url: source.source.url!, title: 'Menu', text: 'Menu dishes and prices captured. '.repeat(5), controls: [], blockedRequests: 0 }], actions: [], complete: false, stopReason: 'view-limit', coverage: 'Desserts not captured.'
  }));
  expect(result.evidence.method).toBe('browser');
  expect(result.evidence.truncated).toBe(true);
  expect(result.evidence.reason).toContain('Desserts not captured');
  expect(result.text).toContain('Margherita');
  expect(store.files.size).toBe(1);
  expect(store.files.get(hash(original))?.bytes).toEqual(Buffer.from(original));
  expect(result.evidence.artifactHash).toBe(hash(original));
});
it('keeps metadata fallback when browser recovery fails, without losing the original', async () => {
  const source = normalize(structuredClone(snapshot))[0]; source.children[0].data.contentType = 'text/html';
  const store = new MemorySourceArtifactStore();
  const result = await new SourceArtifacts(store).extract(source, { request: async () => new Response('<html><body>Choose language</body></html>') }, async () => { throw new Error('Browser blocked'); });
  expect(result.evidence.method).not.toBe('browser');
  expect(result.evidence.status).not.toBe('text');
  expect(store.files.size).toBe(1);
});
