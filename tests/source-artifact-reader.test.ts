import { expect, it, vi } from 'vitest';
import { hash, normalize, type Note } from '../shared/corpus.js';
import { ArtifactTooLarge, InvalidArtifact, MissingArtifact, SourceArtifactReader } from '../apps/worker/src/source-artifact-reader.js';
import { snapshot } from './fixtures.js';
import { blobArtifactStore, MemorySourceArtifactStore, screenshot } from './source-artifacts-fixture.js';

const pdf = Buffer.from('%PDF-1.7\nRetained source');
function pinned(bytes = pdf, mime = 'application/pdf') {
  return { source: normalize(snapshot)[0].source, generationId: hash('generation'),
    extraction: { status: 'text', method: 'pdf-text', reason: null, truncated: false, retrievedAt: '2026-10-09T08:00:00Z', artifactHash: hash(bytes), artifactMime: mime }
  } satisfies Pick<Note, 'source' | 'generationId' | 'extraction'>;
}

it('rejects artifacts outside the pinned generation before reading storage', async () => {
  const store = new MemorySourceArtifactStore();
  const read = vi.spyOn(store, 'readArtifact');
  await expect(new SourceArtifactReader(store).read(pinned(), hash('another artifact'))).rejects.toThrow('does not belong');
  await expect(new SourceArtifactReader(store).read({ ...pinned(), generationId: '../private' })).rejects.toBeInstanceOf(InvalidArtifact);
  expect(read).not.toHaveBeenCalled();
});

it.each(['application/octet-stream', 'application/x-pdf', 'application/pdf; charset=binary'])('accepts verified legacy PDF headers declared as %s', async mime => {
  const store = new MemorySourceArtifactStore();
  await store.retain(hash(pdf), pdf, mime);
  const note = pinned();
  expect(await new SourceArtifactReader(store).read(note)).toEqual({ bytes: pdf, mime: 'application/pdf', retrievedAt: note.extraction.retrievedAt });
});

it('uses the raw MIME for old image notes that lack a retained MIME field', async () => {
  const store = new MemorySourceArtifactStore();
  await store.retain(hash(screenshot), screenshot, 'image/png');
  const note = pinned(screenshot, 'image/png');
  const { artifactMime: _mime, ...extraction } = note.extraction;
  expect((await new SourceArtifactReader(store).read({ ...note, extraction: { ...extraction, method: 'image-vision', status: 'image' } }))?.mime).toBe('image/png');
});

it.each(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])('rejects bytes mislabeled as %s even if their hash is valid', async mime => {
  const bytes = Buffer.from('<html>Not a document or image</html>');
  const store = new MemorySourceArtifactStore();
  await store.retain(hash(bytes), bytes, mime);
  await expect(new SourceArtifactReader(store).read(pinned(bytes, mime))).rejects.toThrow('format does not match');
});

it('rejects changed bytes and MIME without substituting another retained original', async () => {
  const store = new MemorySourceArtifactStore();
  await store.retain(hash(pdf), Buffer.from('Changed bytes'), 'application/pdf');
  await expect(new SourceArtifactReader(store).read(pinned())).rejects.toThrow('hash does not match');
  store.files.set(hash(pdf), { bytes: pdf, mime: 'text/plain' });
  await expect(new SourceArtifactReader(store).read(pinned())).rejects.toThrow('MIME does not match');
  store.files.clear();
  await expect(new SourceArtifactReader(store).read(pinned())).rejects.toBeInstanceOf(MissingArtifact);
});

it('applies the caller limit before Blob download and pins bytes to the ETag', async () => {
  const store = blobArtifactStore();
  const download = vi.fn(async () => screenshot);
  vi.spyOn(store.raw, 'getBlockBlobClient').mockReturnValue({
    getProperties: async () => ({ contentLength: 6 * 1024 * 1024, contentType: 'image/png', etag: 'original' }),
    downloadToBuffer: download
  } as never);
  const reader = new SourceArtifactReader(store);
  await expect(reader.read(pinned(screenshot, 'image/png'), undefined, { maxBytes: 5 * 1024 * 1024 })).rejects.toBeInstanceOf(ArtifactTooLarge);
  expect(download).not.toHaveBeenCalled();
  vi.spyOn(store.raw, 'getBlockBlobClient').mockReturnValue({
    getProperties: async () => ({ contentLength: screenshot.length, contentType: 'image/png', etag: 'original' }),
    downloadToBuffer: async (_offset: number, _length: number, options: { conditions: { ifMatch: string } }) => {
      expect(options.conditions.ifMatch).toBe('original');
      throw Object.assign(new Error('ETag changed'), { statusCode: 412 });
    }
  } as never);
  await expect(reader.read(pinned(screenshot, 'image/png'))).rejects.toThrow('ETag changed');
});

it('checks returned byte limits even when a memory adapter does not enforce the requested cap', async () => {
  const store = new MemorySourceArtifactStore();
  await store.retain(hash(pdf), pdf, 'application/pdf');
  await expect(new SourceArtifactReader(store).read(pinned(), undefined, { maxBytes: 1 })).rejects.toBeInstanceOf(ArtifactTooLarge);
});

it('honors cancellation before and during a retained read', async () => {
  const controller = new AbortController();
  const store = new MemorySourceArtifactStore();
  await store.retain(hash(pdf), pdf, 'application/pdf');
  const original = store.readArtifact.bind(store);
  const read = vi.spyOn(store, 'readArtifact').mockImplementation(async id => { controller.abort(); return original(id); });
  await expect(new SourceArtifactReader(store).read(pinned(), undefined, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  read.mockClear();
  await expect(new SourceArtifactReader(store).read(pinned(), undefined, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(read).not.toHaveBeenCalled();
});
