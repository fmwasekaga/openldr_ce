import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('report_templates')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('category', 'text', (c) => c.notNull().defaultTo('operational'))
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('draft'))
    .addColumn('page', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('parameters', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('dataset', 'jsonb')
    .addColumn('rows', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('report_templates').ifExists().execute();
}
