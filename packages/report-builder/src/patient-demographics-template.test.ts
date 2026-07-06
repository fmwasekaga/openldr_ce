import { describe, it, expect, vi } from 'vitest';
import { newDb } from 'pg-mem';
import { runBuilderQuery, getModel } from '@openldr/dashboards';
import { buildPatientDemographicsTemplate, seedPatientDemographicsTemplate, PATIENT_DEMOGRAPHICS_TEMPLATE_ID } from './patient-demographics-template';
import { ReportTemplateSchema } from './schema';
import { lintReportTemplate } from './lint';
import type { ReportTemplateStore } from './store';
import { resolveQueryParams } from './render/run-template';

describe('patient-demographics template', () => {
  it('builds a schema-valid, published, lint-clean template', () => {
    const t = buildPatientDemographicsTemplate();
    expect(t.id).toBe(PATIENT_DEMOGRAPHICS_TEMPLATE_ID);
    expect(t.status).toBe('published');
    expect(() => ReportTemplateSchema.parse(t)).not.toThrow();
    const issues = lintReportTemplate(t);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(issues.filter((i) => i.severity === 'warning')).toHaveLength(0); // asOf counted used via dimension.reference (Task 6)
  });

  it('groups by age_band with total/male/female conditional metrics + an asOf-bound reference', () => {
    const t = buildPatientDemographicsTemplate();
    const table = t.rows.flatMap((r) => r.cells).find((c) => c.block.kind === 'table')!;
    const src = (table.block as { source: any }).source;
    expect(src.dimension).toEqual({ key: 'age_band', reference: '{{param.asOf}}' });
    expect(src.metrics.map((m: any) => m.key)).toEqual(['total', 'male', 'female']);
    expect(src.metrics.find((m: any) => m.key === 'male').where).toEqual([{ dimension: 'gender', op: 'eq', value: 'male' }]);
  });
});

describe('seedPatientDemographicsTemplate', () => {
  function fakeStore(existing: unknown = undefined): ReportTemplateStore {
    return {
      list: vi.fn(), get: vi.fn(async () => existing as never),
      create: vi.fn(async (t) => t), update: vi.fn(), remove: vi.fn(),
    } as unknown as ReportTemplateStore;
  }
  it('creates the template when absent (returns 1)', async () => {
    const store = fakeStore(undefined);
    expect(await seedPatientDemographicsTemplate(store)).toBe(1);
    expect(store.create).toHaveBeenCalledOnce();
  });
  it('is idempotent when it already exists (returns 0, no create)', async () => {
    const store = fakeStore({ id: PATIENT_DEMOGRAPHICS_TEMPLATE_ID });
    expect(await seedPatientDemographicsTemplate(store)).toBe(0);
    expect(store.create).not.toHaveBeenCalled();
  });
});

describe('patient-demographics template end-to-end (Slice C acceptance)', () => {
  it('buckets patients into age bands with total/male/female counts, in band order', async () => {
    const t = buildPatientDemographicsTemplate();
    const table = t.rows.flatMap((r) => r.cells).find((c) => c.block.kind === 'table')!;
    const src = (table.block as { source: unknown }).source;
    const resolved = resolveQueryParams(src as never, { asOf: '2026-01-01' });
    const mem = newDb();
    mem.public.none('create table patients (gender text, birth_date text, managing_organization text)');
    mem.public.none(`insert into patients (gender, birth_date) values
      ('female','2023-01-01'),
      ('male','2015-01-01'),
      ('female','1990-01-01'),('male','1990-01-01'),
      ('male','1970-01-01'),('male','1970-01-01'),('female','1970-01-01')`);
    const db = mem.adapters.createKysely() as unknown as import('kysely').Kysely<any>;
    const res = await runBuilderQuery(db, getModel('patients')!, resolved as any);
    expect(res.columns.map((c) => c.key)).toEqual(['label', 'total', 'male', 'female']);
    expect(res.rows).toEqual([
      expect.objectContaining({ label: '0-4', total: 1, male: 0, female: 1 }),
      expect.objectContaining({ label: '5-14', total: 1, male: 1, female: 0 }),
      expect.objectContaining({ label: '25-49', total: 2, male: 1, female: 1 }),
      expect.objectContaining({ label: '50+', total: 3, male: 2, female: 1 }),
    ]);
  });
});
