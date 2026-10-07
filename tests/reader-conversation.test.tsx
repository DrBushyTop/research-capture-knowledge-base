// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, createQueryClient, forgetPrivateData } from '../apps/reader/src/lib/api';
import { conversationQuery, conversationsQuery, jobQuery, keys, type Conversation, type JobStatus } from '../apps/reader/src/lib/queries';
import { useReaderConversation, type ConversationAdapter, type ConversationLocation, type ConversationStorage } from '../apps/reader/src/lib/reader-conversation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const a = 'a'.repeat(32);
const b = 'b'.repeat(32);
const sourceA = { sourceId: 'source-a', title: 'Source A' };
const sourceB = { sourceId: 'source-b', title: 'Source B' };
const result = { answer: 'Verified answer', citations: [], attachments: [] };
const screenshot = { id: 'screenshot-1', mime: 'image/png' as const, width: 800, height: 600 };
const empty = (id: string): Conversation => ({ id, owner: 'reader', createdAt: '', updatedAt: '', turns: [] });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
class ScriptedConversation {
  details = new Map([[a, empty(a)], [b, empty(b)]]);
  jobs = new Map<string, JobStatus | Error>([['job-a', { status: 'running' }], ['job-b', { status: 'running' }]]);
  readConversation = vi.fn(async (id: string) => {
    const detail = this.details.get(id);
    if (!detail) throw new ApiError('Conversation not found', 404);
    return detail;
  });
  readJob = vi.fn(async (id: string, _signal: AbortSignal): Promise<JobStatus> => {
    const job = this.jobs.get(id);
    if (job instanceof Error) throw job;
    if (!job) throw new ApiError('Job expired', 410);
    return job;
  });
  readHistory = vi.fn(async () => [{ id: a, title: 'Conversation A', updatedAt: '' }, { id: b, title: 'Conversation B', updatedAt: '' }]);
  submit = vi.fn(async (_body: Parameters<ConversationAdapter['submit']>[0]) => ({ id: 'retry-job', conversationId: a }));
  cancel = vi.fn(async (_id: string) => ({}));
  delete = vi.fn(async (id: string) => { this.details.delete(id); return {}; });
  adapter: ConversationAdapter = {
    conversation: id => ({ ...conversationQuery(id), queryFn: () => this.readConversation(id) }),
    history: { ...conversationsQuery, queryFn: () => this.readHistory() },
    job: id => ({ ...jobQuery(id), queryFn: ({ signal }) => this.readJob(id, signal) }),
    submit: body => this.submit(body), cancel: id => this.cancel(id), delete: id => this.delete(id)
  };
}
let root: Root | undefined;
let host: HTMLDivElement;
let client: QueryClient;
let view: ReturnType<typeof useReaderConversation>;
let location: ConversationLocation;
let adapter: ConversationAdapter | undefined;
let storage: ConversationStorage;
let render: () => void;
const opened: { id?: string; replace?: boolean }[] = [];
const localKey = (kind: string, source = sourceA) => kind === 'source' ? `research-chat-source:${source.sourceId}` : 'research-chat';
const activeKey = (kind: string, source = sourceA) => kind === 'source' ? `research-chat-active:${source.sourceId}` : 'research-chat-active';
const remember = (kind: string, id = a, jobId = 'job-a', source = sourceA) => {
  storage.local!.setItem(localKey(kind, source), id);
  storage.session!.setItem(activeKey(kind, source), JSON.stringify({ id: jobId, conversationId: id, question: `Question ${id[0]}`, images: [screenshot] }));
};
function Probe() {
  view = useReaderConversation(location, { adapter, storage });
  return <div>{view.turns.map(turn => <p key={turn.jobId}>{turn.question} {turn.result?.answer || turn.draft} {turn.failure}</p>)}<span role="status">{view.announcement}</span></div>;
}
async function flush(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function mount(kind: 'standalone' | 'source', script?: ScriptedConversation, id?: string, queryClient?: QueryClient) {
  adapter = script?.adapter;
  client = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 }, mutations: { retry: false } } });
  location = kind === 'source' ? { kind, source: sourceA } : { kind, conversationId: id, open: (id, replace) => {
    opened.push({ id, replace });
    location = { ...location, conversationId: id } as ConversationLocation;
    render();
  } };
  root = createRoot(host);
  render = () => root!.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
  await act(async () => render());
  for (let i = 0; i < 5; i++) await flush();
}
async function move(kind: 'standalone' | 'source', id: string, source = sourceB) {
  await act(async () => {
    location = kind === 'source' ? { kind, source } : { ...location, conversationId: id } as ConversationLocation;
    render();
  });
  for (let i = 0; i < 5; i++) await flush();
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }); opened.length = 0;
  storage = { local: new MemoryStorage(), session: new MemoryStorage() };
  host = document.createElement('div'); document.body.append(host);
});
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined;
  client?.clear(); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it.each(['standalone', 'source'] as const)('resumes a pending %s question through streamed draft and reconciled saved result', async kind => {
  const script = new ScriptedConversation();
  remember(kind);
  await mount(kind, script);
  expect(view.conversationId).toBe(a);
  expect(view.activeJobId).toBe('job-a');
  expect(view.turns[0].images).toEqual([screenshot]);
  if (kind === 'standalone') expect(opened).toEqual([{ id: a, replace: true }]);
  else expect(script.readHistory).not.toHaveBeenCalled();
  script.jobs.set('job-a', { status: 'running', draft: 'First paragraph.\n\nSecond paragraph.' });
  await flush(1000);
  expect(view.turns[0].draft).toContain('Second paragraph.');
  expect(view.turns[0].result).toBeUndefined();
  expect(client.getQueryData<Conversation>(keys.conversation(a))?.turns).toEqual([]);
  const savedTurn = { jobId: 'job-a', question: 'Question a', images: [screenshot], result };
  script.details.set(a, { ...empty(a), turns: [savedTurn] });
  script.jobs.set('job-a', { status: 'complete', result });
  await flush(1000); await flush();
  expect(view.turns).toEqual([savedTurn]);
  expect(view.activeJobId).toBeUndefined();
  expect(view.announcement).toBe('Answer ready');
  expect(storage.session!.getItem(activeKey(kind))).toBeNull();
  expect(storage.local!.getItem(localKey(kind))).toBe(a);
  expect([...((storage.local as MemoryStorage).values.values())]).toEqual([a]);
  expect(client.getQueryData(keys.job('job-a'))).toBeUndefined();
  const polls = script.readJob.mock.calls.length;
  await flush(10_000);
  expect(script.readJob).toHaveBeenCalledTimes(polls);
});

it.each(['standalone', 'source'] as const)('keeps %s Stop pending until server cancellation and Retry preserves a separate composer draft', async kind => {
  const script = new ScriptedConversation();
  script.jobs.set('retry-job', { status: 'running' });
  remember(kind);
  await mount(kind, script);
  await act(async () => view.setQuestion('My next question'));
  script.jobs.set('job-a', { status: 'running', draft: 'Unverified partial answer' });
  await flush(1000);
  await act(async () => { await Promise.all([view.cancel(), view.cancel()]); });
  expect(script.cancel).toHaveBeenCalledTimes(1);
  expect(view.stopping).toBe(true);
  expect(view.busy).toBe(true);
  await flush(1000);
  expect(view.stopping).toBe(true);
  await act(async () => { expect(await view.submit()).toBe(false); });
  expect(script.submit).not.toHaveBeenCalled();
  script.jobs.set('job-a', { status: 'cancelled', draft: 'Unverified partial answer' });
  await flush(1000); await flush();
  expect(view.turns[0]).toMatchObject({ failure: 'Stopped', draft: 'Unverified partial answer' });
  expect(view.stopping).toBe(false);
  expect(view.busy).toBe(false);
  await act(async () => { expect(await view.retry(view.turns[0])).toBe(true); });
  await flush();
  expect(script.submit).toHaveBeenCalledWith({ question: 'Question a', conversationId: a, images: [screenshot.id] });
  expect(view.question).toBe('My next question');
  expect(view.activeJobId).toBe('retry-job');
  expect(view.turns[1].images).toEqual([screenshot]);
  script.details.set(a, { ...empty(a), turns: [{ jobId: 'retry-job', question: 'Question a', result }] });
  script.jobs.set('retry-job', { status: 'complete', result });
  await flush(1000); await flush();
  expect(view.turns.filter(turn => turn.result)).toHaveLength(1);
  expect(view.question).toBe('My next question');
});

it.each(['standalone', 'source'] as const)('isolates %s navigation and resumes the original job when returning', async kind => {
  const script = new ScriptedConversation();
  remember(kind);
  if (kind === 'source') storage.local!.setItem(localKey(kind, sourceB), b);
  script.details.set(b, { ...empty(b), turns: [{ jobId: 'saved-b', question: 'Question b', result: { ...result, answer: 'Answer B' } }] });
  const late = deferred<JobStatus>();
  let signal: AbortSignal | undefined;
  script.readJob.mockImplementationOnce(async (_id, requestSignal) => { signal = requestSignal; return late.promise; });
  await mount(kind, script, a);
  await move(kind, b);
  expect(signal?.aborted).toBe(true);
  expect(view.conversationId).toBe(b);
  expect(view.activeJobId).toBeUndefined();
  expect(view.turns.map(turn => turn.question)).toEqual(['Question b']);
  await act(async () => late.resolve({ status: 'complete', result: { ...result, answer: 'Late answer A' } }));
  await flush();
  expect(host.textContent).not.toContain('Late answer A');
  expect(view.announcement).not.toBe('Answer ready');
  script.jobs.set('job-a', { status: 'running', draft: 'Resumed A draft' });
  await move(kind, a, sourceA);
  expect(view.activeJobId).toBe('job-a');
  expect(view.turns[0].draft).toBe('Resumed A draft');
  expect(host.textContent).not.toContain('Answer B');
  expect(storage.session!.getItem(activeKey(kind))).not.toBeNull();
});

it('backs off after a temporary poll failure with cached streamed data, then recovers', async () => {
  const script = new ScriptedConversation();
  remember('standalone');
  script.jobs.set('job-a', { status: 'running', draft: 'Keep this draft' });
  await mount('standalone', script, a);
  script.jobs.set('job-a', new ApiError('Worker unavailable', 503));
  await flush(1000);
  expect(view.error).toBe('Worker unavailable');
  expect(view.turns[0].draft).toBe('Keep this draft');
  expect(view.activeJobId).toBe('job-a');
  const polls = script.readJob.mock.calls.length;
  await flush(4999);
  expect(script.readJob).toHaveBeenCalledTimes(polls);
  script.jobs.set('job-a', { status: 'complete', result });
  await flush(1); await flush();
  expect(view.turns[0].result).toEqual(result);
  expect(view.error).toBe('');
  expect(view.activeJobId).toBeUndefined();
});

it.each([400, 401, 403, 404, 410])('ends a resumed streamed turn on fatal HTTP %i without saving the draft', async status => {
  const script = new ScriptedConversation();
  remember('source');
  script.jobs.set('job-a', { status: 'running', draft: 'Private unverified draft' });
  await mount('source', script);
  script.jobs.set('job-a', new ApiError('Answer unavailable', status));
  await flush(1000);
  expect(view.error).toBe('Answer unavailable');
  expect(view.turns[0]).toMatchObject({ failure: 'Answer unavailable', draft: 'Private unverified draft' });
  expect(view.turns[0].result).toBeUndefined();
  expect(view.activeJobId).toBeUndefined();
  expect(storage.session!.getItem(activeKey('source'))).toBeNull();
  const polls = script.readJob.mock.calls.length;
  await flush(10_000);
  expect(script.readJob).toHaveBeenCalledTimes(polls);
});

it.each(['standalone', 'source'] as const)('creates one %s question, keeps uploaded images and rejects duplicate submissions', async kind => {
  const script = new ScriptedConversation();
  script.submit.mockResolvedValue({ id: 'job-a', conversationId: a });
  await mount(kind, script);
  await act(async () => view.setQuestion('  Inspect my screenshot  '));
  await act(async () => {
    const first = view.submit([screenshot]);
    expect(await view.submit([screenshot])).toBe(false);
    expect(await first).toBe(true);
    expect(await view.submit([screenshot])).toBe(false);
  });
  await flush();
  expect(script.submit).toHaveBeenCalledTimes(1);
  expect(script.submit).toHaveBeenCalledWith({ question: 'Inspect my screenshot', images: [screenshot.id], ...(kind === 'source' ? { sourceId: sourceA.sourceId } : {}) });
  expect(view.question).toBe('');
  expect(view.turns[0].images).toEqual([screenshot]);
  expect(view.conversationId).toBe(a);
  expect(view.context).toEqual(kind === 'source' ? sourceA : undefined);
});

it.each(['standalone', 'source'] as const)('retains an accepted %s submission after navigation and resumes it on return', async kind => {
  const script = new ScriptedConversation();
  const late = deferred<{ id: string; conversationId: string }>();
  script.submit.mockImplementation(() => late.promise);
  if (kind === 'source') storage.local!.setItem(localKey(kind, sourceB), b);
  await mount(kind, script);
  await act(async () => view.setQuestion('Old submission'));
  let submission!: Promise<boolean>;
  await act(async () => { submission = view.submit(); });
  await move(kind, b);
  await act(async () => late.resolve({ id: 'job-a', conversationId: a }));
  expect(await submission).toBe(false);
  await flush();
  expect(view.conversationId).toBe(b);
  expect(view.turns).toEqual([]);
  expect(opened).toEqual([]);
  expect(JSON.parse(storage.session!.getItem(activeKey(kind))!)).toMatchObject({ id: 'job-a', conversationId: a, question: 'Old submission' });
  if (kind === 'source') expect(storage.session!.getItem(activeKey(kind, sourceB))).toBeNull();
  expect(client.getQueryData(keys.conversation(a))).toBeUndefined();
  await move(kind, a, sourceA);
  expect(view.activeJobId).toBe('job-a');
  expect(view.turns[0].question).toBe('Old submission');
  await act(async () => view.cancel());
  expect(script.cancel).toHaveBeenCalledWith('job-a');
});

it.each(['standalone', 'source'] as const)('recovers an accepted %s submission after unmount', async kind => {
  const script = new ScriptedConversation();
  const late = deferred<{ id: string; conversationId: string }>();
  script.submit.mockImplementation(() => late.promise);
  await mount(kind, script);
  await act(async () => view.setQuestion('Question left running'));
  let submission!: Promise<boolean>;
  await act(async () => { submission = view.submit(); });
  await act(async () => root!.unmount()); root = undefined;
  await act(async () => late.resolve({ id: 'job-a', conversationId: a }));
  expect(await submission).toBe(false);
  expect(opened).toEqual([]);
  await mount(kind, script);
  expect(view.conversationId).toBe(a);
  expect(view.activeJobId).toBe('job-a');
  expect(view.turns[0].question).toBe('Question left running');
});

it.each(['standalone', 'source'] as const)('accepts the %s job when navigation returns before its response', async kind => {
  const script = new ScriptedConversation();
  const late = deferred<{ id: string; conversationId: string }>();
  script.submit.mockImplementation(() => late.promise);
  storage.local!.setItem(localKey(kind), a);
  if (kind === 'source') storage.local!.setItem(localKey(kind, sourceB), b);
  await mount(kind, script, a);
  await act(async () => view.setQuestion('Question while navigating'));
  let submission!: Promise<boolean>;
  await act(async () => { submission = view.submit(); });
  await move(kind, b);
  await move(kind, a, sourceA);
  await act(async () => late.resolve({ id: 'job-a', conversationId: a }));
  expect(await submission).toBe(true);
  await flush();
  expect(view.activeJobId).toBe('job-a');
  expect(view.turns[0].question).toBe('Question while navigating');
});

it.each([['standalone', true], ['source', true], ['standalone', false], ['source', false]] as const)('resumes the accepted %s job when remount precedes acknowledgement, existing conversation %s', async (kind, existing) => {
  const script = new ScriptedConversation();
  const late = deferred<{ id: string; conversationId: string }>();
  script.submit.mockImplementation(() => late.promise);
  if (existing) storage.local!.setItem(localKey(kind), a);
  await mount(kind, script, existing ? a : undefined);
  await act(async () => view.setQuestion('Question before remount'));
  let submission!: Promise<boolean>;
  await act(async () => { submission = view.submit([screenshot]); });
  await act(async () => root!.unmount()); root = undefined;
  await mount(kind, script, existing ? a : undefined);
  await act(async () => late.resolve({ id: 'job-a', conversationId: a }));
  expect(await submission).toBe(false);
  await flush();
  expect(view.conversationId).toBe(a);
  expect(view.activeJobId).toBe('job-a');
  expect(view.busy).toBe(true);
  expect(view.turns[0]).toMatchObject({ question: 'Question before remount', images: [screenshot] });
  expect(script.readJob).toHaveBeenCalledWith('job-a', expect.any(AbortSignal));
  await act(async () => view.cancel());
  expect(script.cancel).toHaveBeenCalledWith('job-a');
});

it('preserves HTTP auth generation fencing for a late submission after private data is forgotten', async () => {
  const late = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? late.promise : new Response('[]', { headers: { 'Content-Type': 'application/json' } })));
  await mount('standalone', undefined, undefined, createQueryClient());
  await act(async () => view.setQuestion('Private question'));
  let submission!: Promise<boolean>;
  await act(async () => { submission = view.submit(); });
  await act(async () => { forgetPrivateData(client, false); });
  await act(async () => late.resolve(new Response(JSON.stringify({ id: 'job-a', conversationId: a }), { headers: { 'Content-Type': 'application/json' } })));
  expect(await submission).toBe(false);
  await flush();
  expect(view.error).toMatch(/^Sign in/);
  expect(view.activeJobId).toBeUndefined();
  expect(storage.local!.getItem('research-chat')).toBeNull();
  expect(storage.session!.getItem('research-chat-active')).toBeNull();
  expect(client.getQueryData(keys.conversation(a))).toBeUndefined();
});

it('ignores corrupt recovery records and works when browser storage refuses access', async () => {
  const script = new ScriptedConversation();
  storage.session!.setItem('research-chat-active', JSON.stringify({ id: 'job-a', conversationId: a, question: 123 }));
  storage.local!.setItem('research-chat', 'malformed-id');
  await mount('standalone', script);
  expect(opened).toEqual([]);
  expect(view.activeJobId).toBeUndefined();
  await act(async () => root!.unmount()); root = undefined;
  storage = { local: { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Denied'); }, removeItem() { throw new Error('Denied'); } } };
  script.submit.mockResolvedValue({ id: 'job-a', conversationId: a });
  await mount('source', script);
  await act(async () => view.setQuestion('Question without storage'));
  await act(async () => { expect(await view.submit()).toBe(true); });
  await flush();
  expect(view.turns[0].question).toBe('Question without storage');
  expect(view.activeJobId).toBe('job-a');
});

it('recovers a missing conversation and clears its remembered address on New chat', async () => {
  const script = new ScriptedConversation();
  script.details.delete(a);
  storage.local!.setItem('research-chat', a);
  await mount('standalone', script);
  expect(view.unavailable).toBe('Conversation not found');
  expect(storage.local!.getItem('research-chat')).toBeNull();
  await act(async () => { expect(view.newConversation()).toBe(true); });
  await flush();
  expect(view.conversationId).toBeUndefined();
  expect(view.unavailable).toBeUndefined();
});

it('deletes the selected conversation, reconciles history and preserves another source resume key', async () => {
  const script = new ScriptedConversation();
  storage.local!.setItem('research-chat', a);
  remember('source', b, 'job-b', sourceB);
  await mount('standalone', script, a);
  await act(async () => view.deleteConversation(a));
  await flush();
  expect(script.delete).toHaveBeenCalledWith(a);
  expect(view.conversationId).toBeUndefined();
  expect(view.history.items.map(item => item.id)).toEqual([b]);
  expect(client.getQueryData(keys.conversation(a))).toBeUndefined();
  expect(storage.local!.getItem('research-chat')).toBeNull();
  expect(storage.session!.getItem(activeKey('source', sourceB))).not.toBeNull();
});


it('clears an obsolete pending record when the conversation already contains the verified answer', async () => {
  const script = new ScriptedConversation();
  remember('source');
  script.jobs.delete('job-a');
  script.details.set(a, { ...empty(a), turns: [{ jobId: 'job-a', question: 'Question a', result }] });
  await mount('source', script);
  expect(view.turns).toEqual([{ jobId: 'job-a', question: 'Question a', result }]);
  expect(view.error).toBe('');
  expect(view.activeJobId).toBeUndefined();
  expect(storage.session!.getItem(activeKey('source'))).toBeNull();
});

it('lets Stop retry after cancellation fails while another conversation is open', async () => {
  const script = new ScriptedConversation();
  remember('standalone');
  const late = deferred<unknown>();
  script.cancel.mockImplementationOnce(async () => { await late.promise; throw new Error('Cancel unavailable'); });
  await mount('standalone', script, a);
  let cancellation!: Promise<void>;
  await act(async () => { cancellation = view.cancel(); });
  expect(view.stopping).toBe(true);
  await move('standalone', b);
  await act(async () => late.resolve({}));
  await cancellation; await flush();
  expect(view.error).toBe('');
  await move('standalone', a);
  expect(view.activeJobId).toBe('job-a');
  expect(view.stopping).toBe(false);
  await act(async () => view.cancel());
  expect(script.cancel).toHaveBeenCalledTimes(2);
});

it('retains the composer and attachments after submission fails and permits a later attempt', async () => {
  const script = new ScriptedConversation();
  script.submit.mockRejectedValueOnce(new ApiError('Submission unavailable', 503));
  script.jobs.set('retry-job', { status: 'running' });
  await mount('source', script);
  await act(async () => view.setQuestion('Inspect this image'));
  await act(async () => { expect(await view.submit([screenshot])).toBe(false); });
  await flush();
  expect(view.question).toBe('Inspect this image');
  expect(view.error).toBe('Submission unavailable');
  expect(view.turns).toEqual([]);
  expect(storage.session!.getItem(activeKey('source'))).toBeNull();
  expect(script.submit).toHaveBeenCalledTimes(1);
  await act(async () => { expect(await view.submit([screenshot])).toBe(true); });
  await flush();
  expect(view.error).toBe('');
  expect(view.turns[0].images).toEqual([screenshot]);
});

it('keeps two source resume records independent of standalone Chat', async () => {
  const script = new ScriptedConversation();
  remember('standalone');
  remember('source', a, 'job-a', sourceA);
  remember('source', b, 'job-b', sourceB);
  script.jobs.set('job-a', { status: 'running', draft: 'Source A draft' });
  script.jobs.set('job-b', { status: 'running', draft: 'Source B draft' });
  await mount('source', script);
  expect(view.turns[0].draft).toBe('Source A draft');
  await act(async () => view.setQuestion('Source A composer'));
  await move('source', b, sourceB);
  expect(view.question).toBe('');
  expect(view.activeJobId).toBe('job-b');
  expect(view.turns[0].draft).toBe('Source B draft');
  expect(host.textContent).not.toContain('Source A draft');
  expect(storage.session!.getItem('research-chat-active')).not.toBeNull();
  await move('source', a, sourceA);
  expect(view.activeJobId).toBe('job-a');
  expect(view.turns[0].draft).toBe('Source A draft');
});
