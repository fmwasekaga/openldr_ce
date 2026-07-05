import { ReportTemplateSchema, type ReportTemplate } from './schema';
import type { ReportTemplateStore } from './store';

export const SAMPLE_REPORT_ID = 'rt-sample-amr';

// A builder query over the seeded `service_requests` model (test orders). Count metric by default.
function ordersQuery(extra: Record<string, unknown> = {}) {
  return {
    mode: 'builder' as const,
    model: 'service_requests',
    metric: { key: 'count', label: 'Orders', agg: 'count' as const },
    filters: [],
    ...extra,
  };
}

/**
 * A ready-to-explore sample report: an AMR-flavoured surveillance summary bound to the real
 * `service_requests` model, so the builder canvas shows live data immediately. Published, so it
 * also appears in the Reports library. No parameters/filters — every block renders full data with
 * no setup (and no lint warnings) as a clean starting point to edit.
 */
export function buildSampleReportTemplate(): ReportTemplate {
  return ReportTemplateSchema.parse({
    id: SAMPLE_REPORT_ID,
    name: 'AMR Surveillance Summary',
    description: 'Sample report — test order volume and patient counts. Edit me in the builder.',
    category: 'amr',
    status: 'published',
    page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
    parameters: [],
    rows: [
      { id: 'r1', cells: [{ colSpan: 12, block: { kind: 'title', text: 'AMR Surveillance Summary', style: { bold: true, fontSize: 20 } } }] },
      { id: 'r2', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Test order volume and patient counts across the laboratory.', style: { italic: true } } }] },
      {
        id: 'r3',
        cells: [
          { colSpan: 6, block: { kind: 'kpi', label: 'Total test orders', query: ordersQuery() } },
          { colSpan: 6, block: { kind: 'kpi', label: 'Distinct patients', query: ordersQuery({ metric: { key: 'distinct_subjects', label: 'Distinct Patients', agg: 'count_distinct', column: 'subject_ref' } }) } },
        ],
      },
      { id: 'r4', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Monthly order volume by status', style: { bold: true } } }] },
      { id: 'r5', cells: [{ colSpan: 12, block: { kind: 'chart', chartType: 'line', visual: {}, query: ordersQuery({ dimension: { key: 'authored_on', grain: 'month' }, breakdown: { key: 'status' } }) } }] },
      { id: 'r6', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Orders by test', style: { bold: true } } }] },
      { id: 'r7', cells: [{ colSpan: 12, block: { kind: 'table', source: ordersQuery({ dimension: { key: 'code_text' } }), columns: [] } }] },
    ],
  });
}

/** Seed the sample report template if absent. Idempotent; returns 1 when created, 0 when it already existed. */
export async function seedSampleReportTemplate(store: Pick<ReportTemplateStore, 'get' | 'create'>): Promise<number> {
  if (await store.get(SAMPLE_REPORT_ID)) return 0;
  await store.create(buildSampleReportTemplate());
  return 1;
}
