import { expect, it } from 'vitest';
import { discuss, responseInput, type ChatTools, type ModelRound } from '../apps/worker/src/chat-agent.js';
import { evidenceChunk, validateAnswer, type ChatConversation, type ChatJob } from '../shared/chat.js';
const job: ChatJob = { id: '1'.repeat(32), owner: 'reader', createdAt: new Date().toISOString(), corpusRevision: '2'.repeat(64), request: { question: 'Continue', history: [] }, status: 'running', attempts: 1 };
const result = { answer: 'We can discuss that.', insufficientEvidence: false, citations: [], attachments: [] };
it('replays native reasoning and function call items with the matching tool output', () => {
  const items = [{ type: 'reasoning', encrypted_content: 'opaque', id: 'reasoning' }, { type: 'function_call', name: 'search_corpus', arguments: '{}', call_id: 'call-1', id: 'function-1' }];
  const input = responseInput([{ role: 'system', content: 'Discuss' }, { role: 'assistant', content: null, responseItems: items }, { role: 'tool', content: '{"results":[]}', tool_call_id: 'call-1' }, { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,image' } }] }]);
  expect(input).toEqual([{ role: 'developer', content: 'Discuss' }, ...items, { type: 'function_call_output', call_id: 'call-1', output: '{"results":[]}' }, { role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,image', detail: 'auto' }] }]);
});
it('supports discussion without retrieval and supplies preceding turns to the model', async () => {
  const conversation: ChatConversation = { id: '3'.repeat(32), owner: 'reader', createdAt: job.createdAt, updatedAt: job.createdAt, turns: [{ jobId: '4'.repeat(32), question: 'Remember Atlas', result }] };
  const tools: ChatTools = { evidence: [], assets: [], execute: async () => { throw new Error('No tools requested'); } };
  const answer = await discuss(job, conversation, tools, undefined, async messages => {
    expect(messages.some(message => message.role === 'user' && message.content === 'Remember Atlas')).toBe(true);
    expect(messages.at(-1)?.content).toBe('Continue');
    return { content: JSON.stringify(result) };
  });
  expect(validateAnswer(answer.answer, answer.evidence).answer).toBe(result.answer);
});
it('lets the model search, inspect a chart and cite its returned evidence and attachment', async () => {
  const evidence = evidenceChunk({ sourceId: 'zotero-users-12345-PBA4T3PN', generationId: 'a'.repeat(64), title: 'Chart', kind: 'visual', locator: 'PDF page 2', text: 'Rendered PDF page 2' });
  const asset = { id: 'a_' + 'a'.repeat(16), sourceId: evidence.sourceId, title: evidence.title, kind: 'image' as const, page: 2, mime: 'image/png' };
  const calls: string[] = [];
  const tools: ChatTools = { evidence: [], assets: [], execute: async (name) => {
    calls.push(name);
    if (name === 'search_corpus') return { content: { sourceId: evidence.sourceId } };
    tools.evidence.push(evidence); tools.assets.push(asset);
    return { content: { passages: [evidence], assets: [asset] }, image: 'data:image/png;base64,' + 'a'.repeat(400_000) };
  } };
  let step = 0;
  const round: ModelRound = async messages => {
    if (step++ === 0) return { tool_calls: [{ id: 'search', type: 'function', function: { name: 'search_corpus', arguments: JSON.stringify({ query: 'retention', offset: 0, limit: 10 }) } }] };
    if (step === 2) return { tool_calls: [{ id: 'inspect', type: 'function', function: { name: 'inspect_media', arguments: JSON.stringify({ sourceId: evidence.sourceId, page: 2 }) } }] };
    expect(JSON.stringify(messages.at(-1))).toContain('data:image/png');
    expect(messages.some(message => message.role === 'tool' && message.tool_call_id === 'inspect')).toBe(true);
    return { content: JSON.stringify({ ...result, answer: `Here is the chart [${evidence.id}]`, citations: [{ evidenceId: evidence.id, quote: null }], attachments: [asset.id] }) };
  };
  const answer = await discuss(job, undefined, tools, undefined, round);
  expect(calls).toEqual(['search_corpus', 'inspect_media']);
  expect(validateAnswer(answer.answer, answer.evidence, answer.assets).attachments[0]).toEqual(asset);
});
it('does not execute arbitrary tools or invalid source paths, and bounds repeated calls', async () => {
  let executions = 0;
  const tools: ChatTools = { evidence: [], assets: [], execute: async () => { executions++; return { content: {} }; } };
  let rounds = 0;
  await expect(discuss(job, undefined, tools, undefined, async () => ({ tool_calls: [{ id: String(++rounds), type: 'function', function: { name: rounds === 1 ? 'shell' : 'read_source', arguments: JSON.stringify({ sourceId: '../../secret', section: 'source', query: '', page: null }) } }] }))).rejects.toThrow('Chat tool budget exhausted');
  expect(executions).toBe(0);
  expect(rounds).toBe(9);
});
