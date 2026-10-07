import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { readerSessionResponse, sessionReaderIdentity } from '../apps/worker/src/reader-session.js';
import { ChatAccessError } from '../apps/worker/src/chat-service.js';
import { MemoryStore } from './fixtures.js';
import { hash } from '../shared/corpus.js';
// @ts-expect-error The independently packaged proxy is plain JavaScript.
import { handler, sessionHandler } from '../apps/chat-proxy/proxy.js';

interface ProxyRequest {
  method: string;
  headers: Headers;
  query: URLSearchParams;
  text(): Promise<string>;
}
type Handler = (request: ProxyRequest) => Promise<{ status: number; jsonBody?: unknown }>;
const handlers = new Map<string, Handler>([['chat', handler(false)], ['categories', handler(true)]]);

const shelf = 'https://shelf.huuhka.net';
const azure = 'https://orange-ground-01b0c6a03.3.azurestaticapps.net';
const principal = Buffer.from(JSON.stringify({ identityProvider: 'github', userId: 'test-user', userDetails: 'pinaatti', userRoles: ['anonymous', 'authenticated'] })).toString('base64');
const session = 'a'.repeat(64);
let backend: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv('READER_ORIGINS', `${shelf}, ${azure}`);
  vi.stubEnv('READER_ORIGIN', azure);
  vi.stubEnv('READER_GITHUB_USERS', 'pinaatti,DrBushyTop');
  vi.stubEnv('CHAT_BACKEND_URL', 'https://backend.invalid/api/chat');
  vi.stubEnv('CHAT_BACKEND_KEY', 'synthetic-key');
  backend = vi.fn().mockResolvedValue(new Response('{}', { status: 202, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', backend);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function request(origin?: string, method = 'POST'): ProxyRequest {
  const headers = new Headers({ 'x-ms-client-principal': principal, 'Content-Type': 'application/json', cookie: '__Host-ShelfSession=' + session });
  if (origin !== undefined) headers.set('origin', origin);
  return { method, headers, query: new URLSearchParams(method === 'GET' ? 'library=1' : ''), text: async () => JSON.stringify({ question: 'Test', history: [] }) };
}
for (const name of ['chat', 'categories']) {
  for (const origin of [shelf, azure]) {
    it(`forwards ${name} writes from ${origin}`, async () => {
      expect((await handlers.get(name)!(request(origin))).status).toBe(202);
      expect(backend).toHaveBeenCalledOnce();
      expect(backend.mock.calls[0][1].headers['x-reader-session']).toBe(session);
      expect(backend.mock.calls[0][1].headers['x-ms-client-principal']).toBeUndefined();
    });
  }
  for (const origin of [undefined, 'null', 'https://evil.example', 'https://shelf.huuhka.net.evil.example', 'http://shelf.huuhka.net', 'https://shelf.huuhka.net:444']) {
    it(`rejects ${name} writes with origin ${origin}`, async () => {
      expect((await handlers.get(name)!(request(origin))).status).toBe(403);
      expect(backend).not.toHaveBeenCalled();
    });
  }
}
it('requires a server session even on the approved custom domain', async () => {
  const input = request(shelf); input.headers.delete('cookie');
  expect((await handlers.get('chat')!(input)).status).toBe(403);
  expect(backend).not.toHaveBeenCalled();
});
it('allows the worker to validate an app session after the Azure cookie has expired', async () => {
  const input = request(undefined, 'GET'); input.headers.delete('x-ms-client-principal');
  expect((await handler(false)(input)).status).toBe(202);
  expect(backend.mock.calls[0][1].headers['x-reader-session']).toBe(session);
});
it('passes a fresh principal only through the separate session start endpoint', async () => {
  const input = request(shelf);
  await sessionHandler(false, true)(input);
  expect(backend.mock.calls[0][0].searchParams.get('session')).toBe('start');
  expect(backend.mock.calls[0][1].headers['x-ms-client-principal']).toBe(principal);
});
it('exchanges a standard GitHub sign-in for a private Shelf session without invitations', async () => {
  const config = JSON.parse(await readFile('apps/reader/staticwebapp.config.json', 'utf8'));
  const startRoute = config.routes.find((route: { route: string }) => route.route === '/api/session-start');
  expect(startRoute.allowedRoles).toEqual(['authenticated']);
  class SessionStore extends MemoryStore { async remove(key: string) { this.data.delete(key); } }
  const store = new SessionStore();
  backend.mockImplementation(async (url: URL, options: RequestInit) => {
    const headers = new Headers(options.headers);
    try {
      if (url.searchParams.has('session')) {
        const result = await readerSessionResponse(store, {
          encoded: headers.get('x-ms-client-principal'), token: headers.get('x-reader-session'), renew: true,
          start: url.searchParams.get('session') === 'start'
        });
        return new Response(JSON.stringify(result.jsonBody), { status: result.status, headers: { ...result.headers, 'Content-Type': 'application/json' } });
      }
      const owner = await sessionReaderIdentity(store, headers.get('x-ms-client-principal'), headers.get('x-reader-session'));
      return new Response(JSON.stringify({ owner }), { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
      if (!(error instanceof ChatAccessError)) throw error;
      return new Response(JSON.stringify({ error: error.message }), { status: error.status, headers: { 'Content-Type': 'application/json' } });
    }
  });
  const input = request(shelf); input.headers.delete('cookie');
  const started = await sessionHandler(false, true)(input);
  expect(started.status).toBe(200);
  expect(JSON.parse(started.body).clientPrincipal).toMatchObject({ userDetails: 'pinaatti', userRoles: ['authenticated', 'reader'] });
  input.headers.set('cookie', started.headers['Set-Cookie'].split(';')[0]);
  input.headers.delete('x-ms-client-principal');
  const privateResponse = await handler(false)(input);
  expect(privateResponse.status).toBe(200);
  expect(JSON.parse(privateResponse.body).owner).toBe(hash('github:test-user'));
  vi.stubEnv('READER_GITHUB_USERS', 'DrBushyTop');
  expect((await handler(false)(input)).status).toBe(403);
});
it('does not pass a client-supplied principal into session renewal', async () => {
  await sessionHandler(false)(request(shelf));
  expect(backend.mock.calls[0][0].searchParams.get('session')).toBe('resume');
  expect(backend.mock.calls[0][1].headers['x-ms-client-principal']).toBeUndefined();
});
it('passes the Secure HttpOnly session cookie from the worker to the browser', async () => {
  const cookie = '__Host-ShelfSession=' + session + '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000';
  backend.mockResolvedValueOnce(new Response('{}', { headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie } }));
  const result = await sessionHandler(false)(request(shelf));
  expect(result.headers['Set-Cookie']).toBe(cookie);
});
it('revokes the app session before redirecting through Azure logout', async () => {
  const input = request(shelf); input.query.set('returnTo', 'https://evil.example');
  const result = await sessionHandler(true)(input);
  expect(backend.mock.calls[0][0].searchParams.get('logout')).toBe('1');
  expect(result.status).toBe(303);
  expect(result.headers.Location).toBe('/.auth/logout?post_logout_redirect_uri=%2Flogin.html');
});
it('rejects cross-origin session renewal, session creation and logout', async () => {
  for (const action of [sessionHandler(false), sessionHandler(false, true), sessionHandler(true)]) {
    expect((await action(request('https://evil.example'))).status).toBe(403);
  }
  expect(backend).not.toHaveBeenCalled();
});
it('rejects ambiguous session cookies before contacting the worker', async () => {
  const input = request(shelf); input.headers.set('cookie', '__Host-ShelfSession=' + session + '; __Host-ShelfSession=' + 'b'.repeat(64));
  expect((await handler(false)(input)).status).toBe(403);
  expect(backend).not.toHaveBeenCalled();
});
it('keeps authenticated GET requests working without an Origin header', async () => {
  expect((await handlers.get('chat')!(request(undefined, 'GET'))).status).toBe(202);
  expect(backend).toHaveBeenCalledOnce();
});
it('supports existing development configuration with one READER_ORIGIN', async () => {
  vi.stubEnv('READER_ORIGINS', '');
  vi.stubEnv('READER_ORIGIN', 'https://dev.invalid');
  expect((await handlers.get('chat')!(request('https://dev.invalid'))).status).toBe(202);
  expect((await handlers.get('chat')!(request(shelf))).status).toBe(403);
});
it('refuses writes when no reader origin is configured', async () => {
  vi.stubEnv('READER_ORIGINS', ''); vi.stubEnv('READER_ORIGIN', '');
  expect((await handlers.get('chat')!(request(shelf))).status).toBe(403);
  expect(backend).not.toHaveBeenCalled();
});
