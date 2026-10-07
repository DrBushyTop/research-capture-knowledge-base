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
import { pdfText } from './pdf-text.js';

export const maxBytes = 20 * 1024 * 1024;
export class MissingArtifact extends Error {}
export interface Extracted { text: string; images?: SourceImage[]; evidence: Note['extraction']; }
export interface RetainedArtifact { bytes: Uint8Array; mime: string; retrievedAt: string; }
export function savedMetadata(snapshot: SourceSnapshot, evidence: Note['extraction']): Extracted {
  const abstract = snapshot.root.data.abstractNote;
  if (typeof abstract !== 'string' || !abstract.trim()) return { text: '', evidence };
  const dom = new JSDOM(abstract.slice(0, 100_000));
  let text = '';
  try {
    for (const element of dom.window.document.querySelectorAll('script,style')) element.remove();
    text = dom.window.document.body.textContent?.trim() || '';
  } finally { dom.window.close(); }
  if (!text) return { text: '', evidence };
  return { text: text.slice(0, 60_000), evidence: { ...evidence, status: 'metadata-only', method: 'zotero-metadata', truncated: text.length > 60_000,
    reason: `${evidence.reason ? evidence.reason + ' ' : ''}Analysis uses the description or caption saved in Zotero. The original document or post text was unavailable.`.slice(0, 1000) } };
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
      timeout: 30_000
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
    const totalTimeout = setTimeout(() => request.destroy(new Error('Source download timed out')), 30_000);
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
    mime = response.headers.get('content-type') || String(attachment.data.contentType);
  }
  return { bytes, mime: String(attachment.data.contentType || mime) };
}

/** Parses one retained artifact. Selection and screenshot fallback belong to SourceArtifacts. */
export async function extractArtifact(snapshot: SourceSnapshot, artifact: RetainedArtifact, browser?: () => Promise<BrowserCapture>): Promise<Extracted> {
  const { bytes, mime } = artifact;
  const evidence: Note['extraction'] = { status: 'metadata-only', method: 'none', reason: null, truncated: false,
    retrievedAt: artifact.retrievedAt, artifactHash: hash(bytes), artifactMime: mime.split(';')[0] };
  let text = '';
  if (mime.includes('pdf') || Buffer.from(bytes.subarray(0, 5)).toString() === '%PDF-') {
    evidence.method = 'pdf-text';
    evidence.artifactMime = 'application/pdf';
    ({ text, truncated: evidence.truncated } = await pdfText(bytes));
  } else if (mime.includes('html')) {
    const dom = new JSDOM(Buffer.from(bytes).toString('utf8'), { url: snapshot.source.url || 'https://example.invalid' });
    try { text = new Readability(dom.window.document).parse()?.textContent?.trim() || ''; }
    finally { dom.window.close(); }
    evidence.method = 'html'; evidence.truncated = text.length > 60_000;
  } else if (mime.startsWith('text/') || mime === 'application/json') {
    text = Buffer.from(bytes).toString('utf8'); evidence.method = 'text'; evidence.truncated = text.length > 60_000;
  } else if (mime.startsWith('image/')) {
    let image: SourceImage;
    try { image = sourceImage(bytes, mime); }
    catch (error) {
      return savedMetadata(snapshot, { ...evidence, status: 'needs-review', reason: error instanceof Error ? error.message : 'Image cannot be analyzed.' });
    }
    const metadata = savedMetadata(snapshot, evidence);
    return { text: metadata.text, images: [image], evidence: { ...evidence, status: 'image', method: 'image-vision',
      reason: 'Analysis uses the retained image and any saved caption. Visual interpretation is generated, not a verified text transcription. The original page may contain material outside this image.' } };
  } else return savedMetadata(snapshot, { ...evidence, status: 'needs-review', reason: mime.startsWith('video/') ? 'Video analysis is not supported. Save a still screenshot as a PNG, JPEG or WebP attachment.' : 'Unsupported source format.' });
  if (mime.includes('html') && browser && browserCaptureNeeded(text, Buffer.from(bytes).toString('utf8'))) {
    try {
      const captured = await browser();
      if (captured.text.length >= 80 && captured.views.some(view => !browserCaptureNeeded(view.text, '') && view.text.trim().length >= 80)) return { text: `Capture coverage: ${captured.complete ? 'Agent finished bounded exploration' : 'Partial capture'} (${captured.stopReason}). ${captured.coverage}\n\n${captured.text}`.slice(0, 60_000), evidence: { ...evidence, status: 'text', method: 'browser', retrievedAt: captured.retrievedAt, truncated: !captured.complete,
        reason: `Live browser capture, not necessarily the page as originally saved. ${captured.views.length} views captured. ${captured.complete ? 'Agent finished exploration' : 'Partial capture'} (${captured.stopReason}). ${captured.coverage}`.slice(0, 1000) } };
    } catch { /* Keep the original artifact and honest extraction fallback if browser recovery fails. */ }
  }
  text = text.slice(0, 60_000).trim();
  if (text.length < 80) {
    return savedMetadata(snapshot, { ...evidence, status: 'needs-review', reason: evidence.method === 'html' ? 'No readable page text was extracted. The page may require sign-in or block capture. Automatic browser screenshots are not configured. Save a screenshot as a synced image attachment.' : 'No usable text layer. A scan may need OCR or manual review.' });
  }
  return { text, evidence: { ...evidence, status: 'text' } };
}
