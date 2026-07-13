import type { Kysely } from 'kysely';
import type { FhirResource } from '@openldr/fhir';
import type { InternalSchema } from './schema/internal';
import type { ExternalSchema } from './schema/external';

export interface TableExport {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

/** Stable column lists per external flat table (so empty tables still get a CSV header). */
export const EXTERNAL_TABLE_COLUMNS: Record<keyof ExternalSchema, string[]> = {
  patients: ['id', 'identifier_system', 'identifier_value', 'family_name', 'given_name', 'gender', 'birth_date', 'managing_organization', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  specimens: ['id', 'identifier_value', 'accession', 'status', 'type_code', 'type_text', 'subject_ref', 'parent_ref', 'received_time', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  service_requests: ['id', 'identifier_value', 'status', 'intent', 'priority', 'code_code', 'code_text', 'subject_ref', 'authored_on', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  diagnostic_reports: ['id', 'identifier_value', 'status', 'code_code', 'code_text', 'subject_ref', 'effective_date_time', 'issued', 'conclusion', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  observations: ['id', 'identifier_value', 'status', 'code_code', 'code_text', 'subject_ref', 'specimen_ref', 'value_quantity', 'value_unit', 'value_code', 'value_text', 'interpretation_code', 'effective_date_time', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  organizations: ['id', 'identifier_value', 'name', 'type_text', 'part_of_ref', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  locations: ['id', 'identifier_value', 'status', 'name', 'type_text', 'managing_organization', 'part_of_ref', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  v2_patients: ['id', 'patient_guid', 'surname', 'firstname', 'date_of_birth', 'sex', 'national_id', 'phone', 'email', 'managing_organization', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  v2_lab_requests: ['id', 'request_id', 'patient_id', 'panel_code', 'panel_system', 'panel_desc', 'status', 'priority', 'authored_at', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  v2_lab_results: ['id', 'request_id', 'observation_code', 'observation_system', 'observation_desc', 'result_type', 'numeric_value', 'numeric_units', 'coded_value', 'text_value', 'abnormal_flag', 'result_timestamp', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  v2_facilities: ['id', 'facility_code', 'facility_name', 'facility_type', 'source_resource', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
};

/** All canonical resources (the `resource` jsonb of every fhir_resources row), ordered by type+id. */
export async function exportCanonicalResources(db: Kysely<InternalSchema>): Promise<FhirResource[]> {
  const rows = await db.selectFrom('fhir.fhir_resources').select('resource').orderBy('resource_type').orderBy('id').execute();
  return rows.map((r) => r.resource as unknown as FhirResource);
}

/** Every row of each external flat table (explicit per-table for clean typing). */
export async function exportFlatTables(db: Kysely<ExternalSchema>): Promise<TableExport[]> {
  return [
    { table: 'patients', columns: EXTERNAL_TABLE_COLUMNS.patients, rows: (await db.selectFrom('patients').selectAll().execute()) as Record<string, unknown>[] },
    { table: 'organizations', columns: EXTERNAL_TABLE_COLUMNS.organizations, rows: (await db.selectFrom('organizations').selectAll().execute()) as Record<string, unknown>[] },
    { table: 'locations', columns: EXTERNAL_TABLE_COLUMNS.locations, rows: (await db.selectFrom('locations').selectAll().execute()) as Record<string, unknown>[] },
    { table: 'specimens', columns: EXTERNAL_TABLE_COLUMNS.specimens, rows: (await db.selectFrom('specimens').selectAll().execute()) as Record<string, unknown>[] },
    { table: 'service_requests', columns: EXTERNAL_TABLE_COLUMNS.service_requests, rows: (await db.selectFrom('service_requests').selectAll().execute()) as Record<string, unknown>[] },
    { table: 'diagnostic_reports', columns: EXTERNAL_TABLE_COLUMNS.diagnostic_reports, rows: (await db.selectFrom('diagnostic_reports').selectAll().execute()) as Record<string, unknown>[] },
    { table: 'observations', columns: EXTERNAL_TABLE_COLUMNS.observations, rows: (await db.selectFrom('observations').selectAll().execute()) as Record<string, unknown>[] },
  ];
}
