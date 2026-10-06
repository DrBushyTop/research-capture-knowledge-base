import MiniSearch from 'minisearch';
export interface SearchDocument { id: string; title: string; authors: string; topics: string; body: string; type: string; year: string; category?: string; }
const options = { fields: ['title', 'authors', 'topics', 'body'], storeFields: ['type', 'year', 'topics', 'category'], searchOptions: { boost: { title: 5, authors: 2, topics: 3 }, prefix: true, fuzzy: 0.2, combineWith: 'AND' as const } };
export const buildSearchIndex = (documents: SearchDocument[]) => { const index = new MiniSearch<SearchDocument>(options); index.addAll(documents); return index; };
export const loadSearchIndex = (json: string) => MiniSearch.loadJSONAsync<SearchDocument>(json, options);
const questionWords = new Set('the this that these those what which who when where why how does did can could would should with from have has about into your their there please stored saved source sources paper papers document documents collection answer tell compare based say says said and for are was were not'.split(' '));
export function evidenceQuery(query: string) { return [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])].filter(word => !questionWords.has(word)).slice(0, 60).join(' '); }
export function rankEvidenceSources(index: MiniSearch<SearchDocument>, query: string) {
  const keywords = evidenceQuery(query);
  return keywords ? index.search(keywords, { combineWith: 'OR' }).map(result => String(result.id)) : [];
}
export function searchIds(index: MiniSearch<SearchDocument>, query: string, filters: { topic?: string; type?: string; year?: string; category?: string } = {}) {
  const filter = (result: { [key: string]: unknown }) => (!filters.category || result.category === filters.category) && (!filters.type || result.type === filters.type) && (!filters.year || result.year === filters.year) && (!filters.topic || String(result.topics).split('\n').includes(filters.topic));
  const bounded = query.trim().slice(0, 200).split(/\s+/).slice(0, 12).join(' ');
  return index.search(bounded || MiniSearch.wildcard, { filter }).map(result => String(result.id));
}
