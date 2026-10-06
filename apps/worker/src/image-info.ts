import type { ChatUpload } from '../../../shared/chat.js';

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

