import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import type { SqlStore } from './sql-store.js';
import { sourceLifecycles, requireSourceState } from './source-lifecycle.js';
import { matchedSourceText } from '../../../shared/source-text.js';

const humanHtml = async (markdown: string) => sanitizeHtml(await marked.parse(markdown.replace(/\n<!-- reader-notes -->[\s\S]*?<!-- \/reader-notes -->\n?/g, '').replace(/^# Human notes\s*/, '')), {
  allowedTags: sanitizeHtml.defaults.allowedTags, allowedAttributes: { a: ['href', 'title'] },
  allowedSchemes: ['http', 'https', 'mailto'], allowProtocolRelative: false
});

export async function readLibrary(store: Pick<SqlStore, 'sources' | 'sourceInputs' | 'read' | 'list'>) {
  const [sources, inputs] = await Promise.all([store.sources(), store.sourceInputs()]);
  const entries = await Promise.all(sources.map(async ({ note, humanMarkdown }) => {
    const { text, fullText, generationId, readerNote } = inputs.get(note.source.id) || {};
    if (fullText !== undefined && generationId !== note.generationId) throw new Error('Full reader search text does not match the published generation');
    return { note, searchText: `${humanMarkdown}\n${readerNote?.markdown || ''}\n${fullText || ''}\n${text ? matchedSourceText(note, text) : ''}`, humanHtml: await humanHtml(humanMarkdown) };
  }));
  const lifecycles = await sourceLifecycles(store);
  return entries.filter(entry => !lifecycles[entry.note.source.id] || lifecycles[entry.note.source.id].state === 'active');
}

export async function readTrash(store: Pick<SqlStore, 'retainedSource' | 'read' | 'list'>) {
  const result = [];
  for (const lifecycle of Object.values(await sourceLifecycles(store))) {
    if (!['trashed', 'purging'].includes(lifecycle.state)) continue;
    const saved = lifecycle.state === 'trashed' ? await store.retainedSource(lifecycle.sourceId) : undefined;
    const state = !saved && lifecycle.state === 'trashed' ? await store.read<{ source: { title: string } }>(`sources/${lifecycle.sourceId}.json`) : undefined;
    const entry = saved ? { note: saved.note, searchText: '', humanHtml: await humanHtml(saved.humanMarkdown) } : undefined;
    // A deletion accepted during this read must not expose the retained copy.
    if (entry) await requireSourceState(store, lifecycle.sourceId, true);
    result.push({ sourceId: lifecycle.sourceId, title: saved?.note.source.title || state?.source.title || null, lifecycle, ...(entry ? { entry } : {}) });
  }
  return result;
}
