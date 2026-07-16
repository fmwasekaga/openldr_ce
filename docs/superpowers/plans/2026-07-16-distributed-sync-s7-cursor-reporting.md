# Distributed Sync S7 — Reported Site Cursors (A1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let central learn how far behind each lab is, by recording every site's reported pull/amendment position — so a later slice can safely trim two logs that currently grow forever.

**Architecture:** A new `sync_site_cursors(site_id, consumer, seq, reported_at)` table. The two HTTP pull routes record the requesting site's `fromSeq` best-effort. The existing single-purpose `sync_sites.reported_pull_cursor` column (written only by the offline-bundle path) migrates onto it and is dropped, so there is one source of truth. **This slice deletes no log data** — it only records.

**Tech Stack:** TypeScript, Kysely (Postgres), Fastify, Vitest, pnpm workspaces, `tsx` for live acceptance harnesses.

**Spec:** `docs/superpowers/specs/2026-07-16-distributed-sync-s7-cursor-reporting-design.md` (commit `8f1c80e4`).

---

## Read This First

### Verification status

Every code block below is **VERIFIED** (I read the file at the cited `file:line` while writing this) or marked **SKETCH** (structure only — open the real file first). Two slices ago this plan style shipped seven fabricated-from-memory errors; last slice it shipped zero in code but two in **lists**. So: **every enumeration here came from a `grep`, not from recall** — and if you find one that's wrong, that's the bug, not a nit.

### Repo landmines

1. **Vitest does NOT typecheck.** It transpiles via esbuild, which strips types without checking. Type errors surface **only** in `pnpm --filter <pkg> typecheck` (`tsc --noEmit`). Run both; typecheck is authoritative for any signature change.
2. **`-- <pattern>` does NOT narrow vitest's file selection here.** The whole suite runs. Look for the specific file's line.
3. **`return reply.send(...)` — always.** `@fastify/compress` is global; a bare/`void`'d send in an **async** handler resolves to `undefined` before an async (gzipped, >1KB) send has written → Fastify re-sends `undefined` → **clobbers the body**. Lint-enforced by `openldr/require-return-reply-send`. **`apps/server` is the only package with real lint** (every other `lint` is `echo "no lint"`).
4. **`bigint` reads back as a STRING on real Postgres, a NUMBER on pg-mem.** Always `Number()`-coerce.
5. **Never `Co-Authored-By` trailers.**
6. **Other sessions share this repo directory.** A hook may report ~60 modified files. Verify *your* tree with `git status`.

### The one decision that will look wrong

**The store NEVER clamps `seq` to `max(stored, incoming)`.** Every *other* cursor in this codebase is monotonic (`advanceChangeCursor`, all three runners use `if (target > cursor)`), so this looks like a missing guard. It isn't:

> A **local** cursor is a *progress counter* — regression means a bug, so guard it.
> A **reported** cursor is a *safety floor* — its only job is "what must central not delete yet?"

A lab restoring from backup legitimately regresses 5000 → 100 and needs 100–5000 **again**. Clamp to `max` and central keeps believing 5000, a later slice trims that range, and the lab **permanently loses records it is actively asking for** — on the disaster-recovery path. Spec §4.1.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/db/src/migrations/internal/057_sync_site_cursors.ts` | **NEW.** Create the table (additive) | 1 |
| `packages/db/src/schema/internal.ts` | `SyncSiteCursorsTable` + registry entry | 1 |
| `packages/db/src/migrations/internal/index.ts` | Register `057` (and `058` in T4) | 1, 4 |
| `packages/db/src/sync-site-cursor-store.ts` | **NEW.** `report` / `get` / `list` — the never-clamp store | 2 |
| `packages/db/src/index.ts` | Barrel | 2 |
| `packages/bootstrap/src/index.ts` | `ctx.syncSiteCursors`, built unconditionally | 3 |
| `packages/bootstrap/src/sync-bundle.ts:219,240` | Both bundle call sites move to the new store | 4 |
| `packages/db/src/migrations/internal/058_drop_reported_pull_cursor.ts` | **NEW.** Drop the old column | 4 |
| `packages/db/src/sync-site-store.ts:26-28,76-90` | Remove the two port methods + impl | 4 |
| `apps/server/src/sync-routes.ts:167,186` | Record `fromSeq` best-effort | 5 |
| `scripts/sync-two-instance-harness.ts` | The only harness on the real HTTP route — the live proof | 6 |

**Task ordering keeps the build green at every commit, and it is not arbitrary.** T1 creates the table *without* dropping the column, because `sync-site-store.ts:79` still selects `reported_pull_cursor` — dropping it in T1 would break typecheck mid-plan. The drop lands in T4, the cutover, together with everything that reads it. Two migrations (`057` create, `058` drop) is the honest shape: add the new thing, then remove the old one once nothing reads it.

---

### Task 1: Migration `057` + schema type (additive)

**Files:**
- Create: `packages/db/src/migrations/internal/057_sync_site_cursors.ts`
- Create: `packages/db/src/migrations/internal/057_sync_site_cursors.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`, `packages/db/src/schema/internal.ts`

**Context:** Purely additive — nothing reads this table yet. **VERIFIED:** `056_sync_divergences` is the highest existing internal migration (`ls packages/db/src/migrations/internal/`), so `057` is next. Model it on `055_sync_quarantine.ts` / `056_sync_divergences.ts` — **read one first**: they create their table **unprefixed** (→ the internal DB's public schema) and are typed into `InternalSchema`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/migrations/internal/057_sync_site_cursors.test.ts`. **VERIFIED:** the real helper is `makeMigratedDb()` from `./test-helpers` (it runs *all* registered migrations — do NOT also call `up()`), and each test ends with `await db.destroy()`. Mirror `056_sync_divergences.test.ts`.

```typescript
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('057_sync_site_cursors', () => {
  it('stores one row per (site_id, consumer)', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('sync_site_cursors').values({ site_id: 'lab-a', consumer: 'sync-pull', seq: 500 } as never).execute();
    await db.insertInto('sync_site_cursors').values({ site_id: 'lab-a', consumer: 'sync-amend-pull', seq: 7 } as never).execute();
    const rows = await db.selectFrom('sync_site_cursors').selectAll().where('site_id', '=', 'lab-a').execute();
    expect(rows.map((r) => Number((r as never as { seq: number }).seq)).sort((a, b) => a - b)).toEqual([7, 500]);
    await db.destroy();
  });

  it('rejects a duplicate (site_id, consumer) — one row per stream, not an append log', async () => {
    const db = await makeMigratedDb();
    const row = { site_id: 'lab-a', consumer: 'sync-pull', seq: 500 };
    await db.insertInto('sync_site_cursors').values(row as never).execute();
    await expect(
      db.insertInto('sync_site_cursors').values({ ...row, seq: 900 } as never).execute(),
    ).rejects.toThrow();
    await db.destroy();
  });

  it('defaults reported_at', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('sync_site_cursors').values({ site_id: 'lab-a', consumer: 'sync-pull', seq: 1 } as never).execute();
    const r = await db.selectFrom('sync_site_cursors').selectAll().executeTakeFirst();
    expect((r as never as { reported_at: Date }).reported_at).toBeInstanceOf(Date);
    await db.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/db test`
Expected: FAIL — `relation "sync_site_cursors" does not exist`.

- [ ] **Step 3: Write the migration**

Create `packages/db/src/migrations/internal/057_sync_site_cursors.ts`:

```typescript
import { type Kysely, sql } from 'kysely';

// Distributed sync S7 (A1): what each enrolled lab REPORTS it has consumed, per stream.
//
// WHY: central holds two append-only logs that labs consume REMOTELY — reference_change_log (S2) and
// sync_amendments (S6a). Trimming either needs the SLOWEST consumer's position, and central could not
// compute it: it recorded a lab's pull position ONLY on the offline-bundle path, never on HTTP (the
// primary transport), and never for amendments at all. This table is how central learns the frontier.
// It is the prerequisite for retention; retention itself is a later slice.
//
// `seq` is the site's reported fromSeq — what it HAS consumed, not what it is about to. Understating
// costs disk; overstating costs records.
//
// ⚠ NEVER CLAMP THIS TO max(stored, incoming). Every OTHER cursor here is monotonic
// (advanceChangeCursor, the runners' `if (target > cursor)`), so this looks like a missing guard. It
// is not. A local cursor is a PROGRESS COUNTER — regression means a bug, guard it. A reported cursor
// is a SAFETY FLOOR — its only job is "what must central not delete yet?" A lab restoring from backup
// legitimately regresses 5000 -> 100 and needs 100-5000 AGAIN. Clamping keeps central at 5000, a later
// slice trims that range, and the lab permanently loses records it is actively asking for — on the
// disaster-recovery path. A regression is INFORMATION, not an error.
//
// Public schema (operational state), sibling of sync_sites / sync_quarantine / sync_divergences.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('sync_site_cursors')
    .addColumn('site_id', 'text', (c) => c.notNull())
    .addColumn('consumer', 'text', (c) => c.notNull())   // 'sync-pull' | 'sync-amend-pull'
    .addColumn('seq', 'bigint', (c) => c.notNull())
    .addColumn('reported_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    // One row per (site, stream) — a CURRENT position, not an append log. A re-report overwrites.
    .addPrimaryKeyConstraint('sync_site_cursors_pkey', ['site_id', 'consumer'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('sync_site_cursors').execute();
}
```

- [ ] **Step 4: Register it**

In `packages/db/src/migrations/internal/index.ts`, beside the `m056` import and map entry:

```typescript
import * as m057 from './057_sync_site_cursors';
```
```typescript
  '057_sync_site_cursors': { up: m057.up, down: m057.down },
```

**VERIFIED (a trap):** `packages/db/src/migrations/migrations.test.ts` asserts `Object.keys(internalMigrations)` with `toEqual` against a **literal array** — registering without adding `'057_sync_site_cursors'` there fails that suite. This bit the divergence slice's T1.

- [ ] **Step 5: Add the schema type**

In `packages/db/src/schema/internal.ts`, after `SyncDivergencesTable`:

```typescript
// Distributed sync S7 (A1): each site's REPORTED consumed position per stream (migration 057).
// See the migration comment: `seq` is NEVER clamped to max — it is a safety floor, not a counter.
export interface SyncSiteCursorsTable {
  site_id: string;
  consumer: string;
  seq: number;
  reported_at: Generated<Date>;
}
```
and register it in `InternalSchema` beside `sync_divergences`:
```typescript
  sync_site_cursors: SyncSiteCursorsTable;
```

- [ ] **Step 6: Verify**

Run: `pnpm --filter @openldr/db test` → the 3 new tests PASS, `migrations.test` PASS
Run: `pnpm --filter @openldr/db typecheck` → clean

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/migrations/internal/057_sync_site_cursors.ts \
        packages/db/src/migrations/internal/057_sync_site_cursors.test.ts \
        packages/db/src/migrations/internal/index.ts \
        packages/db/src/schema/internal.ts \
        packages/db/src/migrations/migrations.test.ts
git commit -m "feat(db): sync_site_cursors table (migration 057)"
```

---

### Task 2: `createSyncSiteCursorStore` — the never-clamp store

**Files:**
- Create: `packages/db/src/sync-site-cursor-store.ts`, `packages/db/src/sync-site-cursor-store.test.ts`
- Modify: `packages/db/src/index.ts` (barrel)

**A YAGNI call, made deliberately — flag it if you disagree.** `list()` has **no production consumer in this slice**: `get` serves T4's bundle reader, `report` serves T5's routes, and nothing reads `reported_at` until A3/#5. It is kept anyway because (a) `reported_at` is *why* the generalized table was chosen over columns on `sync_sites` — it's what lets #5 say *"lab-a hasn't reported since Tuesday"* rather than just *"lab-a is at 500"* — and it is unobservable without a read surface, and (b) it's six lines. If you think that's still YAGNI, say so in your report rather than quietly dropping it.

**Context:** Nothing consumes it yet. **`get` must return `0` for an unknown site**, not `undefined` — T4 moves `exportPullBundle`'s `const from = await ...getReportedPullCursor(opts.siteId); // 0 → full snapshot` onto it, and `undefined` there would serve *nothing* to a brand-new lab instead of *everything*. **VERIFIED** at `sync-bundle.ts:240` and `sync-site-store.ts:82` (`Number(r?.reported_pull_cursor ?? 0)`).

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/sync-site-cursor-store.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createSyncSiteCursorStore } from './sync-site-cursor-store';

describe('sync-site-cursor-store', () => {
  it('reports and reads back a position', async () => {
    const db = await makeMigratedDb();
    const store = createSyncSiteCursorStore(db as never);
    await store.report('lab-a', 'sync-pull', 500);
    expect(await store.get('lab-a', 'sync-pull')).toBe(500);
    await db.destroy();
  });

  it('returns 0 for an unknown site — 0 means "full snapshot", undefined would mean "nothing"', async () => {
    const db = await makeMigratedDb();
    const store = createSyncSiteCursorStore(db as never);
    expect(await store.get('never-seen', 'sync-pull')).toBe(0);
    await db.destroy();
  });

  // THE test. If someone "fixes" the missing monotonic guard, this must go red.
  it('NEVER clamps: a LOWER reported seq overwrites — a lab restored from backup needs those records again', async () => {
    const db = await makeMigratedDb();
    const store = createSyncSiteCursorStore(db as never);
    await store.report('lab-a', 'sync-pull', 5000);
    await store.report('lab-a', 'sync-pull', 100);   // DB restored from backup; cursor regressed
    expect(await store.get('lab-a', 'sync-pull')).toBe(100);
    await db.destroy();
  });

  it('advances reported_at on a re-report', async () => {
    const db = await makeMigratedDb();
    const store = createSyncSiteCursorStore(db as never);
    await store.report('lab-a', 'sync-pull', 1);
    const first = (await store.list()).find((r) => r.siteId === 'lab-a')!.reportedAt.getTime();
    await new Promise((r) => setTimeout(r, 5));
    await store.report('lab-a', 'sync-pull', 2);
    const second = (await store.list()).find((r) => r.siteId === 'lab-a')!.reportedAt.getTime();
    expect(second).toBeGreaterThanOrEqual(first);
    await db.destroy();
  });

  it('keeps the two streams independent for one site', async () => {
    const db = await makeMigratedDb();
    const store = createSyncSiteCursorStore(db as never);
    await store.report('lab-a', 'sync-pull', 500);
    await store.report('lab-a', 'sync-amend-pull', 7);
    expect(await store.get('lab-a', 'sync-pull')).toBe(500);
    expect(await store.get('lab-a', 'sync-amend-pull')).toBe(7);
    expect(await store.list()).toHaveLength(2);
    await db.destroy();
  });
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @openldr/db test` → FAIL, `Failed to load url ./sync-site-cursor-store`

- [ ] **Step 3: Write the implementation**

Create `packages/db/src/sync-site-cursor-store.ts`. **SKETCH — match `sync-quarantine-store.ts`'s idiom for the upsert (`onConflict(...).doUpdateSet(...)`) and the `Number()` coercion; it is the authority.**

```typescript
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

// Distributed sync S7 (A1): what each lab REPORTS it has consumed, per stream (migration 057).
// Central holds two logs the labs consume remotely (reference_change_log, sync_amendments); trimming
// either needs the slowest consumer's position. This is how central learns it. Nothing trims yet.

/** The streams a site reports. Push is deliberately excluded — central needs no push frontier, and a
 *  recorded push cursor would look like lag without being lag (spec §6). */
export type ReportedConsumer = 'sync-pull' | 'sync-amend-pull';

export interface SyncSiteCursorRow {
  siteId: string;
  consumer: ReportedConsumer;
  seq: number;
  reportedAt: Date;
}

export interface SyncSiteCursorStore {
  /** Record what the site says it has consumed. Overwrites — see the never-clamp note below. */
  report(siteId: string, consumer: ReportedConsumer, seq: number): Promise<void>;
  /** The site's reported position, or **0** when never reported. 0 means "give it everything"
   *  (exportPullBundle relies on this); undefined would mean "give it nothing". */
  get(siteId: string, consumer: ReportedConsumer): Promise<number>;
  list(): Promise<SyncSiteCursorRow[]>;
}

export function createSyncSiteCursorStore(db: Kysely<InternalSchema>): SyncSiteCursorStore {
  return {
    async report(siteId, consumer, seq) {
      // ⚠ NO MONOTONIC GUARD, AND THAT IS DELIBERATE. Every other cursor in this codebase clamps with
      // `if (target > cursor)` — because those are PROGRESS COUNTERS, where regression means a bug.
      // This is a SAFETY FLOOR: "what must central not delete yet?" A lab restoring from backup
      // legitimately regresses 5000 -> 100 and needs 100-5000 AGAIN. max() would keep central at 5000,
      // let a later slice trim that range, and permanently destroy records the lab is asking for — on
      // the disaster-recovery path. A regression is INFORMATION. Do not "fix" this.
      await db
        .insertInto('sync_site_cursors')
        .values({ site_id: siteId, consumer, seq })
        .onConflict((oc) =>
          oc.columns(['site_id', 'consumer']).doUpdateSet({ seq, reported_at: sql`now()` }),
        )
        .execute();
    },
    async get(siteId, consumer) {
      const r = await db
        .selectFrom('sync_site_cursors')
        .select('seq')
        .where('site_id', '=', siteId)
        .where('consumer', '=', consumer)
        .executeTakeFirst();
      // bigint reads back as string on real pg, number on pg-mem — always coerce. `?? 0` is
      // load-bearing: exportPullBundle treats 0 as "full snapshot" for a never-seen lab.
      return Number(r?.seq ?? 0);
    },
    async list() {
      const rows = await db.selectFrom('sync_site_cursors').selectAll().orderBy('site_id', 'asc').orderBy('consumer', 'asc').execute();
      return rows.map((r) => ({
        siteId: r.site_id,
        consumer: r.consumer as ReportedConsumer,
        seq: Number(r.seq),
        reportedAt: r.reported_at,
      }));
    },
  };
}
```

- [ ] **Step 4: Barrel**

In `packages/db/src/index.ts`, beside the existing `export * from './sync-divergence-store';`:
```typescript
export * from './sync-site-cursor-store';
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @openldr/db test` → the 5 new tests PASS
Run: `pnpm --filter @openldr/db typecheck` → clean

- [ ] **Step 6: Mutation-check the invariant**

Temporarily add a monotonic guard (`doUpdateSet` only when `excluded.seq > seq`, or an `if` in `report`). Confirm **`NEVER clamps`** goes red. Restore. Every implementer on the last two slices did this and it caught something real each time — and this is the one invariant the whole slice rests on.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/sync-site-cursor-store.ts packages/db/src/sync-site-cursor-store.test.ts packages/db/src/index.ts
git commit -m "feat(db): sync-site-cursor-store — reported positions, never clamped"
```

---

### Task 3: Wire `ctx.syncSiteCursors` into bootstrap

**Files:** modify `packages/bootstrap/src/index.ts`

**Context:** Additive; nothing uses it until T4. Build it **unconditionally**, outside both sync gates — the rows are durable and a later slice reads them regardless of which workers ran. This mirrors `createSyncQuarantineStore` / `createSyncDivergenceStore`, which sit together outside the gates for exactly this reason (S7-A shipped the opposite bug: `listQuarantine` hidden on non-pull nodes).

- [ ] **Step 1: Construct it**

**SKETCH — find where `createSyncDivergenceStore(internal.db)` is constructed and put this immediately beside it.** That placement is the point; do not put it inside `if (syncCfg)`.

```typescript
  // S7 (A1): what each lab reports it has consumed. Built UNCONDITIONALLY, like the quarantine and
  // divergence stores beside it: the rows are durable and a later retention slice must read them on
  // any node. Nothing trims against them yet — this slice only records.
  const syncSiteCursors = createSyncSiteCursorStore(internal.db);
```
Import `createSyncSiteCursorStore` from `@openldr/db` alongside the other store factories. Use whatever local names the neighbours use — they are the authority.

- [ ] **Step 2: Expose on AppContext**

Add `syncSiteCursors` to the `AppContext` type and the returned object, beside the existing `syncSites` binding. **SKETCH — mirror how `syncSites` is declared and returned; grep it.**

- [ ] **Step 3: Verify**

Run: `pnpm --filter @openldr/bootstrap typecheck` → clean
Run: `pnpm --filter @openldr/bootstrap test` → PASS

> If adding a field to `AppContext` breaks test mocks, **fix the mocks** — do not make the field optional to dodge it. A stale `fakeCtx` broke a build in S5, and T4 deals with exactly that.

- [ ] **Step 4: Commit**

```bash
git add packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): expose ctx.syncSiteCursors, built unconditionally"
```

---

### Task 4: Cutover — migrate the bundle path, drop the old column

**Files:**
- Create: `packages/db/src/migrations/internal/058_drop_reported_pull_cursor.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`, `packages/db/src/migrations/migrations.test.ts`
- Modify: `packages/db/src/schema/internal.ts:612`, `packages/db/src/sync-site-store.ts:26-28,76-90`, `packages/db/src/sync-site-store.test.ts:56-59`
- Modify: `packages/bootstrap/src/sync-bundle.ts:219,240`, `packages/bootstrap/src/sync-bundle.test.ts`
- Modify: `apps/server/src/settings-sync-routes.test.ts:78-79`
- Modify: `scripts/sync-bundle-live-acceptance.ts:287-289`

**Context — this is the whole cutover and it lands in ONE commit**, or the tree won't compile between commits. Two sources of truth for "where is lab X" is exactly the drift this slice exists to prevent.

**VERIFIED — the complete list of touchers** (from `grep -rni "reportedpullcursor|reported_pull_cursor" --include=*.ts packages/ apps/ scripts/`; this is a filesystem enumeration, not recall):

| Site | Role |
|---|---|
| `sync-bundle.ts:219` | **writer** — `setReportedPullCursor(manifest.siteId, manifest.pullCursor)` on push-bundle import |
| `sync-bundle.ts:240` | **reader** — `const from = await ctx.syncSites.getReportedPullCursor(opts.siteId); // 0 → full snapshot` |
| `sync-site-store.ts:26-28` | port decls | 
| `sync-site-store.ts:76-90` | impls |
| `schema/internal.ts:612` | `reported_pull_cursor: string \| null;` |
| `sync-site-store.test.ts:56-59` | pins **"null column reads as 0"** — the semantic `exportPullBundle` depends on |
| `sync-bundle.test.ts` | 9 sites (fake store + assertions at `:295`, `:382`) |
| `settings-sync-routes.test.ts:78-79` | a **`fakeCtx` mock** implementing both — S5's stale-mock trap |
| `sync-bundle-live-acceptance.ts:287-289` | asserts the piggyback landed — **the only live proof S5 works** |

- [ ] **Step 1: Migrate the bundle writer**

`packages/bootstrap/src/sync-bundle.ts:219` — **VERIFIED, current:**
```typescript
  if (manifest.pullCursor != null) await ctx.syncSites.setReportedPullCursor(manifest.siteId, manifest.pullCursor);
```
becomes:
```typescript
  if (manifest.pullCursor != null) await ctx.syncSiteCursors.report(manifest.siteId, 'sync-pull', manifest.pullCursor);
```

- [ ] **Step 2: Migrate the bundle reader**

`sync-bundle.ts:240` — **VERIFIED, current:**
```typescript
  const from = await ctx.syncSites.getReportedPullCursor(opts.siteId); // 0 → full snapshot
```
becomes:
```typescript
  const from = await ctx.syncSiteCursors.get(opts.siteId, 'sync-pull'); // 0 → full snapshot
```
**The `0 → full snapshot` semantic is load-bearing** — T2's store returns `0` for an unknown site precisely so a first-ever bundle export for a new lab serves *everything*, not *nothing*.

- [ ] **Step 3: Remove the port methods**

`packages/db/src/sync-site-store.ts` — delete lines **26-28** (**VERIFIED, current:**)
```typescript
  // Sync S5: the lab's last-applied 'sync-pull' position (0 when unknown/null).
  getReportedPullCursor(siteId: string): Promise<number>;
  setReportedPullCursor(siteId: string, seq: number): Promise<void>;
```
and the two impls at **76-90**. Nothing else in that file references the column.

- [ ] **Step 4: Drop the column**

Create `packages/db/src/migrations/internal/058_drop_reported_pull_cursor.ts`:

```typescript
import { type Kysely } from 'kysely';

// Distributed sync S7 (A1): sync_sites.reported_pull_cursor (migration 052) is superseded by
// sync_site_cursors (057). It only ever tracked ONE stream ('sync-pull') and was written ONLY by the
// offline-bundle path — never by HTTP, which is the primary transport. Keeping it beside the new table
// would leave two sources of truth for the same fact, written by two transports, for a later retention
// slice to reconcile. One source of truth instead.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('sync_sites').dropColumn('reported_pull_cursor').execute();
}

// Restores the column but NOT its data — the values live in sync_site_cursors now. A down-migration
// past 057 loses the reported positions, which is safe: they are re-reported on the next pull, and
// nothing trims against them in this slice.
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('sync_sites').addColumn('reported_pull_cursor', 'bigint').execute();
}
```
Register it in `migrations/internal/index.ts` (import + map entry) **and add `'058_drop_reported_pull_cursor'` to the literal array in `migrations.test.ts`** — that suite `toEqual`s the key list.

Remove `reported_pull_cursor: string | null;` from `schema/internal.ts:612`.

- [ ] **Step 5: Migrate every test + the harness**

- `sync-site-store.test.ts:56-59` — **move** the "null column reads as 0" assertion to `sync-site-cursor-store.test.ts` if T2 doesn't already cover it (it does: *"returns 0 for an unknown site"*). Delete the old one; do not leave it asserting a dropped column.
- `sync-bundle.test.ts` — the fake `syncSites` store's `get/setReportedPullCursor` and the `reportedPullCursor` row field move to a fake `syncSiteCursors` with `report`/`get`. **Keep the assertions at `:295` (`toBe(4)`) and `:382` (`toBe(9)`, "piggyback still recorded")** — retarget them, never delete them.
- `settings-sync-routes.test.ts:78-79` — remove `get/setReportedPullCursor` from the `fakeCtx`; add a `syncSiteCursors` stub if the type now requires one.
- `sync-bundle-live-acceptance.ts:287-289` — retarget to `centralCtx.syncSiteCursors.get(SITE_ID, 'sync-pull')`. **This is the only live proof S5's piggyback works — migrate the assertion, do not drop it.**

- [ ] **Step 6: Verify**

```
pnpm --filter @openldr/db test && pnpm --filter @openldr/db typecheck
pnpm --filter @openldr/bootstrap test && pnpm --filter @openldr/bootstrap typecheck
pnpm --filter @openldr/server test && pnpm --filter @openldr/server typecheck
pnpm sync:bundle:accept      # THE one that matters — the live piggyback proof
```
`sync:bundle:accept` failing means the cutover broke S5. **Do not weaken that harness to make it pass.**

- [ ] **Step 7: Commit**

```bash
git add packages/db/src packages/bootstrap/src/sync-bundle.ts packages/bootstrap/src/sync-bundle.test.ts \
        apps/server/src/settings-sync-routes.test.ts scripts/sync-bundle-live-acceptance.ts
git commit -m "refactor(sync): move the bundle's reported pull cursor onto sync_site_cursors; drop the column"
```

---

### Task 5: Record on the two HTTP pull routes

**Files:** modify `apps/server/src/sync-routes.ts:167,186`; `apps/server/src/sync-routes.test.ts`

**Context:** The point of the slice. **VERIFIED — the two routes as they stand** (`sync-routes.ts:167-195`): both already resolve a `sitePrincipal` and sanitize `fromSeq` with `typeof rawFrom === 'number' && Number.isFinite(rawFrom) ? rawFrom : 0`. **Keep that sanitization exactly as is** — `fromSeq` crosses a trust boundary.

**Recording is best-effort** — wrapped, logged, never allowed to fail a pull. The failure mode is conservative: if it throws, the floor stays stale-**low** and a later slice trims **less**. Nothing is lost.

**The site comes from `principal.siteId` (token-derived), NEVER from the body.**

- [ ] **Step 1: Write the failing test**

Add to `apps/server/src/sync-routes.test.ts` — **read it first and reuse its real fake-`ctx` + auth helpers; do not invent names.**

```typescript
  it('records the reporting site fromSeq (not nextSeq) on pull', async () => {
    const reported: unknown[] = [];
    // build the app with ctx.syncSiteCursors.report capturing args, servePull returning nextSeq 900
    const res = await app.inject({ method: 'POST', url: '/api/sync/pull', headers: authHeaders('lab-a'), payload: { fromSeq: 500 } });
    expect(res.statusCode).toBe(200);
    expect(reported).toEqual([['lab-a', 'sync-pull', 500]]);   // fromSeq, NOT the response's nextSeq
  });

  it('records on pull-amendments under its own consumer', async () => {
    // → [['lab-a', 'sync-amend-pull', 7]]
  });

  it('a throwing cursor store does NOT fail the pull', async () => {
    // ctx.syncSiteCursors.report rejects; assert 200 and the records still come back
  });

  it('a non-finite fromSeq records 0, not NaN (trust boundary)', async () => {
    // payload { fromSeq: 'haha' } → reported seq === 0
  });

  it('records the TOKEN-derived site, never a body-supplied one', async () => {
    // payload { fromSeq: 1, siteId: 'lab-evil' } with a lab-a token → reported site is 'lab-a'
  });
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @openldr/server test` → FAIL (nothing records).

- [ ] **Step 3: Add the recording**

In `/api/sync/pull` (after `servePull`, before the send) and `/api/sync/pull-amendments` (after `serveAmendments`):

```typescript
    // S7 (A1): record what this lab says it has consumed, so a later slice can trim
    // reference_change_log / sync_amendments against the SLOWEST site. fromSeq — what it HAS — not
    // nextSeq, which it may fail to apply. Best-effort: a failure here leaves the floor stale-LOW, so
    // a later slice trims LESS. Never fail a pull over bookkeeping.
    try {
      await ctx.syncSiteCursors.report(principal.siteId, 'sync-pull', fromSeq);
    } catch (err) {
      ctx.logger.warn({ err, siteId: principal.siteId }, 'sync pull: failed to record the reported cursor');
    }
```
(`'sync-amend-pull'` and the matching log string on the amendments route.)

**Do not touch the `return reply.code(200).send(...)` lines** — the `return` is lint-enforced and load-bearing.

- [ ] **Step 4: Verify**

```
pnpm --filter @openldr/server test        # PASS
pnpm --filter @openldr/server lint        # PASS — MANDATORY, guards the #1 landmine
pnpm --filter @openldr/server typecheck   # clean
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/sync-routes.ts apps/server/src/sync-routes.test.ts
git commit -m "feat(server): record each site's reported pull + amendment cursor"
```

---

### Task 6: `sync:e2e` — the live proof, and it must be able to fail

**Files:** modify `scripts/sync-two-instance-harness.ts`

**Context — read this.** Both pull harnesses (`sync:pull:accept`, `sync:amend:accept`) **bypass the route**: they call `serve*` directly and say so in their headers ("does NOT stand up Fastify/JWKS"). So the recording added in T5 is in the one place no live harness looks — the S7-A/S7-B trap.

**`sync:e2e` is the only harness that drives the real HTTP route**, with real tokens against real Keycloak. It is this slice's *entire* live coverage.

- [ ] **Step 1: Assert both cursors**

After the harness's existing HTTP pull and amendment drains, assert `sync_site_cursors` holds a row for the enrolled site under each consumer, with the seq the lab actually sent. **SKETCH — reuse the harness's real `assert` closure and its central ctx/db handle; do not invent scaffolding.**

```typescript
    step('N. central recorded the lab reported cursors over the REAL HTTP route');
    const pullCur = await centralCtx.syncSiteCursors.get(SITE_ID, 'sync-pull');
    assert(pullCur >= 0 && Number.isFinite(pullCur), `central recorded a sync-pull cursor for ${SITE_ID} (got ${pullCur})`);
    const amendCur = await centralCtx.syncSiteCursors.get(SITE_ID, 'sync-amend-pull');
    assert(Number.isFinite(amendCur), `central recorded a sync-amend-pull cursor for ${SITE_ID} (got ${amendCur})`);
```
**Assert the actual expected values, not just finiteness**, if the harness knows what the lab's cursor should be — `>= 0` would pass against a stubbed 0. Work out the real expectation from the harness's own drain and pin it. If you genuinely cannot, say so in your report rather than shipping a vacuous assert.

- [ ] **Step 2: Run it**

Run: `pnpm sync:e2e` → PASS. Needs Postgres on `:5433` **and Keycloak on `:8180`**. **If Keycloak is down, report BLOCKED** — do not let the harness skip. A skip here silently removes this slice's only live coverage (spec §9).

- [ ] **Step 3: ⚠️ Prove it can FAIL**

Comment out the `report` call in `/api/sync/pull` (T5) and re-run `pnpm sync:e2e`.
**It MUST FAIL** on the pull-cursor assertion. If it passes, the assertion is vacuous — fix it before proceeding.
Restore, verify `git diff` is clean on `sync-routes.ts`, re-run → PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-two-instance-harness.ts
git commit -m "test(sync): sync:e2e asserts the reported cursors land over real HTTP"
```

---

### Task 7: Full gate + regression

- [ ] **Step 1: Gate**

Run: `pnpm turbo typecheck test build --concurrency=1`

`--concurrency=1` is deliberate — parallel runs flake on this machine (two different untouched packages failed on two consecutive runs last slice; both passed when run directly).

Expected: all pass **except `@openldr/cli#build`**, a **known pre-existing** failure (missing native `.node` bindings — `ssh2`/`cpu-features`, un-run node-gyp) that fails identically at commits predating this work. **Anything else that fails is yours.**

- [ ] **Step 2: All 11 sync harnesses**

```bash
pnpm sync:accept ; pnpm sync:pull:accept ; pnpm sync:amend:accept
pnpm sync:order-status:accept ; pnpm sync:patient-merge:accept
pnpm sync:quarantine:accept ; pnpm sync:terminology:accept
pnpm sync:bundle:accept        # the cutover's live proof
pnpm sync:divergence:accept ; pnpm sync:drain:accept
pnpm sync:e2e                  # THIS slice's only live coverage
```
All must PASS. `sync:bundle:accept` and `sync:e2e` are the two that can actually catch this slice.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix(sync): address cursor-reporting gate findings"
```

---

## Definition of Done

- [ ] `pnpm turbo typecheck test build --concurrency=1` green (except the pre-existing `@openldr/cli#build`)
- [ ] `pnpm --filter @openldr/server lint` green
- [ ] All 11 sync harnesses pass live
- [ ] `pnpm sync:e2e` **fails** when T5's `report` call is removed (Task 6 step 3)
- [ ] The never-clamp test **fails** when a monotonic guard is added (Task 2 step 6)
- [ ] Whole-slice review performed — **not** just per-task gates. Five slices running, it has found the one real defect the per-task lens structurally cannot. Carry these in explicitly:
  - Is `report` genuinely un-clamped, and does a test pin it?
  - Does `get` return `0` (not `undefined`) for an unknown site — and does `exportPullBundle` still serve a full snapshot to a never-seen lab?
  - Is `syncSiteCursors` constructed **outside** both sync gates?
  - Did any migrated test lose an assertion? (`sync-bundle.test.ts:295/:382` and the bundle harness are the ones to check.)
  - Is recording genuinely best-effort — does a throwing store still return 200 with records?
- [ ] Merged to local `main` with `--no-ff`; verify `git rev-list --parents -n 1 HEAD` shows **two** parents; **ask before pushing**
