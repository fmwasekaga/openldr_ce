import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('terminology_ingest_jobs')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('system_type', 'text', (c) => c.notNull())
    .addColumn('coding_system_id', 'text', (c) => c.notNull())
    .addColumn('blob_key', 'text', (c) => c.notNull())
    .addColumn('version', 'text')
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('queued'))
    .addColumn('phase', 'text')
    .addColumn('processed', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('total', 'bigint')
    .addColumn('error', 'text')
    .addColumn('created_by', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('started_at', 'timestamptz')
    .addColumn('finished_at', 'timestamptz')
    // App-managed mirror of `system_type`, populated only while the job is active
    // (queued|running) and cleared to NULL by `finish`. A plain unique index on this column
    // enforces "at most one active job per system_type" via ordinary NULL-distinctness
    // semantics, equivalent to a `WHERE status IN ('queued','running')` partial unique index
    // on `system_type` -- but unlike a WHERE-clause partial index, it doesn't require the
    // planner to reason about a partial predicate. (A WHERE-based partial index was tried
    // first; pg-mem, used by this package's migration tests, mishandles it: after a row's
    // status transitions out of the partial predicate, pg-mem's planner incorrectly excludes
    // that row from *any* later query filtering on `system_type`, even queries with no status
    // filter -- e.g. `latestForSystem`. Reproduced in isolation, including via raw SQL, so it's
    // a pg-mem planner bug, not a Kysely issue. This column sidesteps it while giving identical
    // real-Postgres uniqueness guarantees.)
    .addColumn('active_key', 'text')
    .execute();

  await sql`
    create unique index if not exists terminology_ingest_jobs_one_active
    on terminology_ingest_jobs (active_key)
  `.execute(db);

  await db.schema
    .createIndex('terminology_ingest_jobs_system_created')
    .ifNotExists()
    .on('terminology_ingest_jobs')
    .columns(['system_type', 'created_at'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('terminology_ingest_jobs').ifExists().execute();
}
