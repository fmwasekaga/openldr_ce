import { describe, it, expect, vi } from 'vitest';
import { newDb, DataType } from 'pg-mem';
import { runBuilderQuery, getModel } from '@openldr/dashboards';
import { ReportTemplateSchema } from './schema';
import type { ReportTemplateStore } from './store';
import { lintReportTemplate } from './lint';
import {
  buildAmrFacilitySummaryTemplate,
  seedAmrFacilitySummaryTemplate,
  AMR_FACILITY_SUMMARY_TEMPLATE_ID,
} from './amr-facility-summary-template';
import { resolveQueryParams } from './render/run-template';

function tableSource() {
  const t = buildAmrFacilitySummaryTemplate();
  const block = t.rows.flatMap((r) => r.cells.map((c) => c.block)).find((b) => b.kind === 'table')!;
  return (block as { source: unknown }).source;
}

describe('amr-facility-summary template', () => {
  it('builds a schema-valid, published, lint-clean template grouped by facility', () => {
    const t = buildAmrFacilitySummaryTemplate();
    expect(t.id).toBe(AMR_FACILITY_SUMMARY_TEMPLATE_ID);
    expect(t.status).toBe('published');
    expect(() => ReportTemplateSchema.parse(t)).not.toThrow();
    const issues = lintReportTemplate(t);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(issues.filter((i) => i.severity === 'warning')).toHaveLength(0);
    const table = t.rows.flatMap((r) => r.cells).find((c) => c.block.kind === 'table')!;
    const src = (table.block as { source: any }).source;
    expect(src.dimension).toEqual({ key: 'facility' });
    expect(src.metrics.map((m: any) => m.key)).toEqual(['tested', 'resistant']);
  });
});

describe('seedAmrFacilitySummaryTemplate', () => {
  function fakeStore(existing: unknown = undefined): ReportTemplateStore {
    return {
      list: vi.fn(), get: vi.fn(async () => existing as never),
      create: vi.fn(async (t) => t), update: vi.fn(), remove: vi.fn(),
    } as unknown as ReportTemplateStore;
  }
  it('creates the template when absent (returns 1)', async () => {
    const store = fakeStore(undefined);
    expect(await seedAmrFacilitySummaryTemplate(store)).toBe(1);
    expect(store.create).toHaveBeenCalledOnce();
  });
  it('is idempotent when it already exists (returns 0, no create)', async () => {
    const store = fakeStore({ id: AMR_FACILITY_SUMMARY_TEMPLATE_ID });
    expect(await seedAmrFacilitySummaryTemplate(store)).toBe(0);
    expect(store.create).not.toHaveBeenCalled();
  });
});

describe('amr-facility-summary template end-to-end (Slice D facility join acceptance)', () => {
  it('groups tested/resistant counts per facility via the patients LEFT JOIN, with no double-counting', async () => {
    const resolved = resolveQueryParams(tableSource() as never, {}); // unset range → date filters dropped
    const mem = newDb();
    // pg-mem implements very few native functions — replace() (used by the join key) is standard
    // Postgres SQL but not built into pg-mem, so register it for this test harness only.
    mem.public.registerFunction({
      name: 'replace',
      args: [DataType.text, DataType.text, DataType.text],
      returns: DataType.text,
      implementation: (str: string, from: string, to: string) => str.split(from).join(to),
    });
    mem.public.none(
      'create table observations (status text, code_text text, interpretation_code text, value_unit text, value_quantity float, effective_date_time text, subject_ref text)',
    );
    mem.public.none('create table patients (id text, managing_organization text)');
    mem.public.none(`insert into patients (id, managing_organization) values
      ('p1','Facility A'),('p2','Facility A'),('p3','Facility A'),
      ('p4','Facility B'),('p5','Facility B')`);
    mem.public.none(`insert into observations (subject_ref, interpretation_code) values
      ('Patient/p1','R'),('Patient/p2','R'),('Patient/p3','S'),
      ('Patient/p4','R'),('Patient/p5','I')`);
    const db = mem.adapters.createKysely() as unknown as import('kysely').Kysely<any>;
    const res = await runBuilderQuery(db, getModel('observations')!, resolved as any);
    expect(res.rows).toHaveLength(2);
    expect(res.rows).toContainEqual(expect.objectContaining({ label: 'Facility A', tested: 3, resistant: 2 }));
    expect(res.rows).toContainEqual(expect.objectContaining({ label: 'Facility B', tested: 2, resistant: 1 }));
  });
});
