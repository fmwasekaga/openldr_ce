import { describe, it, expect } from 'vitest';
import PDFDocument from 'pdfkit';
import { drawBlock, formatCell } from './paint';
import type { PositionedBox, CellData } from './layout';

// pdfkit emits chunks asynchronously — resolve on 'end'.
function render(fn: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  fn(doc);
  doc.end();
  return done;
}

const box = (kind: string): PositionedBox => ({ page: 1, x: 40, y: 40, w: 400, h: 120, rowIndex: 0, cellIndex: 0, kind: kind as any });
const result = (rows: any[]): any => ({ columns: [{ key: 'a', label: 'A', kind: 'string' }], rows, chart: { type: 'bar', x: 'a', y: 'b' }, meta: { generatedAt: 'n', rowCount: rows.length } });

describe('drawBlock', () => {
  it('draws a title block without throwing', async () => {
    const buf = await render((doc) => drawBlock(doc, box('title'), { kind: 'title', text: 'Hi', style: { fontSize: 16 } } as any, undefined, { params: {}, dataset: undefined }, 800));
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
  it('draws a table block from cell data without throwing', async () => {
    const cell: CellData = { result: result([{ a: '1' }, { a: '2' }]) };
    const buf = await render((doc) => drawBlock(doc, box('table'), { kind: 'table', source: 'primary', columns: [{ key: 'a', label: 'A' }] } as any, cell, { params: {}, dataset: undefined }, 800));
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
  it('draws an error placeholder when the cell has an error', async () => {
    const cell: CellData = { error: 'boom' };
    const buf = await render((doc) => drawBlock(doc, box('chart'), { kind: 'chart', query: {} as any, chartType: 'bar', visual: {} } as any, cell, { params: {}, dataset: undefined }, 800));
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
  it('draws divider and spacer without throwing', async () => {
    const buf = await render((doc) => {
      drawBlock(doc, box('divider'), { kind: 'divider' } as any, undefined, { params: {}, dataset: undefined }, 800);
      drawBlock(doc, box('spacer'), { kind: 'spacer', height: 10 } as any, undefined, { params: {}, dataset: undefined }, 800);
    });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('formatCell (Slice G)', () => {
  it('formats a percent column value as N.N%', () => {
    expect(formatCell(50, 'percent')).toBe('50.0%');
    expect(formatCell(33.3, 'percent')).toBe('33.3%');
  });
  it('renders a blank/non-numeric percent as empty', () => {
    expect(formatCell(null, 'percent')).toBe('');
    expect(formatCell(undefined, 'percent')).toBe('');
    expect(formatCell('x', 'percent')).toBe('');
  });
  it('renders non-percent columns as string (unchanged)', () => {
    expect(formatCell('Ciprofloxacin')).toBe('Ciprofloxacin');
    expect(formatCell(4, 'number')).toBe('4');
    expect(formatCell(null)).toBe('');
  });
  it('honors the configured decimals', () => {
    expect(formatCell(33.33, 'percent', 2)).toBe('33.33%');
    expect(formatCell(50, 'percent', 0)).toBe('50%');
  });
  it('defaults to 1 decimal when none is given', () => {
    expect(formatCell(50, 'percent')).toBe('50.0%');
  });
});
