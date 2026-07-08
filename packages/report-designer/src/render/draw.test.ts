import { describe, it, expect } from 'vitest';
import { interpolate, paramMap, tableChunkCount, pageChunkCount, rowsFor } from './draw';
import type { ReportDesign, DesignElement, DesignPage } from '../schema';
import type { ResolvedTable } from './index';

const NOW = new Date('2026-07-08T00:00:00Z');

function design(over: Partial<ReportDesign> = {}): ReportDesign {
  return {
    id: 'd', name: 'N', paper: 'A4', orientation: 'portrait', pages: [], parameters: [], ...over,
  } as ReportDesign;
}

describe('paramMap', () => {
  it('maps string params by key, expands daterange to from/to, and sets date from now', () => {
    const m = paramMap(design({ parameters: [
      { key: 'lab', label: 'Lab', type: 'text', value: 'Ndola' },
      { key: 'range', label: 'Range', type: 'daterange', value: { from: '2026-01-01', to: '2026-06-30' } },
    ] }), NOW);
    expect(m.get('lab')).toBe('Ndola');
    expect(m.get('from')).toBe('2026-01-01');
    expect(m.get('to')).toBe('2026-06-30');
    expect(m.get('date')).toBe(NOW.toLocaleDateString());
  });

  it('ignores params with no value but still sets date', () => {
    const m = paramMap(design({ parameters: [{ key: 'empty', label: 'E', type: 'text' }] }), NOW);
    expect(m.has('empty')).toBe(false);
    expect(m.get('date')).toBe(NOW.toLocaleDateString());
  });
});

describe('interpolate', () => {
  const tokens = new Map<string, string>([['lab', 'Ndola'], ['date', '2026-07-08']]);

  it('replaces {{param.x}} and {{ param.x }} (inner whitespace)', () => {
    expect(interpolate('Lab {{param.lab}}', tokens)).toBe('Lab Ndola');
    expect(interpolate('Lab {{ param.lab }}', tokens)).toBe('Lab Ndola');
  });

  it('replaces {{date}} and {{ date }}', () => {
    expect(interpolate('as of {{date}}', tokens)).toBe('as of 2026-07-08');
    expect(interpolate('as of {{ date }}', tokens)).toBe('as of 2026-07-08');
  });

  it('yields empty string for an unknown {{param.missing}} token', () => {
    expect(interpolate('x{{param.missing}}y', tokens)).toBe('xy');
  });

  it('leaves non-token text untouched', () => {
    expect(interpolate('plain text', tokens)).toBe('plain text');
  });
});

const tbl = (over: Partial<DesignElement>): DesignElement =>
  ({ id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 300, h: 100 }, ...over } as DesignElement);

describe('tableChunkCount', () => {
  // box h=100px → 75pt; maxRows = floor((75-16)/16) = 3
  it('splits a bound table into ceil(rows/maxRows) chunks', () => {
    const el = tbl({ dataSource: { kind: 'custom-query', queryId: 'q' }, boundColumns: [{ key: 'a', label: 'A' }] });
    const resolved: ResolvedTable = { columns: [{ key: 'a', label: 'A' }], rows: Array.from({ length: 7 }, (_, i) => ({ a: i })) };
    expect(tableChunkCount(el, resolved)).toBe(3); // ceil(7/3)
  });
  it('returns 1 for a non-table, an error table, and a degenerate (too-short) box', () => {
    expect(tableChunkCount(tbl({ kind: 'text' } as Partial<DesignElement>), undefined)).toBe(1);
    expect(tableChunkCount(tbl({ dataSource: { kind: 'custom-query', queryId: 'q' } }), { error: 'x' })).toBe(1);
    expect(tableChunkCount(tbl({ rect: { x: 0, y: 0, w: 300, h: 10 }, columns: ['A'], rows: [['1'], ['2']] }), undefined)).toBe(1);
  });
  it('counts static (unbound) table rows', () => {
    expect(tableChunkCount(tbl({ columns: ['A'], rows: [['1'], ['2'], ['3'], ['4']] }), undefined)).toBe(2); // ceil(4/3)
  });
});

describe('pageChunkCount', () => {
  it('is the max chunk count across the page tables (min 1)', () => {
    const page: DesignPage = { id: 'p', elements: [
      tbl({ id: 'a', columns: ['A'], rows: [['1'], ['2'], ['3'], ['4'], ['5'], ['6'], ['7']] }), // ceil(7/3)=3
      tbl({ id: 'b', columns: ['A'], rows: [['1']] }),                                            // 1
      { id: 'x', kind: 'text', name: 'T', rect: { x: 0, y: 0, w: 10, h: 10 }, text: 'hi' } as DesignElement,
    ] };
    expect(pageChunkCount(page, new Map())).toBe(3);
  });
  it('is 1 for a page with no tables', () => {
    const page: DesignPage = { id: 'p', elements: [{ id: 'x', kind: 'text', name: 'T', rect: { x: 0, y: 0, w: 10, h: 10 }, text: 'hi' } as DesignElement] };
    expect(pageChunkCount(page, new Map())).toBe(1);
  });
});
