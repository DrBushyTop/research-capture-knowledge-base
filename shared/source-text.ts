import { z } from 'zod';
import { sourceId, type Note } from './corpus.js';
export const sourceTextSchema = z.strictObject({ sourceId, generationId: z.string().regex(/^[a-f0-9]{64}$/),
  artifactHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), text: z.string().max(60_000) });
export function sourceText(note: Pick<Note, 'source' | 'generationId' | 'extraction'>, text: string) {
  return sourceTextSchema.parse({ sourceId: note.source.id, generationId: note.generationId, artifactHash: note.extraction.artifactHash, text });
}
export function matchedSourceText(note: Pick<Note, 'source' | 'generationId' | 'extraction'>, input: unknown) {
  const value = sourceTextSchema.parse(input);
  if (value.sourceId !== note.source.id || value.generationId !== note.generationId || value.artifactHash !== note.extraction.artifactHash) throw new Error('Search text does not match published source');
  return value.text;
}
