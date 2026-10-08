import { z } from 'zod';
import { canonical, extractionArtifactSchema, hash, httpUrl, noteArtifacts, processingVersion, sourceId, type ExtractionArtifact, type Note, type SourceSnapshot, type ZoteroItem } from '../../../shared/corpus.js';
import { downloadAttachment, downloadPublic, extractArtifact, maxBytes, MissingArtifact, savedMetadata, withSavedCommentary, type Extracted, type RetainedArtifact } from './extraction.js';
import type { BrowserCapture } from './browser-capture.js';
import type { PipelineStore } from './pipeline.js';
import type { Zotero } from './zotero.js';
import { sourceImageLimits } from './image-input.js';
import { sourceTextLimit } from '../../../shared/source-text.js';
import { docxCandidate, docxMime } from './docx-text.js';

/** Records use the authoritative store. Only original bytes use the private Blob adapter. */
export interface SourceArtifactStore extends Pick<PipelineStore, 'read' | 'create'> {
  retain(hash: string, bytes: Uint8Array, mime: string): Promise<void>;
  readArtifact(hash: string): Promise<{ bytes: Uint8Array; mime: string } | undefined>;
  source?(id: string): Promise<{ note: Pick<Note, 'source' | 'generationId' | 'extraction'> } | undefined>;
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
const attachmentSetSchema = z.strictObject({ sourceId, fingerprint: artifactHash,
  inputs: z.array(z.strictObject({ receipt: receiptSchema, evidence: extractionArtifactSchema })).max(8),
  omissions: z.array(z.string().max(200)).max(100) });
export const sourceArtifactLimits = { count: 8, bytes: 80 * 1024 * 1024 };
class AttachmentBudget extends Error {}

function mimeFor(bytes: Uint8Array, mime: string) {
  const value = mime.split(';')[0].trim().toLowerCase();
  if (!value || value.length > 100) throw new Error('Invalid retained source MIME');
  // Historical PDF headers differ. Normalize the supported aliases only after checking the bytes.
  if (['application/octet-stream', 'application/x-pdf'].includes(value) && Buffer.from(bytes.subarray(0, 5)).toString() === '%PDF-') return 'application/pdf';
  if (docxCandidate(bytes, value)) return docxMime;
  return value;
}

function attachments(snapshot: SourceSnapshot) {
  const items = snapshot.root.data.itemType === 'attachment' ? [snapshot.root, ...snapshot.children] : snapshot.children;
  return items.filter(item => ['imported_file', 'imported_url', 'embedded_image'].includes(String(item.data.linkMode)));
}

function preference(item: ZoteroItem) {
  const mime = String(item.data.contentType);
  return mime === 'application/pdf' ? 0 : /^(text\/|application\/json$)/.test(mime) || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? 1 : mime.startsWith('image/') ? 2 : 3;
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

  private async published(source: SourceSnapshot['source']) {
    const note = (await this.store.source?.(source.id))?.note;
    if (!note || note.source.id !== source.id || note.source.fingerprint !== source.fingerprint || !note.extraction.artifactHash) return undefined;
    // Older captures recorded only their first input. The published note identifies the successful evidence.
    const artifact = await this.readForNote(note);
    if (!artifact) return undefined;
    const receipt = receiptSchema.parse({ hash: note.extraction.artifactHash, mime: artifact.mime, retrievedAt: artifact.retrievedAt,
      sourceId: source.id, fingerprint: source.fingerprint, origin: { kind: 'legacy' } });
    return { receipt, artifact };
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

  private async acquire(snapshot: SourceSnapshot, attachment: ZoteroItem | undefined, zotero: Pick<Zotero, 'request'>, url = snapshot.source.url, remainingBytes = maxBytes) {
    const location: Receipt['origin'] = attachment ? { kind: 'attachment', key: attachment.key, version: attachment.version }
      : { kind: 'url', url: url! };
    const key = `artifact-inputs/${snapshot.source.fingerprint}/${hash(canonical(location))}.json`;
    const cached = await this.receipt(key, snapshot.source);
    if (cached) {
      const raw = await this.store.readArtifact(cached.hash);
      if (raw) {
        if (raw.bytes.length > remainingBytes) throw new AttachmentBudget('Combined attachment byte limit reached.');
        return { receipt: cached, artifact: this.checked(raw, cached) };
      }
    }
    const input = attachment ? await downloadAttachment(attachment, zotero) : await downloadPublic(url!);
    if (input.bytes.length > maxBytes) throw new Error('Source exceeds byte limit');
    if (input.bytes.length > remainingBytes) throw new AttachmentBudget('Combined attachment byte limit reached.');
    const mime = Buffer.from(input.bytes.subarray(0, 5)).toString() === '%PDF-' ? 'application/pdf' : mimeFor(input.bytes, input.mime);
    const receipt = cached ?? receiptSchema.parse({ hash: hash(input.bytes), mime, retrievedAt: new Date().toISOString(),
      sourceId: snapshot.source.id, fingerprint: snapshot.source.fingerprint, origin: location });
    if (hash(input.bytes) !== receipt.hash) throw new MissingArtifact('Downloaded source does not match its receipt.');
    // The receipt must survive an interrupted Blob upload. A retry repairs missing bytes only by hash.
    await this.store.create(key, receipt);
    await this.store.retain(receipt.hash, input.bytes, receipt.mime);
    await this.store.create(`artifacts/${snapshot.source.fingerprint}.json`, { hash: receipt.hash, mime: receipt.mime, retrievedAt: receipt.retrievedAt });
    // A concurrent immutable create may have won. Use its bytes and retrieval time consistently.
    const retained = (await this.receipt(key, snapshot.source))!;
    return { receipt: retained, artifact: await this.restore(retained) };
  }

  async extract(snapshot: SourceSnapshot, zotero: Pick<Zotero, 'request'>, browser?: () => Promise<BrowserCapture>, generationId?: string): Promise<Extracted> {
    if (!snapshot.source.active || attachments(snapshot).length <= 1) return this.extractSingle(snapshot, zotero, browser);
    // Callers replaying historical captures without a generation keep their original single-file contract.
    const identity = hash(`${snapshot.source.id}:${snapshot.source.fingerprint}:${processingVersion}:attachments`);
    if (!generationId && !await this.store.read(`artifact-sets/${identity}.json`) && (await this.legacy(snapshot.source) || await this.published(snapshot.source))) return this.extractSingle(snapshot, zotero, browser);
    return this.extractMultiple(snapshot, zotero, browser, generationId);
  }

  private async extractMultiple(snapshot: SourceSnapshot, zotero: Pick<Zotero, 'request'>, browser?: () => Promise<BrowserCapture>, generationId?: string): Promise<Extracted> {
    const items = attachments(snapshot).sort((a, b) => preference(a) - preference(b) || a.key.localeCompare(b.key));
    const identity = generationId || hash(`${snapshot.source.id}:${snapshot.source.fingerprint}:${processingVersion}:attachments`);
    artifactHash.parse(identity);
    const key = `artifact-sets/${identity}.json`;
    const saved = await this.store.read(key);
    const selected = saved ? attachmentSetSchema.parse(saved) : undefined;
    if (selected && (selected.sourceId !== snapshot.source.id || selected.fingerprint !== snapshot.source.fingerprint)) throw new Error('Retained attachments belong to another source capture');
    const inputs: { receipt: Receipt; artifact: RetainedArtifact; result: Extracted; evidence: ExtractionArtifact }[] = [];
    const omissions = selected?.omissions.slice() || items.slice(sourceArtifactLimits.count).map(item => `${item.key}: attachment count limit reached.`);
    let size = 0;
    let missing: MissingArtifact | undefined;
    const parse = async (receipt: Receipt, artifact: RetainedArtifact, retainedEvidence?: ExtractionArtifact) => {
      size += artifact.bytes.length;
      if (size > sourceArtifactLimits.bytes) throw new Error('Retained attachment set exceeds byte limit');
      const attachmentKey = receipt.origin.kind === 'attachment' ? receipt.origin.key : undefined;
      const item = attachmentKey ? items.find(item => item.key === attachmentKey) : undefined;
      // A selected unsupported input cannot silently become evidence on a same-generation retry.
      let result: Extracted;
      if (retainedEvidence && !retainedEvidence.analyzed) result = { text: '', evidence: { status: retainedEvidence.status, method: retainedEvidence.method, reason: retainedEvidence.reason,
          truncated: retainedEvidence.truncated, retrievedAt: receipt.retrievedAt, artifactHash: receipt.hash, artifactMime: receipt.mime } } satisfies Extracted
      else {
        try { result = await extractArtifact(snapshot, artifact, browser); }
        catch { result = { text: '', evidence: { status: 'needs-review', method: receipt.mime === 'application/pdf' ? 'pdf-text' : receipt.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? 'docx-text' : 'none',
          reason: 'The retained attachment could not be parsed. Review the original file.', truncated: false,
          retrievedAt: receipt.retrievedAt, artifactHash: receipt.hash, artifactMime: receipt.mime } }; }
      }
      const evidence = retainedEvidence || extractionArtifactSchema.parse({ hash: receipt.hash, mime: receipt.mime, retrievedAt: receipt.retrievedAt,
        ...(item ? { key: item.key, title: String(item.data.title || item.data.filename || item.key).slice(0, 2000) } : {}),
        status: result.evidence.status, method: result.evidence.method, reason: result.evidence.reason, truncated: result.evidence.truncated,
        analyzed: ['text', 'image'].includes(result.evidence.status) });
      inputs.push({ receipt, artifact, result, evidence });
    };
    if (selected) {
      for (const input of selected.inputs) {
        if (input.receipt.sourceId !== snapshot.source.id || input.receipt.fingerprint !== snapshot.source.fingerprint || input.receipt.hash !== input.evidence.hash || input.receipt.mime !== input.evidence.mime) throw new Error('Retained attachment evidence does not match its receipt');
        await parse(input.receipt, await this.restore(input.receipt), input.evidence);
      }
    } else {
      // Preserve the successful original selected by older processing before expanding its capture.
      const prior = await this.receipt(this.selectionKey(snapshot.source.fingerprint), snapshot.source);
      if (prior) await this.restore(prior);
      for (const item of items.slice(0, sourceArtifactLimits.count)) {
        const available = sourceArtifactLimits.bytes - size;
        if (Number(item.data.filesize) > Math.min(maxBytes, available)) { omissions.push(`${item.key}: attachment byte limit reached.`); continue; }
        try {
          const input = await this.acquire(snapshot, item, zotero, snapshot.source.url, available);
          await parse(input.receipt, input.artifact);
        } catch (error) {
          if (error instanceof MissingArtifact) { missing = error; omissions.push(`${item.key}: synced file is unavailable.`); continue; }
          if (error instanceof AttachmentBudget) { omissions.push(`${item.key}: combined attachment byte limit reached.`); continue; }
          throw error;
        }
      }
    }
    const imageInputs = inputs.filter(input => input.evidence.analyzed && input.evidence.status === 'image');
    for (const input of imageInputs.slice(sourceImageLimits.count)) {
      input.evidence = { ...input.evidence, analyzed: false, reason: 'Source image count limit reached.' };
    }
    const useful = inputs.filter(input => input.evidence.analyzed);
    if (!useful.length && missing) throw missing;
    if (!inputs.length) return savedMetadata(snapshot, { status: 'needs-review', method: 'none', reason: omissions.join(' ').slice(0, 1000) || 'No synced attachment is available.',
      truncated: true, retrievedAt: new Date().toISOString(), artifactHash: null });
    const primary = useful[0] || inputs[0];
    let text: string;
    let images: Extracted['images'];
    let truncated = omissions.length > 0 || inputs.some(input => !input.evidence.analyzed || input.evidence.truncated);
    if (useful.length <= 1) {
      text = primary.result.text;
      images = primary.evidence.analyzed ? primary.result.images : undefined;
    } else {
      const textInputs = useful.filter(input => input.evidence.status === 'text');
      // Every readable file gets room. A long first PDF must not crowd out later attachments.
      const budget = Math.floor((sourceTextLimit - useful.length * 2400) / Math.max(1, textInputs.length));
      const sections = useful.map((input, index) => {
        const label = `Attachment ${input.evidence.key || index + 1}: ${input.evidence.title || input.receipt.mime}`;
        const content = input.evidence.status === 'image' ? `Source image ${imageInputs.indexOf(input) + 1}. Read visible content in the corresponding retained image.` : input.result.text.slice(0, budget);
        if (input.evidence.status === 'text' && content.length < input.result.text.length) { input.evidence.truncated = true; truncated = true; }
        return `${label}\n${content}`;
      });
      const caption = useful.find(input => input.evidence.status === 'image')?.result.text;
      if (caption) sections.push(`Saved Zotero description or caption\n${caption}`);
      text = sections.join('\n\n').slice(0, sourceTextLimit);
      images = useful.flatMap(input => input.result.images || []);
    }
    const artifacts = inputs.map(input => input.evidence);
    const failures = artifacts.filter(input => !input.analyzed).map(input => `${input.key || input.title || input.mime}: ${input.reason || 'not analyzed'}`);
    const reasons = [`Analyzed ${useful.length} of ${items.length} stored attachments.`, ...omissions, ...failures,
      ...useful.filter(input => input.evidence.truncated).map(input => `${input.evidence.key || input.receipt.mime}: only a bounded portion was analyzed.`)];
    if (images?.length) reasons.push('Visual interpretation uses retained images and is not a verified transcription.');
    const evidence: Note['extraction'] = { ...primary.result.evidence, status: useful.some(input => input.evidence.status === 'text') ? 'text' : images?.length ? 'image' : primary.result.evidence.status,
      method: useful.length > 1 ? 'combined' : primary.result.evidence.method, artifactHash: primary.receipt.hash, artifactMime: primary.receipt.mime,
      retrievedAt: primary.receipt.retrievedAt, artifacts, truncated, reason: reasons.join(' ').slice(0, 1000) };
    // Capture choices are immutable per generation, including unavailable siblings and bounded coverage.
    if (!selected) {
      await this.store.create(key, { sourceId: snapshot.source.id, fingerprint: snapshot.source.fingerprint,
        inputs: inputs.map(input => ({ receipt: input.receipt, evidence: input.evidence })), omissions: omissions.slice(0, 100) });
      if (useful.length) await this.store.create(this.selectionKey(snapshot.source.fingerprint), primary.receipt);
      const winner = attachmentSetSchema.parse(await this.store.read(key));
      if (canonical(winner.inputs) !== canonical(inputs.map(input => ({ receipt: input.receipt, evidence: input.evidence }))) || canonical(winner.omissions) !== canonical(omissions.slice(0, 100))) return this.extractMultiple(snapshot, zotero, browser, generationId);
    }
    const documents = inputs.flatMap(input => (input.result.documents || []).map(document => ({ ...document,
      ...(input.evidence.key ? { key: input.evidence.key, title: input.evidence.title } : {}) })));
    const result = useful.length ? withSavedCommentary(snapshot, { text, images: images?.length ? images : undefined, evidence }) : savedMetadata(snapshot, evidence);
    return { ...result, ...(documents.length ? { documents } : {}) };
  }

  private async extractSingle(snapshot: SourceSnapshot, zotero: Pick<Zotero, 'request'>, browser?: () => Promise<BrowserCapture>): Promise<Extracted> {
    const unavailable = { status: 'metadata-only' as const, method: 'none' as const, reason: null, truncated: false,
      retrievedAt: new Date().toISOString(), artifactHash: null };
    if (!snapshot.source.active) return { text: '', evidence: { ...unavailable, reason: 'Source is no longer in the observed library.' } };
    if (snapshot.root.data.itemType === 'note' && !attachments(snapshot).length) return savedMetadata(snapshot, unavailable);
    const selected = await this.receipt(this.selectionKey(snapshot.source.fingerprint), snapshot.source);
    const published = selected ? undefined : await this.published(snapshot.source);
    const cached = selected || published?.receipt || await this.legacy(snapshot.source);
    const items = attachments(snapshot).sort((a, b) => preference(a) - preference(b));
    const linkedUrl = [snapshot.root, ...snapshot.children].find(item => item.data.linkMode === 'linked_url' && httpUrl.safeParse(item.data.url).success)?.data.url as string | undefined;
    const url = snapshot.source.url || linkedUrl;
    const finish = async (input: { receipt: Receipt; artifact: RetainedArtifact }, useBrowser?: () => Promise<BrowserCapture>) => {
      const result = await extractArtifact(snapshot.source.url || !url ? snapshot : { ...snapshot, source: { ...snapshot.source, url } }, input.artifact, useBrowser);
      const attachmentKey = input.receipt.origin.kind === 'attachment' ? input.receipt.origin.key : undefined;
      const item = attachmentKey ? [snapshot.root, ...snapshot.children].find(item => item.key === attachmentKey) : undefined;
      const reference = extractionArtifactSchema.parse({ hash: input.receipt.hash, mime: result.evidence.artifactMime || input.receipt.mime,
        retrievedAt: input.receipt.retrievedAt, ...(attachmentKey ? { key: attachmentKey, title: String(item?.data.title || item?.data.filename || attachmentKey).slice(0, 2000) } : {}),
        status: result.evidence.status, method: result.evidence.method, reason: result.evidence.reason, truncated: result.evidence.truncated,
        analyzed: ['text', 'image'].includes(result.evidence.status) });
      result.evidence.artifacts = [reference];
      if (result.documents) result.documents = result.documents.map(document => ({ ...document, ...(attachmentKey ? { key: attachmentKey, title: reference.title } : {}) }));
      if (items.length > 1) {
        result.evidence.truncated = true;
        result.evidence.reason = `${result.evidence.reason ? result.evidence.reason + ' ' : ''}Analyzed one of ${items.length} stored attachments. Other attachments were not analyzed.`.slice(0, 1000);
      }
      if (['text', 'image'].includes(result.evidence.status)) {
        await this.store.create(this.selectionKey(snapshot.source.fingerprint), input.receipt);
        return withSavedCommentary(snapshot, result);
      }
      return result;
    };
    if (selected || published) return finish(published || { receipt: selected!, artifact: await this.restore(selected!) }, browser);
    let result: Extracted | undefined;
    // Retention failures propagate. Only missing cloud files permit trying another input.
    let missing: MissingArtifact | undefined;
    const initial = cached ? { receipt: cached, artifact: await this.restore(cached) } : undefined;
    if (initial) {
      result = await finish(initial, browser);
      if (['text', 'image'].includes(result.evidence.status)) return result;
    }
    for (const item of items.slice(0, 8)) {
      let input;
      try { input = await this.acquire(snapshot, item, zotero); }
      catch (error) { if (error instanceof MissingArtifact) { missing = error; continue; } throw error; }
      if (initial?.receipt.hash === input.receipt.hash) continue;
      const candidate = await finish(input, browser);
      if (['text', 'image'].includes(candidate.evidence.status)) return candidate;
      result ??= candidate;
    }
    if (url && !result) return finish(await this.acquire(snapshot, undefined, zotero, url), browser);
    if (missing) throw missing;
    if (result) return result;
    const linkedFile = [snapshot.root, ...snapshot.children].some(item => item.data.linkMode === 'linked_file');
    return savedMetadata(snapshot, { ...unavailable, ...(linkedFile ? { status: 'needs-review' as const } : {}),
      reason: linkedFile ? 'Linked files are local to Zotero desktop and cannot be downloaded from its cloud API. Save a synced attachment.' : 'No synced attachment or retrievable source URL.' });
  }

  /** Template analysis can pass its pinned source note here before parsing with extractArtifact.
   * Reads exactly extraction.artifactHash, never the latest selection or a live URL.
   * Generation identity stays with the pinned note. Returned bytes contain no caption or metadata text.
   * Legacy notes can name a retained screenshot even when their first-artifact record still names HTML.
   * For browser evidence the hash still names the original saved HTML, not the later rendered capture.
   */
  async readForNote(note: Pick<Note, 'source' | 'generationId' | 'extraction'>, selectedHash = note.extraction.artifactHash): Promise<RetainedArtifact | undefined> {
    const id = selectedHash;
    if (!id) return undefined;
    artifactHash.parse(id);
    artifactHash.parse(note.generationId);
    const raw = await this.store.readArtifact(id);
    if (!raw) throw new MissingArtifact('Pinned source artifact is unavailable.');
    const reference = noteArtifacts(note).find(artifact => artifact.hash === id);
    if (!reference) throw new Error('Artifact does not belong to the pinned source generation');
    if (id === note.extraction.artifactHash && note.extraction.artifactMime && mimeFor(raw.bytes, note.extraction.artifactMime) !== mimeFor(raw.bytes, reference.mime || raw.mime)) throw new Error('Pinned source MIME does not match its attachment record');
    const mime = reference.mime || raw.mime;
    // Older notes may lack artifactMime. Verify the raw Blob header rather than guessing from source metadata.
    return this.checked(raw, { hash: id, mime, retrievedAt: reference.retrievedAt });
  }
}
