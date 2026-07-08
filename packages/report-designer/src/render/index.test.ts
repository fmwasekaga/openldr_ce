import { describe, it, expect } from 'vitest';
import { renderReportDesignPdf, type ResolvedTable } from './index';
import type { ReportDesign } from '../schema';

const NOW = new Date('2026-07-08T00:00:00Z');

function baseDesign(over: Partial<ReportDesign> = {}): ReportDesign {
  return { id: 'd', name: 'N', paper: 'A4', orientation: 'portrait', parameters: [], pages: [{ id: 'p1', elements: [] }], ...over } as ReportDesign;
}

describe('renderReportDesignPdf', () => {
  it('returns a non-empty PDF buffer starting with %PDF', async () => {
    const buf = await renderReportDesignPdf(baseDesign(), new Map(), { now: NOW });
    expect(buf.length).toBeGreaterThan(100);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('renders a bound table from resolved rows and a query-error placeholder without throwing', async () => {
    const design = baseDesign({ pages: [{ id: 'p1', elements: [
      { id: 't1', kind: 'table', name: 'A', rect: { x: 10, y: 10, w: 300, h: 100 }, dataSource: { kind: 'custom-query', queryId: 'q1' }, boundColumns: [{ key: 'org', label: 'Organism' }] },
      { id: 't2', kind: 'table', name: 'B', rect: { x: 10, y: 200, w: 300, h: 100 }, dataSource: { kind: 'custom-query', queryId: 'q2' } },
    ] }] });
    const resolved = new Map<string, ResolvedTable>([
      ['t1', { columns: [{ key: 'org', label: 'Organism' }], rows: [{ org: 'E. coli' }] }],
      ['t2', { error: 'boom' }],
    ]);
    const buf = await renderReportDesignPdf(design, resolved, { now: NOW });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('does not throw or corrupt the stream when an image src is invalid, and still draws following elements', async () => {
    const design = baseDesign({ pages: [{ id: 'p1', elements: [
      { id: 'img', kind: 'image', name: 'I', rect: { x: 10, y: 10, w: 80, h: 60 }, src: 'data:image/png;base64,NOTVALID' },
      { id: 'txt', kind: 'text', name: 'T', rect: { x: 10, y: 90, w: 300, h: 20 }, text: 'after the bad image' },
      { id: 'box', kind: 'rect', name: 'R', rect: { x: 10, y: 120, w: 100, h: 40 }, style: { fill: '#eef' } },
    ] }] });
    const buf = await renderReportDesignPdf(design, new Map(), { now: NOW });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(100);
  });

  it('emits one PDF page per design page', async () => {
    const two = baseDesign({ pages: [{ id: 'a', elements: [] }, { id: 'b', elements: [] }] });
    const buf = await renderReportDesignPdf(two, new Map(), { now: NOW });
    expect(buf.toString('latin1')).toContain('/Type /Pages');
    expect(buf.toString('latin1')).toMatch(/\/Count 2/);
  });

  it('paginates an overflowing table onto extra pages and repeats non-table elements', async () => {
    const design = baseDesign({ pages: [{ id: 'p1', elements: [
      { id: 'title', kind: 'text', name: 'Title', rect: { x: 10, y: 10, w: 300, h: 20 }, text: 'Turnaround time' },
      { id: 't1', kind: 'table', name: 'T', rect: { x: 10, y: 40, w: 300, h: 100 }, dataSource: { kind: 'custom-query', queryId: 'q' }, boundColumns: [{ key: 'a', label: 'A' }] },
    ] }] });
    const resolved = new Map<string, ResolvedTable>([['t1', { columns: [{ key: 'a', label: 'A' }], rows: Array.from({ length: 7 }, (_, i) => ({ a: `row${i}` })) }]]);
    const buf = await renderReportDesignPdf(design, resolved, { now: NOW });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.toString('latin1')).toMatch(/\/Count 3/);
  });

  it('renders exactly one page when the table fits (no regression)', async () => {
    const design = baseDesign({ pages: [{ id: 'p1', elements: [
      { id: 't1', kind: 'table', name: 'T', rect: { x: 10, y: 10, w: 300, h: 200 }, dataSource: { kind: 'custom-query', queryId: 'q' }, boundColumns: [{ key: 'a', label: 'A' }] },
    ] }] });
    const resolved = new Map<string, ResolvedTable>([['t1', { columns: [{ key: 'a', label: 'A' }], rows: [{ a: 'x' }, { a: 'y' }] }]]);
    const buf = await renderReportDesignPdf(design, resolved, { now: NOW });
    expect(buf.toString('latin1')).toMatch(/\/Count 1/);
  });

  it('paginates an overflowing static (unbound) table through the render path', async () => {
    const design = baseDesign({ pages: [{ id: 'p1', elements: [
      { id: 't1', kind: 'table', name: 'T', rect: { x: 10, y: 10, w: 300, h: 100 }, columns: ['A'], rows: Array.from({ length: 7 }, (_, i) => [`r${i}`]) },
    ] }] });
    const buf = await renderReportDesignPdf(design, new Map(), { now: NOW });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.toString('latin1')).toMatch(/\/Count 3/);
  });

  it('an error table does not paginate (1 page) and does not throw', async () => {
    const design = baseDesign({ pages: [{ id: 'p1', elements: [
      { id: 't1', kind: 'table', name: 'T', rect: { x: 10, y: 10, w: 300, h: 100 }, dataSource: { kind: 'custom-query', queryId: 'q' } },
    ] }] });
    const buf = await renderReportDesignPdf(design, new Map([['t1', { error: 'boom' }]]), { now: NOW });
    expect(buf.toString('latin1')).toMatch(/\/Count 1/);
  });
});
