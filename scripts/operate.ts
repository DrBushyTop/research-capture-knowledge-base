import { BlobStore } from '../apps/worker/src/storage.js';
import { type Job, type SourceState } from '../apps/worker/src/pipeline.js';
import { hash, sourceId, type SourceSnapshot } from '../shared/corpus.js';
const account = process.env.STORAGE_ACCOUNT;
if (!account) throw new Error('STORAGE_ACCOUNT is required');
const store = new BlobStore(account);
const [command, id] = process.argv.slice(2);
if (command === 'status') {
  const jobs: Record<string, number> = {};
  for (const key of await store.list('jobs/')) { const job = await store.read<Job>(key); if (job) jobs[job.status] = (jobs[job.status] || 0) + 1; }
  console.log(JSON.stringify({ jobs, conflicts: (await store.list('conflicts/')).length }, null, 2));
} else if (command === 'replay' && /^[a-f0-9]{64}$/.test(id || '')) {
  const job = await store.read<Job>(`jobs/${id}.json`);
  if (!job) throw new Error('Unknown job');
  await store.withLease(`source-${job.source.id}`, async () => {
    const current = await store.read<SourceState>(`sources/${job.source.id}.json`);
    if (current?.generationId !== id) throw new Error('Superseded jobs cannot be replayed; reprocess the current source');
    const latest = await store.read<Job>(`jobs/${id}.json`);
    // Replay resumes infrastructure failures; a new processing version regenerates cached analysis.
    await store.write(`jobs/${id}.json`, { ...latest, status: 'pending', attempts: 0, dispatches: 0, lastQueuedAt: undefined, retryAt: undefined, error: undefined });
    await store.send(id);
  });
  console.log(JSON.stringify({ jobId: id, replayed: true }));
} else if (command === 'reprocess' && sourceId.safeParse(id).success) {
  await store.withLease('poll', async () => {
    const current = await store.read<SourceState>(`sources/${id}.json`);
    if (!current) throw new Error('Unknown source');
    const snapshot = await store.read<SourceSnapshot>(`snapshots/${current.generationId}.json`);
    if (!snapshot) throw new Error('Missing source snapshot');
    const generationId = hash(`${id}:${snapshot.source.fingerprint}:${Date.now()}:manual-reprocess`);
    const snapshotKey = `snapshots/${generationId}.json`;
    await store.create(snapshotKey, snapshot);
    await store.create(`jobs/${generationId}.json`, { id: generationId, source: snapshot.source, snapshotKey, status: 'pending', attempts: 0, observedAt: new Date().toISOString() } satisfies Job);
    await store.write(`sources/${id}.json`, { ...current, generationId, processingVersion: process.env.PROCESSING_VERSION || current.processingVersion || '1' });
    await store.send(generationId);
    console.log(JSON.stringify({ sourceId: id, jobId: generationId, reprocessing: true }));
  });
} else throw new Error('Usage: npm run operate -- status | replay <jobId> | reprocess <sourceId>');
