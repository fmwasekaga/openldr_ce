import { describe, it, expect, vi } from 'vitest';
import { createDrainWorker } from './drain-worker';
import type { CycleResult } from '@openldr/sync';

const res = (outcome: CycleResult['outcome'], applied = 0): CycleResult => ({ outcome, applied });
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as never;

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
    const warn = vi.fn();
    // A budget of 0 means the deadline has already passed when the first cycle returns.
    const w = createDrainWorker({
      runner, intervalMs: 60_000, drainBudgetMs: 0, label: 'test',
      logger: { info: warn, warn, error() {}, debug() {} } as never,
    });
    await w.tickOnce();
    expect(n).toBe(1); // ran once, then the budget stopped it — did NOT spin
    expect(warn).toHaveBeenCalled();
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
      logger: { info() {}, warn() {}, error, debug() {} } as never,
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
    let listened = '';
    const listenClient = {
      query: async (sql: string) => { listened = sql; return undefined; },
      on: (_ev: 'notification', cb: () => void) => { notify = cb; },
    };
    let n = 0;
    const w = createDrainWorker({
      runner: { runCycle: async (): Promise<CycleResult> => { n++; return res('drained'); } },
      intervalMs: 60_000, drainBudgetMs: 60_000, label: 'test', logger: silentLogger,
      listenClient: listenClient as never, listenChannel: 'fhir_changes',
    });
    expect(listened).toBe('listen fhir_changes');
    notify!();
    await new Promise((r) => setImmediate(r));
    expect(n).toBe(1);
    w.stop();
  });

  it('without a listenClient behaves exactly as today (interval-only)', async () => {
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
