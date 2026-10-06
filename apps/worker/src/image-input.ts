import { imageInfo } from './image-info.js';

export interface SourceImage {
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
}
export const sourceImageLimits = { bytes: 5 * 1024 * 1024, side: 8192, pixels: 40_000_000, count: 1 };

/** Header checks bound inference input. They do not establish that the image decoder will accept the file. */
export function sourceImage(bytes: Uint8Array, declaredMime: string): SourceImage {
  if (!bytes.length || bytes.length > sourceImageLimits.bytes) throw new Error('Image must be 5 MB or smaller.');
  const info = imageInfo(Buffer.from(bytes));
  if (!info || info.mime !== declaredMime.split(';')[0].trim().toLowerCase()) throw new Error('Use a PNG, JPEG or WebP screenshot. Other image formats are not supported.');
  if (!info.width || !info.height || info.width > sourceImageLimits.side || info.height > sourceImageLimits.side || info.width * info.height > sourceImageLimits.pixels)
    throw new Error('Image dimensions are too large. Resize the screenshot before saving it.');
  return { bytes, mime: info.mime };
}

export function inferenceContent(input: unknown, images: SourceImage[] = []) {
  if (!images.length) return JSON.stringify(input);
  if (images.length > sourceImageLimits.count) throw new Error('Only one source image is supported per analysis.');
  return [
    { type: 'text' as const, text: JSON.stringify(input) },
    ...images.map(image => {
      const checked = sourceImage(image.bytes, image.mime);
      return { type: 'image_url' as const, image_url: { url: `data:${checked.mime};base64,${Buffer.from(checked.bytes).toString('base64')}`, detail: 'high' as const } };
    })
  ];
}
