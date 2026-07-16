import { type Kysely, sql } from 'kysely';

// Distributed sync S7 (A1): what each enrolled lab REPORTS it has consumed, per stream.
//
// WHY: central holds two append-only logs that labs consume REMOTELY — reference_change_log (S2) and
// sync_amendments (S6a). Trimming either needs the SLOWEST consumer's position, and central could not
// compute it: it recorded a lab's pull position ONLY on the offline-bundle path, never on HTTP (the
// primary transport), and never for amendments at all. This table is how central learns the frontier.
// It is the prerequisite for retention; retention itself is a later slice.
//
// `seq` is the site's reported fromSeq — what it HAS consumed, not what it is about to. Understating
// costs disk; overstating costs records.
//
// ⚠ NEVER CLAMP THIS TO max(stored, incoming). Every OTHER cursor here is monotonic
// (advanceChangeCursor, the runners' `if (target > cursor)`), so this looks like a missing guard. It
// is not. A local cursor is a PROGRESS COUNTER — regression means a bug, guard it. A reported cursor
// is a SAFETY FLOOR — its only job is "what must central not delete yet?" A lab restoring from backup
// legitimately regresses 5000 -> 100 and needs 100-5000 AGAIN. Clamping keeps central at 5000, a later
// slice trims that range, and the lab permanently loses records it is actively asking for — on the
// disaster-recovery path. A regression is INFORMATION, not an error.
//
// Public schema (operational state), sibling of sync_sites / sync_quarantine / sync_divergences.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('sync_site_cursors')
    .addColumn('site_id', 'text', (c) => c.notNull())
    .addColumn('consumer', 'text', (c) => c.notNull())   // 'sync-pull' | 'sync-amend-pull'
    .addColumn('seq', 'bigint', (c) => c.notNull())
    .addColumn('reported_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    // One row per (site, stream) — a CURRENT position, not an append log. A re-report overwrites.
    .addPrimaryKeyConstraint('sync_site_cursors_pkey', ['site_id', 'consumer'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('sync_site_cursors').execute();
}
