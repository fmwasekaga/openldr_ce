import { type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('terminology_concepts')
    .ifNotExists()
    .addColumn('system', 'text', (c) => c.notNull())
    .addColumn('code', 'text', (c) => c.notNull())
    .addColumn('display', 'text')
    .addColumn('status', 'text')
    .addColumn('properties', 'jsonb')
    .addPrimaryKeyConstraint('terminology_concepts_pk', ['system', 'code'])
    .execute();

  await db.schema
    .createTable('terminology_systems')
    .ifNotExists()
    .addColumn('url', 'text', (c) => c.primaryKey())
    .addColumn('version', 'text')
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('resource_id', 'text', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('concept_map_elements')
    .ifNotExists()
    .addColumn('map_url', 'text', (c) => c.notNull())
    .addColumn('source_system', 'text', (c) => c.notNull())
    .addColumn('source_code', 'text', (c) => c.notNull())
    .addColumn('target_system', 'text', (c) => c.notNull())
    .addColumn('target_code', 'text', (c) => c.notNull())
    .addColumn('equivalence', 'text')
    .execute();
  await db.schema
    .createIndex('concept_map_elements_lookup')
    .ifNotExists()
    .on('concept_map_elements')
    .columns(['map_url', 'source_system', 'source_code'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('concept_map_elements').ifExists().execute();
  await db.schema.dropTable('terminology_systems').ifExists().execute();
  await db.schema.dropTable('terminology_concepts').ifExists().execute();
}
