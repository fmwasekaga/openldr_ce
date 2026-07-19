import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('sync_activity')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('occurred_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('direction', 'text', (c) => c.notNull()) // 'push' | 'pull' | 'amend'
    .addColumn('event', 'text', (c) => c.notNull()) // 'synced' | 'failed' | 'quarantined' | 'diverged'
    .addColumn('records', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('error', 'text')
    .addColumn('metadata', 'jsonb')
    .execute();
  await db.schema
    .createIndex('sync_activity_dir_occurred_idx')
    .ifNotExists()
    .on('sync_activity')
    .columns(['direction', 'occurred_at'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('sync_activity').ifExists().execute();
}
