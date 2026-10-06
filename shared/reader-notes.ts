import { z } from 'zod';

export const readerNoteSchema = z.strictObject({
  sourceId: z.string().regex(/^zotero-(users|groups)-[0-9]+-[A-Z0-9]{8}$/),
  revision: z.number().int().nonnegative(),
  markdown: z.string().max(20000).refine(value => !/<!--\s*\/?reader-notes\s*-->/.test(value), 'Reserved notes marker'),
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable()
});
export type ReaderNote = z.infer<typeof readerNoteSchema>;
export const saveReaderNoteSchema = z.strictObject({
  sourceId: readerNoteSchema.shape.sourceId,
  revision: readerNoteSchema.shape.revision,
  markdown: readerNoteSchema.shape.markdown
});
export function mergeReaderNotes(humanMarkdown: string, markdown: string) {
  const base = humanMarkdown.replace(/\n<!-- reader-notes -->[\s\S]*?<!-- \/reader-notes -->\n?/g, '').trimEnd();
  return base + (markdown ? `\n<!-- reader-notes -->\n\n## Reader notes\n\n${markdown}\n<!-- /reader-notes -->\n` : '\n');
}
