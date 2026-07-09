import { describe, it, expect } from 'vitest';
import { listReportDefs, deleteReportDef } from './report-def';
import type { ReportRecord } from '@openldr/db';

function reportDef(id: string, name: string, extra: Partial<ReportRecord> = {}): ReportRecord {
  return {
    id,
    name,
    description: '',
    category: 'general',
    designId: 'd1',
    primaryQueryId: 'q1',
    summaryMetrics: null,
    chart: null,
    paramOptions: null,
    status: 'draft',
    ...extra,
  };
}

function fakeStore(seed: ReportRecord[] = []) {
  const data = [...seed];
  return {
    list: async () => data,
    get: async (id: string) => data.find((d) => d.id === id),
    create: async (d: ReportRecord) => { data.push(d); return d; },
    update: async (id: string, d: ReportRecord) => { const i = data.findIndex((x) => x.id === id); data[i] = d; return d; },
    remove: async (id: string) => { const i = data.findIndex((x) => x.id === id); if (i >= 0) data.splice(i, 1); },
    __data: data,
  };
}

describe('report-def CLI handlers', () => {
  it('listReportDefs emits ids, names, categories and statuses (text)', async () => {
    const out: string[] = [];
    const write = (s: string) => { out.push(s); };
    await listReportDefs(fakeStore([reportDef('rd1', 'Main', { category: 'amr', status: 'published' })]) as any, { json: false }, write);
    const text = out.join('');
    expect(text).toContain('rd1');
    expect(text).toContain('Main');
    expect(text).toContain('amr');
    expect(text).toContain('published');
  });

  it('listReportDefs emits a placeholder when empty (text)', async () => {
    const out: string[] = [];
    await listReportDefs(fakeStore() as any, { json: false }, (s) => out.push(s));
    expect(out.join('')).toContain('(no reports)');
  });

  it('listReportDefs emits JSON when --json', async () => {
    const out: string[] = [];
    await listReportDefs(fakeStore([reportDef('rd1', 'Main')]) as any, { json: true }, (s) => out.push(s));
    const parsed = JSON.parse(out.join(''));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('rd1');
  });

  it('deleteReportDef requires force', async () => {
    const store = fakeStore([reportDef('rd1', 'Main')]);
    await expect(deleteReportDef(store as any, 'rd1', { force: false })).rejects.toThrow(/--force/);
    expect(store.__data.length).toBe(1);
    await deleteReportDef(store as any, 'rd1', { force: true });
    expect(store.__data.length).toBe(0);
  });
});
