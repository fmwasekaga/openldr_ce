import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType } from './dialect';

// R3d: the AMR reports derive isolates/AST at query time and need obs->patient / obs->specimen
// linkage on v2_lab_results plus specimen origin on v2_specimens (which the thin tables carried
// as subject_ref/specimen_ref and specimens.origin). Additive columns only.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  await db.schema.alterTable('v2_lab_results').addColumn('patient_id', text).execute();
  await db.schema.alterTable('v2_lab_results').addColumn('specimen_id', text).execute();
  await db.schema.alterTable('v2_specimens').addColumn('origin', text).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('v2_lab_results').dropColumn('patient_id').execute();
  await db.schema.alterTable('v2_lab_results').dropColumn('specimen_id').execute();
  await db.schema.alterTable('v2_specimens').dropColumn('origin').execute();
}
