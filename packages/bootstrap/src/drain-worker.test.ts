import { describe, it, expect, vi } from 'vitest';
import { createDrainWorker, type DrainListenClient } from './drain-worker';
import type { Logger } from '@openldr/core';
import type { CycleResult } from '@openldr/sync';

const res = (outcome: CycleResult['outcome'], applied = 0): CycleResult => ({ outcome, applied });
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger;

/** A runner that returns the given outcomes in order, then 'drained' forever. */
function scriptedRunner(outcomes: CycleResult['outcome'][]) {
  const calls: number[] = [];
  let i = 0;
  return {
    calls,
    runner: {
      runCycle: async (): Promise<CycleResult> => {
        calls.push(i);
        return res(outcomes[i++] ?? 'drained');
      },
    },
  };
}

describe('createDrainWorker', () => {
  it('keeps draining while the runner reports progressed, stops on drained', async () => {
    const { calls, runner } = scriptedRunner(['progressed', 'progressed', 'drained']);
    const w = createDrainWorker({ runner, intervalMs: 60_000, drainBudgetMs: 60_000, label: 'test', logger: silentLogger });
    await w.tickOnce();
    expect(calls).toHaveLength(3); // two progressed + the drained that stopped it
    w.stop();
  });

  it('stops on failed — a down peer must not be hammered for the whole budget', async () => {
    const { calls, runner } = scriptedRunner(['failed', 'progressed', 'progressed']);
    const w = createDrainWorker({ runner, intervalMs: 60_000, drainBudgetMs: 60_000, label: 'test', logger: silentLogger });
    await w.tickOnce();
    expect(calls).toHaveLength(1);
    w.stop();
  });

  it('exits on the deadline even when the runner never stops progressing', async () => {
    let n = 0;
    const runner = { runCycle: async (): Promise<CycleResult> => { n++; return res('progressed'); } };
    // Levels are separate mocks: exhaustion must log at INFO, not warn. During a 100k backfill it is
    // the EXPECTED path for many consecutive ticks — a warn per tick would be noise, not a signal.
    const info = vi.fn();
    const warn = vi.fn();
    // A budget of 0 means the deadline has already passed when the first cycle returns.
    const w = createDrainWorker({
      runner, intervalMs: 60_000, drainBudgetMs: 0, label: 'test',
      logger: { info, warn, error() {}, debug() {} } as unknown as Logger,
    });
    await w.tickOnce();
    expect(n).toBe(1); // ran once, then the budget stopped it — did NOT spin
    expect(info).toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    w.stop();
  });

  it('observes stop() between cycles so shutdown is not blocked by a long drain', async () => {
    let n = 0;
    const w: { tickOnce(): Promise<void>; stop(): void } = createDrainWorker({
      runner: { runCycle: async (): Promise<CycleResult> => { n++; w.stop(); return res('progressed'); } },
      intervalMs: 60_000, drainBudgetMs: 60_000, label: 'test', logger: silentLogger,
    });
    await w.tickOnce();
    expect(n).toBe(1);
  });

  it('never overlaps: trigger() during an in-flight drain is skipped', async () => {
    let n = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const w = createDrainWorker({
      runner: { runCycle: async (): Promise<CycleResult> => { n++; await gate; return res('drained'); } },
      intervalMs: 60_000, drainBudgetMs: 60_000, label: 'test', logger: silentLogger,
    });
    const first = w.tickOnce();
    w.trigger();          // must be a no-op — a cycle is in flight
    release();
    await first;
    expect(n).toBe(1);
    w.stop();
  });

  it('a throwing runner is swallowed and does not kill the loop', async () => {
    const error = vi.fn();
    const w = createDrainWorker({
      runner: { runCycle: async (): Promise<CycleResult> => { throw new Error('boom'); } },
      intervalMs: 60_000, drainBudgetMs: 60_000, label: 'test',
      logger: { info() {}, warn() {}, error, debug() {} } as unknown as Logger,
    });
    await expect(w.tickOnce()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    w.stop();
  });

  it('defaults the budget to half the interval', async () => {
    const w = createDrainWorker({
      runner: { runCycle: async (): Promise<CycleResult> => res('drained') },
      intervalMs: 60_000, label: 'test', logger: silentLogger,
    });
    expect(w.budgetMs).toBe(30_000);
    w.stop();
  });

  it('subscribes to the LISTEN channel and drains on notification', async () => {
    let notify: (() => void) | undefined;
    const queries: string[] = [];
    const client: DrainListenClient = {
      query: async (sql: string) => { queries.push(sql); return undefined; },
      on: (_ev: 'notification', cb: () => void) => { notify = cb; },
    };
    let n = 0;
    const w = createDrainWorker({
      runner: { runCycle: async (): Promise<CycleResult> => { n++; return res('drained'); } },
      intervalMs: 60_000, drainBudgetMs: 60_000, label: 'test', logger: silentLogger,
      listen: { client, channel: 'fhir_changes' },
    });
    expect(queries).toEqual(['listen fhir_changes']);
    notify!();
    await new Promise((r) => setImmediate(r));
    expect(n).toBe(1);
    w.stop();
  });

  it('unsubscribes on stop() so a reused client is not left listening', async () => {
    const queries: string[] = [];
    const client: DrainListenClient = {
      query: async (sql: string) => { queries.push(sql); return undefined; },
      on: () => {},
    };
    const w = createDrainWorker({
      runner: { runCycle: async (): Promise<CycleResult> => res('drained') },
      intervalMs: 60_000, drainBudgetMs: 60_000, label: 'test', logger: silentLogger,
      listen: { client, channel: 'fhir_changes' },
    });
    w.stop();
    expect(queries).toEqual(['listen fhir_changes', 'unlisten fhir_changes']);
  });

  it('a notification after stop() is ignored — no cycle races the shutdown', async () => {
    let notify: (() => void) | undefined;
    const client: DrainListenClient = {
      query: async () => undefined,
      on: (_ev: 'notification', cb: () => void) => { notify = cb; },
    };
    let n = 0;
    const w = createDrainWorker({
      runner: { runCycle: async (): Promise<CycleResult> => { n++; return res('drained'); } },
      intervalMs: 60_000, drainBudgetMs: 60_000, label: 'test', logger: silentLogger,
      listen: { client, channel: 'fhir_changes' },
    });
    w.stop();
    notify!(); // a NOTIFY already in flight when shutdown began
    await new Promise((r) => setImmediate(r));
    expect(n).toBe(0);
  });

  it('stop() is synchronous — index.ts:1115-1116 calls it un-awaited', () => {
    // tsc will NOT catch this: `() => Promise<void>` is assignable to `() => void`. An async stop()
    // would return a Promise here, and its unlisten/teardown would silently never be awaited.
    const w = createDrainWorker({
      runner: { runCycle: async (): Promise<CycleResult> => res('drained') },
      intervalMs: 60_000, drainBudgetMs: 60_000, label: 'test', logger: silentLogger,
    });
    expect(w.stop()).toBeUndefined();
  });

  it('without a listen client behaves exactly as today (interval-only)', async () => {
    const w = createDrainWorker({
      runner: { runCycle: async (): Promise<CycleResult> => res('drained') },
      intervalMs: 60_000, drainBudgetMs: 60_000, label: 'test', logger: silentLogger,
    });
    expect(w.isRunning()).toBe(false); // not started yet
    w.start();
    expect(w.isRunning()).toBe(true);
    w.stop();
    expect(w.isRunning()).toBe(false);
  });
});
