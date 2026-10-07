import { mkdir, writeFile } from 'node:fs/promises';
import { readCorpus } from '../shared/reader.js';
import { sourceText } from '../shared/source-text.js';
import type { SourceSnapshot } from '../shared/corpus.js';
import { BlobStore } from '../apps/worker/src/storage.js';
import { extractArtifact } from '../apps/worker/src/extraction.js';
import { SourceArtifacts } from '../apps/worker/src/source-artifacts.js';
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
    const cached = await new SourceArtifacts(store).readForNote(note);
    if (!snapshot || snapshot.source.id !== note.source.id || snapshot.source.fingerprint !== note.source.fingerprint || !cached) throw new Error('Published archive or snapshot missing');
    const extracted = await extractArtifact(snapshot, cached);
    const value = sourceText(note, extracted.text);
    await store.create(`source-text/${note.generationId}.json`, value);
    await writeFile(`.local/search-source-text/${note.generationId}.json`, JSON.stringify(value));
    if (value.text) indexed++;
  });
}
console.log(JSON.stringify({ indexedDocumentTexts: indexed, modelCalls: 0 }));
