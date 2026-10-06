import { expect, it } from 'vitest';
import { completeBlocks, partialAnswer, streamedDraft } from '../shared/chat-stream.js';
import { readStream } from '../apps/worker/src/chat-agent.js';

const json = (answer: string) => JSON.stringify({ answer, insufficientEvidence: false, citations: [], attachments: [] });
const table = 'Intro paragraph.\n\n| Pet | Care |\n| --- | --- |\n| Cat | Low |\n| Dog | High |\n\nClosing paragraph.';

it('decodes the answer field from any JSON prefix without half escapes', () => {
  const full = json('Line "one"\n\nCafé \\ ok');
  for (let end = 0; end <= full.length; end++) expect('Line "one"\n\nCafé \\ ok'.startsWith(partialAnswer(full.slice(0, end)))).toBe(true);
  expect(partialAnswer(full)).toBe('Line "one"\n\nCafé \\ ok');
  expect(partialAnswer('{"answer":"a\\u00')).toBe('a');
  expect(partialAnswer('{"citations":[]')).toBe('');
});

it('releases whole paragraphs and never a partial table at any streaming point', () => {
  const full = json(table);
  const seen = new Set<string>();
  for (let end = 0; end <= full.length; end++) {
    const draft = streamedDraft(full.slice(0, end));
    seen.add(draft);
    const rows = draft.split('\n').filter(line => line.startsWith('|'));
    expect([0, 4]).toContain(rows.length);
    expect(table.startsWith(draft)).toBe(true);
  }
  // The closing paragraph waits for the validated answer; it has no blank line after it yet.
  expect([...seen]).toEqual(['', 'Intro paragraph.', 'Intro paragraph.\n\n| Pet | Care |\n| --- | --- |\n| Cat | Low |\n| Dog | High |']);
});

it('keeps code fences with blank lines together and drops unvalidated citation markers', () => {
  const fence = 'Run this:\n\n```sh\necho one\n\necho two\n```\n\nDone [e_0123456789abcdef].\n\n';
  expect(completeBlocks(fence.slice(0, fence.indexOf('echo two')))).toBe('Run this:');
  expect(completeBlocks(fence)).toBe('Run this:\n\n```sh\necho one\n\necho two\n```\n\nDone.');
  expect(completeBlocks('- one\n- two\n\n- thr')).toBe('- one\n- two');
});

it('streams only final-answer text and ignores commentary messages', async () => {
  const events = [
    { type: 'response.output_item.added', item: { type: 'message', phase: 'commentary' } },
    { type: 'response.output_text.delta', delta: 'I will search.' },
    { type: 'response.output_item.added', item: { type: 'message', phase: 'final_answer' } },
    { type: 'response.output_text.delta', delta: '{"answer":"Hi' },
    { type: 'response.output_text.delta', delta: '"}' },
    { type: 'response.completed', response: { status: 'completed', output: [] } }
  ];
  const sse = events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
  const chunks = [sse.slice(0, 50), sse.slice(50, 333), sse.slice(333)].map(part => new TextEncoder().encode(part));
  const seen: string[] = [];
  const body = new ReadableStream<Uint8Array>({ start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close(); } });
  expect((await readStream(body, async text => { seen.push(text); }))?.status).toBe('completed');
  expect(seen).toEqual(['{"answer":"Hi', '{"answer":"Hi"}']);
  const cut = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(chunks[0]); controller.close(); } });
  await expect(readStream(cut)).rejects.toThrow('ended early');
});
