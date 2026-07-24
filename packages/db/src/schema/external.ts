import type { Generated } from 'kysely';

interface ProvenanceColumns {
  source_system: string | null;
  plugin_id: string | null;
  plugin_version: string | null;
  batch_id: string | null;
  created_at: Generated<Date>;
}

export interface PatientsTable extends ProvenanceColumns {
  id: string;
  patient_guid: string | null;
  surname: string | null;
  firstname: string | null;
  date_of_birth: string | null;
  sex: string | null;
  national_id: string | null;
  phone: string | null;
  email: string | null;
  managing_organization: string | null;
  active: Generated<boolean>;
  replaced_by_id: string | null;
}

export interface LabRequestsTable extends ProvenanceColumns {
  id: string;
  request_id: string | null;
  patient_id: string | null;
  panel_code: string | null;
  panel_system: string | null;
  panel_desc: string | null;
  status: string | null;
  priority: string | null;
  authored_at: string | null;
}

export interface LabResultsTable extends ProvenanceColumns {
  id: string;
  request_id: string | null;
  observation_code: string | null;
  observation_system: string | null;
  observation_desc: string | null;
  result_type: string | null;
  numeric_value: number | null;
  numeric_units: string | null;
  coded_value: string | null;
  text_value: string | null;
  abnormal_flag: string | null;
  result_timestamp: string | null;
  patient_id: string | null;
  specimen_id: string | null;
}

export interface FacilitiesTable extends ProvenanceColumns {
  id: string;
  facility_code: string | null;
  facility_name: string | null;
  facility_type: string | null;
  source_resource: string | null;
}

export interface SpecimensTable extends ProvenanceColumns {
  id: string;
  patient_id: string | null;
  received_time: string | null;
  accession: string | null;
  status: string | null;
  type_code: string | null;
  type_text: string | null;
  origin: string | null;
}

export interface DiagnosticReportsTable extends ProvenanceColumns {
  id: string;
  patient_id: string | null;
  status: string | null;
  code_code: string | null;
  code_text: string | null;
  issued: string | null;
  effective: string | null;
  conclusion: string | null;
}

export interface QuestionnaireResponsesTable extends ProvenanceColumns {
  id: string;
  questionnaire: string | null;
  form_code: string | null;
  subject_id: string | null;
  authored: string | null;
  based_on_id: string | null;
  /** JSON string of the QuestionnaireResponse.item[] array (linkId/text/answer). */
  items: string | null;
}

export interface ExternalSchema {
  patients: PatientsTable;
  lab_requests: LabRequestsTable;
  lab_results: LabResultsTable;
  facilities: FacilitiesTable;
  specimens: SpecimensTable;
  diagnostic_reports: DiagnosticReportsTable;
  questionnaire_responses: QuestionnaireResponsesTable;
}

/**
 * Stable column lists per external flat table (so empty tables still get a CSV header).
 * Lives here — alongside the type-only schema — rather than in export-data.ts so browser-safe
 * consumers (e.g. @openldr/dashboards' model registry) can import it via the `@openldr/db/schema/external`
 * subpath WITHOUT dragging the `@openldr/db` barrel (and its `pg` driver) into a browser bundle.
 */
export const EXTERNAL_TABLE_COLUMNS: Record<keyof ExternalSchema, string[]> = {
  patients: ['id', 'patient_guid', 'surname', 'firstname', 'date_of_birth', 'sex', 'national_id', 'phone', 'email', 'managing_organization', 'active', 'replaced_by_id', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  lab_requests: ['id', 'request_id', 'patient_id', 'panel_code', 'panel_system', 'panel_desc', 'status', 'priority', 'authored_at', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  lab_results: ['id', 'request_id', 'observation_code', 'observation_system', 'observation_desc', 'result_type', 'numeric_value', 'numeric_units', 'coded_value', 'text_value', 'abnormal_flag', 'result_timestamp', 'patient_id', 'specimen_id', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  facilities: ['id', 'facility_code', 'facility_name', 'facility_type', 'source_resource', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  specimens: ['id', 'patient_id', 'received_time', 'accession', 'status', 'type_code', 'type_text', 'origin', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  diagnostic_reports: ['id', 'patient_id', 'status', 'code_code', 'code_text', 'issued', 'effective', 'conclusion', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  questionnaire_responses: ['id', 'questionnaire', 'form_code', 'subject_id', 'authored', 'based_on_id', 'items', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
};
