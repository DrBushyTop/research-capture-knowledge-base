// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { normalize } from '../shared/corpus.js';
import { snapshot } from './fixtures.js';
import { createAppRouter, parseSourcesSearch } from '../apps/reader/src/app/router';
import { accessStore, createQueryClient, getJson } from '../apps/reader/src/lib/api';
import { keys, libraryQuery, jobQuery } from '../apps/reader/src/lib/queries';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const source = normalize(snapshot)[0].source;
const ids = ['zotero-users-1-AAAAAAAA', 'zotero-users-1-BBBBBBBB'];
const entry = (id: string, title: string) => ({ note: { schemaVersion: 1, source: { ...source, id, title }, analysis: null,
  extraction: { status: 'text', method: 'html', reason: null }, processing: { processedAt: '2026-10-06T00:00:00Z' } }, humanHtml: '', searchText: title === 'Alpha' ? 'zebra' : '' });
const conversationId = 'a'.repeat(32);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
let handler: Handler;
let calls: string[];
let root: Root | undefined;
let host: HTMLDivElement;

const api: Handler = (url, init) => {
  if (url.includes('library=1')) return json([entry(ids[0], 'Alpha'), entry(ids[1], 'Beta')]);
  if (url.includes('notes=')) return init?.method === 'POST' ? json({ markdown: 'saved', revision: 2, updatedAt: '2026-10-06T00:00:00Z' }) : json({ markdown: '', revision: 1 });
  if (url.includes('source=')) return json({ text: '' });
  if (url.includes('conversations=1')) return json([{ id: conversationId, title: 'Old question', updatedAt: '2026-10-06T00:00:00Z' }]);
  if (url.includes(`conversation=${conversationId}`)) return json({ id: conversationId, owner: 'o', createdAt: '', updatedAt: '', turns: [{ jobId: 'job1', question: 'Old question', result: { answer: 'Old answer', citations: [], attachments: [] } }] });
  if (url.includes('conversation=')) return json({ error: 'Conversation not found' }, 404);
  if (url.startsWith('/api/categories')) return json({ registry: { revision: 1, categories: [{ id: 'other', name: 'Other', description: 'd', revision: 1, archived: false, sections: [{ id: 's', heading: 'H', instructions: 'I', format: 'bullets' }] }] }, sources: [], batches: [] });
  return json({ error: 'Unexpected' }, 500);
};

beforeEach(() => {
  calls = []; handler = api;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); calls.push(`${init?.method || 'GET'} ${url}`);
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return handler(url, init);
  }));
  window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
  HTMLElement.prototype.scrollTo = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
  window.scrollTo = () => {};
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  localStorage.clear(); sessionStorage.clear();
  host = document.createElement('div'); document.body.append(host);
});
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined;
  host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

async function settle() { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function mount(url: string, client: QueryClient = createQueryClient()) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  root = createRoot(host);
  await act(async () => root!.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>));
  await settle();
  return { router, client };
}
const click = async (element: Element | null) => { expect(element).toBeTruthy(); await act(async () => { element!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); }); await settle(); };
const type = async (element: HTMLTextAreaElement | HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!;
  await act(async () => { setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); await settle();
};
const path = (router: ReturnType<typeof createAppRouter>) => router.state.location.href;

it('parses only well-formed source search values', () => {
  expect(parseSourcesSearch({ source: ids[0], q: 'heart', year: 2024, type: '', topic: ['x'], extra: 'y' })).toEqual({ source: ids[0], q: 'heart', year: '2024' });
  expect(parseSourcesSearch({ source: '../etc', category: 5 })).toEqual({ category: '5' });
});

it('restores a source deep link and keeps one reader through source changes and back/forward', async () => {
  const { router } = await mount(`/sources/?source=${ids[1]}`);
  expect(host.querySelector('.note-head h1')?.textContent).toBe('Beta');
  for (const [id, title] of [[ids[0], 'Alpha'], [ids[1], 'Beta'], [ids[0], 'Alpha']]) {
    await click(host.querySelector(`.source-rows a[href*="${id}"]`));
    expect(host.querySelectorAll('main')).toHaveLength(1);
    expect(host.querySelector('.note-head h1')?.textContent).toBe(title);
  }
  await act(async () => router.history.back()); await settle();
  expect(host.querySelector('.note-head h1')?.textContent).toBe('Beta');
  await act(async () => router.history.forward()); await settle();
  expect(host.querySelector('.note-head h1')?.textContent).toBe('Alpha');
  expect(calls.filter(call => call.includes('library=1'))).toHaveLength(1);
});

it('shows useful states for unknown sources, unknown paths and malformed conversation IDs', async () => {
  const { router } = await mount('/sources/?source=zotero-users-1-ZZZZZZZZ');
  expect(host.textContent).toContain('This source is unavailable');
  await act(async () => { await router.navigate({ href: '/nowhere/' }); }); await settle();
  expect(host.textContent).toContain('Page not found');
  await act(async () => { await router.navigate({ to: '/chat/$conversationId/', params: { conversationId: 'not-an-id' } }); }); await settle();
  expect(host.textContent).toContain('This chat address is not valid');
  expect(calls.some(call => call.includes('conversation=not-an-id'))).toBe(false);
});

it('keeps search and filters in the URL and searches refreshed note text', async () => {
  const { router, client } = await mount('/sources/?q=zebra');
  expect([...host.querySelectorAll('.source-title')].map(node => node.textContent)).toEqual(['Alpha']);
  await type(host.querySelector<HTMLInputElement>('#search')!, 'giraffe');
  expect(path(router)).toContain('q=giraffe');
  expect(host.querySelectorAll('.source-title')).toHaveLength(0);
  handler = (url, init) => url.includes('library=1') ? json([entry(ids[0], 'Alpha'), { ...entry(ids[1], 'Beta'), searchText: 'giraffe notes' }]) : api(url, init);
  await act(async () => { await client.invalidateQueries({ queryKey: keys.library }); }); await settle();
  expect([...host.querySelectorAll('.source-title')].map(node => node.textContent)).toEqual(['Beta']);
});

it('blocks leaving a dirty note, keeps the draft when cancelled, and refreshes the library after save', async () => {
  const { router } = await mount(`/sources/?source=${ids[0]}`);
  await click([...host.querySelectorAll('.reader-notes button')].find(button => button.textContent === 'Add notes')!);
  await type(host.querySelector<HTMLTextAreaElement>('#reader-note-draft')!, 'my draft');
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await click(host.querySelector(`.source-rows a[href*="${ids[1]}"]`));
  expect(confirm).toHaveBeenCalled();
  expect(path(router)).toContain(ids[0]);
  expect(host.querySelector<HTMLTextAreaElement>('#reader-note-draft')?.value).toBe('my draft');
  // Searching the list is not leaving the source.
  confirm.mockClear();
  await type(host.querySelector<HTMLInputElement>('#search')!, 'alp');
  expect(confirm).not.toHaveBeenCalled();
  await act(async () => router.history.back()); await settle();
  expect(path(router)).toContain(ids[0]);
  const libraryLoads = calls.filter(call => call.includes('library=1')).length;
  await click([...host.querySelectorAll('.reader-notes button')].find(button => button.textContent === 'Save notes')!);
  expect(calls.filter(call => call.startsWith('POST') && call.includes('notes='))).toHaveLength(1);
  expect(calls.filter(call => call.includes('library=1')).length).toBe(libraryLoads + 1);
  confirm.mockClear();
  await type(host.querySelector<HTMLInputElement>('#search')!, '');
  await click(host.querySelector(`.source-rows a[href*="${ids[1]}"]`));
  expect(confirm).not.toHaveBeenCalled();
  expect(host.querySelector('.note-head h1')?.textContent).toBe('Beta');
});

it('keeps a conflicting note draft and loads the latest saved revision', async () => {
  handler = (url, init) => url.includes('notes=') && init?.method === 'POST' ? json({ error: 'Someone else saved' }, 409) : api(url, init);
  await mount(`/sources/?source=${ids[0]}`);
  await click([...host.querySelectorAll('.reader-notes button')].find(button => button.textContent === 'Add notes')!);
  await type(host.querySelector<HTMLTextAreaElement>('#reader-note-draft')!, 'mine');
  await click([...host.querySelectorAll('.reader-notes button')].find(button => button.textContent === 'Save notes')!);
  expect(host.textContent).toContain('Someone else saved');
  expect(host.querySelector<HTMLTextAreaElement>('#reader-note-draft')?.value).toBe('mine');
  expect(calls.filter(call => call.startsWith('POST'))).toHaveLength(1);
  await click([...host.querySelectorAll('.reader-notes button')].find(button => button.textContent?.startsWith('Load latest'))!);
  expect(host.querySelector<HTMLTextAreaElement>('#reader-note-draft')?.value).toBe('mine');
});

it('blocks leaving dirty category edits until the user discards them', async () => {
  const { router } = await mount('/categories/');
  await type(host.querySelector<HTMLInputElement>('#template-name')!, 'Renamed');
  await click(host.querySelector('.masthead nav a[href="/sources/"]'));
  expect(path(router)).toBe('/categories/');
  expect(host.querySelector<HTMLInputElement>('#template-name')?.value).toBe('Renamed');
  await click([...host.querySelectorAll('[role=alertdialog] button')].find(button => button.textContent === 'Keep editing')!);
  expect(path(router)).toBe('/categories/');
  await click(host.querySelector('.masthead nav a[href="/sources/"]'));
  await click([...host.querySelectorAll('[role=alertdialog] button')].find(button => button.textContent === 'Discard changes')!);
  expect(path(router)).toBe('/sources/');
});

it('opens and keeps a conversation deep link, and a new conversation gets its own address', async () => {
  const { router } = await mount(`/chat/${conversationId}/`);
  expect(path(router)).toBe(`/chat/${conversationId}/`);
  expect(host.textContent).toContain('Old answer');
  expect(localStorage.getItem('research-chat')).toBe(conversationId);
  await click(host.querySelector('button[aria-label="New chat"]'));
  expect(path(router)).toBe('/');
  const created = 'b'.repeat(32);
  handler = (url, init) => init?.method === 'POST' ? json({ id: 'job2', conversationId: created }) : url.includes('id=job2') ? json({ status: 'running' }) : api(url, init);
  await type(host.querySelector<HTMLTextAreaElement>('#chat-message')!, 'New question');
  await act(async () => { host.querySelector('form.chat-composer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await settle();
  expect(path(router)).toBe(`/chat/${created}/`);
  expect(host.textContent).toContain('New question');
  expect(calls.filter(call => call.startsWith('POST'))).toHaveLength(1);
});

it('plain chat address resumes the last conversation, and a missing one shows recovery', async () => {
  localStorage.setItem('research-chat', 'c'.repeat(32));
  const { router } = await mount('/');
  expect(path(router)).toBe(`/chat/${'c'.repeat(32)}/`);
  expect(host.textContent).toContain('It may have been deleted');
  expect(localStorage.getItem('research-chat')).toBeNull();
});

it('reuses cached data, cancels fetches and stops job polling at a final state', async () => {
  const client = createQueryClient();
  await client.fetchQuery(libraryQuery);
  await client.fetchQuery(libraryQuery);
  expect(calls).toHaveLength(1);
  let seen: AbortSignal | undefined;
  handler = (_url, init) => { seen = init?.signal ?? undefined; return new Promise(() => {}); };
  const pending = client.fetchQuery({ ...libraryQuery, staleTime: 0 }).catch(() => undefined);
  await new Promise(resolve => setTimeout(resolve, 0));
  await client.cancelQueries({ queryKey: keys.library });
  await pending;
  expect(seen?.aborted).toBe(true);
  vi.useFakeTimers();
  try {
    let status = 'running';
    handler = () => json({ status });
    const observerClient = createQueryClient();
    const { QueryObserver } = await import('@tanstack/react-query');
    const observer = new QueryObserver(observerClient, jobQuery('job9'));
    const stop = observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4100);
    const running = calls.filter(call => call.includes('id=job9')).length;
    expect(running).toBe(3);
    status = 'complete';
    await vi.advanceTimersByTimeAsync(2100);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.filter(call => call.includes('id=job9')).length).toBe(running + 1);
    stop();
  } finally { vi.useRealTimers(); }
});

it('does not retry validation errors and lets temporary failures retry a bounded number of times', async () => {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 0 } });
  handler = () => json({ error: 'Bad' }, 400);
  await expect(client.fetchQuery({ queryKey: ['x'], queryFn: ({ signal }) => getJson('/api/chat?x=1', signal), retry: client.getDefaultOptions().queries!.retry })).rejects.toThrow('Bad');
  expect(calls).toHaveLength(1);
  calls = []; handler = () => json({ error: 'Down' }, 503);
  await expect(client.fetchQuery({ queryKey: ['y'], queryFn: ({ signal }) => getJson('/api/chat?y=1', signal), retry: client.getDefaultOptions().queries!.retry, retryDelay: 0 })).rejects.toThrow('Down');
  expect(calls).toHaveLength(3);
});

it('clears private data on authorization loss, ignores late answers, and shows sign-in recovery', async () => {
  let release!: (response: Response) => void;
  handler = (url, init) => url.includes('notes=') ? new Promise<Response>(resolve => { release = resolve; }) : api(url, init);
  const { client } = await mount(`/sources/?source=${ids[0]}`);
  expect(client.getQueryData(keys.library)).toBeTruthy();
  handler = () => new Response('<html>login</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  await act(async () => { await client.refetchQueries({ queryKey: keys.library }); }); await settle();
  expect(accessStore.get()).toBe(true);
  expect(client.getQueryData(keys.library)).toBeUndefined();
  expect(host.textContent).toContain('Access unavailable');
  expect(host.querySelector('a[href="/login.html"]')).toBeTruthy();
  expect(host.querySelector('.sources-shell')).toBeNull();
  release(json({ markdown: 'late private text', revision: 1 })); await settle();
  expect(client.getQueryData(keys.notes(ids[0]))).toBeUndefined();
  expect(host.textContent).not.toContain('late private text');
});
