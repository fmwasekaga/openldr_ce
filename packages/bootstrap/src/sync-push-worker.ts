import type { Logger } from '@openldr/core';
import type { CycleResult } from '@openldr/sync';
import { createDrainWorker, type DrainListenClient } from './drain-worker';

// Host loop for the directional sync push runner (sync S1). A thin wrapper over the shared
// createDrainWorker (S7), which owns the cadence, the bounded catch-up drain, and the optional
// LISTEN wakeup. Kept as its own name/type so the bootstrap host and the sync status surface are
// unchanged.

export interface SyncPushWorker {
  start(): void;
  stop(): void;
  trigger(): void;
  isRunning(): boolean;
  /** One full drain, awaitable. Exposed so the live acceptance harness can drive exactly one tick of
   *  the worker the host actually ships, rather than building its own. */
  tickOnce(): Promise<void>;
}

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
