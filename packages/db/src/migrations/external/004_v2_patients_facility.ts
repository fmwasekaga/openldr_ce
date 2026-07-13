import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType } from './dialect';

// R3b: the patient-demographics report cutover needs the facility filter column on v2_patients.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  await db.schema.alterTable('v2_patients').addColumn('managing_organization', sql.raw(textType(engine))).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('v2_patients').dropColumn('managing_organization').execute();
}
