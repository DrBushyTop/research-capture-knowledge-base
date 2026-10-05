import { defineCollection } from 'astro:content';
import { z } from 'zod';
import path from 'node:path';
import { readCorpus } from '../../../shared/reader.js';
import { noteSchema, publicationSchema } from '../../../shared/corpus.js';
const research = defineCollection({
  schema: z.object({ note: noteSchema, publication: publicationSchema, humanHtml: z.string() }),
  loader: { name: 'selected-corpus', load: async ({ store }) => {
    store.clear();
    const mode = process.env.READER_MODE === 'public' ? 'public' : 'private';
    const root = process.env.CORPUS_DIR || new URL('../../../content/research/', import.meta.url).pathname;
    for (const entry of await readCorpus(path.resolve(root), mode)) store.set({ id: entry.note.source.id, data: { ...entry } });
  } }
});
export const collections = { research };
