import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('workflow_runs').ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('workflow_id', 'text', (c) => c.notNull())
    .addColumn('trigger_source', 'text', (c) => c.notNull())
    .addColumn('status', 'text', (c) => c.notNull())
    .addColumn('started_at', 'timestamptz', (c) => c.notNull())
    .addColumn('finished_at', 'timestamptz', (c) => c.notNull())
    .addColumn('result', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('error', 'text')
    .execute();
  await db.schema.createIndex('idx_workflow_runs_wf').ifNotExists()
    .on('workflow_runs').columns(['workflow_id', 'started_at']).execute();
}
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('workflow_runs').ifExists().execute();
}
