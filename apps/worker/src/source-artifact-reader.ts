import { hash, noteArtifacts, type Note } from '../../../shared/corpus.js';

export const maxArtifactBytes = 40 * 1024 * 1024;
export const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export class MissingArtifact extends Error {}
export class ArtifactTooLarge extends Error {
  constructor() { super('Source exceeds byte limit'); }
}
export class InvalidArtifact extends Error {}
export interface ArtifactReadOptions { maxBytes?: number; signal?: AbortSignal; }
export interface ArtifactReaderStore {
  readArtifact(hash: string, options?: ArtifactReadOptions): Promise<{ bytes: Uint8Array; mime: string } | undefined>;
}
type ArtifactReceipt = { hash: string; mime: string; retrievedAt: string };
type PinnedNote = Pick<Note, 'source' | 'generationId' | 'extraction'>;

/** Generic downloads can label a DOCX package as ZIP or octet-stream. */
export function docxCandidate(bytes: Uint8Array, mime: string) {
  const value = mime.toLowerCase().split(';')[0].trim();
  if (value === docxMime) return true;
  return ['', 'application/octet-stream', 'application/zip', 'application/x-zip-compressed'].includes(value)
    && bytes[0] === 0x50 && bytes[1] === 0x4b && Buffer.from(bytes).includes(Buffer.from('word/document.xml'));
}

/** Retained bytes are verified here without loading document parsers. Callers own access and selection. */
export class SourceArtifactReader {
  constructor(private readonly store: ArtifactReaderStore) {}

  private static mime(bytes: Uint8Array, mime: string) {
    const value = mime.split(';')[0].trim().toLowerCase();
    if (!value || value.length > 100) throw new InvalidArtifact('Invalid retained source MIME');
    if (['application/octet-stream', 'application/x-pdf'].includes(value) && Buffer.from(bytes.subarray(0, 5)).toString() === '%PDF-') return 'application/pdf';
    return docxCandidate(bytes, value) ? docxMime : value;
  }

  static check(artifact: { bytes: Uint8Array; mime: string }, receipt: ArtifactReceipt, maxBytes = maxArtifactBytes) {
    if (artifact.bytes.length > Math.min(maxArtifactBytes, maxBytes)) throw new ArtifactTooLarge();
    if (hash(artifact.bytes) !== receipt.hash) throw new InvalidArtifact('Retained source hash does not match its record');
    const mime = this.mime(artifact.bytes, receipt.mime);
    if (this.mime(artifact.bytes, artifact.mime) !== mime) throw new InvalidArtifact('Retained source MIME does not match its record');
    return { bytes: artifact.bytes, mime, retrievedAt: receipt.retrievedAt };
  }

  async read(note: PinnedNote, selectedHash = note.extraction.artifactHash, options: ArtifactReadOptions = {}) {
    if (!selectedHash) return undefined;
    if (!/^[a-f0-9]{64}$/.test(selectedHash) || !/^[a-f0-9]{64}$/.test(note.generationId)) throw new InvalidArtifact('Invalid pinned source artifact identity');
    const reference = noteArtifacts(note).find(artifact => artifact.hash === selectedHash);
    if (!reference) throw new InvalidArtifact('Artifact does not belong to the pinned source generation');
    options.signal?.throwIfAborted();
    const raw = await this.store.readArtifact(selectedHash, options);
    if (!raw) throw new MissingArtifact('Pinned source artifact is unavailable.');
    options.signal?.throwIfAborted();
    if (selectedHash === note.extraction.artifactHash && note.extraction.artifactMime
      && SourceArtifactReader.mime(raw.bytes, note.extraction.artifactMime) !== SourceArtifactReader.mime(raw.bytes, reference.mime || raw.mime))
      throw new InvalidArtifact('Pinned source MIME does not match its attachment record');
    const checked = SourceArtifactReader.check(raw, { hash: selectedHash, mime: reference.mime || raw.mime, retrievedAt: reference.retrievedAt }, options.maxBytes);
    const bytes = Buffer.from(checked.bytes);
    const valid = checked.mime === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-'
      : checked.mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : checked.mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : checked.mime === 'image/webp' ? bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
      : checked.mime === docxMime ? bytes[0] === 0x50 && bytes[1] === 0x4b : true;
    if (!valid) throw new InvalidArtifact('Retained source format does not match its MIME');
    return { ...checked, bytes };
  }
}
