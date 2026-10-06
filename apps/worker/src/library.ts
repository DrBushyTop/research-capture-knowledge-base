import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import type { SqlStore } from './sql-store.js';
import { matchedSourceText } from '../../../shared/source-text.js';
import type { ReaderNote } from '../../../shared/reader-notes.js';

export async function readLibrary(store: SqlStore) {
  return Promise.all((await store.sources()).map(async ({ note, humanMarkdown }) => {
    const [text, readerNote] = await Promise.all([store.read(`source-text/${note.generationId}.json`), store.read<ReaderNote>(`reader-notes/${note.source.id}.json`)]);
    return { note,
    searchText: `${humanMarkdown}\n${readerNote?.markdown || ''}\n${text ? matchedSourceText(note, text) : ''}`,
    humanHtml: sanitizeHtml(await marked.parse(humanMarkdown.replace(/\n<!-- reader-notes -->[\s\S]*?<!-- \/reader-notes -->\n?/g, '').replace(/^# Human notes\s*/, '')), {
      allowedTags: sanitizeHtml.defaults.allowedTags, allowedAttributes: { a: ['href', 'title'] },
      allowedSchemes: ['http', 'https', 'mailto'], allowProtocolRelative: false
    })
  }; }));
}
