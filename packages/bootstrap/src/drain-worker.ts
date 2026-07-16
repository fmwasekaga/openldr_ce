import type { Logger } from '@openldr/core';
import type { CycleResult } from '@openldr/sync';

// Distributed sync S7: the shared host loop for every sync direction.
//
// WHY THIS EXISTS AT ALL: before S7, a tick ran exactly ONE runCycle() — one <=500-record batch — on
// a 15-minute default interval. ~2,000 records/hour. A first enrollment or multi-day outage leaving
// 100k records queued took ~50 hours to drain. A wakeup makes a drain START sooner, not FINISH; the
// drain loop is the actual fix.
//
// WHY SHARED: sync-push-worker.ts and sync-pull-worker.ts were byte-for-byte identical except for log
// strings. Duplicating deadline arithmetic and the stop check into both is how siblings drift — the
// one real defect of the divergence slice was exactly that (the amendment runner was the sibling that
// got missed while its two cousins were fixed).

export interface DrainWorker {
  /** Begin the interval loop. Idempotent — a second call while running is a no-op. */
  start(): void;
  /** Halt the loop; no further cycles are scheduled. SYNCHRONOUS — index.ts calls it without await. */
  stop(): void;
  /** Drain now (no-overlap guarded). Used by "sync now", the LISTEN wakeup, and tests. */
  trigger(): void;
  /** True once start() has scheduled the loop and stop() has not been called. Read by the sync status surface. */
  isRunning(): boolean;
  /** One full drain, awaitable. Exposed for tests; start()/trigger() fire it without awaiting. */
  tickOnce(): Promise<void>;
  /** The resolved budget. Exposed so a test can assert the interval-derived default. */
  readonly budgetMs: number;
}

/** The subset of `pg.Client` we use — narrowed so tests can fake it without a real client. */
export interface DrainListenClient {
  query(sql: string): Promise<unknown>;
  on(event: 'notification', cb: () => void): void;
}

export interface DrainWorkerDeps {
  runner: { runCycle(): Promise<CycleResult> };
  intervalMs: number;
  /** Defaults to floor(intervalMs / 2). Injected by tests so they never sleep. */
  drainBudgetMs?: number;
  /** Push only — a lab cannot LISTEN to central's Postgres. Absent → interval-only, exactly as pre-S7. */
  listenClient?: DrainListenClient;
  /** Required when listenClient is set. e.g. 'fhir_changes'. */
  listenChannel?: string;
  /** 'sync push' | 'sync pull' — disambiguates log lines now that both share this loop. */
  label: string;
  logger: Logger;
}

export function createDrainWorker(opts: DrainWorkerDeps): DrainWorker {
  // Half the interval: a drain can never eat the whole gap to the next tick, and the operator's one
  // existing dial (sync.interval_minutes) scales it. No second knob to reason about — see spec §4.4.
  const budgetMs = opts.drainBudgetMs ?? Math.floor(opts.intervalMs / 2);
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function tickOnce(): Promise<void> {
    if (running) return; // never overlap cycles — a tick firing mid-drain is skipped (pre-S7 behaviour)
    running = true;
    const deadline = Date.now() + budgetMs;
    try {
      for (;;) {
        const { outcome } = await opts.runner.runCycle();
        // 'drained' → caught up. 'failed' → transport down, or a bulk hold that would re-fail
        // immediately; either way going again would only hammer. ONLY 'progressed' continues, and
        // runners report it because the WINDOW was processed — never because a count was non-zero.
        if (outcome !== 'progressed') break;
        if (stopped) break; // stop() mid-drain must be observed, or shutdown hangs for minutes
        if (Date.now() >= deadline) {
          opts.logger.info({ label: opts.label }, 'sync: drain budget exhausted; resuming next tick');
          break;
        }
      }
    } catch (err) {
      // A transient failure (peer down, token outage, transport error) must not kill the loop.
      opts.logger.error({ err, label: opts.label }, 'sync cycle failed');
    } finally {
      running = false;
    }
  }

  if (opts.listenClient && opts.listenChannel) {
    // Mirrors projection-worker.ts:34-37. Interval polling stays the correctness-bearing path: if the
    // LISTEN never lands (pooled/serverless PG), we degrade to exactly the pre-S7 cadence.
    opts.listenClient.query(`listen ${opts.listenChannel}`).catch(() => undefined);
    opts.listenClient.on('notification', () => { if (!stopped) void tickOnce(); });
  }

  return {
    budgetMs,
    tickOnce,
    start() {
      if (timer || stopped) return;
      timer = setInterval(() => { if (!stopped) void tickOnce(); }, opts.intervalMs);
    },
    stop() {
      stopped = true;
      if (timer) { clearInterval(timer); timer = undefined; }
      // Fire-and-forget: this stop() is SYNCHRONOUS because index.ts:1115-1116 calls it without await
      // (unlike projection-worker's async stop). The client is .end()ed at shutdown anyway.
      if (opts.listenClient && opts.listenChannel) {
        void opts.listenClient.query(`unlisten ${opts.listenChannel}`).catch(() => undefined);
      }
    },
    trigger() {
      if (!stopped) void tickOnce();
    },
    isRunning() {
      return timer !== undefined && !stopped;
    },
  };
}
