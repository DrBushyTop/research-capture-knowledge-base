import { expect, it } from 'vitest';
import { MemoryStore } from './fixtures.js';
import { chatStatus, processChatJob, readerIdentity, submitChat } from '../apps/worker/src/chat-service.js';
import type { ChatJob } from '../shared/chat.js';
async function store() {
  const state = new MemoryStore(); const revision = 'a'.repeat(40);
  await state.create('chat/current.json', { revision });
  await state.create(`chat/corpora/${revision}.json`, { revision, sources: [] }); return state;
}
const insufficient = async () => ({ answer: { answer: 'No evidence.', insufficientEvidence: true, citations: [] }, evidence: [] });
it('requires the private reader role and prevents cross-reader job access', async () => {
  expect(() => readerIdentity(null)).toThrow('Reader access required');
  const principal = (roles: string[]) => Buffer.from(JSON.stringify({ identityProvider: 'github', userId: 'test-user', userRoles: roles })).toString('base64');
  expect(() => readerIdentity(principal(['authenticated']))).toThrow();
  const owner = readerIdentity(principal(['reader']));
  const state = await store(); const job = await submitChat(state, owner, { question: 'What is saved?' }, async () => undefined);
  await expect(chatStatus(state, 'someone-else', job.id)).rejects.toMatchObject({ status: 404 });
  expect((await chatStatus(state, owner, job.id)).status).toBe('pending');
  expect((await submitChat(state, owner, { question: 'What is saved?' }, async () => undefined)).id).toBe(job.id);
  await expect(submitChat(state, owner, { question: 'Another question' }, async () => undefined)).rejects.toMatchObject({ status: 429 });
});
it('bounds paid work per reader and records invalid answers as failures', async () => {
  const state = await store();
  for (let i = 0; i < 20; i++) {
    const job = await submitChat(state, 'owner', { question: 'Question ' + i }, async () => undefined);
    await processChatJob(state, job.id, insufficient);
  }
  await expect(submitChat(state, 'owner', { question: 'More' }, async () => undefined)).rejects.toMatchObject({ status: 429 });
  const invalid = await submitChat(state, 'other', { question: 'A question' }, async () => undefined);
  const response = async () => ({ answer: { answer: 'Unsupported fact', insufficientEvidence: false, citations: [] }, evidence: [] });
  await processChatJob(state, invalid.id, response);
  const key = `chat/jobs/${invalid.id}.json`; const pending = (await state.read<ChatJob>(key))!;
  await state.write(key, { ...pending, retryAt: undefined });
  await processChatJob(state, invalid.id, response);
  const failed = (await state.read<ChatJob>(key))!;
  expect(failed.status).toBe('failed'); expect(failed.result).toBeUndefined();
});
