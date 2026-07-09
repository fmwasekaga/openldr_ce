import { type Kysely, sql } from 'kysely';

// The deprecated @openldr/report-builder subsystem (PDF-only "Report Builder" templates,
// source:'builder') has been fully retired — Report Designer's data-driven reports (the
// `reports`/`report_designs` tables from migrations 042/043) superseded it. Drops the
// `report_templates` table created in migration 040. Destructive: any operator-authored
// builder templates are lost. `down` recreates the empty table (mirrors 040's `up`) — no data
// is restored.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('report_templates').ifExists().execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
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
