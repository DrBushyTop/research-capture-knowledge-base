import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { QueueServiceClient } from '@azure/storage-queue';
import { DefaultAzureCredential } from '@azure/identity';
import type { PipelineStore } from './pipeline.js';

const missing = (error: unknown) => (error as { statusCode?: number }).statusCode === 404;
export class BlobStore implements PipelineStore {
  readonly container: ContainerClient;
  readonly raw: ContainerClient;
  readonly queue;
  constructor(account: string) {
    const credential = new DefaultAzureCredential();
    const blobs = new BlobServiceClient(`https://${account}.blob.core.windows.net`, credential);
    this.container = blobs.getContainerClient('pipeline');
    this.raw = blobs.getContainerClient('raw');
    this.queue = new QueueServiceClient(`https://${account}.queue.core.windows.net`, credential).getQueueClient('processing');
  }
  async read<T>(key: string): Promise<T | undefined> {
    try { return JSON.parse((await this.container.getBlockBlobClient(key).downloadToBuffer()).toString('utf8')) as T; }
    catch (error) { if (missing(error)) return undefined; throw error; }
  }
  async write(key: string, value: unknown) {
    const body = Buffer.from(JSON.stringify(value));
    await this.container.getBlockBlobClient(key).upload(body, body.length, { blobHTTPHeaders: { blobContentType: 'application/json' } });
  }
  async create(key: string, value: unknown) {
    const body = Buffer.from(JSON.stringify(value));
    try { await this.container.getBlockBlobClient(key).upload(body, body.length, { conditions: { ifNoneMatch: '*' }, blobHTTPHeaders: { blobContentType: 'application/json' } }); }
    catch (error) { if ((error as { statusCode?: number }).statusCode !== 409 && (error as { statusCode?: number }).statusCode !== 412) throw error; }
  }
  async list(prefix: string) {
    const keys: string[] = [];
    for await (const blob of this.container.listBlobsFlat({ prefix })) keys.push(blob.name);
    return keys;
  }
  async withLease<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const blob = this.container.getBlockBlobClient(`locks/${key}`);
    try { await blob.upload('', 0, { conditions: { ifNoneMatch: '*' } }); }
    catch (error) { if (![409, 412].includes((error as { statusCode: number }).statusCode)) throw error; }
    const lease = blob.getBlobLeaseClient();
    await lease.acquireLease(60);
    let lost: unknown;
    const renew = setInterval(() => { void lease.renewLease().catch(error => { lost = error; }); }, 20_000);
    try { const result = await fn(); if (lost) throw new Error('Storage lease was lost'); return result; }
    finally { clearInterval(renew); await lease.releaseLease().catch(() => undefined); }
  }
  async send(id: string) { await this.queue.sendMessage(Buffer.from(JSON.stringify({ jobId: id })).toString('base64'), { messageTimeToLive: -1 }); }
  async retain(hash: string, data: Uint8Array, mime: string) {
    try { await this.raw.getBlockBlobClient(hash).upload(data, data.length, { conditions: { ifNoneMatch: '*' }, blobHTTPHeaders: { blobContentType: mime } }); }
    catch (error) { if (![409, 412].includes((error as { statusCode: number }).statusCode)) throw error; }
  }
}
