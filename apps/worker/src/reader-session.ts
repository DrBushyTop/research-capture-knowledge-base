import { randomBytes } from 'node:crypto';
import { hash } from '../../../shared/corpus.js';
import { ChatAccessError, readerIdentity } from './chat-service.js';
import type { PipelineStore } from './pipeline.js';

export const sessionLifetimeMs = 30 * 24 * 60 * 60_000;
export const sessionCookieName = '__Host-ShelfSession';
type SessionStore = Pick<PipelineStore, 'read' | 'create' | 'write' | 'withLease'> & { remove(key: string): Promise<void> };
export interface ReaderPrincipal { identityProvider: 'github'; userId: string; userDetails: string; userRoles: string[] }
interface Session { clientPrincipal: ReaderPrincipal; createdAt: string; expiresAt: string }
const sessionKey = (token: string) => /^[a-f0-9]{64}$/.test(token) ? `reader-sessions/${hash(token)}.json` : undefined;
const cookie = (token: string, maxAge: number) => `${sessionCookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

/** Called only behind the function key, with the SWA principal supplied by the trusted API proxy. */
export function freshReader(encoded: string | null): ReaderPrincipal | null {
  if (!encoded) return null;
  readerIdentity(encoded);
  const principal = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as ReaderPrincipal;
  if (!principal.userRoles.includes('library_member')) throw new ChatAccessError(403, 'Reader access required');
  return { identityProvider: 'github', userId: principal.userId, userDetails: principal.userDetails, userRoles: ['authenticated', 'reader', 'library_member'] };
}

export async function readReaderSession(store: SessionStore, token: string | null, now = Date.now()): Promise<Session | undefined> {
  const key = token ? sessionKey(token) : undefined;
  if (!key) return undefined;
  const session = await store.read<Session>(key);
  if (!session || !(Date.parse(session.expiresAt) > now)) return undefined;
  try { freshReader(Buffer.from(JSON.stringify(session.clientPrincipal)).toString('base64')); }
  catch { return undefined; } // Removing a login from the current allowlist invalidates all its sessions.
  return session;
}

interface SessionRequest { encoded: string | null; token: string | null; renew: boolean; logout?: boolean; start?: boolean; now?: number }
export async function readerSessionResponse(store: SessionStore, { encoded, token, renew, logout = false, start = false, now = Date.now() }: SessionRequest) {
  const headers: Record<string, string> = { 'Cache-Control': 'private, no-store' };
  const empty = () => ({ status: 200, jsonBody: { clientPrincipal: null, expiresAt: null }, headers });
  const key = token ? sessionKey(token) : undefined;
  if (logout) {
    if (key) await store.withLease(key, () => store.remove(key));
    headers['Set-Cookie'] = cookie('', 0);
    return empty();
  }
  let fresh: ReaderPrincipal | null;
  try {
    fresh = start ? freshReader(encoded) : null;
    if (start && !fresh) throw new ChatAccessError(403, 'Reader access required');
  }
  catch (error) {
    if (key) await store.withLease(key, () => store.remove(key));
    throw error;
  }
  const saved = await readReaderSession(store, token, now);
  if (!renew) return { status: 200, jsonBody: { clientPrincipal: saved?.clientPrincipal ?? fresh, expiresAt: saved?.expiresAt ?? null }, headers };
  if (saved && key && (!fresh || fresh.userId === saved.clientPrincipal.userId)) {
    return store.withLease(key, async () => {
      // Re-read inside the lease so concurrent logout cannot resurrect a session.
      const current = await readReaderSession(store, token, now);
      if (!current) { headers['Set-Cookie'] = cookie('', 0); return empty(); }
      const session = { ...current, ...(fresh ? { clientPrincipal: fresh } : {}), expiresAt: new Date(now + sessionLifetimeMs).toISOString() };
      await store.write(key, session);
      headers['Set-Cookie'] = cookie(token!, sessionLifetimeMs / 1000);
      return { status: 200, jsonBody: { clientPrincipal: session.clientPrincipal, expiresAt: session.expiresAt }, headers };
    });
  }
  if (key) await store.withLease(key, () => store.remove(key));
  if (!fresh) { headers['Set-Cookie'] = cookie('', 0); return empty(); }
  const newToken = randomBytes(32).toString('hex');
  const session: Session = { clientPrincipal: fresh, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + sessionLifetimeMs).toISOString() };
  await store.create(sessionKey(newToken)!, session);
  headers['Set-Cookie'] = cookie(newToken, sessionLifetimeMs / 1000);
  return { status: 200, jsonBody: { clientPrincipal: fresh, expiresAt: session.expiresAt }, headers };
}

export async function sessionReaderIdentity(store: SessionStore, encoded: string | null, token: string | null) {
  if (!token) { freshReader(encoded); return readerIdentity(encoded); }
  const session = await readReaderSession(store, token);
  if (!session) throw new ChatAccessError(403, 'Reader access required');
  return readerIdentity(Buffer.from(JSON.stringify(session.clientPrincipal)).toString('base64'));
}
