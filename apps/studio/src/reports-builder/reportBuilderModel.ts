import { interpolate, type Block, type BlockKind, type LayoutModel, type LayoutRow, type PageSpec, type ReportTemplate } from '@openldr/report-builder/pure';

const EMPTY_QUERY = { mode: 'builder' as const, model: '', metric: { key: 'count', agg: 'count' as const }, filters: [] };

export function newBlock(kind: BlockKind): Block {
  switch (kind) {
    case 'title': return { kind: 'title', text: '', style: {} };
    case 'text': return { kind: 'text', content: '', style: {} };
    case 'kpi': return { kind: 'kpi', query: EMPTY_QUERY, label: '' } as Block;
    case 'chart': return { kind: 'chart', query: EMPTY_QUERY, chartType: 'bar', visual: {} } as Block;
    case 'table': return { kind: 'table', source: 'primary', columns: [] } as Block;
    case 'image': return { kind: 'image', src: 'org-logo' };
    case 'divider': return { kind: 'divider' };
    case 'spacer': return { kind: 'spacer', height: 12 };
    case 'pageBreak': return { kind: 'pageBreak' };
    default: return { kind: 'divider' };
  }
}

let seq = 0;
const rowId = () => `row-${(seq += 1)}`;

export function addRowWithBlock(t: ReportTemplate, block: Block, colSpan = 12): ReportTemplate {
  return { ...t, rows: [...t.rows, { id: rowId(), cells: [{ colSpan, block }] }] };
}

export function moveRow(t: ReportTemplate, from: number, to: number): ReportTemplate {
  const rows = [...t.rows];
  if (from < 0 || from >= rows.length || to < 0 || to >= rows.length) return t;
  const [m] = rows.splice(from, 1);
  rows.splice(to, 0, m);
  return { ...t, rows };
}

export function setColSpan(t: ReportTemplate, r: number, c: number, colSpan: number): ReportTemplate {
  const clamped = Math.max(1, Math.min(12, Math.round(colSpan)));
  return mapCell(t, r, c, (cell) => ({ ...cell, colSpan: clamped }));
}

export function updateBlockAt(t: ReportTemplate, r: number, c: number, patch: Partial<Block>): ReportTemplate {
  return mapCell(t, r, c, (cell) => ({ ...cell, block: { ...cell.block, ...patch } as Block }));
}

export function addCellToRow(t: ReportTemplate, r: number, block: Block, colSpan = 6): ReportTemplate {
  const rows = t.rows.map((row, i) => (i === r ? { ...row, cells: [...row.cells, { colSpan, block }] } : row));
  return { ...t, rows };
}

export function removeCell(t: ReportTemplate, r: number, c: number): ReportTemplate {
  const rows = t.rows
    .map((row, i) => (i === r ? { ...row, cells: row.cells.filter((_, j) => j !== c) } : row))
    .filter((row) => row.cells.length > 0);
  return { ...t, rows };
}

export function setRepeat(t: ReportTemplate, r: number, repeat: 'header' | 'footer' | undefined): ReportTemplate {
  const rows = t.rows.map((row, i) => (i === r ? { ...row, repeat } : row));
  return { ...t, rows };
}

function mapCell(t: ReportTemplate, r: number, c: number, fn: (cell: ReportTemplate['rows'][number]['cells'][number]) => ReportTemplate['rows'][number]['cells'][number]): ReportTemplate {
  const rows = t.rows.map((row, i) =>
    i === r ? { ...row, cells: row.cells.map((cell, j) => (j === c ? fn(cell) : cell)) } : row,
  );
  return { ...t, rows };
}

const SAMPLE_TABLE_ROWS = 4;

/** Build a LayoutModel for the editing canvas: interpolate title/text with empty params and
 *  use a fixed sample row count for tables (P3a has no live data). */
export function previewLayoutModel(t: ReportTemplate): LayoutModel {
  const ctx = { params: {}, dataset: undefined };
  const rows: LayoutRow[] = t.rows.map((row) => ({
    repeat: row.repeat,
    cells: row.cells.map((cell) => {
      const b = cell.block;
      if (b.kind === 'title') return { kind: b.kind, colSpan: cell.colSpan, text: interpolate(b.text ?? '', ctx), style: b.style };
      if (b.kind === 'text') return { kind: b.kind, colSpan: cell.colSpan, text: interpolate(b.content ?? '', ctx), style: b.style };
      if (b.kind === 'table') return { kind: b.kind, colSpan: cell.colSpan, rowCount: SAMPLE_TABLE_ROWS };
      return { kind: b.kind, colSpan: cell.colSpan };
    }),
  }));
  return { page: t.page as PageSpec, rows };
}
