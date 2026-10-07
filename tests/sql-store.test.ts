import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqlStore } from '../apps/worker/src/sql-store.js';
import { sqlPool, closeSql } from '../apps/worker/src/sql-connection.js';
import { readerSessionResponse, readReaderSession } from '../apps/worker/src/reader-session.js';
import { hash } from '../shared/corpus.js';

afterAll(closeSql);
it.skipIf(!process.env.TEST_SQL)('SQL records support immutable creates, conditional writes, prefix listing and lease fencing', async () => {
  const first = new SqlStore('devstoreaccount1'), second = new SqlStore('devstoreaccount1');
  const prefix = `verification/${randomUUID()}/`, key = prefix + 'record.json', lock = randomUUID();
  try {
    await first.create(key, { value: 1 });
    await first.create(key, { value: 99 });
    expect(await first.read(key)).toEqual({ value: 1 });
    expect(await first.list(prefix)).toEqual([key]);
    await expect(first.write(key, { value: 2 })).rejects.toThrow('require a lease');
    await first.withLease(lock, () => first.write(key, { value: 2 }));
    await expect(first.withLease(lock, async () => {
      await first.read(key);
      await second.withLease('other-' + lock, () => second.write(key, { value: 3 }));
      await first.write(key, { value: 4 });
    })).rejects.toThrow('Stale SQL revision');
    expect(await first.read(key)).toEqual({ value: 3 });
    await expect(first.withLease(lock, () => second.withLease(lock, async () => {}))).rejects.toThrow('SQL lease is busy');
    await expect(first.withLease(lock, async () => {
      await (await sqlPool()).request().input('key', lock).query('UPDATE dbo.Leases SET expires_at=DATEADD(second,-1,SYSUTCDATETIME()) WHERE lease_key=@key');
      await second.withLease(lock, () => second.write(key, { value: 5 }));
      await first.write(key, { value: 0 });
    })).rejects.toThrow('SQL lease was lost');
    expect(await first.read(key)).toEqual({ value: 5 });
  } finally {
    await (await sqlPool()).request().input('key', key).query('DELETE dbo.Records WHERE record_key=@key');
  }
}, 60000);

it.skipIf(!process.env.TEST_SQL)('reader sessions survive worker restarts, renew under SQL leases and revoke persistently', async () => {
  const first = new SqlStore('devstoreaccount1'), second = new SqlStore('devstoreaccount1');
  const userDetails = (process.env.READER_GITHUB_USERS || '').split(',')[0];
  expect(userDetails).toBeTruthy();
  const encoded = Buffer.from(JSON.stringify({ identityProvider: 'github', userId: randomUUID(), userDetails, userRoles: ['anonymous', 'authenticated'] })).toString('base64');
  const response = await readerSessionResponse(first, { encoded, token: null, renew: true, start: true });
  const token = response.headers['Set-Cookie'].split(';')[0].split('=')[1];
  const key = `reader-sessions/${hash(token)}.json`;
  try {
    expect((await readReaderSession(second, token))?.clientPrincipal.userDetails).toBe(userDetails);
    const renewed = await readerSessionResponse(second, { encoded: null, token, renew: true });
    expect(Date.parse(renewed.jsonBody.expiresAt!)).toBeGreaterThanOrEqual(Date.parse(response.jsonBody.expiresAt!));
    await readerSessionResponse(first, { encoded: null, token, renew: false, logout: true });
    expect(await readReaderSession(second, token)).toBeUndefined();
  } finally { await first.remove(key); }
}, 60000);
