import { type Kysely, sql } from 'kysely';

// Distributed sync S6a: central-side amendment outbox. When central amends a lab-owned resource
// (new version + Provenance), it records one row per resource here, in the same transaction as the
// fhir writes. The owning lab drains this over POST /api/sync/pull-amendments, site-scoped by seq.
// A pointer log (no body) — the serve reads the live body from fhir.resource_history at `version`.
// Sibling of reference_change_log; lives in the public schema (outside the frozen `fhir` schema).

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('sync_amendments')
    .addColumn('seq', 'bigserial', (c) => c.primaryKey())
    .addColumn('site_id', 'text', (c) => c.notNull())
    .addColumn('resource_type', 'text', (c) => c.notNull())
    .addColumn('resource_id', 'text', (c) => c.notNull())
    .addColumn('version', 'bigint', (c) => c.notNull())
    .addColumn('recorded_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('sync_amendments_site_seq_idx')
    .on('sync_amendments')
    .columns(['site_id', 'seq'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('sync_amendments').execute();
}
