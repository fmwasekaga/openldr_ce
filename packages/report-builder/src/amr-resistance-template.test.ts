import { describe, it, expect, vi } from 'vitest';
import { newDb } from 'pg-mem';
import { runBuilderQuery, getModel } from '@openldr/dashboards';
import { ReportTemplateSchema } from './schema';
import type { ReportTemplateStore } from './store';
import { buildAmrResistanceTemplate, seedAmrResistanceTemplate, AMR_RESISTANCE_TEMPLATE_ID } from './amr-resistance-template';
import { resolveQueryParams } from './render/run-template';
import { lintReportTemplate } from './lint';

function tableSource() {
  const t = buildAmrResistanceTemplate();
  const block = t.rows.flatMap((r) => r.cells.map((c) => c.block)).find((b) => b.kind === 'table')!;
  return (block as { source: unknown }).source;
}

describe('buildAmrResistanceTemplate', () => {
  it('produces a schema-valid published AMR template', () => {
    const t = buildAmrResistanceTemplate();
    expect(() => ReportTemplateSchema.parse(t)).not.toThrow();
    expect(t.id).toBe(AMR_RESISTANCE_TEMPLATE_ID);
    expect(t.status).toBe('published');
    expect(t.category).toBe('amr');
  });

  it('has a table source with tested/r/i/s conditional counts + a derived %R', () => {
    const src = tableSource() as { metrics: { key: string; derived?: unknown }[] };
    expect(src.metrics.map((m) => m.key)).toEqual(['tested', 'r', 'i', 's', 'percentR']);
    expect(src.metrics.find((m) => m.key === 'percentR')?.derived).toEqual({ numerator: 'r', denominator: 'tested', scale: 100, decimals: 1 });
  });

  it('includes a facility select param and a facility filter (Slice D)', () => {
    const t = buildAmrResistanceTemplate();
    const facilityParam = t.parameters.find((p) => p.id === 'facility');
    expect(facilityParam).toMatchObject({ id: 'facility', type: 'select' });
    expect(facilityParam?.optionsSql).toMatch(/managing_organization/i);
    const table = t.rows.flatMap((r) => r.cells).find((c) => c.block.kind === 'table')!;
    const src = (table.block as { source: any }).source;
    expect(src.filters).toEqual(expect.arrayContaining([{ dimension: 'facility', op: 'eq', value: '{{param.facility}}' }]));
  });

  it('stays lint-clean with the facility param (bound in a filter → counted used)', () => {
    const issues = lintReportTemplate(buildAmrResistanceTemplate());
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(issues.filter((i) => i.severity === 'warning')).toHaveLength(0);
  });
});

describe('seedAmrResistanceTemplate', () => {
  function fakeStore(existing: unknown = undefined): ReportTemplateStore {
    return {
      list: vi.fn(), get: vi.fn(async () => existing as never),
      create: vi.fn(async (t) => t), update: vi.fn(), remove: vi.fn(),
    } as unknown as ReportTemplateStore;
  }
  it('creates the template when absent (returns 1)', async () => {
    const store = fakeStore(undefined);
    expect(await seedAmrResistanceTemplate(store)).toBe(1);
    expect(store.create).toHaveBeenCalledOnce();
  });
  it('is idempotent when it already exists (returns 0, no create)', async () => {
    const store = fakeStore({ id: AMR_RESISTANCE_TEMPLATE_ID });
    expect(await seedAmrResistanceTemplate(store)).toBe(0);
    expect(store.create).not.toHaveBeenCalled();
  });
});

describe('amr-resistance template end-to-end (Slice G acceptance)', () => {
  it('reproduces amr-resistance numbers incl %R when the query runs', async () => {
    const resolved = resolveQueryParams(tableSource() as never, {}); // unset range → date filters dropped
    const mem = newDb();
    mem.public.none('create table observations (status text, code_text text, interpretation_code text, value_unit text, value_quantity float, effective_date_time text, subject_ref text)');
    mem.public.none(`insert into observations (code_text, interpretation_code) values
      ('Ciprofloxacin','R'),('Ciprofloxacin','R'),('Ciprofloxacin','I'),('Ciprofloxacin','S'),
      ('Gentamicin','R'),('Gentamicin','S'),('Gentamicin','S')`);
    const db = mem.adapters.createKysely() as unknown as import('kysely').Kysely<any>;
    const res = await runBuilderQuery(db, getModel('observations')!, resolved as any);
    expect(res.columns.map((c) => c.key)).toEqual(['label', 'tested', 'r', 'i', 's', 'percentR']);
    expect(res.columns.find((c) => c.key === 'percentR')?.kind).toBe('percent');
    expect(res.rows).toContainEqual(expect.objectContaining({ label: 'Ciprofloxacin', tested: 4, r: 2, i: 1, s: 1, percentR: 50 }));
    expect(res.rows).toContainEqual(expect.objectContaining({ label: 'Gentamicin', tested: 3, r: 1, i: 0, s: 2, percentR: 33.3 }));
  });
});
