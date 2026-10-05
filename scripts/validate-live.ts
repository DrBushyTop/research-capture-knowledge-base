import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import { BlobStore } from '../apps/worker/src/storage.js';
import { Zotero } from '../apps/worker/src/zotero.js';
import { discover, reconcile, type Job } from '../apps/worker/src/pipeline.js';
import { processJob } from '../apps/worker/src/processing.js';
import { extract } from '../apps/worker/src/extraction.js';
import { enrich, licenseEvidence } from '../apps/worker/src/enrichment.js';
import { type Note } from '../shared/corpus.js';
const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const secrets = new SecretClient(required('KEY_VAULT_URI'), new DefaultAzureCredential());
const [id, key] = await Promise.all([secrets.getSecret('zotero-account-id'), secrets.getSecret('zotero-api-key')]);
const zotero = new Zotero(id.value!, key.value!);
const store = new BlobStore(required('STORAGE_ACCOUNT'));
const library = await zotero.snapshot();
if (!library) throw new Error('Missing live library snapshot');
await discover(store, library, process.env.PROCESSING_VERSION || '2');
await reconcile(store, id => store.send(id));
for (const key of await store.list('jobs/')) {
  const job = (await store.read<Job>(key))!;
  await processJob(store, job.id, { version: process.env.PROCESSING_VERSION || '2', model: required('FOUNDRY_DEPLOYMENT'),
    extract: snapshot => extract(snapshot, zotero, (hash, bytes, mime) => store.retainSource(snapshot.source.fingerprint, hash, bytes, mime), () => store.restoreSource(snapshot.source.fingerprint)),
    enrich: (text, signal) => enrich(text, required('FOUNDRY_ENDPOINT'), required('FOUNDRY_DEPLOYMENT'), signal), rights: licenseEvidence });
  const note = await store.read<Note>(`staged/${job.id}.json`);
  console.log(JSON.stringify({ sourceId: job.source.id, status: (await store.read<Job>(key))?.status, extraction: note?.extraction.status, method: note?.extraction.method, reason: note?.extraction.reason, analyzed: Boolean(note?.analysis), model: note?.processing.model }));
}
