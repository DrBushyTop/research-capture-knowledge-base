import { expect, it } from 'vitest';
import { buildSearchIndex, loadSearchIndex, searchIds } from '../shared/search.js';
import { matchedSourceText, sourceText } from '../shared/source-text.js';
import { normalize } from '../shared/corpus.js';
import { snapshot } from './fixtures.js';
const documents = [
  { id: 'paper', title: 'Management of Fibromyalgia Syndrome', topics: 'pain\nexercise', authors: 'Goldenberg', body: 'A review with uncertain clinical evidence. Personal note: pacing is relevant.', type: 'journalArticle', year: '2004' },
  { id: 'site', title: 'Software architecture notes', topics: 'engineering', authors: 'Pasi', body: 'Cloud architecture and deployment.', type: 'webpage', year: '2026' }
];
it('finds misspelled and partial terms while retaining independent filters', async () => {
  const index = await loadSearchIndex(JSON.stringify(buildSearchIndex(documents)));
  expect(searchIds(index, 'fibromyalga')).toEqual(['paper']);
  expect(searchIds(index, 'arhcitecture')).toEqual(['site']);
  expect(searchIds(index, 'pac')).toEqual(['paper']);
  expect(searchIds(index, 'evidence', { type: 'webpage' })).toEqual([]);
  expect(searchIds(index, '', { topic: 'pain', year: '2004' })).toEqual(['paper']);
});
it('indexes document-only terms and rejects text from a different generation or artifact', async () => {
  const note = { source: normalize(snapshot)[0].source, generationId: 'a'.repeat(64), extraction: { artifactHash: 'b'.repeat(64), status: 'text' as const, method: 'pdf-text' as const, reason: null, truncated: false, retrievedAt: '2026-10-05T10:00:00Z' } };
  const stored = sourceText(note, 'An original PDF passage describes polysomnography.');
  const body = matchedSourceText(note, stored);
  const index = await loadSearchIndex(JSON.stringify(buildSearchIndex([{ ...documents[0], body }])));
  expect(searchIds(index, 'polysomnograpy')).toEqual(['paper']);
  expect(() => matchedSourceText(note, { ...stored, generationId: 'c'.repeat(64) })).toThrow('does not match');
  expect(() => matchedSourceText(note, { ...stored, artifactHash: 'd'.repeat(64) })).toThrow('does not match');
});
