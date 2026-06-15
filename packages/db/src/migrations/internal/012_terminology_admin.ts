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

  // Plain unique index on url (not partial) — pg-mem does not support partial indexes
  // reliably. Postgres treats multiple NULLs as distinct in a regular unique index on a
  // nullable column (NULLS NOT DISTINCT is off by default), so this is safe in practice.
  // Backfill is added in a later task.
  await db.schema
    .createIndex('coding_systems_url_uq')
    .ifNotExists()
    .unique()
    .on('coding_systems')
    .column('url')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('coding_systems').ifExists().execute();
  await db.schema.dropTable('publishers').ifExists().execute();
}
