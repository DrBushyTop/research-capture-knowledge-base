import { z } from 'zod';
import { sourceId } from './corpus.js';

export const documentTextLimits = { chunkCharacters: 40_000, readCharacters: 80_000, originalBytes: 40 * 1024 * 1024, chunks: 4000 };
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identity = { sourceId, generationId: digest, fingerprint: digest, artifactHash: digest };
export const documentTextChunkSchema = z.strictObject({
  ...identity, index: z.number().int().nonnegative(), offset: z.number().int().nonnegative(),
  locator: z.string().min(1).max(1000), page: z.number().int().positive().optional(),
  text: z.string().max(documentTextLimits.chunkCharacters), textHash: digest
});
export const documentTextManifestSchema = z.strictObject({
  version: z.literal(1), ...identity, mime: z.string().min(1).max(100), key: z.string().regex(/^[A-Z0-9]{8}$/).optional(), title: z.string().max(2000).optional(),
  complete: z.boolean(), reason: z.string().max(2000).optional(), totalPages: z.number().int().nonnegative().optional(), totalLength: z.number().int().nonnegative().max(documentTextLimits.originalBytes),
  chunks: z.array(z.strictObject({ index: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), length: z.number().int().positive().max(documentTextLimits.chunkCharacters),
    locator: z.string().min(1).max(1000), page: z.number().int().positive().optional(), textHash: digest })).max(documentTextLimits.chunks)
});
export type DocumentTextManifest = z.infer<typeof documentTextManifestSchema>;
export interface DocumentTextInput {
  hash: string; mime: string; key?: string; title?: string;
  sections: { locator: string; text: string; page?: number }[];
  complete: boolean; reason?: string; totalPages?: number;
}
export interface DocumentTextReadOptions {
  artifactHash?: string; attachmentKey?: string; startPage?: number; endPage?: number; offset?: number; limit?: number;
}
export interface DocumentTextRead {
  sourceId: string; generationId: string; artifact: { hash: string; mime: string; key?: string; title?: string };
  text: string; sections: { locator: string; text: string; page?: number; offset: number }[];
  complete: boolean; truncated: boolean; reason?: string; totalPages?: number;
  totalLength: number; documentLength: number; offset: number; nextOffset: number | null;
}
export const documentTextManifestKey = (generation: string, artifact: string) => `document-text/${generation}/${artifact}/manifest.json`;
export const documentTextChunkKey = (generation: string, artifact: string, index: number) => `document-text/${generation}/${artifact}/${String(index).padStart(5, '0')}.json`;
