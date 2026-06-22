import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('report_runs')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('report_id', 'text', (c) => c.notNull())
    .addColumn('report_name', 'text', (c) => c.notNull())
    .addColumn('format', 'text', (c) => c.notNull())
    .addColumn('params', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('row_count', 'integer')
    .addColumn('user_id', 'text')
    .addColumn('user_name', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('report_runs_report_created_idx')
    .ifNotExists()
    .on('report_runs')
    .columns(['report_id', 'created_at desc'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('report_runs').ifExists().execute();
}
