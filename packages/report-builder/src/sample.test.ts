import { describe, it, expect, vi } from 'vitest';
import { ReportTemplateSchema } from './schema';
import { buildSampleReportTemplate, seedSampleReportTemplate, SAMPLE_REPORT_ID } from './sample';
import type { ReportTemplateStore } from './store';

describe('buildSampleReportTemplate', () => {
  it('produces a schema-valid, published AMR template', () => {
    const t = buildSampleReportTemplate();
    expect(() => ReportTemplateSchema.parse(t)).not.toThrow();
    expect(t.id).toBe(SAMPLE_REPORT_ID);
    expect(t.status).toBe('published');
    expect(t.category).toBe('amr');
  });

  it('contains title, kpi, chart, and table blocks bound to a real model', () => {
    const kinds = buildSampleReportTemplate().rows.flatMap((r) => r.cells.map((c) => c.block.kind));
    expect(kinds).toEqual(expect.arrayContaining(['title', 'kpi', 'chart', 'table']));
    // every data block targets the service_requests model
    const t = buildSampleReportTemplate();
    for (const row of t.rows) for (const cell of row.cells) {
      const b = cell.block;
      if (b.kind === 'kpi' || b.kind === 'chart') expect((b.query as { model?: string }).model).toBe('service_requests');
    }
  });

  it('leaves parameters empty so the seeded report renders cleanly with no lint warnings', () => {
    expect(buildSampleReportTemplate().parameters).toEqual([]);
  });
});

describe('seedSampleReportTemplate', () => {
  function fakeStore(existing: unknown = undefined): ReportTemplateStore {
    return {
      list: vi.fn(),
      get: vi.fn(async () => existing as never),
      create: vi.fn(async (t) => t),
      update: vi.fn(),
      remove: vi.fn(),
    } as unknown as ReportTemplateStore;
  }

  it('creates the sample when absent (returns 1)', async () => {
    const store = fakeStore(undefined);
    expect(await seedSampleReportTemplate(store)).toBe(1);
    expect(store.create).toHaveBeenCalledOnce();
  });

  it('is idempotent when the sample already exists (returns 0, no create)', async () => {
    const store = fakeStore({ id: SAMPLE_REPORT_ID });
    expect(await seedSampleReportTemplate(store)).toBe(0);
    expect(store.create).not.toHaveBeenCalled();
  });
});
