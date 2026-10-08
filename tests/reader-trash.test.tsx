// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { normalize } from '../shared/corpus.js';
import { snapshot } from './fixtures.js';
import { createAppRouter } from '../apps/reader/src/app/router';
import { createQueryClient } from '../apps/reader/src/lib/api';
import type { SourceLifecycle } from '../shared/source-lifecycle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const base = normalize(snapshot)[0].source;
const [alpha, beta] = ['zotero-users-1-AAAAAAAA', 'zotero-users-1-BBBBBBBB'];
const entry = (id: string, title: string) => ({ note: { schemaVersion: 1, source: { ...base, id, title }, analysis: null,
  extraction: { status: 'text', method: 'html', reason: null }, processing: { processedAt: '2026-10-06T00:00:00Z' } }, humanHtml: '', searchText: '' });
const entries = { [alpha]: entry(alpha, 'Alpha'), [beta]: entry(beta, 'Beta') };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const life = (sourceId: string, state: SourceLifecycle['state'], revision: number, error: string | null = null): SourceLifecycle => ({ sourceId, state, revision, changedAt: '2026-10-07T10:00:00Z', changedBy: 'octo', error });

let states: Record<string, SourceLifecycle>;
let posts: { url: string; body: unknown }[];
let override: ((url: string, init?: RequestInit) => Response | undefined) | undefined;
let root: Root | undefined;
let host: HTMLDivElement;
const conversationId = 'c'.repeat(32);
const cite = (sourceId: string, title: string, n: string) => ({ evidenceId: `e_${n.repeat(16)}`, quote: `Quoted from ${title}`, sourceId, generationId: 'g', title, label: title, kind: 'source', locator: 'p. 1', excerpt: 'x', sourceUrl: null, pdf: true, assetId: null });

function api(url: string, init?: RequestInit): Response {
  const custom = override?.(url, init);
  if (custom) return custom;
  const lifecycleId = url.match(/lifecycle=([^&]+)/)?.[1];
  if (lifecycleId && init?.method === 'POST') {
    const id = decodeURIComponent(lifecycleId), { action, revision } = JSON.parse(String(init.body));
    posts.push({ url, body: { action, revision } });
    const current = states[id] ?? life(id, 'active', 0);
    if (revision !== current.revision) return json({ error: 'Source changed' }, 409);
    const next = { trash: 'trashed', restore: 'active', purge: 'purging', retry: 'purging' }[action as string] as SourceLifecycle['state'];
    states[id] = life(id, next, current.revision + 1);
    return json(states[id]);
  }
  if (url.includes('lifecycles=1')) return json(states);
  if (url.includes('trash=1')) return json(Object.values(states).filter(item => item.state === 'trashed' || item.state === 'purging')
    .map(item => ({ sourceId: item.sourceId, title: item.state === 'purging' ? null : entries[item.sourceId].note.source.title, lifecycle: item, ...(item.state === 'trashed' ? { entry: entries[item.sourceId] } : {}) })));
  if (url.includes('library=1')) return json(Object.values(entries).filter(item => (states[item.note.source.id]?.state ?? 'active') === 'active'));
  if (url.includes('notes=')) return json({ markdown: 'Saved reader note', revision: 1 });
  if (url.includes('source=')) return json({ text: 'Original words' });
  if (url.includes('conversations=1')) return json([{ id: conversationId, title: 'Old question', updatedAt: '2026-10-06T00:00:00Z', sourceContext: { sourceId: beta, title: 'Beta' } }]);
  if (url.includes(`conversation=${conversationId}`)) return json({ id: conversationId, owner: 'o', createdAt: '', updatedAt: '', sourceContext: { sourceId: beta, title: 'Beta' },
    turns: [{ jobId: 'job1', question: 'Old question', result: { answer: 'Alpha says [e_aaaaaaaaaaaaaaaa]. Beta says [e_bbbbbbbbbbbbbbbb].', citations: [cite(alpha, 'Alpha', 'a'), cite(beta, 'Beta', 'b')],
      attachments: [{ id: 'a_' + 'b'.repeat(16), sourceId: beta, title: 'Beta figure', kind: 'pdf', mime: 'application/pdf', page: null }] } }] });
  return json({ error: 'Unexpected' }, 500);
}

beforeEach(() => {
  states = {}; posts = []; override = undefined;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => api(String(input), init)));
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

async function settle() { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function mount(url: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const client = createQueryClient();
  root = createRoot(host);
  await router.load();
  await act(async () => root!.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>));
  await settle();
  return { router, client };
}
const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => { element!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); }); await settle(); };
const button = (text: string, scope: ParentNode = document) => [...scope.querySelectorAll('button')].find(item => item.textContent?.trim() === text);

it('refreshes the library when another admin restores a source', async () => {
  states = { [alpha]: life(alpha, 'trashed', 1) };
  const { client } = await mount('/sources/');
  expect(host.querySelector(`a[href*="${alpha}"]`)).toBeNull();
  states = { [alpha]: life(alpha, 'active', 2) };
  await act(async () => { await client.invalidateQueries({ queryKey: ['lifecycles'] }); });
  await settle();
  expect(host.querySelector(`a[href*="${alpha}"]`)).not.toBeNull();
});

it('moves an active source to Trash, shows it read-only, and Undo restores the saved copy', async () => {
  await mount(`/sources/?source=${alpha}`);
  expect(host.querySelector('h1')?.textContent).not.toBe('');
  expect(host.querySelector('.research-note h1')?.textContent).toBe('Alpha');
  await click(button('Move to Trash'));
  expect(posts).toEqual([{ url: `/api/chat?lifecycle=${alpha}`, body: { action: 'trash', revision: 0 } }]);
  const note = host.querySelector('.research-note')!;
  expect(note.querySelector('.trash-notice')?.textContent).toContain('In Trash');
  expect(note.querySelector('h1')?.textContent).toBe('Alpha');
  expect(note.textContent).toContain('Saved reader note');
  expect(note.textContent).toContain('Original words');
  expect(note.querySelector('[data-ask-open]')).toBeNull();
  expect(button('Edit notes')).toBeUndefined();
  expect(note.querySelector('.category-change')).toBeNull();
  expect(host.querySelector('#source-ask')).toBeNull();
  // The list and its search drop the trashed source.
  expect([...host.querySelectorAll('.source-title')].map(item => item.textContent)).toEqual(['Beta']);
  await click(button('Undo'));
  expect(posts[1].body).toEqual({ action: 'restore', revision: 1 });
  expect(host.querySelector('.trash-notice')).toBeNull();
  expect(button('Move to Trash')).toBeTruthy();
  expect(host.querySelector('[data-ask-open]')).toBeTruthy();
});

it('lists Trash from the menu, restores, and deletes permanently after a confirmation that names the source', async () => {
  states[alpha] = life(alpha, 'trashed', 1);
  states[beta] = life(beta, 'trashed', 1);
  localStorage.setItem(`reader-note-draft:${beta}`, 'unsaved');
  const { router } = await mount('/sources/');
  await click(host.querySelector('button[aria-label="More"]'));
  await click([...document.querySelectorAll('.masthead-menu a')].find(link => link.textContent === 'Trash'));
  expect(router.state.location.pathname).toBe('/trash/');
  const rows = () => [...host.querySelectorAll('.trash-row')];
  expect(rows().map(row => row.querySelector('.trash-title')?.textContent)).toEqual(['Alpha', 'Beta']);
  await click(button('Restore', rows()[0]));
  expect(posts[0].body).toEqual({ action: 'restore', revision: 1 });
  expect(rows().map(row => row.querySelector('.trash-title')?.textContent)).toEqual(['Beta']);

  await click(button('Delete permanently', rows()[0]));
  const dialog = document.querySelector('[role=alertdialog]')!;
  expect(dialog.textContent).toContain('Delete "Beta" permanently?');
  expect(dialog.textContent).toContain('Quotations in existing conversations remain');
  expect(document.activeElement?.textContent).toBe('Keep in Trash');
  await click(button('Delete permanently', dialog));
  expect(posts[1].body).toEqual({ action: 'purge', revision: 1 });
  expect(document.querySelector('[role=alertdialog]')).toBeNull();
  expect(localStorage.getItem(`reader-note-draft:${beta}`)).toBeNull();
  expect(rows()[0].textContent).toContain('Deleting permanently');
  expect(button('Restore', rows()[0])).toBeUndefined();
});

it('shows a cleanup failure with Retry cleanup, and a stale change refreshes to the real state', async () => {
  states[alpha] = life(alpha, 'purging', 3, 'Original file cleanup failed.');
  states[beta] = life(beta, 'trashed', 4);
  await mount('/trash/');
  const failed = host.querySelector('.trash-row')!;
  expect(failed.textContent).toContain('Original file cleanup failed.');
  await click(button('Retry cleanup', failed));
  expect(posts[0].body).toEqual({ action: 'retry', revision: 3 });

  // Another admin restored Beta after this page loaded.
  states[beta] = life(beta, 'active', 5);
  const betaRow = [...host.querySelectorAll('.trash-row')].find(row => row.textContent?.includes('Beta'))!;
  await click(button('Restore', betaRow));
  expect(posts[1].body).toEqual({ action: 'restore', revision: 4 });
  expect(host.textContent).not.toContain('Beta');
});

it('shows conflict copy when a change is stale', async () => {
  states[alpha] = life(alpha, 'trashed', 2);
  override = (url, init) => init?.method === 'POST' ? json({ error: 'Source changed' }, 409) : undefined;
  await mount(`/sources/?source=${alpha}`);
  await click(button('Restore'));
  expect(host.querySelector('.trash-notice [role=alert]')?.textContent).toBe('This source was changed in another session. Its current state is shown.');
});

it('keeps quotations for deleted sources but offers no note or file links, and trashed citations open read-only', async () => {
  states[alpha] = life(alpha, 'trashed', 1);
  states[beta] = life(beta, 'deleted', 3);
  await mount(`/chat/${conversationId}/`);
  const pills = [...host.querySelectorAll<HTMLButtonElement>('.chat-citation-button')];
  expect(pills[0].getAttribute('aria-label')).toBe('Sources: Alpha (In Trash)');
  expect(pills[1].getAttribute('aria-label')).toBe('Sources: Beta (Deleted)');
  expect(host.querySelector('.chat-context')?.textContent).toContain('Deleted');
  expect(host.querySelector('.chat-context a')).toBeNull();
  expect(host.querySelector('.chat-file-gone')?.textContent).toContain('no longer available');
  expect(host.querySelector('a.chat-file')).toBeNull();

  await click(pills[1]);
  let popover = document.querySelector('.chat-source-popover')!;
  expect(popover.textContent).toContain('Quoted from Beta');
  expect(popover.textContent).toContain('Deleted');
  expect(popover.querySelectorAll('.chat-source-links a')).toHaveLength(0);

  await click(popover.querySelector('button[aria-label="Close source"]'));
  await click(pills[0]);
  popover = document.querySelector('.chat-source-popover')!;
  expect(popover.textContent).toContain('In Trash');
  expect([...popover.querySelectorAll('.chat-source-links a')].map(link => link.textContent)).toEqual(['Open note', 'Open PDF']);
});

it('opens a deleted source address as deleted, never as a cached or newer copy', async () => {
  states[beta] = life(beta, 'deleted', 3);
  await mount(`/sources/?source=${beta}`);
  expect(host.querySelector('.source-gone h1')?.textContent).toBe('Source deleted');
  expect(host.querySelector('.research-note')).toBeNull();
});

it('fails closed when source status cannot be read', async () => {
  override = url => url.includes('lifecycles=1') ? json({ error: 'nope' }, 400) : undefined;
  await mount(`/sources/?source=${alpha}`);
  expect(host.querySelector('.research-note')).toBeNull();
  expect(host.querySelector('[role=alert]')?.textContent).toContain('nope');
});
