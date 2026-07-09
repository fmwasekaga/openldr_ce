import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('reports')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('category', 'text', (c) => c.notNull())
    .addColumn('design_id', 'text', (c) => c.notNull())
    .addColumn('primary_query_id', 'text', (c) => c.notNull())
    .addColumn('summary_metrics', 'jsonb')
    .addColumn('chart', 'jsonb')
    .addColumn('param_options', 'jsonb')
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('draft'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('reports').ifExists().execute();
}
