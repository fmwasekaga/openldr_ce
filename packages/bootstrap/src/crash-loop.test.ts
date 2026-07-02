import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCrashMarker, appendCrashMarker, readCrashMarkers } from '@openldr/core';
import { guardAgainstCrashLoop } from './crash-loop';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'crashloop-')); });

// A function (not a frozen object) so `dir` reflects the per-test tmpdir from `beforeEach` — a
// plain top-level `const cfg = { dir, ... }` would capture `dir` at module-eval time (undefined,
// before any `beforeEach` has run).
const cfg = () => ({ dir, threshold: 3, windowSec: 60, backoffMs: 1000, backoffCapMs: 8000 });

describe('guardAgainstCrashLoop', () => {
  it('is a no-op when below threshold', async () => {
    appendCrashMarker(dir, buildCrashMarker('uncaughtException', new Error('x')));
    const exit = vi.fn(); const sleep = vi.fn(async () => {});
    const tripped = await guardAgainstCrashLoop({ ...cfg(), nowMs: 100_000, exit, sleep, log: () => {} });
    expect(tripped).toBe(false);
    expect(exit).not.toHaveBeenCalled();
  });

  it('trips at threshold: writes a crash.loop marker, sleeps with escalating backoff, then exits', async () => {
    const now = 100_000;
    for (let i = 0; i < 3; i++) appendCrashMarker(dir, { ...buildCrashMarker('uncaughtException', new Error('x')), at: new Date(now - i * 5000).toISOString() });
    const exit = vi.fn(); const sleep = vi.fn(async (_ms: number) => {});
    const tripped = await guardAgainstCrashLoop({ ...cfg(), nowMs: now, exit, sleep, log: () => {} });
    expect(tripped).toBe(true);
    expect(sleep).toHaveBeenCalledOnce();
    const slept = sleep.mock.calls[0][0] as number;
    expect(slept).toBeGreaterThanOrEqual(cfg().backoffMs);
    expect(slept).toBeLessThanOrEqual(cfg().backoffCapMs);
    expect(exit).toHaveBeenCalledWith(1);
    // wrote exactly one crash.loop marker (not one per crash)
    const loopMarkers = readCrashMarkers(dir).filter((m) => m.kind === 'crash.loop');
    expect(loopMarkers).toHaveLength(1);
  });

  it('does not append a second crash.loop marker if the latest marker is already crash.loop', async () => {
    const now = 100_000;
    for (let i = 0; i < 3; i++) appendCrashMarker(dir, { ...buildCrashMarker('uncaughtException', new Error('x')), at: new Date(now - i * 5000).toISOString() });
    appendCrashMarker(dir, { ...buildCrashMarker('crash.loop', new Error('loop')), at: new Date(now - 1000).toISOString() });
    const exit = vi.fn(); const sleep = vi.fn(async () => {});
    await guardAgainstCrashLoop({ ...cfg(), nowMs: now, exit, sleep, log: () => {} });
    const loopMarkers = readCrashMarkers(dir).filter((m) => m.kind === 'crash.loop');
    expect(loopMarkers).toHaveLength(1); // unchanged
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('escalates the backoff above the base when the count exceeds the threshold', async () => {
    const now = 100_000;
    // threshold + 2 crashes in-window → over = 2 → backoff = backoffMs * 2^2 (still under the cap).
    for (let i = 0; i < cfg().threshold + 2; i++) {
      appendCrashMarker(dir, { ...buildCrashMarker('uncaughtException', new Error('x')), at: new Date(now - i * 1000).toISOString() });
    }
    const exit = vi.fn(); const sleep = vi.fn(async (_ms: number) => {});
    const tripped = await guardAgainstCrashLoop({ ...cfg(), nowMs: now, exit, sleep, log: () => {} });
    expect(tripped).toBe(true);
    const slept = sleep.mock.calls[0][0] as number;
    expect(slept).toBeGreaterThan(cfg().backoffMs); // escalated past the base
    expect(slept).toBe(cfg().backoffMs * 4);        // 2^(over=2)
    expect(slept).toBeLessThanOrEqual(cfg().backoffCapMs);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('clamps the escalating backoff to the cap for an extreme crash count', async () => {
    const now = 100_000;
    // Far over threshold → the doubling would blow past the cap → must clamp to exactly backoffCapMs.
    for (let i = 0; i < 30; i++) {
      appendCrashMarker(dir, { ...buildCrashMarker('uncaughtException', new Error('x')), at: new Date(now - i * 500).toISOString() });
    }
    const exit = vi.fn(); const sleep = vi.fn(async (_ms: number) => {});
    await guardAgainstCrashLoop({ ...cfg(), nowMs: now, exit, sleep, log: () => {} });
    const slept = sleep.mock.calls[0][0] as number;
    expect(slept).toBe(cfg().backoffCapMs); // clamped to the cap, not runaway
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('fails open (returns false, does not throw or exit) when the crash dir is pathological', async () => {
    // Point `dir` at a path nested UNDER a regular file, so it can never be a valid crash dir.
    const filePath = join(dir, 'not-a-dir');
    writeFileSync(filePath, 'i am a file, not a directory');
    const exit = vi.fn(); const sleep = vi.fn(async () => {});
    // Must resolve (not reject) to false, and must not exit — a bad dir can't block startup.
    const tripped = await guardAgainstCrashLoop({ ...cfg(), dir: join(filePath, 'nested', 'crash'), nowMs: 100_000, exit, sleep, log: () => {} });
    expect(tripped).toBe(false);
    expect(exit).not.toHaveBeenCalled();
  });

  it('fails open (returns false, does not propagate) when an internal step throws on a tripped path', async () => {
    const now = 100_000;
    for (let i = 0; i < cfg().threshold; i++) {
      appendCrashMarker(dir, { ...buildCrashMarker('uncaughtException', new Error('x')), at: new Date(now - i * 5000).toISOString() });
    }
    const exit = vi.fn();
    // A fault raised AFTER the loop is detected (here: the sleep) must be swallowed → fail open,
    // so a broken breaker still never prevents the app from starting.
    const sleep = vi.fn(async () => { throw new Error('boom'); });
    const tripped = await guardAgainstCrashLoop({ ...cfg(), nowMs: now, exit, sleep, log: () => {} });
    expect(tripped).toBe(false);
    expect(exit).not.toHaveBeenCalled();
  });
});
