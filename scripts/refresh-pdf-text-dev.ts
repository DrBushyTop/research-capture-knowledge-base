import { readFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createStore } from '../apps/worker/src/sql-store.js';
import { closeSql } from '../apps/worker/src/sql-connection.js';
import { pdfText } from '../apps/worker/src/pdf-text.js';
import { hash } from '../shared/corpus.js';
import { sourceText } from '../shared/source-text.js';

// Local fixture repair only. Never replace immutable production generations.
for (const line of (await readFile('.local/dev.env', 'utf8')).split('\n')) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = JSON.parse(match[2]);
}
if (process.env.SQL_DATABASE !== 'research_dev' || process.env.SQL_CONNECTION_STRING ||
    !process.env.AZURITE_CONNECTION_STRING?.includes('BlobEndpoint=http://127.0.0.1:10100/')) {
  throw new Error('PDF fixture refresh requires research_dev SQL and the local blob emulator, without a connection-string override');
}
const store = createStore();
let refreshed = 0;
let missing = 0;
try {
  const localPdfs = new Map<string, Buffer>();
  if (process.argv[2]) {
    for (const file of await readdir(process.argv[2])) {
      if (!file.toLowerCase().endsWith('.pdf')) continue;
      const bytes = await readFile(path.join(process.argv[2], file));
      localPdfs.set(hash(bytes), bytes);
    }
  }
  await mkdir('.local/search-source-text', { recursive: true });
  for (const { note } of await store.sources()) {
    if (note.extraction.method !== 'pdf-text' || !note.extraction.artifactHash || note.extraction.artifacts) continue;
    let bytes = localPdfs.get(note.extraction.artifactHash);
    if (!bytes) {
      try { bytes = await store.raw.getBlockBlobClient(note.extraction.artifactHash).downloadToBuffer(); }
      catch (error) {
        if ((error as { statusCode?: number }).statusCode !== 404) throw error;
        missing++; continue;
      }
    }
    if (hash(bytes) !== note.extraction.artifactHash) throw new Error('Retained PDF hash mismatch');
    const result = await pdfText(bytes);
    const value = sourceText(note, result.text);
    await store.withLease(`pdf-fixture-${note.source.id}`, async () => {
      await store.write(`source-text/${note.generationId}.json`, value);
    });
    await writeFile(`.local/search-source-text/${note.generationId}.json`, JSON.stringify(value));
    refreshed++;
  }
  console.log(JSON.stringify({ refreshedPdfTexts: refreshed, missingRetainedPdfs: missing, modelCalls: 0, database: 'research_dev' }));
} finally { await closeSql(); }
