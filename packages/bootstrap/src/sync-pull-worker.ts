import type { Logger } from '@openldr/core';

// Host loop for the directional sync pull runner (sync S2). Sibling of createSyncPushWorker: it wraps
// a `runner.runCycle()` in a self-scheduling interval, guards against overlapping cycles, and swallows a
// failing cycle so a transient central/token/transport outage never kills the loop. Like the push worker
// it has no LISTEN wakeup (S2 pulls on a plain cadence) and is started explicitly via start() so the
// bootstrap host only spins it up when sync is configured.

export interface SyncPullWorker {
  /** Begin the interval loop. Idempotent — a second call while running is a no-op. */
  start(): void;
  /** Halt the loop; no further cycles are scheduled. */
  stop(): void;
  /** Run one cycle now (no-overlap guarded). Used by tests and an optional "sync now". */
  trigger(): void;
}

export interface SyncPullWorkerDeps {
  runner: { runCycle(): Promise<number> };
  intervalMs: number;
  logger: Logger;
}

export function createSyncPullWorker(opts: SyncPullWorkerDeps): SyncPullWorker {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function tickOnce(): Promise<void> {
    if (running) return; // never overlap cycles — a cycle still in flight when the timer fires is skipped
    running = true;
    try {
      await opts.runner.runCycle();
    } catch (err) {
      // A transient failure (central down, token outage, transport error) must not kill the loop.
      opts.logger.error({ err }, 'sync pull cycle failed');
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer || stopped) return;
      timer = setInterval(() => { if (!stopped) void tickOnce(); }, opts.intervalMs);
    },
    stop() {
      stopped = true;
      if (timer) { clearInterval(timer); timer = undefined; }
    },
    trigger() {
      if (!stopped) void tickOnce();
    },
  };
}
