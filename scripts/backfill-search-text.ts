import { mkdir, writeFile } from 'node:fs/promises';
import { readCorpus } from '../shared/reader.js';
import { sourceText } from '../shared/source-text.js';
import { hash, type SourceSnapshot } from '../shared/corpus.js';
import { BlobStore } from '../apps/worker/src/storage.js';
import { extract } from '../apps/worker/src/extraction.js';
import { Zotero } from '../apps/worker/src/zotero.js';
import type { Job } from '../apps/worker/src/pipeline.js';
const account = process.env.STORAGE_ACCOUNT; if (!account) throw new Error('STORAGE_ACCOUNT is required');
const store = new BlobStore(account);
await mkdir('.local/search-source-text', { recursive: true });
let indexed = 0;
for (const { note } of await readCorpus('content/research', 'private')) {
  if (!note.extraction.artifactHash) continue;
  await store.withLease(`search-text-${note.generationId}`, async () => {
    const job = await store.read<Job>(`jobs/${note.generationId}.json`);
    const snapshot = job && await store.read<SourceSnapshot>(job.snapshotKey);
    let cached = await store.restoreSource(note.source.fingerprint);
    if (!cached) {
      const blob = store.raw.getBlockBlobClient(note.extraction.artifactHash!);
      const properties = await blob.getProperties();
      cached = { bytes: await blob.downloadToBuffer(), mime: properties.contentType || 'application/octet-stream', retrievedAt: note.extraction.retrievedAt };
    }
    if (!snapshot || !cached || hash(cached.bytes) !== note.extraction.artifactHash) throw new Error('Published archive or snapshot missing');
    const extracted = await extract(snapshot, new Zotero(note.source.libraryId, 'unused'), async () => {}, async () => cached);
    const value = sourceText(note, extracted.text);
    await store.create(`source-text/${note.generationId}.json`, value);
    await writeFile(`.local/search-source-text/${note.generationId}.json`, JSON.stringify(value));
    if (value.text) indexed++;
  });
}
console.log(JSON.stringify({ indexedDocumentTexts: indexed, modelCalls: 0 }));
