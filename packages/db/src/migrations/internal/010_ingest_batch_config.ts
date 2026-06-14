import { type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('ingest_batches').addColumn('config', 'jsonb').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('ingest_batches').dropColumn('config').execute();
}
