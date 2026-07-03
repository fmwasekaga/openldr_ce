import { describe, it, expect } from 'vitest';
import { renderReportTemplatePdf } from './index';
import { createEmptyTemplate } from '../helpers';

const result = (rows: any[]): any => ({ columns: [{ key: 'label', label: 'L', kind: 'string' }, { key: 'value', label: 'V', kind: 'number' }], rows, chart: { type: 'bar', x: 'label', y: 'value' }, meta: { generatedAt: 'n', rowCount: rows.length } });

describe('renderReportTemplatePdf', () => {
  it('renders a template with a header, KPI, chart, and primary table into a valid PDF', async () => {
    const t = createEmptyTemplate('rt', 'Demo');
    t.dataset = { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] } as any;
    t.rows = [
      { id: 'h', repeat: 'header', cells: [{ colSpan: 12, block: { kind: 'title', text: 'Report for {{param.facility}}', style: { fontSize: 16, bold: true } } as any }] },
      { id: 'k', cells: [
        { colSpan: 6, block: { kind: 'kpi', query: { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] }, label: 'Total' } as any },
        { colSpan: 6, block: { kind: 'chart', query: { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] }, chartType: 'bar', visual: {} } as any },
      ] },
      { id: 't', cells: [{ colSpan: 12, block: { kind: 'table', source: 'primary', columns: [] } as any }] },
    ];
    const rows = Array.from({ length: 80 }, (_, i) => ({ label: `r${i}`, value: i }));
    const buf = await renderReportTemplatePdf(t, { facility: 'Ndola' }, async () => result(rows));
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('still renders when a block query fails (error isolation)', async () => {
    const t = createEmptyTemplate('rt', 'Demo');
    t.rows = [{ id: 'k', cells: [{ colSpan: 12, block: { kind: 'chart', query: { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] }, chartType: 'bar', visual: {} } as any }] }];
    const buf = await renderReportTemplatePdf(t, {}, async () => { throw new Error('nope'); });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
