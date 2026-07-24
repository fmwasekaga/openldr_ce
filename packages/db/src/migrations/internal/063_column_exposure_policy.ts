import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('column_exposure_policy')
    .ifNotExists()
    .addColumn('table_name', 'text', (c) => c.notNull())
    .addColumn('column_name', 'text', (c) => c.notNull())
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_by', 'text')
    .addPrimaryKeyConstraint('column_exposure_policy_pk', ['table_name', 'column_name'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('column_exposure_policy').ifExists().execute();
}
