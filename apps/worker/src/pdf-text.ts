import { LiteParse } from '@llamaindex/liteparse';

export const pdfPageLimit = 200;
export const sourceTextLimit = 60_000;

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
    parseTimeoutMs: 60_000
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
