import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import ipaddr from 'ipaddr.js';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { hash, type SourceSnapshot, type Note, type ZoteroItem } from '../../../shared/corpus.js';
import type { Zotero } from './zotero.js';
import { browserCaptureNeeded, type BrowserCapture } from './browser-capture.js';
import { sourceImage, type SourceImage } from './image-input.js';
import { pdfDocumentText, pdfPageLimit, sourceTextLimit } from './pdf-text.js';
import { docxCandidate, docxMime, docxText } from './docx-text.js';
import type { DocumentTextInput } from '../../../shared/document-text.js';
import { createHash } from 'node:crypto';
import { savedCommentary, savedHtml } from './capture-commentary.js';

export const maxBytes = 40 * 1024 * 1024;
export class MissingArtifact extends Error {}
export interface Extracted { text: string; images?: SourceImage[]; documents?: DocumentTextInput[]; evidence: Note['extraction']; }
export interface RetainedArtifact { bytes: Uint8Array; mime: string; retrievedAt: string; }
export function withSavedCommentary(snapshot: SourceSnapshot, extracted: Extracted): Extracted {
  const commentary = savedCommentary(snapshot);
  if (!commentary) return extracted;
  const label = extracted.evidence.method === 'image-vision' ? 'Saved Zotero description or caption' : 'Original source evidence';
  const original = extracted.text ? `${label}\n${extracted.text}` : '';
  const commentaryLimit = original && snapshot.root.data.itemType !== 'note' ? 20_000 : sourceTextLimit;
  const saved = commentary.slice(0, commentaryLimit);
  const originalLimit = sourceTextLimit - saved.length - (original ? 2 : 0);
  const text = [original.slice(0, Math.max(0, originalLimit)), saved].filter(Boolean).join('\n\n');
  const sourceCut = original.length > originalLimit;
  const commentaryCut = commentary.length > commentaryLimit;
  const reason = [extracted.evidence.reason,
    sourceCut ? 'Original source text was truncated to include saved notes and annotations.' : '',
    commentaryCut ? `Saved notes and annotations were limited to the first ${commentaryLimit} characters.` : ''
  ].filter(Boolean).join(' ');
  return { ...extracted, text, evidence: { ...extracted.evidence, reason: reason ? reason.slice(0, 1000) : null, truncated: extracted.evidence.truncated || sourceCut || commentaryCut } };
}
export function savedMetadata(snapshot: SourceSnapshot, evidence: Note['extraction']): Extracted {
  const abstract = savedHtml(snapshot.root.data.abstractNote);
  const commentary = savedCommentary(snapshot);
  const standalone = snapshot.root.data.itemType === 'note';
  const text = [abstract, commentary].filter(Boolean).join('\n\n');
  if (!text) return { text: '', evidence };
  return { text: text.slice(0, sourceTextLimit), evidence: { ...evidence, status: 'metadata-only', method: 'zotero-metadata', truncated: text.length > sourceTextLimit,
    ...(standalone ? { status: 'text' as const, method: 'text' as const } : {}),
    reason: `${evidence.reason ? evidence.reason + ' ' : ''}${standalone ? 'Analysis uses the standalone note saved in Zotero.' : `Analysis uses the description or caption${commentary ? ' and saved notes or annotations' : ''} saved in Zotero. The original document or post text was unavailable.`}`.slice(0, 1000) } };
}
export function publicAddress(address: string) {
  let parsed = ipaddr.parse(address);
  if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) parsed = (parsed as ipaddr.IPv6).toIPv4Address();
  return parsed.range() === 'unicast';
}
export async function downloadPublic(input: string, redirects = 0): Promise<{ bytes: Uint8Array; mime: string }> {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port)) || redirects > 5) throw new Error('Unsafe source destination');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = ipaddr.isValid(hostname) ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv4' ? 4 : 6 }] : await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('Non-public source destination');
  // Pin the validated address to the socket; a second DNS lookup cannot rebind it.
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.get(url, {
      headers: { 'User-Agent': 'ResearchKnowledgeBase/1.0', Accept: 'text/html,application/pdf;q=0.9,*/*;q=0.1' },
      family: addresses[0].family, lookup: (_host, _options, callback) => callback(null, addresses[0].address, addresses[0].family),
      timeout: 60_000
    }, async response => {
      try {
        if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
          const target = response.headers.location;
          response.resume();
          if (!target) throw new Error('Missing redirect target');
          resolve(await downloadPublic(new URL(target, url).href, redirects + 1)); return;
        }
        if (response.statusCode !== 200) { response.resume(); throw new Error(`Source HTTP ${response.statusCode}`); }
        if (Number(response.headers['content-length']) > maxBytes) { response.destroy(); throw new Error('Source exceeds byte limit'); }
        const chunks: Buffer[] = []; let length = 0;
        for await (const chunk of response) {
          const bytes = Buffer.from(chunk); length += bytes.length;
          if (length > maxBytes) { response.destroy(); throw new Error('Source exceeds byte limit'); }
          chunks.push(bytes);
        }
        resolve({ bytes: Buffer.concat(chunks), mime: String(response.headers['content-type'] || '').split(';')[0] });
      } catch (error) { reject(error); }
    });
    request.on('timeout', () => request.destroy(new Error('Source request timed out')));
    request.on('error', reject);
    const totalTimeout = setTimeout(() => request.destroy(new Error('Source download timed out')), 60_000);
    request.on('close', () => clearTimeout(totalTimeout));
  });
}
async function boundedResponse(response: Response) {
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('Source exceeds byte limit'); }
  if (!response.body) throw new MissingArtifact('Synced source file is unavailable');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const result = await reader.read(); if (result.done) break;
      size += result.value.length;
      if (size > maxBytes) throw new Error('Source exceeds byte limit');
      chunks.push(result.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(chunks);
}
export async function downloadAttachment(attachment: ZoteroItem, zotero: Pick<Zotero, 'request'>) {
  let response: Response;
  try { response = await zotero.request(`items/${attachment.key}/file`); }
  catch { throw new MissingArtifact('The synced attachment is not available yet.'); }
  let bytes: Uint8Array; let mime: string;
  if ([302, 303].includes(response.status)) {
    const location = response.headers.get('location'); await response.body?.cancel();
    if (!location || new URL(location).protocol !== 'https:') throw new Error('Invalid source-file redirect');
    ({ bytes, mime } = await downloadPublic(location)); // No API key follows the redirect.
  } else {
    if (response.status !== 200) { await response.body?.cancel(); throw new MissingArtifact('The synced attachment is not available yet.'); }
    bytes = await boundedResponse(response);
    mime = response.headers.get('content-type') || String(attachment.data.contentType || 'application/octet-stream');
  }
  const md5 = attachment.data.md5;
  if (typeof md5 === 'string' && /^[a-f0-9]{32}$/i.test(md5) && createHash('md5').update(bytes).digest('hex') !== md5.toLowerCase()) throw new MissingArtifact('The cloud file does not match the saved attachment version. It may need Zotero or WebDAV file sync.');
  return { bytes, mime: String(attachment.data.contentType || mime || 'application/octet-stream') };
}

/** Parses one retained artifact. Selection and screenshot fallback belong to SourceArtifacts. */
export async function extractArtifact(snapshot: SourceSnapshot, artifact: RetainedArtifact, browser?: () => Promise<BrowserCapture>): Promise<Extracted> {
  const { bytes, mime } = artifact;
  const evidence: Note['extraction'] = { status: 'metadata-only', method: 'none', reason: null, truncated: false,
    retrievedAt: artifact.retrievedAt, artifactHash: hash(bytes), artifactMime: mime.split(';')[0] };
  let text = '';
  let documents: DocumentTextInput[] | undefined;
  if (mime.includes('html') && bytes[0] === 0x50 && bytes[1] === 0x4b) return savedMetadata(snapshot, { ...evidence, status: 'needs-review', reason: 'Compressed HTML snapshots are not supported. Save a single-file HTML snapshot.' });
  if (docxCandidate(bytes, mime)) {
    evidence.method = 'docx-text';
    evidence.artifactMime = docxMime;
    try {
      const extracted = await docxText(bytes);
      text = extracted.text;
      evidence.truncated = extracted.truncated;
      evidence.reason = extracted.reason;
      documents = [{ hash: evidence.artifactHash!, mime: docxMime, sections: extracted.sections, complete: extracted.complete, reason: extracted.reason }];
    } catch (error) {
      return savedMetadata(snapshot, { ...evidence, status: 'needs-review', reason: `DOCX text extraction failed. ${error instanceof Error ? error.message : 'The document could not be read.'}`.slice(0, 1000) });
    }
  } else if (mime.includes('pdf') || Buffer.from(bytes.subarray(0, 5)).toString() === '%PDF-') {
    evidence.method = 'pdf-text';
    evidence.artifactMime = 'application/pdf';
    const extracted = await pdfDocumentText(bytes);
    const preview = extracted.sections.filter(section => section.page <= pdfPageLimit).map(section => `<!-- PDF page ${section.page} -->\n\n${section.text}`).join('\n\n');
    text = extracted.readableLength >= 80 ? preview : '';
    const previewLimited = (extracted.totalPages ?? 0) > pdfPageLimit || preview.length > sourceTextLimit;
    evidence.truncated = !extracted.complete || previewLimited;
    evidence.reason = [extracted.reason, previewLimited ? `Analysis uses a preview limited to ${pdfPageLimit} PDF pages and ${sourceTextLimit} characters. Full extracted text is retained separately for reading and search.` : ''].filter(Boolean).join(' ') || null;
    documents = [{ hash: evidence.artifactHash!, mime: 'application/pdf', sections: extracted.sections.map(section => ({ ...section, text: section.text + '\n\n' })),
      complete: extracted.complete && extracted.readableLength >= 80, ...(extracted.reason ? { reason: extracted.reason } : {}), totalPages: extracted.totalPages }];
  } else if (mime.includes('html')) {
    const dom = new JSDOM(Buffer.from(bytes).toString('utf8'), { url: snapshot.source.url || 'https://example.invalid' });
    try { text = new Readability(dom.window.document).parse()?.textContent?.trim() || ''; }
    finally { dom.window.close(); }
    evidence.method = 'html'; evidence.truncated = text.length > sourceTextLimit;
    documents = [{ hash: evidence.artifactHash!, mime: evidence.artifactMime!, sections: [{ locator: 'Saved HTML document', text }], complete: true }];
  } else if (mime.startsWith('text/') || mime === 'application/json') {
    text = Buffer.from(bytes).toString('utf8'); evidence.method = 'text'; evidence.truncated = text.length > sourceTextLimit;
    documents = [{ hash: evidence.artifactHash!, mime: evidence.artifactMime!, sections: [{ locator: 'Saved text document', text }], complete: true }];
  } else if (mime.startsWith('image/')) {
    let image: SourceImage;
    try { image = sourceImage(bytes, mime); }
    catch (error) {
      return savedMetadata(snapshot, { ...evidence, status: 'needs-review', reason: error instanceof Error ? error.message : 'Image cannot be analyzed.' });
    }
    const caption = savedHtml(snapshot.root.data.abstractNote);
    return { text: caption.slice(0, sourceTextLimit), images: [image], evidence: { ...evidence, status: 'image', method: 'image-vision', truncated: caption.length > sourceTextLimit,
      reason: 'Analysis uses the retained image and any saved caption. Visual interpretation is generated, not a verified text transcription. The original page may contain material outside this image.' } };
  } else return savedMetadata(snapshot, { ...evidence, status: 'needs-review', reason: mime.startsWith('video/') ? 'Video analysis is not supported. Save a still screenshot as a PNG, JPEG or WebP attachment.' : `Analysis of ${mime} files is not supported. The original is retained for review.` });
  if (mime.includes('html') && browser && browserCaptureNeeded(text, Buffer.from(bytes).toString('utf8'))) {
    try {
      const captured = await browser();
      if (captured.text.length >= 80 && captured.views.some(view => !browserCaptureNeeded(view.text, '') && view.text.trim().length >= 80)) return { text: `Capture coverage: ${captured.complete ? 'Agent finished bounded exploration' : 'Partial capture'} (${captured.stopReason}). ${captured.coverage}\n\n${captured.text}`.slice(0, sourceTextLimit), evidence: { ...evidence, status: 'text', method: 'browser', retrievedAt: captured.retrievedAt, truncated: !captured.complete,
        reason: `Live browser capture, not necessarily the page as originally saved. ${captured.views.length} views captured. ${captured.complete ? 'Agent finished exploration' : 'Partial capture'} (${captured.stopReason}). ${captured.coverage}`.slice(0, 1000) } };
    } catch { /* Keep the original artifact and honest extraction fallback if browser recovery fails. */ }
  }
  text = text.slice(0, sourceTextLimit).trim();
  if (text.length < 80) {
    return { ...savedMetadata(snapshot, { ...evidence, status: 'needs-review', reason: evidence.method === 'html' ? 'No readable page text was extracted. The page may require sign-in or block capture. Automatic browser screenshots are not configured. Save a screenshot as a synced image attachment.' : evidence.method === 'docx-text' ? 'No usable document text was extracted. Embedded DOCX images are not analyzed.' : 'No usable text layer. A scan may need OCR or manual review.' }), ...(documents ? { documents } : {}) };
  }
  return { text, ...(documents ? { documents } : {}), evidence: { ...evidence, status: 'text' } };
}
