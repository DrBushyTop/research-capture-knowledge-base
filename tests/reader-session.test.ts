import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hash } from '../shared/corpus.js';
import { MemoryStore } from './fixtures.js';
import { freshReader, readReaderSession, readerSessionResponse, sessionLifetimeMs, sessionReaderIdentity } from '../apps/worker/src/reader-session.js';

class SessionStore extends MemoryStore { async remove(key: string) { this.data.delete(key); } }
const day = 24 * 60 * 60_000;
const now = Date.parse('2026-10-07T12:00:00Z');
const principal = (userDetails = 'pinaatti', userId = 'user-one', userRoles = ['anonymous', 'authenticated']) => Buffer.from(JSON.stringify({ identityProvider: 'github', userDetails, userId, userRoles })).toString('base64');
beforeEach(() => { vi.stubEnv('READER_GITHUB_USERS', 'pinaatti,DrBushyTop'); vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
async function start(store = new SessionStore()) {
  const response = await readerSessionResponse(store, { encoded: principal(), token: null, renew: true, start: true });
  const token = response.headers['Set-Cookie'].split(';')[0].split('=')[1];
  return { store, response, token, key: `reader-sessions/${hash(token)}.json` };
}

it('keeps existing sessions working across the removal of invitation checks', async () => {
  const { store, token, key } = await start();
  const saved = store.data.get(key) as { clientPrincipal: { userRoles: string[] } };
  saved.clientPrincipal.userRoles = ['authenticated', 'reader', 'library_member'];
  expect(await sessionReaderIdentity(store, null, token)).toBe(hash('github:user-one'));
});

it('denies new and existing sessions when the membership setting is missing', async () => {
  const { store, token } = await start();
  vi.stubEnv('READER_GITHUB_USERS', '');
  await expect(readerSessionResponse(store, { encoded: principal(), token: null, renew: true, start: true })).rejects.toThrow('Reader access required');
  await expect(sessionReaderIdentity(store, null, token)).rejects.toThrow('Reader access required');
});

it('rejects malformed and non-GitHub identities even when they name an approved account', async () => {
  const approved = { identityProvider: 'github', userId: 'user-one', userDetails: 'pinaatti', userRoles: ['authenticated'] };
  const store = new SessionStore();
  for (const invalid of [{ identityProvider: 'aad' }, { userId: 123 }, { userId: '' }, { userId: ' ' }, { userRoles: ['anonymous'] }, { userRoles: 'authenticated' }]) {
    const encoded = Buffer.from(JSON.stringify({ ...approved, ...invalid })).toString('base64');
    await expect(readerSessionResponse(store, { encoded, token: null, renew: true, start: true })).rejects.toThrow('Reader access required');
  }
  expect(store.data.size).toBe(0);
});

it('creates a 30-day server session only after allowlisted GitHub sign-in', async () => {
  const { store, response, token, key } = await start();
  expect(response.jsonBody.clientPrincipal?.userDetails).toBe('pinaatti');
  expect(await sessionReaderIdentity(store, null, token)).toBe(hash('github:user-one'));
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  expect(response.jsonBody.expiresAt).toBe(new Date(now + 30 * day).toISOString());
  expect(response.headers['Set-Cookie']).toBe(`__Host-ShelfSession=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  expect([...store.data.keys()]).toEqual([key]);
  expect(JSON.stringify(store.data.get(key))).not.toContain(token);
});

it('does not mint a session from identity headers on the public renewal endpoint', async () => {
  const store = new SessionStore();
  const response = await readerSessionResponse(store, { encoded: principal(), token: null, renew: true });
  expect(response.jsonBody.clientPrincipal).toBeNull();
  expect(store.data.size).toBe(0);
});

for (const encoded of [null, principal('someone-else'), principal('pinaatti', 'user-one', ['reader']), principal('pinaatti', 'user-one', ['library_member'])]) {
  it(`requires an authenticated GitHub account and the current allowlist when starting a session with ${encoded === null ? 'no principal' : 'an invalid principal'}`, async () => {
    const store = new SessionStore();
    await expect(readerSessionResponse(store, { encoded, token: null, renew: true, start: true })).rejects.toThrow('Reader access required');
    expect(store.data.size).toBe(0);
  });
}

it('renews from the current visit after the Azure sign-in cookie has expired', async () => {
  const { store, token } = await start();
  for (const visitedAt of [now + 29 * day, now + 58 * day]) {
    vi.setSystemTime(visitedAt);
    const response = await readerSessionResponse(store, { encoded: null, token, renew: true });
    expect(response.jsonBody.clientPrincipal?.userDetails).toBe('pinaatti');
    expect(response.jsonBody.expiresAt).toBe(new Date(visitedAt + sessionLifetimeMs).toISOString());
    expect(await sessionReaderIdentity(store, null, token)).toBe(hash('github:user-one'));
  }
});

it('requires sign-in again after 30 days without a renewal', async () => {
  const { store, token } = await start();
  vi.setSystemTime(now + 30 * day);
  const response = await readerSessionResponse(store, { encoded: null, token, renew: true });
  expect(response.jsonBody.clientPrincipal).toBeNull();
  expect(response.headers['Set-Cookie']).toContain('Max-Age=0');
  await expect(sessionReaderIdentity(store, null, token)).rejects.toThrow('Reader access required');
});

it('does not prolong a session on read-only status or private API access', async () => {
  const { store, token, key } = await start();
  vi.setSystemTime(now + 29 * day);
  const response = await readerSessionResponse(store, { encoded: null, token, renew: false });
  await sessionReaderIdentity(store, null, token);
  expect(response.jsonBody.expiresAt).toBe(new Date(now + 30 * day).toISOString());
  expect(response.headers['Set-Cookie']).toBeUndefined();
  expect((store.data.get(key) as { expiresAt: string }).expiresAt).toBe(response.jsonBody.expiresAt);
});

it('reuses a recently renewed session across tabs without another SQL lease or write', async () => {
  const { store, token, response } = await start();
  const lease = vi.spyOn(store, 'withLease'), write = vi.spyOn(store, 'write');
  vi.setSystemTime(now + 9 * 60_000);
  const resumed = await readerSessionResponse(store, { encoded: null, token, renew: true });
  expect(resumed.jsonBody).toEqual(response.jsonBody);
  expect(resumed.headers['Set-Cookie']).toBeUndefined();
  expect(lease).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  vi.setSystemTime(now + 10 * 60_000);
  const renewed = await readerSessionResponse(store, { encoded: null, token, renew: true });
  expect(renewed.jsonBody.expiresAt).toBe(new Date(now + 10 * 60_000 + sessionLifetimeMs).toISOString());
  expect(lease).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledTimes(1);
});

it('revokes logout on the server so a copied cookie cannot be replayed', async () => {
  const { store, token } = await start();
  const response = await readerSessionResponse(store, { encoded: null, token, renew: false, logout: true });
  expect(response.headers['Set-Cookie']).toContain('Max-Age=0');
  expect(await readReaderSession(store, token)).toBeUndefined();
  await expect(sessionReaderIdentity(store, principal(), token)).rejects.toThrow('Reader access required');
});

it('does not resurrect a session when logout wins the renewal lease', async () => {
  const { store, token, key } = await start();
  vi.setSystemTime(now + 10 * 60_000);
  store.withLease = async (_key, action) => { await store.remove(key); return action(); };
  const response = await readerSessionResponse(store, { encoded: null, token, renew: true });
  expect(response.jsonBody.clientPrincipal).toBeNull();
  expect(await readReaderSession(store, token)).toBeUndefined();
});

it('blocks existing sessions immediately when their GitHub login leaves the allowlist', async () => {
  const { store, token } = await start();
  vi.stubEnv('READER_GITHUB_USERS', 'DrBushyTop');
  expect(await readReaderSession(store, token)).toBeUndefined();
  expect((await readerSessionResponse(store, { encoded: null, token, renew: true })).jsonBody.clientPrincipal).toBeNull();
});

it('rotates the token and revokes the previous account when switching GitHub accounts', async () => {
  const { store, token } = await start();
  const response = await readerSessionResponse(store, { encoded: principal('DrBushyTop', 'user-two'), token, renew: true, start: true });
  expect(response.jsonBody.clientPrincipal?.userDetails).toBe('DrBushyTop');
  expect(response.headers['Set-Cookie']).not.toContain(token);
  expect(await readReaderSession(store, token)).toBeUndefined();
});

it('rejects forged and malformed cookies without revealing session data', async () => {
  const { store } = await start();
  for (const token of ['x', '../private', 'f'.repeat(64)]) {
    expect(await readReaderSession(store, token)).toBeUndefined();
    expect((await readerSessionResponse(store, { encoded: null, token, renew: true })).jsonBody.clientPrincipal).toBeNull();
  }
  expect(() => freshReader('invalid')).toThrow('Reader access required');
});
