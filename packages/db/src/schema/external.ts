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

export interface ExternalSchema {
  patients: PatientsTable;
  lab_requests: LabRequestsTable;
  lab_results: LabResultsTable;
  facilities: FacilitiesTable;
  specimens: SpecimensTable;
  diagnostic_reports: DiagnosticReportsTable;
}
