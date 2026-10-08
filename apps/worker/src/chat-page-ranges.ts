import { evidenceChunk, type Evidence } from '../../../shared/chat.js';
import type { DocumentTextRead } from '../../../shared/document-text.js';

export interface PageRange { start: number; end: number; }
export interface RangePage { page: number; locator: string; text: string; truncated?: boolean; }
export interface PageCoverage {
  requested: PageRange; returnedPages: number[]; truncatedPages: number[]; noSelectableTextPages: number[];
  truncated: boolean; nextPage: number | null; pageCount: number;
}

/** Range reads report the pages actually sent to the model, rather than silently ranking them away. */
export function pageRangeEvidence(base: Omit<Evidence, 'id' | 'text' | 'locator'>, requested: PageRange, pages: RangePage[], pageCount: number) {
  const passages: Evidence[] = [];
  const truncatedPages: number[] = [];
  const noSelectableTextPages: number[] = [];
  let stopped = false;
  for (const page of pages) {
    if (page.page < requested.start || page.page > requested.end) throw new Error('Sandbox returned a page outside the requested range');
    const text = page.text.slice(0, 6000);
    const candidate = evidenceChunk({ ...base, locator: page.locator, text });
    if (JSON.stringify([...passages, candidate]).length > 18_000) { stopped = true; break; }
    passages.push(candidate);
    if (page.truncated || text.length < page.text.length) truncatedPages.push(page.page);
    if (!text.trim()) noSelectableTextPages.push(page.page);
  }
  const returnedPages = pages.slice(0, passages.length).map(page => page.page);
  const following = (returnedPages.at(-1) ?? requested.start - 1) + 1;
  const coverage: PageCoverage = { requested, returnedPages, truncatedPages, noSelectableTextPages,
    truncated: stopped || truncatedPages.length > 0 || returnedPages.length < requested.end - requested.start + 1,
    nextPage: following <= Math.min(requested.end, pageCount) ? following : null, pageCount };
  return { passages, coverage };
}

/** Continuation advances only over characters actually included in the tool response. */
export function documentTextEvidence(base: Omit<Evidence, 'id' | 'text' | 'locator'>, document: DocumentTextRead, requested?: PageRange) {
  const passages: Evidence[] = [];
  const returnedPages = new Set<number>();
  let characters = 0;
  let stopped = false;
  for (const section of document.sections) {
    for (let offset = 0; offset < section.text.length; offset += 2000) {
      const text = section.text.slice(offset, offset + 2000);
      const candidate = evidenceChunk({ ...base, locator: `${document.artifact.key ? 'Attachment ' + document.artifact.key + ': ' : ''}${section.locator}, character ${section.offset + offset}`, text });
      if (JSON.stringify([...passages, candidate]).length > 18_000 || passages.length >= 8) { stopped = true; break; }
      passages.push(candidate);
      characters += text.length;
      if (section.page !== undefined) returnedPages.add(section.page);
    }
    if (stopped) break;
  }
  const following = document.offset + characters;
  const nextOffset = following < document.totalLength ? following : null;
  return { passages, coverage: { ...(requested ? { requested } : {}), returnedPages: [...returnedPages], charactersReturned: characters,
    totalCharacters: document.totalLength, documentCharacters: document.documentLength, offset: document.offset, nextOffset,
    nextPage: nextOffset !== null ? [...returnedPages].at(-1) || requested?.start || null : null,
    truncated: document.offset > 0 || nextOffset !== null, complete: document.complete, ...(document.reason ? { reason: document.reason } : {}),
    ...(document.totalPages !== undefined ? { pageCount: document.totalPages } : {}),
    continuation: nextOffset === null ? null : 'Continue with the same attachment and page range using nextOffset as offset.' } };
}
