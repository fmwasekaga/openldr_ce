import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

// Distributed sync S7 (A1): what each lab REPORTS it has consumed, per stream (migration 057).
// Central holds two logs the labs consume remotely (reference_change_log, sync_amendments); trimming
// either needs the slowest consumer's position. This is how central learns it. Nothing trims yet.

/** The streams a site reports. Push is deliberately excluded — central needs no push frontier, and a
 *  recorded push cursor would look like lag without being lag. */
export type ReportedConsumer = 'sync-pull' | 'sync-amend-pull';

export interface SyncSiteCursorRow {
  siteId: string;
  consumer: ReportedConsumer;
  seq: number;
  reportedAt: Date;
}

export interface SyncSiteCursorStore {
  /** Record what the site says it has consumed. Overwrites — see the never-clamp note below. */
  report(siteId: string, consumer: ReportedConsumer, seq: number): Promise<void>;
  /** The site's reported position, or **0** when never reported. 0 means "give it everything"
   *  (exportPullBundle relies on this); undefined would mean "give it nothing". */
  get(siteId: string, consumer: ReportedConsumer): Promise<number>;
  list(): Promise<SyncSiteCursorRow[]>;
}

export function createSyncSiteCursorStore(db: Kysely<InternalSchema>): SyncSiteCursorStore {
  return {
    async report(siteId, consumer, seq) {
      // ⚠ NO MONOTONIC GUARD, AND THAT IS DELIBERATE. Every other cursor in this codebase clamps with
      // `if (target > cursor)` — because those are PROGRESS COUNTERS, where regression means a bug.
      // This is a SAFETY FLOOR: "what must central not delete yet?" A lab restoring from backup
      // legitimately regresses 5000 -> 100 and needs 100-5000 AGAIN. max() would keep central at 5000,
      // let a later slice trim that range, and permanently destroy records the lab is asking for — on
      // the disaster-recovery path. A regression is INFORMATION. Do not "fix" this.
      await db
        .insertInto('sync_site_cursors')
        .values({ site_id: siteId, consumer, seq })
        .onConflict((oc) =>
          oc.columns(['site_id', 'consumer']).doUpdateSet({ seq, reported_at: sql`now()` }),
        )
        .execute();
    },
    async get(siteId, consumer) {
      const r = await db
        .selectFrom('sync_site_cursors')
        .select('seq')
        .where('site_id', '=', siteId)
        .where('consumer', '=', consumer)
        .executeTakeFirst();
      // bigint reads back as string on real pg, number on pg-mem — always coerce. `?? 0` is
      // load-bearing: exportPullBundle treats 0 as "full snapshot" for a never-seen lab.
      return Number(r?.seq ?? 0);
    },
    async list() {
      const rows = await db
        .selectFrom('sync_site_cursors')
        .selectAll()
        .orderBy('site_id', 'asc')
        .orderBy('consumer', 'asc')
        .execute();
      return rows.map((r) => ({
        siteId: r.site_id,
        consumer: r.consumer as ReportedConsumer,
        seq: Number(r.seq),
        reportedAt: r.reported_at,
      }));
    },
  };
}
