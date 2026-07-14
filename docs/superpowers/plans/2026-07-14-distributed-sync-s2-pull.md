# Distributed Sync S2 — Directional Pull (central → lab) reference data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A central instance captures every change to its center-authored reference config (forms, dashboards, reports, allowlisted feature-flag settings) in an append-only `reference_change_log`; each enrolled lab pulls those changes over `POST /api/sync/pull` and mirrors them locally — adds, edits, and deletes — stamping them `managed_origin='central'` so a lab's own locally-authored config is never touched. Proven by a two-Postgres round-trip.

**Architecture:** Mirror of S1 but reversed and for reference data. New `reference_change_log` (public schema) + a `recordReferenceChange` capture helper the four config stores call on write (content-hash deduped, reusing the `canonicalJson` primitive). A `managed_origin` marker column on the three config tables distinguishes center-managed rows from lab-local. A capture-free `applyReferenceChange` dispatcher applies pulled changes on the lab. Transport reuses S1's `/api/sync/` auth bypass + `sitePrincipal` + token provider; a new `createSyncPullRunner` (in `@openldr/sync`) and `createSyncPullWorker` (bootstrap host loop) drive it, config-gated by the same `sync.enabled`.

**Tech Stack:** TypeScript, Kysely, Fastify (`apps/server`), Vitest, pg-mem for unit tests, real Postgres for the two-DB acceptance.

**Spec:** `docs/superpowers/specs/2026-07-14-distributed-sync-s2-pull-design.md`

**Key substrate to read first (all exist):**
- `packages/dashboards/src/seed.ts` (`canonicalJson` at ~line 40 — the content-hash primitive to promote; `seedDefaultDashboard` — a store-seed path that will now capture) and `packages/dashboards/src/store.ts` (`createDashboardStore`: `create`/`update`/`remove`).
- `packages/db/src/report-store.ts` (`createReportStore`: `ReportRecord`, `create`/`update`/`remove`, `toRow`/`fromRow`) and `packages/db/src/app-settings-store.ts` (`AppSettingStore`: `get`/`getAll`/`set`).
- `packages/forms/src/store.ts` (`createFormStore`: `publish`/`update`/`setStatus`/`delete`/`get`).
- `packages/db/src/projection/cursor.ts` (`readCursor(db, consumer)` / `advanceCursor(db, consumer, seq)` over `fhir.change_cursors` — reused verbatim with consumer `'sync-pull'`).
- `packages/db/src/fhir-store.ts` (`applyRemote` — the model for a capture-free apply primitive; `contentHash` module helper).
- `apps/server/src/sync-routes.ts` (`registerSyncRoutes`, `sitePrincipal`) + `apps/server/src/auth-plugin.ts` (`/api/sync/` bypass) + `apps/server/src/app.ts`.
- `packages/sync/src/{batch.ts,push-worker.ts,token.ts,config.ts}` + `packages/bootstrap/src/{sync-push-worker.ts,index.ts}` (the S1 mirror the pull side follows).
- `packages/db/src/schema/internal.ts` (add table + column types here) + an example additive migration (e.g. `packages/db/src/migrations/internal/046_fhir_versioning.ts`) + the migration registry (how migrations are listed/ordered).

**Naming note:** the current highest internal migration referenced in memory is `046_fhir_versioning`. Before creating migrations, LIST `packages/db/src/migrations/internal/` and use the next free numbers in sequence; the two new migrations below are written as `NNN` / `NNN+1` — substitute the real numbers and match the registry-registration pattern the existing migrations use.

---

## Task 0: Cut the branch

- [ ] Run:
```bash
git checkout main
git checkout -b feat/sync-s2-pull
git branch --show-current
```
Expected: `feat/sync-s2-pull`. Clean tree (spec + plan committed on `main`).

---

## Task 1: Shared `canonicalJson` content-hash helper

**Files:** Create `packages/core/src/canonical-json.ts` (or the nearest existing shared util in `@openldr/core` — READ `packages/core/src/index.ts` first to place it correctly); Modify `packages/dashboards/src/seed.ts` (import the shared one, delete the local copy); Test `packages/core/src/canonical-json.test.ts`.

The content-hash primitive must be shared so the capture helper (Task 2), the four stores (Task 4), and any consumer compute the SAME hash.

- [ ] **Step 1: Write the failing test** (`packages/core/src/canonical-json.test.ts`):
```ts
import { describe, it, expect } from 'vitest';
import { canonicalJson, canonicalHash } from './canonical-json';

describe('canonicalJson', () => {
  it('is insensitive to object key order', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
  it('sorts keys recursively but preserves array order', () => {
    expect(canonicalJson({ x: [{ b: 1, a: 2 }] })).toBe(canonicalJson({ x: [{ a: 2, b: 1 }] }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
  it('canonicalHash is a stable hex digest of the canonical form', () => {
    const h1 = canonicalHash({ a: 1, b: 2 });
    const h2 = canonicalHash({ b: 2, a: 1 });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (`canonical-json` not found):
```bash
pnpm --filter @openldr/core exec vitest run src/canonical-json.test.ts
```

- [ ] **Step 3: Implement** (`packages/core/src/canonical-json.ts`):
```ts
import { createHash } from 'node:crypto';

/** JSON with object keys recursively sorted (arrays keep order), so equality is key-order-insensitive.
 *  Postgres re-sorts jsonb keys on read, so a plain JSON.stringify would report spurious diffs. */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.keys(val as Record<string, unknown>).sort().reduce<Record<string, unknown>>(
          (o, k) => { o[k] = (val as Record<string, unknown>)[k]; return o; }, {})
      : val);
}

/** SHA-256 hex digest of the canonical JSON form. Stable across key reordering. */
export function canonicalHash(v: unknown): string {
  return createHash('sha256').update(canonicalJson(v)).digest('hex');
}
```
Export both from `packages/core/src/index.ts`.

- [ ] **Step 4: Refactor `packages/dashboards/src/seed.ts`** — delete its local `canonicalJson` (lines ~40-45) and `import { canonicalJson } from '@openldr/core';`. Confirm `@openldr/core` is a dep of `@openldr/dashboards` (it is if other imports exist; else add `workspace:*`). Leave `dashboardContentEqual` using the imported `canonicalJson`.

- [ ] **Step 5: Run tests + the dashboards seed test to confirm no regression:**
```bash
pnpm --filter @openldr/core exec vitest run src/canonical-json.test.ts
pnpm --filter @openldr/dashboards exec vitest run
```
Expected: PASS.

- [ ] **Step 6: Commit** (no `Co-Authored-By`):
```bash
git add packages/core/src/canonical-json.ts packages/core/src/canonical-json.test.ts packages/core/src/index.ts packages/dashboards/src/seed.ts
git commit -m "refactor(core): shared canonicalJson + canonicalHash content-hash helper (sync S2)"
```

---

## Task 2: `reference_change_log` table + `recordReferenceChange` capture helper

**Files:** Create `packages/db/src/migrations/internal/NNN_reference_change_log.ts`; register it in the migration registry; Modify `packages/db/src/schema/internal.ts` (add the table type); Create `packages/db/src/reference-change-log.ts` + `packages/db/src/reference-change-log.test.ts`.

- [ ] **Step 1: Migration** (`NNN_reference_change_log.ts`) — match the `up`/`down` shape of an existing internal migration:
```ts
import { type Kysely, sql } from 'kysely';
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createTable('reference_change_log')
    .addColumn('seq', 'bigserial', (c) => c.primaryKey())
    .addColumn('entity_type', 'text', (c) => c.notNull())
    .addColumn('entity_id', 'text', (c) => c.notNull())
    .addColumn('op', 'text', (c) => c.notNull())
    .addColumn('content_hash', 'text')
    .addColumn('recorded_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('reference_change_log_entity_idx')
    .on('reference_change_log').columns(['entity_type', 'entity_id', 'seq']).execute();
}
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('reference_change_log').execute();
}
```
Register in the migration registry exactly as the existing internal migrations are registered (READ the registry file and mirror the pattern).

- [ ] **Step 2: Add the table type to `InternalSchema`** in `packages/db/src/schema/internal.ts`:
```ts
// add to the InternalSchema interface:
'reference_change_log': {
  seq: Generated<number>;
  entity_type: string;
  entity_id: string;
  op: string;
  content_hash: string | null;
  recorded_at: Generated<Date>;
};
```
Use whatever `Generated`/`ColumnType` imports the file already uses (match the `fhir.change_log` entry's style).

- [ ] **Step 3: Write the failing test** (`packages/db/src/reference-change-log.test.ts`) — use the package's pg-mem migrated-db helper (`makeMigratedDb` or equivalent — READ how `fhir-store-apply.test.ts` builds its db and mirror it):
```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers'; // use the real helper name from fhir-store-apply.test.ts
import { recordReferenceChange, ENTITY_TYPES } from './reference-change-log';

describe('recordReferenceChange', () => {
  it('appends an upsert row with the content hash', async () => {
    const db = await makeMigratedDb();
    await db.transaction().execute((trx) => recordReferenceChange(trx, 'dashboard', 'd1', 'upsert', 'hashA'));
    const rows = await db.selectFrom('reference_change_log').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity_type: 'dashboard', entity_id: 'd1', op: 'upsert', content_hash: 'hashA' });
  });

  it('is a no-op when the latest row for the entity has the same content hash', async () => {
    const db = await makeMigratedDb();
    await db.transaction().execute((trx) => recordReferenceChange(trx, 'dashboard', 'd1', 'upsert', 'hashA'));
    await db.transaction().execute((trx) => recordReferenceChange(trx, 'dashboard', 'd1', 'upsert', 'hashA'));
    expect(await db.selectFrom('reference_change_log').selectAll().execute()).toHaveLength(1);
  });

  it('appends a new row when the content hash changes', async () => {
    const db = await makeMigratedDb();
    await db.transaction().execute((trx) => recordReferenceChange(trx, 'dashboard', 'd1', 'upsert', 'hashA'));
    await db.transaction().execute((trx) => recordReferenceChange(trx, 'dashboard', 'd1', 'upsert', 'hashB'));
    expect(await db.selectFrom('reference_change_log').selectAll().execute()).toHaveLength(2);
  });

  it('appends a delete tombstone unless the latest row is already a delete', async () => {
    const db = await makeMigratedDb();
    await db.transaction().execute((trx) => recordReferenceChange(trx, 'dashboard', 'd1', 'upsert', 'hashA'));
    await db.transaction().execute((trx) => recordReferenceChange(trx, 'dashboard', 'd1', 'delete', null));
    await db.transaction().execute((trx) => recordReferenceChange(trx, 'dashboard', 'd1', 'delete', null));
    const ops = (await db.selectFrom('reference_change_log').select('op').orderBy('seq').execute()).map((r) => r.op);
    expect(ops).toEqual(['upsert', 'delete']);
  });
});
```

- [ ] **Step 4: Run it, expect FAIL** (module not found):
```bash
pnpm --filter @openldr/db exec vitest run src/reference-change-log.test.ts
```

- [ ] **Step 5: Implement** (`packages/db/src/reference-change-log.ts`):
```ts
import type { Kysely, Transaction } from 'kysely';
import type { InternalSchema } from './schema/internal';

export type ReferenceEntityType = 'form' | 'dashboard' | 'report' | 'setting';
export const ENTITY_TYPES: ReferenceEntityType[] = ['form', 'dashboard', 'report', 'setting'];
export type ReferenceOp = 'upsert' | 'delete';

/** Append a reference-data change to the log — but only if it differs from the entity's latest logged
 *  state (same content_hash on an upsert, or a delete after a delete → no-op). Runs inside the caller's
 *  transaction so capture is atomic with the store write. */
export async function recordReferenceChange(
  trx: Transaction<InternalSchema> | Kysely<InternalSchema>,
  entityType: ReferenceEntityType, entityId: string, op: ReferenceOp, contentHash: string | null,
): Promise<void> {
  const latest = await trx.selectFrom('reference_change_log')
    .select(['op', 'content_hash'])
    .where('entity_type', '=', entityType).where('entity_id', '=', entityId)
    .orderBy('seq', 'desc').limit(1).executeTakeFirst();
  if (latest) {
    if (op === 'upsert' && latest.op === 'upsert' && latest.content_hash === contentHash) return; // unchanged
    if (op === 'delete' && latest.op === 'delete') return; // already tombstoned
  } else if (op === 'delete') {
    return; // nothing to tombstone
  }
  await trx.insertInto('reference_change_log')
    .values({ entity_type: entityType, entity_id: entityId, op, content_hash: contentHash })
    .execute();
}
```

- [ ] **Step 6: Run tests, expect PASS; typecheck; commit:**
```bash
pnpm --filter @openldr/db exec vitest run src/reference-change-log.test.ts
pnpm --filter @openldr/db exec tsc --noEmit
git add packages/db/src/migrations packages/db/src/schema/internal.ts packages/db/src/reference-change-log.ts packages/db/src/reference-change-log.test.ts
git commit -m "feat(db): reference_change_log table + recordReferenceChange capture helper (sync S2)"
```

---

## Task 3: `managed_origin` marker migration

**Files:** Create `packages/db/src/migrations/internal/NNN+1_managed_origin.ts`; register it; Modify `packages/db/src/schema/internal.ts` (+ the dashboards table type if it lives in `@openldr/dashboards`'s own schema — CHECK where `dashboards`/`form_definitions`/`reports` column types are declared and add `managed_origin` to each).

- [ ] **Step 1: Migration** (`NNN+1_managed_origin.ts`):
```ts
import { type Kysely } from 'kysely';
export async function up(db: Kysely<any>): Promise<void> {
  for (const table of ['form_definitions', 'dashboards', 'reports']) {
    await db.schema.alterTable(table).addColumn('managed_origin', 'text').execute();
  }
}
export async function down(db: Kysely<any>): Promise<void> {
  for (const table of ['form_definitions', 'dashboards', 'reports']) {
    await db.schema.alterTable(table).dropColumn('managed_origin').execute();
  }
}
```
Register in the registry.

- [ ] **Step 2: Add `managed_origin: string | null` (nullable, default null)** to the `form_definitions`, `dashboards`, and `reports` table types in whichever schema file(s) declare them. Grep for each table name in `packages/db/src/schema/` and `packages/dashboards/src/` to find the declarations; add the column to each.

- [ ] **Step 3: Migration test** (`packages/db/src/migrations/internal/NNN+1_managed_origin.test.ts`) — mirror an existing migration test (e.g. `023_marketplace_publishers.test.ts`): assert the three tables have a nullable `managed_origin` column after migrate-to-latest (insert a row without it → succeeds/null; insert with `'central'` → round-trips).

- [ ] **Step 4: Run + typecheck + commit:**
```bash
pnpm --filter @openldr/db exec vitest run src/migrations/internal/NNN+1_managed_origin.test.ts
pnpm --filter @openldr/db exec tsc --noEmit
git add packages/db/src/migrations packages/db/src/schema
git commit -m "feat(db): managed_origin marker on form_definitions/dashboards/reports (sync S2)"
```

---

## Task 4: Instrument the config stores to capture (central authoring)

**Files:** Modify `packages/dashboards/src/store.ts`, `packages/db/src/report-store.ts`, `packages/db/src/app-settings-store.ts`, `packages/forms/src/store.ts`. Create `packages/db/src/reference-capture.ts` (the shared allowlist + a small capture-binding type). Tests alongside each store.

Design: each store's constructor gains an optional `capture?: ReferenceCapture` param. When present, the store's **mutating** methods run their write + `recordReferenceChange` inside one `db.transaction()`. When absent, behavior is unchanged (labs / apply path pass nothing). Capture computes the content hash with `canonicalHash` from `@openldr/core`.

- [ ] **Step 1: Shared capture type + settings allowlist** (`packages/db/src/reference-capture.ts`):
```ts
import type { Transaction, Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';
import type { ReferenceEntityType, ReferenceOp } from './reference-change-log';
import { recordReferenceChange } from './reference-change-log';

export interface ReferenceCapture {
  record(trx: Transaction<InternalSchema>, entityType: ReferenceEntityType, entityId: string, op: ReferenceOp, contentHash: string | null): Promise<void>;
}

/** Default capture binding — a thin wrapper so stores depend on an interface, not the helper directly. */
export const referenceCapture: ReferenceCapture = { record: recordReferenceChange };

/** Center-owned app_settings keys that propagate to labs. Everything else (esp. sync.*) is lab-local
 *  and MUST NOT be captured. Keep this list explicit and small. */
export const CENTER_OWNED_SETTING_KEYS: ReadonlySet<string> = new Set<string>([
  'dashboard.raw_sql', // feature flag(s) — extend as center-owned flags are added
]);
```
(READ the current feature-flag keys used in the settings/feature-flag code — memory references `dashboard.raw_sql` mapping to `DASHBOARD_SQL_ENABLED`; include exactly the real center-owned flag keys, and NOT `sync.*`.)

- [ ] **Step 2: Instrument `report-store.ts`.** Add `capture?: ReferenceCapture` to `createReportStore(db, capture?)`. Rewrite `create`/`update`/`remove` to transactionally capture:
```ts
import { canonicalHash } from '@openldr/core';
import type { ReferenceCapture } from './reference-capture';
// ...
export function createReportStore(db: Kysely<InternalSchema>, capture?: ReferenceCapture): ReportStore {
  const hashOf = (r: ReportRecord) => canonicalHash({ name: r.name, description: r.description, category: r.category, designId: r.designId, primaryQueryId: r.primaryQueryId, summaryMetrics: r.summaryMetrics, chart: r.chart, paramOptions: r.paramOptions, status: r.status });
  const store: ReportStore = {
    async list() { /* unchanged */ },
    async get(id) { /* unchanged */ },
    async create(r) {
      return db.transaction().execute(async (trx) => {
        const inserted = await trx.insertInto('reports').values(toRow(r) as never)
          .onConflict((oc) => oc.column('id').doNothing()).returningAll().executeTakeFirst();
        if (capture) await capture.record(trx, 'report', r.id, 'upsert', hashOf(r));
        return inserted ? fromRow(inserted as Record<string, unknown>) : (await store.get(r.id))!;
      });
    },
    async update(id, r) {
      return db.transaction().execute(async (trx) => {
        await trx.updateTable('reports').set({ ...toRow({ ...r, id }) } as never).where('id', '=', id).execute();
        if (capture) await capture.record(trx, 'report', id, 'upsert', hashOf({ ...r, id }));
        const row = await trx.selectFrom('reports').selectAll().where('id', '=', id).executeTakeFirst();
        return fromRow(row as Record<string, unknown>);
      });
    },
    async remove(id) {
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('reports').where('id', '=', id).execute();
        if (capture) await capture.record(trx, 'report', id, 'delete', null);
      });
    },
  };
  return store;
}
```
(Note: `store.get` inside `create`'s fallback now needs to work outside the trx — keep the fallback reading via `trx` as shown to stay in-transaction.)

- [ ] **Step 3: Instrument `app-settings-store.ts`.** Add `capture?: ReferenceCapture` to `createAppSettingsStore(db, capture?)`. Only capture allowlisted keys:
```ts
import { canonicalHash } from '@openldr/core';
import { CENTER_OWNED_SETTING_KEYS, type ReferenceCapture } from './reference-capture';
// ... in set():
    async set(key, value, updatedBy) {
      await db.transaction().execute(async (trx) => {
        await trx.insertInto('app_settings')
          .values({ key, value, updated_by: updatedBy, updated_at: sql`now()` as never })
          .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_by: updatedBy, updated_at: sql`now()` as never }))
          .execute();
        if (capture && CENTER_OWNED_SETTING_KEYS.has(key)) await capture.record(trx, 'setting', key, 'upsert', canonicalHash(value));
      });
    },
```
(There is no settings-delete in the store today; a center-owned setting is only ever set. If a delete path is later added, capture `'delete'` there. Note this in a comment.)

- [ ] **Step 4: Instrument `packages/dashboards/src/store.ts`.** Add `capture?: ReferenceCapture` (import the interface from `@openldr/db`) to `createDashboardStore(db, capture?)`; wrap `create`/`update`/`remove` in a transaction that captures `'dashboard'` with `canonicalHash({ name, filters, widgets, layout })` (match the seed's `dashboardContentEqual` field set so the hash is stable against jsonb reordering). Delete → `capture.record(trx, 'dashboard', id, 'delete', null)`.

- [ ] **Step 5: Instrument `packages/forms/src/store.ts`.** Add `capture?: ReferenceCapture` to `createFormStore(db, capture?)`. Capture the **consumed** form lifecycle only (labs mirror published forms):
  - `publish()` → after writing, `capture.record(trx, 'form', id, 'upsert', canonicalHash(<the form_definitions row body labs consume: id/status/active/schema/fhir_version/...>))`.
  - `setStatus(id, 'archived')` → `capture.record(trx, 'form', id, 'delete', null)`.
  - `delete(id)` → `capture.record(trx, 'form', id, 'delete', null)`.
  - `create`/`update` on a still-DRAFT form → NO capture (drafts aren't synced; the eventual `publish` captures the final state). If `update` targets an already-published form, capture an `'upsert'`.
  Wrap each in a transaction with the write. Use the exact `form_definitions` body shape the pull endpoint (Task 7) will send so hashes line up — define a single `formSyncBody(row)` helper used by both the store hash and the endpoint fetch.

- [ ] **Step 6: Tests.** For EACH store add a test: with a fake/real `capture` (a `ReferenceCapture` recording calls, or a real pg-mem db asserting `reference_change_log` rows), assert create/update → one `upsert` capture with a stable hash; remove/delete → one `delete` capture; a no-content-change update → the helper dedups (assert via `recordReferenceChange`'s real dedup by calling twice with equal content → one row); settings: an allowlisted key captures, a `sync.*` key does NOT. Run each store's vitest.

- [ ] **Step 7: typecheck all four packages + commit:**
```bash
pnpm --filter @openldr/db --filter @openldr/dashboards --filter @openldr/forms exec tsc --noEmit
git add packages/db/src/reference-capture.ts packages/db/src/report-store.ts packages/db/src/app-settings-store.ts packages/dashboards/src/store.ts packages/forms/src/store.ts packages/*/src/*store*.test.ts
git commit -m "feat(sync): capture reference-data writes into reference_change_log (central authoring) (sync S2)"
```

---

## Task 5: `applyReferenceChange` dispatcher (lab apply, capture-free)

**Files:** Create `packages/db/src/reference-apply.ts` + `packages/db/src/reference-apply.test.ts`.

A capture-free applier that writes the four target tables DIRECTLY (bypassing the capturing stores), stamping `managed_origin='central'`, delete-guarded. Model on `applyRemote`.

- [ ] **Step 1: Types + failing test** (`reference-apply.test.ts`, pg-mem):
```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import { createReferenceApplier } from './reference-apply';

describe('applyReferenceChange', () => {
  it('upserts a dashboard stamped managed_origin=central', async () => {
    const db = await makeMigratedDb();
    const apply = createReferenceApplier(db);
    const body = { id: 'd1', name: 'X', ownerId: null, isDefault: false, refreshIntervalSec: 0, filters: [], widgets: [], layout: [] };
    const r = await apply({ entityType: 'dashboard', entityId: 'd1', op: 'upsert', body });
    expect(r).toBe('applied');
    const row = await db.selectFrom('dashboards').selectAll().where('id', '=', 'd1').executeTakeFirst();
    expect(row?.managed_origin).toBe('central');
  });

  it('delete removes a central-managed row but NOT a lab-local one', async () => {
    const db = await makeMigratedDb();
    const apply = createReferenceApplier(db);
    // central-managed row
    await apply({ entityType: 'dashboard', entityId: 'dc', op: 'upsert', body: { id: 'dc', name: 'C', ownerId: null, isDefault: false, refreshIntervalSec: 0, filters: [], widgets: [], layout: [] } });
    // lab-local row (managed_origin null) inserted directly
    await db.insertInto('dashboards').values({ id: 'dl', /* ...minimal cols..., */ managed_origin: null } as never).execute();
    await apply({ entityType: 'dashboard', entityId: 'dc', op: 'delete' });
    await apply({ entityType: 'dashboard', entityId: 'dl', op: 'delete' }); // must be a no-op (lab-local)
    expect(await db.selectFrom('dashboards').select('id').where('id', '=', 'dc').executeTakeFirst()).toBeUndefined();
    expect(await db.selectFrom('dashboards').select('id').where('id', '=', 'dl').executeTakeFirst()).toBeTruthy();
  });
});
```
(Fill the minimal required NOT NULL columns for a `dashboards` insert from the real schema — READ migration `011_dashboards.ts`.)

- [ ] **Step 2: Implement** (`packages/db/src/reference-apply.ts`):
```ts
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';
import type { ReferenceEntityType, ReferenceOp } from './reference-change-log';

export interface ReferenceRecord {
  entityType: ReferenceEntityType;
  entityId: string;
  op: ReferenceOp;
  contentHash?: string | null;
  body?: unknown; // present for op:'upsert'
}
export type ApplyRefResult = 'applied' | 'skipped';

const MANAGED = 'central';

export function createReferenceApplier(db: Kysely<InternalSchema>) {
  return async function applyReferenceChange(rec: ReferenceRecord): Promise<ApplyRefResult> {
    if (rec.op === 'upsert' && rec.body == null) throw new Error('applyReferenceChange: upsert requires body');
    switch (rec.entityType) {
      case 'dashboard': return upsertOrDelete(db, 'dashboards', rec, dashboardRow);
      case 'report':    return upsertOrDelete(db, 'reports', rec, reportRow);
      case 'form':      return upsertOrDelete(db, 'form_definitions', rec, formRow);
      case 'setting':   return applySetting(db, rec);
      default: throw new Error(`applyReferenceChange: unknown entityType ${(rec as ReferenceRecord).entityType}`);
    }
  };
}

// Each *Row maps a wire body → the table's insert/update column set (jsonb cols JSON.stringify'd), matching
// the store's toRow. WRITE these to mirror each store's serialization exactly (READ each store's toRow).
function dashboardRow(id: string, body: any) { return { id, name: body.name, owner_id: body.ownerId ?? null, is_default: !!body.isDefault, refresh_interval_sec: body.refreshIntervalSec ?? 0, filters: JSON.stringify(body.filters ?? []), widgets: JSON.stringify(body.widgets ?? []), layout: JSON.stringify(body.layout ?? []), managed_origin: MANAGED }; }
function reportRow(id: string, body: any) { return { id, name: body.name, description: body.description ?? '', category: body.category, design_id: body.designId, primary_query_id: body.primaryQueryId, summary_metrics: body.summaryMetrics == null ? null : JSON.stringify(body.summaryMetrics), chart: body.chart == null ? null : JSON.stringify(body.chart), param_options: body.paramOptions == null ? null : JSON.stringify(body.paramOptions), status: body.status, managed_origin: MANAGED }; }
function formRow(id: string, body: any) { /* map to form_definitions columns per its migration; managed_origin: MANAGED */ return { id, /* status, active, schema: JSON.stringify(body.schema), fhir_version, fhir_profile_url, facility_id, updated_at: sql`now()` */ managed_origin: MANAGED } as any; }

async function upsertOrDelete(db: Kysely<InternalSchema>, table: string, rec: ReferenceRecord, toRow: (id: string, body: any) => Record<string, unknown>): Promise<ApplyRefResult> {
  if (rec.op === 'delete') {
    await (db as any).deleteFrom(table).where('id', '=', rec.entityId).where('managed_origin', '=', MANAGED).execute();
    return 'applied';
  }
  const row = toRow(rec.entityId, rec.body);
  const updateSet = { ...row }; delete (updateSet as any).id;
  await (db as any).insertInto(table).values(row)
    .onConflict((oc: any) => oc.column('id').doUpdateSet(updateSet))
    .execute();
  return 'applied';
}

async function applySetting(db: Kysely<InternalSchema>, rec: ReferenceRecord): Promise<ApplyRefResult> {
  if (rec.op === 'delete') {
    await db.deleteFrom('app_settings').where('key', '=', rec.entityId).execute();
    return 'applied';
  }
  await db.insertInto('app_settings')
    .values({ key: rec.entityId, value: String(rec.body), updated_by: MANAGED, updated_at: sql`now()` as never })
    .onConflict((oc) => oc.column('key').doUpdateSet({ value: String(rec.body), updated_by: MANAGED, updated_at: sql`now()` as never }))
    .execute();
  return 'applied';
}
```
(The `(db as any)` on the dynamic-table path is a pragmatic escape hatch for Kysely's table-name generic; if the codebase has a typed pattern for dynamic table writes, use it. Fill `formRow` against the real `form_definitions` columns.)

- [ ] **Step 3: Run tests, typecheck, commit:**
```bash
pnpm --filter @openldr/db exec vitest run src/reference-apply.test.ts
pnpm --filter @openldr/db exec tsc --noEmit
git add packages/db/src/reference-apply.ts packages/db/src/reference-apply.test.ts
git commit -m "feat(db): applyReferenceChange dispatcher (managed_origin, delete-guarded, capture-free) (sync S2)"
```

---

## Task 6: Reference pull wire types + `createSyncPullRunner` (`@openldr/sync`)

**Files:** Modify `packages/sync/src/batch.ts` (add pull types); Create `packages/sync/src/pull-worker.ts` + `packages/sync/src/pull-worker.test.ts`; export from `index.ts`.

- [ ] **Step 1: Wire types** (append to `packages/sync/src/batch.ts`):
```ts
export interface PullRecord {
  seq: number; entityType: 'form' | 'dashboard' | 'report' | 'setting'; entityId: string;
  op: 'upsert' | 'delete'; contentHash?: string | null; body?: unknown; // body present for upsert
}
export interface PullRequest { fromSeq: number }
export interface PullResponse { records: PullRecord[]; nextSeq: number }
```

- [ ] **Step 2: Failing test** (`pull-worker.test.ts`) with fakes for every dep: builds nothing (records come from central), advances cursor to `nextSeq` on success; does NOT advance on `postPull` throw; a per-record apply error is logged and the cursor STILL advances to nextSeq (quarantine); a `getToken` throw is caught (returns 0, no advance). Model on `push-worker.test.ts`.

- [ ] **Step 3: Implement** (`packages/sync/src/pull-worker.ts`):
```ts
import type { Logger } from '@openldr/db';
import type { PullRequest, PullResponse, PullRecord } from './batch';

export interface PullDeps {
  postPull: (req: PullRequest, token: string) => Promise<PullResponse>;
  getToken: () => Promise<string>;
  applyRecord: (rec: PullRecord) => Promise<'applied' | 'skipped'>;
  readCursor: () => Promise<number>;      // change_cursors consumer 'sync-pull'
  advanceCursor: (seq: number) => Promise<void>;
  logger: Logger;
}
export interface SyncPullRunner { runCycle(): Promise<number> }

export function createSyncPullRunner(deps: PullDeps): SyncPullRunner {
  return {
    async runCycle(): Promise<number> {
      const cursor = await deps.readCursor();
      let resp: PullResponse;
      try {
        const token = await deps.getToken();
        resp = await deps.postPull({ fromSeq: cursor }, token);
      } catch (err) {
        deps.logger.warn({ err: (err as Error).message }, 'sync pull failed; cursor not advanced (will retry)');
        return 0;
      }
      if (resp.records.length === 0) return 0;
      let applied = 0;
      for (const rec of resp.records) {
        try { await deps.applyRecord(rec); applied++; }
        catch (err) { deps.logger.warn({ err: (err as Error).message, entityType: rec.entityType, entityId: rec.entityId, seq: rec.seq }, 'sync pull: apply failed; skipping (quarantine)'); }
      }
      if (resp.nextSeq > cursor) await deps.advanceCursor(resp.nextSeq);
      return applied;
    },
  };
}
```
Export `createSyncPullRunner`, `PullDeps`, `SyncPullRunner`, and the three wire types from `packages/sync/src/index.ts`.

- [ ] **Step 4: Run tests, typecheck, commit:**
```bash
pnpm --filter @openldr/sync exec vitest run src/pull-worker.test.ts
pnpm --filter @openldr/sync exec tsc --noEmit
git add packages/sync/src/batch.ts packages/sync/src/pull-worker.ts packages/sync/src/pull-worker.test.ts packages/sync/src/index.ts
git commit -m "feat(sync): reference pull wire types + createSyncPullRunner (quarantine, cursor) (sync S2)"
```

---

## Task 7: `POST /api/sync/pull` endpoint (`apps/server`)

**Files:** Modify `apps/server/src/sync-routes.ts` (add the pull route to `registerSyncRoutes`); Test `apps/server/src/sync-routes.test.ts` (add cases). No auth-plugin change (the `/api/sync/` bypass already covers `/api/sync/pull`).

- [ ] **Step 1: Add the handler** in `registerSyncRoutes(app, ctx)`, reusing `sitePrincipal`:
```ts
// POST /api/sync/pull — global reference-data delta since the lab's cursor. Auth-only (not site-scoped).
app.post('/api/sync/pull', async (req, reply) => {
  const principal = await sitePrincipal(req, reply, ctx);
  if (!principal) return; // 401/403 already sent
  const fromSeq = Number.isFinite((req.body as any)?.fromSeq) ? (req.body as any).fromSeq : 0;
  const BATCH = 500;
  // Read the raw log window, then DEDUP to the latest row per (entity_type, entity_id) so a create-then-
  // delete in the window collapses to the delete (avoids a null-body upsert). nextSeq = max seq in window.
  const rows = await ctx.internalDb.selectFrom('reference_change_log').selectAll()
    .where('seq', '>', fromSeq).orderBy('seq').limit(BATCH).execute();
  const nextSeq = rows.reduce((m, r) => Math.max(m, Number(r.seq)), fromSeq);
  const latestByEntity = new Map<string, typeof rows[number]>();
  for (const r of rows) latestByEntity.set(`${r.entity_type}:${r.entity_id}`, r); // later seq overwrites
  const records = [];
  for (const r of latestByEntity.values()) {
    const entityType = r.entity_type as PullRecord['entityType'];
    if (r.op === 'delete') { records.push({ seq: Number(r.seq), entityType, entityId: r.entity_id, op: 'delete' as const }); continue; }
    const body = await fetchReferenceBody(ctx, entityType, r.entity_id); // live current body
    if (body == null) { records.push({ seq: Number(r.seq), entityType, entityId: r.entity_id, op: 'delete' as const }); continue; } // deleted since
    records.push({ seq: Number(r.seq), entityType, entityId: r.entity_id, op: 'upsert' as const, contentHash: r.content_hash, body });
  }
  records.sort((a, b) => a.seq - b.seq);
  reply.send({ records, nextSeq } satisfies PullResponse);
});
```
`fetchReferenceBody(ctx, entityType, id)` uses the read-only store `get`s on `ctx` (no capture): `dashboard` → `ctx.dashboardStore.get(id)`; `report` → `ctx.reportStore.get(id)`; `form` → `formSyncBody(await ctx.formStore.get(id))` (the SAME shape Task 4's forms capture hashed); `setting` → `(await ctx.appSettings.get(id))?.value`. CONFIRM these stores are on `AppContext`; thread any that aren't. Import `PullRecord`/`PullResponse` from `@openldr/sync` and `ctx.internalDb` is the internal Kysely handle.

- [ ] **Step 2: Tests** (`app.inject`, fake `ctx.auth.verifyToken` + a fake/real `ctx.internalDb` seeded with `reference_change_log` rows + fake stores): no token → 401; no `site_id` → 403; a window with upsert rows → `records` carry live bodies + correct `nextSeq`; a create-then-delete in the window → collapses to one `delete`; an upsert whose entity was since deleted (store.get → null) → downgraded to `delete`; empty window → `{records:[], nextSeq: fromSeq}`.

- [ ] **Step 3: typecheck + test + commit:**
```bash
pnpm --filter @openldr/server exec tsc --noEmit
pnpm --filter @openldr/server exec vitest run src/sync-routes.test.ts
git add apps/server/src/sync-routes.ts apps/server/src/sync-routes.test.ts
git commit -m "feat(server): POST /api/sync/pull reference-data delta endpoint (sync S2)"
```

---

## Task 8: `createSyncPullWorker` host loop + bootstrap wiring

**Files:** Create `packages/bootstrap/src/sync-pull-worker.ts` + test; Modify `packages/bootstrap/src/index.ts`.

- [ ] **Step 1:** `createSyncPullWorker({ runner, intervalMs, logger })` — a byte-for-byte structural sibling of `packages/bootstrap/src/sync-push-worker.ts` (fixed interval, `running` no-overlap guard in `finally`, keep-looping-on-error, `start()/stop()/trigger()`). Copy that file, rename symbols, s/push/pull/. Add its test mirroring `sync-push-worker.test.ts` (interval tick, no-overlap, keep-looping-after-rejection, stop halts).

- [ ] **Step 2: Wire in `index.ts`** — inside the existing `if (syncCfg) { ... }` block that starts the push worker, ALSO build the pull deps and start the pull worker:
```ts
const referenceApplier = createReferenceApplier(internal.db); // from @openldr/db
const pullDeps = {
  getToken: () => tokenProvider.getToken(),        // SHARE the push token provider
  applyRecord: (rec) => referenceApplier(rec),
  postPull: async (body, token) => {
    const res = await fetch(`${syncCfg.centralUrl}/api/sync/pull`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`central responded ${res.status}`); // status only, no token
    return res.json() as Promise<import('@openldr/sync').PullResponse>;
  },
  readCursor: () => readChangeCursor(internal.db, 'sync-pull'),
  advanceCursor: (seq) => advanceChangeCursor(internal.db, 'sync-pull', seq),
  logger,
};
const syncPullRunner = createSyncPullRunner(pullDeps);
syncPullWorker = createSyncPullWorker({ runner: syncPullRunner, intervalMs: 5000, logger });
syncPullWorker.start();
```
Register `syncPullWorker?.stop()` in the shutdown `close()` alongside `syncPushWorker?.stop()`. `readChangeCursor`/`advanceChangeCursor` are the `readCursor`/`advanceCursor` from `@openldr/db` (projection cursor.ts), consumer `'sync-pull'`.

- [ ] **Step 3: typecheck + bootstrap test suite + commit:**
```bash
pnpm --filter @openldr/bootstrap exec tsc --noEmit
pnpm --filter @openldr/bootstrap exec vitest run
git add packages/bootstrap/src/sync-pull-worker.ts packages/bootstrap/src/sync-pull-worker.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): sync pull worker host loop, config-gated (sync S2)"
```

---

## Task 9: Two-Postgres pull acceptance (`pnpm sync:pull:accept`)

**Files:** Create `scripts/sync-pull-live-acceptance.ts`; add `"sync:pull:accept": "tsx scripts/sync-pull-live-acceptance.ts"` to root `package.json` next to `"sync:accept"`.

- [ ] **Step 1:** Model on `scripts/sync-live-acceptance.ts`. Provision two internal PG DBs on :5433 (`openldr_s2_central`, `openldr_s2_lab`), migrate both to latest. Build **capturing** stores on central (`createReportStore(db, referenceCapture)`, `createDashboardStore(db, referenceCapture)`, `createAppSettingsStore(db, referenceCapture)`, `createFormStore(db, referenceCapture)`) and a `createReferenceApplier(labDb)` on the lab. In-process `postPull` runs the endpoint's read+dedup+live-body logic against the central DB + stores (auth/HTTP unit-proven in Task 7 — flag this shortcut in a comment). Steps + assertions:
  1. Central authors: a published form, a dashboard, a report, and `appSettings.set('dashboard.raw_sql','true', 'admin')` → assert 4 `reference_change_log` rows on central.
  2. Lab pre-seeds one **lab-local** dashboard (`managed_origin` NULL) inserted directly.
  3. Drain pull (loop `runCycle` until 0) → assert lab has all 4 central entities, each `managed_origin='central'`; the lab-local dashboard is untouched (still present, `managed_origin` NULL).
  4. Central **edits** the dashboard (`store.update`) → new log row (content_hash changed); drain → lab dashboard updated.
  5. Central **deletes** the report (`store.remove`) → drain → central-managed report gone from lab; assert a same-id lab-local row would survive (insert a lab-local `reports` row with the SAME id after the managed one is gone, re-run a delete record → still present).
  6. Central **re-seeds unchanged** (author the same dashboard body again) → assert NO new `reference_change_log` row (capture dedup).
  7. Second drain with no new central changes → 0 applied, `'sync-pull'` cursor unchanged.
  Print `✅ sync:pull:accept PASSED` + `process.exit(0)`; fail loud + `exit(1)` otherwise. Cleanup DBs in `finally` per the S1 script's convention.

- [ ] **Step 2: Run it green, then commit:**
```bash
docker compose up -d postgres
pnpm sync:pull:accept   # must print PASSED, exit 0 — paste output in the task report
git add scripts/sync-pull-live-acceptance.ts package.json
git commit -m "test(sync): two-PG pull round-trip acceptance (sync S2)"
```

---

## Task 10: Whole-slice review, gate, merge & push

- [ ] **Gate:** `pnpm turbo run typecheck test --force --filter=@openldr/core --filter=@openldr/db --filter=@openldr/dashboards --filter=@openldr/forms --filter=@openldr/sync --filter=@openldr/server --filter=@openldr/bootstrap` — PASS, no NEW failures (verify known-flaky pkgs in isolation; never pipe turbo through `tail`). Re-run `pnpm sync:accept` (S1 must still pass — the store instrumentation touched shared stores) AND `pnpm sync:pull:accept`.
- [ ] **Whole-slice review:** capture is content-hash deduped + atomic with the store write; capture fires ONLY on authoring, never on the apply path; `applyReferenceChange` stamps `managed_origin` + delete-guards lab-local rows; the settings allowlist excludes `sync.*`; the pull endpoint dedups-to-latest + downgrades deleted-since upserts; the pull worker advances only on success + quarantines apply errors; config-gated worker is a no-op when disabled; no token/secret leak; `canonicalHash` is shared (S1 push + dashboards seed still green). No `Co-Authored-By`.
- [ ] **Merge:**
```bash
git checkout main
git merge --no-ff feat/sync-s2-pull -m "Merge branch 'feat/sync-s2-pull': distributed sync S2 — directional pull central->lab (reference config down)"
```
- [ ] **Push:** ask the user before `git push origin main` (pushes are discretionary per project convention).
- [ ] **Update memory:** `distributed-sync-central-workstream.md` + `sync-s1-starting-point.md` — S2 (pull reference config) DONE; the `reference_change_log`/`managed_origin`/`canonicalHash`-shared substrate; new `origin/main` SHA (if pushed); next = S3 terminology pull (rides the same log, bulk transfer) / S4 UI+enrollment+config-surface reconciliation.

---

## Self-review notes

- **Spec coverage:** capture substrate (§Design.1)→T2; content-hash primitive→T1; managed_origin (§Design.3)→T3; store instrumentation + settings allowlist (§Design.1)→T4; applyReferenceChange (§Design.3)→T5; pull wire+runner (§Design.4)→T6; endpoint (§Design.2)→T7; worker+wiring (§Design.4-5)→T8; two-PG proof (§Testing)→T9; gate/merge→T10. All covered.
- **Ordering safety:** shared hash before capture; log table before capture helper; managed_origin before applier; capture before the endpoint reads the log; applier + wire before the worker; everything before the acceptance proof.
- **Deliberate shortcuts:** in-process `postPull` in T9 (auth/HTTP unit-proven in T7); no gzip/LISTEN (S7); no `form_versions` history replication; terminology + operator UI/enrollment + config-surface reconciliation = S3/S4.
- **Type consistency:** `ReferenceRecord`/`ReferenceOp`/`ReferenceEntityType` (`@openldr/db`) ↔ `PullRecord` (`@openldr/sync`, +seq) ↔ the endpoint's emitted records ↔ `applyReferenceChange` input — the applier consumes `{entityType, entityId, op, body?}`, `PullRecord` is that plus `seq`/`contentHash`; the worker maps `PullRecord`→apply by passing it straight through (extra fields harmless). `canonicalHash` is the single hash function across capture + (optional) skip. `readChangeCursor`/`advanceChangeCursor` = the projection `readCursor`/`advanceCursor` with consumer `'sync-pull'`.
- **Watch-outs for the implementer:** (1) the store instrumentation converts single-statement writes to transactions — keep the non-capture path behavior identical (stores constructed without `capture` must behave exactly as before; assert an existing store test still passes). (2) `formSyncBody` must be ONE shared helper used by both the forms capture hash (T4) and the endpoint body fetch (T7) or hashes/bodies drift. (3) bootstrap now constructs the config stores WITH `referenceCapture` on every instance (authoring captures; apply is capture-free by construction) — confirm the stores wired into API routes are the capturing instances so operator authoring is captured. (4) dynamic-table writes in `reference-apply.ts` may need `as any` around Kysely's table generic; prefer a typed per-entity function if the repo has one.
```
