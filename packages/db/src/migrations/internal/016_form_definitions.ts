import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('form_definitions')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('version_label', 'text')
    .addColumn('fhir_resource_type', 'text')
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('draft'))
    .addColumn('active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('schema', 'jsonb', (c) => c.notNull())
    .addColumn('target_pages', 'jsonb')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema.createIndex('form_definitions_status').ifNotExists().on('form_definitions').column('status').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('form_definitions').ifExists().execute();
}
