import { ReportTemplateSchema, type ReportTemplate } from './schema';
import type { ReportTemplateStore } from './store';

export const PATIENT_DEMOGRAPHICS_TEMPLATE_ID = 'rt-patient-demographics';

const ageBandDim = { key: 'age_band', reference: '{{param.asOf}}' };

/**
 * The built-in patient-demographics code report reproduced as an editable, published Report Builder
 * template: patient counts by the Slice-C computed `age_band` dimension × gender (total/male/female
 * via Slice-A conditional metrics). An optional `asOf` param binds the age-band reference date.
 * "Other/unknown" gender and the facility filter are deferred (need a notIn op / Slice D join).
 */
export function buildPatientDemographicsTemplate(): ReportTemplate {
  return ReportTemplateSchema.parse({
    id: PATIENT_DEMOGRAPHICS_TEMPLATE_ID,
    name: 'Patient Demographics',
    description: 'Patient counts by age band and gender.',
    category: 'quality',
    status: 'published',
    page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
    parameters: [{ id: 'asOf', label: 'As of (YYYY-MM-DD)', type: 'text', required: false }],
    rows: [
      { id: 'r1', cells: [{ colSpan: 12, block: { kind: 'title', text: 'Patient Demographics', style: { bold: true, fontSize: 20 } } }] },
      { id: 'r2', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Patient counts by age band and gender.', style: { italic: true } } }] },
      { id: 'r3', cells: [{ colSpan: 12, block: { kind: 'chart', chartType: 'pie', visual: {},
        query: { mode: 'builder', model: 'patients', metric: { key: 'count', label: 'Patients', agg: 'count' }, dimension: ageBandDim, filters: [] } } }] },
      { id: 'r4', cells: [{ colSpan: 12, block: {
        kind: 'table', columns: [],
        source: { mode: 'builder', model: 'patients',
          metric: { key: 'total', label: 'Total', agg: 'count' },
          metrics: [
            { key: 'total', label: 'Total', agg: 'count' },
            { key: 'male', label: 'Male', agg: 'count', where: [{ dimension: 'gender', op: 'eq', value: 'male' }] },
            { key: 'female', label: 'Female', agg: 'count', where: [{ dimension: 'gender', op: 'eq', value: 'female' }] },
          ],
          dimension: ageBandDim, filters: [] } } }] },
    ],
  });
}

/** Seed the patient-demographics template if absent. Idempotent; returns 1 when created, 0 when it existed. */
export async function seedPatientDemographicsTemplate(store: Pick<ReportTemplateStore, 'get' | 'create'>): Promise<number> {
  if (await store.get(PATIENT_DEMOGRAPHICS_TEMPLATE_ID)) return 0;
  await store.create(buildPatientDemographicsTemplate());
  return 1;
}
