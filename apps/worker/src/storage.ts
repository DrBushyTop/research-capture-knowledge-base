import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { QueueServiceClient } from '@azure/storage-queue';
import { DefaultAzureCredential } from '@azure/identity';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PipelineStore } from './pipeline.js';

const missing = (error: unknown) => (error as { statusCode?: number }).statusCode === 404;
type LeaseFrame = { renew: () => Promise<void>; controller: AbortController; etags: Map<string, string | undefined>; parent?: LeaseFrame };
export class BlobStore implements PipelineStore {
  readonly container: ContainerClient;
  readonly raw: ContainerClient;
  readonly queue;
  readonly chatQueue;
  private readonly leases = new AsyncLocalStorage<LeaseFrame>();
  constructor(account: string) {
    const credential = new DefaultAzureCredential();
    const blobs = new BlobServiceClient(`https://${account}.blob.core.windows.net`, credential, { retryOptions: { maxTries: 1, tryTimeoutInMs: 15_000 } });
    this.container = blobs.getContainerClient('pipeline');
    this.raw = blobs.getContainerClient('raw');
    this.queue = new QueueServiceClient(`https://${account}.queue.core.windows.net`, credential).getQueueClient('processing');
    this.chatQueue = new QueueServiceClient(`https://${account}.queue.core.windows.net`, credential).getQueueClient('chat');
  }
  get leaseSignal(): AbortSignal | undefined {
    const signals: AbortSignal[] = [];
    for (let frame = this.leases.getStore(); frame; frame = frame.parent) signals.push(frame.controller.signal);
    return signals.length ? AbortSignal.any(signals) : undefined;
  }
  private operationSignal() { return AbortSignal.any([AbortSignal.timeout(20_000), ...(this.leaseSignal ? [this.leaseSignal] : [])]); }
  async verifyLease() {
    for (let frame = this.leases.getStore(); frame; frame = frame.parent) {
      frame.controller.signal.throwIfAborted();
      await frame.renew();
      frame.controller.signal.throwIfAborted();
    }
  }
  async read<T>(key: string): Promise<T | undefined> {
    const blob = this.container.getBlockBlobClient(key);
    const frame = this.leases.getStore();
    try {
      const properties = await blob.getProperties({ abortSignal: this.operationSignal() });
      const data = await blob.downloadToBuffer(0, undefined, { conditions: { ifMatch: properties.etag }, abortSignal: this.operationSignal() });
      frame?.etags.set(key, properties.etag);
      return JSON.parse(data.toString('utf8')) as T;
    }
    catch (error) { if (missing(error)) { frame?.etags.set(key, undefined); return undefined; } throw error; }
  }
  async write(key: string, value: unknown) {
    const frame = this.leases.getStore();
    if (!frame) throw new Error('Mutable pipeline writes require a lease');
    if (!frame.etags.has(key)) await this.read(key);
    await this.verifyLease();
    const body = Buffer.from(JSON.stringify(value));
    const etag = frame.etags.get(key);
    const result = await this.container.getBlockBlobClient(key).upload(body, body.length, {
      conditions: etag ? { ifMatch: etag } : { ifNoneMatch: '*' }, abortSignal: this.operationSignal(),
      blobHTTPHeaders: { blobContentType: 'application/json' }
    });
    frame.etags.set(key, result.etag);
  }
  async create(key: string, value: unknown) {
    await this.verifyLease();
    const body = Buffer.from(JSON.stringify(value));
    try { await this.container.getBlockBlobClient(key).upload(body, body.length, { conditions: { ifNoneMatch: '*' }, abortSignal: this.operationSignal(), blobHTTPHeaders: { blobContentType: 'application/json' } }); }
    catch (error) { if ((error as { statusCode?: number }).statusCode !== 409 && (error as { statusCode?: number }).statusCode !== 412) throw error; }
  }
  async createBinary(key: string, data: Uint8Array, mime: string) {
    await this.verifyLease();
    try { await this.container.getBlockBlobClient(key).upload(data, data.length, { conditions: { ifNoneMatch: '*' }, abortSignal: this.operationSignal(), blobHTTPHeaders: { blobContentType: mime } }); }
    catch (error) { if (![409, 412].includes((error as { statusCode: number }).statusCode)) throw error; }
  }
  async readBinary(key: string) {
    const blob = this.container.getBlockBlobClient(key);
    try {
      const properties = await blob.getProperties({ abortSignal: this.operationSignal() });
      if (!properties.contentLength || properties.contentLength > 10 * 1024 * 1024) return undefined;
      return await blob.downloadToBuffer(0, undefined, { conditions: { ifMatch: properties.etag }, abortSignal: this.operationSignal() });
    } catch (error) { if (missing(error)) return undefined; throw error; }
  }
  async remove(key: string) { await this.verifyLease(); await this.container.getBlockBlobClient(key).deleteIfExists({ abortSignal: this.operationSignal() }); }
  async list(prefix: string) {
    const keys: string[] = [];
    for await (const blob of this.container.listBlobsFlat({ prefix, abortSignal: this.operationSignal() })) keys.push(blob.name);
    return keys;
  }
  async withLease<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const blob = this.container.getBlockBlobClient(`locks/${key}`);
    try { await blob.upload('', 0, { conditions: { ifNoneMatch: '*' } }); }
    catch (error) { if (![409, 412].includes((error as { statusCode: number }).statusCode)) throw error; }
    const lease = blob.getBlobLeaseClient();
    await lease.acquireLease(60, { abortSignal: this.operationSignal() });
    const controller = new AbortController();
    const frame: LeaseFrame = { controller, etags: new Map(), parent: this.leases.getStore(), renew: async () => {
      try { await lease.renewLease({ abortSignal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) }); }
      catch { controller.abort(new Error('Storage lease was lost')); throw controller.signal.reason; }
    } };
    const renew = setInterval(() => { void frame.renew().catch(() => undefined); }, 20_000);
    try {
      return await this.leases.run(frame, async () => { const result = await fn(); await this.verifyLease(); return result; });
    } finally {
      clearInterval(renew);
      controller.abort(new Error('Storage lease has ended'));
      await lease.releaseLease({ abortSignal: AbortSignal.timeout(15_000) }).catch(() => undefined);
    }
  }
  async send(id: string) { await this.verifyLease(); await this.queue.sendMessage(Buffer.from(JSON.stringify({ jobId: id })).toString('base64'), { messageTimeToLive: -1, abortSignal: this.operationSignal() }); }
  async sendChat(id: string) { await this.verifyLease(); await this.chatQueue.sendMessage(Buffer.from(JSON.stringify({ jobId: id })).toString('base64'), { messageTimeToLive: -1, abortSignal: this.operationSignal() }); }
  async retain(hash: string, data: Uint8Array, mime: string) {
    await this.verifyLease();
    try { await this.raw.getBlockBlobClient(hash).upload(data, data.length, { conditions: { ifNoneMatch: '*' }, abortSignal: this.operationSignal(), blobHTTPHeaders: { blobContentType: mime } }); }
    catch (error) { if (![409, 412].includes((error as { statusCode: number }).statusCode)) throw error; }
  }
  async retainSource(fingerprint: string, hash: string, bytes: Uint8Array, mime: string) {
    await this.retain(hash, bytes, mime);
    await this.create(`artifacts/${fingerprint}.json`, { hash, mime, retrievedAt: new Date().toISOString() });
  }
  async restoreSource(fingerprint: string) {
    const artifact = await this.read<{ hash: string; mime: string; retrievedAt: string }>(`artifacts/${fingerprint}.json`);
    if (!artifact) return undefined;
    return { bytes: await this.raw.getBlockBlobClient(artifact.hash).downloadToBuffer(), mime: artifact.mime, retrievedAt: artifact.retrievedAt };
  }
}
