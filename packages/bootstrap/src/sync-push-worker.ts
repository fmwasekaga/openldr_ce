import type { Logger } from '@openldr/core';
import type { CycleResult } from '@openldr/sync';
import { createDrainWorker, type DrainListenClient, type DrainWorker } from './drain-worker';

// Host loop for the directional sync push runner (sync S1). A thin wrapper over the shared
// createDrainWorker (S7), which owns the cadence, the bounded catch-up drain, and the optional
// LISTEN wakeup. Kept as its own name/type so the bootstrap host and the sync status surface are
// unchanged.

// Structurally identical to DrainWorker by construction — createSyncPushWorker returns a DrainWorker
// verbatim. Extending rather than re-declaring the members means the two cannot drift, and it stops the
// type from hiding `budgetMs`, which the returned object already carries at runtime (the T6 harness may
// want it). The distinct name is kept so the bootstrap host and the sync status surface are unchanged.
export interface SyncPushWorker extends DrainWorker {}

export interface SyncPushWorkerDeps {
  runner: { runCycle(): Promise<CycleResult> };
  intervalMs: number;
  /** S7: dedicated pg client for `LISTEN fhir_changes`. Absent → interval-only, exactly as pre-S7.
   *  The channel is not the caller's business — this worker always listens on fhir_changes. */
  listenClient?: DrainListenClient;
  logger: Logger;
}

export function createSyncPushWorker(opts: SyncPushWorkerDeps): SyncPushWorker {
  return createDrainWorker({
    runner: opts.runner,
    intervalMs: opts.intervalMs,
    listen: opts.listenClient ? { client: opts.listenClient, channel: 'fhir_changes' } : undefined,
    label: 'sync push',
    logger: opts.logger,
  });
}
