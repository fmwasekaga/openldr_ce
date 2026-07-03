import { describe, it, expect } from 'vitest';
import { lintReportTemplate } from './lint';
import type { ReportTemplate } from './schema';

const base: ReportTemplate = {
  id: 't', name: 'R', description: '', category: 'operational', status: 'draft',
  page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
  parameters: [], rows: [], createdAt: undefined, updatedAt: undefined,
} as ReportTemplate;

function withRows(rows: ReportTemplate['rows'], extra: Partial<ReportTemplate> = {}): ReportTemplate {
  return { ...base, rows, ...extra } as ReportTemplate;
}
const kpi = (query: unknown) => ({ id: 'r', cells: [{ colSpan: 12, block: { kind: 'kpi', label: '', query } }] });
const codes = (t: ReportTemplate) => lintReportTemplate(t).map((i) => i.code);

describe('lintReportTemplate', () => {
  it('flags a blank name', () => {
    expect(codes(withRows([kpi({ mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] })] as never, { name: '' }))).toContain('empty-name');
  });

  it('flags a data block with no model (empty-query)', () => {
    expect(codes(withRows([kpi({ mode: 'builder', model: '', metric: { key: 'count', agg: 'count' }, filters: [] })] as never))).toContain('empty-query');
  });

  it('flags a primary table with no dataset (empty-query)', () => {
    const rows = [{ id: 'r', cells: [{ colSpan: 12, block: { kind: 'table', source: 'primary', columns: [] } }] }] as never;
    expect(codes(withRows(rows))).toContain('empty-query');
  });

  it('flags an orphaned {{param.x}} filter ref', () => {
    const rows = [kpi({ mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [{ dimension: 'status', op: 'eq', value: '{{param.missing}}' }] })] as never;
    expect(codes(withRows(rows))).toContain('orphaned-param-ref');
  });

  it('flags an unbound SQL variable', () => {
    const rows = [kpi({ mode: 'sql', sql: 'select {{ward}}', values: {} })] as never;
    expect(codes(withRows(rows))).toContain('unbound-sql-var');
  });

  it('flags duplicate parameter ids', () => {
    const params = [{ id: 'x', label: 'A', type: 'text', required: false }, { id: 'x', label: 'B', type: 'text', required: false }] as never;
    const rows = [kpi({ mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [{ dimension: 'd', op: 'eq', value: '{{param.x}}' }] })] as never;
    expect(codes(withRows(rows, { parameters: params }))).toContain('duplicate-param-id');
  });

  it('warns on an unused parameter', () => {
    const params = [{ id: 'unused', label: 'U', type: 'text', required: false }] as never;
    const rows = [kpi({ mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] })] as never;
    const issues = lintReportTemplate(withRows(rows, { parameters: params }));
    expect(issues.find((i) => i.code === 'unused-parameter')?.severity).toBe('warning');
  });

  it('warns on an empty report (no data blocks)', () => {
    expect(codes(withRows([]))).toContain('empty-report');
  });

  it('returns no issues for a valid single-block report', () => {
    const rows = [kpi({ mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] })] as never;
    expect(lintReportTemplate(withRows(rows))).toEqual([]);
  });
});
