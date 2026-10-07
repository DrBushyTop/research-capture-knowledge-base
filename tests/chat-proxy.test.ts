import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// @ts-expect-error The independently packaged proxy is plain JavaScript.
import { handler } from '../apps/chat-proxy/proxy.js';

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
const principal = Buffer.from(JSON.stringify({ identityProvider: 'github', userId: 'test-user', userDetails: 'pinaatti', userRoles: ['reader', 'library_member'] })).toString('base64');
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
  const headers = new Headers({ 'x-ms-client-principal': principal, 'Content-Type': 'application/json' });
  if (origin !== undefined) headers.set('origin', origin);
  return { method, headers, query: new URLSearchParams(method === 'GET' ? 'library=1' : ''), text: async () => JSON.stringify({ question: 'Test', history: [] }) };
}
for (const name of ['chat', 'categories']) {
  for (const origin of [shelf, azure]) {
    it(`forwards ${name} writes from ${origin}`, async () => {
      expect((await handlers.get(name)!(request(origin))).status).toBe(202);
      expect(backend).toHaveBeenCalledOnce();
      expect(backend.mock.calls[0][1].headers['x-ms-client-principal']).toBe(principal);
    });
  }
  for (const origin of [undefined, 'null', 'https://evil.example', 'https://shelf.huuhka.net.evil.example', 'http://shelf.huuhka.net', 'https://shelf.huuhka.net:444']) {
    it(`rejects ${name} writes with origin ${origin}`, async () => {
      expect((await handlers.get(name)!(request(origin))).status).toBe(403);
      expect(backend).not.toHaveBeenCalled();
    });
  }
}
it('requires an invited reader even on the approved custom domain', async () => {
  const input = request(shelf); input.headers.delete('x-ms-client-principal');
  expect((await handlers.get('chat')!(input)).status).toBe(403);
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
