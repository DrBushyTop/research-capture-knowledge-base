import { requireSourceState } from './source-lifecycle.js';
import type { BlobStore } from './storage.js';
import { hash, noteArtifacts, noteSchema } from '../../../shared/corpus.js';
import { ChatAccessError, chatStatus } from './chat-service.js';
import { chatCorpusSchema, type ChatAsset, type ChatJob } from '../../../shared/chat.js';

export async function readChatFile(store: BlobStore, owner: string, id: string, assetId: string | null, sourceId: string | null, evidenceId: string | null = null) {
  const status = await chatStatus(store, owner, id);
  if (status.status !== 'complete' || !status.result) throw new ChatAccessError(404, 'File not found');
  const result = status.result;
  let artifactHash: string | undefined;
  if (assetId) {
    if (!/^a_[a-f0-9]{16}$/.test(assetId)) throw new ChatAccessError(404, 'File not found');
    const asset = await store.read<ChatAsset>(`chat/assets/${id}/${assetId}.json`);
    if (!asset || (!result.attachments.some(item => item.id === assetId) && !result.citations.some(cite => cite.sourceId === asset.sourceId))) throw new ChatAccessError(404, 'File not found');
    await requireSourceState(store, asset.sourceId, true);
    const originId = asset.originJobId || id;
    if (originId !== id) await chatStatus(store, owner, originId);
    if (asset.kind === 'image' && asset.blobKey === `chat/assets/${originId}/${assetId}.png`) {
      const blob = store.container.getBlockBlobClient(asset.blobKey);
      const properties = await blob.getProperties({ abortSignal: AbortSignal.timeout(20000) });
      if (!properties.contentLength || properties.contentLength > 5 * 1024 * 1024) throw new ChatAccessError(404, 'File unavailable');
      const bytes = await blob.downloadToBuffer(0, undefined, { conditions: { ifMatch: properties.etag }, abortSignal: AbortSignal.timeout(20000) });
      await requireSourceState(store, asset.sourceId, true);
      return { bytes, mime: 'image/png', filename: 'page.png' };
    }
    if (asset.kind === 'pdf' || asset.kind === 'image' && asset.artifactHash) { sourceId = asset.sourceId; artifactHash = asset.artifactHash; }
    else throw new ChatAccessError(404, 'File not found');
  }
  if (!sourceId || (!result.citations.some(cite => cite.sourceId === sourceId) && !result.attachments.some(item => item.sourceId === sourceId && (item.kind === 'pdf' || item.kind === 'image' && item.id === assetId)))) throw new ChatAccessError(404, 'File not found');
  await requireSourceState(store, sourceId, true);
  const job = (await store.read<ChatJob>(`chat/jobs/${id}.json`))!;
  const corpus = chatCorpusSchema.parse(await store.read(`chat/corpora/${job.corpusRevision}.json`));
  let note = corpus.sources.find(source => source.note.source.id === sourceId)?.note;
  const citation = result.citations.find(cite => cite.sourceId === sourceId && (!evidenceId || cite.evidenceId === evidenceId));
  if (evidenceId && !citation) throw new ChatAccessError(404, 'File not found');
  if (citation?.generationId && citation.generationId !== note?.generationId) {
    if (!/^[a-f0-9]{64}$/.test(citation.generationId)) throw new ChatAccessError(404, 'PDF not found');
    const saved = noteSchema.safeParse(await store.read(`analysis/${citation.generationId}.json`));
    if (!saved.success || saved.data.source.id !== sourceId || saved.data.generationId !== citation.generationId) throw new ChatAccessError(404, 'PDF not found');
    note = saved.data;
  }
  const original = note ? noteArtifacts(note).find(artifact => artifactHash ? artifact.hash === artifactHash : citation?.attachmentKey ? artifact.key === citation.attachmentKey : artifact.hash === note.extraction.artifactHash && artifact.mime === 'application/pdf') : undefined;
  artifactHash ||= original?.hash;
  if (!artifactHash || !/^[a-f0-9]{64}$/.test(artifactHash)) throw new ChatAccessError(404, 'PDF not found');
  if (!original || original.hash !== artifactHash || !['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(original.mime)) throw new ChatAccessError(404, 'Saved file not found');
  const blob = store.raw.getBlockBlobClient(artifactHash);
  const properties = await blob.getProperties({ abortSignal: AbortSignal.timeout(20000) });
  if (!properties.contentLength || properties.contentLength > (original.mime === 'application/pdf' ? 40 : 5) * 1024 * 1024) throw new ChatAccessError(404, 'Saved file unavailable');
  const bytes = await blob.downloadToBuffer(0, undefined, { conditions: { ifMatch: properties.etag }, abortSignal: AbortSignal.timeout(20000) });
  if (hash(bytes) !== artifactHash) throw new ChatAccessError(404, 'Saved file unavailable');
  const extension = ({ 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as Record<string, string>)[original.mime];
  await requireSourceState(store, sourceId, true);
  return { bytes, mime: original.mime, filename: `${sourceId}${original.key ? '-' + original.key : ''}.${extension}` };
}
