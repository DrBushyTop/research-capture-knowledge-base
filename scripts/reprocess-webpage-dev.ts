/** Rerun only one public URL against development SQL. Production is queried read-only to find its source snapshot. */
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { SqlStore } from '../apps/worker/src/sql-store.js';
import { sqlPool, closeSql } from '../apps/worker/src/sql-connection.js';
import { hash, noteSchema, type SourceSnapshot } from '../shared/corpus.js';
import { extract } from '../apps/worker/src/extraction.js';
import { recoverWebpage } from '../apps/worker/src/browser-sandbox.js';
import { enrich, classifySource, enrichTemplate, licenseEvidence } from '../apps/worker/src/enrichment.js';
import { categoryRegistry } from '../apps/worker/src/category-registry.js';
import { processJob } from '../apps/worker/src/processing.js';
import type { Job } from '../apps/worker/src/pipeline.js';

for (const line of (await readFile('.local/dev.env', 'utf8')).split('\n')) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = JSON.parse(match[2]);
}
const url = process.argv[2];
if (!url || new URL(url).protocol !== 'https:') throw new Error('Pass the exact HTTPS source URL');
if (process.env.SQL_DATABASE !== 'research_dev' || process.env.SQL_CONNECTION_STRING && !/database=research_dev(?:;|$)/i.test(process.env.SQL_CONNECTION_STRING)) throw new Error('This command only writes research_dev');
if (!process.env.BROWSER_SANDBOX_SNAPSHOT || !process.env.FOUNDRY_ENDPOINT || !process.env.FOUNDRY_DEPLOYMENT) throw new Error('Browser and model configuration required');
const development = { server: process.env.SQL_SERVER, database: process.env.SQL_DATABASE, connection: process.env.SQL_CONNECTION_STRING };
let original: SourceSnapshot;
try {
  // Read the canonical source only. No source mutation/reprocessing runs while this connection points at production.
  process.env.SQL_SERVER = process.env.SOURCE_SQL_SERVER || process.env.SQL_SERVER;
  process.env.SQL_DATABASE = 'research'; delete process.env.SQL_CONNECTION_STRING;
  const request = (await sqlPool()).request().input('url', url);
  const rows = await request.query("SELECT TOP(1) s.note_json,r.document AS snapshot FROM dbo.Sources s LEFT JOIN dbo.Records r ON r.record_key = N'snapshots/' + s.generation_id + N'.json' WHERE JSON_VALUE(s.note_json,'$.source.url')=@url AND s.active=1");
  const found = rows.recordset[0];
  if (!found?.snapshot) throw new Error('Source or durable source snapshot not found');
  const note = noteSchema.parse(JSON.parse(found.note_json));
  original = JSON.parse(found.snapshot);
  if (original.source.id !== note.source.id || original.source.url !== url) throw new Error('Source snapshot mismatch');
} finally {
  await closeSql();
  process.env.SQL_SERVER = development.server;
  process.env.SQL_DATABASE = development.database;
  if (development.connection) process.env.SQL_CONNECTION_STRING = development.connection;
}
const store = new SqlStore('researchdev');
try {
  // Test fresh live webpage recovery, not Zotero file synchronization. Original root metadata is retained.
  const snapshot = { ...original!, children: [] };
  const registry = await categoryRegistry(store);
  const id = hash(`${snapshot.source.id}:${randomUUID()}:browser-dev`);
  await store.withLease('poll', async () => {
    await store.create(`snapshots/${id}.json`, snapshot);
    await store.create(`jobs/${id}.json`, { id, source: snapshot.source, snapshotKey: `snapshots/${id}.json`, status: 'pending', attempts: 0, observedAt: new Date().toISOString(), categoryPlan: { registry, preserveExisting: true } } satisfies Job);
    await store.write(`sources/${snapshot.source.id}.json`, { generationId: id, source: snapshot.source, processingVersion: 'browser-1' });
  });
  const endpoint = process.env.FOUNDRY_ENDPOINT!; const deployment = process.env.FOUNDRY_DEPLOYMENT!;
  await processJob(store, id, {
    version: 'browser-1', model: deployment,
    extract: source => extract(source, { request: async () => { throw new Error('No Zotero request in webpage-only dev rerun'); } }, (key, bytes, mime) => store.retainSource(source.source.fingerprint, key, bytes, mime), undefined, () => recoverWebpage(source, store, store.leaseSignal || AbortSignal.timeout(180_000))),
    enrich: (text, signal, images) => enrich(text, endpoint, deployment, signal, images),
    classify: (source, text, registry, signal, images) => classifySource(source, text, registry, endpoint, deployment, signal, images),
    analyzeTemplate: (text, template, signal, source, images) => enrichTemplate(text, template, endpoint, deployment, signal, source, images),
    rights: licenseEvidence
  });
  const job = await store.read<Job>(`jobs/${id}.json`);
  const note = (await store.sources()).find(entry => entry.note.source.id === snapshot.source.id)?.note;
  console.log(JSON.stringify({ database: 'research_dev', sourceId: snapshot.source.id, jobId: id, status: job?.status, extraction: note?.extraction, summary: note?.analysis?.summary }));
  if (job?.status !== 'imported' || note?.extraction.method !== 'browser') throw new Error('Browser analysis did not publish successfully in dev');
} finally { await closeSql(); }
