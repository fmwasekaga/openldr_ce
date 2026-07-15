import { type Kysely, sql } from 'kysely';

// Distributed sync S7: same-version divergence record. applyRemote's idempotency key is
// (resource_type, id, version) — when two sides independently author the SAME version with DIFFERENT
// content, the apply finds the key present and skips, silently dropping the incoming content. This
// table records what was dropped, at the moment it is dropped, inside the same transaction.
//
// Detect-and-surface only: there is no auto-heal. A row's EXISTENCE is the open state (no status
// column) — an operator clears it by DELETing it.
//
// local_hash / incoming_hash / incoming_body are NULLABLE: NULL = tombstone (no content). A lab may
// delete a resource at v2 while central amends it to v2 — a genuine delete-vs-edit divergence that
// MUST be representable. Two tombstones agree (both NULL) and are never recorded.
//
// Public schema (operational state), sibling of reference_change_log / sync_amendments /
// sync_quarantine. Lives on BOTH central and lab — each side records what IT dropped.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('sync_divergences')
    .addColumn('resource_type', 'text', (c) => c.notNull())
    .addColumn('resource_id', 'text', (c) => c.notNull())
    .addColumn('version', 'bigint', (c) => c.notNull())
    // Canonical hash of the body we KEPT / the body we DROPPED, volatile meta stripped. NULL = tombstone.
    .addColumn('local_hash', 'text')
    .addColumn('incoming_hash', 'text')
    // The dropped content itself (PHI). Stored so the divergence is diffable LOCALLY and OFFLINE — the
    // peer holding the other copy may be unreachable for days on these links. NULL = incoming tombstone.
    .addColumn('incoming_body', 'jsonb')
    .addColumn('incoming_site_id', 'text', (c) => c.notNull())
    .addColumn('detected_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    // PK grain = resource_history's grain, which is the grain at which divergence is defined. A resource
    // can diverge at v2 and again at v5 — two independent facts, two rows. Re-delivery of the same
    // diverged record hits this PK and no-ops (onConflict doNothing), so a stuck redelivery loop can
    // neither inflate the table nor churn detected_at.
    .addPrimaryKeyConstraint('sync_divergences_pkey', ['resource_type', 'resource_id', 'version'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('sync_divergences').execute();
}
