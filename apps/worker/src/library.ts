import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import type { SqlStore } from './sql-store.js';
import { matchedSourceText } from '../../../shared/source-text.js';

export async function readLibrary(store: SqlStore) {
  const [sources, inputs] = await Promise.all([store.sources(), store.sourceInputs()]);
  return Promise.all(sources.map(async ({ note, humanMarkdown }) => {
    const { text, readerNote } = inputs.get(note.source.id) || {};
    return { note,
    searchText: `${humanMarkdown}\n${readerNote?.markdown || ''}\n${text ? matchedSourceText(note, text) : ''}`,
    humanHtml: sanitizeHtml(await marked.parse(humanMarkdown.replace(/\n<!-- reader-notes -->[\s\S]*?<!-- \/reader-notes -->\n?/g, '').replace(/^# Human notes\s*/, '')), {
      allowedTags: sanitizeHtml.defaults.allowedTags, allowedAttributes: { a: ['href', 'title'] },
      allowedSchemes: ['http', 'https', 'mailto'], allowProtocolRelative: false
    })
  }; }));
}
