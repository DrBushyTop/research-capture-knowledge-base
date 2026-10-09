import { crc32 } from 'node:zlib';
import { JSDOM } from 'jsdom';
import mammoth from 'mammoth';
import { fromBufferPromise } from 'yauzl';
import { sourceTextLimit } from './pdf-text.js';
import { documentTextLimits } from '../../../shared/document-text.js';
import { docxMime } from './source-artifact-reader.js';

export { docxMime, docxCandidate } from './source-artifact-reader.js';
export const docxByteLimit = 40 * 1024 * 1024;
export const docxExpandedByteLimit = 80 * 1024 * 1024;
export const docxXmlByteLimit = 16 * 1024 * 1024;
export const docxEntryLimit = 2000;
const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function wordParagraphs(element: Element) {
  return [...element.getElementsByTagNameNS(wordNamespace, 'p')].map(paragraph => {
    const parts: string[] = [];
    for (const node of paragraph.getElementsByTagNameNS(wordNamespace, '*')) {
      if (node.localName === 't') parts.push(node.textContent || '');
      if (['tab', 'br', 'cr'].includes(node.localName)) parts.push(' ');
    }
    return parts.join('').trim();
  }).filter(Boolean).join('\n\n');
}

function additionalText(value: string, name: string) {
  const dom = new JSDOM(value, { contentType: 'application/xml' });
  try {
    if (name === 'word/comments.xml') return [...dom.window.document.getElementsByTagNameNS(wordNamespace, 'comment')].map(comment => {
      const id = comment.getAttributeNS(wordNamespace, 'id') || '';
      const author = comment.getAttributeNS(wordNamespace, 'author') || '';
      return { locator: `Human document comment ${id}${author ? ` by ${author.slice(0, 200)}` : ''}`, text: wordParagraphs(comment) };
    }).filter(section => section.text);
    return [{ locator: `DOCX running ${name.includes('header') ? 'header' : 'footer'} ${name.split('/').pop()}`, text: wordParagraphs(dom.window.document.documentElement) }].filter(section => section.text);
  } finally { dom.window.close(); }
}

/** Validate actual expansion, not just ZIP metadata, before Mammoth reads the same archive. */
async function validatePackage(bytes: Uint8Array) {
  if (bytes.length > docxByteLimit) throw new Error('DOCX exceeds the 40 MiB file limit.');
  const zip = await fromBufferPromise(Buffer.from(bytes), { validateEntrySizes: true, strictFileNames: true });
  let expanded = 0;
  let declared = 0;
  let contentTypes = '';
  let omittedContent = false;
  const textParts: { locator: string; text: string }[] = [];
  const paths = new Set<string>();
  try {
    if (zip.entryCount > docxEntryLimit) throw new Error('DOCX exceeds the 2000 archive-entry limit.');
    for await (const entry of zip.eachEntry()) {
      if (paths.has(entry.fileName) || entry.fileName.includes('\0')) throw new Error('DOCX contains duplicate or invalid archive paths.');
      paths.add(entry.fileName);
      if (entry.isEncrypted() || !entry.canDecodeFileData()) throw new Error('DOCX contains encrypted or unsupported archive entries.');
      const xml = /\.(xml|rels)$/i.test(entry.fileName);
      declared += entry.uncompressedSize;
      if (declared > docxExpandedByteLimit || (xml && entry.uncompressedSize > docxXmlByteLimit)) throw new Error('DOCX exceeds the archive expansion limit.');
      if (entry.fileName.endsWith('/')) continue;
      if (/^word\/(media|charts|embeddings)\//.test(entry.fileName)) omittedContent = true;
      const stream = await zip.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      let size = 0;
      let checksum = 0;
      try {
        for await (const chunk of stream) {
          const data = Buffer.from(chunk);
          size += data.length;
          expanded += data.length;
          if (expanded > docxExpandedByteLimit || (xml && size > docxXmlByteLimit)) throw new Error('DOCX exceeds the archive expansion limit.');
          checksum = crc32(data, checksum);
          if (xml) chunks.push(data);
        }
      } finally { stream.destroy(); }
      if (checksum !== entry.crc32) throw new Error('DOCX contains a corrupt archive entry.');
      if (xml) {
        const value = Buffer.concat(chunks).toString('utf8');
        if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(value.replaceAll('\0', ''))) throw new Error('DOCX XML document declarations are not supported.');
        if (entry.fileName === '[Content_Types].xml') contentTypes = value;
        if (/^word\/(header|footer)\d*\.xml$/.test(entry.fileName) || entry.fileName === 'word/comments.xml') textParts.push(...additionalText(value, entry.fileName));
      }
    }
    // JSZip can read central entries beyond the advertised count. They must not bypass our validation.
    const cursor = Number(zip.readEntryCursor);
    if (bytes.length >= cursor + 4 && Buffer.from(bytes).readUInt32LE(cursor) === 0x02014b50) throw new Error('DOCX has an inconsistent archive-entry count.');
    if (!paths.has('word/document.xml') || !contentTypes) throw new Error('The archive is not a DOCX document.');
    const dom = new JSDOM(contentTypes, { contentType: 'application/xml' });
    try {
      const main = [...dom.window.document.getElementsByTagNameNS('*', 'Override')].find(element => element.getAttribute('PartName') === '/word/document.xml');
      if (main?.getAttribute('ContentType') !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml') throw new Error('Only DOCX documents are supported by the Word extractor.');
    } finally { dom.window.close(); }
    return { omittedContent, textParts };
  } finally { zip.close(); }
}

/** Preserve semantic headings, lists and table cells without loading HTML resources. */
function readableText(html: string) {
  const dom = new JSDOM(html);
  let text = '';
  let textBytes = 0;
  let truncated = false;
  const starts = [{ offset: 0, locator: 'DOCX document' }];
  const append = (value: string) => {
    const bytes = Buffer.byteLength(value);
    if (textBytes + bytes > documentTextLimits.originalBytes) {
      truncated = true;
      const available = Math.max(0, documentTextLimits.originalBytes - textBytes);
      let end = Math.min(value.length, available);
      while (Buffer.byteLength(value.slice(0, end)) > available) end = Math.floor(end * 0.9);
      text += value.slice(0, end);
      return;
    }
    text += value;
    textBytes += bytes;
  };
  const visit = (node: Node) => {
    if (truncated) return;
    if (node.nodeType === 3) { append(node.textContent || ''); return; }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (['img', 'script', 'style'].includes(tag)) return;
    if (tag === 'table') {
      const rows = [...element.querySelectorAll('tr')].filter(row => row.closest('table') === element);
      for (const [i, row] of rows.entries()) {
        const cells = [...row.children].filter(cell => ['td', 'th'].includes(cell.tagName.toLowerCase()));
        if (!cells.length) continue;
        const values = cells.map(cell => {
          const copy = cell.cloneNode(true) as Element;
          for (const block of copy.querySelectorAll('p,br,li')) block.append(' ');
          return (copy.textContent || '').trim().replace(/\s+/g, ' ').replaceAll('|', '\\|');
        });
        append(`${i ? '' : '\n\n'}| ${values.join(' | ')} |\n`);
        if (i === 0) append(`| ${cells.map(() => '---').join(' | ')} |\n`);
        if (truncated) break;
      }
      append('\n');
      return;
    }
    if (/^h[1-6]$/.test(tag)) {
      starts.push({ offset: text.length, locator: `DOCX section ${starts.length}: ${(element.textContent || '').trim().slice(0, 300)}` });
      append(`\n\n${'#'.repeat(Number(tag[1]))} `);
    }
    if (tag === 'p') append('\n\n');
    if (tag === 'li') append(`\n${element.parentElement?.tagName.toLowerCase() === 'ol' ? `${[...element.parentElement.children].indexOf(element) + 1}.` : '-'} `);
    if (tag === 'br') append('\n');
    for (const child of element.childNodes) visit(child);
    if (/^h[1-6]$/.test(tag) || ['p', 'ol', 'ul'].includes(tag)) append('\n\n');
  };
  try {
    for (const child of dom.window.document.body.childNodes) visit(child);
    const sections = starts.map((start, index) => ({ locator: start.locator, text: text.slice(start.offset, starts[index + 1]?.offset ?? text.length).replace(/\n{3,}/g, '\n\n').trim() })).filter(section => section.text);
    for (const [index, section] of sections.entries()) if (index < sections.length - 1) section.text += '\n\n';
    return { text: sections.map(section => section.text).join(''), sections, truncated };
  } finally { dom.window.close(); }
}

/** DOCX-native extraction. Embedded images and page layout remain in the retained original. */
export async function docxText(bytes: Uint8Array) {
  const validated = await validatePackage(bytes);
  let omitted = validated.omittedContent;
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) }, {
    externalFileAccess: false,
    includeEmbeddedStyleMap: false,
    convertImage: mammoth.images.imgElement(async () => { omitted = true; return { src: '' }; })
  });
  const extracted = readableText(result.value);
  let fullBytes = Buffer.byteLength(extracted.text);
  let fullLimit = extracted.truncated;
  for (const part of validated.textParts) {
    const text = `\n\n### ${part.locator}\n\n${part.text}`;
    if (fullBytes + Buffer.byteLength(text) > documentTextLimits.originalBytes) { fullLimit = true; break; }
    extracted.sections.push({ locator: part.locator, text });
    fullBytes += Buffer.byteLength(text);
  }
  const fullText = extracted.sections.map(section => section.text).join('');
  const messages = result.messages.filter(message => message.type === 'error' || message.type === 'warning');
  const reason = [
    'DOCX text extraction preserves headings, paragraphs, lists and table text. It does not preserve page layout.',
    omitted ? 'Embedded images, charts or objects were not analyzed.' : '',
    fullLimit ? 'Full DOCX text reached the 40 MiB extraction safeguard. Some text was omitted.' : '',
    messages.length ? `The converter reported ${messages.length} warnings or errors. Some document content may be omitted.` : ''
  ].filter(Boolean).join(' ');
  return { text: fullText.slice(0, sourceTextLimit), truncated: fullLimit || omitted || messages.length > 0 || fullText.length > sourceTextLimit, reason,
    sections: extracted.sections, complete: !fullLimit && !omitted && messages.length === 0 };
}
