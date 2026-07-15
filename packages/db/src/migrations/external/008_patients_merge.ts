import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { booleanType, boolDefault, textType } from './dialect';

// Sync S6b: surface an intra-lab patient merge in the read model. `active` mirrors Patient.active;
// `replaced_by_id` is the survivor id from the Patient's replaced-by link. Defaults keep existing
// rows correct (active, not replaced). Runs on the external/analytics DB.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const bool = sql.raw(booleanType(engine));
  const text = sql.raw(textType(engine));
  await db.schema
    .alterTable('patients')
    .addColumn('active', bool, (c) => c.notNull().defaultTo(boolDefault(engine, true)))
    .execute();
  await db.schema.alterTable('patients').addColumn('replaced_by_id', text).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('patients').dropColumn('replaced_by_id').execute();
  await db.schema.alterTable('patients').dropColumn('active').execute();
}
