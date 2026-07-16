import type { FhirResource } from '@openldr/fhir';
import { planProjection, type ChangeRow, type FetchSafeRows, type Gap, type Logger } from '@openldr/db';
import type { PushBatch, PushResponse, SyncRecord } from './batch';
import type { CycleResult } from './cycle-result';

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
  runCycle(): Promise<CycleResult>;
}

// Map each SAFE change row to a wire `SyncRecord`, resolving version/siteId from the batched change_log
// meta read and the upsert body from `fetchContent`. Every defensive guard SKIPS the offending record
// (excludes it from the batch) with a warn rather than emitting a corrupt one: a bodiless upsert, a
// missing site_id (central always cross-site-rejects), or missing meta (a corrupting version:0) would
// all be silently mishandled downstream. These cases should not occur for fhir-store-stamped rows, so a
// skip-with-signal is a defensive backstop, not an expected path.
async function buildRecords(
  safeRows: ChangeRow[],
  metaBySeq: Map<number, { version: number; siteId: string }>,
  deps: Pick<PushDeps, 'fetchContent' | 'logger'>,
): Promise<(SyncRecord & { seq: number })[]> {
  const records: (SyncRecord & { seq: number })[] = [];
  for (const r of safeRows) {
    const md = metaBySeq.get(r.seq);
    if (!md) {
      // M2: safe seq absent from the meta read — building with version:0 would corrupt idempotency.
      deps.logger.warn({ resourceType: r.resource_type, id: r.resource_id, seq: r.seq }, 'sync push: no change_log meta for safe seq; skipping record');
      continue;
    }
    const { version, siteId } = md;
    if (!siteId) {
      // M1: null/empty origin site_id → central always cross-site-rejects. Skip with signal.
      deps.logger.warn({ resourceType: r.resource_type, id: r.resource_id, version, seq: r.seq }, 'sync push: missing site_id on safe record; skipping record');
      continue;
    }
    const op: 'upsert' | 'delete' = r.op === 'delete' ? 'delete' : 'upsert';
    if (op === 'upsert') {
      const resource = await deps.fetchContent(r.resource_type, r.resource_id, version);
      if (!resource) {
        // I1: never emit a bodiless upsert — central's applyRemote requires a body. Skip with signal.
        deps.logger.warn({ resourceType: r.resource_type, id: r.resource_id, version, seq: r.seq }, 'sync push: upsert content missing for safe record; skipping record');
        continue;
      }
      records.push({ resourceType: r.resource_type, id: r.resource_id, version, op, siteId, seq: r.seq, resource });
    } else {
      records.push({ resourceType: r.resource_type, id: r.resource_id, version, op, siteId, seq: r.seq });
    }
  }
  return records;
}

/** Compute the SAFE-frontier push records for one window, WITHOUT any transport or cursor side effects.
 *  Runs the exact safe-frontier cycle the push runner uses — fetch safe rows + snapshot bounds, plan
 *  (carrying `pendingGaps` in, out), re-filter to the committed safe prefix, batch-read the change_log
 *  meta, and map each row to a wire `SyncRecord` via the same `buildRecords` — so an offline push
 *  bundle (S5) carries byte-identical records to what an HTTP push would send for the same cursor.
 *  Returns the records, the advanced `newCursor` (plan.newCursor), and the carried-forward gaps. */
export async function collectPushRecords(
  deps: Pick<PushDeps, 'internalDb' | 'fetchSafeRows' | 'fetchContent' | 'logger' | 'batchSize'>,
  cursor: number,
  pendingGaps: Gap[] = [],
): Promise<{ records: (SyncRecord & { seq: number })[]; newCursor: number; pendingGaps: Gap[] }> {
  const { rows, boundary, xmax } = await deps.fetchSafeRows(deps.internalDb, cursor, deps.batchSize ?? 500);
  const plan = planProjection({ rows, boundary, xmax, cursor, pendingGaps });

  // The planner's `tasks` are deduped current-state keys — unusable for a faithful change replay.
  // Re-filter the raw rows to the SAFE prefix using the SAME predicate the planner uses to build its
  // tasks (seq within the advanced frontier AND committed: xid < boundary). This yields one record
  // per safe change, in seq order, un-deduped.
  const safeRows = rows.filter((r) => r.seq <= plan.newCursor && r.xid < boundary);
  if (safeRows.length === 0) return { records: [], newCursor: plan.newCursor, pendingGaps: plan.pendingGaps };

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

  const records = await buildRecords(safeRows, metaBySeq, deps);
  return { records, newCursor: plan.newCursor, pendingGaps: plan.pendingGaps };
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
    async runCycle(): Promise<CycleResult> {
      const cursor = await deps.readCursor();
      // Compute the window's records via the shared safe-frontier collector (byte-identical to what an
      // S5 offline push bundle carries). It threads `pendingGaps` in + out of this stateful closure.
      const collected = await collectPushRecords(deps, cursor, pendingGaps);
      pendingGaps = collected.pendingGaps;
      const { records } = collected;
      const newCursor = collected.newCursor;

      if (records.length === 0) {
        // No records to push this cycle (empty safe prefix OR every safe row skipped by a defensive
        // guard). Still advance past any confirmed-rolled-back gaps the planner cleared, exactly like
        // projection moves its frontier over a pure-gap cycle.
        if (newCursor > cursor) await deps.advanceCursor(newCursor);
        return { outcome: 'drained', applied: 0 };
      }

      let resp: PushResponse;
      try {
        // getToken() lives INSIDE the try so a token-endpoint outage behaves exactly like a transport
        // outage below (logged, no cursor advance, retry next cycle) rather than escaping runCycle.
        const token = await deps.getToken();
        resp = await deps.postPush({ fromSeq: cursor, records }, token);
      } catch (err) {
        // Transport/HTTP/token failure: leave the cursor put so the same window retries next cycle.
        deps.logger.error({ err, fromSeq: cursor, count: records.length }, 'sync push failed; cursor not advanced (will retry)');
        return { outcome: 'failed', applied: 0 };
      }

      // A persistently-rejected record never blocks the stream: it's logged, and because the cursor
      // advances past it (see the clamp below) it is skipped permanently rather than replayed forever.
      for (const rej of resp.rejects) {
        deps.logger.warn(
          { id: rej.id, version: rej.version, seq: rej.seq, reason: rej.reason },
          'sync push record rejected by central (quarantined, skipping)',
        );
      }

      // Advance only as far as BOTH central acked AND the local safe frontier we actually pushed.
      // Central is a separate trust domain: clamping to newCursor stops a buggy/hostile ackSeq from
      // jumping the cursor past records the lab never sent (which would permanently, silently skip
      // committed changes). The `> cursor` guard additionally prevents backwards regression.
      const target = Math.min(resp.ackSeq, newCursor);
      if (target > cursor) await deps.advanceCursor(target);

      // Report the count central durably applied (not records.length), so a partially-rejected batch
      // reflects real work done.
      // 'progressed' because the WINDOW was processed and the cursor advanced — NOT because applied
      // is non-zero. A batch central rejected or diverged wholesale still progressed the cursor, and
      // a drain loop must go again.
      return { outcome: 'progressed', applied: resp.applied };
    },
  };
}
