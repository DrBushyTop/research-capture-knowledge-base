import { randomBytes } from 'node:crypto';
import type { ChatImage, ChatUpload } from '../../../shared/chat.js';
import type { PipelineStore } from './pipeline.js';
import { ChatAccessError } from './chat-service.js';

export interface UploadStore extends PipelineStore {
  createBinary(key: string, data: Uint8Array, mime: string): Promise<void>;
  readBinary(key: string): Promise<Buffer | undefined>;
}
// Screenshots stay well inside the Responses image limits. The reader scales larger images to 2048px before upload.
export const chatUploadLimits = { bytes: 5 * 1024 * 1024, side: 8192, pixels: 40_000_000, perHour: 40, lifetimeMs: 24 * 60 * 60_000 };
// Uploads share the chat/assets/ prefix so the existing one-day lifecycle rule deletes them.
export const uploadKey = (owner: string, id: string) => `chat/assets/uploads/${owner}/${id}`;

/** Reads PNG, JPEG or WebP dimensions from the file header. Any other format, including SVG, is rejected. */
export function imageInfo(bytes: Buffer): { mime: ChatUpload['mime']; width: number; height: number } | undefined {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && bytes.toString('ascii', 12, 16) === 'IHDR')
    return { mime: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = bytes.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { mime: 'image/webp', width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { mime: 'image/webp', width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L' && bytes[20] === 0x2f) { const bits = bytes.readUInt32LE(21); return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
    return undefined;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; offset + 9 < bytes.length;) {
      if (bytes[offset] !== 0xff) return undefined;
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      if (marker === 0xff) { offset += 1; continue; }
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2) return undefined;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { mime: 'image/jpeg', height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      offset += 2 + length;
    }
  }
  return undefined;
}

export async function saveUpload(store: UploadStore, owner: string, bytes: Buffer, declaredMime: string | null) {
  if (!bytes.length || bytes.length > chatUploadLimits.bytes) throw new ChatAccessError(413, 'Images must be 5 MB or smaller');
  const info = imageInfo(bytes);
  if (!info || (declaredMime && declaredMime.split(';')[0].trim() !== info.mime)) throw new ChatAccessError(415, 'Attach a PNG, JPEG or WebP image');
  if (!info.width || !info.height || info.width > chatUploadLimits.side || info.height > chatUploadLimits.side || info.width * info.height > chatUploadLimits.pixels) throw new ChatAccessError(413, 'Image dimensions are too large');
  return store.withLease(`chat-upload-${owner}`, async () => {
    const now = Date.now(); const key = `chat/users/${owner}-uploads.json`;
    const previous = await store.read<{ startedAt: string; count: number }>(key);
    const startedAt = previous && now - Date.parse(previous.startedAt) < 60 * 60_000 ? previous.startedAt : new Date(now).toISOString();
    const count = startedAt === previous?.startedAt ? previous.count : 0;
    if (count >= chatUploadLimits.perHour) throw new ChatAccessError(429, 'Hourly image limit reached. Try again later.');
    await store.write(key, { startedAt, count: count + 1 });
    const upload: ChatUpload = { id: 'u_' + randomBytes(16).toString('hex'), owner, ...info, bytes: bytes.length, createdAt: new Date(now).toISOString() };
    await store.createBinary(uploadKey(owner, upload.id) + '.bin', bytes, info.mime);
    await store.create(uploadKey(owner, upload.id) + '.json', upload);
    return { id: upload.id, mime: upload.mime, width: upload.width, height: upload.height } satisfies ChatImage;
  });
}

/** Returns an upload only to the reader who created it, within the chat retention window. */
export async function ownedUpload(store: PipelineStore, owner: string, id: string) {
  if (!/^u_[a-f0-9]{32}$/.test(id)) throw new ChatAccessError(404, 'Image not found');
  const upload = await store.read<ChatUpload>(uploadKey(owner, id) + '.json');
  if (!upload || upload.owner !== owner || upload.id !== id || Date.now() - Date.parse(upload.createdAt) > chatUploadLimits.lifetimeMs) throw new ChatAccessError(404, 'Image not found');
  return upload;
}

export async function readUpload(store: UploadStore, owner: string, id: string) {
  const upload = await ownedUpload(store, owner, id);
  const bytes = await store.readBinary(uploadKey(owner, id) + '.bin');
  if (!bytes || bytes.length !== upload.bytes || imageInfo(bytes)?.mime !== upload.mime) throw new ChatAccessError(404, 'Image not found');
  return { bytes, mime: upload.mime };
}
