import { deflateSync } from 'node:zlib';

/** A complete synthetic PNG with two colored bars. No external image files. */
export function chartPng(first = 12, second = 18) {
  const width = 96, height = 96;
  const pixels = Buffer.alloc(height * (1 + width * 3), 255);
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    pixels[row] = 0;
    for (let x = 0; x < width; x++) {
      const color = y === 80 && x >= 8 && x < 88 ? [40, 40, 40]
        : x >= 20 && x < 40 && y >= 80 - first * 3 && y < 80 ? [32, 150, 95]
        : x >= 56 && x < 76 && y >= 80 - second * 3 && y < 80 ? [230, 140, 40] : [255, 255, 255];
      pixels.set(color, row + 1 + x * 3);
    }
  }
  function chunk(kind: string, data: Buffer) {
    const type = Buffer.from(kind);
    let crc = 0xffffffff;
    for (const byte of Buffer.concat([type, data])) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, type, data, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
