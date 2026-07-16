# Distributed Sync S7 — Catch-Up Drain + Push Wakeup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one sync tick drain until caught up (bounded by a time budget) instead of moving one ≤500-record batch, and wake the push side on `LISTEN fhir_changes` instead of waiting up to 15 minutes.

**Architecture:** Runners stay single-batch primitives; only their return type changes from `number` to a discriminated `CycleResult` so a host loop can tell *drained* from *failed* from *progressed*. A new shared `createDrainWorker` owns cadence, the drain loop, the time budget, and the optional LISTEN wakeup; the two existing host workers become thin wrappers over it.

**Tech Stack:** TypeScript, Kysely (Postgres), `pg` (LISTEN client), Vitest, pnpm workspaces, `tsx` for live acceptance harnesses.

**Spec:** `docs/superpowers/specs/2026-07-16-distributed-sync-s7-drain-wakeup-design.md` (commit `b00a5f5f`).

---

## Read This First

### Verification status of the code in this plan

Every code block below is either **VERIFIED** (I read the file at the cited `file:line` while writing this) or marked **SKETCH** (structure only — open the real file first). This distinction exists because the previous slice shipped **seven plan errors**, all from writing plausible code from memory. Treat a SKETCH marker as an instruction to read, not a suggestion.

### Repo landmines

1. **`-- <pattern>` does NOT narrow vitest's file selection in this repo.** `pnpm --filter @openldr/sync test -- foo` runs the *whole* suite. Look for the specific file's line in the output.
2. **Vitest does NOT typecheck.** It transpiles via esbuild, which strips types without checking them. A type error surfaces **only** in `pnpm --filter <pkg> typecheck` (`tsc --noEmit`). Run both; treat typecheck as the authoritative red/green for any type change.
3. **Never `Co-Authored-By` trailers.** The user is the sole contributor.
4. **`apps/server` is the only package with real lint** (every other `lint` script is `echo "no lint"`). Not touched by this slice, but don't be surprised.
5. **Other sessions share this repo directory.** A scope-warning hook may report ~35 modified files. Verify *your* tree with `git status`.
6. **Tests must never sleep.** The budget is injectable (`drainBudgetMs`) precisely so tests set it to `0`/`-1` instead of waiting.

### Why this slice exists (the number)

`500 records/batch × 1 batch/tick ÷ 15-min tick = ~2,000 records/hour`. A 100k backlog (first enrollment, multi-day outage) takes **~50 hours**. Verified: interval default `15` at `packages/sync/src/config.ts:111`; `batchSize ?? 500` at `packages/sync/src/push-worker.ts:81`; one `runCycle()` per tick at `packages/bootstrap/src/sync-push-worker.ts:35`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/sync/src/cycle-result.ts` | **NEW.** `CycleOutcome`, `CycleResult`, `combineCycleResults` | 1 |
| `packages/sync/src/index.ts` | Barrel exports | 1 |
| `packages/bootstrap/src/drain-worker.ts` | **NEW.** Cadence + drain loop + budget + optional LISTEN | 2 |
| `packages/sync/src/push-worker.ts` | Push runner returns `CycleResult` | 3 |
| `packages/bootstrap/src/sync-push-worker.ts` | Thin wrapper over `createDrainWorker` | 3 |
| `packages/sync/src/pull-worker.ts` | Pull runner returns `CycleResult` (incl. `held → failed`) | 4 |
| `packages/sync/src/amend-pull-worker.ts` | Amend runner returns `CycleResult` | 4 |
| `packages/bootstrap/src/sync-pull-worker.ts` | Thin wrapper over `createDrainWorker` | 4 |
| `packages/bootstrap/src/index.ts` | Push/pull wiring, composite via `combineCycleResults`, LISTEN client, shutdown | 3, 4, 5 |
| `scripts/sync-drain-live-acceptance.ts` + `package.json` | `pnpm sync:drain:accept` | 6 |

**Task ordering keeps the build green at every commit.** Tasks 1 and 2 add new files that break nothing. Task 3 changes the push runner's return type *and* its two consumers in one commit. Task 4 does the same for pull. Splitting a return-type change from its consumers would leave the tree uncompilable between commits.

**Deviation from spec §9, deliberate:** the spec places the new types in `packages/sync/src/batch.ts`. Having read that file, it is **exclusively wire types** — 11 `export interface`, no functions, all shapes that cross the network. `CycleResult` is an internal control signal that never goes on the wire, and `combineCycleResults` is a function. A new `cycle-result.ts` keeps `batch.ts` coherent. Same package, same barrel; no behavior difference.

---

### Task 1: `CycleResult` + `combineCycleResults`

**Files:**
- Create: `packages/sync/src/cycle-result.ts`
- Create: `packages/sync/src/cycle-result.test.ts`
- Modify: `packages/sync/src/index.ts` (barrel)

**Context:** The control signal the drain loop runs on. `runCycle()` currently returns `number`, which means three different things — see the spec §5. This task adds the type and the composite-combining rule; nothing consumes them yet.

- [ ] **Step 1: Write the failing test**

Create `packages/sync/src/cycle-result.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { combineCycleResults } from './cycle-result';
import type { CycleResult } from './cycle-result';

const r = (outcome: CycleResult['outcome'], applied = 0): CycleResult => ({ outcome, applied });

describe('combineCycleResults', () => {
  it('progressed wins over everything — there may be more work', () => {
    expect(combineCycleResults(r('progressed'), r('failed')).outcome).toBe('progressed');
    expect(combineCycleResults(r('failed'), r('progressed')).outcome).toBe('progressed');
    expect(combineCycleResults(r('progressed'), r('drained')).outcome).toBe('progressed');
    expect(combineCycleResults(r('drained'), r('progressed')).outcome).toBe('progressed');
    expect(combineCycleResults(r('progressed'), r('progressed')).outcome).toBe('progressed');
  });

  it('failed beats drained — one sick stream must not read as caught up', () => {
    expect(combineCycleResults(r('failed'), r('drained')).outcome).toBe('failed');
    expect(combineCycleResults(r('drained'), r('failed')).outcome).toBe('failed');
    expect(combineCycleResults(r('failed'), r('failed')).outcome).toBe('failed');
  });

  it('drained only when both drained', () => {
    expect(combineCycleResults(r('drained'), r('drained')).outcome).toBe('drained');
  });

  it('sums applied across both streams', () => {
    expect(combineCycleResults(r('progressed', 3), r('progressed', 4)).applied).toBe(7);
    expect(combineCycleResults(r('failed', 0), r('drained', 0)).applied).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/sync test`
Expected: FAIL — `Failed to load url ./cycle-result`. (The whole suite runs; look for `cycle-result.test.ts`.)

- [ ] **Step 3: Write the implementation**

Create `packages/sync/src/cycle-result.ts`:

```typescript
// Distributed sync S7: what one runner cycle reports to its host loop.
//
// This is a CONTROL signal, deliberately separate from the wire types in batch.ts — it never crosses
// the network. It exists because `runCycle(): Promise<number>` returned 0 for THREE different
// situations (genuinely drained / transport failed / everything rejected-or-diverged), so a drain
// loop could not tell "caught up" from "central is down", and would stop early on a batch whose
// records all diverged.
//
// The counter is a REPORTING value and its meaning has already drifted once (the divergence slice
// excluded 'diverged' from `applied`). Control must not key off it. Runners report `progressed`
// because the WINDOW was processed — never because a count was non-zero.
export type CycleOutcome =
  /** Nothing left to move. The host loop stops draining this tick. */
  | 'drained'
  /** A window was processed and the cursor advanced. There may be more — go again. */
  | 'progressed'
  /** Transport/token failure, or a bulk hold that would re-fail immediately. Stop; retry next tick. */
  | 'failed';

export interface CycleResult {
  outcome: CycleOutcome;
  /** Records the peer durably applied. REPORTING ONLY — never branch the drain loop on this. */
  applied: number;
}

/**
 * Combine two stream results into one for a host loop that drains both (the pull host runs the
 * reference stream then the amendment stream).
 *
 * `progressed` wins so a healthy stream keeps draining while a sick one merely logs; `failed` beats
 * `drained` so one sick stream never reads as "caught up". Letting either-failed stop the loop would
 * let one stream freeze the other — the wedge behaviour S7-A spent a slice removing.
 */
export function combineCycleResults(a: CycleResult, b: CycleResult): CycleResult {
  const applied = a.applied + b.applied;
  if (a.outcome === 'progressed' || b.outcome === 'progressed') return { outcome: 'progressed', applied };
  if (a.outcome === 'failed' || b.outcome === 'failed') return { outcome: 'failed', applied };
  return { outcome: 'drained', applied };
}
```

- [ ] **Step 4: Export from the barrel**

**VERIFIED** — `packages/sync/src/index.ts` currently starts with three `export type { ... } from './batch';` lines. Add after them:

```typescript
export { combineCycleResults } from './cycle-result';
export type { CycleOutcome, CycleResult } from './cycle-result';
```

Note `combineCycleResults` is a **value** export (`export {`), not `export type {` — the barrel's existing lines are type-only because `batch.ts` has no runtime exports.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/sync test` → the 4 `cycle-result` tests PASS
Run: `pnpm --filter @openldr/sync typecheck` → clean

- [ ] **Step 6: Commit**

```bash
git add packages/sync/src/cycle-result.ts packages/sync/src/cycle-result.test.ts packages/sync/src/index.ts
git commit -m "feat(sync): CycleResult + combineCycleResults — the drain loop's control signal"
```

---

### Task 2: `createDrainWorker`

**Files:**
- Create: `packages/bootstrap/src/drain-worker.ts`
- Create: `packages/bootstrap/src/drain-worker.test.ts`

**Context:** The shared host loop. `sync-push-worker.ts` and `sync-pull-worker.ts` are **byte-for-byte identical** today except for log strings and type names (verified by reading both) — adding the drain loop to each would duplicate deadline arithmetic and the stop check. Tasks 3 and 4 make them thin wrappers over this.

Nothing consumes this yet; the build stays green.

**VERIFIED — the shape to preserve**, from `packages/bootstrap/src/sync-push-worker.ts:26-60`: a `stopped` flag, a `running` no-overlap flag, a `setInterval` timer, `tickOnce` swallowing errors, and `start`/`stop`/`trigger`/`isRunning`. `stop()` is **synchronous** (`stop(): void`) and `index.ts:1115-1116` calls it synchronously — do NOT make it async.

**VERIFIED — the LISTEN pattern to mirror**, from `packages/bootstrap/src/projection-worker.ts:34-37, 44-46`:

```typescript
  if (deps.listenClient) {
    deps.listenClient.query('listen fhir_changes').catch(() => undefined);
    deps.listenClient.on('notification', () => { if (!stopped) void tickOnce(); });
  }
  // and in stop():
  try { await deps.listenClient.query('unlisten fhir_changes'); } catch { /* ignore */ }
```

Note projection's `stop()` is async so it can `await` the unlisten. Ours **cannot** be. Fire-and-forget it instead (the client is `.end()`ed at shutdown regardless — see Task 5).

- [ ] **Step 1: Write the failing test**

Create `packages/bootstrap/src/drain-worker.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/bootstrap test`
Expected: FAIL — `Failed to load url ./drain-worker`.

- [ ] **Step 3: Write the implementation**

Create `packages/bootstrap/src/drain-worker.ts`:

```typescript
import type { Logger } from '@openldr/core';
import type { CycleResult } from '@openldr/sync';

// Distributed sync S7: the shared host loop for every sync direction.
//
// WHY THIS EXISTS AT ALL: before S7, a tick ran exactly ONE runCycle() — one <=500-record batch — on
// a 15-minute default interval. ~2,000 records/hour. A first enrollment or multi-day outage leaving
// 100k records queued took ~50 hours to drain. A wakeup makes a drain START sooner, not FINISH; the
// drain loop is the actual fix.
//
// WHY SHARED: sync-push-worker.ts and sync-pull-worker.ts were byte-for-byte identical except for log
// strings. Duplicating deadline arithmetic and the stop check into both is how siblings drift — the
// one real defect of the divergence slice was exactly that (the amendment runner was the sibling that
// got missed while its two cousins were fixed).

export interface DrainWorker {
  /** Begin the interval loop. Idempotent — a second call while running is a no-op. */
  start(): void;
  /** Halt the loop; no further cycles are scheduled. SYNCHRONOUS — index.ts calls it without await. */
  stop(): void;
  /** Drain now (no-overlap guarded). Used by "sync now", the LISTEN wakeup, and tests. */
  trigger(): void;
  /** True once start() has scheduled the loop and stop() has not been called. Read by the sync status surface. */
  isRunning(): boolean;
  /** One full drain, awaitable. Exposed for tests; start()/trigger() fire it without awaiting. */
  tickOnce(): Promise<void>;
  /** The resolved budget. Exposed so a test can assert the interval-derived default. */
  readonly budgetMs: number;
}

/** The subset of `pg.Client` we use — narrowed so tests can fake it without a real client. */
export interface DrainListenClient {
  query(sql: string): Promise<unknown>;
  on(event: 'notification', cb: () => void): void;
}

export interface DrainWorkerDeps {
  runner: { runCycle(): Promise<CycleResult> };
  intervalMs: number;
  /** Defaults to floor(intervalMs / 2). Injected by tests so they never sleep. */
  drainBudgetMs?: number;
  /** Push only — a lab cannot LISTEN to central's Postgres. Absent → interval-only, exactly as pre-S7. */
  listenClient?: DrainListenClient;
  /** Required when listenClient is set. e.g. 'fhir_changes'. */
  listenChannel?: string;
  /** 'sync push' | 'sync pull' — disambiguates log lines now that both share this loop. */
  label: string;
  logger: Logger;
}

export function createDrainWorker(opts: DrainWorkerDeps): DrainWorker {
  // Half the interval: a drain can never eat the whole gap to the next tick, and the operator's one
  // existing dial (sync.interval_minutes) scales it. No second knob to reason about — see spec §4.4.
  const budgetMs = opts.drainBudgetMs ?? Math.floor(opts.intervalMs / 2);
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function tickOnce(): Promise<void> {
    if (running) return; // never overlap cycles — a tick firing mid-drain is skipped (pre-S7 behaviour)
    running = true;
    const deadline = Date.now() + budgetMs;
    try {
      for (;;) {
        const { outcome } = await opts.runner.runCycle();
        // 'drained' → caught up. 'failed' → transport down, or a bulk hold that would re-fail
        // immediately; either way going again would only hammer. ONLY 'progressed' continues, and
        // runners report it because the WINDOW was processed — never because a count was non-zero.
        if (outcome !== 'progressed') break;
        if (stopped) break; // stop() mid-drain must be observed, or shutdown hangs for minutes
        if (Date.now() >= deadline) {
          opts.logger.info({ label: opts.label }, 'sync: drain budget exhausted; resuming next tick');
          break;
        }
      }
    } catch (err) {
      // A transient failure (peer down, token outage, transport error) must not kill the loop.
      opts.logger.error({ err, label: opts.label }, 'sync cycle failed');
    } finally {
      running = false;
    }
  }

  if (opts.listenClient && opts.listenChannel) {
    // Mirrors projection-worker.ts:34-37. Interval polling stays the correctness-bearing path: if the
    // LISTEN never lands (pooled/serverless PG), we degrade to exactly the pre-S7 cadence.
    opts.listenClient.query(`listen ${opts.listenChannel}`).catch(() => undefined);
    opts.listenClient.on('notification', () => { if (!stopped) void tickOnce(); });
  }

  return {
    budgetMs,
    tickOnce,
    start() {
      if (timer || stopped) return;
      timer = setInterval(() => { if (!stopped) void tickOnce(); }, opts.intervalMs);
    },
    stop() {
      stopped = true;
      if (timer) { clearInterval(timer); timer = undefined; }
      // Fire-and-forget: this stop() is SYNCHRONOUS because index.ts:1115-1116 calls it without await
      // (unlike projection-worker's async stop). The client is .end()ed at shutdown anyway.
      if (opts.listenClient && opts.listenChannel) {
        void opts.listenClient.query(`unlisten ${opts.listenChannel}`).catch(() => undefined);
      }
    },
    trigger() {
      if (!stopped) void tickOnce();
    },
    isRunning() {
      return timer !== undefined && !stopped;
    },
  };
}
```

> If `@openldr/bootstrap` does not already depend on `@openldr/sync`, STOP and report — it should (it imports `createSyncPushRunner` et al. in `index.ts`). Do NOT add a package dependency.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/bootstrap test` → the 9 `drain-worker` tests PASS
Run: `pnpm --filter @openldr/bootstrap typecheck` → clean

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/drain-worker.ts packages/bootstrap/src/drain-worker.test.ts
git commit -m "feat(bootstrap): shared drain worker — bounded catch-up loop + optional LISTEN wakeup"
```

---

### Task 3: Push side end-to-end

**Files:**
- Modify: `packages/sync/src/push-worker.ts`
- Modify: `packages/bootstrap/src/sync-push-worker.ts`
- Modify: `packages/bootstrap/src/index.ts:825-830`
- Modify: `packages/sync/src/push-worker.test.ts` (existing)

**Context:** Changing the runner's return type breaks its consumers, so runner + wrapper + wiring land in **one commit** or the tree won't compile between commits.

**VERIFIED — the three `return` sites in `push-worker.ts`'s `runCycle` (lines ~117-166):**

| Line | Current | New |
|---|---|---|
| ~131 | `if (records.length === 0) { if (newCursor > cursor) await deps.advanceCursor(newCursor); return 0; }` | `return { outcome: 'drained', applied: 0 }` |
| ~143 | `catch (err) { deps.logger.error(...); return 0; }` | `return { outcome: 'failed', applied: 0 }` |
| ~165 | `return resp.applied;` | `return { outcome: 'progressed', applied: resp.applied }` |

**Note the drained branch costs NO network call** — it returns before `postPush`. So the one extra cycle that ends every push drain is a DB read only.

- [ ] **Step 1: Write the failing test**

Add to `packages/sync/src/push-worker.test.ts`, mirroring that file's existing fake-deps idiom (**read it first** — reuse its real helpers; do not invent names):

```typescript
  it('reports drained when there is nothing to push (no network call)', async () => {
    let posted = 0;
    const deps = /* the file's existing deps builder */({
      fetchSafeRows: async () => ({ rows: [], boundary: 0, xmax: 0 }),
      postPush: async () => { posted++; throw new Error('must not post'); },
    });
    const r = await createSyncPushRunner(deps).runCycle();
    expect(r.outcome).toBe('drained');
    expect(r.applied).toBe(0);
    expect(posted).toBe(0);
  });

  it('reports failed when the transport throws, and does not advance the cursor', async () => {
    let cursor = 0;
    const deps = /* ... */({
      readCursor: async () => cursor,
      advanceCursor: async (s: number) => { cursor = s; },
      postPush: async () => { throw new Error('central down'); },
    });
    const r = await createSyncPushRunner(deps).runCycle();
    expect(r.outcome).toBe('failed');
    expect(cursor).toBe(0);
  });

  it('reports progressed on a posted window — even when central applied 0', async () => {
    // The window WAS processed and the cursor advanced; `applied` is reporting only. A drain loop
    // keying off the count would stop here with records still queued.
    const deps = /* ... */({
      postPush: async () => ({ ackSeq: 5, applied: 0, skipped: 0, rejects: [] }),
    });
    const r = await createSyncPushRunner(deps).runCycle();
    expect(r.outcome).toBe('progressed');
    expect(r.applied).toBe(0);
  });
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @openldr/sync typecheck`
Expected: FAIL — `Property 'outcome' does not exist on type 'number'`.
(**Not** `test` — vitest strips types without checking. See landmine 2.)

- [ ] **Step 3: Change the push runner**

In `packages/sync/src/push-worker.ts`: import the type, change the signature, and replace the three returns.

```typescript
import type { CycleResult } from './cycle-result';
```

**SKETCH — open the file and apply to the real lines.** The `SyncPushRunner` interface's `runCycle(): Promise<number>` becomes `Promise<CycleResult>`, and:

```typescript
      if (records.length === 0) {
        if (newCursor > cursor) await deps.advanceCursor(newCursor);
        return { outcome: 'drained', applied: 0 };
      }
```
```typescript
      } catch (err) {
        deps.logger.error({ err, fromSeq: cursor, count: records.length }, 'sync push failed; cursor not advanced (will retry)');
        return { outcome: 'failed', applied: 0 };
      }
```
```typescript
      // 'progressed' because the WINDOW was processed and the cursor advanced — NOT because applied
      // is non-zero. A batch central rejected or diverged wholesale still progressed the cursor, and
      // a drain loop must go again.
      return { outcome: 'progressed', applied: resp.applied };
```

Leave every comment already on those lines intact — the clamp rationale (`Math.min(resp.ackSeq, newCursor)`) and the reject-quarantine note are load-bearing.

- [ ] **Step 4: Make the push host worker a thin wrapper**

Replace the body of `packages/bootstrap/src/sync-push-worker.ts`. **VERIFIED** — its exported names are `SyncPushWorker`, `SyncPushWorkerDeps`, `createSyncPushWorker`; `index.ts:41` imports `createSyncPushWorker` and the type. Keep all three names so `index.ts`'s import is untouched.

```typescript
import type { Logger } from '@openldr/core';
import type { CycleResult } from '@openldr/sync';
import { createDrainWorker, type DrainListenClient } from './drain-worker';

// Host loop for the directional sync push runner (sync S1). A thin wrapper over the shared
// createDrainWorker (S7), which owns the cadence, the bounded catch-up drain, and the optional
// LISTEN wakeup. Kept as its own name/type so the bootstrap host and the sync status surface are
// unchanged.

export interface SyncPushWorker {
  start(): void;
  stop(): void;
  trigger(): void;
  isRunning(): boolean;
  /** One full drain, awaitable. Exposed so the live acceptance harness can drive exactly one tick of
   *  the worker the host actually ships, rather than building its own (the S7-B lesson). */
  tickOnce(): Promise<void>;
}

export interface SyncPushWorkerDeps {
  runner: { runCycle(): Promise<CycleResult> };
  intervalMs: number;
  /** S7: dedicated pg client for `LISTEN fhir_changes`. Absent → interval-only, exactly as pre-S7. */
  listenClient?: DrainListenClient;
  logger: Logger;
}

export function createSyncPushWorker(opts: SyncPushWorkerDeps): SyncPushWorker {
  return createDrainWorker({
    runner: opts.runner,
    intervalMs: opts.intervalMs,
    listenClient: opts.listenClient,
    listenChannel: opts.listenClient ? 'fhir_changes' : undefined,
    label: 'sync push',
    logger: opts.logger,
  });
}
```

- [ ] **Step 5: Update the bootstrap push wiring**

**VERIFIED** — `packages/bootstrap/src/index.ts:825-830` currently reads:

```typescript
      syncPushWorker = createSyncPushWorker({
        runner: { runCycle: () => syncPushRunner.runCycle() },
        intervalMs,
        logger,
      });
      syncPushWorker.start();
```

This needs **no change in Task 3** — `runner.runCycle()` now returns `CycleResult` and the dep type says so, so it still typechecks. The `listenClient` is wired in Task 5. Verify it compiles; do not edit it here.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @openldr/sync test` → PASS
Run: `pnpm --filter @openldr/sync typecheck` → clean
Run: `pnpm --filter @openldr/bootstrap test` → PASS
Run: `pnpm --filter @openldr/bootstrap typecheck` → clean

- [ ] **Step 7: Commit**

```bash
git add packages/sync/src/push-worker.ts packages/sync/src/push-worker.test.ts packages/bootstrap/src/sync-push-worker.ts
git commit -m "feat(sync): push runner reports CycleResult; push host drains to the budget"
```

---

### Task 4: Pull side end-to-end

**Files:**
- Modify: `packages/sync/src/pull-worker.ts`
- Modify: `packages/sync/src/amend-pull-worker.ts`
- Modify: `packages/bootstrap/src/sync-pull-worker.ts`
- Modify: `packages/bootstrap/src/index.ts:907-921` (the composite)
- Modify: `packages/sync/src/pull-worker.test.ts`, `packages/sync/src/amend-pull-worker.test.ts` (existing)

**VERIFIED — `pull-worker.ts` return sites:**

| Line | Current | New |
|---|---|---|
| ~63 | `catch { ...; return 0; }` | `{ outcome: 'failed', applied: 0 }` |
| ~66 | `if (resp.records.length === 0) return 0;` | `{ outcome: 'drained', applied: 0 }` |
| ~131 | `return applied;` | `held ? { outcome: 'failed', applied } : { outcome: 'progressed', applied }` |

**VERIFIED — `amend-pull-worker.ts` return sites:**

| Line | Current | New |
|---|---|---|
| ~39 | `catch { ...; return 0; }` | `{ outcome: 'failed', applied: 0 }` |
| ~41 | `if (resp.records.length === 0) return 0;` | `{ outcome: 'drained', applied: 0 }` |
| ~71 | `return applied;` | `{ outcome: 'progressed', applied }` |

**`held → failed` is THE line to get right.** `pull-worker.ts:96-105` sets `held = true` when a bulk terminology record fails below the quarantine threshold, and `:129` caps the cursor *before* that record so the whole window retries. Mapping it to `progressed` would re-fetch the identical window and re-fail the identical record in a tight loop for the entire budget — turning a patient retry into a hammer.

**Why amend's `progressed` must ignore the count:** `amend-pull-worker.ts:49-50` excludes diverged records from `applied` while `:70` advances the cursor regardless. A window where every record diverges returns `applied: 0` having genuinely progressed. This is live in the file today.

- [ ] **Step 1: Write the failing tests**

Add to `packages/sync/src/pull-worker.test.ts` (**read it first**; reuse its real fake-deps helper):

```typescript
  it('reports failed when a bulk record is HELD — going again would re-fail it immediately', async () => {
    // holdFailure returning 'hold' caps the cursor before the failing record so the window retries.
    const deps = /* the file's existing deps builder */({
      postPull: async () => ({ records: [/* one terminology_system record with seq 1 */], nextSeq: 1 }),
      applyRecord: async () => { throw new Error('bulk apply blew up'); },
      holdFailure: async () => 'hold' as const,
    });
    const r = await createSyncPullRunner(deps).runCycle();
    expect(r.outcome).toBe('failed');   // NOT 'progressed' — a drain loop must not spin on this
  });

  it('reports drained on an empty window', async () => {
    const deps = /* ... */({ postPull: async () => ({ records: [], nextSeq: 0 }) });
    expect((await createSyncPullRunner(deps).runCycle()).outcome).toBe('drained');
  });

  it('reports failed when the transport throws', async () => {
    const deps = /* ... */({ postPull: async () => { throw new Error('central down'); } });
    expect((await createSyncPullRunner(deps).runCycle()).outcome).toBe('failed');
  });

  it('reports progressed on a fully processed window', async () => {
    const deps = /* ... */({ postPull: async () => ({ records: [/* one per-row record, seq 1 */], nextSeq: 1 }) });
    const r = await createSyncPullRunner(deps).runCycle();
    expect(r.outcome).toBe('progressed');
  });
```

Add to `packages/sync/src/amend-pull-worker.test.ts` — **update the existing divergence test**, which currently asserts `expect(applied1).toBe(0)`:

```typescript
  it('a fully-diverged window still reports progressed — applied is reporting, not control', async () => {
    // Every record diverges → applied 0, but the cursor advanced. `while (runCycle() > 0)` would stop
    // here with the rest of the backlog unsent.
    const deps = /* the file's existing inline deps literal */({
      applyRecord: async () => 'diverged' as const,
      postPull: async () => ({ records: [/* one record, seq 7 */], nextSeq: 7 }),
    });
    const r = await createAmendmentPullRunner(deps).runCycle();
    expect(r.outcome).toBe('progressed');
    expect(r.applied).toBe(0);
  });
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @openldr/sync typecheck` → FAIL (`Property 'outcome' does not exist on type 'number'`).

- [ ] **Step 3: Change both runners**

**SKETCH — open each file and apply to the real lines.** Import `import type { CycleResult } from './cycle-result';`, change `runCycle(): Promise<number>` → `Promise<CycleResult>` on both the interface and the impl, and replace the returns per the two tables above. For `pull-worker.ts:131`:

```typescript
      const target = held ? safeSeq : Math.max(safeSeq, resp.nextSeq);
      if (target > cursor) await deps.advanceCursor(target);
      // A HOLD means the cursor is capped BEFORE the failing bulk record: the next cycle would fetch
      // the identical window and re-fail identically. Report 'failed' so the drain stops and the
      // retry waits for the next tick rather than spinning for the whole budget.
      return held ? { outcome: 'failed', applied } : { outcome: 'progressed', applied };
```

- [ ] **Step 4: Make the pull host worker a thin wrapper**

**VERIFIED** — exported names are `SyncPullWorker`, `SyncPullWorkerDeps`, `createSyncPullWorker`; `index.ts:42` imports `createSyncPullWorker` and the type. Keep all three.

```typescript
import type { Logger } from '@openldr/core';
import type { CycleResult } from '@openldr/sync';
import { createDrainWorker } from './drain-worker';

// Host loop for the downward sync streams (sync S2 reference config + S6a amendments). A thin wrapper
// over the shared createDrainWorker (S7). No LISTEN wakeup: the lab polls central over HTTPS and
// cannot LISTEN to central's Postgres — pull latency stays at the interval, by design (spec §3).

export interface SyncPullWorker {
  start(): void;
  stop(): void;
  trigger(): void;
  isRunning(): boolean;
}

export interface SyncPullWorkerDeps {
  runner: { runCycle(): Promise<CycleResult> };
  intervalMs: number;
  logger: Logger;
}

export function createSyncPullWorker(opts: SyncPullWorkerDeps): SyncPullWorker {
  return createDrainWorker({
    runner: opts.runner,
    intervalMs: opts.intervalMs,
    label: 'sync pull',
    logger: opts.logger,
  });
}
```

- [ ] **Step 5: Update the bootstrap composite**

**VERIFIED** — `packages/bootstrap/src/index.ts:907-919` currently reads:

```typescript
      syncPullWorker = createSyncPullWorker({
        runner: {
          // One host loop drains BOTH downward streams per cycle: reference config first, then amendments.
          // Each runner owns its cursor + failure model; the sum of applied counts is returned.
          runCycle: async () => {
            const ref = await syncPullRunner.runCycle();
            const amend = await amendmentPullRunner.runCycle();
            return ref + amend;
          },
        },
        intervalMs,
        logger,
      });
```

Replace the `runCycle` body (add `combineCycleResults` to the existing `@openldr/sync` import):

```typescript
          // One host loop drains BOTH downward streams per cycle: reference config first, then
          // amendments. Each runner owns its cursor + failure model. combineCycleResults (S7) folds
          // the two outcomes: 'progressed' wins so a healthy stream keeps draining while a sick one
          // only logs; 'failed' beats 'drained' so one sick stream never reads as caught up.
          runCycle: async () => {
            const ref = await syncPullRunner.runCycle();
            const amend = await amendmentPullRunner.runCycle();
            return combineCycleResults(ref, amend);
          },
```

- [ ] **Step 6: Verify**

Run: `pnpm --filter @openldr/sync test` and `typecheck` → PASS / clean
Run: `pnpm --filter @openldr/bootstrap test` and `typecheck` → PASS / clean

- [ ] **Step 7: Commit**

```bash
git add packages/sync/src/pull-worker.ts packages/sync/src/pull-worker.test.ts \
        packages/sync/src/amend-pull-worker.ts packages/sync/src/amend-pull-worker.test.ts \
        packages/bootstrap/src/sync-pull-worker.ts packages/bootstrap/src/index.ts
git commit -m "feat(sync): pull + amend runners report CycleResult; pull host drains both streams"
```

---

### Task 5: Push LISTEN wakeup

**Files:**
- Modify: `packages/bootstrap/src/index.ts` (push gate ~825; shutdown ~1115-1118)

**Context:** The drain worker already accepts `listenClient` (Task 2). This wires a real one. **Interval polling stays the correctness-bearing path** — a failure to connect must degrade to today's cadence, never abort boot.

**VERIFIED — the precedent to mirror**, `packages/bootstrap/src/index.ts:704-711`:

```typescript
  const projectionListenClient = new pg.Client({ connectionString: cfg.INTERNAL_DATABASE_URL });
  let projectionListenConnected = true;
  try {
    await projectionListenClient.connect();
  } catch (e) {
    projectionListenConnected = false;
    logger.warn({ err: e }, 'projection worker: LISTEN client failed to connect; falling back to interval-only polling');
  }
```

**VERIFIED — shutdown**, `index.ts:1115-1118`:

```typescript
      syncPushWorker?.stop();
      syncPullWorker?.stop();
      await projectionWorker.stop();
      if (projectionListenConnected) await projectionListenClient.end().catch(() => undefined);
```

- [ ] **Step 1: Create + connect the client inside the push gate**

Immediately before the `createSyncPushWorker({...})` call at ~825:

```typescript
      // S7: a dedicated LISTEN client wakes the push drain the moment a resource is written, instead
      // of waiting up to sync.interval_minutes. Mirrors the projection worker's client (index.ts:704).
      // Interval polling remains the correctness-bearing path: if this cannot connect (pooled or
      // serverless PG), push degrades to exactly the pre-S7 cadence rather than failing boot.
      const syncPushListenClient = new pg.Client({ connectionString: cfg.INTERNAL_DATABASE_URL });
      let syncPushListenConnected = true;
      try {
        await syncPushListenClient.connect();
      } catch (e) {
        syncPushListenConnected = false;
        logger.warn({ err: e }, 'sync push worker: LISTEN client failed to connect; falling back to interval-only polling');
      }
```

Then pass it:

```typescript
      syncPushWorker = createSyncPushWorker({
        runner: { runCycle: () => syncPushRunner.runCycle() },
        intervalMs,
        listenClient: syncPushListenConnected ? syncPushListenClient : undefined,
        logger,
      });
      syncPushWorker.start();
```

> `syncPushListenConnected ? ... : undefined` matters: passing a dead client would make `createDrainWorker` issue `listen` against it. The `.catch(() => undefined)` there swallows the error, so it would *appear* fine while never delivering a wakeup — a silent no-op. Gate it explicitly.

`syncPushListenClient` is declared inside the `if (syncCfg)` push gate, so the shutdown handler at ~1115 can't see it. **Hoist the declarations** next to the existing `let syncPushWorker: SyncPushWorker | undefined;` (~index.ts:735):

```typescript
let syncPushListenClient: pg.Client | undefined;
```
and assign (not re-declare) inside the gate.

- [ ] **Step 2: Close it at shutdown**

At `index.ts:1115-1118`, after the existing projection client `.end()`:

```typescript
      if (syncPushListenClient) await syncPushListenClient.end().catch(() => undefined);
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @openldr/bootstrap typecheck` → clean
Run: `pnpm --filter @openldr/bootstrap test` → PASS

The wakeup itself is proven in Task 6's live harness and by the `drain-worker` LISTEN unit test from Task 2; there is no unit test of `index.ts`'s wiring (it constructs a real `AppContext` against an unreachable DB — see the divergence slice's note on that gap).

- [ ] **Step 4: Commit**

```bash
git add packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): wake the push drain on LISTEN fhir_changes"
```

---

### Task 6: Live acceptance — the falsifiable proof

**Files:**
- Create: `scripts/sync-drain-live-acceptance.ts`
- Modify: `package.json`

**Context — this is the task that matters.** Everything else will be unit-green. This codebase's last three real defects all shipped past a green unit gate; only a live harness caught them. The harness must prove the **gap** as well as the fix.

**Base it on `scripts/sync-live-acceptance.ts`** (the S1 push harness — closest sibling). **Read it in full first** and copy its scaffolding verbatim. From the divergence slice, the verified helper set in these harnesses is: `ADMIN_URL`, `urlFor(dbName)`, `provisionDb`/`provisionDrop`, `migrateInternal`, `ok`/`step`/`pass`, an `assert(cond, detail)` closure declared **inside `main()`**, `createInternalDb(url).db`, `createFhirStore(db)`, and `SITE`/`RUN_TAG`. There is **no** `setupTwoDbs`/`assertEq`/`close` helper — `main()` inlines everything. **Confirm against the real file; adapt if `sync-live-acceptance.ts` differs.**

- [ ] **Step 1: Write the harness**

Create `scripts/sync-drain-live-acceptance.ts`. **SKETCH of `main()`'s body** — the scaffolding must be copied from the real file:

```typescript
// Distributed sync S7 — catch-up drain, live acceptance.
//
// Proves ONE tick drains a backlog larger than the 500-record batch ceiling. Pre-S7 this was
// structurally impossible: a tick ran exactly one runCycle() = one <=500 batch, so 1,200 records took
// three ticks (~45 min at the 15-min default). Run: pnpm sync:drain:accept

    step('1. seed a backlog LARGER than the 500-record batch ceiling on the lab');
    const N = 1200;
    for (let i = 0; i < N; i++) {
      await labStore.save({ resourceType: 'Observation', id: `${RUN_TAG}-obs-${i}`, status: 'final' } as never);
    }
    const head = await labDb.selectFrom('fhir.change_log').select((eb) => eb.fn.max('seq').as('m')).executeTakeFirst();
    assert(Number((head as never as { m: number }).m) >= N, `lab change_log has >= ${N} rows to push`);

    step('2. ONE tick — the drain loop must clear the whole backlog, not just the first 500');
    // Real runner + real drain worker. postPush applies in-process to the central store (the S1
    // harness's shortcut — HTTP/auth are unit-proven; see sync-live-acceptance.ts's note).
    const worker = createSyncPushWorker({
      runner: pushRunner,
      intervalMs: 60_000,        // never fires: we drive exactly one tick by hand
      logger: console as never,
    });
    await worker.tickOnce();     // ONE tick — do NOT stop() yet; step 5 reuses this worker

    step('3. assert the ENTIRE backlog reached central after that single tick');
    const got = await centralDb
      .selectFrom('fhir.fhir_resources')
      .select((eb) => eb.fn.count('id').as('c'))
      .where('resource_type', '=', 'Observation')
      .executeTakeFirst();
    assert(
      Number((got as never as { c: number }).c) === N,
      `central holds all ${N} Observations after ONE tick (got ${Number((got as never as { c: number }).c)}) — pre-S7 this capped at 500`,
    );

    step('4. cursor is at the head — the drain ran to completion, not to the budget');
    const cur = await readChangeCursor(labDb, 'sync-push');
    assert(Number(cur) >= N, `push cursor advanced past the whole backlog (got ${cur})`);

    step('5. a second tick is a clean no-op (drained → stops immediately, no re-push)');
    const before = await countCentralObs();     // reuse the step-3 count query
    await worker.tickOnce();                    // same worker, still un-stopped
    assert((await countCentralObs()) === before, 'second tick pushed nothing (already drained)');
    worker.stop();
```

> **Use `createSyncPushWorker`, not `createDrainWorker`.** The harness must drive the wrapper the host actually ships — a harness that builds its own worker proves nothing about the one in production (the S7-B lesson: a test that built its own Fastify was green while the shipped app was broken). Task 3 exposes `tickOnce` on `SyncPushWorker` for exactly this.
>
> Do **not** `stop()` between steps 2 and 5: `stop()` only takes effect *inside* the drain loop's `stopped` check, so a stopped worker's `tickOnce` would still run one cycle — a confusing way to assert a no-op. Keep one worker alive and stop it at the end.

- [ ] **Step 2: Register the script**

In `package.json`, next to `"sync:quarantine:accept"`:

```json
    "sync:divergence:accept": "tsx scripts/sync-divergence-live-acceptance.ts",
    "sync:drain:accept": "tsx scripts/sync-drain-live-acceptance.ts",
```

- [ ] **Step 3: Run it**

Postgres must be reachable on `:5433` (container `openldr_ce-postgres-1`). If it is not, **report BLOCKED** — do not fake, stub, or skip.

Run: `pnpm sync:drain:accept` → PASS

- [ ] **Step 4: ⚠️ Prove it can FAIL**

Temporarily revert the drain loop in `packages/bootstrap/src/drain-worker.ts`'s `tickOnce` to a single cycle:

```typescript
      await opts.runner.runCycle();   // instead of the for(;;) loop
```

Re-run: `pnpm sync:drain:accept`
**Expected: FAIL at step 3** — `central holds all 1200 Observations after ONE tick (got 500)`.

**If it PASSES, the harness is not proving anything and must be fixed before proceeding.**

Then restore: `git checkout packages/bootstrap/src/drain-worker.ts`, verify `git diff` is empty, and re-run → PASS. **Do not commit a reverted loop** — check `git status` first.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-drain-live-acceptance.ts package.json
git commit -m "test(sync): live acceptance — one tick drains past the 500-record batch ceiling"
```

---

### Task 7: Full gate + regression

**Files:** none (verification only)

- [ ] **Step 1: Workspace gate**

Run: `pnpm turbo typecheck test build --concurrency=1`

`--concurrency=1` is deliberate: parallel runs flake on this machine (two different packages failed on two consecutive runs during the divergence slice; both passed when run directly).

Expected: all pass **except** `@openldr/cli#build`, which is a **known pre-existing environment failure** — missing native `.node` bindings (`ssh2`/`cpu-features`, un-run node-gyp). It fails identically at commits predating this work. If anything *else* fails, it is yours.

- [ ] **Step 2: Re-run every sync acceptance harness**

```bash
pnpm sync:accept              # S1 push  → the push runner's new return type
pnpm sync:pull:accept         # S2 pull
pnpm sync:amend:accept        # S6a      → asserts an exact applied count
pnpm sync:order-status:accept
pnpm sync:patient-merge:accept
pnpm sync:quarantine:accept   # S7-A     → the hold policy → 'failed' mapping
pnpm sync:terminology:accept  # S3 bulk  → the hold path
pnpm sync:bundle:accept       # S5
pnpm sync:divergence:accept   # S7
pnpm sync:drain:accept        # S7 (this slice)
```

Expected: all PASS. **`sync:amend:accept` asserts `applied1 === 2`** against the old `number` return — it will need updating to `result.applied === 2`. **Update the assertion; never weaken the harness.** `sync:quarantine:accept` and `sync:terminology:accept` matter most: they exercise the hold path, which is where `held → failed` could regress.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(sync): address drain/wakeup gate findings"
```

---

## Definition of Done

- [ ] `pnpm turbo typecheck test build --concurrency=1` green (except the pre-existing `@openldr/cli#build`)
- [ ] All 10 sync acceptance harnesses pass live
- [ ] `pnpm sync:drain:accept` **fails** when the drain loop is reverted to a single cycle (Task 6 step 4)
- [ ] Whole-slice review performed — **not** just per-task gates. Four slices running, it has found the one real defect the per-task lens structurally cannot. Carry these into it explicitly:
  - Is `held → failed` correct in `pull-worker.ts`, and does any test actually pin it?
  - Does the composite in `index.ts` use `combineCycleResults`, and is the rule right?
  - Is the LISTEN client gated on `syncPushListenConnected`, so a dead client can't silently no-op?
  - Did any runner map `progressed` off a **count** rather than off the window being processed?
- [ ] Merged to local `main` with `--no-ff`; verify `git rev-list --parents -n 1 HEAD` shows **two** parents; **ask before pushing**
