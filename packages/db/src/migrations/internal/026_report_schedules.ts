import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('report_schedules')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('report_id', 'text', (c) => c.notNull())
    .addColumn('params', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('frequency', 'text', (c) => c.notNull())
    .addColumn('day_of_week', 'integer')
    .addColumn('day_of_month', 'integer')
    .addColumn('output_format', 'text', (c) => c.notNull())
    .addColumn('enabled', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('last_run_at', 'timestamptz')
    .addColumn('next_due_at', 'timestamptz')
    .addColumn('created_by', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('report_schedules_report_idx').ifNotExists()
    .on('report_schedules').column('report_id').execute();

  await db.schema
    .createTable('report_schedule_runs')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('schedule_id', 'text', (c) => c.notNull())
    .addColumn('report_id', 'text', (c) => c.notNull())
    .addColumn('report_name', 'text', (c) => c.notNull())
    .addColumn('run_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('period_start', 'timestamptz')
    .addColumn('period_end', 'timestamptz')
    .addColumn('output_format', 'text', (c) => c.notNull())
    .addColumn('object_key', 'text')
    .addColumn('byte_size', 'integer')
    .addColumn('row_count', 'integer')
    .addColumn('status', 'text', (c) => c.notNull())
    .addColumn('error_message', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('report_schedule_runs_schedule_created_idx').ifNotExists()
    .on('report_schedule_runs').columns(['schedule_id', 'created_at desc']).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('report_schedule_runs').ifExists().execute();
  await db.schema.dropTable('report_schedules').ifExists().execute();
}
