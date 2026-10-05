import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { readCorpus } from '../shared/reader.js';
import { loadSearchIndex } from '../shared/search.js';
const root = 'apps/reader/dist';
const allowed = await readCorpus('content/research', 'public');
const expected = new Set(allowed.map(entry => entry.note.source.id));
const research = await readdir(path.join(root, 'research')).catch(error => {
  if (error.code === 'ENOENT') return []; throw error;
});
if (research.length !== expected.size || research.some(id => !expected.has(id))) throw new Error('Public routes contain an unapproved source');
const search = await loadSearchIndex(await readFile(path.join(root, 'search-index.json'), 'utf8'));
if (search.documentCount !== expected.size) throw new Error('Public fuzzy index does not match approved routes');
for (const entry of await readCorpus('content/research', 'private')) {
  if (!expected.has(entry.note.source.id) && search.has(entry.note.source.id)) throw new Error('Unapproved source in public search');
}
const files = await readdir(root, { recursive: true });
if (files.some(file => /\.(pdf|docx?|xlsx?|zip)$/i.test(file))) throw new Error('Raw artifact present in reader output');
if (files.some(file => file === 'reader-chat.js' || file === 'chat' || file.startsWith('chat/'))) throw new Error('Private chat route or script in public output');
console.log(JSON.stringify({ publicNotes: expected.size, fuzzyDocuments: search.documentCount, rawArtifacts: 0, privateChat: false }));
