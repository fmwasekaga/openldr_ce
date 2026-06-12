import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('ingest_batches')
    .ifNotExists()
    .addColumn('batch_id', 'text', (c) => c.primaryKey())
    .addColumn('source', 'text')
    .addColumn('blob_key', 'text', (c) => c.notNull())
    .addColumn('content_type', 'text')
    .addColumn('converter', 'text', (c) => c.notNull())
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('received'))
    .addColumn('resource_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('last_error', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('ingest_batches').ifExists().execute();
}
