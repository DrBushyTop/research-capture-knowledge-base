import { JSDOM } from 'jsdom';
import type { SourceSnapshot } from '../../../shared/corpus.js';
import { sourceTextLimit } from '../../../shared/source-text.js';

/** Normalize saved note HTML without executing source scripts or loading resources. */
export function savedHtml(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const dom = new JSDOM(value.slice(0, 200_000));
  let text = '';
  try {
    for (const element of dom.window.document.querySelectorAll('script,style')) element.remove();
    for (const element of dom.window.document.querySelectorAll('p,div,h1,h2,h3,h4,li,br')) element.append('\n');
    text = dom.window.document.body.textContent?.trim() || '';
  } finally { dom.window.close(); }
  return text;
}

/** Human capture notes and annotations keep their attachment and page references. */
export function savedCommentary(snapshot: SourceSnapshot) {
  const parts: string[] = [];
  const attachments = new Set([snapshot.root, ...snapshot.children].filter(item => item.data.itemType === 'attachment').map(item => item.key));
  for (const item of [snapshot.root, ...snapshot.children]) {
    const parent = item.data.itemType === 'attachment' ? item.key : item.data.parentItem;
    const attachment = typeof parent === 'string' && attachments.has(parent) ? `\nAttachment: ${parent}` : '';
    const note = savedHtml(item.data.note);
    if (note) parts.push(`Saved Zotero note ${item.key}${attachment}\nHuman commentary, separate from the original source.\n${note}`);
    if (item.data.itemType === 'annotation') {
      const quote = typeof item.data.annotationText === 'string' ? item.data.annotationText.trim().slice(0, 200_000) : '';
      const comment = typeof item.data.annotationComment === 'string' ? item.data.annotationComment.trim().slice(0, 200_000) : '';
      const page = typeof item.data.annotationPageLabel === 'string' ? item.data.annotationPageLabel.slice(0, 200) : '';
      if (quote || comment) parts.push(`Saved Zotero annotation ${item.key}${attachment}${page ? '\nPage: ' + page : ''}${quote ? '\nHighlighted text: ' + quote : ''}${comment ? '\nHuman comment: ' + comment : ''}`);
    }
    if (parts.reduce((length, part) => length + part.length, 0) > sourceTextLimit) break;
  }
  return parts.join('\n\n');
}
