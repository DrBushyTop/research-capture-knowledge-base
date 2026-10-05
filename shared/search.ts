import MiniSearch from 'minisearch';
export interface SearchDocument { id: string; title: string; authors: string; topics: string; body: string; type: string; year: string; }
const options = { fields: ['title', 'authors', 'topics', 'body'], storeFields: ['type', 'year', 'topics'], searchOptions: { boost: { title: 5, authors: 2, topics: 3 }, prefix: true, fuzzy: 0.2, combineWith: 'AND' as const } };
export const buildSearchIndex = (documents: SearchDocument[]) => { const index = new MiniSearch<SearchDocument>(options); index.addAll(documents); return index; };
export const loadSearchIndex = (json: string) => MiniSearch.loadJSONAsync<SearchDocument>(json, options);
export function searchIds(index: MiniSearch<SearchDocument>, query: string, filters: { topic?: string; type?: string; year?: string } = {}) {
  const filter = (result: { [key: string]: unknown }) => (!filters.type || result.type === filters.type) && (!filters.year || result.year === filters.year) && (!filters.topic || String(result.topics).split('\n').includes(filters.topic));
  const bounded = query.trim().slice(0, 200).split(/\s+/).slice(0, 12).join(' ');
  return index.search(bounded || MiniSearch.wildcard, { filter }).map(result => String(result.id));
}
