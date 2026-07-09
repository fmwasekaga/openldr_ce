import { describe, it, expect } from 'vitest';
import { buildReportingForTest } from './index';

const design = { id: 'd1', name: 'AMR', paper: 'A4', orientation: 'portrait',
  parameters: [{ key: 'facility', label: 'Facility', type: 'select', value: '' }],
  pages: [{ id: 'p', elements: [{ id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 10, h: 10 },
    dataSource: { kind: 'custom-query', queryId: 'q1' } }] }] } as any;
const def = { id: 'r1', name: 'AMR', description: '', category: 'amr', designId: 'd1',
  primaryQueryId: 'q1', summaryMetrics: null, chart: { type: 'bar', x: 'a', y: 'b' },
  paramOptions: { facility: 'q-fac' }, status: 'published' } as any;

let lastRunStoredQueryValues: Record<string, unknown> | undefined;
const deps = {
  reportDefs: { list: async () => [def], get: async (id: string) => id === 'r1' ? def : undefined },
  reportDesigns: { get: async (id: string) => id === 'd1' ? design : undefined },
  runStoredQuery: async (queryId: string, values: Record<string, unknown>) => {
    lastRunStoredQueryValues = values;
    return queryId === 'q-fac'
      ? { columns: [{ key: 'v', label: 'v' }], rows: [{ v: 'Ndola' }, { v: 'Lusaka' }] }
      : { columns: [{ key: 'a', label: 'a' }], rows: [{ a: 1 }, { a: 2 }] };
  },
  resolveDesignTables: async () => new Map([['t', { columns: [{ key: 'a', label: 'a' }], rows: [{ a: 1 }] }]]),
  renderReportDesignPdf: async () => Buffer.from('%PDF-1.4 fake'),
};

describe('reporting data-driven branch', () => {
  const reporting = buildReportingForTest(deps as any);

  it('listAll includes the published report record', async () => {
    expect((await reporting.listAll()).some((s) => s.id === 'r1' && s.source === 'design')).toBe(true);
  });
  it('findSummary resolves a report record', async () => {
    expect((await reporting.findSummary('r1'))?.name).toBe('AMR');
  });
  it('run executes the primary query and attaches the chart', async () => {
    const r = await reporting.run('r1', { facility: 'Ndola' });
    expect(r.rows).toHaveLength(2);
    expect(r.chart).toEqual({ type: 'bar', x: 'a', y: 'b' });
  });
  it('run applies the design default for an omitted optional param instead of throwing', async () => {
    const r = await reporting.run('r1', {});
    expect(r.rows).toHaveLength(2);
    expect(lastRunStoredQueryValues).toEqual({ facility: '' });
  });
  it('renderPdf resolves tables and returns a PDF buffer', async () => {
    expect((await reporting.renderPdf('r1', { facility: 'Ndola' })).toString()).toContain('%PDF');
  });
  it('options resolves select dropdowns from paramOptions queries', async () => {
    expect(await reporting.options('r1')).toEqual({ facility: ['Ndola', 'Lusaka'] });
  });
});
