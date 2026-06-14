import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType } from './dialect';

export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  await db.schema.alterTable('specimens').addColumn('origin', sql.raw(textType(engine))).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('specimens').dropColumn('origin').execute();
}
