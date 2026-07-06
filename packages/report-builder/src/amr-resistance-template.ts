import { ReportTemplateSchema, type ReportTemplate } from './schema';
import type { ReportTemplateStore } from './store';

export const AMR_RESISTANCE_TEMPLATE_ID = 'rt-amr-resistance';

/**
 * The built-in amr-resistance code report reproduced as an editable, published Report Builder
 * template using the conditional (Slice A) + derived-ratio (Slice B) query model: per antibiotic,
 * R/I/S/tested counts + %R over the `observations` model. An optional date-range parameter binds to
 * the effective-date filters (dropped when unset), and an optional facility select parameter binds to
 * a facility filter (Slice D cross-model join; dropped when unset, so all-facilities behavior is
 * unchanged). Coexists with the code report.
 */
export function buildAmrResistanceTemplate(): ReportTemplate {
  return ReportTemplateSchema.parse({
    id: AMR_RESISTANCE_TEMPLATE_ID,
    name: 'AMR Resistance Rate',
    description: 'Resistant/Intermediate/Susceptible counts and %R by antibiotic.',
    category: 'amr',
    status: 'published',
    page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
    parameters: [
      { id: 'dateRange', label: 'Date range', type: 'daterange', required: false },
      { id: 'facility', label: 'Facility', type: 'select', required: false, optionsSql: "select distinct managing_organization from patients where managing_organization is not null order by 1" },
    ],
    rows: [
      { id: 'r1', cells: [{ colSpan: 12, block: { kind: 'title', text: 'AMR Resistance Rate', style: { bold: true, fontSize: 20 } } }] },
      { id: 'r2', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Resistant/Intermediate/Susceptible counts and %R by antibiotic.', style: { italic: true } } }] },
      {
        id: 'r3',
        cells: [{
          colSpan: 12,
          block: {
            kind: 'table',
            columns: [],
            source: {
              mode: 'builder',
              model: 'observations',
              metric: { key: 'tested', label: 'Tested', agg: 'count' },
              metrics: [
                { key: 'tested', label: 'Tested', agg: 'count' },
                { key: 'r', label: 'R', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }] },
                { key: 'i', label: 'I', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'I' }] },
                { key: 's', label: 'S', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'S' }] },
                { key: 'percentR', label: '%R', agg: 'count', derived: { numerator: 'r', denominator: 'tested', scale: 100, decimals: 1 } },
              ],
              dimension: { key: 'code_text' },
              filters: [
                { dimension: 'interpretation_code', op: 'in', value: ['R', 'I', 'S'] },
                { dimension: 'effective_date_time', op: 'gte', value: '{{param.from}}' },
                { dimension: 'effective_date_time', op: 'lte', value: '{{param.to}}' },
                { dimension: 'facility', op: 'eq', value: '{{param.facility}}' },
              ],
            },
          },
        }],
      },
    ],
  });
}

/** Seed the amr-resistance template if absent. Idempotent; returns 1 when created, 0 when it existed. */
export async function seedAmrResistanceTemplate(store: Pick<ReportTemplateStore, 'get' | 'create'>): Promise<number> {
  if (await store.get(AMR_RESISTANCE_TEMPLATE_ID)) return 0;
  await store.create(buildAmrResistanceTemplate());
  return 1;
}
