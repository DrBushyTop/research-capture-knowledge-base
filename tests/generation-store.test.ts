import { expect, it } from 'vitest';
import { GenerationStore } from './generation-store.js';

it('requires mutable-write leases and rejects stale record revisions', async () => {
  const store = new GenerationStore();
  await store.create('record', { value: 1 });
  await expect(store.write('record', { value: 0 })).rejects.toThrow('Mutable writes require a lease');
  await expect(store.withLease('first', async () => {
    await store.read('record');
    await store.withLease('second', () => store.write('record', { value: 2 }));
    await store.write('record', { value: 0 });
  })).rejects.toThrow('Stale record revision');
  expect(await store.read('record')).toEqual({ value: 2 });
});

it('guards every parent lease in a nested mutation', async () => {
  const store = new GenerationStore();
  await expect(store.withLease('poll', () => store.withLease('source', async () => {
    store.loseLease('poll');
    await store.create('snapshot', {});
  }))).rejects.toThrow('Lease lost');
  expect(await store.read('snapshot')).toBeUndefined();
});

it('fences an expired owner without releasing the successor lease', async () => {
  const store = new GenerationStore();
  await store.create('record', { value: 1 });
  const oldPause = store.pause('write', 'record', 'before');
  const old = store.withLease('source', () => store.write('record', { value: 0 }));
  const rejected = expect(old).rejects.toThrow('Lease lost');
  await oldPause.reached;
  store.loseLease('source');
  const newPause = store.pause('write', 'record');
  const successor = store.withLease('source', () => store.write('record', { value: 2 }));
  await newPause.reached;
  oldPause.resume();
  await rejected;
  await expect(store.withLease('source', async () => {})).rejects.toThrow('Lease busy');
  newPause.resume();
  await successor;
  expect(await store.read('record')).toEqual({ value: 2 });
});
