import { requireSourceState } from './source-lifecycle.js';
import { readFile } from 'node:fs/promises';
import { DefaultAzureCredential } from '@azure/identity';
import { SandboxGroupClient, endpointForRegion } from '@azure/containerapps-sandbox';
import { hash, noteArtifacts } from '../../../shared/corpus.js';
import { chunkText, corpusEvidence, evidenceChunk, packEvidence, type ChatCorpus, type ChatJob, type Evidence } from '../../../shared/chat.js';
import type { BlobStore } from './storage.js';
import { createWorkspace, deleteWorkspace, denyWorkspaceEgress, readWorkspaceFile, writeWorkspaceFile } from './sandbox-lifecycle.js';
import { loadSearchIndex, rankEvidenceSources } from '../../../shared/search.js';
import { pageRangeEvidence, type PageRange, type RangePage } from './chat-page-ranges.js';
const required = (key: string) => { const value = process.env[key]; if (!value) throw new Error(`Missing ${key}`); return value; };
export function sandboxClient() {
  return new SandboxGroupClient(new DefaultAzureCredential(), endpointForRegion(required('SANDBOX_REGION')), required('AZURE_SUBSCRIPTION_ID'), required('AZURE_RESOURCE_GROUP'), required('SANDBOX_GROUP'));
}
export async function gatherEvidence(store: BlobStore, corpus: ChatCorpus, job: ChatJob, record: (id: string) => Promise<void>, options?: { sourceId: string; query?: string; page?: number; pages?: PageRange; attachmentKey?: string; visual?: boolean; signal?: AbortSignal }) {
  if (options) job = { ...job, request: { question: options.query || job.request.question, history: [], sourceId: options.sourceId, ...(options.visual ? { visual: { sourceId: options.sourceId, page: options.page || 1, ...(options.attachmentKey ? { attachmentKey: options.attachmentKey } : {}) } } : {}) } };
  const signal = AbortSignal.any([AbortSignal.timeout(360_000), ...(options?.signal ? [options.signal] : []), ...(store.leaseSignal ? [store.leaseSignal] : [])]);
  const initial = corpusEvidence(corpus);
  const query = [job.request.question, ...job.request.history.filter(turn => turn.role === 'user').map(turn => turn.content)].join('\n');
  const storedIndex = await store.read<{ revision: string; index: unknown }>(`chat/indexes/${corpus.revision}.json`);
  if (storedIndex ? storedIndex.revision !== corpus.revision : !job.request.sourceId) throw new Error('Chat retrieval index does not match corpus');
  const index = storedIndex ? await loadSearchIndex(JSON.stringify(storedIndex.index)) : undefined;
  if (index && (index.documentCount !== corpus.sources.length || corpus.sources.some(source => !index.has(source.note.source.id)))) throw new Error('Chat retrieval index contains different sources');
  const selected = job.request.sourceId ? corpus.sources.filter(entry => entry.note.source.id === job.request.sourceId) : (() => {
    const ranked = rankEvidenceSources(index!, query).slice(0, 4);
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
    const inputs: { sourceId: string; path: string; hash: string; mime: string; attachmentKey?: string; title?: string; visualPage?: number; textPage?: number; textPages?: PageRange; query?: string }[] = [];
    for (const { note } of sources) {
      await requireSourceState(store, note.source.id);
      let originals = noteArtifacts(note).filter(artifact => artifact.analyzed);
      const selectedKey = options?.attachmentKey || job.request.visual?.attachmentKey;
      if (selectedKey) originals = originals.filter(artifact => artifact.key === selectedKey);
      else if (options?.page || options?.pages || job.request.visual?.sourceId === note.source.id) originals = originals.filter(artifact => artifact.hash === note.extraction.artifactHash).slice(0, 1);
      if (selectedKey && !originals.length) throw new Error('Attachment is unavailable in this source generation');
      for (const original of originals) {
      if (options?.pages && original.mime !== 'application/pdf') throw new Error('Page ranges require a retained PDF');
      const raw = store.raw.getBlockBlobClient(original.hash);
      const properties = await raw.getProperties({ abortSignal: signal });
      if (!properties.contentLength || properties.contentLength > 40 * 1024 * 1024) throw new Error('Artifact exceeds chat size limit');
      const bytes = await raw.downloadToBuffer(0, undefined, { abortSignal: signal });
      if (hash(bytes) !== original.hash) throw new Error('Archived artifact hash mismatch');
      if (original.mime && properties.contentType && original.mime !== properties.contentType) throw new Error('Archived artifact MIME mismatch');
      const filename = `${note.source.key}${original.key ? '.' + original.key : ''}.source`;
      await writeWorkspaceFile(sandbox.id, `/workspace/data/${filename}`, bytes, signal);
      inputs.push({ sourceId: note.source.id, path: filename, hash: original.hash, mime: original.mime || properties.contentType || 'application/octet-stream',
        ...(original.key ? { attachmentKey: original.key, title: original.title } : {}),
        ...(options?.page ? { textPage: options.page } : {}), ...(options?.query ? { query: options.query } : {}),
        ...(options?.pages ? { textPages: options.pages } : {}),
        ...(job.request.visual?.sourceId === note.source.id ? { visualPage: job.request.visual.page } : {}) });
      }
    }
    if (job.request.visual && !inputs.some(input => input.sourceId === job.request.visual!.sourceId)) throw new Error('No retained visual artifact for this source');
    await writeWorkspaceFile(sandbox.id, '/workspace/request.json', JSON.stringify({ sources: inputs }), signal);
    const execution = await client.sandboxes.exec(sandbox.id, { command: 'python3 /workspace/evidence.py' }, { abortSignal: signal });
    if (execution.exitCode !== 0) throw new Error('Sandbox source extraction failed');
    const content = await readWorkspaceFile(sandbox.id, '/workspace/evidence.json', 2 * 1024 * 1024, signal);
    const extracted = JSON.parse(Buffer.from(content).toString('utf8')) as { sourceId: string; hash: string; attachmentKey?: string; pageCount?: number; pages: { locator: string; text: string; page?: number; truncated?: boolean }[] }[];
    const evidence = initial.filter(chunk => sources.some(source => source.note.source.id === chunk.sourceId));
    for (const artifact of extracted) {
      const note = sources.find(entry => entry.note.source.id === artifact.sourceId)?.note;
      const original = note ? noteArtifacts(note).find(original => original.hash === artifact.hash && original.key === artifact.attachmentKey) : undefined;
      if (!note || !original) throw new Error('Sandbox returned unknown artifact');
      for (const page of artifact.pages) {
        evidence.push(...chunkText({ sourceId: note.source.id, generationId: note.generationId, title: note.source.title, kind: 'source',
          locator: `${original.key ? 'Attachment ' + original.key + ': ' : ''}${page.locator}`, pdf: original.mime === 'application/pdf',
          ...(original.key ? { attachmentKey: original.key } : {}) }, page.text));
      }
    }
    if (options?.pages) {
      const artifact = extracted[0];
      const note = sources[0].note;
      if (!artifact || artifact.pageCount === undefined) throw new Error('PDF range evidence is unavailable');
      const pages: RangePage[] = artifact.pages.map(page => {
        if (!Number.isInteger(page.page)) throw new Error('PDF range page locator is unavailable');
        return { page: page.page!, text: page.text, truncated: page.truncated,
          locator: `${artifact.attachmentKey ? 'Attachment ' + artifact.attachmentKey + ': ' : ''}${page.locator}` };
      });
      const result = pageRangeEvidence({ sourceId: note.source.id, generationId: note.generationId, title: note.source.title, kind: 'source', pdf: true,
        ...(artifact.attachmentKey ? { attachmentKey: artifact.attachmentKey } : {}) }, options.pages, pages, artifact.pageCount);
      return { evidence: result.passages, coverage: result.coverage, pageCount: artifact.pageCount, image: undefined };
    }
    const original = new Map<string, Evidence>();
    for (const chunk of packEvidence(evidence.filter(chunk => chunk.kind === 'source'), query)) if (!original.has(chunk.sourceId)) original.set(chunk.sourceId, chunk);
    let packed = packEvidence(evidence, query, [...original.values()]);
    if (job.request.visual && visualSource) {
      const bytes = await readWorkspaceFile(sandbox.id, '/workspace/visual.png', 5 * 1024 * 1024, signal);
      if (bytes.length > 5 * 1024 * 1024 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid rendered image');
      const selectedKey = job.request.visual.attachmentKey;
      const visualOriginal = noteArtifacts(visualSource.note).find(artifact => selectedKey ? artifact.key === selectedKey : artifact.hash === visualSource.note.extraction.artifactHash)!;
      const visual = evidenceChunk({ sourceId: visualSource.note.source.id, generationId: visualSource.note.generationId, title: visualSource.note.source.title,
        kind: 'visual', locator: `${visualOriginal.key ? 'Attachment ' + visualOriginal.key + ': ' : ''}${visualOriginal.mime === 'application/pdf' ? `PDF page ${job.request.visual.page}` : 'Stored image'}`,
        pdf: visualOriginal.mime === 'application/pdf', ...(visualOriginal.key ? { attachmentKey: visualOriginal.key } : {}), text: `Rendered image of the retained artifact, page ${job.request.visual.page}. Read only visible content; uncertain values must be stated as uncertain.` });
      image = { dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, evidence: visual };
      packed = packEvidence(evidence, query, [visual, ...original.values()]);
    }
    if (options) packed = packEvidence(evidence.filter(chunk => chunk.kind === 'source'), query, image ? [image.evidence] : []);
    for (const { note } of sources) await requireSourceState(store, note.source.id);
    return { evidence: packed, image, pageCount: extracted[0]?.pageCount };
  } finally {
    // Delete before inference, so waiting for the model consumes no sandbox compute.
    if (id) await deleteWorkspace(id);
  }
}
