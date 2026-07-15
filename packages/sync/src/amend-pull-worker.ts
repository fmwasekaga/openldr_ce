import type { Logger } from '@openldr/db';
import type { PullRequest, AmendmentPullResponse, SyncRecord } from './batch';

// Injected deps for the amendment pull runner (Sync S6a). Kept pure over its deps (fakeable in tests).
// The bootstrap host wires applyRecord to fhirStore.applyRemote, postPull to POST
// /api/sync/pull-amendments, and cursor deps to the 'sync-amend-pull' consumer.
export interface AmendPullDeps {
  postPull: (req: PullRequest, token: string) => Promise<AmendmentPullResponse>;
  getToken: () => Promise<string>;
  applyRecord: (rec: SyncRecord & { seq: number }) => Promise<'applied' | 'skipped'>;
  readCursor: () => Promise<number>; // change_cursors consumer 'sync-amend-pull'
  advanceCursor: (seq: number) => Promise<void>;
  logger: Logger;
}

export interface AmendmentPullRunner {
  runCycle(): Promise<number>;
}

/** A stateful amendment pull runner. Each cycle reads the 'sync-amend-pull' cursor, asks central for the
 *  ordered window of amendments after it, and applies each in seq order via applyRemote (higher version
 *  wins, idempotent). Failure model mirrors the reference pull runner MINUS the hold policy: amendments
 *  are per-row, so a transport/token failure (getToken INSIDE the try) holds the cursor for a full-window
 *  retry, while a per-record apply failure is quarantined (logged + skipped) and the cursor advances PAST
 *  it — one bad record can never wedge the stream. Advances to central's nextSeq, guarded `> cursor`. */
export function createAmendmentPullRunner(deps: AmendPullDeps): AmendmentPullRunner {
  return {
    async runCycle(): Promise<number> {
      const cursor = await deps.readCursor();
      let resp: AmendmentPullResponse;
      try {
        const token = await deps.getToken();
        resp = await deps.postPull({ fromSeq: cursor }, token);
      } catch (err) {
        deps.logger.warn({ err: (err as Error).message }, 'sync amend pull failed; cursor not advanced (will retry)');
        return 0;
      }
      if (resp.records.length === 0) return 0;

      let safeSeq = cursor;
      let applied = 0;
      for (const rec of resp.records) {
        try {
          await deps.applyRecord(rec);
          applied++;
          safeSeq = rec.seq;
        } catch (err) {
          deps.logger.warn(
            { err: (err as Error).message, resourceType: rec.resourceType, id: rec.id, seq: rec.seq },
            'sync amend pull: apply failed; skipping (quarantine)',
          );
          safeSeq = rec.seq; // quarantined record is handled — safe to advance past it
        }
      }
      const target = Math.max(safeSeq, resp.nextSeq);
      if (target > cursor) await deps.advanceCursor(target);
      return applied;
    },
  };
}
