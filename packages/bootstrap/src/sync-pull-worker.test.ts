import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DrainWorkerDeps } from './drain-worker';

// The wrapper's ONLY unique behaviour is that it has NO listen pair (a lab cannot LISTEN to central's
// Postgres — pull latency stays at the interval, by design) and that it labels its cycles 'sync pull'.
// Everything else (cadence, overlap guard, bounded drain, error survival, start/stop/isRunning) is
// createDrainWorker's and is covered by drain-worker.test.ts against the real implementation. Mirrors
// sync-push-worker.test.ts (S7): a bare-number runCycle mock here would type-error against
// `Promise<CycleResult>` and, if faked past that, would silently break the drain loop after one cycle
// (destructuring 'outcome' off a number yields undefined) — testing this wrapper against a fake
// createDrainWorker sidesteps that trap entirely.
const createDrainWorker = vi.fn((_opts: DrainWorkerDeps) => ({
  start() {},
  stop() {},
  trigger() {},
  isRunning: () => false,
  tickOnce: async () => {},
  budgetMs: 0,
}));
vi.mock('./drain-worker', () => ({ createDrainWorker: (o: DrainWorkerDeps) => createDrainWorker(o) }));

const { createSyncPullWorker } = await import('./sync-pull-worker');

const silentLogger = { info() {}, error() {}, warn() {}, debug() {} } as never;
const runner = { runCycle: async () => ({ outcome: 'drained' as const, applied: 0 }) };

const lastDeps = (): DrainWorkerDeps => createDrainWorker.mock.calls[0][0];

beforeEach(() => {
  createDrainWorker.mockClear();
});

describe('createSyncPullWorker', () => {
  it('wires the runner, interval, and logger straight through with no listen pair', () => {
    createSyncPullWorker({ runner, intervalMs: 1000, logger: silentLogger });

    const deps = lastDeps();
    expect(deps.runner).toBe(runner);
    expect(deps.intervalMs).toBe(1000);
    expect(deps.label).toBe('sync pull');
    // No LISTEN wakeup for pull — the lab cannot LISTEN to central's Postgres over HTTPS.
    expect(deps.listen).toBeUndefined();
  });
});
