import { canonical, hash, sourceSchema, type Note, type SourceSnapshot } from '../../../shared/corpus.js';
import { sourceTextLimit } from '../../../shared/source-text.js';
import type { PipelineStore } from './pipeline.js';
import { savedCommentary, savedHtml } from './capture-commentary.js';

/** Capture notes belong to the pinned Zotero snapshot, separately from extracted document text. */
export async function readCaptureCommentary(store: Pick<PipelineStore, 'read'>, note: Pick<Note, 'source' | 'generationId'>) {
  const snapshot = await store.read<SourceSnapshot>(`snapshots/${note.generationId}.json`);
  if (!snapshot) return undefined;
  const source = sourceSchema.parse(snapshot.source);
  if (source.id !== note.source.id || source.fingerprint !== note.source.fingerprint || snapshot.root.key !== note.source.key
    || hash(canonical({ root: snapshot.root, children: snapshot.children })) !== source.fingerprint) throw new Error('Capture commentary does not match the pinned source generation');
  const text = savedCommentary(snapshot);
  const description = savedHtml(snapshot.root.data.abstractNote);
  return text || description ? { text: text.slice(0, sourceTextLimit), truncated: text.length > sourceTextLimit,
    ...(description ? { description: description.slice(0, sourceTextLimit), descriptionTruncated: description.length > sourceTextLimit } : {}) } : undefined;
}
