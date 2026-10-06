import { chatCorpusSchema, type ChatCorpus } from '../../../shared/chat.js';
import { mergeReaderNotes, readerNoteSchema, saveReaderNoteSchema, type ReaderNote } from '../../../shared/reader-notes.js';
import { sourceId } from '../../../shared/corpus.js';
import { ChatAccessError } from './chat-service.js';
import type { PipelineStore } from './pipeline.js';

async function requireSource(store: PipelineStore, id: string) {
  if (!sourceId.safeParse(id).success) throw new ChatAccessError(404, 'Source not found');
  const current = await store.read<{ revision: string }>('chat/current.json');
  if (!current) throw new ChatAccessError(503, 'The dataset is not ready yet');
  const corpus = chatCorpusSchema.parse(await store.read(`chat/corpora/${current.revision}.json`));
  if (!corpus.sources.some(source => source.note.source.id === id && source.note.source.active)) throw new ChatAccessError(404, 'Source not found');
}

export async function readReaderNote(store: PipelineStore, id: string): Promise<ReaderNote> {
  await requireSource(store, id);
  const saved = await store.read(`reader-notes/${id}.json`);
  return saved ? readerNoteSchema.parse(saved) : { sourceId: id, revision: 0, markdown: '', updatedAt: null, updatedBy: null };
}

export async function saveReaderNote(store: PipelineStore, owner: string, input: unknown): Promise<ReaderNote> {
  const parsed = saveReaderNoteSchema.safeParse(input);
  if (!parsed.success) throw new ChatAccessError(400, 'Notes must be 20,000 characters or fewer');
  const request = parsed.data;
  await requireSource(store, request.sourceId);
  return store.withLease(`reader-note-${request.sourceId}`, async () => {
    const key = `reader-notes/${request.sourceId}.json`;
    const saved = await store.read<ReaderNote>(key);
    if ((saved?.revision || 0) !== request.revision) throw new ChatAccessError(409, 'These notes changed in another tab. Your draft is kept. Load the latest notes before saving.');
    const note = readerNoteSchema.parse({ ...request, revision: request.revision + 1, updatedAt: new Date().toISOString(), updatedBy: owner });
    await store.write(key, note);
    return note;
  });
}

// Reader edits are available to chat immediately, without waiting for a static rebuild.
export async function withReaderNotes(store: PipelineStore, corpus: ChatCorpus): Promise<ChatCorpus> {
  return { ...corpus, sources: await Promise.all(corpus.sources.map(async source => {
    const saved = await store.read<ReaderNote>(`reader-notes/${source.note.source.id}.json`);
    if (!saved) return source;
    const markdown = readerNoteSchema.parse(saved).markdown;
    // The importer appends this marked section to notes.md without replacing existing commentary.
    return { ...source, humanMarkdown: mergeReaderNotes(source.humanMarkdown, markdown) };
  })) };
}
