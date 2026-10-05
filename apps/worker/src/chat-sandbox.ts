import { readFile } from 'node:fs/promises';
import { DefaultAzureCredential } from '@azure/identity';
import { SandboxGroupClient, endpointForRegion } from '@azure/containerapps-sandbox';
import { hash } from '../../../shared/corpus.js';
import { chunkText, corpusEvidence, evidenceChunk, packEvidence, type ChatCorpus, type ChatJob, type Evidence } from '../../../shared/chat.js';
import type { BlobStore } from './storage.js';
const required = (key: string) => { const value = process.env[key]; if (!value) throw new Error(`Missing ${key}`); return value; };
export function sandboxClient() {
  return new SandboxGroupClient(new DefaultAzureCredential(), endpointForRegion(required('SANDBOX_REGION')), required('AZURE_SUBSCRIPTION_ID'), required('AZURE_RESOURCE_GROUP'), required('SANDBOX_GROUP'));
}
export async function gatherEvidence(store: BlobStore, corpus: ChatCorpus, job: ChatJob, record: (id: string) => Promise<void>) {
  const signal = AbortSignal.any([AbortSignal.timeout(180_000), ...(store.leaseSignal ? [store.leaseSignal] : [])]);
  const initial = corpusEvidence(corpus);
  const query = [job.request.question, ...job.request.history.filter(turn => turn.role === 'user').map(turn => turn.content)].join('\n');
  const selected = job.request.sourceId ? corpus.sources.filter(entry => entry.note.source.id === job.request.sourceId) : (() => {
    const ids = new Set(packEvidence(initial, query).map(chunk => chunk.sourceId));
    return corpus.sources.filter(entry => ids.has(entry.note.source.id));
  })();
  const visualSource = corpus.sources.find(entry => entry.note.source.id === job.request.visual?.sourceId);
  if (visualSource && !selected.includes(visualSource)) selected.unshift(visualSource);
  const sources = selected.slice(0, 4);
  const client = sandboxClient();
  const sandbox = await client.sandboxes.beginCreate({ sourcesRef: { snapshot: { id: required('SANDBOX_SNAPSHOT') } } }, { abortSignal: signal }).pollUntilDone();
  let image: { dataUrl: string; evidence: Evidence } | undefined;
  try {
    await record(sandbox.id);
    await client.sandboxes.setLifecyclePolicy(sandbox.id, { autoSuspend: { enabled: true, interval: 120, mode: 'Disk' }, autoDelete: { enabled: true, deleteIntervalSeconds: 600 } }, { abortSignal: signal });
    await client.egress.setPolicy(sandbox.id, { defaultAction: 'Deny', trafficInspection: 'Full', hostRules: [], rules: [] }, { abortSignal: signal });
    await client.files.write(sandbox.id, '/workspace/evidence.py', await readFile(new URL('../sandbox/evidence.py', import.meta.url)), { mode: '0444', createDirs: true, abortSignal: signal });
    await client.files.write(sandbox.id, '/workspace/corpus.json', JSON.stringify({ revision: corpus.revision, sources }), { mode: '0444', abortSignal: signal });
    const inputs: { sourceId: string; path: string; hash: string; mime: string; visualPage?: number }[] = [];
    for (const { note } of sources) {
      if (!note.extraction.artifactHash) continue;
      const raw = store.raw.getBlockBlobClient(note.extraction.artifactHash);
      const properties = await raw.getProperties({ abortSignal: signal });
      if (!properties.contentLength || properties.contentLength > 20 * 1024 * 1024) throw new Error('Artifact exceeds chat size limit');
      const bytes = await raw.downloadToBuffer(0, undefined, { abortSignal: signal });
      if (hash(bytes) !== note.extraction.artifactHash) throw new Error('Archived artifact hash mismatch');
      const filename = `${note.source.key}.source`;
      await client.files.write(sandbox.id, `/workspace/data/${filename}`, bytes, { mode: '0444', createDirs: true, abortSignal: signal });
      inputs.push({ sourceId: note.source.id, path: filename, hash: note.extraction.artifactHash, mime: properties.contentType || 'application/octet-stream',
        ...(job.request.visual?.sourceId === note.source.id ? { visualPage: job.request.visual.page } : {}) });
    }
    if (job.request.visual && !inputs.some(input => input.sourceId === job.request.visual!.sourceId)) throw new Error('No retained visual artifact for this source');
    await client.files.write(sandbox.id, '/workspace/request.json', JSON.stringify({ sources: inputs }), { mode: '0444', abortSignal: signal });
    const execution = await client.sandboxes.exec(sandbox.id, { command: 'python3 /workspace/evidence.py' }, { abortSignal: signal });
    if (execution.exitCode !== 0) throw new Error('Sandbox source extraction failed');
    const content = await client.files.read(sandbox.id, '/workspace/evidence.json', { abortSignal: signal });
    const extracted = JSON.parse(Buffer.from(content).toString('utf8')) as { sourceId: string; hash: string; pages: { locator: string; text: string }[] }[];
    const evidence = initial.filter(chunk => !job.request.sourceId || chunk.sourceId === job.request.sourceId);
    for (const artifact of extracted) {
      const note = sources.find(entry => entry.note.source.id === artifact.sourceId)?.note;
      if (!note || note.extraction.artifactHash !== artifact.hash) throw new Error('Sandbox returned unknown artifact');
      for (const page of artifact.pages) {
        evidence.push(...chunkText({ sourceId: note.source.id, generationId: note.generationId, title: note.source.title, kind: 'source', locator: page.locator }, page.text));
      }
    }
    let packed = packEvidence(evidence, query);
    if (job.request.visual && visualSource) {
      const bytes = Buffer.from(await client.files.read(sandbox.id, '/workspace/visual.png', { abortSignal: signal }));
      if (bytes.length > 5 * 1024 * 1024 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid rendered image');
      const visual = evidenceChunk({ sourceId: visualSource.note.source.id, generationId: visualSource.note.generationId, title: visualSource.note.source.title,
        kind: 'visual', locator: `Selected source page ${job.request.visual.page}`, text: `Rendered image of the retained artifact, page ${job.request.visual.page}. Read only visible content; uncertain values must be stated as uncertain.` });
      image = { dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, evidence: visual };
      packed = [visual, ...packed.slice(0, 7)];
    }
    return { evidence: packed, image };
  } finally {
    // Delete before inference, so waiting for the model consumes no sandbox compute.
    await client.sandboxes.beginDelete(sandbox.id, { abortSignal: AbortSignal.timeout(30_000) }).pollUntilDone();
  }
}
