import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { BlobStore } from '../apps/worker/src/storage.js';

// Explicit opt-in integration check. Uses temporary private blobs, never corpus data.
it.skipIf(!process.env.LIVE_AZURE_STORAGE)('rejects writes after lease takeover and stale ETags in Azure', async () => {
  const account = process.env.LIVE_AZURE_STORAGE!;
  const first = new BlobStore(account); const second = new BlobStore(account);
  const lock = `verification-${randomUUID()}`; const key = `verification/${randomUUID()}.json`;
  try {
    await expect(first.withLease(lock, async () => {
      await first.write(key, { revision: 1 });
      await first.container.getBlobClient(`locks/${lock}`).getBlobLeaseClient().breakLease(0);
      await second.withLease(lock, async () => { await second.write(key, { revision: 2 }); });
      await first.write(key, { revision: 0 });
    })).rejects.toThrow('Storage lease was lost');
    expect(await first.read(key)).toEqual({ revision: 2 });
    await expect(first.withLease(lock, async () => {
      await first.read(key);
      await second.withLease(`${lock}-other`, async () => { await second.write(key, { revision: 3 }); });
      await first.write(key, { revision: 1 });
    })).rejects.toMatchObject({ statusCode: 412 });
    expect(await first.read(key)).toEqual({ revision: 3 });
  } finally {
    await Promise.all([key, `locks/${lock}`, `locks/${lock}-other`].map(name => first.container.getBlobClient(name).deleteIfExists()));
  }
}, 120_000);
