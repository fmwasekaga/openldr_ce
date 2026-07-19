import type { Logger } from '@openldr/core';
import type { SyncActivityStore, SyncDirection } from '@openldr/db';
import type { SyncActivityEntry, SyncActivityRecorder } from '@openldr/sync';

/** In-memory per-direction liveness for the Sync card header. Idle cycles update `lastAttemptAt` only,
 *  so the header can show "last checked 30s ago" without writing a row. */
export interface DirectionLiveness {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

export interface SyncActivityTracker {
  /** A direction-bound recorder handed to a runner. */
  forDirection(direction: SyncDirection): SyncActivityRecorder;
  /** The current in-memory liveness for a direction (for SyncStatus). */
  summary(direction: SyncDirection): DirectionLiveness;
}

function emptyLiveness(): DirectionLiveness {
  return { lastAttemptAt: null, lastSuccessAt: null, lastErrorAt: null, lastError: null };
}

export function createSyncActivityTracker(store: SyncActivityStore, logger: Logger): SyncActivityTracker {
  const live = new Map<SyncDirection, DirectionLiveness>();
  const get = (d: SyncDirection): DirectionLiveness => {
    let l = live.get(d);
    if (!l) {
      l = emptyLiveness();
      live.set(d, l);
    }
    return l;
  };
  return {
    forDirection(direction) {
      return {
        attempt() {
          get(direction).lastAttemptAt = new Date().toISOString();
        },
        record(entry: SyncActivityEntry) {
          const now = new Date().toISOString();
          const l = get(direction);
          if (entry.event === 'synced') l.lastSuccessAt = now;
          if (entry.event === 'failed') {
            l.lastErrorAt = now;
            l.lastError = entry.error ?? 'sync failed';
          }
          // Persist fire-and-forget: the sync cycle must never slow or fail on the activity write.
          // The try/catch guards a SYNCHRONOUS throw from a store impl; the `.catch` guards an async
          // rejection. Together they honor the recorder contract ("MUST NOT throw back into the cycle")
          // regardless of how the store fails.
          try {
            void store
              .record({
                direction,
                event: entry.event,
                records: entry.records,
                error: entry.error ?? null,
                metadata: entry.metadata ?? null,
              })
              .catch((e) =>
                logger.error(
                  { err: e instanceof Error ? e.message : String(e), direction, event: entry.event },
                  'sync activity persist failed',
                ),
              );
          } catch (e) {
            logger.error(
              { err: e instanceof Error ? e.message : String(e), direction, event: entry.event },
              'sync activity persist failed (sync throw)',
            );
          }
        },
      };
    },
    summary(direction) {
      return { ...get(direction) };
    },
  };
}
