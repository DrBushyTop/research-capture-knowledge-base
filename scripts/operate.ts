import { BlobStore } from '../apps/worker/src/storage.js';
import { type Job, type SourceState } from '../apps/worker/src/pipeline.js';
import { sourceId } from '../shared/corpus.js';
import { reprocessSource } from '../apps/worker/src/reprocessing.js';
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
  const generationId = await reprocessSource(store, id, jobId => store.send(jobId), process.env.PROCESSING_VERSION);
  console.log(JSON.stringify({ sourceId: id, jobId: generationId, reprocessing: true }));
} else throw new Error('Usage: npm run operate -- status | replay <jobId> | reprocess <sourceId>');
