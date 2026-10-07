import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import { expect, it, vi } from 'vitest';

const workerScript = await readFile('apps/reader/public/sw.js', 'utf8');
const installScript = await readFile('apps/reader/public/pwa.js', 'utf8');
const loginHtml = await readFile('apps/reader/public/login.html', 'utf8');
const offlineResponse = () => new Response('<h1>You are offline</h1>', { headers: { 'Content-Type': 'text/html' } });

it('opens the reader directly when launching an installed app', async () => {
  const manifest = JSON.parse(await readFile('apps/reader/public/manifest.webmanifest', 'utf8'));
  expect(manifest.start_url).toBe('/');
});

function worker() {
  const listeners = new Map<string, (event: object) => void>();
  const storage = new Map<string, Map<string, Response>>();
  const put = vi.fn(async (name: string, path: string, response: Response) => { storage.get(name)!.set(path, response.clone()); });
  const fetch = vi.fn(async (_input: unknown, _options?: RequestInit): Promise<Response> => offlineResponse());
  const skipWaiting = vi.fn(async () => undefined);
  const claim = vi.fn(async () => undefined);
  runInNewContext(workerScript, {
    URL, Response, fetch,
    self: { location: { origin: 'https://shelf.huuhka.net' }, skipWaiting, clients: { claim }, addEventListener: (name: string, handler: (event: object) => void) => listeners.set(name, handler) },
    caches: {
      keys: async () => [...storage.keys()],
      delete: async (name: string) => storage.delete(name),
      open: async (name: string) => {
        if (!storage.has(name)) storage.set(name, new Map());
        return {
          put: (path: string, response: Response) => put(name, path, response),
          match: async (path: string) => storage.get(name)?.get(path)?.clone()
        };
      }
    }
  });
  async function lifecycle(name: 'install' | 'activate') {
    let pending: Promise<unknown> | undefined;
    listeners.get(name)!({ waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
  }
  function request(path: string, mode = 'navigate', method = 'GET') {
    let response: Promise<Response> | undefined;
    listeners.get('fetch')!({
      request: { url: new URL(path, 'https://shelf.huuhka.net').href, mode, method },
      respondWith: (promise: Promise<Response>) => { response = promise; }
    });
    return response;
  }
  return { storage, put, fetch, skipWaiting, claim, lifecycle, request };
}

it('caches only the public offline page without credentials during installation', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  expect(sw.fetch).toHaveBeenCalledExactlyOnceWith('/offline.html', { cache: 'reload', credentials: 'omit' });
  expect(sw.put).toHaveBeenCalledTimes(1);
  expect([...sw.storage.values()].flatMap(cache => [...cache.keys()])).toEqual(['/offline.html']);
  expect(sw.skipWaiting).toHaveBeenCalledTimes(1);
});

for (const response of [new Response('Sign in', { status: 401 }), new Response('{}', { headers: { 'Content-Type': 'application/json' } })]) {
  it(`refuses to cache an invalid offline page with status ${response.status} and type ${response.headers.get('content-type')}`, async () => {
    const sw = worker();
    sw.fetch.mockResolvedValueOnce(response);
    await expect(sw.lifecycle('install')).rejects.toThrow('offline page is unavailable');
    expect(sw.put).not.toHaveBeenCalled();
    expect(sw.skipWaiting).not.toHaveBeenCalled();
  });
}

it('loads private navigation through the network and never adds it to the offline cache', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  const privatePage = new Response('Private source contents');
  sw.fetch.mockResolvedValueOnce(privatePage);
  expect(await sw.request('/sources/?source=private')).toBe(privatePage);
  expect(sw.put).toHaveBeenCalledTimes(1);
  expect([...sw.storage.values()].flatMap(cache => [...cache.keys()])).toEqual(['/offline.html']);
});

for (const status of [401, 403, 404, 500]) {
  it(`preserves HTTP ${status} instead of substituting the offline page`, async () => {
    const sw = worker();
    await sw.lifecycle('install');
    const denied = new Response('Access unavailable', { status });
    sw.fetch.mockResolvedValueOnce(denied);
    expect(await sw.request('/sources/')).toBe(denied);
    expect(sw.put).toHaveBeenCalledTimes(1);
  });
}

it('shows the generic offline page only when navigation loses its network connection', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  sw.fetch.mockRejectedValueOnce(new TypeError('offline'));
  expect(await (await sw.request('/chat/private/'))!.text()).toContain('You are offline');
  expect(sw.put).toHaveBeenCalledTimes(1);
});

it('leaves authentication, APIs, bundles, private files, writes and other origins alone', () => {
  const sw = worker();
  for (const path of ['/api', '/api/chat', '/.auth', '/.auth/me', '/.auth/login/github']) expect(sw.request(path)).toBeUndefined();
  for (const path of ['/assets/app.js', '/api/source/private.pdf', '/sources/']) expect(sw.request(path, 'cors')).toBeUndefined();
  expect(sw.request('/api/chat', 'navigate', 'POST')).toBeUndefined();
  expect(sw.request('https://github.com/login')).toBeUndefined();
  expect(sw.fetch).not.toHaveBeenCalled();
  expect(sw.put).not.toHaveBeenCalled();
});

it('removes its obsolete offline caches while leaving other app caches alone', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  sw.storage.set('shelf-public-offline-old', new Map());
  sw.storage.set('another-app', new Map());
  await sw.lifecycle('activate');
  expect([...sw.storage.keys()]).toEqual(['shelf-public-offline-v1', 'another-app']);
  expect(sw.claim).toHaveBeenCalledTimes(1);
});

const recommendationHtml = '<aside class="install-recommendation" hidden><p class="install-message"></p><button class="install-app">Add to home screen</button><button class="dismiss-install">Not now</button></aside>';
function installPage({ secure = true, standalone = false, phone = true, dismissed = false, apple = false, login = false, storageBlocked = false, lateMount = false } = {}) {
  const dom = new JSDOM(login ? loginHtml : '<body>' + (lateMount ? '' : recommendationHtml) + '</body>', { url: 'https://shelf.huuhka.net/login.html', runScripts: 'outside-only' });
  const register = vi.fn(async () => undefined);
  Object.defineProperty(dom.window, 'isSecureContext', { value: secure });
  Object.defineProperty(dom.window.navigator, 'serviceWorker', { value: { register } });
  if (apple) Object.defineProperty(dom.window.navigator, 'userAgent', { value: 'iPhone' });
  if (dismissed) dom.window.localStorage.setItem('shelf-install-dismissed', '1');
  if (storageBlocked) Object.defineProperty(dom.window, 'localStorage', { get() { throw new Error('blocked'); } });
  dom.window.matchMedia = vi.fn((query: string) => ({ matches: query.includes('standalone') ? standalone : phone, addEventListener: vi.fn() })) as unknown as typeof dom.window.matchMedia;
  dom.window.eval(installScript);
  const offer = () => {
    const event = new dom.window.Event('beforeinstallprompt', { cancelable: true });
    const prompt = vi.fn(async () => ({ outcome: 'dismissed' }));
    Object.assign(event, { prompt });
    dom.window.dispatchEvent(event);
    return { event, prompt };
  };
  return { dom, document: dom.window.document, register, offer, visible: () => dom.window.document.querySelector<HTMLElement>('.install-recommendation')?.hidden === false };
}
it('offers installation inside the phone reader once and remembers browser dismissal', async () => {
  const page = installPage();
  expect(page.visible()).toBe(false);
  const { event, prompt } = page.offer();
  expect(event.defaultPrevented).toBe(true);
  expect(page.visible()).toBe(true);
  const button = page.document.querySelector<HTMLButtonElement>('.install-app')!;
  button.click(); button.click();
  await Promise.resolve();
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(page.visible()).toBe(false);
  expect(page.dom.window.localStorage.getItem('shelf-install-dismissed')).toBe('1');
  page.offer();
  expect(page.visible()).toBe(false);
  expect(page.register).toHaveBeenCalledExactlyOnceWith('/sw.js', { scope: '/', updateViaCache: 'none' });
  page.dom.window.close();
});
it('remembers Not now without opening the browser prompt', () => {
  const page = installPage();
  const { prompt } = page.offer();
  page.document.querySelector<HTMLButtonElement>('.dismiss-install')!.click();
  expect(page.visible()).toBe(false);
  expect(prompt).not.toHaveBeenCalled();
  expect(page.dom.window.localStorage.getItem('shelf-install-dismissed')).toBe('1');
  page.dom.window.close();
});
it('remembers a horizontal touch swipe as dismissal', () => {
  const page = installPage(); page.offer();
  const recommendation = page.document.querySelector('.install-recommendation')!;
  for (const [type, x] of [['pointerdown', 20], ['pointerup', 160]] as const) {
    const event = new page.dom.window.Event(type, { bubbles: true });
    Object.assign(event, { pointerType: 'touch', pointerId: 1, clientX: x, clientY: 20 });
    recommendation.dispatchEvent(event);
  }
  expect(page.visible()).toBe(false);
  expect(page.dom.window.localStorage.getItem('shelf-install-dismissed')).toBe('1');
  page.dom.window.close();
});
for (const options of [{ phone: false }, { standalone: true }, { dismissed: true }, { login: true }, { storageBlocked: true }]) {
  it(`does not show a recommendation for ${JSON.stringify(options)}`, () => {
    const page = installPage(options); page.offer();
    expect(page.visible()).toBe(false);
    page.dom.window.close();
  });
}
it('gives iPhone installation instructions without a browser prompt', () => {
  const page = installPage({ apple: true });
  expect(page.visible()).toBe(true);
  expect(page.document.querySelector('.install-message')?.textContent).toContain('Share, then Add to Home Screen');
  expect(page.document.querySelector<HTMLElement>('.install-app')?.hidden).toBe(true);
  page.dom.window.close();
});
it('handles a recommendation mounted after the browser offers installation', async () => {
  const page = installPage({ lateMount: true }); page.offer();
  page.document.body.insertAdjacentHTML('beforeend', recommendationHtml);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(page.visible()).toBe(true);
  page.dom.window.close();
});
it('removes the recommendation when installation completes through the browser menu', () => {
  const page = installPage(); page.offer();
  page.dom.window.dispatchEvent(new page.dom.window.Event('appinstalled'));
  expect(page.visible()).toBe(false);
  page.dom.window.close();
});
it('does not register a service worker on an insecure local preview origin', () => {
  const page = installPage({ secure: false });
  expect(page.register).not.toHaveBeenCalled();
  page.dom.window.close();
});
