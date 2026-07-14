import type { Logger } from '@openldr/db';
import type { PullRequest, PullResponse, PullRecord } from './batch';

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
  logger: Logger;
}

export interface SyncPullRunner {
  runCycle(): Promise<number>;
}

/** A stateful pull runner. Each cycle reads the 'sync-pull' cursor, asks central for the ordered window
 *  of reference changes after it, and applies each in seq order. Mirrors the push runner's failure model:
 *  a transport/token failure (getToken lives INSIDE the try) leaves the cursor put so the whole window
 *  retries next cycle; a per-record apply failure is logged and SKIPPED (quarantine) but does NOT stop
 *  the cursor advancing — one bad record can never wedge the stream. On success the cursor advances to
 *  central's `nextSeq` (guarded `> cursor` so a stale/hostile response cannot regress it). Returns the
 *  count of records applied. */
export function createSyncPullRunner(deps: PullDeps): SyncPullRunner {
  return {
    async runCycle(): Promise<number> {
      const cursor = await deps.readCursor();
      let resp: PullResponse;
      try {
        // getToken() lives INSIDE the try so a token-endpoint outage behaves exactly like a transport
        // outage (logged, no cursor advance, retry next cycle) rather than escaping runCycle.
        const token = await deps.getToken();
        resp = await deps.postPull({ fromSeq: cursor }, token);
      } catch (err) {
        // Transport/HTTP/token failure: leave the cursor put so the same window retries next cycle.
        deps.logger.warn({ err: (err as Error).message }, 'sync pull failed; cursor not advanced (will retry)');
        return 0;
      }

      if (resp.records.length === 0) return 0;

      let applied = 0;
      for (const rec of resp.records) {
        try {
          await deps.applyRecord(rec);
          applied++;
        } catch (err) {
          // A per-record apply failure never blocks the stream: it's logged and skipped, and because the
          // cursor advances past it below it is not replayed forever (quarantine).
          deps.logger.warn(
            { err: (err as Error).message, entityType: rec.entityType, entityId: rec.entityId, seq: rec.seq },
            'sync pull: apply failed; skipping (quarantine)',
          );
        }
      }

      // Advance to central's nextSeq (max seq in the served window). The `> cursor` guard prevents a
      // stale/hostile response from regressing the cursor backward.
      if (resp.nextSeq > cursor) await deps.advanceCursor(resp.nextSeq);
      return applied;
    },
  };
}
