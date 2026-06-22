import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('marketplace_publishers')
    .ifNotExists()
    .addColumn('publisher_id', 'text', (c) => c.primaryKey())
    .addColumn('key_fingerprint', 'text', (c) => c.notNull())
    .addColumn('publisher_name', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('pinned_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('approved_by', 'text')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('marketplace_publishers').ifExists().execute();
}
