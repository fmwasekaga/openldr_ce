import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('publishers')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('role', 'text', (c) => c.notNull())
    .addColumn('icon', 'text')
    .addColumn('match_prefixes', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('seeded', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('sort_order', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();

  await db.schema
    .createTable('coding_systems')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('system_code', 'text', (c) => c.notNull())
    .addColumn('system_name', 'text', (c) => c.notNull())
    .addColumn('url', 'text')
    .addColumn('system_version', 'text')
    .addColumn('description', 'text')
    .addColumn('active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('publisher_id', 'text', (c) => c.references('publishers.id').onDelete('set null'))
    .addColumn('seeded', 'boolean', (c) => c.notNull().defaultTo(false))
    .execute();

  // Partial unique index: enforce uniqueness only on non-NULL urls so multiple
  // draft/internal systems (url = NULL) can coexist. pg-mem ignores the WHERE
  // predicate, but it is correct and explicit on real Postgres.
  await db.schema
    .createIndex('coding_systems_url_uq')
    .ifNotExists()
    .unique()
    .on('coding_systems')
    .column('url')
    .where('url', 'is not', null)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('coding_systems').ifExists().execute();
  await db.schema.dropTable('publishers').ifExists().execute();
}
