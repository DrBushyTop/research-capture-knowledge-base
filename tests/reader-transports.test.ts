import { createServer, request as httpRequest, type Server } from 'node:http';
import { HttpRequest, InvocationContext, type HttpHandler, type HttpResponseInit } from '@azure/functions';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hash } from '../shared/corpus.js';
import type { ReaderStore } from '../apps/worker/src/reader-actions.js';
import { localReaderHandler } from '../apps/worker/src/reader-local.js';
import { readerStore } from './reader-actions-fixture.js';
import { screenshot } from './source-artifacts-fixture.js';

const registered = vi.hoisted(() => ({ handlers: new Map<string, HttpHandler>(), store: undefined as ReaderStore | undefined }));
vi.mock('@azure/functions', async importOriginal => ({
  ...await importOriginal<typeof import('@azure/functions')>(),
  app: { http: (name: string, options: { handler: HttpHandler }) => registered.handlers.set(name, options.handler), timer: vi.fn(), storageQueue: vi.fn() }
}));
vi.mock('../apps/worker/src/sql-store.js', () => ({ createStore: () => registered.store }));
import '../apps/worker/src/index.js';

const principal = Buffer.from(JSON.stringify({ identityProvider: 'github', userId: 'reader-one', userDetails: 'DrBushyTop', userRoles: ['authenticated', 'reader'] })).toString('base64');
let fixture: Awaited<ReturnType<typeof readerStore>>;
let server: Server;
let address: string;

beforeEach(async () => {
  vi.stubEnv('READER_GITHUB_USERS', 'DrBushyTop');
  fixture = await readerStore();
  registered.store = fixture.store;
  server = createServer(localReaderHandler(fixture.store));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function production(query: string, body?: Uint8Array, headers: Record<string, string> = { 'x-ms-client-principal': principal }): Promise<HttpResponseInit> {
  const context = new InvocationContext({ functionName: 'chatGateway' });
  context.error = vi.fn();
  return await registered.handlers.get('chatGateway')!(new HttpRequest({ method: body === undefined ? 'GET' : 'POST', url: `http://localhost/api/chat?${query}`, headers, body: body === undefined ? undefined : { bytes: body } }), context) as HttpResponseInit;
}
async function call(transport: 'local' | 'production', query: string, body?: Uint8Array, headers: Record<string, string> = {}) {
  if (transport === 'production') {
    const response = await production(query, body, { 'x-ms-client-principal': principal, ...headers });
    return { status: response.status, headers: new Headers(response.headers), json: response.jsonBody, bytes: response.body ? Buffer.from(response.body as Uint8Array) : undefined };
  }
  const path = query === 'admin=1' ? '/api/categories' : `/api/chat?${query}`;
  const response = await fetch(address + path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : Buffer.from(body) });
  const bytes = Buffer.from(await response.arrayBuffer());
  const json = response.headers.get('content-type')?.includes('application/json') ? JSON.parse(bytes.toString()) : undefined;
  return { status: response.status, headers: response.headers, json, bytes: json === undefined ? bytes : undefined };
}
const jsonBytes = (body: unknown) => Buffer.from(JSON.stringify(body));

it.each(['local', 'production'] as const)('%s enforces notes targets, category actions and accepted chat status', async transport => {
  const mismatch = await call(transport, 'notes=zotero-users-12345-OTHER123', jsonBytes({ sourceId: fixture.note.source.id, markdown: 'Wrong source', revision: 0 }));
  expect(mismatch.status).toBe(400);
  expect(await fixture.store.read(`reader-notes/${fixture.note.source.id}.json`)).toBeUndefined();
  const saved = await call(transport, `notes=${fixture.note.source.id}`, jsonBytes({ sourceId: fixture.note.source.id, markdown: 'Observation', revision: 0 }));
  const owner = transport === 'local' ? 'local-developer' : hash('github:reader-one');
  expect(saved.status).toBe(200);
  expect(saved.json).toMatchObject({ markdown: 'Observation', updatedBy: owner, revision: 1 });
  const unknown = await call(transport, 'admin=1', jsonBytes({ action: 'unknown' }));
  expect(unknown.status).toBe(400);
  expect(unknown.json).toEqual({ error: 'Unknown category action' });
  expect(fixture.store.send).not.toHaveBeenCalled();
  const submitted = await call(transport, '', jsonBytes({ question: 'Read this source' }));
  expect(submitted.status).toBe(202);
  expect(fixture.store.sendChat).toHaveBeenCalledExactlyOnceWith(submitted.json.id);
  expect(await fixture.store.read(`chat/jobs/${submitted.json.id}.json`)).toMatchObject({ owner, status: 'pending' });
});

it.each(['local', 'production'] as const)('%s serves verified documents and uploaded images with private headers', async transport => {
  const original = await call(transport, `document=${fixture.note.source.id}`);
  expect(original.status).toBe(200);
  expect(original.bytes).toEqual(fixture.bytes);
  expect(original.headers.get('content-type')).toBe('application/pdf');
  expect(original.headers.get('cache-control')).toBe('private, no-store');
  expect(original.headers.get('x-content-type-options')).toBe('nosniff');
  expect(original.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
  const uploaded = await call(transport, 'upload=1', screenshot, { 'content-type': 'image/png' });
  expect(uploaded.status).toBe(201);
  expect((await call(transport, `upload=${uploaded.json.id}`)).bytes).toEqual(screenshot);
});

it('keeps production authentication and session handling ahead of Reader dispatch', async () => {
  const read = vi.spyOn(fixture.store, 'readArtifact');
  expect((await production(`document=${fixture.note.source.id}`, undefined, {})).status).toBe(403);
  expect(read).not.toHaveBeenCalled();
  const started = await production('session=start', Buffer.from('not an action body'));
  expect(started.status).toBe(200);
  const token = new Headers(started.headers).get('set-cookie')!.split(';')[0].split('=')[1];
  const document = await production(`document=${fixture.note.source.id}`, undefined, { 'x-reader-session': token });
  expect(document.status).toBe(200);
  expect(document.body).toEqual(fixture.bytes);
  vi.stubEnv('READER_GITHUB_USERS', '');
  expect((await production(`document=${fixture.note.source.id}`, undefined, { 'x-reader-session': token })).status).toBe(403);
});

it('returns 413 over a live local socket for a chunked body without Content-Length', async () => {
  const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest(`${address}/api/chat?lifecycle=${fixture.note.source.id}`, { method: 'POST' }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject);
    request.write(Buffer.alloc(1000, ' '));
    request.end('x');
  });
  expect(result).toEqual({ status: 413, body: JSON.stringify({ error: 'Action is too large' }) });
  expect(fixture.store.send).not.toHaveBeenCalled();
});

it('records unexpected local errors without exposing them in the HTTP response', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(fixture.store, 'sources').mockRejectedValueOnce(new Error('Unable to connect to development SQL'));
  const response = await call('local', 'library=1');
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.json).toEqual({ error: 'The service is temporarily unavailable. Try again.' });
  expect(log).toHaveBeenCalledOnce();
  expect(log.mock.calls.flat().join(' ')).toContain('Unable to connect to development SQL');
});
