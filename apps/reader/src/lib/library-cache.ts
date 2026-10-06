import type { Note } from '../../../../shared/corpus.js';

export type LibraryEntry = { note: Note; humanHtml: string; searchText: string };
let saved: { entries: LibraryEntry[]; expires: number } | undefined;
const maxAge = 5 * 60_000;

// Only this tab's memory holds private data. Every Sources mount still checks the API.
export function cachedLibrary(now = Date.now()): LibraryEntry[] | undefined {
  if (saved && saved.expires > now) return saved.entries;
  saved = undefined;
}
export function rememberLibrary(entries: LibraryEntry[], now = Date.now()) {
  saved = { entries, expires: now + maxAge };
}
export function clearLibrary() { saved = undefined; }

if (typeof document !== 'undefined') {
  document.addEventListener('reader:library-changed', clearLibrary);
  document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('.sign-out')) clearLibrary();
  });
}
