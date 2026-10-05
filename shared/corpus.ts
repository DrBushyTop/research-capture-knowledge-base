import { createHash } from 'node:crypto';
import { z } from 'zod';

export const processingVersion = '2';
export const httpUrl = z.url().refine(value => {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}, 'Expected HTTP(S) URL without credentials');
export const sourceId = z.string().regex(/^zotero-(users|groups)-[0-9]+-[A-Z0-9]{8}$/);
export const analysisSchema = z.strictObject({
  summary: z.string().max(12000), topics: z.array(z.string().max(80)).max(12),
  sourceCategory: z.enum(['research-paper', 'webpage', 'other']), studyType: z.string().max(200).nullable(),
  keyFindings: z.array(z.string().max(2000)).max(12), limitations: z.array(z.string().max(2000)).max(12),
  claims: z.array(z.strictObject({ text: z.string().max(2000), evidence: z.string().max(2000) })).max(12),
  relevance: z.array(z.string().max(2000)).max(8),
  population: z.string().max(1000).nullable(), participantCount: z.number().int().nonnegative().nullable(),
  intervention: z.string().max(1000).nullable(), comparator: z.string().max(1000).nullable(),
  outcomes: z.array(z.string().max(1000)).max(12), funding: z.string().max(1000).nullable(),
  suggestedRelationships: z.array(z.string().max(300)).max(8)
});
export type Analysis = z.infer<typeof analysisSchema>;
export const sourceSchema = z.strictObject({
  id: sourceId, libraryType: z.enum(['users', 'groups']), libraryId: z.string().regex(/^\d+$/), key: z.string().regex(/^[A-Z0-9]{8}$/),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), title: z.string().max(2000), itemType: z.string().max(100),
  authors: z.array(z.string().max(300)), url: httpUrl.nullable(), doi: z.string().max(300).nullable(),
  publishedAt: z.string().max(200).nullable(), capturedAt: z.string(), tags: z.array(z.string().max(200)),
  active: z.boolean()
});
export type Source = z.infer<typeof sourceSchema>;
export const licenseEvidenceSchema = z.strictObject({
  origin: z.enum(['crossref', 'human']), licenseUrl: httpUrl, appliesTo: z.enum(['metadata', 'artifact']),
  artifactHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), checkedAt: z.string()
});
export const noteSchema = z.strictObject({
  schemaVersion: z.literal(1), generationId: z.string().regex(/^[a-f0-9]{64}$/), source: sourceSchema,
  extraction: z.strictObject({
    status: z.enum(['text', 'metadata-only', 'needs-review']), method: z.enum(['pdf-text', 'html', 'none']),
    reason: z.string().max(1000).nullable(), truncated: z.boolean(), retrievedAt: z.string(),
    artifactHash: z.string().regex(/^[a-f0-9]{64}$/).nullable()
  }),
  analysis: analysisSchema.nullable(),
  processing: z.strictObject({ version: z.string(), model: z.string().nullable(), processedAt: z.string() }),
  rightsEvidence: z.array(licenseEvidenceSchema)
});
export type Note = z.infer<typeof noteSchema>;
export const publicationSchema = z.strictObject({
  note: z.enum(['PRIVATE', 'UNKNOWN', 'LINK_ONLY', 'ALLOW']),
  approvedFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable(), approvedBy: z.string().max(200).nullable(),
  approvedGenerationId: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  artifact: z.enum(['PRIVATE', 'UNKNOWN', 'LINK_ONLY', 'ALLOW']),
  artifactHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), licenseUrl: httpUrl.nullable()
});
export type Publication = z.infer<typeof publicationSchema>;
export const privatePublication: Publication = { note: 'PRIVATE', approvedFingerprint: null, approvedGenerationId: null, approvedBy: null, artifact: 'UNKNOWN', artifactHash: null, licenseUrl: null };
export function publicNoteAllowed(note: Note, publication: Publication) {
  return note.source.active && ['LINK_ONLY', 'ALLOW'].includes(publication.note) &&
    publication.approvedFingerprint === note.source.fingerprint && publication.approvedGenerationId === note.generationId && Boolean(publication.approvedBy?.trim());
}
export function artifactRedistributionAllowed(note: Note, publication: Publication) {
  return publicNoteAllowed(note, publication) && publication.artifact === 'ALLOW' &&
    Boolean(note.extraction.artifactHash) && publication.artifactHash === note.extraction.artifactHash &&
    Boolean(publication.licenseUrl) && note.rightsEvidence.some(e => e.origin === 'human' && e.appliesTo === 'artifact' &&
      e.artifactHash === publication.artifactHash && e.licenseUrl === publication.licenseUrl);
}
export function hash(value: string | Uint8Array) { return createHash('sha256').update(value).digest('hex'); }
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
export interface ZoteroItem { key: string; version: number; data: Record<string, unknown>; }
export interface LibrarySnapshot { libraryType: 'users' | 'groups'; libraryId: string; version: number; items: ZoteroItem[]; }
export interface SourceSnapshot { source: Source; root: ZoteroItem; children: ZoteroItem[]; }
export function normalize(snapshot: LibrarySnapshot): SourceSnapshot[] {
  return snapshot.items.filter(i => !i.data.parentItem && !['note', 'annotation'].includes(String(i.data.itemType))).map(root => {
    const descendant = (item: ZoteroItem) => {
      const seen = new Set<string>(); let parent = item.data.parentItem;
      while (typeof parent === 'string' && !seen.has(parent)) {
        if (parent === root.key) return true; seen.add(parent); parent = snapshot.items.find(i => i.key === parent)?.data.parentItem;
      }
      return false;
    };
    const children = snapshot.items.filter(descendant).sort((a, b) => a.key.localeCompare(b.key));
    const fingerprint = hash(canonical({ root, children }));
    const d = root.data;
    const creators = Array.isArray(d.creators) ? d.creators as Record<string, unknown>[] : [];
    const tags = Array.isArray(d.tags) ? d.tags as { tag: string }[] : [];
    const source = sourceSchema.parse({
      id: `zotero-${snapshot.libraryType}-${snapshot.libraryId}-${root.key}`, libraryType: snapshot.libraryType, libraryId: snapshot.libraryId,
      key: root.key, fingerprint, title: String(d.title || 'Untitled capture'), itemType: String(d.itemType || 'other'),
      authors: creators.map(c => String(c.name || [c.firstName, c.lastName].filter(Boolean).join(' '))).filter(Boolean),
      url: httpUrl.safeParse(d.url).success ? d.url : null, doi: d.DOI || null, publishedAt: d.date || null,
      capturedAt: String(d.dateAdded || new Date().toISOString()), tags: tags.map(t => t.tag), active: true
    });
    return { source, root, children };
  });
}
const md = (s: string) => s.replace(/[\\`*{}\[\]()#+.!_|<>]/g, '\\$&').replace(/\r?\n/g, ' ');
export function renderMarkdown(note: Note): string {
  const { source, analysis: a } = note;
  const metadata = { id: source.id, title: source.title, source_type: source.itemType, source_url: source.url, doi: source.doi,
    captured_at: source.capturedAt, published_at: source.publishedAt, authors: source.authors, topics: a?.topics ?? source.tags,
    evidence_status: note.extraction.status, processing: note.processing, publication: { status: 'private' } };
  const frontmatter = Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
  const list = (values: string[]) => values.length ? values.map(s => `- ${md(s)}`).join('\n') : 'Not reported.';
  return `---\n${frontmatter}\n---\n\n# ${md(source.title)}\n\n## Source facts\n\n${source.authors.map(md).join(', ') || 'Authors not provided.'}\n\n${source.doi ? 'DOI: ' + md(source.doi) : ''}\n\n${source.url ? '<' + source.url + '>' : 'No source URL provided.'}\n\n## Machine interpretation\n\n${a ? md(a.summary) : 'Analysis unavailable. ' + md(note.extraction.reason || 'Source text is unavailable.')}\n\n## Key findings\n\n${list(a?.keyFindings ?? [])}\n\n## Limitations\n\n${list(a?.limitations ?? [])}\n\n## Why this is relevant\n\n${list(a?.relevance ?? [])}\n\n## Evidence status\n\n${md(note.extraction.status)}${note.extraction.reason ? ': ' + md(note.extraction.reason) : ''}\n${note.extraction.truncated ? '\nOnly a bounded portion of this source was analyzed.\n' : ''}\n\nHuman commentary belongs in notes.md and survives reprocessing.\n`;
}
