import type { FhirResource } from '@openldr/fhir';
import { planProjection, type FetchSafeRows, type Gap, type Logger } from '@openldr/db';
import type { PushBatch, PushResponse, SyncRecord } from './batch';

// The internal Kysely handle, derived from FetchSafeRows' first parameter (Kysely<InternalSchema>) so
// this package needs no direct `kysely` dependency.
type InternalDb = Parameters<FetchSafeRows>[0];

// Injected dependencies for the push runner. Kept pure over its deps so the frontier + transport are
// fakeable in tests (no real DB). `fetchSafeRows` mirrors ProjectionDeps.fetch — the bootstrap host
// (Task 7) wires it to db's `fetchSafeChangeRows` and cursor/token/transport deps to their real impls
// bound to the 'sync-push' consumer.
export interface PushDeps {
  internalDb: InternalDb; // passed to fetchSafeRows + used for the change_log version/site_id read
  fetchSafeRows: FetchSafeRows; // (db, cursor, limit) => { rows, boundary, xmax } — the safe-frontier fetch
  fetchContent: (resourceType: string, id: string, version: number) => Promise<FhirResource | null>; // upsert body
  postPush: (batch: PushBatch, token: string) => Promise<PushResponse>;
  getToken: () => Promise<string>;
  readCursor: () => Promise<number>; // change_cursors consumer 'sync-push'
  advanceCursor: (seq: number) => Promise<void>;
  logger: Logger;
  batchSize?: number;
}

export interface SyncPushRunner {
  runCycle(): Promise<number>;
}

/** A stateful push runner. Mirrors createProjectionRunner's safe-frontier handling exactly: each cycle
 *  reads the 'sync-push' cursor, fetches the safe change rows + snapshot bounds, plans (carrying
 *  `pendingGaps` across cycles in this closure so rolled-back gaps confirm once the xmin boundary
 *  advances), then — unlike projection, which projects deduped current state — replays EVERY safe change
 *  row faithfully as an ordered `SyncRecord` (origin version + op + siteId verbatim) to central via
 *  postPush. On success the cursor advances to central's `ackSeq` (which for S1 covers handled-and-
 *  rejected records too), so a persistently-rejected record is logged, skipped, and never replays
 *  (quarantine). On transport failure the cursor is NOT advanced and the cycle retries. */
export function createSyncPushRunner(deps: PushDeps): SyncPushRunner {
  let pendingGaps: Gap[] = [];
  return {
    async runCycle(): Promise<number> {
      const cursor = await deps.readCursor();
      const { rows, boundary, xmax } = await deps.fetchSafeRows(deps.internalDb, cursor, deps.batchSize ?? 500);
      const plan = planProjection({ rows, boundary, xmax, cursor, pendingGaps });
      pendingGaps = plan.pendingGaps;

      // The planner's `tasks` are deduped current-state keys — unusable for a faithful change replay.
      // Re-filter the raw rows to the SAFE prefix using the SAME predicate the planner uses to build its
      // tasks (seq within the advanced frontier AND committed: xid < boundary). This yields one record
      // per safe change, in seq order, un-deduped.
      const safeRows = rows.filter((r) => r.seq <= plan.newCursor && r.xid < boundary);

      if (safeRows.length === 0) {
        // No records to push this cycle. Still advance past any confirmed-rolled-back gaps the planner
        // cleared, exactly like projection moves its frontier over a pure-gap cycle.
        if (plan.newCursor > cursor) await deps.advanceCursor(plan.newCursor);
        return 0;
      }

      // ChangeRow carries neither `version` nor `site_id`; both are immutable append-only facts of the
      // change_log row and the planner has already confirmed these seqs committed + final, so a plain
      // read (outside the frontier snapshot) is safe. Fetch them keyed by seq for the safe range.
      const metaRows = await deps.internalDb
        .selectFrom('fhir.change_log')
        .select(['seq', 'version', 'site_id'])
        .where('seq', '>', cursor)
        .where('seq', '<=', plan.newCursor)
        .execute();
      const metaBySeq = new Map<number, { version: number; siteId: string }>();
      for (const m of metaRows) metaBySeq.set(Number(m.seq), { version: Number(m.version), siteId: m.site_id ?? '' });

      const records: (SyncRecord & { seq: number })[] = [];
      for (const r of safeRows) {
        const md = metaBySeq.get(r.seq);
        const version = md?.version ?? 0;
        const siteId = md?.siteId ?? '';
        const op: 'upsert' | 'delete' = r.op === 'delete' ? 'delete' : 'upsert';
        const rec: SyncRecord & { seq: number } = {
          resourceType: r.resource_type,
          id: r.resource_id,
          version,
          op,
          siteId,
          seq: r.seq,
        };
        if (op === 'upsert') {
          const resource = await deps.fetchContent(r.resource_type, r.resource_id, version);
          if (resource) rec.resource = resource;
        }
        records.push(rec);
      }

      const token = await deps.getToken();
      let resp: PushResponse;
      try {
        resp = await deps.postPush({ fromSeq: cursor, records }, token);
      } catch (err) {
        // Transport/HTTP failure: leave the cursor put so the same window retries next cycle.
        deps.logger.error({ err, fromSeq: cursor, count: records.length }, 'sync push failed; cursor not advanced (will retry)');
        return 0;
      }

      // A persistently-rejected record never blocks the stream: it's logged, and because the cursor
      // advances to central's ackSeq (which acks handled-and-rejected records for S1) it is skipped
      // permanently rather than replayed forever.
      for (const rej of resp.rejects) {
        deps.logger.warn(
          { id: rej.id, version: rej.version, seq: rej.seq, reason: rej.reason },
          'sync push record rejected by central (quarantined, skipping)',
        );
      }

      // Advance to what central acked. Guard against a backwards ack (never regress the cursor).
      if (resp.ackSeq > cursor) await deps.advanceCursor(resp.ackSeq);

      // Report the count central durably applied (not records.length), so a partially-rejected batch
      // reflects real work done.
      return resp.applied;
    },
  };
}
