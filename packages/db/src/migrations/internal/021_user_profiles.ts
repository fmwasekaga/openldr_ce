import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('user_profiles')
    .addColumn('user_id', 'text', (c) => c.primaryKey())
    .addColumn('form_schema_id', 'text')
    .addColumn('form_version', 'integer')
    .addColumn('extras', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('user_profiles').execute();
}
