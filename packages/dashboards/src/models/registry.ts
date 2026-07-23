// Import from the browser-safe `./schema/external` subpath, NOT the `@openldr/db` barrel: the barrel
// re-exports internal-db.ts (which imports `pg`), and pulling a runtime VALUE like EXTERNAL_TABLE_COLUMNS
// through it drags `pg` into the studio browser bundle (crashes with "Buffer is not defined").
import { type ExternalSchema, EXTERNAL_TABLE_COLUMNS } from '@openldr/db/schema/external';
import type { Agg, DateGrain, DimensionKind, Expr } from '../types';

export interface AgeBandCompute {
  kind: 'age-band';
  bands: { maxAge: number; label: string }[]; // closed upper bounds, e.g. { maxAge: 4, label: '0-4' }
  openEndedLabel: string;                      // older than the last band, e.g. '50+'
  unknownLabel: string;                        // null / future birth_date, e.g. 'unknown'
}
export interface ExprCompute { kind: 'expr'; expr: Expr }
export interface ModelJoin {
  table: keyof ExternalSchema;    // 'patients'
  alias: string;                  // 'jp'
  left: string;                   // base column: 'subject_ref'
  leftReplace?: [string, string]; // ['Patient/',''] → replace(base.left, 'Patient/', '')
  right: string;                  // joined column: 'id'
  optional?: boolean;      // offered in the "+ Add → Join data" picker instead of firing via a default dimension
  label?: string;          // display name for the join in the picker (defaults to the table name)
  denyColumns?: string[];  // columns that may NOT be exposed; REQUIRED for an optional join to be usable (fail-safe)
}
export interface ModelDimension { key: string; label: string; column: string; kind: DimensionKind; dateGrain?: DateGrain[]; compute?: AgeBandCompute | ExprCompute; join?: string }
export interface ModelMetric { key: string; label: string; agg: Agg; column?: string }
export interface QueryModel { id: string; label: string; table: keyof ExternalSchema; dimensions: ModelDimension[]; metrics: ModelMetric[]; joins?: ModelJoin[] }

const DATE_GRAINS: DateGrain[] = ['day', 'week', 'month', 'year'];
const COUNT: ModelMetric = { key: 'count', label: 'Count', agg: 'count' };

export const MODELS: QueryModel[] = [
  {
    id: 'service_requests', label: 'Test Orders', table: 'lab_requests',
    joins: [
      { table: 'patients', alias: 'jp', left: 'patient_id', right: 'id', optional: true, label: 'Patient',
        denyColumns: ['id', 'patient_guid', 'surname', 'firstname', 'national_id', 'phone', 'email', 'date_of_birth',
                      'replaced_by_id', 'plugin_id', 'plugin_version', 'batch_id'] },
    ],
    dimensions: [
      { key: 'status', label: 'Status', column: 'status', kind: 'string' },
      { key: 'priority', label: 'Priority', column: 'priority', kind: 'string' },
      { key: 'code_text', label: 'Test', column: 'panel_desc', kind: 'string' },
      { key: 'authored_on', label: 'Authored', column: 'authored_at', kind: 'date', dateGrain: DATE_GRAINS },
    ],
    metrics: [COUNT, { key: 'distinct_subjects', label: 'Distinct Patients', agg: 'count_distinct', column: 'patient_id' }],
  },
  {
    id: 'observations', label: 'Results', table: 'lab_results',
    joins: [
      { table: 'patients', alias: 'jp', left: 'patient_id', right: 'id' },
      { table: 'specimens', alias: 'js', left: 'specimen_id', right: 'id', optional: true, label: 'Specimen',
        denyColumns: ['id', 'patient_id', 'accession', 'source_system', 'plugin_id', 'plugin_version', 'batch_id'] },
      // Keyed on the business identifier `request_id` (not a PK): assumed unique per request in
      // well-formed data. If a source ever emits duplicate request_ids, this leftJoin can fan out and
      // inflate COUNT/aggregate metrics for widgets that pull in this relationship — an admin/data
      // assumption, unlike the PK-keyed `jp`/`js` joins.
      { table: 'lab_requests', alias: 'jr', left: 'request_id', right: 'request_id', optional: true, label: 'Request',
        denyColumns: ['id', 'request_id', 'patient_id', 'source_system', 'plugin_id', 'plugin_version', 'batch_id'] },
    ],
    dimensions: [
      { key: 'code_text', label: 'Analyte', column: 'observation_desc', kind: 'string' },
      { key: 'interpretation_code', label: 'Interpretation', column: 'abnormal_flag', kind: 'string' },
      { key: 'value_unit', label: 'Unit', column: 'numeric_units', kind: 'string' },
      { key: 'effective_date_time', label: 'Effective', column: 'result_timestamp', kind: 'date', dateGrain: DATE_GRAINS },
      { key: 'facility', label: 'Facility', column: 'managing_organization', kind: 'string', join: 'jp' },
    ],
    metrics: [COUNT, { key: 'avg_value', label: 'Avg Value', agg: 'avg', column: 'numeric_value' }],
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
      { key: 'gender', label: 'Gender', column: 'sex', kind: 'string' },
      { key: 'managing_organization', label: 'Facility', column: 'managing_organization', kind: 'string' },
      { key: 'age_band', label: 'Age band', column: 'date_of_birth', kind: 'string',
        compute: { kind: 'age-band',
          bands: [{ maxAge: 4, label: '0-4' }, { maxAge: 14, label: '5-14' }, { maxAge: 24, label: '15-24' }, { maxAge: 49, label: '25-49' }],
          openEndedLabel: '50+', unknownLabel: 'unknown' } },
    ],
    metrics: [COUNT],
  },
  {
    id: 'facilities', label: 'Facilities', table: 'facilities',
    dimensions: [
      { key: 'facility_type', label: 'Type', column: 'facility_type', kind: 'string' },
      { key: 'facility_name', label: 'Name', column: 'facility_name', kind: 'string' },
    ],
    metrics: [COUNT],
  },
];

export function listModels(): QueryModel[] { return MODELS; }
export function getModel(id: string): QueryModel | undefined { return MODELS.find((m) => m.id === id); }

/**
 * Columns a power user may expose from an OPTIONAL join, i.e. the joined table's columns minus the
 * join's `denyColumns`. Fail-safe: an optional join with an ABSENT OR EMPTY `denyColumns` exposes
 * nothing (returns []) — both are "not configured" and therefore unavailable, so a newly added join
 * never leaks columns until an admin declares its (non-empty) denylist.
 * Non-optional / unknown aliases return [] — only optional joins are user-selectable.
 */
export function exposableColumns(model: QueryModel, alias: string): string[] {
  const j = (model.joins ?? []).find((x) => x.alias === alias);
  if (!j || !j.optional || !j.denyColumns?.length) return [];
  const deny = new Set(j.denyColumns);
  return EXTERNAL_TABLE_COLUMNS[j.table].filter((c) => !deny.has(c));
}

export interface ClientOptionalJoin { alias: string; label: string; left: string; right: string; exposableColumns: string[] }
export type ClientQueryModel = Omit<QueryModel, 'joins'> & { optionalJoins?: ClientOptionalJoin[] };

/**
 * Model list shaped for the browser. Raw `joins`/`denyColumns` are dropped; each usable optional
 * join becomes `{ alias, label, left, right, exposableColumns }` where the columns are already
 * denylist-filtered, so denied PII column names never travel to the client. `left`/`right` are the
 * admin-declared join keys (FK column names), surfaced for read-only display. A join whose
 * `exposableColumns` is empty (fail-safe: no denylist declared) is omitted entirely.
 */
export function modelsForClient(models: QueryModel[] = MODELS): ClientQueryModel[] {
  return models.map((m) => {
    const optionalJoins = (m.joins ?? [])
      .filter((j) => j.optional)
      .map((j) => ({ alias: j.alias, label: j.label ?? j.table, left: j.left, right: j.right, exposableColumns: exposableColumns(m, j.alias) }))
      .filter((oj) => oj.exposableColumns.length > 0);
    const { id, label, table, dimensions, metrics } = m;
    return optionalJoins.length ? { id, label, table, dimensions, metrics, optionalJoins }
                                : { id, label, table, dimensions, metrics };
  });
}
