/** Born-digital synthetic PDF. No third-party document content or network access. */
export function pdfFixture(pages: string[]) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    ...pages.flatMap((content, i) => [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
    ])
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

export const layoutPdf = () => pdfFixture([
  `BT /F2 24 Tf 50 740 Td (Synthetic layout study) Tj ET
BT /F1 12 Tf 50 690 Td (First paragraph describes the study and its observations.) Tj ET
BT /F1 12 Tf 50 672 Td (The next line belongs to the same paragraph.) Tj ET
BT /F2 18 Tf 50 620 Td (Methods) Tj ET
BT /F1 12 Tf 50 585 Td (Second paragraph explains how participants were measured.) Tj ET
BT /F1 12 Tf 50 567 Td (Each participant completed the same synthetic task.) Tj ET`,
  `BT /F2 24 Tf 50 740 Td (Results) Tj ET
BT /F1 12 Tf 50 690 Td (Final paragraph reports observations without inventing evidence.) Tj ET`
]);
