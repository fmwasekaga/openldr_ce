import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { paramValues, sheetName, buildWorkbook, exportDesignToExcel, type SheetData } from './exportExcel';
import type { ReportDesign } from './types';

const rect = { x: 0, y: 0, w: 100, h: 50 };
function design(over: Partial<ReportDesign> = {}): ReportDesign {
  return { id: 'd', name: 'N', paper: 'A4', orientation: 'portrait', parameters: [], pages: [{ id: 'p', elements: [] }], ...over } as ReportDesign;
}

describe('paramValues', () => {
  it('maps string + daterange values by key and skips null', () => {
    const d = design({ parameters: [
      { key: 'facility', label: 'F', type: 'text', value: 'HQ' },
      { key: 'range', label: 'R', type: 'daterange', value: { from: '2026-01-01', to: '2026-06-30' } },
      { key: 'blank', label: 'B', type: 'text' },
    ] });
    expect(paramValues(d)).toEqual({ facility: 'HQ', range: { from: '2026-01-01', to: '2026-06-30' } });
  });
});

describe('sheetName', () => {
  it('strips forbidden chars, truncates to 31, and dedupes', () => {
    const used = new Set<string>();
    expect(sheetName('AMR / summary [2026]', used)).toBe('AMR   summary  2026');
    expect(sheetName('Same', used)).toBe('Same');
    expect(sheetName('Same', used)).toBe('Same (2)');
    expect(sheetName('x'.repeat(40), used)).toHaveLength(31);
    expect(sheetName('', used)).toBe('Table');
  });
});

describe('buildWorkbook', () => {
  it('makes one sheet per table with a header row then projected rows', () => {
    const sheets: SheetData[] = [
      { name: 'AMR', columns: [{ key: 'org', label: 'Organism' }, { key: 'n', label: 'Count' }], rows: [{ org: 'E. coli', n: 5 }] },
      { name: 'AMR', columns: [{ key: 'a', label: 'A' }], rows: [] }, // dup name → deduped
    ];
    const wb = buildWorkbook(sheets);
    expect(wb.SheetNames).toEqual(['AMR', 'AMR (2)']);
    const ws = wb.Sheets.AMR;
    expect(ws.A1.v).toBe('Organism');
    expect(ws.B1.v).toBe('Count');
    expect(ws.A2.v).toBe('E. coli');
    expect(ws.B2.v).toBe(5);
    // Empty-rows sheet still has its header row.
    expect(wb.Sheets['AMR (2)'].A1.v).toBe('A');
  });
});

describe('exportDesignToExcel', () => {
  const tableEl = (over: Record<string, unknown>) => ({ id: 't', kind: 'table', name: 'AMR', rect, ...over });

  it('runs a bound table query with mapped params and writes <name>.xlsx projecting boundColumns', async () => {
    const run = vi.fn(async () => ({ columns: [{ key: 'org', label: 'Organism' }, { key: 'n', label: 'N' }], rows: [{ org: 'E. coli', n: 5 }], rowCount: 1, ms: 1 }));
    const list = vi.fn(async () => [{ id: 'cq_1', name: 'Q', connectorId: 'c1', sql: 'select 1', params: [] }]);
    const write = vi.fn();
    const d = design({
      name: 'My / Report',
      parameters: [{ key: 'facility', label: 'F', type: 'text', value: 'HQ' }],
      pages: [{ id: 'p', elements: [tableEl({ dataSource: { kind: 'custom-query', queryId: 'cq_1' }, boundColumns: [{ key: 'org', label: 'Organism' }] })] as never }],
    });
    const n = await exportDesignToExcel(d, { list, run, write });
    expect(n).toBe(1);
    expect(run).toHaveBeenCalledWith({ connectorId: 'c1', sql: 'select 1', params: [], values: { facility: 'HQ' }, limit: 1000, offset: 0 });
    expect(write).toHaveBeenCalledTimes(1);
    const [wb, filename] = write.mock.calls[0] as [XLSX.WorkBook, string];
    expect(filename).toBe('My_Report.xlsx');
    expect(wb.SheetNames).toEqual(['AMR']);
    // Only the boundColumn (org) is projected — not the query's other column (n).
    expect(wb.Sheets.AMR.A1.v).toBe('Organism');
    expect(wb.Sheets.AMR.A2.v).toBe('E. coli');
    expect(wb.Sheets.AMR.B1).toBeUndefined();
  });

  it('exports an unbound table from its static data without fetching the query catalog', async () => {
    const list = vi.fn();
    const write = vi.fn();
    const d = design({ pages: [{ id: 'p', elements: [tableEl({ name: 'Static', columns: ['A', 'B'], rows: [['1', '2']] })] as never }] });
    const n = await exportDesignToExcel(d, { list, run: vi.fn(), write });
    expect(n).toBe(1);
    expect(list).not.toHaveBeenCalled();
    const [wb] = write.mock.calls[0] as [XLSX.WorkBook];
    expect(wb.Sheets.Static.A1.v).toBe('A');
    expect(wb.Sheets.Static.A2.v).toBe('1');
  });

  it('pages through a bound query beyond the 1000-row cap', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ org: `o${i}` }));
    const run = vi.fn()
      .mockResolvedValueOnce({ columns: [{ key: 'org', label: 'Organism' }], rows: page1, rowCount: 1000, ms: 1 })
      .mockResolvedValueOnce({ columns: [{ key: 'org', label: 'Organism' }], rows: [{ org: 'last' }], rowCount: 1, ms: 1 });
    const list = vi.fn(async () => [{ id: 'cq_1', name: 'Q', connectorId: 'c1', sql: 's', params: [] }]);
    const write = vi.fn();
    const d = design({ pages: [{ id: 'p', elements: [tableEl({ dataSource: { kind: 'custom-query', queryId: 'cq_1' } })] as never }] });
    await exportDesignToExcel(d, { list, run, write });
    expect(run).toHaveBeenNthCalledWith(1, expect.objectContaining({ limit: 1000, offset: 0 }));
    expect(run).toHaveBeenNthCalledWith(2, expect.objectContaining({ limit: 1000, offset: 1000 }));
    const [wb] = write.mock.calls[0] as [XLSX.WorkBook];
    expect(wb.Sheets.AMR.A1.v).toBe('Organism'); // header + 1001 data rows
    expect(wb.Sheets.AMR.A1002.v).toBe('last');
  });

  it('degrades a failed bound table to an error sheet and still exports the others', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ columns: [{ key: 'org', label: 'Organism' }], rows: [{ org: 'ok' }], rowCount: 1, ms: 1 });
    const list = vi.fn(async () => [
      { id: 'cq_1', name: 'Q', connectorId: 'c1', sql: 's', params: [] },
      { id: 'cq_2', name: 'Q2', connectorId: 'c1', sql: 's2', params: [] },
    ]);
    const write = vi.fn();
    const d = design({ pages: [{ id: 'p', elements: [
      { id: 't1', kind: 'table', name: 'Bad', rect, dataSource: { kind: 'custom-query', queryId: 'cq_1' } },
      { id: 't2', kind: 'table', name: 'Good', rect, dataSource: { kind: 'custom-query', queryId: 'cq_2' } },
    ] as never }] });
    const n = await exportDesignToExcel(d, { list, run, write });
    expect(n).toBe(2);
    const [wb] = write.mock.calls[0] as [XLSX.WorkBook];
    expect(wb.SheetNames).toEqual(['Bad', 'Good']);
    expect(wb.Sheets.Bad.A1.v).toBe('Error');
    expect(String(wb.Sheets.Bad.A2.v)).toContain('boom');
    expect(wb.Sheets.Good.A2.v).toBe('ok');
  });

  it('returns 0 and writes nothing for a design with no table elements', async () => {
    const write = vi.fn();
    const d = design({ pages: [{ id: 'p', elements: [{ id: 'x', kind: 'text', name: 'T', rect, text: 'hi' }] as never }] });
    const n = await exportDesignToExcel(d, { list: vi.fn(), run: vi.fn(), write });
    expect(n).toBe(0);
    expect(write).not.toHaveBeenCalled();
  });
});
