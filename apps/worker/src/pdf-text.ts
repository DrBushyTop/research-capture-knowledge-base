import { LiteParse } from '@llamaindex/liteparse';
import { fork } from 'node:child_process';
import { sourceTextLimit } from '../../../shared/source-text.js';

export const pdfPageLimit = 400;
export { sourceTextLimit };
export const retainedPdfPageLimit = 2000;
export interface PdfDocumentText {
  sections: { locator: string; text: string; page: number }[];
  complete: boolean;
  reason?: string;
  totalPages?: number;
  readableLength: number;
}

/** Batch parsing lives in a killable process. LiteParse's batch API bypasses its own pool. */
export async function pdfDocumentText(bytes: Uint8Array): Promise<PdfDocumentText> {
  return new Promise((resolve, reject) => {
    const worker = fork(new URL('./pdf-document-worker.mjs', import.meta.url), {
      serialization: 'advanced', execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    });
    const sections: PdfDocumentText['sections'] = [];
    let totalPages: number | undefined;
    let readableLength = 0;
    let finished = false;
    const finish = (result?: PdfDocumentText, error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      worker.kill('SIGKILL');
      if (error) reject(error); else resolve(result!);
    };
    const partial = (reason: string) => finish({ sections, readableLength, totalPages, complete: false, reason });
    const deadline = setTimeout(() => partial('PDF full-text extraction exceeded its two-minute deadline. Some pages remain unavailable.'), 120_000);
    worker.on('error', error => finish(undefined, error));
    worker.on('exit', () => { if (!finished) finish(undefined, new Error('PDF full-text parser stopped before recording its result.')); });
    worker.on('message', (input: unknown) => {
      const message = input as { type: string; sections?: PdfDocumentText['sections']; totalPages?: number; readableLength?: number; complete?: boolean; reason?: string };
      if (message.type === 'pages') {
        sections.push(...message.sections!);
        totalPages = message.totalPages;
        readableLength += message.readableLength || 0;
      } else if (message.type === 'done') {
        finish({ sections, readableLength, totalPages: message.totalPages || totalPages, complete: !!message.complete, reason: message.reason });
      } else if (message.type === 'error') {
        if (sections.length) partial(message.reason || 'Some PDF pages could not be parsed.');
        else finish(undefined, new Error(message.reason || 'PDF full-text parsing failed.'));
      }
    });
    worker.send({ bytes, pageLimit: retainedPdfPageLimit, textByteLimit: 40 * 1024 * 1024 });
  });
}

/** Native text only. Scans still require review rather than an implicit OCR call. */
export async function pdfText(bytes: Uint8Array) {
  const parser = new LiteParse({
    ocrEnabled: false,
    outputFormat: 'markdown',
    imageMode: 'off',
    extractImages: false,
    extractLinks: false,
    keepHeadersFooters: false,
    maxPages: pdfPageLimit,
    continueOnPageError: false,
    quiet: true,
    poolSize: 1,
    parseTimeoutMs: 120_000
  });
  try {
    const result = await parser.parse(bytes);
    let text = '';
    let readableLength = 0;
    let truncated = result.totalPages > pdfPageLimit;
    for (const page of result.pages) {
      const nativeText = page.text.trim();
      if (!nativeText) continue;
      const markdown = page.markdown.trim();
      if (!markdown) continue;
      const section = `${text ? '\n\n' : ''}<!-- PDF page ${page.pageNum} -->\n\n${markdown}`;
      if (text.length + section.length > sourceTextLimit) {
        text += section.slice(0, sourceTextLimit - text.length);
        readableLength += nativeText.slice(0, sourceTextLimit - readableLength).length;
        truncated = true;
        break;
      }
      text += section;
      readableLength += nativeText.length;
    }
    // Neither page markers nor Markdown fences establish a usable text layer.
    return { text: readableLength >= 80 ? text.trim() : '', truncated };
  } finally { parser.close(); }
}
