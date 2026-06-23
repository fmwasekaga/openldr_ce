import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('marketplace_installs').ifNotExists()
    .addColumn('artifact_id', 'text', (c) => c.primaryKey())
    .addColumn('version', 'text', (c) => c.notNull())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('target_form_id', 'text', (c) => c.notNull())
    .addColumn('payload_sha256', 'text', (c) => c.notNull())
    .addColumn('publisher_name', 'text')
    .addColumn('source_ref', 'text')
    .addColumn('installed_by', 'text')
    .addColumn('installed_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('marketplace_installs').ifExists().execute();
}
