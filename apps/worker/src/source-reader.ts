import { hash, noteArtifacts, sourceId, type Note } from '../../../shared/corpus.js';
import { chatCorpusSchema } from '../../../shared/chat.js';
import { matchedSourceText } from '../../../shared/source-text.js';
import { ChatAccessError } from './chat-service.js';
import type { PipelineStore } from './pipeline.js';
import type { BlobStore } from './storage.js';
import { DocumentTexts } from './document-text.js';
import type { DocumentTextReadOptions } from '../../../shared/document-text.js';
import { readCaptureCommentary } from './source-commentary.js';

type SourceStore = Pick<PipelineStore, 'read'> & { source?(id: string): Promise<{ note: Note } | undefined> };

async function currentNote(store: SourceStore, id: string): Promise<Note> {
  if (!sourceId.safeParse(id).success) throw new ChatAccessError(404, 'Document not found');
  if (store.source) {
    const source = await store.source(id);
    if (!source?.note.source.active || source.note.source.id !== id) throw new ChatAccessError(404, 'Document not found');
    return source.note;
  }
  const current = await store.read<{ revision: string }>('chat/current.json');
  if (!current) throw new ChatAccessError(503, 'The dataset is not ready yet');
  const corpus = chatCorpusSchema.parse(await store.read(`chat/corpora/${current.revision}.json`));
  const note = corpus.sources.find(source => source.note.source.id === id && source.note.source.active)?.note;
  if (!note) throw new ChatAccessError(404, 'Document not found');
  return note;
}

/** Read only text matched to the generation currently deployed in the private reader. */
export async function readSourceText(store: SourceStore, id: string, options: DocumentTextReadOptions = {}) {
  const note = await currentNote(store, id);
  const document = await new DocumentTexts(store).read(note, options);
  if (document) return { ...document, title: note.source.title, extraction: note.extraction,
    ...(!options.offset ? { captureCommentary: await readCaptureCommentary(store, note) } : {}) };
  if (options.attachmentKey || options.startPage || options.endPage || options.offset) throw new ChatAccessError(404, 'Full text is unavailable for this saved attachment');
  const saved = await store.read(`source-text/${note.generationId}.json`);
  return { sourceId: id, title: note.source.title, generationId: note.generationId,
    text: saved ? matchedSourceText(note, saved) : '', extraction: note.extraction, nextOffset: null };
}

/** Original PDF/image access uses corpus membership; arbitrary raw blobs cannot be requested. */
export async function readSourceDocument(store: SourceStore & Pick<BlobStore, 'raw'>, id: string, attachmentKey?: string | null) {
  const note = await currentNote(store, id);
  if (attachmentKey && !/^[A-Z0-9]{8}$/.test(attachmentKey)) throw new ChatAccessError(404, 'Saved attachment not found');
  const reference = noteArtifacts(note).find(artifact => attachmentKey ? artifact.key === attachmentKey : artifact.hash === note.extraction.artifactHash);
  const artifact = reference?.hash;
  const mime = reference?.mime || '';
  const extension = ({ 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'text/plain': 'txt', 'text/markdown': 'md', 'text/csv': 'csv', 'application/json': 'json' } as Record<string, string>)[mime];
  if (!artifact || !/^[a-f0-9]{64}$/.test(artifact) || !extension) throw new ChatAccessError(404, 'No supported saved document or image is available');
  const blob = store.raw.getBlockBlobClient(artifact);
  const signal = AbortSignal.timeout(20_000);
  let properties;
  try { properties = await blob.getProperties({ abortSignal: signal }); }
  catch (error) { if ((error as { statusCode?: number }).statusCode === 404) throw new ChatAccessError(404, 'Saved file is unavailable'); throw error; }
  if (!properties.contentLength || properties.contentLength > 40 * 1024 * 1024) throw new ChatAccessError(413, 'Saved file exceeds the 40 MB viewer limit');
  const bytes = await blob.downloadToBuffer(0, undefined, { conditions: { ifMatch: properties.etag }, abortSignal: signal });
  const signature = mime === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-'
    : mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : mime === 'image/webp' ? bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
    : extension === 'docx' ? bytes[0] === 0x50 && bytes[1] === 0x4b : true;
  if (!signature || hash(bytes) !== artifact) throw new ChatAccessError(404, 'Saved file is unavailable');
  return { bytes, mime, filename: `${id}${reference?.key ? '-' + reference.key : ''}.${extension}`, disposition: ['pdf', 'png', 'jpg', 'webp'].includes(extension) ? 'inline' : 'attachment' };
}
