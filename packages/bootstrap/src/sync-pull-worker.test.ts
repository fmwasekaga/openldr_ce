import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSyncPullWorker } from './sync-pull-worker';

const silentLogger = { info() {}, error() {}, warn() {}, debug() {} } as never;

afterEach(() => {
  vi.useRealTimers();
});

describe('createSyncPullWorker', () => {
  it('runs a cycle on each interval tick and stop() halts scheduling', async () => {
    vi.useFakeTimers();
    const runCycle = vi.fn().mockResolvedValue(0);
    const worker = createSyncPullWorker({ runner: { runCycle }, intervalMs: 1000, logger: silentLogger });

    worker.start();
    expect(runCycle).toHaveBeenCalledTimes(0); // nothing runs until the first interval elapses

    await vi.advanceTimersByTimeAsync(1000);
    expect(runCycle).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(runCycle).toHaveBeenCalledTimes(3);

    worker.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(runCycle).toHaveBeenCalledTimes(3); // no further cycles after stop()
  });

  it('does not overlap cycles (a slow cycle blocks the next tick)', async () => {
    vi.useFakeTimers();
    let running = 0;
    let maxConcurrent = 0;
    const runCycle = vi.fn().mockImplementation(async () => {
      running++;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((r) => setTimeout(r, 2500)); // outlives two interval ticks
      running--;
      return 0;
    });
    const worker = createSyncPullWorker({ runner: { runCycle }, intervalMs: 1000, logger: silentLogger });

    worker.start();
    await vi.advanceTimersByTimeAsync(3000); // three ticks fire while the first cycle is still in flight
    expect(maxConcurrent).toBe(1);
    expect(runCycle).toHaveBeenCalledTimes(1);

    worker.stop();
  });

  it('keeps looping after a runCycle rejection', async () => {
    vi.useFakeTimers();
    const runCycle = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(0);
    const errorSpy = vi.fn();
    const worker = createSyncPullWorker({
      runner: { runCycle },
      intervalMs: 1000,
      logger: { info() {}, error: errorSpy, warn() {}, debug() {} } as never,
    });

    worker.start();
    await vi.advanceTimersByTimeAsync(1000); // first cycle rejects
    expect(runCycle).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000); // loop survives — second cycle runs
    expect(runCycle).toHaveBeenCalledTimes(2);

    worker.stop();
  });

  it('trigger() runs a cycle immediately and does not overlap an in-flight cycle', async () => {
    vi.useFakeTimers();
    let running = 0;
    let maxConcurrent = 0;
    const runCycle = vi.fn().mockImplementation(async () => {
      running++;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((r) => setTimeout(r, 100));
      running--;
      return 0;
    });
    const worker = createSyncPullWorker({ runner: { runCycle }, intervalMs: 10_000, logger: silentLogger });

    worker.trigger();
    worker.trigger(); // second trigger while first is in flight is dropped by the overlap guard
    await vi.advanceTimersByTimeAsync(100);
    expect(maxConcurrent).toBe(1);
    expect(runCycle).toHaveBeenCalledTimes(1);

    worker.stop();
  });

  it('start() is idempotent and start() after stop() is a no-op', async () => {
    vi.useFakeTimers();
    const runCycle = vi.fn().mockResolvedValue(0);
    const worker = createSyncPullWorker({ runner: { runCycle }, intervalMs: 1000, logger: silentLogger });

    worker.start();
    worker.start(); // must not create a second interval
    await vi.advanceTimersByTimeAsync(1000);
    expect(runCycle).toHaveBeenCalledTimes(1);

    worker.stop();
    worker.start(); // must not resurrect the loop after stop()
    await vi.advanceTimersByTimeAsync(3000);
    expect(runCycle).toHaveBeenCalledTimes(1);
  });
});
