import type { Kysely } from 'kysely';
import type { ExternalSchema, MergeResult } from '@openldr/db';
import type { AppContext } from './index';

// Sync S6b: read-model → FHIR resource type. Each table's `id` column is the FHIR resource id, and its
// `patient_id` column is the denormalized subject Patient id — the reverse index of "what references
// this patient".
const REF_TABLES: { table: keyof ExternalSchema & string; resourceType: string }[] = [
  { table: 'lab_requests', resourceType: 'ServiceRequest' },
  { table: 'lab_results', resourceType: 'Observation' },
  { table: 'specimens', resourceType: 'Specimen' },
  { table: 'diagnostic_reports', resourceType: 'DiagnosticReport' },
];

/** Orchestrate an intra-lab patient merge (Sync S6b): enumerate the resources referencing the duplicate
 *  from the external read model, then delegate the atomic version-bump cascade to fhirStore.mergePatients.
 *  Enumeration limitation (documented): a ref pushed up but not yet projected at central is missed; a
 *  re-run picks it up (re-point is idempotent, and the primitive guards ref type + same-site ownership). */
export async function mergePatients(
  ctx: AppContext,
  input: { survivorId: string; duplicateId: string; agent: string; reason?: string },
): Promise<MergeResult> {
  const edb = ctx.store.db as unknown as Kysely<ExternalSchema>;
  const referencingRefs: { resourceType: string; id: string }[] = [];
  for (const { table, resourceType } of REF_TABLES) {
    const rows = await edb.selectFrom(table).select('id').where('patient_id', '=', input.duplicateId).execute();
    for (const row of rows) referencingRefs.push({ resourceType, id: String((row as { id: unknown }).id) });
  }
  return ctx.fhirStore.mergePatients({ ...input, referencingRefs });
}
