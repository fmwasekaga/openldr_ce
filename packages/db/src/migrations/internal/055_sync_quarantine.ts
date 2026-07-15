import { type Kysely, sql } from 'kysely';

// Distributed sync S7-A: lab-side durable failure counter for poison bulk (terminology) records. When a
// hold-record's apply fails `threshold` consecutive times, the pull runner quarantines it (advances past
// so the stream isn't wedged) and records it here for operator visibility + manual retry. Keyed by the
// record's entity so a system that keeps failing is tracked as one row. Public schema (lab operational
// state), sibling of reference_change_log / sync_amendments.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('sync_quarantine')
    .addColumn('entity_type', 'text', (c) => c.notNull())
    .addColumn('entity_id', 'text', (c) => c.notNull())
    .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('status', 'text', (c) => c.notNull())
    .addColumn('last_error', 'text')
    .addColumn('last_seq', 'bigint')
    .addColumn('first_failed_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('quarantined_at', 'timestamptz')
    .addPrimaryKeyConstraint('sync_quarantine_pkey', ['entity_type', 'entity_id'])
    .execute();
}
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('sync_quarantine').execute();
}
