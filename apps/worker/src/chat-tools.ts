import { hash } from '../../../shared/corpus.js';
import { corpusEvidence, packEvidence, type ChatActivity, type ChatAsset, type ChatCorpus, type ChatJob, type Evidence } from '../../../shared/chat.js';
import { loadSearchIndex, rankEvidenceSources } from '../../../shared/search.js';
import { matchedSourceText } from '../../../shared/source-text.js';
import type { BlobStore } from './storage.js';
import { gatherEvidence } from './chat-sandbox.js';
import { chatToolSchemas, type ChatToolName, type ChatTools } from './chat-agent.js';

export async function corpusTools(store: BlobStore, corpus: ChatCorpus, job: ChatJob, recordSandbox: (id: string) => Promise<void>, progress: (activity: ChatActivity) => Promise<void>, signal: AbortSignal): Promise<ChatTools> {
  const stored = await store.read<{ revision: string; index: unknown }>(`chat/indexes/${corpus.revision}.json`);
  if (stored?.revision !== corpus.revision) throw new Error('Chat index unavailable');
  const index = await loadSearchIndex(JSON.stringify(stored.index));
  if (index.documentCount !== corpus.sources.length || corpus.sources.some(source => !index.has(source.note.source.id))) throw new Error('Chat index does not match corpus');
  const evidence: Evidence[] = []; const assets: ChatAsset[] = [];
  const addEvidence = (chunks: Evidence[]) => {
    for (const chunk of chunks) {
      const note = corpus.sources.find(source => source.note.source.id === chunk.sourceId)?.note;
      chunk.sourceUrl = note?.source.url || null; chunk.pdf = note?.extraction.method === 'pdf-text' && !!note.extraction.artifactHash;
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
    if (note.extraction.artifactHash && note.extraction.method === 'pdf-text') result.push(await register({ ...base, id: 'a_' + hash(`${note.generationId}:pdf`).slice(0, 16), kind: 'pdf', mime: 'application/pdf', artifactHash: note.extraction.artifactHash }));
    return result;
  };
  const execute = async (name: ChatToolName, input: unknown) => {
    signal.throwIfAborted();
    if (name === 'search_corpus') {
      const { query, offset, limit } = chatToolSchemas.search_corpus.parse(input);
      await progress({ tool: name, title: query ? `Search: ${query}` : 'Sources' });
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
        results.push({ sourceId: id, title: source.note.source.title, type: source.note.source.itemType, snippet, assets: await availableAssets(source) });
      }
      return { content: { total: ids.length, results } };
    }
    const params = name === 'read_source' ? chatToolSchemas.read_source.parse(input) : chatToolSchemas.inspect_media.parse(input);
    const source = corpus.sources.find(source => source.note.source.id === params.sourceId);
    if (!source) throw new Error('Source unavailable');
    await progress({ tool: name, title: source.note.source.title, sourceId: params.sourceId });
    const available = await availableAssets(source);
    if (name === 'read_source' && 'section' in params && params.section !== 'source') {
      const kind = { analysis: 'machine', notes: 'human', metadata: 'metadata' }[params.section] as Evidence['kind'];
      const passages = addEvidence(packEvidence(corpusEvidence({ ...corpus, sources: [source] }).filter(chunk => chunk.kind === kind), params.query));
      return { content: { sourceId: params.sourceId, passages, assets: available } };
    }
    if (!source.note.extraction.artifactHash) return { content: { sourceId: params.sourceId, unavailable: source.note.extraction.reason || 'No retained document', assets: available } };
    const result = await gatherEvidence(store, corpus, job, recordSandbox, { sourceId: params.sourceId, query: 'query' in params ? params.query : '', page: params.page || undefined, visual: name === 'inspect_media', signal });
    const passages = addEvidence(result.evidence.filter(chunk => chunk.kind === 'source' || chunk.kind === 'visual'));
    if (result.image) {
      const id = 'a_' + hash(`${source.note.generationId}:image:${params.page}`).slice(0, 16);
      const blobKey = `chat/assets/${job.id}/${id}.png`;
      await store.createBinary(blobKey, Buffer.from(result.image.dataUrl.split(',')[1], 'base64'), 'image/png');
      available.push(await register({ id, sourceId: params.sourceId, title: source.note.source.title, kind: 'image', mime: 'image/png', page: params.page, blobKey }));
      for (const chunk of passages.filter(chunk => chunk.kind === 'visual')) chunk.assetId = id;
    }
    return { content: { sourceId: params.sourceId, pageCount: result.pageCount, passages, assets: available }, image: result.image?.dataUrl };
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
  return { execute, remember, evidence, assets };
}
