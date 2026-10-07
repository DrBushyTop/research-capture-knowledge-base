import { z } from 'zod';
import { legacyNoteSchema, sourceId, type Note } from './corpus.js';
export const sourceTextSchema = z.strictObject({ sourceId, generationId: z.string().regex(/^[a-f0-9]{64}$/),
  artifactHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), text: z.string().max(60_000),
  extraction: legacyNoteSchema.shape.extraction.optional() })
  .refine(value => !value.extraction || value.extraction.artifactHash === value.artifactHash, 'Text extraction does not match its artifact');
export function sourceText(note: Pick<Note, 'source' | 'generationId' | 'extraction'>, text: string) {
  return sourceTextSchema.parse({ sourceId: note.source.id, generationId: note.generationId, artifactHash: note.extraction.artifactHash, text, extraction: note.extraction });
}
export function matchedSourceText(note: Pick<Note, 'source' | 'generationId' | 'extraction'>, input: unknown) {
  const value = sourceTextSchema.parse(input);
  if (value.sourceId !== note.source.id || value.generationId !== note.generationId || value.artifactHash !== note.extraction.artifactHash) throw new Error('Search text does not match published source');
  return value.text;
}
