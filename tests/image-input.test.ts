import { expect, it } from 'vitest';
import { inferenceContent, sourceImage, sourceImageLimits } from '../apps/worker/src/image-input.js';

export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

it('sends retained bytes as image content rather than captions or remote signed URLs', () => {
  const image = sourceImage(png, 'image/png');
  expect(inferenceContent({ sourceText: '' }, [image])).toEqual([
    { type: 'text', text: '{"sourceText":""}' },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}`, detail: 'high' } }
  ]);
  expect(inferenceContent({ sourceText: 'A text source' })).toBe('{"sourceText":"A text source"}');
});

it('rejects MIME spoofing, SVG, empty images and bounded oversized evidence', () => {
  expect(() => sourceImage(png, 'image/jpeg')).toThrow('PNG, JPEG or WebP');
  expect(() => sourceImage(Buffer.from('<svg onload="fetch()">'), 'image/svg+xml')).toThrow('PNG, JPEG or WebP');
  expect(() => sourceImage(Buffer.alloc(0), 'image/png')).toThrow('5 MB');
  expect(() => sourceImage(Buffer.alloc(sourceImageLimits.bytes + 1), 'image/png')).toThrow('5 MB');
  const giant = Buffer.from(png); giant.writeUInt32BE(10000, 16);
  expect(() => sourceImage(giant, 'image/png')).toThrow('dimensions');
  expect(() => inferenceContent({}, [sourceImage(png, 'image/png'), sourceImage(png, 'image/png')])).toThrow('one source image');
});
