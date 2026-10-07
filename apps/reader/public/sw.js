// Bump this version when changing the public offline page. Private pages, app
// bundles, source files, authentication and APIs are never written to CacheStorage.
const CACHE = 'shelf-public-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetch(OFFLINE_URL, { cache: 'reload', credentials: 'omit' });
    if (!response.ok || response.redirected || !response.headers.get('content-type')?.includes('text/html')) {
      throw new Error('The public Shelf offline page is unavailable.');
    }
    await (await caches.open(CACHE)).put(OFFLINE_URL, response);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('shelf-public-offline-') && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.mode !== 'navigate' || url.origin !== self.location.origin) return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/.auth' || url.pathname.startsWith('/.auth/')) return;
  event.respondWith(fetch(request).catch(async () => {
    const offline = await (await caches.open(CACHE)).match(OFFLINE_URL);
    return offline ?? Response.error();
  }));
});
