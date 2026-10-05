import { expect, it } from 'vitest';
import { chatRequestSchema, evidenceChunk, packEvidence, validateAnswer } from '../shared/chat.js';
it('bounds questions and rejects invented citations and unsupported quoted evidence', () => {
  expect(chatRequestSchema.safeParse({ question: 'x'.repeat(2001) }).success).toBe(false);
  const chunk = evidenceChunk({ sourceId: 'zotero-users-12345-PBA4T3PN', generationId: 'a'.repeat(64), title: 'Paper', kind: 'source', locator: 'PDF page 2', text: 'The paper reports uncertain evidence.' });
  const answer = { answer: 'Evidence is uncertain.', insufficientEvidence: false, citations: [{ evidenceId: chunk.id, quote: 'uncertain evidence' }] };
  expect(validateAnswer(answer, [chunk]).citations[0].locator).toBe('PDF page 2');
  expect(() => validateAnswer({ ...answer, citations: [{ evidenceId: 'e_' + '0'.repeat(16), quote: null }] }, [chunk])).toThrow();
  expect(() => validateAnswer({ ...answer, citations: [{ evidenceId: chunk.id, quote: 'proved effective' }] }, [chunk])).toThrow();
  expect(() => validateAnswer({ ...answer, citations: [] }, [chunk])).toThrow();
});
it('packs a bounded and diverse evidence set without turning generated notes into source evidence', () => {
  const chunks = Array.from({ length: 20 }, (_, i) => evidenceChunk({ sourceId: `source-${Math.floor(i / 5)}`, generationId: 'b'.repeat(64), title: 'Pain research', kind: i % 2 ? 'machine' : 'source', locator: `section ${i}`, text: 'Pain evidence '.repeat(150) }));
  const selected = packEvidence(chunks, 'pain');
  expect(selected.length).toBeLessThanOrEqual(8);
  expect(JSON.stringify(selected).length).toBeLessThanOrEqual(18_000);
  expect(packEvidence(chunks.filter(chunk => chunk.kind === 'machine'), 'pain').every(chunk => chunk.kind === 'machine')).toBe(true);
  for (const id of new Set(selected.map(chunk => chunk.sourceId))) expect(selected.filter(chunk => chunk.sourceId === id).length).toBeLessThanOrEqual(3);
});
