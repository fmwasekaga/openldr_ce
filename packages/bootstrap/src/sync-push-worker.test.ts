import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DrainWorkerDeps } from './drain-worker';

// The wrapper's ONLY unique behaviour is how it translates its bare `listenClient?` into
// createDrainWorker's ATOMIC `listen: { client, channel }` pair — it owns the 'fhir_changes' channel
// so callers cannot supply a client without one (a client-without-channel would silently degrade to
// interval-only: no LISTEN, no error, no log — the exact slow-drain bug this slice exists to kill).
// Everything else (cadence, overlap guard, bounded drain, error survival, start/stop/isRunning) is
// createDrainWorker's and is covered by drain-worker.test.ts against the real implementation.
const createDrainWorker = vi.fn((_opts: DrainWorkerDeps) => ({
  start() {},
  stop() {},
  trigger() {},
  isRunning: () => false,
  tickOnce: async () => {},
  budgetMs: 0,
}));
vi.mock('./drain-worker', () => ({ createDrainWorker: (o: DrainWorkerDeps) => createDrainWorker(o) }));

const { createSyncPushWorker } = await import('./sync-push-worker');

const silentLogger = { info() {}, error() {}, warn() {}, debug() {} } as never;
const runner = { runCycle: async () => ({ outcome: 'drained' as const, applied: 0 }) };

const lastDeps = (): DrainWorkerDeps => createDrainWorker.mock.calls[0][0];

beforeEach(() => {
  createDrainWorker.mockClear();
});

describe('createSyncPushWorker', () => {
  it('supplies the fhir_changes channel alongside a listenClient as one atomic listen pair', () => {
    const client = { query: async () => undefined, on: () => {} };
    createSyncPushWorker({ runner, intervalMs: 1000, listenClient: client, logger: silentLogger });

    const deps = lastDeps();
    // The channel is the wrapper's business, not the caller's — pinned to the exact string because a
    // typo'd channel LISTENs successfully and then never fires.
    expect(deps.listen).toEqual({ client, channel: 'fhir_changes' });
    expect(deps.label).toBe('sync push');
    expect(deps.intervalMs).toBe(1000);
    expect(deps.runner).toBe(runner);
  });

  it('passes listen: undefined with no listenClient (interval-only, exactly as pre-S7)', () => {
    createSyncPushWorker({ runner, intervalMs: 1000, logger: silentLogger });

    expect(lastDeps().listen).toBeUndefined();
  });
});
