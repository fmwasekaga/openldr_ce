import type { Logger } from '@openldr/db';
import type { PullRequest, PullResponse, PullRecord } from './batch';
import type { CycleResult } from './cycle-result';
import type { SyncActivityRecorder } from './activity';
import { sanitizeSyncError } from './activity';

// Injected dependencies for the pull runner. Kept pure over its deps so the cursor + transport + applier
// are fakeable in tests (no real DB). The bootstrap host (Task 8) wires `applyRecord` to db's reference
// applier, `postPull` to the transport, and cursor/token deps to their real impls bound to the
// 'sync-pull' consumer.
export interface PullDeps {
  postPull: (req: PullRequest, token: string) => Promise<PullResponse>;
  getToken: () => Promise<string>;
  applyRecord: (rec: PullRecord) => Promise<'applied' | 'skipped'>;
  readCursor: () => Promise<number>; // change_cursors consumer 'sync-pull'
  advanceCursor: (seq: number) => Promise<void>;
  // Records for which an apply failure is all-or-nothing: on failure the cursor must NOT advance past
  // the record (retry the whole thing next cycle) rather than quarantine-and-skip. Defaults to the
  // terminology bulk kinds ('terminology_system'/'concept_map'), whose apply drains + reconciles a whole
  // system/map — a partial transfer is never "done", so a failed one must replay.
  isHoldRecord?: (rec: PullRecord) => boolean;
  // Sync S7-A: durable poison-bulk quarantine hooks (optional — absent = always-hold, unchanged). On a
  // HOLD-record apply failure, holdFailure durably counts consecutive failures for the record's entity and
  // returns 'quarantine' once a threshold is crossed (→ advance PAST it instead of holding forever), else
  // 'hold'. holdSuccess clears the counter after a hold-record applies successfully.
  holdFailure?: (rec: PullRecord, err: Error) => Promise<'hold' | 'quarantine'>;
  holdSuccess?: (rec: PullRecord) => Promise<void>;
  logger: Logger;
  /** Optional high-signal activity sink (Track A). Absent = no emission. */
  activity?: SyncActivityRecorder;
}

export interface SyncPullRunner {
  runCycle(): Promise<CycleResult>;
}

// Default hold policy: the two terminology bulk kinds are all-or-nothing (their apply drains + reconciles
// a whole system/map inside one transaction). Every other kind (S2/Layer-A per-row reference config) is
// quarantine-on-failure.
const defaultIsHoldRecord = (rec: PullRecord): boolean =>
  rec.entityType === 'terminology_system' || rec.entityType === 'concept_map';

/** A stateful pull runner. Each cycle reads the 'sync-pull' cursor, asks central for the ordered window
 *  of reference changes after it, and applies each in seq order. Mirrors the push runner's failure model:
 *  a transport/token failure (getToken lives INSIDE the try) leaves the cursor put so the whole window
 *  retries next cycle. Per-record apply failures split by policy (`isHoldRecord`):
 *    - quarantine (default for S2/Layer-A per-row records): the failure is logged + SKIPPED and the cursor
 *      advances PAST it — one bad record can never wedge the stream.
 *    - hold (default for terminology bulk records): the failure STOPS the loop and caps the cursor advance
 *      at the last safely-processed seq BEFORE it, so the failed record + everything after it replays next
 *      cycle (an all-or-nothing bulk transfer is never "done" until it fully applies).
 *  On a fully-processed window the cursor advances to central's `nextSeq` (guarded `> cursor` so a
 *  stale/hostile response cannot regress it). Returns the count of records applied. */
export function createSyncPullRunner(deps: PullDeps): SyncPullRunner {
  const isHold = deps.isHoldRecord ?? defaultIsHoldRecord;
  return {
    async runCycle(): Promise<CycleResult> {
      const cursor = await deps.readCursor();
      deps.activity?.attempt();
      let resp: PullResponse;
      try {
        // getToken() lives INSIDE the try so a token-endpoint outage behaves exactly like a transport
        // outage (logged, no cursor advance, retry next cycle) rather than escaping runCycle.
        const token = await deps.getToken();
        resp = await deps.postPull({ fromSeq: cursor }, token);
      } catch (err) {
        // Transport/HTTP/token failure: leave the cursor put so the same window retries next cycle.
        deps.logger.warn({ err: (err as Error).message }, 'sync pull failed; cursor not advanced (will retry)');
        deps.activity?.record({ event: 'failed', error: sanitizeSyncError(err), metadata: { seq: cursor } });
        return { outcome: 'failed', applied: 0 };
      }

      if (resp.records.length === 0) return { outcome: 'drained', applied: 0 };

      // Records arrive in seq order. Track the highest seq it is SAFE to advance to: it advances to a
      // record's seq once that record is "handled" (applied OR quarantined), but a HELD failure stops the
      // loop before updating it, so the held record + everything after it is left for the next cycle.
      let safeSeq = cursor;
      let applied = 0;
      let held = false;
      for (const rec of resp.records) {
        try {
          await deps.applyRecord(rec);
          applied++;
          safeSeq = rec.seq; // fully applied → safe up to and including its seq
          // S7-A: clear any quarantine counter for this entity. The apply ALREADY succeeded, so a failure
          // to clear the counter must never fall through to the catch below — that would call holdFailure
          // and increment `attempts` for a healthy entity, eventually quarantining it. Non-fatal: warn and
          // move on (the stale counter is cleared by the next successful cycle).
          if (isHold(rec)) {
            try {
              await deps.holdSuccess?.(rec);
            } catch (e) {
              deps.logger.warn(
                { err: (e as Error).message, entityType: rec.entityType, entityId: rec.entityId },
                'sync pull: clearing quarantine counter failed (non-fatal)',
              );
            }
          }
        } catch (err) {
          if (isHold(rec)) {
            const decision = (await deps.holdFailure?.(rec, err as Error)) ?? 'hold';
            if (decision === 'hold') {
              // All-or-nothing bulk record failed and hasn't crossed the quarantine threshold: STOP here. Do
              // not advance past it; retry the whole thing next cycle. safeSeq stays at the last handled
              // record.
              deps.logger.warn(
                { err: (err as Error).message, entityType: rec.entityType, entityId: rec.entityId, seq: rec.seq },
                'sync pull: bulk apply failed; holding cursor (will retry)',
              );
              held = true;
              break;
            }
            // S7-A: crossed the failure threshold → quarantine. Advance PAST it (like a per-row skip) so the
            // rest of the stream is no longer wedged; the durable store already recorded it for the operator.
            deps.logger.error(
              { err: (err as Error).message, entityType: rec.entityType, entityId: rec.entityId, seq: rec.seq },
              'sync pull: bulk apply repeatedly failed; quarantined, advancing past',
            );
            deps.activity?.record({
              event: 'quarantined',
              metadata: { seq: rec.seq, entityType: rec.entityType, entityId: rec.entityId },
            });
            safeSeq = rec.seq;
          } else {
            // Quarantine kind (S2/Layer-A per-row): log, skip, keep going — and it is safe to advance PAST it
            // so it is not replayed forever.
            deps.logger.warn(
              { err: (err as Error).message, entityType: rec.entityType, entityId: rec.entityId, seq: rec.seq },
              'sync pull: apply failed; skipping (quarantine)',
            );
            deps.activity?.record({
              event: 'quarantined',
              metadata: { seq: rec.seq, entityType: rec.entityType, entityId: rec.entityId },
            });
            safeSeq = rec.seq; // a quarantined record is "handled" — safe to advance past it
          }
        }
      }

      // Nothing held → the whole window was processed, so advance to central's nextSeq (== max served seq,
      // so Math.max(safeSeq, nextSeq) === nextSeq). A hold caps the advance at the last safe seq BEFORE the
      // held record. The `> cursor` guard prevents a stale/hostile response from regressing the cursor.
      const target = held ? safeSeq : Math.max(safeSeq, resp.nextSeq);
      const advanced = target > cursor;
      if (advanced) await deps.advanceCursor(target);
      if (held) {
        // A HELD bulk record's cursor is capped BEFORE the failing record: the next cycle would fetch
        // the identical window and re-fail identically. Report 'failed' so the drain stops and the
        // retry waits for the next tick rather than spinning for the whole budget.
        deps.activity?.record({ event: 'failed', error: 'sync pull: bulk apply held (will retry)', metadata: { seq: cursor } });
        return { outcome: 'failed', applied };
      }
      if (!advanced) {
        // The window was processed but the cursor did not move — a stale/hostile response served
        // records at or behind the cursor (nextSeq <= cursor). Reporting 'progressed' here would make
        // the drain loop re-fetch this IDENTICAL window and hammer it until the budget expires, exactly
        // the regression class the push runner's central-acked-behind-cursor guard (S7) exists to
        // prevent. 'failed' stops the drain and makes the anomaly operator-visible instead of a silent
        // spin.
        deps.logger.error(
          { cursor, safeSeq, nextSeq: resp.nextSeq, count: applied },
          'sync pull: window processed but cursor did not advance; not looping (will retry next tick)',
        );
        deps.activity?.record({
          event: 'failed',
          error: 'sync pull: cursor did not advance',
          metadata: { seq: cursor, nextSeq: resp.nextSeq },
        });
        return { outcome: 'failed', applied };
      }
      // 'progressed' because the WINDOW was processed and the cursor genuinely advanced — never because
      // `applied` is non-zero. A window entirely quarantined still reports 'progressed' here.
      if (applied > 0) deps.activity?.record({ event: 'synced', records: applied, metadata: { seq: target } });
      return { outcome: 'progressed', applied };
    },
  };
}
