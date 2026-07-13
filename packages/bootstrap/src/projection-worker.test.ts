import { describe, expect, it, vi } from 'vitest';
import { createProjectionWorker } from './projection-worker';

describe('createProjectionWorker', () => {
  it('runs a cycle on tickOnce and stops cleanly', async () => {
    const runCycle = vi.fn().mockResolvedValue(0);
    const worker = createProjectionWorker({ runCycle, intervalMs: 10_000, logger: { info() {}, error() {} } as never });
    await worker.tickOnce();
    expect(runCycle).toHaveBeenCalledTimes(1);
    await worker.stop();
  });

  it('a throwing cycle does not crash the worker', async () => {
    const runCycle = vi.fn().mockRejectedValue(new Error('boom'));
    const worker = createProjectionWorker({ runCycle, intervalMs: 10_000, logger: { info() {}, error() {} } as never });
    await expect(worker.tickOnce()).resolves.toBeUndefined();
    await worker.stop();
  });

  it('does not overlap cycles (a slow cycle blocks a concurrent tick)', async () => {
    let running = 0; let maxConcurrent = 0;
    const runCycle = vi.fn().mockImplementation(async () => {
      running++; maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((r) => setTimeout(r, 20)); running--; return 0;
    });
    const worker = createProjectionWorker({ runCycle, intervalMs: 10_000, logger: { info() {}, error() {} } as never });
    await Promise.all([worker.tickOnce(), worker.tickOnce()]);
    expect(maxConcurrent).toBe(1);
    await worker.stop();
  });
});
