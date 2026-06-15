import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('term_mappings')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('from_system', 'text', (c) => c.notNull())
    .addColumn('from_code', 'text', (c) => c.notNull())
    .addColumn('to_system', 'text', (c) => c.notNull())
    .addColumn('to_code', 'text', (c) => c.notNull())
    .addColumn('to_display', 'text')
    .addColumn('map_type', 'text', (c) => c.notNull())
    .addColumn('relationship', 'text')
    .addColumn('owner', 'text')
    .addColumn('is_active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .createIndex('term_mappings_from')
    .ifNotExists()
    .on('term_mappings')
    .columns(['from_system', 'from_code'])
    .execute();
  await db.schema
    .createIndex('term_mappings_to')
    .ifNotExists()
    .on('term_mappings')
    .columns(['to_system', 'to_code'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('term_mappings').ifExists().execute();
}
