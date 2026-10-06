import { imageInfo } from './image-info.js';
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

export { imageInfo } from './image-info.js';

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
