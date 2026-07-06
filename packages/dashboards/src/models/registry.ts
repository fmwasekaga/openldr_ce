import type { ExternalSchema } from '@openldr/db';
import type { Agg, DateGrain, DimensionKind } from '../types';

export interface AgeBandCompute {
  kind: 'age-band';
  bands: { maxAge: number; label: string }[]; // closed upper bounds, e.g. { maxAge: 4, label: '0-4' }
  openEndedLabel: string;                      // older than the last band, e.g. '50+'
  unknownLabel: string;                        // null / future birth_date, e.g. 'unknown'
}
export interface ModelDimension { key: string; label: string; column: string; kind: DimensionKind; dateGrain?: DateGrain[]; compute?: AgeBandCompute }
export interface ModelMetric { key: string; label: string; agg: Agg; column?: string }
export interface QueryModel { id: string; label: string; table: keyof ExternalSchema; dimensions: ModelDimension[]; metrics: ModelMetric[] }

const DATE_GRAINS: DateGrain[] = ['day', 'week', 'month', 'year'];
const COUNT: ModelMetric = { key: 'count', label: 'Count', agg: 'count' };

export const MODELS: QueryModel[] = [
  {
    id: 'service_requests', label: 'Test Orders', table: 'service_requests',
    dimensions: [
      { key: 'status', label: 'Status', column: 'status', kind: 'string' },
      { key: 'intent', label: 'Intent', column: 'intent', kind: 'string' },
      { key: 'priority', label: 'Priority', column: 'priority', kind: 'string' },
      { key: 'code_text', label: 'Test', column: 'code_text', kind: 'string' },
      { key: 'authored_on', label: 'Authored', column: 'authored_on', kind: 'date', dateGrain: DATE_GRAINS },
    ],
    metrics: [COUNT, { key: 'distinct_subjects', label: 'Distinct Patients', agg: 'count_distinct', column: 'subject_ref' }],
  },
  {
    id: 'observations', label: 'Results', table: 'observations',
    dimensions: [
      { key: 'status', label: 'Status', column: 'status', kind: 'string' },
      { key: 'code_text', label: 'Analyte', column: 'code_text', kind: 'string' },
      { key: 'interpretation_code', label: 'Interpretation', column: 'interpretation_code', kind: 'string' },
      { key: 'value_unit', label: 'Unit', column: 'value_unit', kind: 'string' },
      { key: 'effective_date_time', label: 'Effective', column: 'effective_date_time', kind: 'date', dateGrain: DATE_GRAINS },
    ],
    metrics: [COUNT, { key: 'avg_value', label: 'Avg Value', agg: 'avg', column: 'value_quantity' }],
  },
  {
    id: 'diagnostic_reports', label: 'Reports', table: 'diagnostic_reports',
    dimensions: [
      { key: 'status', label: 'Status', column: 'status', kind: 'string' },
      { key: 'code_text', label: 'Report Type', column: 'code_text', kind: 'string' },
      { key: 'issued', label: 'Issued', column: 'issued', kind: 'date', dateGrain: DATE_GRAINS },
    ],
    metrics: [COUNT],
  },
  {
    id: 'specimens', label: 'Specimens', table: 'specimens',
    dimensions: [
      { key: 'status', label: 'Status', column: 'status', kind: 'string' },
      { key: 'type_text', label: 'Type', column: 'type_text', kind: 'string' },
      { key: 'origin', label: 'Origin', column: 'origin', kind: 'string' },
      { key: 'received_time', label: 'Received', column: 'received_time', kind: 'date', dateGrain: DATE_GRAINS },
    ],
    metrics: [COUNT],
  },
  {
    id: 'patients', label: 'Patients', table: 'patients',
    dimensions: [
      { key: 'gender', label: 'Gender', column: 'gender', kind: 'string' },
      { key: 'managing_organization', label: 'Facility', column: 'managing_organization', kind: 'string' },
      { key: 'age_band', label: 'Age band', column: 'birth_date', kind: 'string',
        compute: { kind: 'age-band',
          bands: [{ maxAge: 4, label: '0-4' }, { maxAge: 14, label: '5-14' }, { maxAge: 24, label: '15-24' }, { maxAge: 49, label: '25-49' }],
          openEndedLabel: '50+', unknownLabel: 'unknown' } },
    ],
    metrics: [COUNT],
  },
  {
    id: 'organizations', label: 'Facilities', table: 'organizations',
    dimensions: [{ key: 'type_text', label: 'Type', column: 'type_text', kind: 'string' }],
    metrics: [COUNT],
  },
  {
    id: 'locations', label: 'Locations', table: 'locations',
    dimensions: [
      { key: 'status', label: 'Status', column: 'status', kind: 'string' },
      { key: 'type_text', label: 'Type', column: 'type_text', kind: 'string' },
    ],
    metrics: [COUNT],
  },
];

export function listModels(): QueryModel[] { return MODELS; }
export function getModel(id: string): QueryModel | undefined { return MODELS.find((m) => m.id === id); }
