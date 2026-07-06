import { ReportTemplateSchema, type ReportTemplate } from './schema';
import type { ReportTemplateStore } from './store';

export const AMR_FACILITY_SUMMARY_TEMPLATE_ID = 'rt-amr-facility-summary';

const dateFilters = [
  { dimension: 'effective_date_time', op: 'gte', value: '{{param.from}}' },
  { dimension: 'effective_date_time', op: 'lte', value: '{{param.to}}' },
];

/**
 * The built-in amr-facility-summary code report reproduced as an editable, published template using
 * the Slice-D cross-model join: per FACILITY (patients.managing_organization, joined to observations
 * via subject_ref), tested (all AST results) + resistant (R) counts. Optional date-range param.
 * Null-facility observations surface as a null bucket (the JS report drops them). Coexists.
 */
export function buildAmrFacilitySummaryTemplate(): ReportTemplate {
  return ReportTemplateSchema.parse({
    id: AMR_FACILITY_SUMMARY_TEMPLATE_ID,
    name: 'AMR Resistance by Facility',
    description: 'Tested vs resistant AST-result counts per facility.',
    category: 'amr',
    status: 'published',
    page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
    parameters: [{ id: 'dateRange', label: 'Date range', type: 'daterange', required: false }],
    rows: [
      { id: 'r1', cells: [{ colSpan: 12, block: { kind: 'title', text: 'AMR Resistance by Facility', style: { bold: true, fontSize: 20 } } }] },
      { id: 'r2', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Tested vs resistant AST-result counts per facility.', style: { italic: true } } }] },
      { id: 'r3', cells: [{ colSpan: 12, block: { kind: 'chart', chartType: 'bar', visual: {},
        query: { mode: 'builder', model: 'observations',
          metric: { key: 'resistant', label: 'Resistant', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }] },
          dimension: { key: 'facility' }, filters: dateFilters } } }] },
      { id: 'r4', cells: [{ colSpan: 12, block: {
        kind: 'table', columns: [],
        source: { mode: 'builder', model: 'observations',
          metric: { key: 'tested', label: 'Tested', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'in', value: ['S', 'I', 'R'] }] },
          metrics: [
            { key: 'tested', label: 'Tested', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'in', value: ['S', 'I', 'R'] }] },
            { key: 'resistant', label: 'Resistant', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }] },
          ],
          dimension: { key: 'facility' }, filters: dateFilters } } }] },
    ],
  });
}

/** Seed the amr-facility-summary template if absent. Idempotent; returns 1 when created, 0 when it existed. */
export async function seedAmrFacilitySummaryTemplate(store: Pick<ReportTemplateStore, 'get' | 'create'>): Promise<number> {
  if (await store.get(AMR_FACILITY_SUMMARY_TEMPLATE_ID)) return 0;
  await store.create(buildAmrFacilitySummaryTemplate());
  return 1;
}
