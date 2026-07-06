import { ReportTemplateSchema, type ReportTemplate } from './schema';
import type { ReportTemplateStore } from './store';

export const ANALYTE_INTERPRETATION_TEMPLATE_ID = 'rt-analyte-interpretation';

const dateFilters = [
  { dimension: 'effective_date_time', op: 'gte', value: '{{param.from}}' },
  { dimension: 'effective_date_time', op: 'lte', value: '{{param.to}}' },
];

/**
 * A pivot/matrix crosstab (Slice E): per analyte (code_text) row, one column per interpretation
 * (R/I/S) with the count as the cell. Renders via resultToMatrix (dimension=row, breakdown=column,
 * single metric=cell). An antibiogram-adjacent resistance profile; the FAITHFUL amr-antibiogram
 * (organism dimension + %R cell + first-isolate) is deferred. Coexists.
 */
export function buildAnalyteInterpretationTemplate(): ReportTemplate {
  return ReportTemplateSchema.parse({
    id: ANALYTE_INTERPRETATION_TEMPLATE_ID,
    name: 'Analyte × Interpretation',
    description: 'Result counts per analyte, broken down by interpretation (R/I/S).',
    category: 'amr',
    status: 'published',
    page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
    parameters: [{ id: 'dateRange', label: 'Date range', type: 'daterange', required: false }],
    rows: [
      { id: 'r1', cells: [{ colSpan: 12, block: { kind: 'title', text: 'Analyte × Interpretation', style: { bold: true, fontSize: 20 } } }] },
      { id: 'r2', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Result counts per analyte, broken down by interpretation (R/I/S).', style: { italic: true } } }] },
      { id: 'r3', cells: [{ colSpan: 12, block: {
        kind: 'table', columns: [],
        source: { mode: 'builder', model: 'observations',
          metric: { key: 'count', label: 'Count', agg: 'count' },
          dimension: { key: 'code_text' }, breakdown: { key: 'interpretation_code' }, filters: dateFilters } } }] },
    ],
  });
}

/** Seed the analyte-interpretation template if absent. Idempotent; returns 1 when created, 0 when it existed. */
export async function seedAnalyteInterpretationTemplate(store: Pick<ReportTemplateStore, 'get' | 'create'>): Promise<number> {
  if (await store.get(ANALYTE_INTERPRETATION_TEMPLATE_ID)) return 0;
  await store.create(buildAnalyteInterpretationTemplate());
  return 1;
}
