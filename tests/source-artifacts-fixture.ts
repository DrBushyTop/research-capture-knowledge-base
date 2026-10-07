import { BlobStore } from '../apps/worker/src/storage.js';
import type { SourceArtifactStore } from '../apps/worker/src/source-artifacts.js';
import { MemoryStore } from './fixtures.js';

export const screenshot = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

export class MemorySourceArtifactStore extends MemoryStore implements SourceArtifactStore {
  readonly files = new Map<string, { bytes: Uint8Array; mime: string }>();
  async retain(id: string, bytes: Uint8Array, mime: string) { if (!this.files.has(id)) this.files.set(id, { bytes: Buffer.from(bytes), mime }); }
  async readArtifact(id: string) { return this.files.get(id); }
}

/** Exercises the real Blob adapter against a local stand-in for Azure's immutable raw files. */
export function blobArtifactStore() {
  const records = new MemoryStore();
  const files = new Map<string, { bytes: Uint8Array; mime: string }>();
  const store = Object.assign(Object.create(BlobStore.prototype) as BlobStore, {
    read: records.read.bind(records), create: records.create.bind(records), verifyLease: async () => {},
    raw: { getBlockBlobClient: (id: string) => ({
      async upload(bytes: Uint8Array, _length: number, options: { conditions: { ifNoneMatch: string }; blobHTTPHeaders: { blobContentType: string } }) {
        if (files.has(id) && options.conditions.ifNoneMatch === '*') throw Object.assign(new Error('Already retained'), { statusCode: 412 });
        files.set(id, { bytes: Buffer.from(bytes), mime: options.blobHTTPHeaders.blobContentType });
      },
      async getProperties() {
        const file = files.get(id);
        if (!file) throw Object.assign(new Error('File missing'), { statusCode: 404 });
        return { contentLength: file.bytes.length, contentType: file.mime, etag: id };
      },
      async downloadToBuffer(_offset: number, _length: number, options: { conditions: { ifMatch: string } }) {
        if (options.conditions.ifMatch !== id) throw Object.assign(new Error('ETag changed'), { statusCode: 412 });
        return Buffer.from(files.get(id)!.bytes);
      }
    }) }
  });
  Object.defineProperty(store, 'leaseSignal', { value: undefined });
  return Object.assign(store, { files, data: records.data });
}
