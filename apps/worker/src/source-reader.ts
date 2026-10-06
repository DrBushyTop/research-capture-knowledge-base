import { hash, sourceId, type Note } from '../../../shared/corpus.js';
import { chatCorpusSchema } from '../../../shared/chat.js';
import { matchedSourceText } from '../../../shared/source-text.js';
import { ChatAccessError } from './chat-service.js';
import type { PipelineStore } from './pipeline.js';
import type { BlobStore } from './storage.js';

async function currentNote(store: Pick<PipelineStore, 'read'>, id: string): Promise<Note> {
  if (!sourceId.safeParse(id).success) throw new ChatAccessError(404, 'Document not found');
  const current = await store.read<{ revision: string }>('chat/current.json');
  if (!current) throw new ChatAccessError(503, 'The dataset is not ready yet');
  const corpus = chatCorpusSchema.parse(await store.read(`chat/corpora/${current.revision}.json`));
  const note = corpus.sources.find(source => source.note.source.id === id && source.note.source.active)?.note;
  if (!note) throw new ChatAccessError(404, 'Document not found');
  return note;
}

/** Read only text matched to the generation currently deployed in the private reader. */
export async function readSourceText(store: Pick<PipelineStore, 'read'>, id: string) {
  const note = await currentNote(store, id);
  const saved = await store.read(`source-text/${note.generationId}.json`);
  return { sourceId: id, title: note.source.title, generationId: note.generationId,
    text: saved ? matchedSourceText(note, saved) : '', extraction: note.extraction };
}

/** Original PDF/image access uses corpus membership; arbitrary raw blobs cannot be requested. */
export async function readSourceDocument(store: Pick<BlobStore, 'read' | 'raw'>, id: string) {
  const note = await currentNote(store, id);
  const artifact = note.extraction.artifactHash;
  const mime = note.extraction.artifactMime || (note.extraction.method === 'pdf-text' ? 'application/pdf' : '');
  const extension = ({ 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as Record<string, string>)[mime];
  if (!artifact || !/^[a-f0-9]{64}$/.test(artifact) || !extension) throw new ChatAccessError(404, 'No saved PDF or image is available');
  const blob = store.raw.getBlockBlobClient(artifact);
  const signal = AbortSignal.timeout(20_000);
  let properties;
  try { properties = await blob.getProperties({ abortSignal: signal }); }
  catch (error) { if ((error as { statusCode?: number }).statusCode === 404) throw new ChatAccessError(404, 'Saved file is unavailable'); throw error; }
  if (!properties.contentLength || properties.contentLength > 20 * 1024 * 1024) throw new ChatAccessError(413, 'Saved file exceeds the 20 MB viewer limit');
  const bytes = await blob.downloadToBuffer(0, undefined, { conditions: { ifMatch: properties.etag }, abortSignal: signal });
  const signature = mime === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-'
    : mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!signature || hash(bytes) !== artifact) throw new ChatAccessError(404, 'Saved file is unavailable');
  return { bytes, mime, filename: `${id}.${extension}` };
}
