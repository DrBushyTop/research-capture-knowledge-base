import { LiteParse } from '@llamaindex/liteparse';

// The pinned batch API invokes native parsing directly. The parent enforces a hard deadline.
process.once('message', async ({ bytes, pageLimit, textByteLimit }) => {
  const parser = new LiteParse({ ocrEnabled: false, outputFormat: 'markdown', imageMode: 'off', extractImages: false,
    extractLinks: false, keepHeadersFooters: true, maxPages: pageLimit, continueOnPageError: false, quiet: true });
  let size = 0;
  let totalPages = 0;
  let complete = true;
  let emptyPages = 0;
  let reason;
  const send = message => new Promise((resolve, reject) => process.send(message, error => error ? reject(error) : resolve()));
  try {
    for await (const batch of parser.parseBatches(bytes, { batchSize: 20 })) {
      totalPages = batch.totalPages;
      const sections = [];
      let readableLength = 0;
      for (const page of batch.result.pages) {
        const nativeText = page.text.trim();
        const text = nativeText ? page.markdown.trim() || nativeText : '';
        const length = Buffer.byteLength(text) + 2;
        if (size + length > textByteLimit) {
          complete = false;
          reason = 'PDF full-text extraction reached its 40 MiB text guard. Some pages remain unavailable.';
          break;
        }
        size += length;
        readableLength += nativeText.length;
        if (!nativeText) emptyPages++;
        sections.push({ locator: `PDF page ${page.pageNum}`, page: page.pageNum, text });
      }
      await send({ type: 'pages', sections, totalPages, readableLength });
      if (!complete) break;
    }
    const reasons = [reason];
    if (totalPages > pageLimit) {
      complete = false;
      reasons.push(`PDF full-text extraction reached its ${pageLimit}-page guard. Later pages remain unavailable.`);
    }
    if (emptyPages) {
      complete = false;
      reasons.push(`${emptyPages} PDF pages had no native text. OCR is disabled.`);
    }
    await send({ type: 'done', complete, totalPages, reason: reasons.filter(Boolean).join(' ') || undefined });
  } catch {
    await send({ type: 'error', reason: 'PDF full-text parsing failed. The retained original remains available.' });
  } finally {
    parser.close();
    process.disconnect();
  }
});
