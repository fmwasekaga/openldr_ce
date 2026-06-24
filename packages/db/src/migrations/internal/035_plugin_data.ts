import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('plugin_data')
    .ifNotExists()
    .addColumn('plugin_id', 'text', (c) => c.notNull())
    .addColumn('collection', 'text', (c) => c.notNull())
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('doc', 'jsonb', (c) => c.notNull())
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('plugin_data_pk', ['plugin_id', 'collection', 'key'])
    .execute();
  await db.schema
    .createIndex('plugin_data_by_collection')
    .ifNotExists()
    .on('plugin_data')
    .columns(['plugin_id', 'collection'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('plugin_data').ifExists().execute();
}
