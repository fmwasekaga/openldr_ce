# Track A — Sync Activity Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give operators visibility into sync *runtime* (did a cycle move data, fail, quarantine, or diverge?) via a new bounded `sync_activity` store, emitted from the sync runners, surfaced on the Settings → General Sync card and a `GET /api/settings/sync/activity` endpoint — WITHOUT polluting the operator-action audit log.

**Architecture:** A new internal-schema `sync_activity` table (its own Kysely migration) holds high-signal rows only (`synced` when records moved, `failed` on a thrown cycle, `quarantined` per rejected/skipped entity, `diverged` per same-version divergence). A `SyncActivityStore` (in `@openldr/db`) does insert + trim-to-N-per-direction. A `SyncActivityTracker` (in `@openldr/bootstrap`) wraps the store, holds in-memory per-direction liveness (`lastAttemptAt/lastSuccessAt/lastErrorAt/lastError`), and hands each runner a per-direction `SyncActivityRecorder`. The three sync runners (`push-worker`, `pull-worker`, `amend-pull-worker` in `@openldr/sync`) call `activity.attempt()` at cycle start and `activity.record(...)` at the four event points — idle "nothing to sync" cycles write NOTHING (only `attempt()` updates in-memory liveness). The `SyncStatus` payload gains the liveness summary per direction; the Sync card renders it plus a compact recent-activity timeline.

**Tech Stack:** TypeScript, pnpm + turbo monorepo, Kysely over Postgres (pg-mem for unit tests), Fastify, React + shadcn/ui (studio), vitest.

**Worktree:** All work happens in `D:\Projects\openldr-audit-obs` (branch `claude/audit-observability-track-a`, off `main`). Do NOT touch `D:\Projects\Repositories\openldr_ce` — it is a different checkout on a stale branch running the user's dev server.

**Verified anchors (from codebase research — trust these, but the implementer should still open each file):**
- Internal migrations: `packages/db/src/migrations/internal/NNN_name.ts`, Kysely builder, registered in `internal/index.ts`. Highest existing = `058_drop_reported_pull_cursor` → new migration is **`059`**.
- Internal schema table interfaces: `packages/db/src/schema/internal.ts` (`AuditEventsTable` at ~147; `InternalSchema` map with `audit_events:` at ~645).
- `@openldr/db` barrel: `packages/db/src/index.ts` (stores re-exported at lines 27–28).
- Store template: `packages/db/src/sync-divergence-store.ts` (toRow coercion idiom); `packages/audit/src/store.ts` (insert + pg-mem test at `store.test.ts`).
- Runners: `packages/sync/src/push-worker.ts` (`createSyncPushRunner`, runCycle 119–188), `pull-worker.ts` (`createSyncPullRunner`, runCycle 53–155), `amend-pull-worker.ts` (`createAmendmentPullRunner`, runCycle 32–89). Each has an injected `deps` interface (`PushDeps`/`PullDeps`/`AmendPullDeps`).
- `SyncStatus`/`SyncDirectionStatus`: `packages/bootstrap/src/sync-handle.ts` (16–36; `toDir` 76–86; `status()` 89–112).
- Runtime wiring closures: `packages/bootstrap/src/index.ts` — `buildPush` 803–868 (runner deps 811–844), `buildPull` 872–965 (ref runner deps 915–934, amend runner deps 938–946), `createSyncHandle` call 989–994. `AppContext` interface `sync: SyncHandle;` at 324; ctx return `sync,` at 1161; `createAuditStore` at 355.
- Status route: `apps/server/src/settings-routes.ts` (`/api/settings/sync/status` at 62; role guard `requireRole('lab_admin')`; route test `settings-routes.test.ts` with a hand-built `fakeCtx`).
- Studio: `apps/studio/src/api.ts` (mirror `SyncStatus`/`SyncDirectionStatus` 373–382; sync client fns 384–399). Sync card: `apps/studio/src/pages/settings/General.tsx` (`directionLine` 185–191; state 38; `load` 47–61; `refreshSyncStatus` 78–84; poll 129–133; live status panel 362–383). i18n: `apps/studio/src/i18n/{en,fr,pt}.ts` under `settings.general.sync.*`.

**Commands:** run a single package's tests with `pnpm --filter <pkg> test` (e.g. `@openldr/db`, `@openldr/sync`, `@openldr/bootstrap`, `@openldr/server`, `@openldr/studio`). Typecheck a package with `pnpm --filter <pkg> typecheck`. Full gate at the end: `pnpm turbo typecheck test build`.

---

## File Structure

**Created:**
- `packages/db/src/migrations/internal/059_sync_activity.ts` — the migration.
- `packages/db/src/sync-activity-store.ts` — `SyncActivityStore` (insert + trim-to-N) + row/input types.
- `packages/db/src/sync-activity-store.test.ts` — pg-mem store unit tests.
- `packages/sync/src/activity.ts` — `SyncActivityRecorder`/`SyncActivityEntry` interfaces + `sanitizeSyncError`.
- `packages/sync/src/activity.test.ts` — `sanitizeSyncError` unit tests.
- `packages/bootstrap/src/sync-activity-tracker.ts` — `SyncActivityTracker` (store + in-memory liveness).
- `packages/bootstrap/src/sync-activity-tracker.test.ts` — tracker unit tests.

**Modified:**
- `packages/db/src/schema/internal.ts` — add `SyncActivityTable` + map entry.
- `packages/db/src/migrations/internal/index.ts` — register migration 059.
- `packages/db/src/index.ts` — re-export the new store.
- `packages/sync/src/index.ts` — re-export `activity.ts`.
- `packages/sync/src/{push-worker,pull-worker,amend-pull-worker}.ts` — add optional `activity` dep + emit.
- `packages/sync/src/{push-worker,pull-worker,amend-pull-worker}.test.ts` — assert emission.
- `packages/bootstrap/src/sync-handle.ts` — extend `SyncDirectionStatus` + merge tracker summary.
- `packages/bootstrap/src/index.ts` — construct store+tracker, wire into runners + handle + ctx.
- `apps/server/src/settings-routes.ts` — add `GET /api/settings/sync/activity`.
- `apps/server/src/settings-routes.test.ts` — test the new endpoint.
- `apps/studio/src/api.ts` — mirror liveness fields + `SyncActivityRow` + `fetchSyncActivity`.
- `apps/studio/src/pages/settings/General.tsx` — liveness header + activity timeline.
- `apps/studio/src/i18n/{en,fr,pt}.ts` — new `settings.general.sync.*` keys.

---

## Task 1: The `sync_activity` migration + schema type

**Files:**
- Create: `packages/db/src/migrations/internal/059_sync_activity.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/schema/internal.ts`

- [ ] **Step 1: Write the migration**

Create `packages/db/src/migrations/internal/059_sync_activity.ts` (mirrors `005_audit_events.ts` / `057_sync_site_cursors.ts` exactly):

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('sync_activity')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('occurred_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('direction', 'text', (c) => c.notNull()) // 'push' | 'pull' | 'amend'
    .addColumn('event', 'text', (c) => c.notNull()) // 'synced' | 'failed' | 'quarantined' | 'diverged'
    .addColumn('records', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('error', 'text')
    .addColumn('metadata', 'jsonb')
    .execute();
  await db.schema
    .createIndex('sync_activity_dir_occurred_idx')
    .ifNotExists()
    .on('sync_activity')
    .columns(['direction', 'occurred_at'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('sync_activity').ifExists().execute();
}
```

- [ ] **Step 2: Register the migration**

In `packages/db/src/migrations/internal/index.ts`: add an import beside the other `m0NN` imports:

```ts
import * as m059 from './059_sync_activity';
```

and an entry in the exported `internalMigrations` map (keep numeric order — after `'058_drop_reported_pull_cursor'`):

```ts
  '059_sync_activity': { up: m059.up, down: m059.down },
```

- [ ] **Step 3: Add the Kysely table interface**

In `packages/db/src/schema/internal.ts`, after the `AuditEventsTable` interface (~line 159), add (mirrors its `Generated<Date>` / `JSONColumnType` idioms — reuse the same `Generated`/`JSONColumnType` imports already at the top of the file):

```ts
export interface SyncActivityTable {
  id: string;
  occurred_at: Generated<Date>;
  direction: string;
  event: string;
  records: Generated<number>;
  error: string | null;
  metadata: JSONColumnType<Record<string, unknown>> | null;
}
```

Then add the table to the `InternalSchema` map (beside `audit_events: AuditEventsTable;`, ~line 645):

```ts
  sync_activity: SyncActivityTable;
```

- [ ] **Step 4: Verify the migration applies (typecheck + a throwaway pg-mem check is covered by Task 2's test)**

Run: `pnpm --filter @openldr/db typecheck`
Expected: PASS (no type errors).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/internal/059_sync_activity.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts
git commit -m "feat(db): sync_activity table + migration 059"
```

---

## Task 2: `SyncActivityStore` (insert + trim-to-N)

**Files:**
- Create: `packages/db/src/sync-activity-store.ts`
- Create: `packages/db/src/sync-activity-store.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/sync-activity-store.test.ts` (mirrors `packages/audit/src/store.test.ts`'s pg-mem setup):

```ts
import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import type { Kysely } from 'kysely';
import { internalMigrations } from './migrations/internal';
import type { InternalSchema } from './schema/internal';
import { createSyncActivityStore } from './sync-activity-store';

async function makeMigratedDb(): Promise<Kysely<InternalSchema>> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<InternalSchema>;
  for (const migration of Object.values(internalMigrations)) {
    await migration.up(db);
  }
  return db;
}

describe('createSyncActivityStore', () => {
  it('records a row and reads it back with parsed fields', async () => {
    const db = await makeMigratedDb();
    const store = createSyncActivityStore(db);
    const row = await store.record({
      direction: 'push',
      event: 'synced',
      records: 5,
      metadata: { seq: 42 },
    });
    expect(row.direction).toBe('push');
    expect(row.event).toBe('synced');
    expect(row.records).toBe(5);
    expect(row.error).toBeNull();
    expect(row.metadata).toEqual({ seq: 42 });
    expect(typeof row.occurredAt).toBe('string');

    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(row.id);
  });

  it('trims to N most-recent rows PER DIRECTION on write', async () => {
    const db = await makeMigratedDb();
    const store = createSyncActivityStore(db, { retentionPerDirection: 3 });
    for (let i = 0; i < 5; i++) await store.record({ direction: 'push', event: 'synced', records: i });
    for (let i = 0; i < 2; i++) await store.record({ direction: 'pull', event: 'synced', records: i });
    expect(await store.list({ direction: 'push' })).toHaveLength(3); // trimmed
    expect(await store.list({ direction: 'pull' })).toHaveLength(2); // untouched by push trim
  });

  it('lists newest-first and filters by direction', async () => {
    const db = await makeMigratedDb();
    const store = createSyncActivityStore(db);
    const first = await store.record({ direction: 'pull', event: 'failed', error: 'boom' });
    // Force a strictly-older occurred_at on the first row so ordering is deterministic.
    await db.updateTable('sync_activity').set({ occurred_at: new Date('2020-01-01T00:00:00Z') }).where('id', '=', first.id).execute();
    const second = await store.record({ direction: 'pull', event: 'synced', records: 1 });
    await store.record({ direction: 'push', event: 'synced', records: 9 });

    const pull = await store.list({ direction: 'pull' });
    expect(pull.map((r) => r.id)).toEqual([second.id, first.id]); // newest first
    expect(pull.every((r) => r.direction === 'pull')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openldr/db test -- sync-activity-store`
Expected: FAIL with "Cannot find module './sync-activity-store'" (or `createSyncActivityStore is not a function`).

- [ ] **Step 3: Write the store**

Create `packages/db/src/sync-activity-store.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';

export type SyncDirection = 'push' | 'pull' | 'amend';
export type SyncActivityEventKind = 'synced' | 'failed' | 'quarantined' | 'diverged';

export interface SyncActivityInput {
  direction: SyncDirection;
  event: SyncActivityEventKind;
  records?: number;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface SyncActivityRow {
  id: string;
  occurredAt: string;
  direction: SyncDirection;
  event: SyncActivityEventKind;
  records: number;
  error: string | null;
  metadata: Record<string, unknown> | null;
}

export interface SyncActivityStore {
  record(input: SyncActivityInput): Promise<SyncActivityRow>;
  list(opts?: { direction?: SyncDirection; limit?: number }): Promise<SyncActivityRow[]>;
}

interface RawRow {
  id: string;
  occurred_at: unknown;
  direction: string;
  event: string;
  records: unknown;
  error: string | null;
  metadata: unknown;
}

// Real PG returns timestamptz as Date and jsonb as an object; pg-mem can hand back strings — coerce both
// (mirrors sync-divergence-store's toRow).
function toRow(r: RawRow): SyncActivityRow {
  return {
    id: r.id,
    occurredAt: new Date(r.occurred_at as string | number | Date).toISOString(),
    direction: r.direction as SyncDirection,
    event: r.event as SyncActivityEventKind,
    records: Number(r.records ?? 0),
    error: r.error ?? null,
    metadata:
      r.metadata == null
        ? null
        : ((typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) as Record<string, unknown>),
  };
}

/** A bounded, high-signal store of sync outcomes. `record` inserts one row then trims the table to the
 *  most-recent `retentionPerDirection` rows FOR THAT DIRECTION, so per-minute cycles can never grow it
 *  unbounded. Callers (the runners, via the tracker) decide WHEN to write — an idle cycle writes nothing. */
export function createSyncActivityStore(
  db: Kysely<InternalSchema>,
  opts: { retentionPerDirection?: number } = {},
): SyncActivityStore {
  const retention = Math.max(1, opts.retentionPerDirection ?? 200);
  return {
    async record(input) {
      const id = randomUUID();
      await db
        .insertInto('sync_activity')
        .values({
          id,
          direction: input.direction,
          event: input.event,
          records: input.records ?? 0,
          error: input.error ?? null,
          metadata: (input.metadata ?? null) as never,
        })
        .execute();
      // Trim-on-write. The just-inserted row is the newest, so it is always in `keep` → `keep` is never
      // empty and the `not in` is safe.
      const keep = await db
        .selectFrom('sync_activity')
        .select('id')
        .where('direction', '=', input.direction)
        .orderBy('occurred_at', 'desc')
        .orderBy('id', 'desc')
        .limit(retention)
        .execute();
      await db
        .deleteFrom('sync_activity')
        .where('direction', '=', input.direction)
        .where(
          'id',
          'not in',
          keep.map((k) => k.id),
        )
        .execute();
      const row = await db
        .selectFrom('sync_activity')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      return toRow(row as unknown as RawRow);
    },
    async list(o = {}) {
      let q = db.selectFrom('sync_activity').selectAll();
      if (o.direction) q = q.where('direction', '=', o.direction);
      const rows = await q.orderBy('occurred_at', 'desc').orderBy('id', 'desc').limit(o.limit ?? 100).execute();
      return rows.map((r) => toRow(r as unknown as RawRow));
    },
  };
}
```

- [ ] **Step 4: Re-export from the db barrel**

In `packages/db/src/index.ts`, after the sync store re-exports (line ~28, `export * from './sync-divergence-store';`), add:

```ts
export * from './sync-activity-store';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @openldr/db test -- sync-activity-store`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/sync-activity-store.ts packages/db/src/sync-activity-store.test.ts packages/db/src/index.ts
git commit -m "feat(db): SyncActivityStore with trim-to-N-per-direction"
```

---

## Task 3: `SyncActivityRecorder` interface + `sanitizeSyncError` (in `@openldr/sync`)

**Files:**
- Create: `packages/sync/src/activity.ts`
- Create: `packages/sync/src/activity.test.ts`
- Modify: `packages/sync/src/index.ts`

Rationale: the runners are pure over injected deps and must not depend on `@openldr/bootstrap`. They only need a tiny recorder interface + a secret-scrubbing helper. The event/direction *value* types live in `@openldr/db` (Task 2) — `@openldr/sync` already imports types from `@openldr/db`, and there is no reverse dependency, so no cycle.

- [ ] **Step 1: Write the failing test**

Create `packages/sync/src/activity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sanitizeSyncError } from './activity';

describe('sanitizeSyncError', () => {
  it('redacts bearer tokens', () => {
    const out = sanitizeSyncError(new Error('POST failed with Authorization: Bearer abc123.def-456_GHI'));
    expect(out).not.toContain('abc123');
    expect(out).toContain('Bearer [redacted]');
  });

  it('redacts JWT-looking substrings', () => {
    const out = sanitizeSyncError(new Error('token eyJhbGciOiJIUzI1NiIsong.payloadpart.sigsig rejected'));
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiI');
    expect(out).toContain('[redacted-jwt]');
  });

  it('accepts non-Error values and caps length', () => {
    expect(sanitizeSyncError('plain string')).toBe('plain string');
    const long = 'x'.repeat(1000);
    expect(sanitizeSyncError(new Error(long)).length).toBeLessThanOrEqual(501);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openldr/sync test -- activity`
Expected: FAIL with "Cannot find module './activity'".

- [ ] **Step 3: Write the module**

Create `packages/sync/src/activity.ts`:

```ts
import type { SyncActivityEventKind } from '@openldr/db';

/** One high-signal sync outcome, direction-bound by the recorder that emits it. */
export interface SyncActivityEntry {
  event: SyncActivityEventKind;
  records?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

/** A per-direction sink the runners write to. Implementations MUST be fire-and-forget and MUST NOT throw
 *  back into the cycle — sync correctness never depends on the activity write succeeding. */
export interface SyncActivityRecorder {
  /** Called once at the start of every cycle (including idle ones) — updates in-memory liveness only. */
  attempt(): void;
  /** Called only when something happened. Persists a row + updates in-memory success/error markers. */
  record(entry: SyncActivityEntry): void;
}

/** Scrub secrets from an error before it is stored/shown: redact `Bearer <token>` and JWT-shaped
 *  substrings, and cap length. Transport/token errors are the only ones that could carry a credential. */
export function sanitizeSyncError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  let s = raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9._-]{10,}/g, '[redacted-jwt]');
  if (s.length > 500) s = `${s.slice(0, 500)}…`;
  return s;
}
```

- [ ] **Step 4: Re-export from the sync barrel**

In `packages/sync/src/index.ts`, add (next to the other `export * from './...'` lines):

```ts
export * from './activity';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @openldr/sync test -- activity`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/sync/src/activity.ts packages/sync/src/activity.test.ts packages/sync/src/index.ts
git commit -m "feat(sync): SyncActivityRecorder interface + sanitizeSyncError"
```

---

## Task 4: Emit activity from the push runner

**Files:**
- Modify: `packages/sync/src/push-worker.ts`
- Test: `packages/sync/src/push-worker.test.ts`

Emission points (verified against `runCycle` 119–188):
- `attempt()` at cycle start (after `readCursor`).
- `record({event:'failed', ...})` in the transport/token catch (150–152) and in the "central acked at or behind cursor" anomaly (173–177).
- `record({event:'quarantined', ...})` once per rejected record in the `resp.rejects` loop (157–162).
- `record({event:'synced', records: resp.applied, ...})` at the end, ONLY when `resp.applied > 0`.

- [ ] **Step 1: Write the failing test**

Append to `packages/sync/src/push-worker.test.ts` a `describe('activity emission', ...)`. It reuses the file's existing `fakeDb`/`fakeLogger` helpers (read the top of the file) and adds a `fakeActivity()`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createSyncPushRunner, type PushDeps } from './push-worker';

function fakeActivity() {
  const records: { event: string; records?: number; error?: string; metadata?: Record<string, unknown> }[] = [];
  const attempts = { n: 0 };
  return {
    recorder: { attempt: () => { attempts.n++; }, record: (e: any) => { records.push(e); } },
    records,
    attempts,
  };
}

// Minimal deps builder for a push cycle. `postPush` + `readCursor`/rows are stubbed so we can drive
// success / failure / reject paths. Adapt field names to the file's existing helpers if they differ.
function makeDeps(over: Partial<PushDeps>): PushDeps {
  return {
    internalDb: {} as any,
    fetchSafeRows: async () => ({ rows: [], boundary: 0, xmax: 0 }) as any,
    fetchContent: async () => null,
    postPush: async () => ({ ackSeq: 0, applied: 0, rejects: [] }) as any,
    getToken: async () => 'tok',
    readCursor: async () => 0,
    advanceCursor: async () => {},
    logger: { info() {}, warn() {}, error() {}, debug() {} } as any,
    ...over,
  };
}

describe('push runner activity emission', () => {
  it('calls attempt() every cycle and does NOT emit on an idle (no-records) cycle', async () => {
    const act = fakeActivity();
    // fetchSafeRows returns no rows → collectPushRecords yields 0 records → drained/progressed, no postPush.
    const runner = createSyncPushRunner(makeDeps({ activity: act.recorder }));
    await runner.runCycle();
    expect(act.attempts.n).toBe(1);
    expect(act.records).toHaveLength(0);
  });

  it('emits failed with a sanitized error on a transport throw', async () => {
    const act = fakeActivity();
    const runner = createSyncPushRunner(
      makeDeps({
        // Force one record so the cycle reaches postPush, then make postPush throw.
        fetchSafeRows: async () => ({ rows: [{ seq: 1, xid: 1, resource_type: 'Patient', resource_id: 'p1', op: 'upsert' }], boundary: 9, xmax: 9 }) as any,
        internalDb: { selectFrom: () => ({ select: () => ({ where: () => ({ where: () => ({ execute: async () => [{ seq: 1, version: 1, site_id: 's1' }] }) }) }) }) } as any,
        fetchContent: async () => ({ resourceType: 'Patient', id: 'p1' }) as any,
        postPush: async () => { throw new Error('boom Bearer secrettoken123'); },
        activity: act.recorder,
      }),
    );
    await runner.runCycle();
    const failed = act.records.find((r) => r.event === 'failed');
    expect(failed).toBeTruthy();
    expect(failed?.error).not.toContain('secrettoken123');
  });
});
```

> Note to implementer: the exact `fakeDb`/row-shape helpers already exist at the top of `push-worker.test.ts` — prefer reusing them over the inline `internalDb` stub above. The behavioral assertions (attempt count, no idle emission, sanitized `failed`) are what matter. Also add a `synced` assertion using the file's existing "successful push" setup: assert `act.records` contains `{event:'synced', records: <applied>}` and that a `resp.rejects` entry produces a `quarantined` row.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openldr/sync test -- push-worker`
Expected: FAIL (`activity` is not a known `PushDeps` field / no emission happens yet).

- [ ] **Step 3: Add the `activity` dep to `PushDeps`**

In `packages/sync/src/push-worker.ts`, add the import and the optional dep:

```ts
import type { SyncActivityRecorder } from './activity';
import { sanitizeSyncError } from './activity';
```

In `interface PushDeps` (after `logger: Logger;`, ~line 22):

```ts
  /** Optional high-signal activity sink (Track A). Absent = no emission (unit tests / offline collect). */
  activity?: SyncActivityRecorder;
```

- [ ] **Step 4: Emit at the four points**

In `runCycle`, right after `const cursor = await deps.readCursor();` (line 120):

```ts
      deps.activity?.attempt();
```

In the transport/token catch (replace the `return` at line 152) so it records first:

```ts
      } catch (err) {
        // Transport/HTTP/token failure: leave the cursor put so the same window retries next cycle.
        deps.logger.error({ err, fromSeq: cursor, count: records.length }, 'sync push failed; cursor not advanced (will retry)');
        deps.activity?.record({ event: 'failed', error: sanitizeSyncError(err), metadata: { seq: cursor } });
        return { outcome: 'failed', applied: 0 };
      }
```

Inside the `for (const rej of resp.rejects)` loop (after the existing `deps.logger.warn(...)`, line 162):

```ts
        deps.activity?.record({
          event: 'quarantined',
          metadata: { seq: rej.seq, entityId: rej.id, version: rej.version, reason: rej.reason },
        });
```

In the "central acked at or behind the cursor" anomaly branch (after `deps.logger.error(...)`, before `return { outcome: 'failed', applied: resp.applied };` at line 177):

```ts
        deps.activity?.record({
          event: 'failed',
          error: 'central acked at or behind the push cursor',
          metadata: { seq: cursor, ackSeq: resp.ackSeq },
        });
```

At the successful end (before the final `return { outcome: 'progressed', applied: resp.applied };` at line 186):

```ts
      if (resp.applied > 0) {
        deps.activity?.record({ event: 'synced', records: resp.applied, metadata: { seq: target } });
      }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @openldr/sync test -- push-worker`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sync/src/push-worker.ts packages/sync/src/push-worker.test.ts
git commit -m "feat(sync): emit sync_activity from the push runner"
```

---

## Task 5: Emit activity from the reference pull runner

**Files:**
- Modify: `packages/sync/src/pull-worker.ts`
- Test: `packages/sync/src/pull-worker.test.ts`

Emission points (verified against `runCycle` 53–155):
- `attempt()` at cycle start (after `readCursor`).
- `record({event:'failed', ...})` in the transport/token catch (63–64), and in the two "cursor did not advance / held" anomaly returns (137, 150).
- `record({event:'quarantined', ...})` at each place `safeSeq = rec.seq;` is set inside a `catch` (the hold-threshold-crossed branch ~114 and the per-row quarantine branch ~122).
- `record({event:'synced', records: applied, ...})` at the successful end (before line 154), ONLY when `applied > 0`.

- [ ] **Step 1: Write the failing test**

Append an activity `describe` to `packages/sync/src/pull-worker.test.ts` reusing its existing helpers. Assert:
- `attempt()` called once per cycle;
- an empty window (`resp.records.length === 0`) emits nothing (idle);
- a transport throw emits one `failed` (with sanitized error);
- a per-record apply failure (quarantine kind) emits one `quarantined`;
- a fully-applied window with `applied>0` emits one `synced` with the right count.

```ts
import { describe, expect, it } from 'vitest';
import { createSyncPullRunner, type PullDeps } from './pull-worker';

function fakeActivity() {
  const records: any[] = [];
  const attempts = { n: 0 };
  return { recorder: { attempt: () => { attempts.n++; }, record: (e: any) => records.push(e) }, records, attempts };
}

function makeDeps(over: Partial<PullDeps>): PullDeps {
  return {
    postPull: async () => ({ records: [], nextSeq: 0 }) as any,
    getToken: async () => 'tok',
    applyRecord: async () => 'applied',
    readCursor: async () => 0,
    advanceCursor: async () => {},
    logger: { info() {}, warn() {}, error() {}, debug() {} } as any,
    ...over,
  };
}

describe('pull runner activity emission', () => {
  it('attempts every cycle, emits nothing on an empty window', async () => {
    const act = fakeActivity();
    await createSyncPullRunner(makeDeps({ activity: act.recorder })).runCycle();
    expect(act.attempts.n).toBe(1);
    expect(act.records).toHaveLength(0);
  });

  it('emits synced with the applied count on a fully-applied window', async () => {
    const act = fakeActivity();
    await createSyncPullRunner(
      makeDeps({
        postPull: async () => ({ records: [{ seq: 1, entityType: 'x', entityId: 'a', body: {} }, { seq: 2, entityType: 'x', entityId: 'b', body: {} }], nextSeq: 2 }) as any,
        applyRecord: async () => 'applied',
        activity: act.recorder,
      }),
    ).runCycle();
    const synced = act.records.find((r) => r.event === 'synced');
    expect(synced?.records).toBe(2);
  });

  it('emits quarantined when a per-row apply fails', async () => {
    const act = fakeActivity();
    await createSyncPullRunner(
      makeDeps({
        postPull: async () => ({ records: [{ seq: 1, entityType: 'x', entityId: 'bad', body: {} }], nextSeq: 1 }) as any,
        applyRecord: async () => { throw new Error('apply failed'); },
        activity: act.recorder,
      }),
    ).runCycle();
    expect(act.records.some((r) => r.event === 'quarantined')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openldr/sync test -- pull-worker`
Expected: FAIL (`activity` unknown / no emission).

- [ ] **Step 3: Add the `activity` dep**

In `packages/sync/src/pull-worker.ts`:

```ts
import type { SyncActivityRecorder } from './activity';
import { sanitizeSyncError } from './activity';
```

In `interface PullDeps` (after `logger: Logger;`, ~line 26):

```ts
  /** Optional high-signal activity sink (Track A). Absent = no emission. */
  activity?: SyncActivityRecorder;
```

- [ ] **Step 4: Emit at each point**

After `const cursor = await deps.readCursor();` (line 54):

```ts
      deps.activity?.attempt();
```

In the transport catch (after `deps.logger.warn(...)`, before `return` at line 64):

```ts
        deps.activity?.record({ event: 'failed', error: sanitizeSyncError(err), metadata: { seq: cursor } });
```

In the hold-threshold-crossed branch (after `deps.logger.error(... 'quarantined, advancing past')`, at the `safeSeq = rec.seq;` on line 114) add before/after that assignment:

```ts
            deps.activity?.record({ event: 'quarantined', metadata: { seq: rec.seq, entityType: rec.entityType, entityId: rec.entityId } });
```

In the per-row quarantine branch (after `deps.logger.warn(... 'apply failed; skipping (quarantine)')`, at the `safeSeq = rec.seq;` on line 122):

```ts
            deps.activity?.record({ event: 'quarantined', metadata: { seq: rec.seq, entityType: rec.entityType, entityId: rec.entityId } });
```

In the `if (held)` return (after `deps.logger`... nothing there; before `return { outcome: 'failed', applied };` at line 137):

```ts
        deps.activity?.record({ event: 'failed', error: 'sync pull: bulk apply held (will retry)', metadata: { seq: cursor } });
```

In the "window processed but cursor did not advance" branch (after `deps.logger.error(...)`, before `return { outcome: 'failed', applied };` at line 150):

```ts
        deps.activity?.record({ event: 'failed', error: 'sync pull: cursor did not advance', metadata: { seq: cursor, nextSeq: resp.nextSeq } });
```

At the successful end (before `return { outcome: 'progressed', applied };` at line 154):

```ts
      if (applied > 0) deps.activity?.record({ event: 'synced', records: applied, metadata: { seq: target } });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @openldr/sync test -- pull-worker`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sync/src/pull-worker.ts packages/sync/src/pull-worker.test.ts
git commit -m "feat(sync): emit sync_activity from the reference pull runner"
```

---

## Task 6: Emit activity from the amendment pull runner

**Files:**
- Modify: `packages/sync/src/amend-pull-worker.ts`
- Test: `packages/sync/src/amend-pull-worker.test.ts`

Emission points (verified against `runCycle` 32–89). NOTE: the amend runner is direction `'amend'` and does NOT call `attempt()` — the reference pull runner (Task 5) already marks the `pull` liveness each cycle, and both drain inside the same host loop; a second attempt marker would double-count. Amend still emits its own event rows.
- `record({event:'failed', ...})` in the transport catch (39–40) and the no-advance anomaly (79–83).
- `record({event:'diverged', ...})` per record when `result === 'diverged'` (inside the loop at line 50 — this gives one row per divergence with the resource identity, better than the post-loop count).
- `record({event:'quarantined', ...})` in the per-record apply catch (before `safeSeq = rec.seq;` at line 58).
- `record({event:'synced', records: applied, ...})` at the successful end (before line 88), ONLY when `applied > 0`.

- [ ] **Step 1: Write the failing test**

Append an activity `describe` to `packages/sync/src/amend-pull-worker.test.ts` reusing its helpers. Assert a `diverged` result emits one `diverged` row carrying `resourceType`/`id`/`version`, a transport throw emits `failed`, and an applied window emits `synced`:

```ts
import { describe, expect, it } from 'vitest';
import { createAmendmentPullRunner, type AmendPullDeps } from './amend-pull-worker';

function fakeActivity() {
  const records: any[] = [];
  return { recorder: { attempt: () => {}, record: (e: any) => records.push(e) }, records };
}
function makeDeps(over: Partial<AmendPullDeps>): AmendPullDeps {
  return {
    postPull: async () => ({ records: [], nextSeq: 0 }) as any,
    getToken: async () => 'tok',
    applyRecord: async () => 'applied',
    readCursor: async () => 0,
    advanceCursor: async () => {},
    logger: { info() {}, warn() {}, error() {}, debug() {} } as any,
    ...over,
  };
}

describe('amend pull runner activity emission', () => {
  it('emits one diverged row per divergence with resource identity', async () => {
    const act = fakeActivity();
    await createAmendmentPullRunner(
      makeDeps({
        postPull: async () => ({ records: [{ seq: 1, resourceType: 'Observation', id: 'o1', version: 3 }], nextSeq: 1 }) as any,
        applyRecord: async () => 'diverged',
        activity: act.recorder,
      }),
    ).runCycle();
    const div = act.records.find((r) => r.event === 'diverged');
    expect(div?.metadata).toMatchObject({ resourceType: 'Observation', id: 'o1', version: 3 });
  });

  it('emits failed on a transport throw', async () => {
    const act = fakeActivity();
    await createAmendmentPullRunner(
      makeDeps({ postPull: async () => { throw new Error('down'); }, activity: act.recorder }),
    ).runCycle();
    expect(act.records.some((r) => r.event === 'failed')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openldr/sync test -- amend-pull-worker`
Expected: FAIL.

- [ ] **Step 3: Add the `activity` dep**

In `packages/sync/src/amend-pull-worker.ts`:

```ts
import type { SyncActivityRecorder } from './activity';
import { sanitizeSyncError } from './activity';
```

In `interface AmendPullDeps` (after `logger: Logger;`, ~line 17):

```ts
  /** Optional high-signal activity sink (Track A). Direction 'amend'. Absent = no emission. */
  activity?: SyncActivityRecorder;
```

- [ ] **Step 4: Emit at each point**

In the transport catch (after `deps.logger.warn(...)`, before `return` at line 40):

```ts
        deps.activity?.record({ event: 'failed', error: sanitizeSyncError(err), metadata: { seq: cursor } });
```

Inside the loop, replace the `if (result === 'diverged') diverged++;` / `else applied++;` block (49–51) so a divergence emits a row:

```ts
          const result = await deps.applyRecord(rec);
          if (result === 'diverged') {
            diverged++;
            deps.activity?.record({
              event: 'diverged',
              metadata: { resourceType: rec.resourceType, id: rec.id, version: rec.version, seq: rec.seq },
            });
          } else {
            applied++;
          }
          safeSeq = rec.seq;
```

In the per-record apply catch (after `deps.logger.warn(...)`, before/at `safeSeq = rec.seq;` on line 58):

```ts
          deps.activity?.record({
            event: 'quarantined',
            metadata: { resourceType: rec.resourceType, id: rec.id, seq: rec.seq },
          });
```

In the no-advance anomaly branch (after `deps.logger.error(...)`, before `return { outcome: 'failed', applied };` at line 83):

```ts
        deps.activity?.record({ event: 'failed', error: 'sync amend pull: cursor did not advance', metadata: { seq: cursor, nextSeq: resp.nextSeq } });
```

At the successful end (before `return { outcome: 'progressed', applied };` at line 88):

```ts
      if (applied > 0) deps.activity?.record({ event: 'synced', records: applied, metadata: { seq: target } });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @openldr/sync test -- amend-pull-worker`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sync/src/amend-pull-worker.ts packages/sync/src/amend-pull-worker.test.ts
git commit -m "feat(sync): emit sync_activity from the amendment pull runner"
```

---

## Task 7: `SyncActivityTracker` (store + in-memory liveness)

**Files:**
- Create: `packages/bootstrap/src/sync-activity-tracker.ts`
- Create: `packages/bootstrap/src/sync-activity-tracker.test.ts`

The tracker owns the store and the in-memory per-direction liveness. `forDirection(dir)` returns a `SyncActivityRecorder` bound to that direction; `summary(dir)` returns the liveness for `SyncStatus`.

- [ ] **Step 1: Write the failing test**

Create `packages/bootstrap/src/sync-activity-tracker.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { SyncActivityStore } from '@openldr/db';
import { createSyncActivityTracker } from './sync-activity-tracker';

function fakeStore() {
  const rows: any[] = [];
  const store: SyncActivityStore = {
    record: vi.fn(async (input) => { rows.push(input); return { id: String(rows.length), occurredAt: '', ...input, records: input.records ?? 0, error: input.error ?? null, metadata: input.metadata ?? null } as any; }),
    list: vi.fn(async () => rows),
  };
  return { store, rows };
}
const nullLogger = { info() {}, warn() {}, error() {}, debug() {} } as any;

describe('createSyncActivityTracker', () => {
  it('attempt() sets lastAttemptAt without persisting', () => {
    const { store, rows } = fakeStore();
    const tracker = createSyncActivityTracker(store, nullLogger);
    tracker.forDirection('push').attempt();
    expect(tracker.summary('push').lastAttemptAt).toBeTruthy();
    expect(rows).toHaveLength(0); // idle attempt writes no row
  });

  it('record(synced) persists and marks lastSuccessAt; record(failed) marks lastError', async () => {
    const { store, rows } = fakeStore();
    const tracker = createSyncActivityTracker(store, nullLogger);
    const push = tracker.forDirection('push');
    push.record({ event: 'synced', records: 3 });
    push.record({ event: 'failed', error: 'boom' });
    // fire-and-forget persist — flush microtasks
    await Promise.resolve();
    await Promise.resolve();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ direction: 'push', event: 'synced', records: 3 });
    const s = tracker.summary('push');
    expect(s.lastSuccessAt).toBeTruthy();
    expect(s.lastErrorAt).toBeTruthy();
    expect(s.lastError).toBe('boom');
  });

  it('summaries are isolated per direction and default to nulls', () => {
    const { store } = fakeStore();
    const tracker = createSyncActivityTracker(store, nullLogger);
    tracker.forDirection('push').attempt();
    expect(tracker.summary('pull')).toEqual({ lastAttemptAt: null, lastSuccessAt: null, lastErrorAt: null, lastError: null });
  });

  it('never throws when the store rejects (fire-and-forget)', async () => {
    const store: SyncActivityStore = { record: vi.fn(async () => { throw new Error('db down'); }), list: vi.fn(async () => []) };
    const tracker = createSyncActivityTracker(store, nullLogger);
    expect(() => tracker.forDirection('pull').record({ event: 'synced', records: 1 })).not.toThrow();
    await Promise.resolve();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openldr/bootstrap test -- sync-activity-tracker`
Expected: FAIL with "Cannot find module './sync-activity-tracker'".

- [ ] **Step 3: Write the tracker**

Create `packages/bootstrap/src/sync-activity-tracker.ts`:

```ts
import type { Logger, SyncActivityStore, SyncDirection } from '@openldr/db';
import type { SyncActivityEntry, SyncActivityRecorder } from '@openldr/sync';

/** In-memory per-direction liveness for the Sync card header. Idle cycles update `lastAttemptAt` only,
 *  so the header can show "last checked 30s ago" without writing a row. */
export interface DirectionLiveness {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

export interface SyncActivityTracker {
  /** A direction-bound recorder handed to a runner. */
  forDirection(direction: SyncDirection): SyncActivityRecorder;
  /** The current in-memory liveness for a direction (for SyncStatus). */
  summary(direction: SyncDirection): DirectionLiveness;
}

function emptyLiveness(): DirectionLiveness {
  return { lastAttemptAt: null, lastSuccessAt: null, lastErrorAt: null, lastError: null };
}

export function createSyncActivityTracker(store: SyncActivityStore, logger: Logger): SyncActivityTracker {
  const live = new Map<SyncDirection, DirectionLiveness>();
  const get = (d: SyncDirection): DirectionLiveness => {
    let l = live.get(d);
    if (!l) {
      l = emptyLiveness();
      live.set(d, l);
    }
    return l;
  };
  return {
    forDirection(direction) {
      return {
        attempt() {
          get(direction).lastAttemptAt = new Date().toISOString();
        },
        record(entry: SyncActivityEntry) {
          const now = new Date().toISOString();
          const l = get(direction);
          if (entry.event === 'synced') l.lastSuccessAt = now;
          if (entry.event === 'failed') {
            l.lastErrorAt = now;
            l.lastError = entry.error ?? 'sync failed';
          }
          // Persist fire-and-forget: the sync cycle must never slow or fail on the activity write.
          void store
            .record({
              direction,
              event: entry.event,
              records: entry.records,
              error: entry.error ?? null,
              metadata: entry.metadata ?? null,
            })
            .catch((e) =>
              logger.error(
                { err: e instanceof Error ? e.message : String(e), direction, event: entry.event },
                'sync activity persist failed',
              ),
            );
        },
      };
    },
    summary(direction) {
      return { ...get(direction) };
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @openldr/bootstrap test -- sync-activity-tracker`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/sync-activity-tracker.ts packages/bootstrap/src/sync-activity-tracker.test.ts
git commit -m "feat(bootstrap): SyncActivityTracker with per-direction liveness"
```

---

## Task 8: Extend `SyncStatus` with per-direction liveness

**Files:**
- Modify: `packages/bootstrap/src/sync-handle.ts`
- Test: `packages/bootstrap/src/sync-handle.test.ts` (if it exists; otherwise add one)

- [ ] **Step 1: Write/extend the failing test**

If `packages/bootstrap/src/sync-handle.test.ts` exists, add a case; otherwise create it. It builds a fake `SyncRuntimeView` with a running push worker and passes an `activity` stub whose `summary('push')` returns non-null markers, then asserts `status().push` carries them:

```ts
import { describe, expect, it } from 'vitest';
import { createSyncHandle } from './sync-handle';

const runningWorker = { isRunning: () => true, trigger: () => {} };
const runtime = {
  isEnabled: () => true,
  mode: () => 'bidirectional' as const,
  centralUrl: () => 'https://central',
  siteId: () => 'lab-1',
  pushWorker: () => runningWorker,
  pullWorker: () => null,
  retryQuarantine: () => undefined,
};
// Minimal db stub: cursorRow + change_log max. Return no rows → seq 0.
const db = {
  selectFrom: () => ({
    select: () => ({
      where: () => ({ executeTakeFirst: async () => undefined }),
      executeTakeFirst: async () => undefined,
    }),
  }),
} as any;

describe('sync-handle liveness', () => {
  it('folds the activity summary into each direction', async () => {
    const activity = {
      summary: (d: string) =>
        d === 'push'
          ? { lastAttemptAt: '2026-07-19T00:00:00.000Z', lastSuccessAt: '2026-07-19T00:00:01.000Z', lastErrorAt: null, lastError: null }
          : { lastAttemptAt: null, lastSuccessAt: null, lastErrorAt: null, lastError: null },
    };
    const handle = createSyncHandle({ db, runtime, activity });
    const status = await handle.status();
    expect(status.push?.lastAttemptAt).toBe('2026-07-19T00:00:00.000Z');
    expect(status.push?.lastSuccessAt).toBe('2026-07-19T00:00:01.000Z');
    expect(status.push?.lastError).toBeNull();
  });
});
```

> If the db stub shape does not match the file's real query chain, mirror the stub already used by the existing sync-handle test or the `test-helpers.ts` fake. The behavioral assertion (liveness folded into `status().push`) is the point.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openldr/bootstrap test -- sync-handle`
Expected: FAIL (`activity` not accepted by `createSyncHandle`; `push` has no `lastAttemptAt`).

- [ ] **Step 3: Extend the types + merge the summary**

In `packages/bootstrap/src/sync-handle.ts`:

Add the import at the top:

```ts
import type { DirectionLiveness, SyncActivityTracker } from './sync-activity-tracker';
```

Extend `SyncDirectionStatus` (16–23) to carry liveness:

```ts
export interface SyncDirectionStatus {
  /** The worker's live loop state (start()ed and not stop()ped). */
  running: boolean;
  /** The direction's cursor position (last consumed change_log seq). */
  lastSeq: number;
  /** When the cursor last advanced (ISO), or null if it never has. */
  lastSyncedAt: string | null;
  /** When a cycle was last attempted (ISO) — updated even on idle cycles. Null before the first cycle. */
  lastAttemptAt: string | null;
  /** When a cycle last moved data (ISO), or null. */
  lastSuccessAt: string | null;
  /** When a cycle last failed (ISO), or null. */
  lastErrorAt: string | null;
  /** The last failure message (sanitized), or null. */
  lastError: string | null;
}
```

Add `activity` to `createSyncHandle`'s opts (after `divergences?`, ~line 67):

```ts
  /** Track A: per-direction liveness summary source (in-memory). Absent = liveness fields are null. */
  activity?: Pick<SyncActivityTracker, 'summary'>;
```

Change `toDir` (76–86) to accept and spread the liveness:

```ts
  const toDir = (
    row: { last_seq: unknown; updated_at: unknown } | undefined,
    w: WorkerRef | undefined,
    live: DirectionLiveness,
  ): SyncDirectionStatus | null =>
    w
      ? {
          running: w.isRunning(),
          lastSeq: Number(row?.last_seq ?? 0), // bigint reads back as string on real PG
          lastSyncedAt: row?.updated_at ? new Date(row.updated_at as string | number | Date).toISOString() : null,
          ...live,
        }
      : null;
```

In `status()` (89–112), compute the liveness and pass it to both `toDir` calls:

```ts
      const emptyLive: DirectionLiveness = { lastAttemptAt: null, lastSuccessAt: null, lastErrorAt: null, lastError: null };
      const pushLive = opts.activity?.summary('push') ?? emptyLive;
      const pullLive = opts.activity?.summary('pull') ?? emptyLive;
      // ...
      return {
        enabled: opts.runtime.isEnabled(),
        mode: opts.runtime.mode(),
        centralUrl: opts.runtime.centralUrl(),
        siteId: opts.runtime.siteId(),
        push: toDir(pushRow, push, pushLive),
        pull: toDir(pullRow, pull, pullLive),
        pendingPush,
      };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @openldr/bootstrap test -- sync-handle`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/sync-handle.ts packages/bootstrap/src/sync-handle.test.ts
git commit -m "feat(bootstrap): SyncStatus carries per-direction sync liveness"
```

---

## Task 9: Wire the store + tracker into `createAppContext`

**Files:**
- Modify: `packages/bootstrap/src/index.ts`

This is a wiring-only task (no new unit test — covered by the existing `sync-runtime`/`sync-handle` tests plus the typecheck/build gate and the live acceptance). Construct the store + tracker once, inject a per-direction recorder into each runner, pass the tracker to the handle, and expose the store on `AppContext`.

- [ ] **Step 1: Add imports**

At the top of `packages/bootstrap/src/index.ts`, add to the `@openldr/db` import group `createSyncActivityStore` and `type SyncActivityStore`, and add a new import:

```ts
import { createSyncActivityTracker } from './sync-activity-tracker';
```

- [ ] **Step 2: Construct the store + tracker before `buildPush`**

Immediately before `const buildPush = async (syncCfg: SyncConfig): Promise<BuiltPush> => {` (line ~802), add:

```ts
  // Track A — sync activity feed. A bounded, high-signal store of sync outcomes plus an in-memory
  // per-direction liveness tracker. Built ONCE, shared by both runners (via forDirection) and the
  // status handle (via summary). Emitting from the RUNNERS — not the routes — is the whole point.
  const syncActivity = createSyncActivityStore(internal.db, { retentionPerDirection: 200 });
  const syncActivityTracker = createSyncActivityTracker(syncActivity, logger);
```

- [ ] **Step 3: Inject the recorder into each runner's deps**

In `buildPush`, in the `createSyncPushRunner({...})` deps object (after `logger,` at line 843):

```ts
        activity: syncActivityTracker.forDirection('push'),
```

In `buildPull`, in the `createSyncPullRunner({...})` deps (after `logger,` at line 933):

```ts
        activity: syncActivityTracker.forDirection('pull'),
```

In `buildPull`, in the `createAmendmentPullRunner({...})` deps (after `logger,` at line 945):

```ts
        activity: syncActivityTracker.forDirection('amend'),
```

- [ ] **Step 4: Pass the tracker to the handle**

In the `createSyncHandle({...})` call (989–994), add:

```ts
    activity: syncActivityTracker,
```

- [ ] **Step 5: Expose the store on `AppContext`**

In the `AppContext` interface, after `sync: SyncHandle;` (~line 324):

```ts
  /** Track A: bounded, high-signal sync outcome feed. The `/api/settings/sync/activity` endpoint reads
   *  it; the runners write it (via the in-memory tracker). */
  syncActivity: SyncActivityStore;
```

In the ctx return object, after `sync,` (~line 1161):

```ts
    syncActivity,
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @openldr/bootstrap typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): wire sync activity store + tracker into the runtime + context"
```

---

## Task 10: `GET /api/settings/sync/activity` endpoint

**Files:**
- Modify: `apps/server/src/settings-routes.ts`
- Test: `apps/server/src/settings-routes.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/server/src/settings-routes.test.ts`, extend the `fakeCtx` object (add a `syncActivity` stub) and add a test. First, in `fakeCtx`'s returned `ctx` object (beside `sync: {...}`, ~line 30), add:

```ts
      syncActivity: {
        list: vi.fn(async (o?: { direction?: string; limit?: number }) => [
          { id: '1', occurredAt: '2026-07-19T00:00:00.000Z', direction: o?.direction ?? 'push', event: 'synced', records: 5, error: null, metadata: { seq: 7 } },
        ]),
      },
```

Also, for realism, add the four new liveness fields to the shared `SYNC_STATUS.push` literal (~line 10) so the fake matches the extended `SyncDirectionStatus`:

```ts
  push: { running: true, lastSeq: 7, lastSyncedAt: '2026-07-14T00:00:00.000Z', lastAttemptAt: null, lastSuccessAt: null, lastErrorAt: null, lastError: null },
```

Then add the test (mirror the existing status-route test style — build a Fastify app, register routes, inject a request):

```ts
it('GET /api/settings/sync/activity returns rows for lab_admin and passes the direction filter', async () => {
  const { ctx } = fakeCtx();
  const app = Fastify();
  // Reuse whatever auth/role decoration the other tests in this file apply (e.g. a preHandler stub that
  // sets req.user with the lab_admin role). Follow the existing pattern in this file.
  registerSettingsRoutes(app as any, ctx as any);
  await app.ready();

  const res = await app.inject({ method: 'GET', url: '/api/settings/sync/activity?direction=pull', headers: { /* admin auth per this file's convention */ } });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(Array.isArray(body)).toBe(true);
  expect((ctx as any).syncActivity.list).toHaveBeenCalledWith({ direction: 'pull', limit: 50 });
});
```

> Note: match this file's existing convention for satisfying `requireRole('lab_admin')` (the other `/api/settings/sync/*` tests already do this — copy their setup verbatim). If those tests stub `requireRole` or decorate `req.user`, do the same here.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openldr/server test -- settings-routes`
Expected: FAIL (route 404s — not registered yet).

- [ ] **Step 3: Add the route**

In `apps/server/src/settings-routes.ts`, after the `/api/settings/sync/now` handler (ends line 70), add:

```ts
  // Track A: recent sync activity feed (bounded, high-signal). Admin-only, user-authed. Optional
  // ?direction=push|pull|amend filter. Populated by the sync runners, not by routes.
  app.get('/api/settings/sync/activity', { preHandler: requireRole('lab_admin') }, async (req) => {
    const q = req.query as { direction?: string };
    const direction =
      q.direction === 'push' || q.direction === 'pull' || q.direction === 'amend' ? q.direction : undefined;
    return ctx.syncActivity.list({ direction, limit: 50 });
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @openldr/server test -- settings-routes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/settings-routes.ts apps/server/src/settings-routes.test.ts
git commit -m "feat(server): GET /api/settings/sync/activity"
```

---

## Task 11: Studio API client — mirror types + `fetchSyncActivity`

**Files:**
- Modify: `apps/studio/src/api.ts`

Studio manually mirrors server shapes (see the comment at `api.ts:348`). Update the mirror to match the extended `SyncDirectionStatus` and add the activity row type + fetcher.

- [ ] **Step 1: Extend the mirror types**

In `apps/studio/src/api.ts`, replace the `SyncDirectionStatus` line (373) with:

```ts
export interface SyncDirectionStatus {
  running: boolean;
  lastSeq: number;
  lastSyncedAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}
```

- [ ] **Step 2: Add the activity row type + fetcher**

After the `fetchSyncStatus` export (391), add:

```ts
export interface SyncActivityRow {
  id: string;
  occurredAt: string;
  direction: 'push' | 'pull' | 'amend';
  event: 'synced' | 'failed' | 'quarantined' | 'diverged';
  records: number;
  error: string | null;
  metadata: Record<string, unknown> | null;
}

export const fetchSyncActivity = (): Promise<SyncActivityRow[]> =>
  authFetch('/api/settings/sync/activity').then((r) => okJson<SyncActivityRow[]>(r, 'sync activity'));
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @openldr/studio typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/api.ts
git commit -m "feat(studio): sync activity API client + liveness mirror fields"
```

---

## Task 12: Sync card — liveness header + activity timeline

**Files:**
- Modify: `apps/studio/src/pages/settings/General.tsx`
- Modify: `apps/studio/src/i18n/en.ts`
- Modify: `apps/studio/src/i18n/fr.ts`
- Modify: `apps/studio/src/i18n/pt.ts`

- [ ] **Step 1: Add i18n keys (all three locales)**

Under `settings.general.sync.*` in `apps/studio/src/i18n/en.ts`, add:

```ts
        lastSuccess: 'Last success',
        lastError: 'Last error',
        lastChecked: 'Last checked',
        never: 'never',
        activity: 'Recent activity',
        noActivity: 'No sync activity yet.',
        event: {
          synced: 'synced',
          failed: 'failed',
          quarantined: 'quarantined',
          diverged: 'diverged',
        },
```

In `apps/studio/src/i18n/fr.ts` (same keys, French):

```ts
        lastSuccess: 'Dernier succès',
        lastError: 'Dernière erreur',
        lastChecked: 'Dernière vérification',
        never: 'jamais',
        activity: 'Activité récente',
        noActivity: 'Aucune activité de synchronisation pour l’instant.',
        event: {
          synced: 'synchronisé',
          failed: 'échec',
          quarantined: 'en quarantaine',
          diverged: 'divergence',
        },
```

In `apps/studio/src/i18n/pt.ts` (same keys, Portuguese):

```ts
        lastSuccess: 'Último sucesso',
        lastError: 'Último erro',
        lastChecked: 'Última verificação',
        never: 'nunca',
        activity: 'Atividade recente',
        noActivity: 'Ainda não há atividade de sincronização.',
        event: {
          synced: 'sincronizado',
          failed: 'falha',
          quarantined: 'em quarentena',
          diverged: 'divergência',
        },
```

> If the i18n object is typed against `en`, all three must have identical key sets or typecheck fails — add to all three.

- [ ] **Step 2: Import the fetcher + type + add state**

In `General.tsx`, add `SyncActivityRow` and `fetchSyncActivity` to the existing `import { ... } from '../../api'` (or wherever the sync API imports live). Add state beside `syncStatus` (line 38):

```ts
  const [syncActivity, setSyncActivity] = useState<SyncActivityRow[]>([]);
```

- [ ] **Step 3: Fetch activity alongside status**

In `load` (add after `setSyncStatus(await fetchSyncStatus());` at line 54):

```ts
        setSyncActivity(await fetchSyncActivity());
```

In `refreshSyncStatus` (78–84), replace the body so it refreshes both (still best-effort):

```ts
  const refreshSyncStatus = useCallback(async () => {
    try {
      setSyncStatus(await fetchSyncStatus());
      setSyncActivity(await fetchSyncActivity());
    } catch {
      // Status is best-effort telemetry; a transient failure shouldn't surface a toast.
    }
  }, []);
```

(The 10s poll at 129–133 already calls `refreshSyncStatus`, so the timeline auto-refreshes too.)

- [ ] **Step 4: Extend `directionLine` to surface the last error**

Replace `directionLine` (185–191) with:

```ts
  // One-line summary of a sync direction: "not started", or "running/idle · seq N · <time> [· ⚠ <error>]".
  const directionLine = (dir: SyncDirectionStatus | null): string => {
    if (!dir) return t('settings.general.sync.notStarted');
    const state = dir.running ? t('settings.general.sync.running') : t('settings.general.sync.idle');
    const parts = [state, `seq ${dir.lastSeq}`];
    if (dir.lastSyncedAt) parts.push(new Date(dir.lastSyncedAt).toLocaleString());
    if (dir.lastError) parts.push(`⚠ ${dir.lastError}`);
    return parts.join(' · ');
  };
```

- [ ] **Step 5: Add the liveness header + timeline to the live status panel**

In the live status panel (`<div className="flex flex-col gap-2 rounded-md border ...">`, 363–383), after the closing `</dl>` (line 377) and before the "Sync now" button div (378), insert:

```tsx
            {/* Track A: last-checked/success/error header + recent-activity timeline */}
            <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">{t('settings.general.sync.lastChecked')}</dt>
              <dd className="font-mono">
                {syncStatus?.push?.lastAttemptAt || syncStatus?.pull?.lastAttemptAt
                  ? new Date((syncStatus?.push?.lastAttemptAt ?? syncStatus?.pull?.lastAttemptAt) as string).toLocaleString()
                  : t('settings.general.sync.never')}
              </dd>
              <dt className="text-muted-foreground">{t('settings.general.sync.lastSuccess')}</dt>
              <dd className="font-mono">
                {syncStatus?.push?.lastSuccessAt || syncStatus?.pull?.lastSuccessAt
                  ? new Date((syncStatus?.push?.lastSuccessAt ?? syncStatus?.pull?.lastSuccessAt) as string).toLocaleString()
                  : t('settings.general.sync.never')}
              </dd>
            </dl>
            <div className="flex flex-col gap-1">
              <span className="font-medium">{t('settings.general.sync.activity')}</span>
              {syncActivity.length === 0 ? (
                <span className="text-xs text-muted-foreground">{t('settings.general.sync.noActivity')}</span>
              ) : (
                <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-xs">
                  {syncActivity.map((a) => (
                    <li key={a.id} className="flex items-baseline justify-between gap-2 font-mono">
                      <span>
                        <span className="text-muted-foreground">{a.direction}</span>{' '}
                        <span
                          className={
                            a.event === 'failed'
                              ? 'text-destructive'
                              : a.event === 'synced'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-amber-600 dark:text-amber-400'
                          }
                        >
                          {t(`settings.general.sync.event.${a.event}`)}
                        </span>
                        {a.event === 'synced' ? ` (${a.records})` : ''}
                        {a.error ? ` — ${a.error}` : ''}
                      </span>
                      <span className="shrink-0 text-muted-foreground">{new Date(a.occurredAt).toLocaleTimeString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
```

- [ ] **Step 6: Typecheck + build the studio**

Run: `pnpm --filter @openldr/studio typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/pages/settings/General.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): sync activity timeline + liveness header on the Sync card"
```

---

## Task 13: Full workspace gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full turbo gate**

Run: `pnpm turbo typecheck test build`
Expected: PASS across all packages. If a package that consumes `AppContext` in a test builds its own fake `ctx`, it may now need a `syncActivity` stub — add `syncActivity: { list: async () => [] }` to those fakes (search for `test-helpers.ts` / hand-built ctx objects). Known flakes per repo conventions memory may need a re-run; a genuine failure must be fixed, not re-run away.

- [ ] **Step 2: Commit any gate fixups**

```bash
git add -A
git commit -m "test: satisfy AppContext.syncActivity in remaining ctx fakes"
```

---

## Manual live acceptance (after Task 13 — run in the isolated worktree's own stack)

> This is NOT a checkbox task for a subagent — it requires a running lab+central stack and is done by the operator/driver. Stand up a SEPARATE stack from `D:\Projects\openldr-audit-obs` (separate ports + DBs) so the user's dev server on the primary checkout is untouched. Confirm the port/DB arrangement before starting.

1. **Force a failure:** in Settings → General → Sync, set the central URL to an unreachable host (e.g. `https://127.0.0.1:59999`), enable push (or bidirectional), save. Wait for a cycle (or hit "Sync now" with pending push data). Confirm the Sync card shows a `failed` row in the timeline and a "Last error" value, and `GET /api/settings/sync/activity` returns the `failed` row with a sanitized (token-free) error.
2. **Force a quarantine:** drive a pull/amend record that fails apply (or a push record central rejects) so a `quarantined` row is emitted. The simplest reliable path is a poison bulk record crossing the quarantine threshold (see `sync-retry-quarantine.ts`), or a central that rejects a pushed record. Confirm a `quarantined` row appears on the card + endpoint with the entity identity in `metadata`.
3. **Confirm idle cycles write nothing:** with a healthy, caught-up stream, confirm repeated idle cycles do NOT add rows (only "Last checked" updates).
4. **Confirm a real sync:** point back at a reachable central with data to move; confirm a `synced` row with a non-zero record count and "Last success" updating.

Record the observed rows (screenshot the card + the `/activity` JSON) as the acceptance evidence.

---

## Post-implementation

- Request a whole-slice code review (superpowers:requesting-code-review) before merge.
- Merge to local `main` with `--no-ff` (per repo conventions). Do NOT push origin or rebuild/push images until the user approves.
- Update the `audit-observability-workstream` memory: Track A DONE (local `main`, unpushed), note Track B still pending.

---

## Self-review notes (author)

- **Spec coverage:** store+migration (T1–2) ✓; runners emit synced/failed/quarantined/diverged via the runtime (T4–6, wired T9) ✓; high-signal / skip-idle (T4–6 emit only on events; `attempt()` for liveness) ✓; trim-to-N (T2) ✓; `GET /api/settings/sync/activity` (T10) ✓; last-attempt/success/error header + timeline on the Sync card (T8 payload, T12 UI) ✓; sanitize errors (T3 `sanitizeSyncError`, applied in T4–6) ✓; extend `SyncStatus` vs separate call → chose extend + a separate `/activity` for rows (spec's leaning) ✓; retention 200/direction (T9) ✓.
- **Deviation from the spec's mental model (verified in research):** `buildPush`/`buildPull` are injected closures in `packages/bootstrap/src/index.ts` (NOT methods on `SyncRuntime`), and divergence is detected in `packages/db/src/fhir-store.ts` — the amend runner only observes the `'diverged'` result. Emission is therefore wired by injecting a per-direction recorder into each runner's existing `deps`, which is the cleanest faithful reading of "emit from the runners, wired via buildPush/buildPull".
- **Type consistency:** `SyncDirection`/`SyncActivityEventKind` defined once in `@openldr/db` and imported by `@openldr/sync` (no cycle) and `@openldr/bootstrap`; `SyncActivityRecorder`/`SyncActivityEntry` in `@openldr/sync`; `DirectionLiveness`/`SyncActivityTracker` in `@openldr/bootstrap`. `forDirection`/`summary`/`attempt`/`record` names are used identically across tasks.
