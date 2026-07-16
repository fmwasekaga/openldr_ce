import { type Kysely } from 'kysely';

// Distributed sync S7 (A1): sync_sites.reported_pull_cursor (migration 052) is superseded by
// sync_site_cursors (057). It only ever tracked ONE stream ('sync-pull') and was written ONLY by the
// offline-bundle path — never by HTTP, which is the primary transport. Keeping it beside the new table
// would leave two sources of truth for the same fact, written by two transports, for a later retention
// slice to reconcile. One source of truth instead.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('sync_sites').dropColumn('reported_pull_cursor').execute();
}

// Restores the column but NOT its data — the values live in sync_site_cursors now. A down-migration
// past 057 loses the reported positions, which is safe: they are re-reported on the next pull, and
// nothing trims against them in this slice.
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('sync_sites').addColumn('reported_pull_cursor', 'bigint').execute();
}
