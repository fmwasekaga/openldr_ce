# Slice 1 — Live Sync Reconcile (no restart) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enabling/disabling/reconfiguring sync via the Settings toggle takes effect immediately — the sync workers start/stop live, with no api restart.

**Architecture:** Extract the boot-time sync worker-building block into a re-runnable `SyncRuntime.reconcile()`. `SyncHandle` reads live enabled/mode/worker state from the runtime instead of fixed boot values. Boot calls `reconcile()` once; `setSyncConfig` (the toggle's Save) calls it again after persisting; shutdown calls `runtime.stop()`.

**Tech Stack:** TypeScript, Vitest, `@openldr/bootstrap`, Fastify (`apps/server`), pg LISTEN, `DrainWorker`.

**Spec:** `docs/superpowers/specs/2026-07-19-remote-central-enrollment-ux-design.md` (Slice 1).

**Worktree:** `D:\Projects\openldr-remote-ux`, branch `claude/remote-central-ux`.

---

## Current state (facts to preserve)

- `packages/bootstrap/src/index.ts`:
  - `let syncPushWorker / syncPullWorker / syncPushListenClient / syncRetryQuarantine` declared ~L747-765.
  - The worker-building block is L779-971: `readSyncConfig` → `if (syncCfg) { tokenProvider; postJson; push worker (+ LISTEN client); pull worker (termBulk, referenceApplier, applyRecord, quarantine, retryQuarantine, syncPullRunner, amendmentPullRunner) }`.
  - `SyncHandle` built L976-987 with fixed `enabled: !!syncCfg`, `mode`, `centralUrl`, `siteId`, `pushWorker`, `pullWorker`, `retryQuarantine`.
  - Shutdown `close()` (~L1157-1160): `syncPushWorker?.stop(); syncPullWorker?.stop(); … if (syncPushListenClient) await syncPushListenClient.end()`.
  - `AppContext` (~L328) exposes `sync: SyncHandle`.
- `packages/bootstrap/src/sync-handle.ts`: `createSyncHandle(opts)` with `enabled/mode/centralUrl/siteId/pushWorker?/pullWorker?/quarantine?/retryQuarantine?/divergences?`.
- Workers are `DrainWorker`s: `{ start(); stop(); trigger(); isRunning() }` (see `sync-push-worker.ts`, `drain-worker.ts`).
- `setSyncConfig(store, input, actor, encrypt)` (`sync-settings.ts:53`) persists the discrete `sync.*` keys.

---

## Task 1: `SyncRuntime` — re-runnable worker lifecycle

**Files:**
- Create: `packages/bootstrap/src/sync-runtime.ts`
- Test: `packages/bootstrap/src/sync-runtime.test.ts`

The runtime owns the worker handles + live enabled/mode state and rebuilds them on `reconcile()`. Its **deps** are exactly the STABLE values the current block closes over (everything except `syncCfg`-derived values, which `reconcile` re-reads).

- [ ] **Step 1: Write the failing tests**

Create `packages/bootstrap/src/sync-runtime.test.ts`. Use fakes for the worker factories + `readConfig` so no DB is needed:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createSyncRuntime } from './sync-runtime';

function fakeWorker() {
  const w = { started: 0, stopped: 0, running: false,
    start() { this.started++; this.running = true; },
    stop() { this.stopped++; this.running = false; },
    trigger() {}, isRunning() { return this.running; } };
  return w;
}

function makeRuntime(overrides: Partial<Parameters<typeof createSyncRuntime>[0]> = {}) {
  const push = fakeWorker(); const pull = fakeWorker();
  const deps = {
    logger: { info() {}, warn() {}, error() {} } as any,
    readConfig: vi.fn(async () => null as any),      // reconcile re-reads this each call
    buildPush: vi.fn(async () => ({ worker: push, listenClient: undefined, retryQuarantine: undefined })),
    buildPull: vi.fn(async () => ({ worker: pull })),
    ...overrides,
  };
  return { rt: createSyncRuntime(deps as any), push, pull, deps };
}

describe('SyncRuntime.reconcile', () => {
  it('disabled config → no workers, enabled=false', async () => {
    const { rt } = makeRuntime();
    await rt.reconcile();
    expect(rt.isEnabled()).toBe(false);
    expect(rt.pushWorker()).toBeUndefined();
    expect(rt.pullWorker()).toBeUndefined();
  });

  it('bidirectional → starts BOTH workers; enabled/mode reflect it', async () => {
    const { rt, push, pull } = makeRuntime({
      readConfig: vi.fn(async () => ({ mode: 'bidirectional', intervalMinutes: 1, centralUrl: 'u', siteId: 's' } as any)),
    });
    await rt.reconcile();
    expect(rt.isEnabled()).toBe(true);
    expect(rt.mode()).toBe('bidirectional');
    expect(push.started).toBe(1);
    expect(pull.started).toBe(1);
  });

  it('push mode → only push worker', async () => {
    const { rt, push, pull } = makeRuntime({
      readConfig: vi.fn(async () => ({ mode: 'push', intervalMinutes: 1, centralUrl: 'u', siteId: 's' } as any)),
    });
    await rt.reconcile();
    expect(push.started).toBe(1);
    expect(pull.started).toBe(0);
    expect(rt.pullWorker()).toBeUndefined();
  });

  it('enabled → disabled STOPS the running workers', async () => {
    let cfg: any = { mode: 'bidirectional', intervalMinutes: 1, centralUrl: 'u', siteId: 's' };
    const { rt, push, pull } = makeRuntime({ readConfig: vi.fn(async () => cfg) });
    await rt.reconcile();
    cfg = null;                       // operator disabled sync
    await rt.reconcile();
    expect(push.stopped).toBe(1);
    expect(pull.stopped).toBe(1);
    expect(rt.isEnabled()).toBe(false);
  });

  it('reconcile REBUILDS: a second enabled reconcile stops the old worker before starting a new one', async () => {
    const workers: ReturnType<typeof fakeWorker>[] = [];
    const buildPush = vi.fn(async () => { const w = fakeWorker(); workers.push(w); return { worker: w, listenClient: undefined, retryQuarantine: undefined }; });
    const { rt } = makeRuntime({
      readConfig: vi.fn(async () => ({ mode: 'push', intervalMinutes: 1, centralUrl: 'u', siteId: 's' } as any)),
      buildPush,
    });
    await rt.reconcile();
    await rt.reconcile();
    expect(workers).toHaveLength(2);
    expect(workers[0]!.stopped).toBe(1);   // first worker stopped on the 2nd reconcile
    expect(workers[1]!.started).toBe(1);
  });

  it('concurrent reconciles serialize (no overlap)', async () => {
    let active = 0; let maxActive = 0;
    const readConfig = vi.fn(async () => { active++; maxActive = Math.max(maxActive, active); await Promise.resolve(); active--; return null as any; });
    const { rt } = makeRuntime({ readConfig });
    await Promise.all([rt.reconcile(), rt.reconcile(), rt.reconcile()]);
    expect(maxActive).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/bootstrap test -- --run sync-runtime`
Expected: FAIL — `createSyncRuntime` does not exist.

- [ ] **Step 3: Implement `sync-runtime.ts`**

The runtime is deliberately thin: it holds state + serializes reconciles + delegates worker construction to injected `buildPush`/`buildPull` (Task 3 supplies the REAL builders that contain the moved block). This keeps the runtime unit-testable without a DB.

```ts
import type { Logger } from '@openldr/core';
import type { SyncConfig } from '@openldr/sync';
import type { SyncMode } from './sync-handle';

/** A started worker the runtime can stop/trigger/inspect (DrainWorker-shaped). */
export interface RuntimeWorker { start(): void; stop(): void; trigger(): void; isRunning(): boolean; }

export interface BuiltPush { worker: RuntimeWorker; listenClient?: { end(): Promise<unknown> }; }
// retryQuarantine is derived in the PULL block (createRetryQuarantine), so it rides with the pull result.
export interface BuiltPull { worker: RuntimeWorker; retryQuarantine?: (t: string, id: string) => Promise<{ ok: boolean; error?: string }>; }

export interface SyncRuntimeDeps {
  logger: Logger;
  /** Re-read the current sync config (null = disabled/misconfigured). Called on every reconcile. */
  readConfig: () => Promise<SyncConfig | null>;
  /** Build + START the push worker for this config (mode already known to include push). */
  buildPush: (cfg: SyncConfig) => Promise<BuiltPush>;
  /** Build + START the pull worker for this config (mode already known to include pull). */
  buildPull: (cfg: SyncConfig) => Promise<BuiltPull>;
}

const shouldStartPush = (mode: SyncMode): boolean => mode !== 'pull';
const shouldStartPull = (mode: SyncMode): boolean => mode !== 'push';

export interface SyncRuntime {
  /** Re-read config and reconcile the workers to it (idempotent, serialized). */
  reconcile(): Promise<void>;
  /** Stop everything (shutdown). */
  stop(): Promise<void>;
  // Live view for SyncHandle:
  isEnabled(): boolean;
  mode(): SyncMode;
  centralUrl(): string;
  siteId(): string;
  pushWorker(): RuntimeWorker | undefined;
  pullWorker(): RuntimeWorker | undefined;
  retryQuarantine(): ((t: string, id: string) => Promise<{ ok: boolean; error?: string }>) | undefined;
}

export function createSyncRuntime(deps: SyncRuntimeDeps): SyncRuntime {
  let push: BuiltPush | undefined;
  let pull: BuiltPull | undefined;
  let enabled = false;
  let mode: SyncMode = 'bidirectional';
  let centralUrl = '';
  let siteId = '';
  // Serialize reconciles: chain each onto the previous so two overlapping calls never both build workers.
  let chain: Promise<void> = Promise.resolve();

  const teardown = async (): Promise<void> => {
    push?.worker.stop();
    pull?.worker.stop();
    if (push?.listenClient) await push.listenClient.end().catch(() => undefined);
    push = undefined;
    pull = undefined;
  };

  const doReconcile = async (): Promise<void> => {
    await teardown(); // always tear down current workers first — reconcile fully rebuilds
    const cfg = await deps.readConfig();
    if (!cfg) { enabled = false; deps.logger.info('sync disabled (not configured)'); return; }
    mode = cfg.mode; centralUrl = cfg.centralUrl; siteId = cfg.siteId; enabled = true;
    if (shouldStartPush(cfg.mode)) push = await deps.buildPush(cfg);
    if (shouldStartPull(cfg.mode)) pull = await deps.buildPull(cfg);
    deps.logger.info({ mode: cfg.mode, intervalMinutes: cfg.intervalMinutes, centralUrl: cfg.centralUrl, siteId: cfg.siteId }, 'sync workers reconciled');
  };

  return {
    reconcile(): Promise<void> {
      chain = chain.then(doReconcile, doReconcile); // run even if a prior reconcile rejected
      return chain;
    },
    async stop(): Promise<void> { chain = chain.then(teardown, teardown); return chain; },
    isEnabled: () => enabled,
    mode: () => mode,
    centralUrl: () => centralUrl,
    siteId: () => siteId,
    pushWorker: () => push?.worker,
    pullWorker: () => pull?.worker,
    retryQuarantine: () => pull?.retryQuarantine,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/bootstrap test -- --run sync-runtime`
Expected: PASS (6 tests). Then `pnpm --filter @openldr/bootstrap typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/sync-runtime.ts packages/bootstrap/src/sync-runtime.test.ts
git commit -m "feat(sync): SyncRuntime — re-runnable worker lifecycle"
```

---

## Task 2: `SyncHandle` reads live state from the runtime

**Files:**
- Modify: `packages/bootstrap/src/sync-handle.ts`
- Test: `packages/bootstrap/src/sync-handle.test.ts` (extend)

Replace the fixed `enabled/mode/centralUrl/siteId/pushWorker/pullWorker/retryQuarantine` inputs with a `runtime` view read live on each call. Keep the stable `db/quarantine/divergences` inputs.

- [ ] **Step 1: Write the failing test**

Add to `packages/bootstrap/src/sync-handle.test.ts`:

```ts
it('status() reflects the runtime LIVE (enabled flips without rebuilding the handle)', async () => {
  let enabled = false; let pw: any = undefined;
  const runtime = {
    isEnabled: () => enabled, mode: () => 'push' as const, centralUrl: () => 'u', siteId: () => 's',
    pushWorker: () => pw, pullWorker: () => undefined, retryQuarantine: () => undefined,
  };
  const db = fakeCursorDb(); // existing test helper returning change_cursors/change_log selects
  const handle = createSyncHandle({ db, runtime });
  expect((await handle.status()).enabled).toBe(false);
  enabled = true; pw = { isRunning: () => true, trigger() {} };
  const s = await handle.status();
  expect(s.enabled).toBe(true);
  expect(s.push?.running).toBe(true);
});
```

(If `fakeCursorDb` doesn't exist, mirror the db-stub the current `sync-handle.test.ts` already uses for `cursorRow`/`change_log` selects.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/bootstrap test -- --run sync-handle`
Expected: FAIL — `createSyncHandle` still expects the old fixed opts.

- [ ] **Step 3: Refactor `createSyncHandle`**

Change the options: replace `enabled/mode/centralUrl/siteId/pushWorker/pullWorker/retryQuarantine` with a single `runtime: SyncRuntimeView`; keep `db`, `quarantine?`, `divergences?`.

```ts
import type { SyncRuntime } from './sync-runtime';
// A read-only live view — SyncRuntime satisfies it structurally.
export type SyncRuntimeView = Pick<SyncRuntime,
  'isEnabled' | 'mode' | 'centralUrl' | 'siteId' | 'pushWorker' | 'pullWorker' | 'retryQuarantine'>;
```

In `createSyncHandle(opts: { db; runtime: SyncRuntimeView; quarantine?; divergences? })`:
- `status()`: read `const push = opts.runtime.pushWorker(); const pull = opts.runtime.pullWorker();` and build `enabled: opts.runtime.isEnabled(), mode: opts.runtime.mode(), centralUrl: opts.runtime.centralUrl(), siteId: opts.runtime.siteId(), push: toDir(pushRow, push), pull: toDir(pullRow, pull), pendingPush` (compute `pendingPush` only when `push` is defined — same guard as today).
- `triggerNow()`: `opts.runtime.pushWorker()?.trigger(); opts.runtime.pullWorker()?.trigger();`
- `retryQuarantine(t,id)`: `const fn = opts.runtime.retryQuarantine(); if (!fn) return { ok:false, error:'sync pull is not enabled on this node' }; return fn(t,id);`
- `listQuarantine` / divergence methods: unchanged (use `opts.quarantine`/`opts.divergences`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/bootstrap test -- --run sync-handle`
Expected: PASS. `pnpm --filter @openldr/bootstrap typecheck` (will error at the index.ts call site until Task 3 — that's expected; run the package build after Task 3).

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/sync-handle.ts packages/bootstrap/src/sync-handle.test.ts
git commit -m "refactor(sync): SyncHandle reads live state from the runtime"
```

---

## Task 3: Wire the runtime into bootstrap (boot start, shutdown, AppContext)

**Files:**
- Modify: `packages/bootstrap/src/index.ts`

This is the delicate move: the existing worker-building block becomes the `buildPush`/`buildPull` closures passed to the runtime, and boot calls `reconcile()` once instead of running the block inline.

- [ ] **Step 1: Extract `buildPush`/`buildPull` from the inline block**

Keep every closed-over stable dep exactly as-is (`internal.db`, `cfg`, `pg`, `fetchSafeChangeRows`, `canonicalFhirStore`, `syncQuarantine`, `syncDivergences`, `QUARANTINE_THRESHOLD`, `readChangeCursor`, `advanceChangeCursor`, `logger`, `encodePushBody`/`advertisesGzip`). Wrap the current L786-971 body into two async builders that each take `syncCfg: SyncConfig` and RETURN the started worker + friends, instead of assigning module-level `let`s:

- `buildPush(syncCfg)`: everything currently under `if (shouldStartPush(...))` — build `tokenProvider` + `postJson` here too (both push and pull need them; build them inside each builder from `syncCfg`, OR build a shared `perConfig` helper the two builders call). Create the LISTEN client, `createSyncPushRunner`, `createSyncPushWorker`, `.start()`. Return `{ worker, listenClient: pushListenConnected ? pushListenClient : undefined, retryQuarantine: undefined }`.
- `buildPull(syncCfg)`: everything under `if (shouldStartPull(...))` — `tokenProvider`+`postJson` (per-config), `termBulk`, `referenceApplier`, `applyRecord`, `createRetryQuarantine`, `syncPullRunner`, `amendmentPullRunner`, `createSyncPullWorker`, `.start()`. Return `{ worker }` AND surface `retryQuarantine` — since `retryQuarantine` is derived in the PULL builder but the runtime exposes it via `BuiltPush`, move `retryQuarantine` onto the pull result: extend `BuiltPull` with `retryQuarantine?` and have the runtime's `retryQuarantine()` prefer `pull?.retryQuarantine`. (Adjust Task 1's `BuiltPull`/`retryQuarantine()` accordingly — `retryQuarantine` belongs with the pull worker.)

  Token provider note: today ONE `tokenProvider` is shared by both directions. To keep a single provider per config, build it in a small `perConfig(syncCfg)` closure memoised per reconcile — simplest: have `buildPull` and `buildPush` each call a `makeShared(syncCfg)` that returns `{ tokenProvider, postJson }`; since bidirectional calls both builders in one reconcile, accept two provider instances (functionally identical — each caches its own token). This is a benign change from "one shared" to "one per direction"; both authenticate the same client. Document it in a comment.

- [ ] **Step 2: Replace the inline start with a runtime**

After the builders are defined, replace the old `if (syncCfg) {...} else {...}` inline start (L786-971) and the `createSyncHandle` call (L976-987) with:

```ts
  const syncRuntime = createSyncRuntime({
    logger,
    readConfig: () => readSyncConfig(appSettings, syncDecrypt, logger),
    buildPush,
    buildPull,
  });
  await syncRuntime.reconcile(); // initial start (replaces the old inline if (syncCfg) block)

  const sync = createSyncHandle({
    db: internal.db,
    runtime: syncRuntime,
    quarantine: syncQuarantine,
    divergences: syncDivergences,
  });
```

Remove the now-unused module-level `let syncPushWorker/syncPullWorker/syncPushListenClient/syncRetryQuarantine` (the runtime owns them). Keep `readSyncConfig` imported.

- [ ] **Step 3: Shutdown + AppContext**

- Shutdown `close()`: replace `syncPushWorker?.stop(); syncPullWorker?.stop(); … if (syncPushListenClient) await syncPushListenClient.end()…` with `await syncRuntime.stop();`.
- Add `syncRuntime` to the returned `AppContext` object and to the `AppContext` interface: `syncRuntime: SyncRuntime;` (import the type). This is what the settings route calls in Task 4.

- [ ] **Step 4: Typecheck + full bootstrap tests**

Run: `pnpm --filter @openldr/bootstrap typecheck && pnpm --filter @openldr/bootstrap test -- --run`
Expected: clean typecheck; all bootstrap tests pass (including the existing sync-handle / sync-mode-gating tests, adapted if they referenced the old `createSyncHandle` shape — update those call sites to pass a `runtime` stub).

- [ ] **Step 5: Sync acceptance harnesses still green (no behavior regression)**

Run: `pnpm sync:accept && pnpm sync:pull:accept` (2-PG in-process; prove push + pull still work through the reconciled path).
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/index.ts
git commit -m "refactor(sync): boot/shutdown drive workers through SyncRuntime.reconcile()"
```

---

## Task 4: `setSyncConfig` triggers a live reconcile

**Files:**
- Modify: `apps/server/src/settings-routes.ts` (the `POST /api/settings/sync` config-save handler)

- [ ] **Step 1: Locate the config-save route**

Run: `grep -nE "setSyncConfig|/api/settings/sync'" apps/server/src/settings-routes.ts`
It calls `setSyncConfig(ctx.appSettings, req.body, actor, ctx.encryptSecret)` (or similar) and returns the view.

- [ ] **Step 2: Reconcile after the config commits**

Immediately after the `setSyncConfig(...)` call in that handler, add:

```ts
    // Apply the new config to the live workers so enable/disable/reconfigure takes effect without a
    // restart. Best-effort: a reconcile failure must not fail the save (the config IS persisted; the
    // operator can retry / the next boot reconciles). Logged for visibility.
    try { await ctx.syncRuntime.reconcile(); }
    catch (err) { ctx.logger.warn({ err }, 'sync: reconcile after settings save failed'); }
```

(If a `settings-sync-routes.test.ts` fake `ctx` exists, add a `syncRuntime: { reconcile: async () => {} }` stub so it compiles.)

- [ ] **Step 3: Typecheck + server tests**

Run: `pnpm --filter @openldr/server typecheck && pnpm --filter @openldr/server test -- --run`
Expected: clean; tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/settings-routes.ts apps/server/src/settings-sync-routes.test.ts
git commit -m "feat(sync): reconcile live workers on settings save (no restart)"
```

---

## Task 5: Live acceptance — toggle without restarting the api

Run against the running lab stack (`openldr-de68886f`). This is operator-driven verification I (the controller) run.

- [ ] **Step 1: Build + load the api image with these changes**

```bash
docker buildx build --platform linux/amd64 --load -f apps/server/Dockerfile -t ghcr.io/open-laboratory-data-repository/openldr-api:slice1-test .
```

- [ ] **Step 2: Redeploy the lab api on the test image**

```bash
sed -i 's/^OPENLDR_VERSION=.*/OPENLDR_VERSION=slice1-test/' /d/Downloads/openldr/.env
docker compose --project-directory /d/Downloads/openldr -f /d/Downloads/openldr/docker-compose.yml up -d api
# wait healthy
```

- [ ] **Step 3: Prove enable→disable→enable with NO restart**

Using a labadmin token (the temp direct-grant harness from earlier), against `http://localhost:3000` inside the container:
1. `GET /api/settings/sync/status` → note `enabled` + `push.running`.
2. `POST /api/settings/sync` with `enabled:false` (mode/centralUrl/etc. unchanged) → then `GET status` → `enabled:false`, workers stopped — **without restarting**.
3. `POST /api/settings/sync` with `enabled:true` → `GET status` → `enabled:true`, `push.running:true`; `POST /api/settings/sync/now` → `{triggered:true}` (was 409 before).
Expected: each flip observed within one poll, no `docker restart`.

- [ ] **Step 4: Restore** the stack to published `:latest` (`OPENLDR_VERSION=latest`, `up -d api`) once verified (the real image ships via Slice-1 merge + a later image push, gated on user approval).

---

## Rollout (after acceptance — gated on user approval, separate from task execution)
- Full gate `pnpm turbo typecheck test` (expect the known Windows pg-mem flake; falsify via isolated re-run).
- Whole-slice review → `--no-ff` merge to local `main` → ask before pushing origin / rebuilding images.

## Self-review notes
- Spec coverage: #4 (no-restart toggle) → Tasks 1-4; live proof → Task 5. ✓
- `retryQuarantine` correctly rides with `BuiltPull` (derived in the pull builder) and the runtime getter returns `pull?.retryQuarantine` — consistent across Task 1 interfaces + getter.
- Behavior-preservation: the moved block is byte-for-byte the same worker construction; only its trigger (boot-inline → `reconcile()`) and lifetime (fixed → rebuildable) change. Sync acceptance harnesses (Task 3 Step 5) guard against regression.
