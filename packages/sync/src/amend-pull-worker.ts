import type { ApplyResult, Logger } from '@openldr/db';
import type { PullRequest, AmendmentPullResponse, SyncRecord } from './batch';
import type { CycleResult } from './cycle-result';

// Injected deps for the amendment pull runner (Sync S6a). Kept pure over its deps (fakeable in tests).
// The bootstrap host wires applyRecord to fhirStore.applyRemote, postPull to POST
// /api/sync/pull-amendments, and cursor deps to the 'sync-amend-pull' consumer.
export interface AmendPullDeps {
  postPull: (req: PullRequest, token: string) => Promise<AmendmentPullResponse>;
  getToken: () => Promise<string>;
  // ApplyResult (not a hand-copied literal union) so this cannot drift from the store it wraps.
  // 'diverged' (S7) is a HANDLED outcome, not an error: the record was inspected, the divergence was
  // recorded durably by applyRemote itself, and the cursor advances normally.
  applyRecord: (rec: SyncRecord & { seq: number }) => Promise<ApplyResult>;
  readCursor: () => Promise<number>; // change_cursors consumer 'sync-amend-pull'
  advanceCursor: (seq: number) => Promise<void>;
  logger: Logger;
}

export interface AmendmentPullRunner {
  runCycle(): Promise<CycleResult>;
}

/** A stateful amendment pull runner. Each cycle reads the 'sync-amend-pull' cursor, asks central for the
 *  ordered window of amendments after it, and applies each in seq order via applyRemote (higher version
 *  wins, idempotent). Failure model mirrors the reference pull runner MINUS the hold policy: amendments
 *  are per-row, so a transport/token failure (getToken INSIDE the try) holds the cursor for a full-window
 *  retry, while a per-record apply failure is quarantined (logged + skipped) and the cursor advances PAST
 *  it — one bad record can never wedge the stream. Advances to central's nextSeq, guarded `> cursor`. */
export function createAmendmentPullRunner(deps: AmendPullDeps): AmendmentPullRunner {
  return {
    async runCycle(): Promise<CycleResult> {
      const cursor = await deps.readCursor();
      let resp: AmendmentPullResponse;
      try {
        const token = await deps.getToken();
        resp = await deps.postPull({ fromSeq: cursor }, token);
      } catch (err) {
        deps.logger.warn({ err: (err as Error).message }, 'sync amend pull failed; cursor not advanced (will retry)');
        return { outcome: 'failed', applied: 0 };
      }
      if (resp.records.length === 0) return { outcome: 'drained', applied: 0 };

      let safeSeq = cursor;
      let applied = 0;
      let diverged = 0;
      for (const rec of resp.records) {
        try {
          const result = await deps.applyRecord(rec);
          if (result === 'diverged') diverged++;
          else applied++;
          safeSeq = rec.seq;
        } catch (err) {
          deps.logger.warn(
            { err: (err as Error).message, resourceType: rec.resourceType, id: rec.id, seq: rec.seq },
            'sync amend pull: apply failed; skipping (quarantine)',
          );
          safeSeq = rec.seq; // quarantined record is handled — safe to advance past it
        }
      }
      // A divergence here means CENTRAL's amendment landed on a version the lab had already minted
      // itself — the lab KEPT its own copy and dropped central's, recording it in sync_divergences
      // (applyRemote's own transaction). This is the lab-side half of the slice's symmetry: central
      // detects the lab's dropped push (see sync-routes.ts / sync-bundle.ts); the lab detects
      // central's dropped amendment right here, on pull. No wire-protocol change is needed for this —
      // that IS the symmetry. Surfaced via logger.warn so it isn't silent.
      if (diverged > 0) {
        deps.logger.warn({ diverged }, 'sync amendment pull: same-version divergence(s) detected — see sync_divergences');
      }
      const target = Math.max(safeSeq, resp.nextSeq);
      const advanced = target > cursor;
      if (advanced) await deps.advanceCursor(target);
      if (!advanced) {
        // The window was processed but the cursor did not move — a stale/hostile response served
        // records at or behind the cursor (nextSeq <= cursor). Reporting 'progressed' here would make
        // the drain loop re-fetch this IDENTICAL window and hammer it until the budget expires — the
        // same regression class the reference pull runner's hold guard and the push runner's
        // central-acked-behind-cursor guard (S7) both exist to prevent.
        deps.logger.error(
          { cursor, safeSeq, nextSeq: resp.nextSeq, count: applied },
          'sync amend pull: window processed but cursor did not advance; not looping (will retry next tick)',
        );
        return { outcome: 'failed', applied };
      }
      // 'progressed' because the cursor genuinely advanced — 'applied' stays a REPORTING count only. A
      // window where every record diverges (excluded from `applied` at :49-50) or is quarantined still
      // reports 'progressed' here, because the WINDOW was processed, not because a count is non-zero.
      return { outcome: 'progressed', applied };
    },
  };
}
