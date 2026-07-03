import type { ReportResult } from '@openldr/reporting';
import type { Block, ReportTemplate } from '../schema';

export interface CellData { result?: ReportResult; error?: string }

export interface ResolvedTemplate {
  template: ReportTemplate;
  params: Record<string, string>;
  primary?: CellData;                 // resolution of template.dataset (if present)
  cells: Record<string, CellData>;    // key `${rowIndex}:${cellIndex}` for data-bearing blocks
}

export type BlockKind = Block['kind'];

export interface BlockStyle {
  bold?: boolean; italic?: boolean; fontSize?: number; align?: 'left' | 'center' | 'right';
}

export interface Measurer {
  /** Height in points of `text` rendered in `style`, wrapped to `maxWidth`. */
  measureText(text: string, style: BlockStyle, maxWidth: number): number;
}

export interface PageSpec {
  size: 'A4' | 'Letter';
  orientation: 'portrait' | 'landscape';
  margins: { top: number; right: number; bottom: number; left: number };
}

export interface LayoutBlock {
  kind: BlockKind;
  colSpan: number;
  text?: string;          // title/text (already interpolated)
  style?: BlockStyle;     // title/text
  rowCount?: number;      // table
  fixedHeight?: number;   // kpi/chart/image/spacer override
}

export interface LayoutRow {
  repeat?: 'header' | 'footer';
  cells: LayoutBlock[];
}

export interface LayoutModel { page: PageSpec; rows: LayoutRow[] }

export interface PositionedBox {
  page: number; x: number; y: number; w: number; h: number;
  rowIndex: number; cellIndex: number;
  kind: BlockKind; repeat?: 'header' | 'footer';
}

const PAGE_DIMS: Record<PageSpec['size'], [number, number]> = { A4: [595.28, 841.89], Letter: [612, 792] };
const GRID_COLS = 12;
const CELL_GAP = 8;
const ROW_GAP = 8;
const TABLE_HEADER_H = 18;
const TABLE_ROW_H = 16;
const DEFAULT_H: Partial<Record<BlockKind, number>> = { kpi: 54, chart: 180, image: 120, divider: 12, spacer: 12 };

function pageWH(p: PageSpec): [number, number] {
  const [w, h] = PAGE_DIMS[p.size];
  return p.orientation === 'landscape' ? [h, w] : [w, h];
}

function cellHeight(b: LayoutBlock, width: number, m: Measurer): number {
  switch (b.kind) {
    case 'title': case 'text': return m.measureText(b.text ?? '', b.style ?? {}, width);
    case 'table': return TABLE_HEADER_H + (b.rowCount ?? 0) * TABLE_ROW_H;
    case 'kpi': case 'chart': case 'image': case 'spacer': return b.fixedHeight ?? DEFAULT_H[b.kind]!;
    case 'divider': return DEFAULT_H.divider!;
    default: return 0; // pageBreak
  }
}

// Lay out one row's cells left-to-right; return the boxes (y/page filled by caller) + row height.
function layoutRowCells(cells: LayoutBlock[], left: number, usableWidth: number, m: Measurer):
  { boxes: Omit<PositionedBox, 'page' | 'y' | 'rowIndex' | 'repeat'>[]; height: number } {
  const boxes: Omit<PositionedBox, 'page' | 'y' | 'rowIndex' | 'repeat'>[] = [];
  let x = left;
  let height = 0;
  cells.forEach((cell, cellIndex) => {
    const w = (usableWidth * cell.colSpan) / GRID_COLS - CELL_GAP;
    const h = cellHeight(cell, w, m);
    boxes.push({ x, y: 0, w, h, cellIndex, kind: cell.kind } as never);
    x += (usableWidth * cell.colSpan) / GRID_COLS;
    height = Math.max(height, h);
  });
  return { boxes, height };
}

export function computeLayout(modelIn: LayoutModel, m: Measurer): PositionedBox[] {
  const { page, rows } = modelIn;
  const [pw, ph] = pageWH(page);
  const left = page.margins.left;
  const usableWidth = pw - page.margins.left - page.margins.right;

  const headerRows = rows.map((r, i) => ({ r, i })).filter((x) => x.r.repeat === 'header');
  const footerRows = rows.map((r, i) => ({ r, i })).filter((x) => x.r.repeat === 'footer');
  const bodyRows = rows.map((r, i) => ({ r, i })).filter((x) => !x.r.repeat);

  const measureBand = (band: { r: LayoutRow; i: number }[]) =>
    band.reduce((sum, x) => sum + layoutRowCells(x.r.cells, left, usableWidth, m).height + ROW_GAP, 0);
  const headerH = measureBand(headerRows);
  const footerH = measureBand(footerRows);

  const bodyTop = page.margins.top + headerH;
  const bodyBottom = ph - page.margins.bottom - footerH;

  const out: PositionedBox[] = [];
  let pageNo = 1;
  let cursorY = bodyTop;

  const emitBand = (band: { r: LayoutRow; i: number }[], startY: number, repeat: 'header' | 'footer') => {
    let y = startY;
    for (const { r, i } of band) {
      const { boxes, height } = layoutRowCells(r.cells, left, usableWidth, m);
      for (const b of boxes) out.push({ ...(b as any), y, page: pageNo, rowIndex: i, repeat });
      y += height + ROW_GAP;
    }
  };
  const stampBands = () => {
    emitBand(headerRows, page.margins.top, 'header');
    emitBand(footerRows, bodyBottom + ROW_GAP, 'footer');
  };
  stampBands();

  for (const { r, i } of bodyRows) {
    const hasPageBreak = r.cells.some((c) => c.kind === 'pageBreak');
    if (hasPageBreak) { pageNo++; cursorY = bodyTop; stampBands(); continue; }
    const { boxes, height } = layoutRowCells(r.cells, left, usableWidth, m);
    if (cursorY + height > bodyBottom && cursorY > bodyTop) {
      pageNo++; cursorY = bodyTop; stampBands();
    }
    for (const b of boxes) out.push({ ...(b as any), y: cursorY, page: pageNo, rowIndex: i });
    cursorY += height + ROW_GAP;
  }
  return out;
}
