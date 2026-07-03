import { type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('workflow_runs')
    .addColumn('correlation_id', 'text')
    .execute();
  await db.schema.createIndex('idx_workflow_runs_correlation').ifNotExists()
    .on('workflow_runs').columns(['correlation_id', 'started_at']).execute();
}
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_workflow_runs_correlation').ifExists().execute();
  await db.schema.alterTable('workflow_runs').dropColumn('correlation_id').execute();
}
