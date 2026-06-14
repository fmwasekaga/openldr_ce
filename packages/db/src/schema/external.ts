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
  identifier_system: string | null;
  identifier_value: string | null;
  family_name: string | null;
  given_name: string | null;
  gender: string | null;
  birth_date: string | null;
  managing_organization: string | null;
}

export interface SpecimensTable extends ProvenanceColumns {
  id: string;
  identifier_value: string | null;
  accession: string | null;
  status: string | null;
  type_code: string | null;
  type_text: string | null;
  subject_ref: string | null;
  parent_ref: string | null;
  received_time: string | null;
  origin: string | null;
}

export interface ServiceRequestsTable extends ProvenanceColumns {
  id: string;
  identifier_value: string | null;
  status: string | null;
  intent: string | null;
  priority: string | null;
  code_code: string | null;
  code_text: string | null;
  subject_ref: string | null;
  authored_on: string | null;
}

export interface DiagnosticReportsTable extends ProvenanceColumns {
  id: string;
  identifier_value: string | null;
  status: string | null;
  code_code: string | null;
  code_text: string | null;
  subject_ref: string | null;
  effective_date_time: string | null;
  issued: string | null;
  conclusion: string | null;
}

export interface ObservationsTable extends ProvenanceColumns {
  id: string;
  identifier_value: string | null;
  status: string | null;
  code_code: string | null;
  code_text: string | null;
  subject_ref: string | null;
  specimen_ref: string | null;
  value_quantity: number | null;
  value_unit: string | null;
  value_code: string | null;
  value_text: string | null;
  interpretation_code: string | null;
  effective_date_time: string | null;
}

export interface OrganizationsTable extends ProvenanceColumns {
  id: string;
  identifier_value: string | null;
  name: string | null;
  type_text: string | null;
  part_of_ref: string | null;
}

export interface LocationsTable extends ProvenanceColumns {
  id: string;
  identifier_value: string | null;
  status: string | null;
  name: string | null;
  type_text: string | null;
  managing_organization: string | null;
  part_of_ref: string | null;
}

export interface ExternalSchema {
  patients: PatientsTable;
  specimens: SpecimensTable;
  service_requests: ServiceRequestsTable;
  diagnostic_reports: DiagnosticReportsTable;
  observations: ObservationsTable;
  organizations: OrganizationsTable;
  locations: LocationsTable;
}
