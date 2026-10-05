const input = document.querySelector('#search');
const filters = ['topic', 'type', 'year'].map(id => document.getElementById(id));
const rows = [...document.querySelectorAll('#results li')];
let sequence = 0;
let index;
async function update() {
  const run = ++sequence;
  const query = input.value.trim();
  let matched;
  const status = document.getElementById('search-status');
  if (query) {
    status.textContent = 'Searching…';
    try {
      index ??= import('/pagefind/pagefind.js');
      const result = await (await index).search(query);
      const data = await Promise.all(result.results.map(r => r.data()));
      matched = new Set(data.map(r => decodeURIComponent(r.url.replace(/index\.html$/, '').split('/').filter(Boolean).at(-1) || '')));
    } catch {
      index = undefined;
      if (run !== sequence) return;
      status.textContent = 'Full-text search is unavailable. Clear your search to browse with filters.';
      return;
    }
  }
  if (run !== sequence) return;
  let count = 0;
  for (const row of rows) {
    const visible = (!matched || matched.has(row.dataset.id)) &&
      (!filters[0].value || JSON.parse(row.dataset.topics).includes(filters[0].value)) &&
      (!filters[1].value || row.dataset.type === filters[1].value) &&
      (!filters[2].value || row.dataset.year === filters[2].value);
    row.hidden = !visible;
    if (visible) count++;
  }
  status.textContent = `${count} ${count === 1 ? 'source' : 'sources'}`;
  document.getElementById('empty').hidden = count > 0;
}
let delay;
input.addEventListener('input', () => {
  clearTimeout(delay);
  delay = setTimeout(() => void update(), 150);
});
filters.forEach(filter => filter.addEventListener('change', () => void update()));
