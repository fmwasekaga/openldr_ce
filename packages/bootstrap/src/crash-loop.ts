import { readCrashMarkers, detectCrashLoop, appendCrashMarker, buildCrashMarker, type CrashMarker } from '@openldr/core';

export interface CrashLoopGuardOpts {
  dir: string;
  threshold: number;
  windowSec: number;
  backoffMs: number;
  backoffCapMs: number;
  /** Injected for tests; default now. */
  nowMs?: number;
  /** Injected for tests; default process.exit. */
  exit?: (code: number) => void;
  /** Injected for tests; default real sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Optional structured log hook. */
  log?: (v: { count: number; firstAt?: string; lastAt?: string; backoffMs: number }) => void;
}

/**
 * Boot-time restart circuit-breaker. Reads the crash markers (non-destructively — the later audit
 * drain still consumes them), and if they show a restart loop, records ONE `crash.loop` marker,
 * backs off (escalating sleep scaled by how far over threshold we are, capped), then exits so the
 * orchestrator's restart policy slows the loop. Returns true when it tripped (caller should stop).
 */
export async function guardAgainstCrashLoop(opts: CrashLoopGuardOpts): Promise<boolean> {
  const nowMs = opts.nowMs ?? Date.now();
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  try {
    const markers = readCrashMarkers(opts.dir);
    const verdict = detectCrashLoop(markers, { nowMs, windowSec: opts.windowSec, threshold: opts.threshold });
    if (!verdict.tripped) return false;

    // Escalating backoff: base * 2^(overThreshold), capped. More crashes → longer cool-off.
    const over = Math.max(0, verdict.count - opts.threshold);
    const backoff = Math.min(opts.backoffMs * 2 ** over, opts.backoffCapMs);

    // Record ONE loop marker (deduped: skip if the most recent marker is already a loop marker) so
    // the next healthy boot's drain surfaces a single system.crash_loop row rather than a pile.
    const latest = markers[markers.length - 1] as CrashMarker | undefined;
    if (!latest || latest.kind !== 'crash.loop') {
      try {
        appendCrashMarker(opts.dir, buildCrashMarker('crash.loop', new Error(`restart loop: ${verdict.count} crashes in ${opts.windowSec}s`)));
      } catch { /* best-effort durable marker */ }
    }
    try { opts.log?.({ count: verdict.count, firstAt: verdict.firstAt, lastAt: verdict.lastAt, backoffMs: backoff }); } catch { /* logging must not block the exit */ }
    await sleep(backoff);
    exit(1);
    return true;
  } catch {
    // Fail open: a fault INSIDE the breaker must never itself prevent the app from starting.
    return false;
  }
}
