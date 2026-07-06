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

  it('flags an orphaned param ref in the dataset even without a primary table', () => {
    const dataset = { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [{ dimension: 'd', op: 'eq', value: '{{param.missing}}' }] };
    // a valid kpi block so the report isn't empty; the orphan is only in the dataset
    const rows = [kpi({ mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] })] as never;
    expect(codes(withRows(rows, { dataset } as never))).toContain('orphaned-param-ref');
  });

  it('counts a parameter used only by the dataset as used (no unused-parameter)', () => {
    const params = [{ id: 'site', label: 'S', type: 'text', required: false }] as never;
    const dataset = { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [{ dimension: 'd', op: 'eq', value: '{{param.site}}' }] };
    const rows = [kpi({ mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] })] as never;
    expect(codes(withRows(rows, { parameters: params, dataset } as never))).not.toContain('unused-parameter');
  });
});

describe('lintReportTemplate daterange params (Slice G follow-up)', () => {
  const tableWithDateFilters = (params: ReportTemplate['parameters']) => withRows(
    [{ id: 'r', cells: [{ colSpan: 12, block: { kind: 'table', columns: [], source: {
      mode: 'builder', model: 'observations', metric: { key: 'tested', agg: 'count' },
      filters: [
        { dimension: 'effective_date_time', op: 'gte', value: '{{param.from}}' },
        { dimension: 'effective_date_time', op: 'lte', value: '{{param.to}}' },
      ],
    } } }] }] as never,
    { parameters: params },
  );

  it('accepts {{param.from}}/{{param.to}} when a daterange param is defined (no orphan errors, no unused warning)', () => {
    const cs = codes(tableWithDateFilters([{ id: 'dateRange', label: 'Date range', type: 'daterange', required: false }] as never));
    expect(cs).not.toContain('orphaned-param-ref');
    expect(cs).not.toContain('unused-parameter');
  });

  it('still flags {{param.from}} as orphaned when no daterange param is defined', () => {
    expect(codes(tableWithDateFilters([] as never))).toContain('orphaned-param-ref');
  });
});

describe('lint filterTree param refs', () => {
  function tplWithTreeRule(paramToken: string, params: { id: string; label: string; type: 'text' | 'daterange' }[] = []) {
    return {
      id: 't', name: 'T', description: '', category: 'operational' as const, status: 'draft' as const,
      page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
      parameters: params,
      rows: [{ id: 'r1', cells: [{ colSpan: 12, block: { kind: 'chart' as const, chartType: 'bar' as const, visual: {},
        query: { mode: 'builder' as const, model: 'observations', metric: { key: 'count', agg: 'count' as const }, filters: [],
          filterTree: { kind: 'group', combinator: 'and', children: [ { kind: 'rule', dimension: 'code_text', op: 'eq', value: paramToken } ] } } } }] }],
    } as unknown as ReportTemplate;
  }

  it('flags an orphaned param referenced only inside a filterTree rule', () => {
    const issues = lintReportTemplate(tplWithTreeRule('{{param.ghost}}'));
    expect(issues.some((i) => i.code === 'orphaned-param-ref')).toBe(true);
  });

  it('counts a defined param used when bound inside a filterTree rule (no unused warning)', () => {
    const issues = lintReportTemplate(tplWithTreeRule('{{param.site}}', [{ id: 'site', label: 'Site', type: 'text' }]));
    expect(issues.some((i) => i.code === 'orphaned-param-ref')).toBe(false);
    expect(issues.some((i) => i.code === 'unused-parameter' && i.paramId === 'site')).toBe(false);
  });
});
