import { readFile } from 'node:fs/promises';
import { BlobStore } from '../apps/worker/src/storage.js';
import { SqlStore } from '../apps/worker/src/sql-store.js';
import { closeSql } from '../apps/worker/src/sql-connection.js';
import { readCorpus } from '../shared/reader.js';
import { chatCorpusSchema } from '../shared/chat.js';
import { canonical, noteSchema } from '../shared/corpus.js';

// Run only after stopping processing and user writes. Never deletes the original blobs or Git files.
const sql = new SqlStore(process.env.STORAGE_ACCOUNT!);
try {
  if (process.argv.includes('--seed-local')) {
    for (const entry of await readCorpus('content/research', 'private')) {
      const human = await readFile(`content/research/${entry.note.source.id}/notes.md`, 'utf8');
      await sql.withLease('sql-import', () => sql.publishNote(entry.note, human, entry.publication));
    }
    console.log(JSON.stringify({ seeded: (await sql.sources()).length }));
  } else {
    const blobs = new BlobStore(process.env.STORAGE_ACCOUNT!);
    let imported = 0;
    await blobs.withLease('poll', async () => {
      // locks are ephemeral; binary content remains in place.
      for (const key of await blobs.list('')) {
        if (key.startsWith('locks/') || !key.endsWith('.json')) continue;
        const value = await blobs.read(key);
        await sql.create(key, value);
        if (key !== 'chat/current.json' && canonical(await sql.read(key)) !== canonical(value)) throw new Error(`Import mismatch: ${key}`);
        imported++;
      }
      const current = await blobs.read<{ revision: string }>('chat/current.json');
      const corpus = current ? chatCorpusSchema.parse(await blobs.read(`chat/corpora/${current.revision}.json`)) : undefined;
      for (const entry of await readCorpus('content/research', 'private')) {
        const human = await readFile(`content/research/${entry.note.source.id}/notes.md`, 'utf8');
        const deployed = corpus?.sources.find(s => s.note.source.id === entry.note.source.id);
        await sql.withLease('sql-import', () => sql.publishNote(deployed?.note || entry.note, deployed?.humanMarkdown ?? human, entry.publication));
      }
      // A completed processing job may not have reached the last static deployment.
      for (const key of await blobs.list('sources/')) {
        const state = await blobs.read<{ generationId: string }>(key);
        if (!state) continue;
        const staged = await blobs.read(`staged/${state.generationId}.json`);
        if (staged) await sql.withLease('sql-import', () => sql.publishNote(noteSchema.parse(staged)));
      }
    });
    console.log(JSON.stringify({ importedRecords: imported, sources: (await sql.sources()).length, originalsPreserved: true }));
  }
} finally { await closeSql(); }
