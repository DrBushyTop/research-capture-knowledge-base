// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { expect, it, vi } from 'vitest';
import { createAppRouter } from '../apps/reader/src/app/router';
import { accessStore, createQueryClient } from '../apps/reader/src/lib/api';
import { keys } from '../apps/reader/src/lib/queries';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('clears private data when background renewal rejects an already rendered session', async () => {
  vi.stubEnv('DEV', false);
  window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
  HTMLElement.prototype.scrollTo = () => {};
  window.scrollTo = () => {};
  let rejectSession!: (response: Response) => void;
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    if (String(input) === '/api/session') return new Promise<Response>(resolve => { rejectSession = resolve; });
    return Promise.resolve(json([]));
  }));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const client = createQueryClient();
  const router = createAppRouter(createMemoryHistory({ initialEntries: ['/sources/'] }));
  const settle = async () => {
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  };
  try {
    await router.load();
    await act(async () => root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>));
    await settle();
    expect(host.querySelector('.sources-shell')).toBeTruthy();
    expect(client.getQueryData(keys.library)).toEqual([]);
    await act(async () => {
      rejectSession(new Response('Session revoked', { status: 403, headers: { 'Content-Type': 'text/html' } }));
    });
    await settle();
    expect(accessStore.get()).toBe(true);
    expect(client.getQueryData(keys.library)).toBeUndefined();
    expect(host.querySelector('.sources-shell')).toBeNull();
    expect(host.textContent).toContain('Access unavailable');
  } finally {
    await act(async () => root.unmount());
    client.clear(); host.remove();
    vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  }
});
