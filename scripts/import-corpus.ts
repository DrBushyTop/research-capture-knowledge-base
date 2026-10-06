import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { BlobStore } from '../apps/worker/src/storage.js';
import { type Job, type SourceState } from '../apps/worker/src/pipeline.js';
import { noteSchema, type Note } from '../shared/corpus.js';
import { applyCandidate } from '../shared/importer.js';
import { readFile, writeFile } from 'node:fs/promises';
import { mergeReaderNotes, readerNoteSchema } from '../shared/reader-notes.js';

const account = process.env.STORAGE_ACCOUNT;
if (!account) throw new Error('STORAGE_ACCOUNT is required');
const store = new BlobStore(account);
const execute = promisify(execFile);
const git = async (...args: string[]) => {
  await store.verifyLease();
  const { stdout } = await execute('git', args, { encoding: 'utf8', timeout: 30_000, signal: store.leaseSignal });
  return stdout.trim();
};
const root = path.resolve('content/research');
await store.withLease('poll', async () => {
  const acknowledge: Job[] = [];
  for (const key of await store.list('staged/')) {
    const note = noteSchema.parse(await store.read<Note>(key));
    const current = await store.read<SourceState>(`sources/${note.source.id}.json`);
    if (current?.generationId !== note.generationId) continue;
    const job = await store.read<Job>(`jobs/${note.generationId}.json`);
    if (!job || job.status === 'imported') continue;
    const result = await applyCandidate(root, note);
    if (result === 'conflict') {
      await store.write(`conflicts/${note.source.id}.json`, { generationId: note.generationId, reason: 'Generated files were edited; move human edits into notes.md and restore generated files before replay.', observedAt: new Date().toISOString() });
      console.log(JSON.stringify({ sourceId: note.source.id, status: 'conflict' })); continue;
    }
    acknowledge.push(job);
  }
  let notesUpdated = 0;
  for (const key of await store.list('reader-notes/')) {
    const saved = readerNoteSchema.parse(await store.read(key));
    const file = path.join(root, saved.sourceId, 'notes.md');
    let existing: string;
    try { existing = await readFile(file, 'utf8'); }
    catch (error) { if ((error as { code?: string }).code === 'ENOENT') continue; throw error; }
    const merged = mergeReaderNotes(existing, saved.markdown);
    if (merged !== existing) { await writeFile(file, merged, 'utf8'); notesUpdated++; }
  }
  if (!acknowledge.length && !notesUpdated) return;
  await git('add', '--', 'content/research');
  const changes = await git('diff', '--cached', '--name-only');
  if (changes) await git('commit', '-m', `content: import ${acknowledge.length} captures and ${notesUpdated} reader notes [skip worker]`);
  // Push is never forced. If it fails, no cloud acknowledgements are written.
  // A retry starts from remote HEAD; receipts recover an already-pushed commit.
  if (process.env.IMPORT_PUSH === 'true') await git('push', 'origin', 'HEAD:master');
  else if (process.env.GITHUB_ACTIONS === 'true') throw new Error('Workflow import requires IMPORT_PUSH=true');
  if (process.env.IMPORT_PUSH === 'true') {
    for (const job of acknowledge) await store.withLease(`source-${job.source.id}`, async () => {
      const latest = await store.read<Job>(`jobs/${job.id}.json`);
      if (latest?.status === 'staged') await store.write(`jobs/${job.id}.json`, { ...latest, status: 'imported' });
    });
  }
  console.log(JSON.stringify({ imported: acknowledge.length, cloudAcknowledged: process.env.IMPORT_PUSH === 'true' }));
});
