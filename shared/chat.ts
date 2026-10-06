import { z } from 'zod';
import { hash, noteSchema, sourceId } from './corpus.js';
import { evidenceQuery } from './search.js';
import { citationLabel, maxMessageImages } from './chat-client.js';
export { citationLabel, maxMessageImages } from './chat-client.js';
export const uploadId = z.string().regex(/^u_[a-f0-9]{32}$/);
// Screenshots per message. Each upload is also capped by chatUploadLimits on the server.
export const chatRequestSchema = z.strictObject({ question: z.string().trim().max(8000), conversationId: z.string().regex(/^[a-f0-9]{32}$/).optional(), sourceId: sourceId.optional(),
  history: z.array(z.strictObject({ role: z.enum(['user', 'assistant']), content: z.string().max(3000) })).max(6).default([]),
  visual: z.strictObject({ sourceId, page: z.number().int().min(1).max(200).default(1) }).optional(),
  images: z.array(uploadId).max(maxMessageImages).default([]) })
  .refine(request => request.question.length > 0 || request.images.length > 0, 'Write a message or attach an image')
  .refine(request => new Set(request.images).size === request.images.length, 'Duplicate image');
// Jobs saved before screenshot input have no images field.
export type ChatRequest = Omit<z.infer<typeof chatRequestSchema>, 'images'> & { images?: string[] };
export const chatCorpusSchema = z.strictObject({ revision: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/), sources: z.array(z.strictObject({ note: noteSchema, humanMarkdown: z.string().max(100_000) })).max(10_000) });
export type ChatCorpus = z.infer<typeof chatCorpusSchema>;
export const chatSnapshotRevision = (gitRevision: string, sources: ChatCorpus['sources'], index: unknown) => hash(JSON.stringify({ gitRevision, sources, index }));
export interface Evidence { id: string; sourceId: string; generationId: string; title: string; label?: string; kind: 'source' | 'machine' | 'human' | 'metadata' | 'visual'; locator: string; text: string; sourceUrl?: string | null; pdf?: boolean; assetId?: string; }
export interface ChatAsset { id: string; sourceId: string; title: string; kind: 'image' | 'pdf' | 'site'; mime: string; page: number | null; blobKey?: string; artifactHash?: string; sourceUrl?: string; originJobId?: string; }
/**
 * One real step of an answer. Tool steps are upserted by id when they start and again with their outcome.
 * `commentary` is a short update the model wrote for the reader before a tool call, never its hidden reasoning.
 */
export interface ChatActivity { id?: string; tool: 'search_corpus' | 'read_source' | 'inspect_media' | 'commentary'; title: string; sourceId?: string; detail?: string; }
export interface ChatUpload { id: string; owner: string; mime: 'image/png' | 'image/jpeg' | 'image/webp'; bytes: number; width: number; height: number; createdAt: string; }
export type ChatImage = Pick<ChatUpload, 'id' | 'mime' | 'width' | 'height'>;
// Short pill text for an inline citation: site, first author or shortened title.
export const evidenceChunk = (value: Omit<Evidence, 'id'>): Evidence => ({ ...value, id: 'e_' + hash(JSON.stringify(value)).slice(0, 16) });
export function chunkText(base: Omit<Evidence, 'id' | 'text'>, text: string): Evidence[] {
  const chunks: Evidence[] = [];
  for (let start = 0; start < Math.min(text.length, 200_000); start += 1800) chunks.push(evidenceChunk({ ...base, locator: `${base.locator}, passage ${Math.floor(start / 1800) + 1}`, text: text.slice(start, start + 2000) }));
  return chunks;
}
export function corpusEvidence(corpus: ChatCorpus): Evidence[] {
  return corpus.sources.flatMap(({ note, humanMarkdown }) => {
    const base = { sourceId: note.source.id, generationId: note.generationId, title: note.source.title, label: citationLabel(note.source) };
    const facts = [note.source.title, note.source.authors.join(', '), note.source.url, note.source.doi, note.extraction.reason].filter(Boolean).join('\n');
    const human = humanMarkdown.replace(/^# Human notes\s*/, '').trim();
    return [evidenceChunk({ ...base, kind: 'metadata', locator: 'Source facts', text: facts }),
      ...(note.analysis ? chunkText({ ...base, kind: 'machine', locator: 'Generated analysis' }, JSON.stringify(note.analysis)) : []),
      ...(human ? chunkText({ ...base, kind: 'human', locator: 'Human Markdown notes' }, human) : [])];
  });
}
export function packEvidence(chunks: Evidence[], question: string, required: Evidence[] = []): Evidence[] {
  const words = evidenceQuery(question).split(' ').filter(Boolean);
  const ranked = chunks.map(chunk => ({ chunk, score: words.reduce((score, word) => score + (chunk.text.toLowerCase().includes(word) ? 1 : 0) + (chunk.title.toLowerCase().includes(word) ? 3 : 0), 0) + (chunk.kind === 'source' ? 0.5 : 0) })).sort((a, b) => b.score - a.score);
  const selected: Evidence[] = []; const sources = new Map<string, number>();
  for (const chunk of [...required, ...ranked.map(item => item.chunk)]) {
    if (selected.length >= 8) break;
    if (selected.some(item => item.id === chunk.id)) continue;
    if ((sources.get(chunk.sourceId) || 0) >= 3 || (!sources.has(chunk.sourceId) && sources.size >= 4)) continue;
    if (JSON.stringify([...selected, chunk]).length > 18_000) continue;
    selected.push(chunk); sources.set(chunk.sourceId, (sources.get(chunk.sourceId) || 0) + 1);
  }
  return selected;
}
export const answerSchema = z.strictObject({ answer: z.string().max(12_000), insufficientEvidence: z.boolean(),
  citations: z.array(z.strictObject({ evidenceId: z.string().regex(/^e_[a-f0-9]{16}$/), quote: z.string().max(600).nullable() })).max(24),
  attachments: z.array(z.string().regex(/^a_[a-f0-9]{16}$/)).max(8).default([]) });
export type Answer = z.infer<typeof answerSchema>;
export function validateAnswer(input: unknown, evidence: Evidence[], assets: ChatAsset[] = []) {
  const answer = answerSchema.parse(input);
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
  const citations = answer.citations.map(cite => {
    const chunk = evidence.find(item => item.id === cite.evidenceId);
    if (!chunk || (cite.quote && !normalize(chunk.text).includes(normalize(cite.quote)))) throw new Error('Unsupported citation');
    return { ...cite, sourceId: chunk.sourceId, generationId: chunk.generationId, title: chunk.title, label: chunk.label || citationLabel({ title: chunk.title, authors: [], url: chunk.sourceUrl || null }), kind: chunk.kind, locator: chunk.locator, excerpt: chunk.text.slice(0, 1400), sourceUrl: chunk.sourceUrl || null, pdf: chunk.pdf || false, assetId: chunk.assetId || null };
  });
  for (const match of answer.answer.matchAll(/\[(e_[a-f0-9]{16})\]/g)) if (!citations.some(citation => citation.evidenceId === match[1])) throw new Error('Unsupported inline citation');
  const attachments = answer.attachments.map(id => {
    const asset = assets.find(asset => asset.id === id);
    if (!asset) throw new Error('Unsupported attachment');
    const { blobKey: _blob, artifactHash: _hash, ...publicAsset } = asset;
    return publicAsset;
  });
  return { ...answer, citations, attachments };
}
export interface ChatJob { id: string; owner: string; corpusRevision: string; conversationId?: string; request: ChatRequest; images?: ChatImage[]; createdAt: string; status: 'pending' | 'running' | 'complete' | 'failed' | 'cancelled'; attempts: number; lastQueuedAt?: string; retryAt?: string; sandboxId?: string; result?: ReturnType<typeof validateAnswer>; activities?: ChatActivity[]; error?: string;
  /** Complete Markdown blocks streamed so far by the current attempt. Unverified; the validated result replaces it. */
  draft?: string; startedAt?: string; }
export interface ChatSourceContext { sourceId: string; title: string; }
export interface ChatConversation { id: string; owner: string; createdAt: string; updatedAt: string; sourceContext?: ChatSourceContext; turns: { jobId: string; question: string; images?: ChatImage[]; result: NonNullable<ChatJob['result']>; activities?: ChatActivity[]; workedMs?: number; modelAnswer?: string }[]; }
