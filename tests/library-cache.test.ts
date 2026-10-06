import { afterEach, expect, it } from 'vitest';
import { cachedLibrary, clearLibrary, rememberLibrary, type LibraryEntry } from '../apps/reader/src/lib/library-cache.js';

afterEach(clearLibrary);
it('keeps source entries in tab memory only for five minutes', () => {
  const entries = [] as LibraryEntry[];
  rememberLibrary(entries, 100);
  expect(cachedLibrary(101)).toBe(entries);
  expect(cachedLibrary(300_099)).toBe(entries);
  expect(cachedLibrary(300_100)).toBeUndefined();
});
it('discards source data when notes, categories or the session change', () => {
  rememberLibrary([], 100);
  clearLibrary();
  expect(cachedLibrary(101)).toBeUndefined();
});
