import { interpolate, type InterpolateContext } from '../helpers';
import type { Block } from '../schema';
import type { CellData, PositionedBox } from './layout';
import { drawChart, type ChartData } from './charts';

const TABLE_HEADER_H = 18;
const TABLE_ROW_H = 16;

function fontFor(style?: { bold?: boolean; italic?: boolean }): string {
  if (style?.bold && style?.italic) return 'Helvetica-BoldOblique';
  if (style?.bold) return 'Helvetica-Bold';
  if (style?.italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

// Build ChartData from a ReportResult using the columns as label/value (label = first non-number col, value = first number col).
function toChartData(title: string, result: CellData['result']): ChartData {
  if (!result) return { title, categories: [], series: [] };
  const cols = result.columns;
  const labelKey = cols.find((c) => c.kind !== 'number')?.key ?? cols[0]?.key ?? 'label';
  const valueKey = cols.find((c) => c.kind === 'number')?.key ?? cols[1]?.key ?? 'value';
  const categories = result.rows.map((r) => String(r[labelKey] ?? ''));
  const values = result.rows.map((r) => Number(r[valueKey] ?? 0));
  return { title, categories, series: [{ name: valueKey, values }] };
}

function drawErrorPlaceholder(doc: PDFKit.PDFDocument, box: PositionedBox, msg: string): void {
  doc.rect(box.x, box.y, box.w, box.h).fillColor('#fdf2f2').fill();
  doc.fillColor('#a33').font('Helvetica').fontSize(8).text(`! ${msg}`, box.x + 6, box.y + 6, { width: box.w - 12, ellipsis: true });
  doc.fillColor('#000');
}

function drawTable(doc: PDFKit.PDFDocument, box: PositionedBox, block: Extract<Block, { kind: 'table' }>, cell: CellData | undefined, bodyBottom: number): void {
  const result = cell?.result;
  const columns = block.columns.length ? block.columns : (result?.columns.map((c) => ({ key: c.key, label: c.label })) ?? []);
  const rows = result?.rows ?? [];
  const colW = box.w / Math.max(1, columns.length);
  let y = box.y;
  const header = () => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#222');
    columns.forEach((c, i) => doc.text(c.label, box.x + i * colW + 2, y + 4, { width: colW - 4, ellipsis: true }));
    doc.moveTo(box.x, y + TABLE_HEADER_H).lineTo(box.x + box.w, y + TABLE_HEADER_H).strokeColor('#999').lineWidth(0.5).stroke();
    y += TABLE_HEADER_H;
  };
  header();
  doc.font('Helvetica').fontSize(8).fillColor('#000');
  rows.forEach((row, idx) => {
    if (y + TABLE_ROW_H > bodyBottom) { doc.addPage(); y = doc.page.margins.top; header(); doc.font('Helvetica').fontSize(8).fillColor('#000'); }
    if (idx % 2 === 1) { doc.rect(box.x, y, box.w, TABLE_ROW_H).fillColor('#f5f5f5').fill().fillColor('#000'); }
    columns.forEach((c, i) => doc.text(String(row[c.key] ?? ''), box.x + i * colW + 2, y + 4, { width: colW - 4, ellipsis: true }));
    y += TABLE_ROW_H;
  });
  if (rows.length === 0) doc.fillColor('#888').text('(no rows)', box.x + 2, y + 4).fillColor('#000');
}

export function drawBlock(
  doc: PDFKit.PDFDocument,
  box: PositionedBox,
  block: Block,
  cell: CellData | undefined,
  ctx: InterpolateContext,
  bodyBottom: number,
): void {
  if (cell?.error) { drawErrorPlaceholder(doc, box, cell.error); return; }
  switch (block.kind) {
    case 'title':
    case 'text': {
      const raw = block.kind === 'title' ? block.text : block.content;
      doc.font(fontFor(block.style)).fontSize(block.style?.fontSize ?? (block.kind === 'title' ? 14 : 11)).fillColor('#111');
      doc.text(interpolate(raw ?? '', ctx), box.x, box.y, { width: box.w, align: block.style?.align ?? 'left' });
      doc.fillColor('#000');
      return;
    }
    case 'kpi':
      drawChart(doc, box, 'kpi', toChartData(block.label || '', cell?.result), {});
      return;
    case 'chart':
      drawChart(doc, box, block.chartType, toChartData('', cell?.result), block.visual as never);
      return;
    case 'table':
      drawTable(doc, box, block, cell, bodyBottom);
      return;
    case 'image':
      doc.rect(box.x, box.y, box.w, box.h).strokeColor('#ccc').lineWidth(0.5).stroke();
      doc.fillColor('#999').fontSize(8).text(block.src === 'org-logo' ? '[logo]' : block.src, box.x + 4, box.y + 4, { width: box.w - 8, ellipsis: true }).fillColor('#000');
      return;
    case 'divider':
      doc.moveTo(box.x, box.y + box.h / 2).lineTo(box.x + box.w, box.y + box.h / 2).strokeColor('#ccc').lineWidth(0.5).stroke();
      return;
    case 'spacer':
    case 'pageBreak':
      return;
  }
}
