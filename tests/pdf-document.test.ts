import { expect, it } from 'vitest';
import { pdfDocumentText } from '../apps/worker/src/pdf-text.js';
import { pdfFixture } from './pdf-fixture.js';

it('retains native text beyond the analysis page limit with exact page locators', async () => {
  const result = await pdfDocumentText(pdfFixture(Array.from({ length: 451 }, (_, index) =>
    `BT /F1 12 Tf 50 700 Td (Page ${index + 1}: Synthetic evidence remains available even outside a bounded analysis.) Tj ET`)));
  expect(result.complete).toBe(true);
  expect(result.totalPages).toBe(451);
  expect(result.sections).toHaveLength(451);
  expect(result.sections.at(-1)).toMatchObject({ locator: 'PDF page 451', page: 451 });
  expect(result.sections.at(-1)?.text).toContain('Page 451:');
});

it('reports missing native text without implicitly enabling OCR', async () => {
  const result = await pdfDocumentText(pdfFixture(['', 'BT /F1 12 Tf 50 700 Td (Only a short label) Tj ET']));
  expect(result.complete).toBe(false);
  expect(result.reason).toContain('OCR is disabled');
  expect(result.sections[0].text).toBe('');
});

it('rejects malformed PDF bytes through the isolated parser', async () => {
  await expect(pdfDocumentText(Buffer.from('%PDF-1.7\nbroken'))).rejects.toThrow('PDF full-text parsing failed');
});
