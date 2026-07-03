import PDFDocument from 'pdfkit';
import type { ReportTemplate } from '../schema';
import { computeLayout, toLayoutModel, type PageSpec } from './layout';
import { runTemplate, type QueryFn } from './run-template';
import { pdfkitMeasurer } from './measurer';
import { drawBlock } from './paint';

const PAGE_DIMS: Record<PageSpec['size'], [number, number]> = { A4: [595.28, 841.89], Letter: [612, 792] };

function pageSize(p: PageSpec): { size: [number, number] } {
  const [w, h] = PAGE_DIMS[p.size];
  return { size: p.orientation === 'landscape' ? [h, w] : [w, h] };
}

export async function renderReportTemplatePdf(
  template: ReportTemplate,
  params: Record<string, string>,
  queryFn: QueryFn,
): Promise<Buffer> {
  const resolved = await runTemplate(template, params, queryFn);
  const page = template.page as PageSpec;

  const doc = new PDFDocument({ ...pageSize(page), margins: page.margins, bufferPages: true });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolveP, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolveP(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const measurer = pdfkitMeasurer(doc);
  const boxes = computeLayout(toLayoutModel(resolved), measurer);
  const datasetRow = resolved.primary?.result?.rows[0] as Record<string, unknown> | undefined;
  const ctx = { params, dataset: datasetRow };

  const [, ph] = pageSize(page).size;
  const bodyBottom = ph - page.margins.bottom;

  // Ensure the document has enough pages, then paint each box on its page.
  const maxPage = boxes.reduce((m, b) => Math.max(m, b.page), 1);
  for (let p = 2; p <= maxPage; p++) doc.addPage();

  const pageStart = doc.bufferedPageRange().start;
  for (const box of boxes.filter((b) => !b.repeat)) {
    doc.switchToPage(pageStart + box.page - 1);
    const cell = resolved.cells[`${box.rowIndex}:${box.cellIndex}`];
    drawBlock(doc, box, template.rows[box.rowIndex].cells[box.cellIndex].block, cell, ctx, bodyBottom);
  }
  // Header/footer boxes repeat on their page already (computeLayout emitted one per page).
  for (const box of boxes.filter((b) => b.repeat)) {
    if (box.page - 1 >= doc.bufferedPageRange().count) continue;
    doc.switchToPage(pageStart + box.page - 1);
    const cell = resolved.cells[`${box.rowIndex}:${box.cellIndex}`];
    drawBlock(doc, box, template.rows[box.rowIndex].cells[box.cellIndex].block, cell, ctx, bodyBottom);
  }

  doc.end();
  return done;
}
