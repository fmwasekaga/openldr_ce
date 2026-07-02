import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
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
});
