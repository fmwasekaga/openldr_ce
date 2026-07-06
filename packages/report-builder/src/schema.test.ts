import { describe, it, expect } from 'vitest';
import { ReportTemplateSchema, ReportParamSchema, BlockSchema } from './schema';

const minimal = {
  id: 'rt1',
  name: 'AMR facility summary',
  description: '',
  category: 'amr',
  status: 'draft',
  page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
  parameters: [],
  rows: [],
};

describe('ReportTemplateSchema', () => {
  it('parses a minimal template and applies defaults', () => {
    const t = ReportTemplateSchema.parse(minimal);
    expect(t.rows).toEqual([]);
    expect(t.page.size).toBe('A4');
  });

  it('parses a header row with a title block and a table cell bound to the primary dataset', () => {
    const t = ReportTemplateSchema.parse({
      ...minimal,
      dataset: { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] },
      rows: [
        { id: 'r1', repeat: 'header', cells: [{ colSpan: 12, block: { kind: 'title', text: 'Summary', style: {} } }] },
        { id: 'r2', cells: [{ colSpan: 12, block: { kind: 'table', source: 'primary', columns: [] } }] },
      ],
    });
    expect(t.rows[0].repeat).toBe('header');
    expect(t.rows[1].cells[0].block.kind).toBe('table');
  });

  it('rejects an unknown block kind', () => {
    expect(() => ReportTemplateSchema.parse({
      ...minimal,
      rows: [{ id: 'r1', cells: [{ colSpan: 12, block: { kind: 'nope' } }] }],
    })).toThrow();
  });

  it('rejects a colSpan outside 1..12', () => {
    expect(() => ReportTemplateSchema.parse({
      ...minimal,
      rows: [{ id: 'r1', cells: [{ colSpan: 13, block: { kind: 'divider' } }] }],
    })).toThrow();
  });
});

describe('ReportParamSchema optionsSql', () => {
  it('accepts a select param with optionsSql', () => {
    const p = ReportParamSchema.parse({ id: 'site', label: 'Site', type: 'select', optionsSql: 'SELECT name FROM sites' });
    expect(p.optionsSql).toBe('SELECT name FROM sites');
  });

  it('leaves optionsSql undefined when omitted', () => {
    const p = ReportParamSchema.parse({ id: 'q', label: 'Query', type: 'text' });
    expect(p.optionsSql).toBeUndefined();
  });
});

describe('chart block chartType', () => {
  for (const chartType of ['bar', 'line', 'pie', 'area', 'donut', 'row', 'scatter'] as const) {
    it(`accepts chartType='${chartType}'`, () => {
      const parsed = BlockSchema.parse({
        kind: 'chart',
        chartType,
        query: { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] },
      });
      expect(parsed).toMatchObject({ kind: 'chart', chartType });
    });
  }

  it('rejects an unknown chartType', () => {
    expect(() => BlockSchema.parse({
      kind: 'chart', chartType: 'bogus',
      query: { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] },
    })).toThrow();
  });
});
