import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('form_versions')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('form_id', 'text', (c) => c.notNull())
    .addColumn('version', 'integer', (c) => c.notNull())
    .addColumn('version_label', 'text')
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('fhir_resource_type', 'text')
    .addColumn('schema', 'jsonb', (c) => c.notNull())
    .addColumn('target_pages', 'jsonb')
    .addColumn('questionnaire', 'jsonb', (c) => c.notNull())
    .addColumn('published_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('published_by', 'text')
    .execute();

  await db.schema
    .createIndex('form_versions_form_version')
    .ifNotExists()
    .on('form_versions')
    .columns(['form_id', 'version'])
    .unique()
    .execute();

  await db.schema.createIndex('form_versions_form_id').ifNotExists().on('form_versions').column('form_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('form_versions').ifExists().execute();
}
