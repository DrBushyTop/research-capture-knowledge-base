import { noteArtifacts, sourceId, type Note } from '../../../shared/corpus.js';
import { chatCorpusSchema } from '../../../shared/chat.js';
import { matchedSourceText } from '../../../shared/source-text.js';
import { ChatAccessError } from './chat-service.js';
import type { PipelineStore } from './pipeline.js';
import { ArtifactTooLarge, InvalidArtifact, MissingArtifact, SourceArtifactReader, type ArtifactReaderStore } from './source-artifact-reader.js';
import { DocumentTexts } from './document-text.js';
import type { DocumentTextReadOptions } from '../../../shared/document-text.js';
import { requireSourceState } from './source-lifecycle.js';
import { readCaptureCommentary } from './source-commentary.js';

type SourceStore = Pick<PipelineStore, 'read'> & { source?(id: string): Promise<{ note: Note } | undefined>; retainedSource?(id: string): Promise<{ note: Note } | undefined> };

async function currentNote(store: SourceStore, id: string): Promise<Note> {
  if (!sourceId.safeParse(id).success) throw new ChatAccessError(404, 'Document not found');
  const lifecycle = await requireSourceState(store, id, true);
  if (store.source) {
    const source = lifecycle.state === 'trashed' ? await store.retainedSource?.(id) : await store.source(id);
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
  await requireSourceState(store, id, true);
  if (document) return { ...document, title: note.source.title, extraction: note.extraction,
    ...(!options.offset ? { captureCommentary: await readCaptureCommentary(store, note) } : {}) };
  if (options.attachmentKey || options.startPage || options.endPage || options.offset) throw new ChatAccessError(404, 'Full text is unavailable for this saved attachment');
  const saved = await store.read(`source-text/${note.generationId}.json`);
  await requireSourceState(store, id, true);
  return { sourceId: id, title: note.source.title, generationId: note.generationId,
    text: saved ? matchedSourceText(note, saved) : '', extraction: note.extraction, nextOffset: null };
}

/** Original PDF/image access uses corpus membership; arbitrary raw blobs cannot be requested. */
export async function readSourceDocument(store: SourceStore & ArtifactReaderStore, id: string, attachmentKey?: string | null) {
  const note = await currentNote(store, id);
  if (attachmentKey && !/^[A-Z0-9]{8}$/.test(attachmentKey)) throw new ChatAccessError(404, 'Saved attachment not found');
  const reference = noteArtifacts(note).find(artifact => attachmentKey ? artifact.key === attachmentKey : artifact.hash === note.extraction.artifactHash);
  const artifact = reference?.hash;
  const declaredMime = (reference?.mime || '').split(';')[0].trim().toLowerCase();
  if (!artifact || !/^[a-f0-9]{64}$/.test(artifact) || declaredMime === 'text/html') throw new ChatAccessError(404, 'No supported saved document or image is available');
  let file;
  try { file = await new SourceArtifactReader(store).read(note, artifact); }
  catch (error) {
    if (error instanceof ArtifactTooLarge) throw new ChatAccessError(413, 'Saved file exceeds the 40 MB viewer limit');
    if (error instanceof MissingArtifact || error instanceof InvalidArtifact) throw new ChatAccessError(404, 'Saved file is unavailable');
    throw error;
  }
  if (!file?.bytes.length) throw new ChatAccessError(404, 'Saved file is unavailable');
  const extension = ({ 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'text/plain': 'txt', 'text/markdown': 'md', 'text/csv': 'csv', 'application/json': 'json' } as Record<string, string>)[file.mime];
  if (!extension) throw new ChatAccessError(404, 'No supported saved document or image is available');
  await requireSourceState(store, id, true);
  return { bytes: file.bytes, mime: file.mime, filename: `${id}${reference?.key ? '-' + reference.key : ''}.${extension}`, disposition: ['pdf', 'png', 'jpg', 'webp'].includes(extension) ? 'inline' : 'attachment' };
}
