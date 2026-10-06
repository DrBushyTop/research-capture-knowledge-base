import { z } from 'zod';
import { hash, noteSchema, sourceId } from './corpus.js';
import { evidenceQuery } from './search.js';
export const chatRequestSchema = z.strictObject({ question: z.string().trim().min(1).max(2000), sourceId: sourceId.optional(),
  history: z.array(z.strictObject({ role: z.enum(['user', 'assistant']), content: z.string().max(3000) })).max(6).default([]),
  visual: z.strictObject({ sourceId, page: z.number().int().min(1).max(200).default(1) }).optional() });
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export const chatCorpusSchema = z.strictObject({ revision: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/), sources: z.array(z.strictObject({ note: noteSchema, humanMarkdown: z.string().max(100_000) })).max(10_000) });
export type ChatCorpus = z.infer<typeof chatCorpusSchema>;
export const chatSnapshotRevision = (gitRevision: string, sources: ChatCorpus['sources'], index: unknown) => hash(JSON.stringify({ gitRevision, sources, index }));
export interface Evidence { id: string; sourceId: string; generationId: string; title: string; kind: 'source' | 'machine' | 'human' | 'metadata' | 'visual'; locator: string; text: string; }
export const evidenceChunk = (value: Omit<Evidence, 'id'>): Evidence => ({ ...value, id: 'e_' + hash(JSON.stringify(value)).slice(0, 16) });
export function chunkText(base: Omit<Evidence, 'id' | 'text'>, text: string): Evidence[] {
  const chunks: Evidence[] = [];
  for (let start = 0; start < Math.min(text.length, 200_000); start += 1800) chunks.push(evidenceChunk({ ...base, locator: `${base.locator}, passage ${Math.floor(start / 1800) + 1}`, text: text.slice(start, start + 2000) }));
  return chunks;
}
export function corpusEvidence(corpus: ChatCorpus): Evidence[] {
  return corpus.sources.flatMap(({ note, humanMarkdown }) => {
    const base = { sourceId: note.source.id, generationId: note.generationId, title: note.source.title };
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
  citations: z.array(z.strictObject({ evidenceId: z.string().regex(/^e_[a-f0-9]{16}$/), quote: z.string().max(600).nullable() })).max(12) });
export type Answer = z.infer<typeof answerSchema>;
export function validateAnswer(input: unknown, evidence: Evidence[]) {
  const answer = answerSchema.parse(input);
  if (!answer.insufficientEvidence && answer.citations.length === 0) throw new Error('Uncited answer');
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
  const citations = answer.citations.map(cite => {
    const chunk = evidence.find(item => item.id === cite.evidenceId);
    if (!chunk || (cite.quote && !normalize(chunk.text).includes(normalize(cite.quote)))) throw new Error('Unsupported citation');
    return { ...cite, sourceId: chunk.sourceId, title: chunk.title, kind: chunk.kind, locator: chunk.locator, excerpt: chunk.text.slice(0, 1400) };
  });
  for (const match of answer.answer.matchAll(/\[(e_[a-f0-9]{16})\]/g)) if (!citations.some(citation => citation.evidenceId === match[1])) throw new Error('Unsupported inline citation');
  return { ...answer, answer: answer.insufficientEvidence && !citations.length ? 'The stored evidence does not answer this question. Try selecting a source or a specific page.' : answer.answer, citations };
}
export interface ChatJob { id: string; owner: string; corpusRevision: string; request: ChatRequest; createdAt: string; status: 'pending' | 'running' | 'complete' | 'failed'; attempts: number; lastQueuedAt?: string; retryAt?: string; sandboxId?: string; result?: ReturnType<typeof validateAnswer>; error?: string; }
