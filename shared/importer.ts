import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { hash, noteSchema, privatePublication, renderMarkdown, type Note } from './corpus.js';
const receiptSchema = z.strictObject({ generationId: z.string().regex(/^[a-f0-9]{64}$/), generatedHashes: z.strictObject({ 'index.md': z.string(), 'analysis.json': z.string() }) });
async function readOptional(file: string) {
  try { if ((await lstat(file)).isSymbolicLink()) throw new Error('Corpus symlinks are not supported'); return await readFile(file, 'utf8'); }
  catch (error) { if ((error as {code?: string}).code === 'ENOENT') return undefined; throw error; }
}
export async function applyCandidate(root: string, input: Note): Promise<'written' | 'already-written' | 'conflict'> {
  const note = noteSchema.parse(input);
  const dir = path.join(root, note.source.id);
  try { if ((await lstat(dir)).isSymbolicLink()) throw new Error('Corpus symlinks are not supported'); }
  catch (error) { if ((error as {code?: string}).code !== 'ENOENT') throw error; }
  const previousText = await readOptional(path.join(dir, '_receipt.json'));
  const receipt = previousText ? receiptSchema.parse(JSON.parse(previousText)) : undefined;
  if (receipt?.generationId === note.generationId) return 'already-written';
  for (const file of ['index.md', 'analysis.json'] as const) {
    const existing = await readOptional(path.join(dir, file));
    if (existing !== undefined && (!receipt || hash(existing) !== receipt.generatedHashes[file])) return 'conflict';
  }
  const files = { 'index.md': renderMarkdown(note), 'analysis.json': JSON.stringify(note, null, 2) + '\n' };
  await mkdir(dir, { recursive: true });
  for (const [file, body] of Object.entries(files)) await writeFile(path.join(dir, file), body, 'utf8');
  if (await readOptional(path.join(dir, 'notes.md')) === undefined) await writeFile(path.join(dir, 'notes.md'), '# Human notes\n\n', 'utf8');
  if (await readOptional(path.join(dir, 'publication.json')) === undefined) await writeFile(path.join(dir, 'publication.json'), JSON.stringify(privatePublication, null, 2) + '\n', 'utf8');
  await writeFile(path.join(dir, '_receipt.json'), JSON.stringify({ generationId: note.generationId, generatedHashes: Object.fromEntries(Object.entries(files).map(([file, text]) => [file, hash(text)])) }, null, 2) + '\n', 'utf8');
  return 'written';
}
