import { type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('workflow_datasets').addColumn('published_table', 'text').execute();
}
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('workflow_datasets').dropColumn('published_table').execute();
}
