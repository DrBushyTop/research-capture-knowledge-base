import { expect, it } from 'vitest';
import { browserCaptureNeeded, captureDocument, type BrowserCaptureSession } from '../apps/worker/src/browser-capture.js';

it('recovers navigation gates, but does not crawl ordinary article text', () => {
  expect(browserCaptureNeeded('', '<html><body>Choose your language</body></html>')).toBe(true);
  expect(browserCaptureNeeded('Select language\nEnglish\nItaliano', '<html></html>')).toBe(true);
  expect(browserCaptureNeeded('A recipe with flour, eggs and milk. Mix thoroughly and fry until golden. '.repeat(8), '<article></article>')).toBe(false);
});
it('retains visited evidence and reports partial coverage at the enforced view budget', async () => {
  let calls = 0;
  const session: BrowserCaptureSession = {
    async observe() { return { url: 'https://menu.example/', title: 'Menu', text: 'Observed dish ' + ++calls, controls: [{ id: '0', label: 'Pizzas', kind: 'button' }], screenshot: undefined, blockedRequests: 0 }; },
    async act() {}, async close() {}
  };
  const result = await captureDocument({ title: 'Menu', url: 'https://menu.example/' }, session, async () => ({ action: 'click', target: '0', reason: 'Read pizza section', coverage: 'More sections remain' }), new AbortController().signal, { views: 2, actions: 2, milliseconds: 1000, text: 4000 });
  expect(result.views).toHaveLength(2);
  expect(result.stopReason).toBe('view-limit');
  expect(result.complete).toBe(false);
  expect(result.text).toContain('Observed dish 1');
  expect(result.text).toContain('Observed dish 2');
});
it('rejects fabricated control references instead of executing agent supplied commands', async () => {
  let actions = 0;
  const session: BrowserCaptureSession = {
    async observe() { return { url: 'https://menu.example/', title: 'Menu', text: 'Menu', controls: [], screenshot: undefined, blockedRequests: 0 }; },
    async act() { actions++; }, async close() {}
  };
  const result = await captureDocument({ title: 'Menu', url: 'https://menu.example/' }, session, async () => ({ action: 'click', target: 'shell rm', reason: 'Ignored', coverage: 'Unknown' }), new AbortController().signal);
  expect(actions).toBe(0);
  expect(result.stopReason).toBe('invalid-action');
  expect(result.complete).toBe(false);
});
it('blocks consequential and external controls independently of the planner', async () => {
  const { safeControl } = await import('../apps/worker/src/browser-capture.js');
  for (const control of [
    { id: '1', label: 'Book a table', kind: 'button' as const },
    { id: '2', label: 'Read reviews', kind: 'link' as const, href: 'https://reviews.example/' },
    { id: '3', label: 'Menu', kind: 'link' as const, href: 'javascript:alert(1)' }
  ]) expect(safeControl(control, 'https://menu.example/')).toBe(false);
  expect(safeControl({ id: '4', label: 'Pizzas', kind: 'button' }, 'https://menu.example/')).toBe(true);
});
it('does not claim complete coverage when repeated actions yield no content', async () => {
  const view = { url: 'https://menu.example/', title: 'Menu', text: 'Menu index', controls: [], screenshot: undefined, blockedRequests: 0 };
  const session: BrowserCaptureSession = { async observe() { return view; }, async act() {}, async close() {} };
  const result = await captureDocument({ title: 'Menu', url: view.url }, session, async () => ({ action: 'scroll', target: '', reason: 'Find dishes', coverage: 'Only index captured' }), new AbortController().signal);
  expect(result.stopReason).toBe('no-progress');
  expect(result.complete).toBe(false);
  expect(result.views).toHaveLength(1);
});
it('keeps exploring after a failed interaction and excludes the failing control', async () => {
  let actions = 0;
  const session: BrowserCaptureSession = {
    async observe() { return { url: 'https://menu.example/', title: 'Menu', text: 'A dish description and its displayed price. '.repeat(4), controls: [{ id: '0', label: 'Broken details', kind: 'button' }], blockedRequests: 0 }; },
    async act() { actions++; throw new Error('Detached control'); }, async close() {}
  };
  let plans = 0;
  const result = await captureDocument({ title: 'Menu', url: 'https://menu.example/' }, session, async (_source, view) => {
    plans++;
    return plans === 1 ? { action: 'click', target: '0', reason: 'Details', coverage: 'More remains' } : { action: 'finish', target: '', reason: 'No remaining control', coverage: `Captured text; ${view.controls.length} usable controls remain` };
  }, new AbortController().signal);
  expect(actions).toBe(1);
  expect(plans).toBe(2);
  expect(result.coverage).toContain('0 usable controls');
});
it('does not treat a language-only page as complete content', async () => {
  const session: BrowserCaptureSession = { async observe() { return { url: 'https://menu.example/', title: 'Language', text: 'Choose your language. English. Italiano. '.repeat(4), controls: [], blockedRequests: 0 }; }, async act() {}, async close() {} };
  const result = await captureDocument({ title: 'Menu', url: 'https://menu.example/' }, session, async () => ({ action: 'finish', target: '', reason: 'No control', coverage: 'Language only' }), new AbortController().signal);
  expect(result.complete).toBe(false);
  expect(result.stopReason).toBe('content-unavailable');
});
it('rejects unsafe browser origins and wildcard asset exceptions before starting a sandbox', async () => {
  const { browserHosts } = await import('../apps/worker/src/browser-sandbox.js');
  for (const [url, hosts] of [
    ['http://127.0.0.1/', []], ['https://name:password@example.org/', []],
    ['https://example.org:8080/', []], ['https://example.org/', ['*.example.org']]
  ] as [string, string[]][]) await expect(browserHosts(url, hosts)).rejects.toThrow();
});
