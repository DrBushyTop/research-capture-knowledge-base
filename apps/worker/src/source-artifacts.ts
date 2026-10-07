import { z } from 'zod';
import { canonical, hash, httpUrl, sourceId, type Note, type SourceSnapshot, type ZoteroItem } from '../../../shared/corpus.js';
import { downloadAttachment, downloadPublic, extractArtifact, maxBytes, MissingArtifact, savedMetadata, type Extracted, type RetainedArtifact } from './extraction.js';
import type { BrowserCapture } from './browser-capture.js';
import type { PipelineStore } from './pipeline.js';
import type { Zotero } from './zotero.js';

/** Records use the authoritative store. Only original bytes use the private Blob adapter. */
export interface SourceArtifactStore extends Pick<PipelineStore, 'read' | 'create'> {
  retain(hash: string, bytes: Uint8Array, mime: string): Promise<void>;
  readArtifact(hash: string): Promise<{ bytes: Uint8Array; mime: string } | undefined>;
}

const artifactHash = z.string().regex(/^[a-f0-9]{64}$/);
const legacyArtifact = z.strictObject({ hash: artifactHash, mime: z.string().min(1).max(100), retrievedAt: z.string().min(1) });
const origin = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('attachment'), key: z.string().regex(/^[A-Z0-9]{8}$/), version: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal('url'), url: httpUrl }),
  z.strictObject({ kind: z.literal('legacy') })
]);
const receiptSchema = legacyArtifact.extend({ sourceId, fingerprint: artifactHash, origin });
type Receipt = z.infer<typeof receiptSchema>;

function mimeFor(bytes: Uint8Array, mime: string) {
  const value = mime.split(';')[0].trim().toLowerCase();
  if (!value || value.length > 100) throw new Error('Invalid retained source MIME');
  // Existing PDF records can have an octet-stream header. Extraction has always recognized their signature.
  if (value === 'application/octet-stream' && Buffer.from(bytes.subarray(0, 5)).toString() === '%PDF-') return 'application/pdf';
  return value;
}

function attachments(snapshot: SourceSnapshot) {
  const items = snapshot.root.data.itemType === 'attachment' ? [snapshot.root, ...snapshot.children] : snapshot.children;
  return items.filter(item => ['imported_file', 'imported_url'].includes(String(item.data.linkMode)));
}

function preferred(items: ZoteroItem[]) {
  return items.find(item => item.data.contentType === 'application/pdf') ||
    items.find(item => /^(text\/|application\/json$)/.test(String(item.data.contentType))) ||
    items.find(item => String(item.data.contentType).startsWith('image/')) ||
    items.find(item => String(item.data.contentType).startsWith('video/'));
}

/** Owns the selection invariant: replay uses the artifact that supplied successful evidence.
 * Input receipts preserve each original even if extraction fails before selecting its fallback.
 * Both receipts and selections are immutable. The old first-artifact record stays untouched.
 */
export class SourceArtifacts {
  constructor(private readonly store: SourceArtifactStore) {}

  private selectionKey(fingerprint: string) { return `artifact-selections/${fingerprint}.json`; }

  private async receipt(key: string, source: SourceSnapshot['source']) {
    const value = await this.store.read(key);
    if (!value) return undefined;
    const receipt = receiptSchema.parse(value);
    if (receipt.sourceId !== source.id || receipt.fingerprint !== source.fingerprint) throw new Error('Retained artifact belongs to another source capture');
    return receipt;
  }

  private async legacy(source: SourceSnapshot['source']): Promise<Receipt | undefined> {
    const value = await this.store.read(`artifacts/${source.fingerprint}.json`);
    return value ? { ...legacyArtifact.parse(value), sourceId: source.id, fingerprint: source.fingerprint, origin: { kind: 'legacy' } } : undefined;
  }

  private checked(artifact: { bytes: Uint8Array; mime: string }, receipt: Pick<Receipt, 'hash' | 'mime' | 'retrievedAt'>): RetainedArtifact {
    if (artifact.bytes.length > maxBytes) throw new Error('Source exceeds byte limit');
    if (hash(artifact.bytes) !== receipt.hash) throw new Error('Retained source hash does not match its record');
    const mime = mimeFor(artifact.bytes, receipt.mime);
    if (mimeFor(artifact.bytes, artifact.mime) !== mime) throw new Error('Retained source MIME does not match its record');
    return { bytes: artifact.bytes, mime, retrievedAt: receipt.retrievedAt };
  }

  private async restore(receipt: Pick<Receipt, 'hash' | 'mime' | 'retrievedAt'>): Promise<RetainedArtifact> {
    const artifact = await this.store.readArtifact(receipt.hash);
    if (!artifact) throw new MissingArtifact('Retained source file is unavailable.');
    return this.checked(artifact, receipt);
  }

  private async acquire(snapshot: SourceSnapshot, attachment: ZoteroItem | undefined, zotero: Pick<Zotero, 'request'>) {
    const location: Receipt['origin'] = attachment ? { kind: 'attachment', key: attachment.key, version: attachment.version }
      : { kind: 'url', url: snapshot.source.url! };
    const key = `artifact-inputs/${snapshot.source.fingerprint}/${hash(canonical(location))}.json`;
    const cached = await this.receipt(key, snapshot.source);
    if (cached) return { receipt: cached, artifact: await this.restore(cached) };
    const input = attachment ? await downloadAttachment(attachment, zotero) : await downloadPublic(snapshot.source.url!);
    if (input.bytes.length > maxBytes) throw new Error('Source exceeds byte limit');
    const mime = Buffer.from(input.bytes.subarray(0, 5)).toString() === '%PDF-' ? 'application/pdf' : mimeFor(input.bytes, input.mime);
    const receipt = receiptSchema.parse({ hash: hash(input.bytes), mime, retrievedAt: new Date().toISOString(),
      sourceId: snapshot.source.id, fingerprint: snapshot.source.fingerprint, origin: location });
    await this.store.retain(receipt.hash, input.bytes, receipt.mime);
    await this.store.create(key, receipt);
    await this.store.create(`artifacts/${snapshot.source.fingerprint}.json`, { hash: receipt.hash, mime: receipt.mime, retrievedAt: receipt.retrievedAt });
    // A concurrent immutable create may have won. Use its bytes and retrieval time consistently.
    const retained = (await this.receipt(key, snapshot.source))!;
    return { receipt: retained, artifact: await this.restore(retained) };
  }

  async extract(snapshot: SourceSnapshot, zotero: Pick<Zotero, 'request'>, browser?: () => Promise<BrowserCapture>): Promise<Extracted> {
    const unavailable = { status: 'metadata-only' as const, method: 'none' as const, reason: null, truncated: false,
      retrievedAt: new Date().toISOString(), artifactHash: null };
    if (!snapshot.source.active) return { text: '', evidence: { ...unavailable, reason: 'Source is no longer in the observed library.' } };
    const selected = await this.receipt(this.selectionKey(snapshot.source.fingerprint), snapshot.source);
    const cached = selected || await this.legacy(snapshot.source);
    const items = attachments(snapshot);
    const attachment = preferred(items);
    if (!cached && !attachment && !snapshot.source.url) return savedMetadata(snapshot, { ...unavailable, reason: 'No synced attachment or retrievable source URL.' });
    let input = cached ? { receipt: cached, artifact: await this.restore(cached) } : await this.acquire(snapshot, attachment, zotero);
    let result = await extractArtifact(snapshot, input.artifact, browser);
    // One synced screenshot can rescue an unusable text layer. Never recurse or fetch page image URLs.
    const image = snapshot.root.data.itemType !== 'attachment' && items.find(item => String(item.data.contentType).startsWith('image/'));
    const textArtifact = input.artifact.mime === 'application/pdf' || input.artifact.mime === 'application/json' || input.artifact.mime.startsWith('text/');
    if (image && textArtifact && !['text', 'image'].includes(result.evidence.status)) {
      input = await this.acquire(snapshot, image, zotero);
      result = await extractArtifact(snapshot, input.artifact);
    }
    if (['text', 'image'].includes(result.evidence.status)) await this.store.create(this.selectionKey(snapshot.source.fingerprint), input.receipt);
    return result;
  }

  /** Template analysis can pass its pinned source note here before parsing with extractArtifact.
   * Reads exactly extraction.artifactHash, never the latest selection or a live URL.
   * Generation identity stays with the pinned note. Returned bytes contain no caption or metadata text.
   * Legacy notes can name a retained screenshot even when their first-artifact record still names HTML.
   * For browser evidence the hash still names the original saved HTML, not the later rendered capture.
   */
  async readForNote(note: Pick<Note, 'source' | 'generationId' | 'extraction'>): Promise<RetainedArtifact | undefined> {
    const id = note.extraction.artifactHash;
    if (!id) return undefined;
    artifactHash.parse(id);
    artifactHash.parse(note.generationId);
    const raw = await this.store.readArtifact(id);
    if (!raw) throw new MissingArtifact('Pinned source artifact is unavailable.');
    const mime = note.extraction.artifactMime || raw.mime;
    // Older notes may lack artifactMime. Verify the raw Blob header rather than guessing from source metadata.
    return this.checked(raw, { hash: id, mime, retrievedAt: note.extraction.retrievedAt });
  }
}
