import { loadSearchIndex, searchIds } from '../../../shared/search';
const input = document.querySelector<HTMLInputElement>('#search')!;
const topic = document.querySelector<HTMLSelectElement>('#topic')!;
const type = document.querySelector<HTMLSelectElement>('#type')!;
const year = document.querySelector<HTMLSelectElement>('#year')!;
const status = document.querySelector<HTMLElement>('#search-status')!;
const results = document.querySelector<HTMLElement>('#results')!;
const empty = document.querySelector<HTMLElement>('#empty')!;
const rows = new Map([...results.querySelectorAll<HTMLLIElement>('li')].map(row => [row.dataset.id!, row]));
const order = new Map([...rows.keys()].map((id, position) => [id, position]));
let indexPromise: ReturnType<typeof loadSearchIndex> | undefined;
let revision = 0;
let timer: ReturnType<typeof setTimeout>;
async function update() {
  const current = ++revision;
  status.textContent = 'Searching…';
  try {
    indexPromise ??= fetch('/search-index.json').then(async response => {
      if (!response.ok) throw new Error('Search index unavailable');
      return loadSearchIndex(await response.text());
    }).catch(error => { indexPromise = undefined; throw error; });
    const index = await indexPromise;
    if (current !== revision) return;
    const ids = searchIds(index, input.value, { topic: topic.value, type: type.value, year: year.value });
    if (!input.value.trim()) ids.sort((a, b) => order.get(a)! - order.get(b)!);
    for (const row of rows.values()) row.hidden = true;
    for (const id of ids) { const row = rows.get(id); if (row) { row.hidden = false; results.append(row); } }
    status.textContent = `${ids.length} ${ids.length === 1 ? 'source' : 'sources'}`;
    empty.hidden = ids.length > 0;
  } catch {
    if (current === revision) status.textContent = 'Search could not load. Your sources are still listed. Change the search to try again.';
  }
}
input.addEventListener('input', () => { ++revision; clearTimeout(timer); timer = setTimeout(() => { void update(); }, 80); });
for (const select of [topic, type, year]) select.addEventListener('change', () => { clearTimeout(timer); void update(); });
input.addEventListener('focus', () => { if (!indexPromise) void update(); }, { once: true });
