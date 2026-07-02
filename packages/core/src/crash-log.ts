import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

/**
 * Durable, best-effort crash capture for plugin-induced process-FATAL crashes.
 *
 * The in-app audit (`ctx.audit.record`) is a synchronous DB write performed mid-request, so
 * when an Extism worker (or any plugin) crashes the whole Node process — e.g. an uncaught
 * worker 'error' propagating to the main thread — the process dies before any audit row is
 * flushed. This module provides a synchronous *file* sink (the only thing that reliably lands
 * before `process.exit`) plus an in-flight registry so the crash marker can name the culprit:
 * "the process died while plugin X was running entrypoint Y".
 *
 * Flow:
 *  1. While a plugin op runs, `beginOp` registers it; the disposer clears it (set by the wasm
 *     boundary in `@openldr/plugins` and the broker in `@openldr/bootstrap`).
 *  2. A `process.on('uncaughtException'|'unhandledRejection')` handler (see `makeCrashHandler`,
 *     wired in apps/server) synchronously appends a `CrashMarker` snapshotting the in-flight ops,
 *     then exits.
 *  3. On the next boot the host drains the markers into the audit store (action `plugin.crash`),
 *     so they surface in /api/audit and the CLI `audit list`.
 */

/** A plugin operation that was running when a crash marker was taken. */
export interface InFlightOp {
  pluginId: string;
  /** Coarse op label, e.g. 'invoke' or a broker op kind like 'connectors.push'. */
  op: string;
  /** The wasm entrypoint, when known (e.g. 'push_aggregate'). */
  entrypoint?: string;
  /** ISO timestamp the op was registered. */
  startedAt: string;
}

/** A durable record of a process-FATAL crash. One JSON line per marker in the crash log. */
export interface CrashMarker {
  /** ISO timestamp the crash was captured. */
  at: string;
  /** What killed the process. Open string so callers can add their own kinds. */
  kind: 'uncaughtException' | 'unhandledRejection' | (string & {});
  error: string;
  stack?: string;
  /** Stable hash of (kind + normalized message + top stack frame) — groups repeat crashes on drain. */
  fingerprint: string;
  /** Snapshot of the plugin ops that were in flight at crash time (likely culprits). */
  inFlight: InFlightOp[];
}

const CRASH_FILE = 'crash.log';

// Module-level registry. Node's JS is single-threaded, so a synchronous crash handler reads a
// consistent snapshot. A Map keyed by a monotonic id lets concurrent async ops be tracked and
// disposed independently.
const inFlight = new Map<number, InFlightOp>();
let seq = 0;

/** Register an in-flight plugin op; returns a disposer that clears it. Call the disposer in a
 *  `finally` so a normal completion or a caught error both clear the op. */
export function beginOp(op: { pluginId: string; op: string; entrypoint?: string }): () => void {
  const key = ++seq;
  inFlight.set(key, { pluginId: op.pluginId, op: op.op, entrypoint: op.entrypoint, startedAt: new Date().toISOString() });
  return () => { inFlight.delete(key); };
}

/** A snapshot of the currently in-flight plugin ops. */
export function currentInFlight(): InFlightOp[] {
  return [...inFlight.values()];
}

/** Synchronously append one crash marker as a JSON line. Best-effort; creates `dir` if needed. */
export function appendCrashMarker(dir: string, marker: CrashMarker): void {
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, CRASH_FILE), `${JSON.stringify(marker)}\n`, 'utf8');
}

/** Read and clear all crash markers. The log is renamed first so a marker appended during the
 *  drain isn't lost; malformed lines are skipped rather than throwing. */
export function drainCrashMarkers(dir: string): CrashMarker[] {
  const file = join(dir, CRASH_FILE);
  if (!existsSync(file)) return [];
  const archived = join(dir, `${CRASH_FILE}.${randomUUID()}.draining`);
  try {
    renameSync(file, archived);
  } catch {
    return []; // another drainer raced us, or the file vanished — nothing to do
  }
  let content = '';
  try { content = readFileSync(archived, 'utf8'); } catch { content = ''; }
  try { rmSync(archived, { force: true }); } catch { /* leave it; next drain ignores it */ }
  const markers: CrashMarker[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { markers.push(JSON.parse(trimmed) as CrashMarker); } catch { /* skip a torn/partial line */ }
  }
  return markers;
}

/** Read crash markers WITHOUT clearing them (used by the boot-time crash-loop check, which must
 *  run before the audit store exists and must not consume markers the later drain will audit). */
export function readCrashMarkers(dir: string): CrashMarker[] {
  const file = join(dir, CRASH_FILE);
  if (!existsSync(file)) return [];
  let content = '';
  try { content = readFileSync(file, 'utf8'); } catch { return []; }
  const markers: CrashMarker[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { markers.push(JSON.parse(trimmed) as CrashMarker); } catch { /* skip torn line */ }
  }
  return markers;
}

export interface CrashLoopVerdict {
  tripped: boolean;
  /** How many crashes fell within the window. */
  count: number;
  firstAt?: string;
  lastAt?: string;
}

/** Decide whether the recent crash history constitutes a restart loop: >= `threshold` crashes
 *  within the last `windowSec` seconds. Pure + injectable clock for tests. Ignores `crash.loop`
 *  markers themselves so the breaker doesn't feed on its own output. */
export function detectCrashLoop(
  markers: CrashMarker[],
  opts: { nowMs: number; windowSec: number; threshold: number },
): CrashLoopVerdict {
  const cutoff = opts.nowMs - opts.windowSec * 1000;
  const recent = markers
    .filter((m) => m.kind !== 'crash.loop')
    .filter((m) => { const t = Date.parse(m.at); return Number.isFinite(t) && t >= cutoff; })
    .sort((a, b) => a.at.localeCompare(b.at));
  return {
    tripped: recent.length >= opts.threshold,
    count: recent.length,
    ...(recent.length ? { firstAt: recent[0].at, lastAt: recent[recent.length - 1].at } : {}),
  };
}

/** Normalize a crash into a stable fingerprint so a restart loop of the SAME crash coalesces.
 *  Volatile tokens (numbers, uuids, hex, ports, paths) are stripped so incidental differences
 *  (a changing IP or pid) don't fragment the group. */
export function crashFingerprint(kind: string, message: string, stack?: string): string {
  const topFrame = (stack ?? '').split('\n').find((l) => l.trim().startsWith('at ')) ?? '';
  const normalized = `${kind}|${message}|${topFrame}`
    .replace(/0x[0-9a-fA-F]+/g, '0x#')
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '#uuid')
    .replace(/\d+/g, '#')
    .toLowerCase();
  return createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}

/** Assemble a crash marker from a thrown value plus the current in-flight snapshot. */
export function buildCrashMarker(kind: CrashMarker['kind'], err: unknown): CrashMarker {
  const e = err instanceof Error ? err : undefined;
  const error = e ? e.message : String(err);
  const stack = e?.stack;
  return {
    at: new Date().toISOString(),
    kind,
    error,
    ...(stack ? { stack } : {}),
    fingerprint: crashFingerprint(kind, error, stack),
    inFlight: currentInFlight(),
  };
}

/** Build a process crash handler that synchronously records a marker, then exits. `exit` is
 *  injected for testability and defaults to `process.exit`. Writing the marker is best-effort:
 *  the process exits even if the file sink throws. */
export function makeCrashHandler(opts: {
  dir: string;
  kind: CrashMarker['kind'];
  exit?: (code: number) => void;
  log?: (marker: CrashMarker) => void;
}): (err: unknown) => void {
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  return (err: unknown) => {
    const marker = buildCrashMarker(opts.kind, err);
    try { appendCrashMarker(opts.dir, marker); } catch { /* best-effort durable sink */ }
    try { opts.log?.(marker); } catch { /* logging must not block the exit */ }
    exit(1);
  };
}
