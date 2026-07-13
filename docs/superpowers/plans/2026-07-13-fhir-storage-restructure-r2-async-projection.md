# FHIR Storage Restructure — R2: Async Projection Worker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move analytics projection off the synchronous persist path onto a dedicated cursor-driven worker that consumes `fhir.change_log` (with an xmin-snapshot safe frontier) and projects into the external read-model; add a `reprojectAll()` rebuild path.

**Architecture:** Slice **R2** of the restructure (spec: `docs/superpowers/specs/2026-07-13-fhir-storage-restructure-r2-async-projection-design.md`). The projection **cycle** (fetch safe rows → plan → apply → advance cursor) lives in `@openldr/db` with an **injectable** row-fetch so most of it is unit-testable on pg-mem; only the real MVCC fetch is Postgres-specific and covered by a real-Postgres acceptance test. `persist()` drops its inline flat-writer (`flattened` becomes `'deferred'`); the worker becomes the sole projection path.

**Tech Stack:** TypeScript, Kysely (Postgres + external engines), pg-mem (unit), real Postgres on `:5433` (acceptance), Vitest.

**Established facts (verified by spike — do NOT re-derive):**
- **pg-mem cannot run** `xmin` (system column), `pg_current_snapshot()`, `pg_snapshot_xmin()`, `pg_current_xact_id()`, or `txid_current()` — all error. So the watermark fetch is real-Postgres-only; the rest of the cycle must be injectable to stay unit-testable.
- **Real-Postgres watermark SQL is verified:** `select pg_snapshot_xmin(pg_current_snapshot())::text::bigint as boundary` and `select seq, xmin::text::bigint as xid, … from fhir.change_log where seq > $cursor order by seq limit $n` work; committed rows classify `xid < boundary` = safe. Dev PG creds: `postgres://openldr:openldr@localhost:5433/openldr` (internal), `…/openldr_target` (external).
- Read-model = today's thin flat schema (`schema/external.ts`); projection via `flattenResource` (`flatten/index.ts`, a `resourceType→table` switch). `flatWriter` (`flat-writer.ts`) only writes today — R2 adds a delete path.
- `persist.ts` inline projection = the `flatWriter.writeMany(items)` block in `persistResources` (lines 63-71) and `flatWriter.write` in `persistResource` (lines 35-42). `PersistResult.flattened` is consumed by `persist-store-service.ts`.
- `change_log` (bigserial `seq`) + `change_cursors(consumer text pk, last_seq bigint, updated_at)` exist from R1. `FhirStore` has `get`/`save`/`delete`; `SavedRef` has `version`.
- Worker patterns to mirror: event-bus `startWorker` (interval + LISTEN/NOTIFY, `adapter-event-bus/src/index.ts`) and boot-managed lifecycle (`workflow-listeners.ts`, started in `bootstrap/src/index.ts`).
- bigint reads back as string on real pg / number on pg-mem → coerce with `Number(...)`.

---

## File Structure

**Create:**
- `packages/db/src/projection/plan.ts` — pure `planProjection` + shared types.
- `packages/db/src/projection/plan.test.ts`
- `packages/db/src/projection/cursor.ts` — `readCursor`/`advanceCursor`.
- `packages/db/src/projection/fetch.ts` — `fetchSafeChangeRows` (real-PG MVCC query).
- `packages/db/src/projection/cycle.ts` — `applyProjection`, `runProjectionCycle`, `reprojectAll`.
- `packages/db/src/projection/cycle.test.ts` — cycle + reproject unit tests (fake fetch, pg-mem).
- `packages/db/src/projection/index.ts` — barrel.
- `packages/bootstrap/src/projection-worker.ts` — `createProjectionWorker` lifecycle.
- `packages/bootstrap/src/projection-worker.test.ts`
- `scripts/projection-live-acceptance.ts` — real-Postgres end-to-end acceptance.

**Modify:**
- `packages/db/src/flatten/index.ts` — add `tableForResourceType`.
- `packages/db/src/flat-writer.ts` — add `deleteById` to `FlatWriter`.
- `packages/db/src/persist.ts` — remove inline projection; `flattened: 'deferred'`; drop `flatWriter` from `PersistDeps`.
- `packages/db/src/persist.test.ts`, `packages/db/src/persist-changelog.test.ts` — adapt to the new persist shape.
- `packages/db/src/fhir-store.ts` — best-effort `pg_notify('fhir_changes')` after save commit.
- `packages/db/src/index.ts` — export the projection barrel.
- `packages/bootstrap/src/db-context.ts` — construct worker deps (keep `flatWriter` for the worker, drop from persist).
- `packages/bootstrap/src/persist-store-service.ts` — handle `'deferred'`.
- `packages/bootstrap/src/index.ts` — start/stop the worker.
- `package.json` (root) — `projection:accept` script.

---

## Task 1: Pure `planProjection` + cursor helpers

**Files:** Create `packages/db/src/projection/plan.ts`, `packages/db/src/projection/cursor.ts`, `packages/db/src/projection/plan.test.ts`.

- [ ] **Step 1: Write the failing test** — `packages/db/src/projection/plan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { planProjection, type ChangeRow } from './plan';

const row = (seq: number, xid: number, id: string, op = 'upsert'): ChangeRow => ({ seq, xid, resource_type: 'Patient', resource_id: id, op });

describe('planProjection', () => {
  it('all rows safe (xid < boundary): projects distinct keys, advances to max seq', () => {
    const rows = [row(1, 10, 'p1'), row(2, 10, 'p2'), row(3, 11, 'p1')];
    const plan = planProjection(rows, 20, 0);
    expect(plan.newCursor).toBe(3);
    expect(plan.tasks.map((t) => t.id).sort()).toEqual(['p1', 'p2']); // p1 deduped
  });

  it('caps cursor at firstUnsafe-1 and skips unsafe rows (no permanent skip)', () => {
    // seq 2 is still in-flight (xid >= boundary); seq 3 committed but must wait behind seq 2.
    const rows = [row(1, 10, 'p1'), row(2, 25, 'p2'), row(3, 11, 'p3')];
    const plan = planProjection(rows, 20, 0);
    expect(plan.newCursor).toBe(1); // firstUnsafe=2 → cursor=1
    expect(plan.tasks.map((t) => t.id)).toEqual(['p1']);
  });

  it('no rows: cursor unchanged', () => {
    expect(planProjection([], 20, 5)).toEqual({ tasks: [], newCursor: 5 });
  });

  it('first row unsafe: nothing processed, cursor unchanged', () => {
    const plan = planProjection([row(6, 30, 'p1')], 20, 5);
    expect(plan).toEqual({ tasks: [], newCursor: 5 });
  });

  it('tolerates rollback gaps (missing seq) among safe rows', () => {
    const rows = [row(1, 10, 'p1'), row(3, 10, 'p2')]; // seq 2 rolled back (never present)
    const plan = planProjection(rows, 20, 0);
    expect(plan.newCursor).toBe(3);
    expect(plan.tasks.map((t) => t.id).sort()).toEqual(['p1', 'p2']);
  });
});
```

- [ ] **Step 2: Run — fails** (`plan.ts` missing): `pnpm --filter @openldr/db exec vitest run src/projection/plan.test.ts` → FAIL.

- [ ] **Step 3: Implement `plan.ts`:**

```ts
// Pure projection planning — no DB. Given change_log rows fetched with seq > cursor (ascending)
// plus the current xmin boundary, decide which resources to (re)project and how far the cursor
// may safely advance. A row is "safe" (committed and final, no older txn still able to insert a
// lower seq) iff its inserting xid < boundary. The cursor stops just before the first still
// in-flight seq so an out-of-order lower-seq commit is deferred one cycle, never skipped.

export interface ChangeRow {
  seq: number;
  xid: number; // inserting transaction id (system xmin)
  resource_type: string;
  resource_id: string;
  op: string; // 'upsert' | 'delete' (a hint; projection reads current canonical state)
}

export interface ProjectionTask {
  resourceType: string;
  id: string;
}

export interface ProjectionPlan {
  tasks: ProjectionTask[];
  newCursor: number;
}

export function planProjection(rows: ChangeRow[], boundary: number, cursor: number): ProjectionPlan {
  let firstUnsafe = Infinity;
  for (const r of rows) {
    if (r.xid >= boundary && r.seq < firstUnsafe) firstUnsafe = r.seq;
  }
  const safe = rows.filter((r) => r.seq < firstUnsafe);
  // Dedupe by (resource_type, resource_id) — we project current canonical state, so one task per key.
  const byKey = new Map<string, ProjectionTask>();
  for (const r of safe) byKey.set(`${r.resource_type} ${r.resource_id}`, { resourceType: r.resource_type, id: r.resource_id });
  const tasks = [...byKey.values()];
  let newCursor = cursor;
  if (firstUnsafe !== Infinity) newCursor = firstUnsafe - 1;
  else if (rows.length > 0) newCursor = rows[rows.length - 1].seq;
  return { tasks, newCursor };
}
```

- [ ] **Step 4: Implement `cursor.ts`:**

```ts
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from '../schema/internal';

export async function readCursor(db: Kysely<InternalSchema>, consumer: string): Promise<number> {
  const row = await db.selectFrom('fhir.change_cursors').select('last_seq').where('consumer', '=', consumer).executeTakeFirst();
  return row ? Number(row.last_seq) : 0;
}

export async function advanceCursor(db: Kysely<InternalSchema>, consumer: string, seq: number): Promise<void> {
  await db
    .insertInto('fhir.change_cursors')
    .values({ consumer, last_seq: seq })
    .onConflict((oc) => oc.column('consumer').doUpdateSet({ last_seq: seq, updated_at: sql`now()` }))
    .execute();
}
```

- [ ] **Step 5: Run + typecheck.** `pnpm --filter @openldr/db exec vitest run src/projection/plan.test.ts` → PASS (5 tests). `pnpm --filter @openldr/db exec tsc --noEmit` → PASS.

- [ ] **Step 6: Commit.**
```bash
git add packages/db/src/projection/plan.ts packages/db/src/projection/plan.test.ts packages/db/src/projection/cursor.ts
git commit -m "feat(db): pure projection planner (xmin safe-frontier) + change cursor helpers (restructure R2)"
```

---

## Task 2: Flat projection delete path

**Files:** Modify `packages/db/src/flatten/index.ts`, `packages/db/src/flat-writer.ts`; Test `packages/db/src/flat-writer.test.ts` (append).

- [ ] **Step 1: Write the failing test** — append to `packages/db/src/flat-writer.test.ts` (read the file first for its existing `makeExternalDb`/setup helpers and reuse them; if it builds a pg-mem external DB with the flat tables, follow that pattern). Add:

```ts
import { tableForResourceType } from './flatten/index';

describe('flat delete path', () => {
  it('tableForResourceType maps known types and returns null for others', () => {
    expect(tableForResourceType('Patient')).toBe('patients');
    expect(tableForResourceType('Observation')).toBe('observations');
    expect(tableForResourceType('Bundle')).toBeNull();
  });

  it('deleteById removes the flat row; no-op for non-projected type', async () => {
    const db = await makeExternalDb(); // reuse the file's existing helper that creates the flat tables
    const writer = createFlatWriter(db as never, 'postgres');
    await writer.write({ resourceType: 'Patient', id: 'p1' });
    expect(await db.selectFrom('patients').selectAll().execute()).toHaveLength(1);
    await writer.deleteById('Patient', 'p1');
    expect(await db.selectFrom('patients').selectAll().execute()).toHaveLength(0);
    await writer.deleteById('Bundle', 'whatever'); // non-projected → no throw
    await db.destroy();
  });
});
```
(If `flat-writer.test.ts` has no `makeExternalDb` helper, create the pg-mem external DB inline the same way the existing tests in that file do — read it first and match its setup exactly.)

- [ ] **Step 2: Run — fails.** `pnpm --filter @openldr/db exec vitest run src/flat-writer.test.ts` → FAIL (`tableForResourceType`/`deleteById` missing).

- [ ] **Step 3: Add `tableForResourceType` to `flatten/index.ts`** (mirrors the existing `flattenResource` switch; add after it):

```ts
export function tableForResourceType(resourceType: string): keyof ExternalSchema | null {
  switch (resourceType) {
    case 'Patient': return 'patients';
    case 'Specimen': return 'specimens';
    case 'ServiceRequest': return 'service_requests';
    case 'DiagnosticReport': return 'diagnostic_reports';
    case 'Observation': return 'observations';
    case 'Organization': return 'organizations';
    case 'Location': return 'locations';
    default: return null;
  }
}
```

- [ ] **Step 4: Add `deleteById` to the `FlatWriter` interface and implementation in `flat-writer.ts`.** Import `tableForResourceType` (from `./flatten/index`). Add to the interface:

```ts
  deleteById(resourceType: string, id: string): Promise<void>;
```

Add to the returned object in `createFlatWriter` (works across engines — Kysely `deleteFrom`):

```ts
    async deleteById(resourceType, id) {
      const table = tableForResourceType(resourceType);
      if (!table) return; // non-projected type — nothing to delete
      await anyDb.deleteFrom(table).where('id', '=', id).execute();
    },
```

- [ ] **Step 5: Run + typecheck.** `pnpm --filter @openldr/db exec vitest run src/flat-writer.test.ts` → PASS. `pnpm --filter @openldr/db exec tsc --noEmit` → PASS.

- [ ] **Step 6: Commit.**
```bash
git add packages/db/src/flatten/index.ts packages/db/src/flat-writer.ts packages/db/src/flat-writer.test.ts
git commit -m "feat(db): flat projection delete path (deleteById + tableForResourceType) (restructure R2)"
```

---

## Task 3: Projection cycle (fetch + apply + advance)

**Files:** Create `packages/db/src/projection/fetch.ts`, `packages/db/src/projection/cycle.ts`, `packages/db/src/projection/index.ts`, `packages/db/src/projection/cycle.test.ts`.

- [ ] **Step 1: Write the failing test** — `packages/db/src/projection/cycle.test.ts` (unit-tests the cycle with a FAKE fetch so it runs on pg-mem; the real MVCC fetch is acceptance-tested in Task 7):

```ts
import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from '../migrations/internal/test-helpers';
import { createFhirStore } from '../fhir-store';
import { createFlatWriter } from '../flat-writer';
import { runProjectionCycle, type FetchSafeRows } from './cycle';
import { readCursor } from './cursor';
import { makeExternalDb } from '../flat-writer.test-helpers'; // if none exists, build the external pg-mem DB inline (see note)

const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;

describe('runProjectionCycle', () => {
  it('projects safe rows to the external store and advances the cursor', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeExternalDb();
    const fhirStore = createFhirStore(internalDb as never);
    const flatWriter = createFlatWriter(externalDb as never, 'postgres');
    await fhirStore.save({ resourceType: 'Patient', id: 'p1', name: [{ family: 'A' }] } as never);

    // fake fetch: return the change_log rows as "all safe" (xid < boundary)
    const fetch: FetchSafeRows = async () => ({
      rows: [{ seq: 1, xid: 1, resource_type: 'Patient', resource_id: 'p1', op: 'upsert' }],
      boundary: 100,
    });

    const n = await runProjectionCycle({ internalDb: internalDb as never, fhirStore, flatWriter, logger, fetch, batchSize: 500 });
    expect(n).toBe(1);
    expect(await externalDb.selectFrom('patients').selectAll().execute()).toHaveLength(1);
    expect(await readCursor(internalDb as never, 'projection')).toBe(1);
    await internalDb.destroy();
    await externalDb.destroy();
  });

  it('deletes the flat row when the canonical resource is gone (tombstone)', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeExternalDb();
    const fhirStore = createFhirStore(internalDb as never);
    const flatWriter = createFlatWriter(externalDb as never, 'postgres');
    await fhirStore.save({ resourceType: 'Patient', id: 'p1' } as never);
    await flatWriter.write({ resourceType: 'Patient', id: 'p1' }); // seed read-model
    await fhirStore.delete('Patient', 'p1');

    const fetch: FetchSafeRows = async () => ({
      rows: [{ seq: 2, xid: 1, resource_type: 'Patient', resource_id: 'p1', op: 'delete' }],
      boundary: 100,
    });
    await runProjectionCycle({ internalDb: internalDb as never, fhirStore, flatWriter, logger, fetch, batchSize: 500 });
    expect(await externalDb.selectFrom('patients').selectAll().execute()).toHaveLength(0);
    await internalDb.destroy();
    await externalDb.destroy();
  });
});
```

> **Note for the implementer:** `flat-writer.test.ts` already builds a pg-mem external DB with the flat tables. Extract that setup into a tiny shared helper `packages/db/src/flat-writer.test-helpers.ts` exporting `makeExternalDb()` and import it from both `flat-writer.test.ts` and `cycle.test.ts` (DRY), OR inline the identical setup in `cycle.test.ts`. Do whichever keeps it simplest; do not change production code to accommodate tests.

- [ ] **Step 2: Run — fails.** `pnpm --filter @openldr/db exec vitest run src/projection/cycle.test.ts` → FAIL.

- [ ] **Step 3: Implement `fetch.ts`** (real-Postgres MVCC query — not exercised by pg-mem unit tests; the acceptance test covers it):

```ts
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from '../schema/internal';
import type { ChangeRow } from './plan';

export interface SafeFetchResult {
  rows: ChangeRow[];
  boundary: number;
}

// Real-Postgres only: uses the system `xmin` column and snapshot functions (pg-mem cannot run these).
export async function fetchSafeChangeRows(db: Kysely<InternalSchema>, cursor: number, limit: number): Promise<SafeFetchResult> {
  const b = await sql<{ boundary: string }>`select pg_snapshot_xmin(pg_current_snapshot())::text::bigint as boundary`.execute(db);
  const boundary = Number(b.rows[0]?.boundary ?? 0);
  const r = await sql<{ seq: string; xid: string; resource_type: string; resource_id: string; op: string }>`
    select seq, xmin::text::bigint as xid, resource_type, resource_id, op
    from fhir.change_log
    where seq > ${cursor}
    order by seq asc
    limit ${limit}
  `.execute(db);
  const rows: ChangeRow[] = r.rows.map((x) => ({
    seq: Number(x.seq),
    xid: Number(x.xid),
    resource_type: x.resource_type,
    resource_id: x.resource_id,
    op: x.op,
  }));
  return { rows, boundary };
}
```

- [ ] **Step 4: Implement `cycle.ts`:**

```ts
import type { Kysely } from 'kysely';
import type { InternalSchema } from '../schema/internal';
import type { FhirStore } from '../fhir-store';
import type { FlatWriter } from '../flat-writer';
import { planProjection, type ProjectionTask } from './plan';
import { readCursor, advanceCursor } from './cursor';
import type { SafeFetchResult } from './fetch';

export type FetchSafeRows = (db: Kysely<InternalSchema>, cursor: number, limit: number) => Promise<SafeFetchResult>;

export interface Logger { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void; warn(o: unknown, m?: string): void; debug(o: unknown, m?: string): void; }

export interface ProjectionDeps {
  internalDb: Kysely<InternalSchema>;
  fhirStore: FhirStore;
  flatWriter: FlatWriter;
  logger: Logger;
  fetch: FetchSafeRows;      // injected — real fetchSafeChangeRows in prod, a fake in unit tests
  batchSize?: number;
}

async function applyProjection(task: ProjectionTask, deps: ProjectionDeps): Promise<void> {
  const canonical = await deps.fhirStore.get(task.resourceType, task.id);
  if (canonical) await deps.flatWriter.write(canonical);
  else await deps.flatWriter.deleteById(task.resourceType, task.id);
}

/** One projection cycle: fetch safe rows, plan, apply each (current-state, idempotent), advance cursor.
 *  Returns the number of resources projected. A failing apply is logged and skipped (reprojectAll heals). */
export async function runProjectionCycle(deps: ProjectionDeps): Promise<number> {
  const cursor = await readCursor(deps.internalDb, 'projection');
  const { rows, boundary } = await deps.fetch(deps.internalDb, cursor, deps.batchSize ?? 500);
  const { tasks, newCursor } = planProjection(rows, boundary, cursor);
  for (const task of tasks) {
    try {
      await applyProjection(task, deps);
    } catch (err) {
      deps.logger.error({ err, task }, 'projection apply failed; skipping (reprojectAll can heal)');
    }
  }
  if (newCursor > cursor) await advanceCursor(deps.internalDb, 'projection', newCursor);
  return tasks.length;
}

/** Rebuild the read-model from the canonical store, then set the cursor to the current max seq. */
export async function reprojectAll(deps: Pick<ProjectionDeps, 'internalDb' | 'flatWriter'>): Promise<number> {
  const maxRow = await deps.internalDb
    .selectFrom('fhir.change_log')
    .select((eb) => eb.fn.max('seq').as('m'))
    .executeTakeFirst();
  const maxSeq = maxRow?.m != null ? Number(maxRow.m) : 0;

  let projected = 0;
  const page = 1000;
  let offset = 0;
  for (;;) {
    const rows = await deps.internalDb.selectFrom('fhir.fhir_resources').select('resource').orderBy('resource_type').orderBy('id').limit(page).offset(offset).execute();
    if (rows.length === 0) break;
    await deps.flatWriter.writeMany(rows.map((r) => ({ resource: r.resource })));
    projected += rows.length;
    offset += rows.length;
    if (rows.length < page) break;
  }
  await advanceCursor(deps.internalDb, 'projection', maxSeq);
  return projected;
}
```

- [ ] **Step 5: Implement `index.ts` barrel:**

```ts
export * from './plan';
export * from './cursor';
export * from './fetch';
export * from './cycle';
```

Add to `packages/db/src/index.ts`: `export * from './projection';`

- [ ] **Step 6: Run + typecheck.** `pnpm --filter @openldr/db exec vitest run src/projection/cycle.test.ts` → PASS. `pnpm --filter @openldr/db exec tsc --noEmit` → PASS. Also run `pnpm --filter @openldr/db exec vitest run` → all green.

- [ ] **Step 7: Commit.**
```bash
git add packages/db/src/projection/ packages/db/src/index.ts packages/db/src/flat-writer.test-helpers.ts
git commit -m "feat(db): projection cycle + reprojectAll (real-PG safe-row fetch, injectable) (restructure R2)"
```

---

## Task 4: `reprojectAll` unit test

(The `reprojectAll` implementation landed in Task 3; this task locks it behind a test.)

**Files:** append to `packages/db/src/projection/cycle.test.ts`.

- [ ] **Step 1: Write the test:**

```ts
import { reprojectAll } from './cycle';

describe('reprojectAll', () => {
  it('rebuilds the read-model from canonical and sets the cursor to max seq', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeExternalDb();
    const fhirStore = createFhirStore(internalDb as never);
    const flatWriter = createFlatWriter(externalDb as never, 'postgres');
    await fhirStore.save({ resourceType: 'Patient', id: 'p1' } as never);
    await fhirStore.save({ resourceType: 'Observation', id: 'o1', status: 'final', code: { text: 'x' } } as never);

    const n = await reprojectAll({ internalDb: internalDb as never, flatWriter });
    expect(n).toBeGreaterThanOrEqual(2);
    expect(await externalDb.selectFrom('patients').selectAll().execute()).toHaveLength(1);
    expect(await externalDb.selectFrom('observations').selectAll().execute()).toHaveLength(1);
    // cursor set to current max change_log seq so steady-state tailing won't re-project
    const { readCursor } = await import('./cursor');
    const maxSeq = await internalDb.selectFrom('fhir.change_log').select((eb: any) => eb.fn.max('seq').as('m')).executeTakeFirst();
    expect(await readCursor(internalDb as never, 'projection')).toBe(Number((maxSeq as any).m));
    await internalDb.destroy();
    await externalDb.destroy();
  });
});
```

- [ ] **Step 2: Run.** `pnpm --filter @openldr/db exec vitest run src/projection/cycle.test.ts` → PASS (implementation already exists). If the ValueSet seed rows (migration 014) cause `writeMany` to attempt projecting a `ValueSet` (non-flattened → `flattenResource` returns null → skipped), that's expected and harmless; assert only the counts shown.

- [ ] **Step 3: Commit.**
```bash
git add packages/db/src/projection/cycle.test.ts
git commit -m "test(db): lock reprojectAll rebuild + cursor reset (restructure R2)"
```

---

## Task 5: Decouple `persist()` from inline projection

**Files:** Modify `packages/db/src/persist.ts`, `packages/db/src/persist.test.ts`, `packages/db/src/persist-changelog.test.ts`, `packages/bootstrap/src/persist-store-service.ts`.

- [ ] **Step 1: Update the failing tests first.** In `packages/db/src/persist.test.ts` and `packages/db/src/persist-changelog.test.ts`, change every assertion that expects `flattened: 'written' | 'skipped' | 'degraded'` to expect `flattened: 'deferred'`, and remove `flatWriter` from the `PersistDeps` objects passed in (persist no longer takes it). Read both test files first and adapt them exactly. Then run them to confirm they now FAIL against the current (still-inline) `persist.ts`:
`pnpm --filter @openldr/db exec vitest run src/persist.test.ts src/persist-changelog.test.ts` → FAIL.

- [ ] **Step 2: Rewrite `persist.ts`** — remove the inline flat-writer; `PersistDeps` drops `flatWriter`; `PersistResult.flattened` gains `'deferred'`:

```ts
import { type Logger, OpenLdrError } from '@openldr/core';
import { validateResource } from '@openldr/fhir';
import type { FhirStore } from './fhir-store';

export interface PersistResult {
  saved: boolean;
  flattened: 'written' | 'skipped' | 'degraded' | 'deferred';
  externalError?: string;
}

export interface PersistDeps {
  fhirStore: FhirStore;
  logger: Logger;
}

// Projection is now asynchronous (R2): persist writes the canonical resource + change_log (via
// fhirStore.save) and returns immediately; the projection worker tails change_log and updates the
// external read-model out of band. `flattened: 'deferred'` reflects that decoupling.
export async function persistResource(deps: PersistDeps, resource: unknown, provenance = {}): Promise<PersistResult> {
  const validation = validateResource(resource);
  if (!validation.ok) throw new OpenLdrError('cannot persist invalid FHIR resource');
  await deps.fhirStore.save(validation.resource, provenance);
  return { saved: true, flattened: 'deferred' };
}

export async function persistResources(deps: PersistDeps, resources: unknown[], provenance = {}): Promise<PersistResult[]> {
  const results: PersistResult[] = [];
  for (const resource of resources) {
    const validation = validateResource(resource);
    if (!validation.ok) throw new OpenLdrError('cannot persist invalid FHIR resource');
    await deps.fhirStore.save(validation.resource, provenance);
    results.push({ saved: true, flattened: 'deferred' });
  }
  return results;
}
```
(Keep the `Provenance` import/typing consistent with the existing file — read it and preserve the exact `provenance` parameter typing. Remove now-unused imports: `redact`, `errorMessage`, `FlatWriter`, `FlatWriteItem`.)

- [ ] **Step 3: Update `persist-store-service.ts`** — the `flattened` tally now counts `deferred`. Change the accumulator initialization to include `deferred: 0` and let the existing `flattened[r.flattened] += 1` handle it:

```ts
    const flattened = { written: 0, skipped: 0, degraded: 0, deferred: 0 };
```
(No other change — the `data.persisted` payload now reports `{written:0, skipped:0, degraded:0, deferred:N}`.)

- [ ] **Step 4: Run tests + typecheck.**
`pnpm --filter @openldr/db exec vitest run src/persist.test.ts src/persist-changelog.test.ts` → PASS.
`pnpm --filter @openldr/db exec tsc --noEmit` → PASS.
`pnpm --filter @openldr/bootstrap exec tsc --noEmit` → **expected to FAIL** at `db-context.ts` (still passes `flatWriter` into the persist deps) — that's fixed in Task 6. If `persist-store-service` tests exist and assert the old shape, update them to include `deferred`.

- [ ] **Step 5: Commit.**
```bash
git add packages/db/src/persist.ts packages/db/src/persist.test.ts packages/db/src/persist-changelog.test.ts packages/bootstrap/src/persist-store-service.ts
git commit -m "feat(db): decouple persist from inline projection — flattened='deferred' (restructure R2)"
```

---

## Task 6: Projection worker lifecycle + boot wiring + notify

**Files:** Create `packages/bootstrap/src/projection-worker.ts`, `packages/bootstrap/src/projection-worker.test.ts`; Modify `packages/db/src/fhir-store.ts`, `packages/bootstrap/src/db-context.ts`, `packages/bootstrap/src/index.ts`.

- [ ] **Step 1: Write the worker test** — `packages/bootstrap/src/projection-worker.test.ts` (tests the lifecycle with an injected cycle fn; no real timers dependency for correctness):

```ts
import { describe, expect, it, vi } from 'vitest';
import { createProjectionWorker } from './projection-worker';

describe('createProjectionWorker', () => {
  it('runs a cycle on start and stops cleanly', async () => {
    const runCycle = vi.fn().mockResolvedValue(0);
    const worker = createProjectionWorker({ runCycle, intervalMs: 10_000, logger: { info() {}, error() {}, warn() {}, debug() {} } as never });
    await worker.tickOnce(); // deterministic single tick
    expect(runCycle).toHaveBeenCalledTimes(1);
    await worker.stop();
  });

  it('a throwing cycle does not crash the worker', async () => {
    const runCycle = vi.fn().mockRejectedValue(new Error('boom'));
    const worker = createProjectionWorker({ runCycle, intervalMs: 10_000, logger: { info() {}, error() {}, warn() {}, debug() {} } as never });
    await expect(worker.tickOnce()).resolves.toBeUndefined();
    await worker.stop();
  });
});
```

- [ ] **Step 2: Run — fails.** `pnpm --filter @openldr/bootstrap exec vitest run src/projection-worker.test.ts` → FAIL.

- [ ] **Step 3: Implement `projection-worker.ts`** (mirrors event-bus `startWorker`: interval + best-effort `LISTEN 'fhir_changes'`; the actual DB work is the injected `runCycle`):

```ts
import type pg from 'pg';

export interface ProjectionWorkerDeps {
  runCycle: () => Promise<number>;
  intervalMs?: number;
  logger: { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void };
  // Optional dedicated pg client for LISTEN 'fhir_changes' wakeups (interval polling works without it).
  listenClient?: pg.Client;
}

export interface ProjectionWorker {
  tickOnce(): Promise<void>;
  stop(): Promise<void>;
}

export function createProjectionWorker(deps: ProjectionWorkerDeps): ProjectionWorker {
  const intervalMs = deps.intervalMs ?? 2000;
  let stopped = false;
  let running = false;

  async function tickOnce(): Promise<void> {
    if (running) return; // never overlap cycles
    running = true;
    try {
      await deps.runCycle();
    } catch (err) {
      deps.logger.error({ err }, 'projection cycle failed');
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => { if (!stopped) void tickOnce(); }, intervalMs);
  if (deps.listenClient) {
    deps.listenClient.query('listen fhir_changes').catch(() => undefined);
    deps.listenClient.on('notification', () => { if (!stopped) void tickOnce(); });
  }

  return {
    tickOnce,
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (deps.listenClient) {
        try { await deps.listenClient.query('unlisten fhir_changes'); } catch { /* ignore */ }
      }
    },
  };
}
```

- [ ] **Step 4: Emit the notify in `fhir-store.ts`.** In `save()`, after the `db.transaction().execute(...)` returns (assign it to a const `ref`), add a best-effort wakeup, then return `ref`:

```ts
      const ref = await db.transaction().execute(async (trx) => { /* …existing body… */ });
      // Best-effort wakeup for the projection worker; interval polling is the correctness-bearing
      // path, so a notify failure (e.g. under pg-mem in tests) must never affect the save.
      try { await sql`select pg_notify('fhir_changes', '')`.execute(db); } catch { /* ignore */ }
      return ref;
```

- [ ] **Step 5: Wire into `db-context.ts` and `index.ts`.** In `db-context.ts`: `persist` deps now `{ fhirStore, logger }` (drop `flatWriter`); expose a `runProjectionCycle`-bound helper and the `flatWriter`/`fhirStore` needed by the worker. In `bootstrap/src/index.ts`: build the worker with `runCycle: () => runProjectionCycle({ internalDb, fhirStore, flatWriter, logger, fetch: fetchSafeChangeRows })` and a dedicated `pg.Client` for LISTEN; call `worker.stop()` in the shutdown path alongside the other workers. Read `index.ts` to match the existing startup/shutdown structure exactly.

- [ ] **Step 6: Typecheck + tests.**
`pnpm --filter @openldr/bootstrap exec vitest run src/projection-worker.test.ts` → PASS.
`pnpm --filter @openldr/db exec vitest run` → PASS (the R1 save tests still pass — the notify is caught under pg-mem).
`pnpm --filter @openldr/bootstrap exec tsc --noEmit` → PASS (db-context no longer passes flatWriter to persist).
`pnpm --filter @openldr/server exec tsc --noEmit` → PASS.

- [ ] **Step 7: Commit.**
```bash
git add packages/bootstrap/src/projection-worker.ts packages/bootstrap/src/projection-worker.test.ts packages/db/src/fhir-store.ts packages/bootstrap/src/db-context.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): projection worker lifecycle + boot wiring + change notify (restructure R2)"
```

---

## Task 7: Real-Postgres acceptance test

**Files:** Create `scripts/projection-live-acceptance.ts`; Modify root `package.json`.

- [ ] **Step 1: Write the acceptance script** `scripts/projection-live-acceptance.ts` — runs against real Postgres (internal `:5433/openldr`, external `:5433/openldr_target`), exercising the true `fetchSafeChangeRows` (xmin/snapshot) end-to-end. Model it on `scripts/mssql-live-acceptance.ts` (read that file for the connection/bootstrap/assert-and-exit pattern). It must:
  1. Connect internal + external, run migrations (`migrateToLatest`) on both.
  2. `persist` a Patient + an Observation (valid FHIR).
  3. Run `runProjectionCycle({ … fetch: fetchSafeChangeRows })` in a loop until the cursor reaches the max change_log seq (bounded retries with a short delay).
  4. Assert the external `patients`/`observations` rows appear.
  5. `fhirStore.delete('Patient', id)`, run cycles, assert the external `patients` row is gone.
  6. Concurrency check: open a second pg connection, `BEGIN` + insert a resource via `save` in that txn but hold it open; in the main connection `save` another resource + run a cycle; assert the held resource's row is NOT yet projected (safe frontier blocks it) and the cursor did not advance past it; then commit the held txn, run a cycle, assert it now projects. (Use the internal pool directly for the held transaction.)
  7. Wipe external tables, `reprojectAll`, assert the read-model is rebuilt.
  8. `console.log` a PASS summary and `process.exit(0)`; on any assertion failure `process.exit(1)` with a clear message.

Provide exact, compilable code (no placeholders) following the mssql-live-acceptance structure. Use env overrides `INTERNAL_DATABASE_URL` / `TARGET_DATABASE_URL` with the dev defaults above.

- [ ] **Step 2: Add the script to root `package.json`:**

```json
    "projection:accept": "tsx scripts/projection-live-acceptance.ts",
```
(Match how `mssql:accept` / `mysql:accept` are defined — same runner, e.g. `tsx`.)

- [ ] **Step 3: Run it against dev Postgres.**

Ensure dev Postgres is up (`docker compose up -d postgres`), then:
`pnpm projection:accept`
Expected: prints PASS for each phase (steady-state projection, delete, safe-frontier concurrency, reprojectAll) and exits 0.

- [ ] **Step 4: Commit.**
```bash
git add scripts/projection-live-acceptance.ts package.json
git commit -m "test(accept): real-Postgres projection acceptance — xmin frontier, delete, reproject (restructure R2)"
```

---

## Task 8: Cross-package verification gate

**Files:** none (verification only).

- [ ] **Step 1: Per-package typecheck + tests** (never pipe turbo through `tail`):
```bash
pnpm --filter @openldr/db exec tsc --noEmit
pnpm --filter @openldr/db exec vitest run
pnpm --filter @openldr/ingest exec tsc --noEmit
pnpm --filter @openldr/ingest exec vitest run
pnpm --filter @openldr/bootstrap exec tsc --noEmit
pnpm --filter @openldr/bootstrap exec vitest run
pnpm --filter @openldr/server exec tsc --noEmit
pnpm --filter @openldr/server exec vitest run
```
Expected: ALL PASS. If any package broke because it referenced the old `PersistDeps.flatWriter` or the old `flattened` values, fix the offending caller/test to the new shape (do not restore inline projection).

- [ ] **Step 2: Final scoped turbo gate:**
```bash
pnpm turbo run typecheck test --filter=@openldr/db --filter=@openldr/ingest --filter=@openldr/bootstrap --filter=@openldr/server --force
```
Expected: PASS. (Windows lock/EPERM flakes → re-run the individual `vitest run` from Step 1 to confirm.)

---

## Self-Review

**Spec coverage:** worker mechanism (dedicated, interval+LISTEN) = T6; xmin safe frontier (pure planner + real-PG fetch) = T1 (planner) + T3 (fetch) + T7 (real-PG proof); op-agnostic current-state projection + delete path = T2 (delete) + T3 (apply); remove inline projection / `flattened='deferred'` = T5; `reprojectAll` = T3 (impl) + T4 (test); boot wiring + notify = T6; eventual-consistency real-PG acceptance = T7; non-breaking gate = T8. ✔

**Placeholder scan:** All core logic (planner, fetch, cycle, cursor, delete, worker, persist) has complete code. T7 (acceptance script) is specified as "provide exact compilable code following mssql-live-acceptance" rather than inlined here — that is deliberate (it's a ~150-line harness best written against the concrete `mssql-live-acceptance.ts` structure); the implementer must produce real code with no placeholders. ✔

**Type consistency:** `ChangeRow`/`ProjectionTask`/`ProjectionPlan` (T1) are reused by `cycle.ts`/`fetch.ts` (T3). `FetchSafeRows` signature matches `fetchSafeChangeRows`. `PersistResult.flattened` union includes `'deferred'` (T5) and `persist-store-service` counts it (T5). `FlatWriter.deleteById` (T2) is called by `applyProjection` (T3). Cursor consumer name `'projection'` is consistent across `readCursor`/`advanceCursor`/`reprojectAll`. ✔

**Risk notes for the executor:** (1) `fetch.ts` uses real-PG-only SQL — it is NOT exercised by pg-mem unit tests (they inject a fake fetch); its correctness is proven only by T7 against `:5433`. (2) Keep interval-polling as the correctness path; the `pg_notify` in `save()` is a best-effort latency optimization wrapped in try/catch (must not break pg-mem save tests). (3) Do not restore inline projection anywhere to make a downstream typecheck pass — fix the caller to the async shape.
