import { ReportTemplateSchema, type ReportTemplate } from '../schema';
import { createEmptyTemplate } from '../helpers';
import { buildAmrResistanceTemplate } from '../amr-resistance-template';

export const STARTER_IDS = ['blank', 'amr-resistance', 'test-volume', 'patient-demographics', 'specimen-results'] as const;
export type StarterId = (typeof STARTER_IDS)[number];

export interface StarterMeta {
  id: StarterId;
  /** Display token for the gallery badge — resolved to a label via i18n. NOT the template's enum category. */
  category: 'general' | 'amr' | 'operational' | 'quality';
}

const META: Record<StarterId, StarterMeta> = {
  'blank': { id: 'blank', category: 'general' },
  'amr-resistance': { id: 'amr-resistance', category: 'amr' },
  'test-volume': { id: 'test-volume', category: 'operational' },
  'patient-demographics': { id: 'patient-demographics', category: 'quality' },
  'specimen-results': { id: 'specimen-results', category: 'operational' },
};

export function listStarters(): StarterMeta[] {
  return STARTER_IDS.map((id) => META[id]);
}

// A builder query over `model` with a count metric by default; merge `extra` for dimension/breakdown/metric.
function q(model: string, extra: Record<string, unknown> = {}) {
  return { mode: 'builder' as const, model, metric: { key: 'count', label: 'Count', agg: 'count' as const }, filters: [], ...extra };
}

function testVolume(): ReportTemplate {
  return ReportTemplateSchema.parse({
    id: 'rt-starter-test-volume', name: 'Test Volume',
    description: 'Monthly test order volume and top tests.', category: 'operational', status: 'draft',
    parameters: [],
    rows: [
      { id: 'r1', cells: [{ colSpan: 12, block: { kind: 'title', text: 'Test Volume', style: { bold: true, fontSize: 20 } } }] },
      { id: 'r2', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Test order volume across the laboratory.', style: { italic: true } } }] },
      { id: 'r3', cells: [
        { colSpan: 6, block: { kind: 'kpi', label: 'Total test orders', query: q('service_requests') } },
        { colSpan: 6, block: { kind: 'kpi', label: 'Distinct patients', query: q('service_requests', { metric: { key: 'distinct_subjects', label: 'Distinct Patients', agg: 'count_distinct', column: 'subject_ref' } }) } },
      ] },
      { id: 'r4', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Monthly order volume by status', style: { bold: true } } }] },
      { id: 'r5', cells: [{ colSpan: 12, block: { kind: 'chart', chartType: 'area', visual: {}, query: q('service_requests', { dimension: { key: 'authored_on', grain: 'month' }, breakdown: { key: 'status' } }) } }] },
      { id: 'r6', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Orders by test', style: { bold: true } } }] },
      { id: 'r7', cells: [{ colSpan: 12, block: { kind: 'table', source: q('service_requests', { dimension: { key: 'code_text' } }), columns: [] } }] },
    ],
  });
}

function patientDemographics(): ReportTemplate {
  return ReportTemplateSchema.parse({
    id: 'rt-starter-patient-demographics', name: 'Patient Demographics',
    description: 'Patient counts by gender.', category: 'quality', status: 'draft',
    parameters: [],
    rows: [
      { id: 'r1', cells: [{ colSpan: 12, block: { kind: 'title', text: 'Patient Demographics', style: { bold: true, fontSize: 20 } } }] },
      { id: 'r2', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Registered patients by gender.', style: { italic: true } } }] },
      { id: 'r3', cells: [
        { colSpan: 5, block: { kind: 'kpi', label: 'Total patients', query: q('patients') } },
        { colSpan: 7, block: { kind: 'chart', chartType: 'donut', visual: {}, query: q('patients', { dimension: { key: 'gender' } }) } },
      ] },
    ],
  });
}

function specimenResults(): ReportTemplate {
  return ReportTemplateSchema.parse({
    id: 'rt-starter-specimen-results', name: 'Specimen & Results',
    description: 'Specimen types and result summaries.', category: 'operational', status: 'draft',
    parameters: [],
    rows: [
      { id: 'r1', cells: [{ colSpan: 12, block: { kind: 'title', text: 'Specimen & Results', style: { bold: true, fontSize: 20 } } }] },
      { id: 'r2', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Specimen types received and results by analyte.', style: { italic: true } } }] },
      { id: 'r3', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Specimens by type', style: { bold: true } } }] },
      { id: 'r4', cells: [{ colSpan: 12, block: { kind: 'chart', chartType: 'row', visual: {}, query: q('specimens', { dimension: { key: 'type_text' } }) } }] },
      { id: 'r5', cells: [{ colSpan: 12, block: { kind: 'text', content: 'Results by analyte', style: { bold: true } } }] },
      { id: 'r6', cells: [{ colSpan: 12, block: { kind: 'table', source: q('observations', { dimension: { key: 'code_text' } }), columns: [] } }] },
    ],
  });
}

export function getStarterTemplate(id: StarterId): ReportTemplate {
  switch (id) {
    case 'blank': return createEmptyTemplate('rt-starter-blank', 'Untitled report');
    case 'amr-resistance': return { ...buildAmrResistanceTemplate(), status: 'draft' };
    case 'test-volume': return testVolume();
    case 'patient-demographics': return patientDemographics();
    case 'specimen-results': return specimenResults();
    default: throw new Error(`Unknown starter id: ${String(id)}`);
  }
}
