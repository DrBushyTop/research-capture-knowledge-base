import { hash, noteArtifacts } from '../../../shared/corpus.js';
import { citationLabel, chunkText, corpusEvidence, packEvidence, type ChatActivity, type ChatAsset, type ChatCorpus, type ChatJob, type Evidence } from '../../../shared/chat.js';
import { loadSearchIndex, rankEvidenceSources } from '../../../shared/search.js';
import { matchedSourceText } from '../../../shared/source-text.js';
import type { BlobStore } from './storage.js';
import { gatherEvidence } from './chat-sandbox.js';
import { chatToolSchemas, type ChatToolName, type ChatTools } from './chat-agent.js';
import { readUpload } from './chat-uploads.js';
import { DocumentTexts } from './document-text.js';
import { documentTextEvidence } from './chat-page-ranges.js';
import { readCaptureCommentary } from './source-commentary.js';

export async function corpusTools(store: BlobStore, corpus: ChatCorpus, job: ChatJob, recordSandbox: (id: string) => Promise<void>, progress: (activity: ChatActivity) => Promise<void>, signal: AbortSignal): Promise<ChatTools> {
  const stored = await store.read<{ revision: string; index: unknown }>(`chat/indexes/${corpus.revision}.json`);
  if (stored?.revision !== corpus.revision) throw new Error('Chat index unavailable');
  const index = await loadSearchIndex(JSON.stringify(stored.index));
  if (index.documentCount !== corpus.sources.length || corpus.sources.some(source => !index.has(source.note.source.id))) throw new Error('Chat index does not match corpus');
  const evidence: Evidence[] = []; const assets: ChatAsset[] = [];
  const addEvidence = (chunks: Evidence[]) => {
    for (const chunk of chunks) {
      const note = corpus.sources.find(source => source.note.source.id === chunk.sourceId)?.note;
      chunk.sourceUrl = note?.source.url || null; if (note) chunk.label = citationLabel(note.source);
      chunk.pdf = chunk.pdf || !!note && !!note.extraction.artifactHash && (chunk.attachmentKey ? noteArtifacts(note).some(artifact => artifact.key === chunk.attachmentKey && artifact.mime === 'application/pdf') : note.extraction.method === 'pdf-text');
      if (!evidence.some(item => item.id === chunk.id)) evidence.push(chunk);
    }
    return chunks;
  };
  const register = async (asset: ChatAsset) => {
    asset = { originJobId: job.id, ...asset };
    if (!assets.some(item => item.id === asset.id)) { assets.push(asset); await store.create(`chat/assets/${job.id}/${asset.id}.json`, asset); }
    const { blobKey: _blob, artifactHash: _hash, ...publicAsset } = asset;
    return publicAsset;
  };
  const availableAssets = async (source: ChatCorpus['sources'][number]) => {
    const { note } = source; const result = [];
    const base = { sourceId: note.source.id, title: note.source.title, page: null };
    if (note.source.url) result.push(await register({ ...base, id: 'a_' + hash(`${note.generationId}:site`).slice(0, 16), kind: 'site', mime: 'text/html', sourceUrl: note.source.url }));
    for (const artifact of noteArtifacts(note)) {
      const kind = artifact.mime === 'application/pdf' ? 'pdf' : ['image/png', 'image/jpeg', 'image/webp'].includes(artifact.mime) ? 'image' : undefined;
      if (kind) result.push(await register({ ...base, title: artifact.title || base.title,
        id: 'a_' + hash(`${note.generationId}:${kind}:${artifact.key || artifact.hash}`).slice(0, 16), kind, mime: artifact.mime, artifactHash: artifact.hash,
        ...(artifact.key ? { attachmentKey: artifact.key } : {}) }));
    }
    return result;
  };
  const availableDocuments = (source: ChatCorpus['sources'][number]) => noteArtifacts(source.note).map(artifact => ({ attachmentKey: artifact.key || null,
    title: artifact.title || source.note.source.title, mime: artifact.mime, analyzed: artifact.analyzed, limitation: artifact.reason }));
  let step = 0; let current: ChatActivity | undefined;
  const start = async (activity: ChatActivity) => { current = { id: String(++step), ...activity }; await progress(current); };
  const execute = async (name: ChatToolName, input: unknown) => {
    current = undefined;
    const output = await run(name, input).catch(async error => {
      const started = current as ChatActivity | undefined;
      if (started && !signal.aborted) await progress({ ...started, detail: 'Unavailable' });
      throw error;
    });
    // run() sets current when the step actually starts.
    const started = current as ChatActivity | undefined;
    if (started) {
      const content = output.content as { total?: number; results?: unknown[]; passages?: unknown[]; unavailable?: string; pageCount?: number };
      const found = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
      const detail = content.unavailable ? 'No retained document'
        : name === 'search_corpus' ? found(content.total || 0, 'source found', 'sources found')
        : name === 'inspect_media' ? [started.detail, content.passages?.length ? 'viewed' : 'unavailable'].filter(Boolean).join(' ')
        : [started.detail, found(content.passages?.length || 0, 'passage', 'passages')].filter(Boolean).join(' · ');
      await progress({ ...started, detail });
    }
    return output;
  };
  const run = async (name: ChatToolName, input: unknown) => {
    signal.throwIfAborted();
    if (name === 'search_corpus') {
      const { query, offset, limit } = chatToolSchemas.search_corpus.parse(input);
      await start({ tool: name, title: query || 'All sources' });
      const ids = query.trim() ? rankEvidenceSources(index, query) : corpus.sources.map(source => source.note.source.id);
      const results = [];
      for (const id of ids.slice(offset, offset + limit)) {
        const source = corpus.sources.find(source => source.note.source.id === id)!;
        let snippet = source.note.analysis?.summary?.slice(0, 350) || source.note.extraction.reason || '';
        const text = await store.read(`source-text/${source.note.generationId}.json`);
        if (text) {
          const original = matchedSourceText(source.note, text);
          const match = query.toLowerCase().split(/\s+/).map(word => original.toLowerCase().indexOf(word)).find(index => index >= 0);
          if (match !== undefined) snippet = original.slice(Math.max(0, match - 100), match + 350);
        }
        results.push({ sourceId: id, title: source.note.source.title, type: source.note.source.itemType, snippet, documents: availableDocuments(source), assets: await availableAssets(source) });
      }
      return { content: { total: ids.length, results } };
    }
    const params = name === 'read_source' ? chatToolSchemas.read_source.parse(input) : chatToolSchemas.inspect_media.parse(input);
    const source = corpus.sources.find(source => source.note.source.id === params.sourceId);
    if (!source) throw new Error('Source unavailable');
    await start({ tool: name, title: source.note.source.title, sourceId: params.sourceId, ...('pages' in params && params.pages ? { detail: `Pages ${params.pages.start} to ${params.pages.end}` } : params.page ? { detail: `Page ${params.page}` } : 'section' in params && params.section !== 'source' ? { detail: { analysis: 'Generated analysis', notes: 'Human notes', metadata: 'Source facts' }[params.section] } : {}) });
    const available = await availableAssets(source);
    if (name === 'read_source' && 'section' in params && params.section !== 'source') {
      const kind = { analysis: 'machine', notes: 'human', metadata: 'metadata' }[params.section] as Evidence['kind'];
      const chunks = corpusEvidence({ ...corpus, sources: [source] }).filter(chunk => chunk.kind === kind);
      if (kind === 'human') {
        const saved = await readCaptureCommentary(store, source.note);
        if (saved?.text) chunks.push(...chunkText({ sourceId: source.note.source.id, generationId: source.note.generationId, title: source.note.source.title,
          kind: 'human', locator: 'Capture notes and annotations saved in Zotero' }, saved.text));
      }
      const passages = addEvidence(packEvidence(chunks, params.query));
      return { content: { sourceId: params.sourceId, passages, assets: available } };
    }
    if (name === 'read_source' && 'section' in params && params.section === 'source') {
      const range = params.pages || (params.page ? { start: params.page, end: params.page } : undefined);
      const documents = new DocumentTexts(store);
      const selection = params.attachmentKey ? { attachmentKey: params.attachmentKey } : {};
      const document = params.query.trim() && !range && params.offset == null
        ? await documents.find(source.note, params.query, selection, signal)
        : await documents.read(source.note, { ...selection, ...(range ? { startPage: range.start, endPage: range.end } : {}), offset: params.offset || 0, limit: 16_000 });
      if (document) {
        const result = documentTextEvidence({ sourceId: source.note.source.id, generationId: source.note.generationId, title: source.note.source.title,
          kind: 'source', pdf: document.artifact.mime === 'application/pdf', ...(document.artifact.key ? { attachmentKey: document.artifact.key } : {}) }, document, range);
        const passages = addEvidence(result.passages);
        return { content: { sourceId: params.sourceId, artifact: { attachmentKey: document.artifact.key || null, title: document.artifact.title || source.note.source.title, mime: document.artifact.mime },
          passages, coverage: result.coverage, documents: availableDocuments(source), assets: available } };
      }
      if (params.offset) return { content: { sourceId: params.sourceId, unavailable: 'Full text continuation is unavailable for this older capture. Reprocess the source to retain it.', documents: availableDocuments(source), assets: available } };
    }
    if (name === 'read_source' && source.note.extraction.method === 'zotero-metadata') {
      const text = await store.read(`source-text/${source.note.generationId}.json`);
      const passages = text ? addEvidence(packEvidence(chunkText({ sourceId: source.note.source.id, generationId: source.note.generationId, title: source.note.source.title, kind: 'metadata', locator: 'Description or caption saved in Zotero' }, matchedSourceText(source.note, text)), 'query' in params ? params.query : '')) : [];
      return { content: { sourceId: params.sourceId, passages, limitation: source.note.extraction.reason, assets: available } };
    }
    if (name === 'read_source' && !params.page && !('pages' in params && params.pages) && !params.attachmentKey && ['combined', 'docx-text', 'browser', 'text'].includes(source.note.extraction.method)) {
      const cached = await store.read(`source-text/${source.note.generationId}.json`);
      if (cached) {
        const passages = addEvidence(packEvidence(chunkText({ sourceId: source.note.source.id, generationId: source.note.generationId, title: source.note.source.title, kind: 'source', locator: 'Retained source text with labelled attachment provenance' }, matchedSourceText(source.note, cached)), 'query' in params ? params.query : ''));
        return { content: { sourceId: params.sourceId, passages, limitation: source.note.extraction.reason, assets: available } };
      }
    }
    if (!source.note.extraction.artifactHash) return { content: { sourceId: params.sourceId, unavailable: source.note.extraction.reason || 'No retained document', assets: available } };
    const result = await gatherEvidence(store, corpus, job, recordSandbox, { sourceId: params.sourceId, query: 'query' in params ? params.query : '', page: params.page || undefined,
      pages: 'pages' in params ? params.pages || undefined : undefined, attachmentKey: params.attachmentKey || undefined, visual: name === 'inspect_media', signal });
    const passages = addEvidence(result.evidence.filter(chunk => chunk.kind === 'source' || chunk.kind === 'visual'));
    if (result.image) {
      const id = 'a_' + hash(`${source.note.generationId}:image:${params.attachmentKey || 'primary'}:${params.page}`).slice(0, 16);
      const blobKey = `chat/assets/${job.id}/${id}.png`;
      await store.createBinary(blobKey, Buffer.from(result.image.dataUrl.split(',')[1], 'base64'), 'image/png');
      available.push(await register({ id, sourceId: params.sourceId, title: source.note.source.title, kind: 'image', mime: 'image/png', page: params.page, blobKey,
        ...(params.attachmentKey ? { attachmentKey: params.attachmentKey } : {}) }));
      for (const chunk of passages.filter(chunk => chunk.kind === 'visual')) chunk.assetId = id;
    }
    return { content: { sourceId: params.sourceId, pageCount: result.pageCount, passages, ...('coverage' in result ? { coverage: result.coverage } : {}), assets: available }, image: result.image?.dataUrl };
  };
  const remember = async (result: NonNullable<ChatJob['result']>, previousJobId: string) => {
    const previous = await store.read<ChatJob>(`chat/jobs/${previousJobId}.json`);
    if (previous?.owner !== job.owner || previous.conversationId !== job.conversationId) return;
    const ids = new Set([...result.attachments.map(item => item.id), ...result.citations.flatMap(cite => cite.assetId ? [cite.assetId] : [])]);
    for (const id of ids) {
      const asset = await store.read<ChatAsset>(`chat/assets/${previousJobId}/${id}.json`);
      if (asset) await register({ ...asset, originJobId: asset.originJobId || previousJobId });
    }
  };
  const images = async (ids: string[]) => {
    const urls = [];
    for (const id of ids) {
      // An expired earlier screenshot is left out of replay; the current message's images are required.
      try { const upload = await readUpload(store, job.owner, id); urls.push(`data:${upload.mime};base64,${upload.bytes.toString('base64')}`); }
      catch (error) { if (job.request.images?.includes(id)) throw error; }
    }
    return urls;
  };
  return { execute, remember, images, progress, evidence, assets };
}
