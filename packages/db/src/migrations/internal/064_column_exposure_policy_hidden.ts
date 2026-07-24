import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('column_exposure_policy')
    .addColumn('hidden', 'boolean', (c) => c.notNull().defaultTo(true))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('column_exposure_policy').dropColumn('hidden').execute();
}
