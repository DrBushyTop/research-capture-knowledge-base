import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { noteSchema, publicationSchema, publicNoteAllowed, type Note, type Publication } from './corpus.js';
export interface CorpusEntry { note: Note; publication: Publication; humanHtml: string; }
export async function readCorpus(root: string, mode: 'private' | 'public'): Promise<CorpusEntry[]> {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if ((error as {code?: string}).code === 'ENOENT') return []; throw error; }
  const result: CorpusEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const note = noteSchema.parse(JSON.parse(await readFile(path.join(dir, 'analysis.json'), 'utf8')));
    if (note.source.id !== entry.name) throw new Error('Corpus identity does not match its directory');
    const publication = publicationSchema.parse(JSON.parse(await readFile(path.join(dir, 'publication.json'), 'utf8')));
    if (!note.source.active || (mode === 'public' && !publicNoteAllowed(note, publication))) continue;
    const human = await readFile(path.join(dir, 'notes.md'), 'utf8');
    const humanHtml = sanitizeHtml(await marked.parse(human.replace(/^# Human notes\s*/, '')), { allowedTags: sanitizeHtml.defaults.allowedTags, allowedAttributes: { a: ['href', 'title'] }, allowedSchemes: ['http', 'https', 'mailto'], allowProtocolRelative: false });
    result.push({ note, publication, humanHtml });
  }
  return result.sort((a, b) => b.note.source.capturedAt.localeCompare(a.note.source.capturedAt));
}
