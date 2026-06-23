import { type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('workflow_schedules').ifNotExists()
    .addColumn('workflow_id', 'text', (c) => c.notNull())
    .addColumn('node_id', 'text', (c) => c.notNull())
    .addColumn('cron', 'text', (c) => c.notNull())
    .addColumn('tz', 'text')
    .addColumn('enabled', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('next_due_at', 'timestamptz')
    .addPrimaryKeyConstraint('workflow_schedules_pk', ['workflow_id', 'node_id'])
    .execute();
}
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('workflow_schedules').ifExists().execute();
}
