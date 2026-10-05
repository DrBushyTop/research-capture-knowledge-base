import { expect, it } from 'vitest';
import { buildSearchIndex, loadSearchIndex, searchIds } from '../shared/search.js';
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
