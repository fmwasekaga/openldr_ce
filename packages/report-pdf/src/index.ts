import PDFDocument from 'pdfkit';

export interface PdfColumn { key: string; label: string }
export interface PdfInput {
  title: string;
  generatedAt: string;
  params: Record<string, unknown>;
  columns: PdfColumn[];
  rows: Record<string, unknown>[];
}

export function renderReportPdf(input: PdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, layout: 'landscape', bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const usable = right - left;

    doc.font('Helvetica-Bold').fontSize(16).text(input.title, left, doc.y);
    doc.font('Helvetica').fontSize(8).fillColor('#555')
      .text(`Generated ${input.generatedAt}  ·  ${Object.entries(input.params).map(([k, v]) => `${k}=${String(v)}`).join('  ') || 'no params'}`);
    doc.fillColor('#000').moveDown(0.5);

    const cols = input.columns;
    const colW = usable / Math.max(cols.length, 1);
    const rowH = 16;

    const drawHeader = (): void => {
      doc.font('Helvetica-Bold').fontSize(9);
      const y = doc.y;
      cols.forEach((c, i) => doc.text(c.label, left + i * colW + 2, y + 4, { width: colW - 4, ellipsis: true }));
      doc.moveTo(left, y + rowH).lineTo(right, y + rowH).strokeColor('#999').stroke();
      doc.y = y + rowH + 2;
    };
    drawHeader();

    doc.font('Helvetica').fontSize(9);
    input.rows.forEach((row, idx) => {
      if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) { doc.addPage(); drawHeader(); doc.font('Helvetica').fontSize(9); }
      const y = doc.y;
      if (idx % 2 === 1) doc.rect(left, y, usable, rowH).fillColor('#f3f3f3').fill().fillColor('#000');
      cols.forEach((c, i) => doc.text(String(row[c.key] ?? ''), left + i * colW + 2, y + 4, { width: colW - 4, ellipsis: true }));
      doc.y = y + rowH;
    });
    if (input.rows.length === 0) doc.fillColor('#777').text('(no rows)', left, doc.y + 4).fillColor('#000');

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font('Helvetica').fontSize(7).fillColor('#999')
        .text(`OpenLDR  ·  page ${i + 1} of ${range.count}`, left, doc.page.height - doc.page.margins.bottom + 4, { width: usable, align: 'right' });
    }
    doc.end();
  });
}
