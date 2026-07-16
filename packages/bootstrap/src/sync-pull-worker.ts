import type { Logger } from '@openldr/core';
import type { CycleResult } from '@openldr/sync';
import { createDrainWorker, type DrainWorker } from './drain-worker';

// Host loop for the downward sync streams (sync S2 reference config + S6a amendments). A thin wrapper
// over the shared createDrainWorker (S7). No LISTEN wakeup: the lab polls central over HTTPS and
// cannot LISTEN to central's Postgres — pull latency stays at the interval, by design.

// Structurally identical to DrainWorker by construction — createSyncPullWorker returns a DrainWorker
// verbatim. Extending rather than re-declaring the members means the two cannot drift, and it stops the
// type from hiding `budgetMs`, which the returned object already carries at runtime. The distinct name
// is kept so the bootstrap host and the sync status surface are unchanged.
export interface SyncPullWorker extends DrainWorker {}

export interface SyncPullWorkerDeps {
  runner: { runCycle(): Promise<CycleResult> };
  intervalMs: number;
  logger: Logger;
}

export function createSyncPullWorker(opts: SyncPullWorkerDeps): SyncPullWorker {
  return createDrainWorker({
    runner: opts.runner,
    intervalMs: opts.intervalMs,
    label: 'sync pull',
    logger: opts.logger,
  });
}
