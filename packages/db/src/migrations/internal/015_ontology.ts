import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('ontology_distributions')
    .ifNotExists()
    .addColumn('coding_system_id', 'text', (c) => c.primaryKey())
    .addColumn('ontology_type', 'text', (c) => c.notNull())
    .addColumn('source_path', 'text', (c) => c.notNull())
    .addColumn('index_status', 'text', (c) => c.notNull().defaultTo('none'))
    .addColumn('index_error', 'text')
    .addColumn('node_count', 'integer')
    .addColumn('edge_count', 'integer')
    .addColumn('manifest', 'jsonb')
    .addColumn('built_at', 'timestamptz')
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('ontology_nodes')
    .ifNotExists()
    .addColumn('coding_system_id', 'text', (c) => c.notNull())
    .addColumn('code', 'text', (c) => c.notNull())
    .addColumn('display', 'text', (c) => c.notNull())
    .addColumn('kind', 'text')
    .addColumn('extra', 'jsonb')
    .addPrimaryKeyConstraint('ontology_nodes_pk', ['coding_system_id', 'code'])
    .execute();
  // Real Postgres can later add:
  // CREATE INDEX ... ON ontology_nodes (coding_system_id, lower(display)).
  // pg-mem cannot create expression indexes, and search works without it in tests.

  await db.schema
    .createTable('ontology_edges')
    .ifNotExists()
    .addColumn('coding_system_id', 'text', (c) => c.notNull())
    .addColumn('parent_code', 'text', (c) => c.notNull())
    .addColumn('child_code', 'text', (c) => c.notNull())
    .addColumn('seq', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('label', 'text')
    .execute();
  await db.schema
    .createIndex('ontology_edges_parent')
    .ifNotExists()
    .on('ontology_edges')
    .columns(['coding_system_id', 'parent_code'])
    .execute();
  await db.schema
    .createIndex('ontology_edges_child')
    .ifNotExists()
    .on('ontology_edges')
    .columns(['coding_system_id', 'child_code'])
    .execute();

  await db.schema
    .createTable('ontology_panel_members')
    .ifNotExists()
    .addColumn('coding_system_id', 'text', (c) => c.notNull())
    .addColumn('panel_loinc', 'text', (c) => c.notNull())
    .addColumn('member_loinc', 'text', (c) => c.notNull())
    .addColumn('member_name', 'text', (c) => c.notNull())
    .addColumn('display_name', 'text', (c) => c.notNull())
    .addColumn('sequence', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('required', 'boolean', (c) => c.notNull().defaultTo(false))
    .execute();
  await db.schema
    .createIndex('ontology_panel_members_panel')
    .ifNotExists()
    .on('ontology_panel_members')
    .columns(['coding_system_id', 'panel_loinc'])
    .execute();

  await db.schema
    .createTable('ontology_answer_options')
    .ifNotExists()
    .addColumn('coding_system_id', 'text', (c) => c.notNull())
    .addColumn('loinc', 'text', (c) => c.notNull())
    .addColumn('seq', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('value', 'text', (c) => c.notNull())
    .addColumn('label', 'text', (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('ontology_answer_options_loinc')
    .ifNotExists()
    .on('ontology_answer_options')
    .columns(['coding_system_id', 'loinc'])
    .execute();

  await db.schema
    .createTable('ontology_specimen_map')
    .ifNotExists()
    .addColumn('coding_system_id', 'text', (c) => c.notNull())
    .addColumn('loinc', 'text', (c) => c.notNull())
    .addColumn('snomed_code', 'text', (c) => c.notNull())
    .addColumn('equivalence', 'text', (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('ontology_specimen_map_loinc')
    .ifNotExists()
    .on('ontology_specimen_map')
    .columns(['coding_system_id', 'loinc'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    'ontology_specimen_map',
    'ontology_answer_options',
    'ontology_panel_members',
    'ontology_edges',
    'ontology_nodes',
    'ontology_distributions',
  ]) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
