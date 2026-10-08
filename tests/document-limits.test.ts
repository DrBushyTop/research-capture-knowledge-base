import { expect, it } from 'vitest';
import { extractArtifact } from '../apps/worker/src/extraction.js';
import { normalize } from '../shared/corpus.js';
import { sourceText } from '../shared/source-text.js';
import { snapshot } from './fixtures.js';

it('keeps a long source beyond the former text limit available for analysis and retrieval', async () => {
  const source = normalize(snapshot)[0];
  const text = 'Methods, results and supplementary observations. '.repeat(3000);
  expect(text.length).toBeGreaterThan(120_000);
  const result = await extractArtifact(source, { bytes: Buffer.from(text), mime: 'text/plain', retrievedAt: '2026-10-08T00:00:00Z' });
  expect(result.text).toBe(text.trim());
  expect(result.evidence.truncated).toBe(false);
  expect(sourceText({ source: source.source, generationId: 'a'.repeat(64), extraction: result.evidence }, result.text).text).toBe(result.text);
});

it('marks extraction partial after the new shared 180,000-character boundary', async () => {
  const source = normalize(snapshot)[0];
  const text = 'Readable supplementary observation. '.repeat(6000);
  const result = await extractArtifact(source, { bytes: Buffer.from(text), mime: 'text/plain', retrievedAt: '2026-10-08T00:00:00Z' });
  expect(result.text.length).toBeLessThanOrEqual(180_000);
  expect(result.text.length).toBeGreaterThan(179_990);
  expect(result.evidence.truncated).toBe(true);
});
