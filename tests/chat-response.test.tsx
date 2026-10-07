// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatResponse } from '../apps/reader/src/components/ChatResponse';
import { createAppRouter } from '../apps/reader/src/app/router';
import { createQueryClient } from '../apps/reader/src/lib/api';
import { keys } from '../apps/reader/src/lib/queries';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear(); sessionStorage.clear();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function waitUntil(ready: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!ready() && Date.now() < deadline) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(ready()).toBe(true);
}
async function render(text: string, reveal = true, partial = true) {
  await act(async () => root.render(<ChatResponse reveal={reveal} className={partial ? 'chat-draft' : undefined}>{text}</ChatResponse>));
  await act(async () => { await import('streamdown'); });
  await settle();
}
function finishReveal(block: Element) {
  const event = new Event('animationend', { bubbles: true });
  Object.defineProperty(event, 'animationName', { value: 'chat-text-reveal' });
  block.dispatchEvent(event);
}

it('fades the first paragraph even when Markdown loads after the response mounts', async () => {
  await render('The first paragraph.');
  expect(host.querySelector('p')?.classList.contains('chat-text-reveal')).toBe(true);
});

it('reveals new blocks once and keeps earlier paragraphs visible through validation', async () => {
  await render('The first paragraph.');
  const first = host.querySelector('p')!;
  finishReveal(first);
  await render('The first paragraph.\n\nThe second paragraph.');
  expect(host.querySelector('p')).toBe(first);
  expect(first.classList.contains('chat-text-reveal')).toBe(false);
  const second = host.querySelectorAll('p')[1];
  expect(second.classList.contains('chat-text-reveal')).toBe(true);
  finishReveal(second);

  await render('The first paragraph.\n\nThe second paragraph.', true, false);
  expect(host.querySelector('p')).toBe(first);
  expect(host.querySelectorAll('p')[1]).toBe(second);
  expect(host.querySelectorAll('.chat-text-reveal')).toHaveLength(0);
  await render('The first paragraph.\n\nThe second paragraph.\n\nFinal paragraph.', true, false);
  expect(host.querySelectorAll('.chat-text-reveal')).toHaveLength(1);
  expect(host.querySelectorAll('p')[2].classList.contains('chat-text-reveal')).toBe(true);
});

it('reveals headings, lists, tables and code as whole Markdown blocks', async () => {
  await render('## Heading\n\n- First\n- Second\n\n| Source | Count |\n| --- | --- |\n| One | 2 |\n\n```js\nconst count = 2;\n```');
  const blocks = [...host.querySelector('.chat-markdown')!.children];
  expect(blocks).toHaveLength(4);
  expect(blocks.every(block => block.classList.contains('chat-text-reveal'))).toBe(true);
  expect(host.querySelector('table')?.textContent).toContain('Source');
  expect(host.querySelector('code')?.textContent).toContain('const count = 2;');
  expect(host.querySelectorAll('li.chat-text-reveal, td.chat-text-reveal')).toHaveLength(0);
});

it('does not animate saved answers', async () => {
  await render('A saved answer.\n\nAnother saved paragraph.', false, false);
  expect(host.querySelectorAll('p')).toHaveLength(2);
  expect(host.querySelectorAll('.chat-text-reveal')).toHaveLength(0);
});

it('shows new text immediately when reduced motion is requested', async () => {
  window.matchMedia = vi.fn(() => ({ matches: true })) as never;
  await render('First paragraph.');
  await render('First paragraph.\n\nSecond paragraph.');
  expect(host.querySelectorAll('p')).toHaveLength(2);
  expect(host.querySelectorAll('.chat-text-reveal')).toHaveLength(0);
});

it('keeps the live renderer and visible paragraphs when a job finishes and history refreshes', async () => {
  const conversationId = 'a'.repeat(32);
  const jobId = 'live-job';
  const question = 'A question';
  const evidenceId = `e_${'a'.repeat(16)}`;
  const answer = `The first paragraph.\n\nFinal paragraph. [${evidenceId}]`;
  const result = { answer, citations: [{ evidenceId, sourceId: 'source-1', title: 'Source title', kind: 'source', locator: 'Page 1' }], attachments: [] };
  let complete = false;
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes(`id=${jobId}`)) return json(complete ? { status: 'complete', result } : { status: 'running', draft: 'The first paragraph.' });
    if (url.includes('conversation=')) return json({ id: conversationId, owner: 'test', turns: complete ? [{ jobId, question, result }] : [] });
    return json([]);
  }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollTo = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
  window.scrollTo = () => {};
  sessionStorage.setItem('research-chat-active', JSON.stringify({ id: jobId, conversationId, question }));
  const client = createQueryClient();
  const router = createAppRouter(createMemoryHistory({ initialEntries: [`/chat/${conversationId}/`] }));
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>));
    await waitUntil(() => !!host.querySelector('.chat-markdown p'));
    const markdown = host.querySelector('.chat-markdown')!;
    const first = markdown.querySelector('p')!;
    expect(first.textContent).toBe('The first paragraph.');
    finishReveal(first);
    complete = true;
    await act(async () => { await client.invalidateQueries({ queryKey: keys.job(jobId) }); });
    await waitUntil(() => !!host.querySelector('button[aria-label="Copy answer"]') && sessionStorage.getItem('research-chat-active') === null);
    await settle();
    expect(host.querySelector('.chat-markdown')).toBe(markdown);
    expect(markdown.querySelector('p')).toBe(first);
    expect(first.classList.contains('chat-text-reveal')).toBe(false);
    expect(markdown.querySelectorAll('p')[1].classList.contains('chat-text-reveal')).toBe(true);
    expect(host.querySelector('button[aria-label="Copy answer"]')).toBeTruthy();
    expect(markdown.querySelector('.chat-citation-button')?.textContent).toContain('Source title');
    expect(sessionStorage.getItem('research-chat-active')).toBeNull();
  } finally { client.clear(); }
});
