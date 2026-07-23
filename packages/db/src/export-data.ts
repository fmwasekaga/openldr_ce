import type { Kysely } from 'kysely';
import type { FhirResource } from '@openldr/fhir';
import type { InternalSchema } from './schema/internal';
// EXTERNAL_TABLE_COLUMNS now lives in ./schema/external (a browser-safe, type-only module) so
// front-end consumers can import it without pulling the pg-backed @openldr/db barrel. Imported
// here for exportFlatTables; the barrel re-exports it via `export * from './schema/external'`.
import { type ExternalSchema, EXTERNAL_TABLE_COLUMNS } from './schema/external';

export interface TableExport {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

/** All canonical resources (the `resource` jsonb of every fhir_resources row), ordered by type+id. */
export async function exportCanonicalResources(db: Kysely<InternalSchema>): Promise<FhirResource[]> {
  const rows = await db.selectFrom('fhir.fhir_resources').select('resource').orderBy('resource_type').orderBy('id').execute();
  return rows.map((r) => r.resource as unknown as FhirResource);
}

/** Every row of each external flat table (explicit per-table for clean typing). */
export async function exportFlatTables(db: Kysely<ExternalSchema>): Promise<TableExport[]> {
  return [
    { table: 'patients', columns: EXTERNAL_TABLE_COLUMNS.patients, rows: (await db.selectFrom('patients').selectAll().execute()) as Record<string, unknown>[] },
    { table: 'facilities', columns: EXTERNAL_TABLE_COLUMNS.facilities, rows: (await db.selectFrom('facilities').selectAll().execute()) as Record<string, unknown>[] },
    { table: 'specimens', columns: EXTERNAL_TABLE_COLUMNS.specimens, rows: (await db.selectFrom('specimens').selectAll().execute()) as Record<string, unknown>[] },
    { table: 'lab_requests', columns: EXTERNAL_TABLE_COLUMNS.lab_requests, rows: (await db.selectFrom('lab_requests').selectAll().execute()) as Record<string, unknown>[] },
    { table: 'lab_results', columns: EXTERNAL_TABLE_COLUMNS.lab_results, rows: (await db.selectFrom('lab_results').selectAll().execute()) as Record<string, unknown>[] },
    { table: 'diagnostic_reports', columns: EXTERNAL_TABLE_COLUMNS.diagnostic_reports, rows: (await db.selectFrom('diagnostic_reports').selectAll().execute()) as Record<string, unknown>[] },
  ];
}
