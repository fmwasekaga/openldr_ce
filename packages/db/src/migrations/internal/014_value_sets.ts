import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('value_sets')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('url', 'text', (c) => c.notNull())
    .addColumn('version', 'text')
    .addColumn('name', 'text')
    .addColumn('title', 'text')
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('draft'))
    .addColumn('experimental', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('description', 'text')
    .addColumn('compose', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('source_json', 'jsonb')
    .addColumn('immutable', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('category', 'text')
    .addColumn('publisher_id', 'text')
    .addColumn('expanded_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .createIndex('value_sets_url_key').ifNotExists().unique()
    .on('value_sets').column('url').execute();
  await db.schema
    .createIndex('value_sets_publisher').ifNotExists()
    .on('value_sets').column('publisher_id').execute();

  await db.schema
    .createTable('valueset_expansions')
    .ifNotExists()
    .addColumn('value_set_id', 'text', (c) => c.notNull().references('value_sets.id').onDelete('cascade'))
    .addColumn('system_url', 'text', (c) => c.notNull())
    .addColumn('code', 'text', (c) => c.notNull())
    .addColumn('display', 'text')
    .addColumn('inactive', 'boolean', (c) => c.notNull().defaultTo(false))
    .addPrimaryKeyConstraint('valueset_expansions_pk', ['value_set_id', 'system_url', 'code'])
    .execute();
  await db.schema
    .createIndex('valueset_expansions_vs').ifNotExists()
    .on('valueset_expansions').column('value_set_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('valueset_expansions').ifExists().execute();
  await db.schema.dropTable('value_sets').ifExists().execute();
}
