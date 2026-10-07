import { expect, it } from 'vitest';
import { pdfPageLimit, pdfText, sourceTextLimit } from '../apps/worker/src/pdf-text.js';
import { pdfFixture } from './pdf-fixture.js';

it('reports incomplete coverage when a PDF exceeds the page limit', async () => {
  const pages = Array.from({ length: pdfPageLimit + 1 }, (_, i) =>
    `BT /F1 12 Tf 50 400 Td (Page ${i + 1}: Synthetic evidence describes observations and methods in a native PDF text layer.) Tj ET`);
  const result = await pdfText(pdfFixture(pages));
  expect(result.truncated).toBe(true);
  expect(result.text).toContain('<!-- PDF page 200 -->');
  expect(result.text).not.toContain('<!-- PDF page 201 -->');
});

it('caps retained Markdown at the source text limit and marks it truncated', async () => {
  const dense = Array.from({ length: 45 }, (_, i) =>
    `BT /F1 10 Tf 50 ${750 - i * 15} Td (Line ${i}: ${'synthetic evidence '.repeat(6)}) Tj ET`).join('\n');
  const result = await pdfText(pdfFixture(Array(15).fill(dense)));
  expect(result.text.length).toBeLessThanOrEqual(sourceTextLimit);
  expect(result.text.length).toBeGreaterThan(sourceTextLimit - 10);
  expect(result.truncated).toBe(true);
});

it('does not let page markers turn blank or sparse PDFs into usable evidence', async () => {
  for (const pages of [Array(10).fill(''), ['BT /F1 12 Tf 50 700 Td (Short label) Tj ET']]) {
    expect(await pdfText(pdfFixture(pages))).toEqual({ text: '', truncated: false });
  }
});

it('rejects malformed PDFs rather than returning fabricated text', async () => {
  await expect(pdfText(Buffer.from('%PDF-1.7\nbroken'))).rejects.toThrow();
});

it('keeps both columns in reading order instead of interleaving their lines', async () => {
  const result = await pdfText(pdfFixture([`
BT /F2 24 Tf 50 750 Td (Synthetic two-column report) Tj ET
BT /F1 10 Tf 50 700 Td (Left opening describes the study.) Tj ET
BT /F1 10 Tf 320 700 Td (Right opening describes results.) Tj ET
BT /F1 10 Tf 50 685 Td (Left continuation describes methods.) Tj ET
BT /F1 10 Tf 320 685 Td (Right continuation describes findings.) Tj ET
BT /F1 10 Tf 50 670 Td (Left ending describes participants.) Tj ET
BT /F1 10 Tf 320 670 Td (Right ending describes limitations.) Tj ET`]));
  expect(result.text.indexOf('Left ending')).toBeLessThan(result.text.indexOf('Right opening'));
  expect(result.text).toContain('Right ending');
});
