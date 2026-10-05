import { readFile } from 'node:fs/promises';
import { DefaultAzureCredential } from '@azure/identity';
import { SandboxGroupClient, endpointForRegion } from '@azure/containerapps-sandbox';
import { hash } from '../../../shared/corpus.js';
import { chunkText, corpusEvidence, evidenceChunk, packEvidence, type ChatCorpus, type ChatJob, type Evidence } from '../../../shared/chat.js';
import type { BlobStore } from './storage.js';
import { createWorkspace, deleteWorkspace, denyWorkspaceEgress, readWorkspaceFile, writeWorkspaceFile } from './sandbox-lifecycle.js';
import { loadSearchIndex, rankEvidenceSources } from '../../../shared/search.js';
const required = (key: string) => { const value = process.env[key]; if (!value) throw new Error(`Missing ${key}`); return value; };
export function sandboxClient() {
  return new SandboxGroupClient(new DefaultAzureCredential(), endpointForRegion(required('SANDBOX_REGION')), required('AZURE_SUBSCRIPTION_ID'), required('AZURE_RESOURCE_GROUP'), required('SANDBOX_GROUP'));
}
export async function gatherEvidence(store: BlobStore, corpus: ChatCorpus, job: ChatJob, record: (id: string) => Promise<void>) {
  const signal = AbortSignal.any([AbortSignal.timeout(180_000), ...(store.leaseSignal ? [store.leaseSignal] : [])]);
  const initial = corpusEvidence(corpus);
  const query = [job.request.question, ...job.request.history.filter(turn => turn.role === 'user').map(turn => turn.content)].join('\n');
  const storedIndex = await store.read<{ revision: string; index: unknown }>(`chat/indexes/${corpus.revision}.json`);
  if (storedIndex?.revision !== corpus.revision) throw new Error('Chat retrieval index does not match corpus');
  const index = await loadSearchIndex(JSON.stringify(storedIndex.index));
  if (index.documentCount !== corpus.sources.length || corpus.sources.some(source => !index.has(source.note.source.id))) throw new Error('Chat retrieval index contains different sources');
  const selected = job.request.sourceId ? corpus.sources.filter(entry => entry.note.source.id === job.request.sourceId) : (() => {
    const ranked = rankEvidenceSources(index, query).slice(0, 4);
    const ids = ranked.length ? ranked : [...new Set(packEvidence(initial, query).map(chunk => chunk.sourceId))];
    return ids.map(id => corpus.sources.find(entry => entry.note.source.id === id)!).filter(Boolean);
  })();
  const visualSource = corpus.sources.find(entry => entry.note.source.id === job.request.visual?.sourceId);
  if (visualSource && !selected.includes(visualSource)) selected.unshift(visualSource);
  const sources = selected.slice(0, 4);
  const client = sandboxClient();
  let id: string | undefined;
  let image: { dataUrl: string; evidence: Evidence } | undefined;
  try {
    await createWorkspace(client, signal, async created => { id = created; await record(created); });
    const sandbox = { id: id! };
    await denyWorkspaceEgress(sandbox.id, signal);
    await writeWorkspaceFile(sandbox.id, '/workspace/evidence.py', await readFile(new URL('../sandbox/evidence.py', import.meta.url)), signal);
    await writeWorkspaceFile(sandbox.id, '/workspace/corpus.json', JSON.stringify({ revision: corpus.revision, sources }), signal);
    const inputs: { sourceId: string; path: string; hash: string; mime: string; visualPage?: number }[] = [];
    for (const { note } of sources) {
      if (!note.extraction.artifactHash) continue;
      const raw = store.raw.getBlockBlobClient(note.extraction.artifactHash);
      const properties = await raw.getProperties({ abortSignal: signal });
      if (!properties.contentLength || properties.contentLength > 20 * 1024 * 1024) throw new Error('Artifact exceeds chat size limit');
      const bytes = await raw.downloadToBuffer(0, undefined, { abortSignal: signal });
      if (hash(bytes) !== note.extraction.artifactHash) throw new Error('Archived artifact hash mismatch');
      const filename = `${note.source.key}.source`;
      await writeWorkspaceFile(sandbox.id, `/workspace/data/${filename}`, bytes, signal);
      inputs.push({ sourceId: note.source.id, path: filename, hash: note.extraction.artifactHash, mime: properties.contentType || 'application/octet-stream',
        ...(job.request.visual?.sourceId === note.source.id ? { visualPage: job.request.visual.page } : {}) });
    }
    if (job.request.visual && !inputs.some(input => input.sourceId === job.request.visual!.sourceId)) throw new Error('No retained visual artifact for this source');
    await writeWorkspaceFile(sandbox.id, '/workspace/request.json', JSON.stringify({ sources: inputs }), signal);
    const execution = await client.sandboxes.exec(sandbox.id, { command: 'python3 /workspace/evidence.py' }, { abortSignal: signal });
    if (execution.exitCode !== 0) throw new Error('Sandbox source extraction failed');
    const content = await readWorkspaceFile(sandbox.id, '/workspace/evidence.json', 2 * 1024 * 1024, signal);
    const extracted = JSON.parse(Buffer.from(content).toString('utf8')) as { sourceId: string; hash: string; pages: { locator: string; text: string }[] }[];
    const evidence = initial.filter(chunk => sources.some(source => source.note.source.id === chunk.sourceId));
    for (const artifact of extracted) {
      const note = sources.find(entry => entry.note.source.id === artifact.sourceId)?.note;
      if (!note || note.extraction.artifactHash !== artifact.hash) throw new Error('Sandbox returned unknown artifact');
      for (const page of artifact.pages) {
        evidence.push(...chunkText({ sourceId: note.source.id, generationId: note.generationId, title: note.source.title, kind: 'source', locator: page.locator }, page.text));
      }
    }
    const original = new Map<string, Evidence>();
    for (const chunk of packEvidence(evidence.filter(chunk => chunk.kind === 'source'), query)) if (!original.has(chunk.sourceId)) original.set(chunk.sourceId, chunk);
    let packed = packEvidence(evidence, query, [...original.values()]);
    if (job.request.visual && visualSource) {
      const bytes = await readWorkspaceFile(sandbox.id, '/workspace/visual.png', 5 * 1024 * 1024, signal);
      if (bytes.length > 5 * 1024 * 1024 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid rendered image');
      const visual = evidenceChunk({ sourceId: visualSource.note.source.id, generationId: visualSource.note.generationId, title: visualSource.note.source.title,
        kind: 'visual', locator: `Selected source page ${job.request.visual.page}`, text: `Rendered image of the retained artifact, page ${job.request.visual.page}. Read only visible content; uncertain values must be stated as uncertain.` });
      image = { dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, evidence: visual };
      packed = packEvidence(evidence, query, [visual, ...original.values()]);
    }
    return { evidence: packed, image };
  } finally {
    // Delete before inference, so waiting for the model consumes no sandbox compute.
    if (id) await deleteWorkspace(id);
  }
}
