import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('fhir_resources')
    .ifNotExists()
    .addColumn('resource_type', 'text', (c) => c.notNull())
    .addColumn('id', 'text', (c) => c.notNull())
    .addColumn('version_id', 'text')
    .addColumn('resource', 'jsonb', (c) => c.notNull())
    .addColumn('source_system', 'text')
    .addColumn('plugin_id', 'text')
    .addColumn('plugin_version', 'text')
    .addColumn('batch_id', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('fhir_resources_pkey', ['resource_type', 'id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('fhir_resources').ifExists().execute();
}
