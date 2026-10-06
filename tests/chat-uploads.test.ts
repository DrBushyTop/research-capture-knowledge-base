import { expect, it } from 'vitest';
import { MemoryStore } from './fixtures.js';
import { chatStatus, deleteConversation, getConversation, listConversations, processChatJob, submitChat } from '../apps/worker/src/chat-service.js';
import { imageInfo, readUpload, saveUpload } from '../apps/worker/src/chat-uploads.js';
import { discuss, responseInput, type ChatTools } from '../apps/worker/src/chat-agent.js';
import { citationLabel, type ChatConversation, type ChatJob } from '../shared/chat.js';

class FileStore extends MemoryStore {
  binary = new Map<string, Buffer>();
  async createBinary(key: string, data: Uint8Array) { if (!this.binary.has(key)) this.binary.set(key, Buffer.from(data)); }
  async readBinary(key: string) { return this.binary.get(key); }
  async remove(key: string) { this.data.delete(key); this.binary.delete(key); }
}
const png = (width: number, height: number, extra = 64) => {
  const header = Buffer.alloc(24 + extra);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.writeUInt32BE(13, 8); header.write('IHDR', 12, 'ascii'); header.writeUInt32BE(width, 16); header.writeUInt32BE(height, 20);
  return header;
};
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0, 0, 0, 0, 0, 0]);
async function store() {
  const state = new FileStore(); const revision = 'a'.repeat(40);
  await state.create('chat/current.json', { revision });
  await state.create(`chat/corpora/${revision}.json`, { revision, sources: [] });
  return state;
}
const insufficient = async () => ({ answer: { answer: 'No evidence.', insufficientEvidence: true, citations: [] }, evidence: [] });

it('accepts only real PNG, JPEG or WebP headers within byte and dimension limits', async () => {
  expect(imageInfo(png(1170, 2532))).toEqual({ mime: 'image/png', width: 1170, height: 2532 });
  expect(imageInfo(jpeg)).toEqual({ mime: 'image/jpeg', width: 800, height: 600 });
  const state = await store();
  await expect(saveUpload(state, 'owner', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'image/svg+xml')).rejects.toMatchObject({ status: 415 });
  await expect(saveUpload(state, 'owner', Buffer.from('<script>alert(1)</script>'), 'image/png')).rejects.toMatchObject({ status: 415 });
  await expect(saveUpload(state, 'owner', png(100, 100), 'image/jpeg')).rejects.toMatchObject({ status: 415 });
  await expect(saveUpload(state, 'owner', png(9000, 100), 'image/png')).rejects.toMatchObject({ status: 413 });
  await expect(saveUpload(state, 'owner', png(100, 100, 6 * 1024 * 1024), 'image/png')).rejects.toMatchObject({ status: 413 });
  expect(state.binary.size).toBe(0);
  const saved = await saveUpload(state, 'owner', jpeg, 'image/jpeg');
  expect(saved).toMatchObject({ mime: 'image/jpeg', width: 800, height: 600 });
});

it('keeps screenshots private to their uploader and sends them to the model as image input', async () => {
  const state = await store();
  const image = await saveUpload(state, 'owner', png(1200, 800), 'image/png');
  await expect(readUpload(state, 'other', image.id)).rejects.toMatchObject({ status: 404 });
  await expect(submitChat(state, 'other', { question: 'What is this?', images: [image.id] }, async () => undefined)).rejects.toMatchObject({ status: 404 });
  await expect(submitChat(state, 'owner', { question: 'Two copies', images: [image.id, image.id] }, async () => undefined)).rejects.toMatchObject({ status: 400 });
  const submitted = await submitChat(state, 'owner', { question: '', images: [image.id] }, async () => undefined);
  const job = (await state.read<ChatJob>(`chat/jobs/${submitted.id}.json`))!;
  expect(job.images).toEqual([image]);

  const tools: ChatTools = { evidence: [], assets: [], execute: async () => ({ content: {} }),
    images: async ids => Promise.all(ids.map(async id => { const file = await readUpload(state, job.owner, id); return `data:${file.mime};base64,${file.bytes.toString('base64')}`; })) };
  const sent: unknown[] = [];
  const answer = { answer: 'A settings screen.', insufficientEvidence: false, citations: [], attachments: [] };
  await discuss(job, undefined, tools, undefined, async messages => { sent.push(...responseInput(messages)); return { content: JSON.stringify(answer) }; });
  const user = sent.at(-1) as { role: string; content: { type: string; image_url?: string; detail?: string }[] };
  expect(user.role).toBe('user');
  expect(user.content[1]).toEqual({ type: 'input_image', image_url: 'data:image/png;base64,' + png(1200, 800).toString('base64'), detail: 'high' });

  await processChatJob(state, submitted.id, async () => ({ answer, evidence: [] }));
  const conversation = await getConversation(state, 'owner', submitted.conversationId!);
  expect(conversation.turns[0].images).toEqual([image]);
  const followUp: ChatJob = { ...job, id: '9'.repeat(32), request: { question: 'Which button did it show?', history: [] }, images: [] };
  const replayed: unknown[] = [];
  await discuss(followUp, conversation as ChatConversation, tools, undefined, async messages => { replayed.push(...responseInput(messages)); return { content: JSON.stringify(answer) }; });
  expect(JSON.stringify(replayed)).toContain('"type":"input_image"');
  expect(JSON.stringify(replayed.at(-1))).not.toContain('input_image');
});

it('deletes only an owned conversation and stops its running answer from saving it again', async () => {
  const state = await store();
  const image = await saveUpload(state, 'owner', png(10, 10), 'image/png');
  const first = await submitChat(state, 'owner', { question: 'Keep this?', images: [image.id] }, async () => undefined);
  await processChatJob(state, first.id, insufficient);
  const running = await submitChat(state, 'owner', { question: 'Still answering', conversationId: first.conversationId }, async () => undefined);
  await expect(deleteConversation(state, 'other', first.conversationId!)).rejects.toMatchObject({ status: 404 });

  let saved = false;
  await processChatJob(state, running.id, async () => {
    await deleteConversation(state, 'owner', first.conversationId!);
    saved = true; return insufficient();
  });
  expect(saved).toBe(true);
  expect((await state.read<ChatJob>(`chat/jobs/${running.id}.json`))?.status).toBe('cancelled');
  await expect(getConversation(state, 'owner', first.conversationId!)).rejects.toMatchObject({ status: 404 });
  await expect(chatStatus(state, 'owner', running.id)).rejects.toMatchObject({ status: 404 });
  await expect(chatStatus(state, 'owner', first.id)).rejects.toMatchObject({ status: 404 });
  await expect(readUpload(state, 'owner', image.id)).rejects.toMatchObject({ status: 404 });
  expect(await listConversations(state, 'owner')).toEqual([]);
  await expect(submitChat(state, 'owner', { question: 'Continue', conversationId: first.conversationId }, async () => undefined)).rejects.toMatchObject({ status: 404 });
  await processChatJob(state, running.id, insufficient);
  expect(await state.read(`chat/conversations/owner/${first.conversationId}.json`)).toBeUndefined();
  expect((await submitChat(state, 'owner', { question: 'A new chat' }, async () => undefined)).conversationId).not.toBe(first.conversationId);
});

it('deleting a chat with a queued answer frees the reader to ask again', async () => {
  const state = await store();
  const queued = await submitChat(state, 'owner', { question: 'Queued' }, async () => undefined);
  await deleteConversation(state, 'owner', queued.conversationId!);
  await processChatJob(state, queued.id, async () => { throw new Error('Deleted chat must not run'); });
  expect((await state.read<ChatJob>(`chat/jobs/${queued.id}.json`))?.status).toBe('cancelled');
  await expect(submitChat(state, 'owner', { question: 'Next' }, async () => undefined)).resolves.toMatchObject({ status: 'pending' });
});

it('labels citations with a site, an author or a short title', () => {
  expect(citationLabel({ title: 'Paper', authors: ['Ada Lovelace'], url: 'https://www.nature.com/articles/x' })).toBe('nature.com');
  expect(citationLabel({ title: 'Paper', authors: ['Lovelace, Ada', 'Charles Babbage'], url: 'https://doi.org/10.1/x' })).toBe('Lovelace et al.');
  expect(citationLabel({ title: 'A very long saved source title that keeps going', authors: [], url: null })).toBe('A very long saved source…');
});

it('removes a late conversation write after deletion and preserves uploads used in another chat', async () => {
  const state = await store();
  const image = await saveUpload(state, 'owner', png(10, 10), 'image/png');
  const first = await submitChat(state, 'owner', { question: 'First', images: [image.id] }, async () => undefined);
  await processChatJob(state, first.id, insufficient);
  const second = await submitChat(state, 'owner', { question: 'Second', images: [image.id] }, async () => undefined);
  await processChatJob(state, second.id, insufficient);
  await deleteConversation(state, 'owner', first.conversationId!);
  expect((await readUpload(state, 'owner', image.id)).mime).toBe('image/png');
  const next = await submitChat(state, 'owner', { question: 'Late write', conversationId: second.conversationId }, async () => undefined);
  const write = state.write.bind(state); let intercepted = false;
  state.write = async (key, value) => {
    if (!intercepted && key === `chat/conversations/owner/${second.conversationId}.json`) {
      intercepted = true;
      await deleteConversation(state, 'owner', second.conversationId!);
    }
    await write(key, value);
  };
  await processChatJob(state, next.id, insufficient);
  expect(intercepted).toBe(true);
  expect(await state.read(`chat/conversations/owner/${second.conversationId}.json`)).toBeUndefined();
  expect((await state.read<ChatJob>(`chat/jobs/${next.id}.json`))?.result).toBeUndefined();
  await expect(getConversation(state, 'owner', second.conversationId!)).rejects.toMatchObject({ status: 404 });
});
