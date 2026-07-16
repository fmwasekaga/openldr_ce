# CE Projection Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the deferred projection writing empty provenance, so `source_system` / `plugin_id` / `plugin_version` / `batch_id` are populated in every projected row instead of NULL for every producer.

**Architecture:** Add `FhirStore.getWithProvenance` (additive — `get` has another caller that must not break), have `applyProjection` pass what it returns to `relationalWriter.write`, and make `provenance` a **required** argument so the next caller that forgets is a type error rather than four silent NULLs.

**Tech Stack:** TypeScript, Kysely, **vitest** (`describe`/`it`/`expect`), pg-mem via `makeMigratedDb()`.

**Spec:** `docs/superpowers/specs/2026-07-16-ce-projection-provenance-design.md` (`50a434c7` + correction `685ff0b3`)

---

## Repo

**ALL work is in `D:\Projects\Repositories\openldr_ce`**, package `packages/db`. Branch from `main`.

## Why this exists

Every projected row in every external table has `source_system`, `plugin_id`, `plugin_version` and
`batch_id` **NULL — for every producer, always.** Proven live 2026-07-16:

```
fhir.fhir_resources  →  source_system='cdr', batch_id=8aa3e7ae-…   ✓ stored correctly
public.lab_requests  →  source_system=NULL,  batch_id=NULL         ✗ dropped by the projection
```

It silently defeats the `batchId` design `persist-store-service.ts:11-17` implements deliberately:
*"a per-run batchId is stamped into the provenance of every row … so an outbound workflow can query
exactly this run's rows."* That query returns nothing.

## Conventions

- **`packages/db` uses vitest** — `import { describe, expect, it } from 'vitest'`. This is NOT
  `node:test`; that's the other repo. Verified at `packages/db/src/projection/cycle.test.ts:1`.
- Run one file: `cd packages/db && npx vitest run src/projection/cycle.test.ts`
- Package tests: `cd packages/db && pnpm test` (`vitest run --testTimeout 15000`)
- Typecheck: `cd packages/db && pnpm typecheck`
- Repo gate: `pnpm turbo run typecheck test --force` from the root. **Never pipe turbo through
  `tail`** (Windows lock/EPERM race). Known-flaky packages in parallel turbo runs — verify a
  suspicious failure by running that package's `vitest run` directly.
- Imports inside `packages/db` are **extensionless** (`from './cursor'`, `from '../fhir-store'`) —
  verified at `cycle.ts:1-7`. Do NOT add `.js`; that's the other repo's convention.
- **NEVER add a `Co-Authored-By` trailer.**

## Constraints (verified — do not re-derive, do not violate)

1. **`fhirStore.get` has a second caller**: `packages/db/src/terminology-store.ts:161` does
   `return fhirStore.get(sys.kind, sys.resource_id)` and expects a bare `FhirResource`.
   **Changing `get`'s return type breaks terminology.** The new capability must be additive.
2. **`change_log` carries no provenance** — `fhir-store.ts:185` writes only
   `{resource_type, id, version, op, content_hash, site_id}`. The projection cannot get provenance
   from the rows it already fetches; it must read the canonical row.
3. **`applyProjection` is the only production caller of `relationalWriter.write`.** Every other
   `.write(` in the repo is XLSX or stdout. Making provenance required is therefore contained.
4. **`makeMigratedDb()` runs every real internal migration** against pg-mem
   (`packages/db/src/migrations/internal/test-helpers.ts`), so `fhir.fhir_resources` genuinely has
   the provenance columns under test. The whole chain is unit-testable.

## File Structure

| File | Change |
|---|---|
| `packages/db/src/fhir-store.ts` | Add `getWithProvenance` to the `FhirStore` interface (~line 114) + its implementation (beside `get`, ~line 271). `get` itself is untouched. |
| `packages/db/src/relational-writer.ts` | `provenance` becomes required on `write` and on `RelationalWriteItem`; drop the `= {}` / `?? {}` defaults. |
| `packages/db/src/projection/cycle.ts:26-32` | `applyProjection` uses `getWithProvenance` and passes provenance through. |
| `packages/db/src/projection/cycle.test.ts` | The regression test that should have existed, plus updating existing `write()` calls for the now-required argument. |

---

## Task 1: Branch and confirm a green baseline

**Files:** none (git only)

- [ ] **Step 1: Branch**

```bash
cd /d/Projects/Repositories/openldr_ce
git checkout main && git checkout -b fix/projection-provenance
git status --short   # expect: clean
```

- [ ] **Step 2: Baseline the package BEFORE changing anything**

```bash
cd /d/Projects/Repositories/openldr_ce/packages/db && pnpm test 2>&1 | tail -8
```

Record the pass/fail counts. If it is already red, **STOP and report** — do not build on a red baseline.

---

## Task 2: `getWithProvenance` (additive)

**Files:**
- Modify: `packages/db/src/fhir-store.ts`
- Test: `packages/db/src/projection/cycle.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/db/src/projection/cycle.test.ts` (inside the existing `describe('runProjectionCycle', …)` block, or a new `describe` — match the file's style):

```ts
describe('getWithProvenance', () => {
  it('returns the resource alongside its stored provenance', async () => {
    const internalDb = await makeMigratedDb();
    const fhirStore = createFhirStore(internalDb as never);
    await fhirStore.save(
      { resourceType: 'Patient', id: 'p1', name: [{ family: 'A' }] } as never,
      { sourceSystem: 'cdr', batchId: 'batch-1', pluginId: 'plug', pluginVersion: '1.2.3' },
    );

    const found = await fhirStore.getWithProvenance('Patient', 'p1');
    expect(found).not.toBeNull();
    expect((found!.resource as { id: string }).id).toBe('p1');
    expect(found!.provenance).toEqual({
      sourceSystem: 'cdr', batchId: 'batch-1', pluginId: 'plug', pluginVersion: '1.2.3',
    });
    await internalDb.destroy();
  });

  it('returns an empty provenance (not undefined) when the columns are NULL', async () => {
    const internalDb = await makeMigratedDb();
    const fhirStore = createFhirStore(internalDb as never);
    await fhirStore.save({ resourceType: 'Patient', id: 'p2' } as never);

    const found = await fhirStore.getWithProvenance('Patient', 'p2');
    expect(found).not.toBeNull();
    expect(found!.provenance).toEqual({});
    await internalDb.destroy();
  });

  it('returns null for a missing resource', async () => {
    const internalDb = await makeMigratedDb();
    const fhirStore = createFhirStore(internalDb as never);
    expect(await fhirStore.getWithProvenance('Patient', 'nope')).toBeNull();
    await internalDb.destroy();
  });

  it('leaves get() unchanged — terminology-store.ts:161 depends on the bare resource', async () => {
    const internalDb = await makeMigratedDb();
    const fhirStore = createFhirStore(internalDb as never);
    await fhirStore.save({ resourceType: 'Patient', id: 'p3' } as never, { sourceSystem: 'cdr' });
    const r = await fhirStore.get('Patient', 'p3');
    expect((r as { resourceType: string }).resourceType).toBe('Patient');
    expect((r as Record<string, unknown>).provenance).toBeUndefined();
    await internalDb.destroy();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

```bash
cd /d/Projects/Repositories/openldr_ce/packages/db && npx vitest run src/projection/cycle.test.ts 2>&1 | tail -15
```

Expected: a TypeScript/runtime failure — `getWithProvenance` is not a function.

- [ ] **Step 3: Add it to the interface**

In `packages/db/src/fhir-store.ts`, the `FhirStore` interface currently begins (verbatim, read at `fhir-store.ts:112-115`):

```ts
export interface FhirStore {
  save(resource: FhirResource, provenance?: Provenance): Promise<SavedRef>;
  get(resourceType: string, id: string): Promise<FhirResource | null>;
  listByType(resourceType: string, limit?: number): Promise<{ id: string; resource: FhirResource }[]>;
```

Add `getWithProvenance` directly beneath `get`:

```ts
  /** Like `get`, but also returns the row's stored provenance. The deferred projection
   *  needs it — `get` alone silently produced NULL source_system/batch_id in every
   *  projected row. Additive rather than a change to `get`, because
   *  terminology-store.ts:161 wants the bare resource. */
  getWithProvenance(resourceType: string, id: string): Promise<{ resource: FhirResource; provenance: Provenance } | null>;
```

- [ ] **Step 4: Implement it** — SKETCH (new code)

In `packages/db/src/fhir-store.ts`, `get` is implemented (verbatim, read at `fhir-store.ts:271-279`):

```ts
    async get(resourceType, id) {
      const row = await db
        .selectFrom('fhir.fhir_resources')
        .select('resource')
        .where('resource_type', '=', resourceType)
        .where('id', '=', id)
        .executeTakeFirst();
      return row ? (row.resource as FhirResource) : null;
    },
```

**Leave that exactly as it is.** Add directly beneath it:

```ts
    async getWithProvenance(resourceType, id) {
      const row = await db
        .selectFrom('fhir.fhir_resources')
        .select(['resource', 'source_system', 'plugin_id', 'plugin_version', 'batch_id'])
        .where('resource_type', '=', resourceType)
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) return null;
      // Omit NULL columns rather than carrying nulls: Provenance's fields are
      // optional, and provColumns() maps absent -> NULL on the way back out.
      const provenance: Provenance = {};
      if (row.source_system !== null) provenance.sourceSystem = row.source_system;
      if (row.plugin_id !== null) provenance.pluginId = row.plugin_id;
      if (row.plugin_version !== null) provenance.pluginVersion = row.plugin_version;
      if (row.batch_id !== null) provenance.batchId = row.batch_id;
      return { resource: row.resource as FhirResource, provenance };
    },
```

If the column names on `fhir.fhir_resources` differ from `source_system` / `plugin_id` /
`plugin_version` / `batch_id`, **STOP and report** — those were verified against the live DB on
2026-07-16 and everything downstream assumes them. `Provenance` is defined at
`packages/db/src/provenance.ts` as `{ sourceSystem?, pluginId?, pluginVersion?, batchId? }`; import
it if `fhir-store.ts` does not already.

- [ ] **Step 5: Run the tests — expect PASS**

```bash
cd /d/Projects/Repositories/openldr_ce/packages/db && npx vitest run src/projection/cycle.test.ts 2>&1 | tail -12 && pnpm typecheck
```

Expected: the 4 new tests pass, the pre-existing ones still pass, typecheck clean.

- [ ] **Step 6: Commit**

```bash
cd /d/Projects/Repositories/openldr_ce
git add packages/db/src/fhir-store.ts packages/db/src/projection/cycle.test.ts
git commit -m "feat(db): add FhirStore.getWithProvenance

get() selects only the resource column, so the deferred projection had no
way to read a row's provenance back — hence NULL source_system/batch_id in
every projected row. Additive: terminology-store.ts:161 wants the bare
resource, so get() is untouched."
```

---

## Task 3: The regression test that should have existed

**Files:**
- Test: `packages/db/src/projection/cycle.test.ts`

Write this **before** the fix, so it fails for the real reason.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('runProjectionCycle', …)` block:

```ts
  it('carries provenance from the canonical row into the projected row', async () => {
    // The bug this file never caught: applyProjection called write(canonical) with
    // no provenance, and write() defaulted it to {} — so source_system/plugin_id/
    // plugin_version/batch_id were NULL in EVERY projected row, for every producer,
    // silently defeating the batchId design in persist-store-service.ts:11-17.
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const fhirStore = createFhirStore(internalDb as never);
    const relationalWriter = createRelationalWriter(externalDb as never, 'postgres');
    await fhirStore.save(
      { resourceType: 'Patient', id: 'p1', name: [{ family: 'A' }] } as never,
      { sourceSystem: 'cdr', batchId: 'batch-1' },
    );

    const fetch: FetchSafeRows = async () => ({
      rows: [{ seq: 1, xid: 1, resource_type: 'Patient', resource_id: 'p1', op: 'upsert' }],
      boundary: 100,
      xmax: 200,
    });
    await createProjectionRunner({ internalDb: internalDb as never, fhirStore, relationalWriter, logger, fetch, batchSize: 500 }).runCycle();

    const [row] = await externalDb.selectFrom('patients').selectAll().execute();
    expect(row.source_system).toBe('cdr');
    expect(row.batch_id).toBe('batch-1');
    await internalDb.destroy();
    await externalDb.destroy();
  });
```

- [ ] **Step 2: Run it — expect FAIL for the RIGHT reason**

```bash
cd /d/Projects/Repositories/openldr_ce/packages/db && npx vitest run src/projection/cycle.test.ts 2>&1 | tail -15
```

Expected: FAIL — `expected null to be 'cdr'`. **That null is the bug**, reproduced.

If it fails any other way (e.g. the column doesn't exist), **STOP and report** — the fix would be
different from what this plan assumes.

- [ ] **Step 3: Commit the RED test**

```bash
cd /d/Projects/Repositories/openldr_ce
git add packages/db/src/projection/cycle.test.ts
git commit -m "test(db): reproduce the projection dropping provenance

Red: source_system is null in the projected row though the canonical row
carries it. This assertion never existed, which is why the bug shipped."
```

---

## Task 4: Make provenance required, and pass it

**Files:**
- Modify: `packages/db/src/relational-writer.ts`
- Modify: `packages/db/src/projection/cycle.ts:26-32`
- Modify: `packages/db/src/projection/cycle.test.ts` (existing `write()` calls)

- [ ] **Step 1: Make provenance required in the writer**

`packages/db/src/relational-writer.ts` currently declares (verbatim, read at `relational-writer.ts:9-14`):

```ts
export interface RelationalWriteItem { resource: unknown; provenance?: Provenance; }

export interface RelationalWriter {
  write(resource: unknown, provenance?: Provenance): Promise<WriteResult>;
  writeMany(items: RelationalWriteItem[]): Promise<WriteResult[]>;
  deleteById(resourceType: string, id: string): Promise<void>;
}
```

Change to:

```ts
/** `provenance` is REQUIRED, deliberately. It used to default to `{}`, which made a
 *  caller that forgot indistinguishable from one that meant it — and that is exactly
 *  how the deferred projection wrote NULL source_system/batch_id into every row for
 *  months. A caller with genuinely no provenance passes `{}` explicitly. */
export interface RelationalWriteItem { resource: unknown; provenance: Provenance; }

export interface RelationalWriter {
  write(resource: unknown, provenance: Provenance): Promise<WriteResult>;
  writeMany(items: RelationalWriteItem[]): Promise<WriteResult[]>;
  deleteById(resourceType: string, id: string): Promise<void>;
}
```

Then drop the defaults in the implementation. `relational-writer.ts:26` is currently
`async write(resource, provenance = {}) {` → make it `async write(resource, provenance) {`.
And `relational-writer.ts:36` is currently `const p = projectResource(it.resource, it.provenance ?? {});`
→ make it `const p = projectResource(it.resource, it.provenance);`.

- [ ] **Step 2: Fix `applyProjection` to pass it**

`packages/db/src/projection/cycle.ts:26-32` is currently (verbatim, read at those lines):

```ts
async function applyProjection(task: ProjectionTask, deps: ProjectionDeps): Promise<void> {
  const canonical = await deps.fhirStore.get(task.resourceType, task.id);
  if (canonical) {
    await deps.relationalWriter.write(canonical);
  } else {
    await deps.relationalWriter.deleteById(task.resourceType, task.id);
  }
}
```

Replace with:

```ts
async function applyProjection(task: ProjectionTask, deps: ProjectionDeps): Promise<void> {
  // getWithProvenance, not get: the projected row must carry the canonical row's
  // source_system/plugin_id/plugin_version/batch_id, or the read model cannot say
  // which producer or which run wrote it.
  const found = await deps.fhirStore.getWithProvenance(task.resourceType, task.id);
  if (found) {
    await deps.relationalWriter.write(found.resource, found.provenance);
  } else {
    await deps.relationalWriter.deleteById(task.resourceType, task.id);
  }
}
```

- [ ] **Step 3: Typecheck to find every now-broken caller**

```bash
cd /d/Projects/Repositories/openldr_ce/packages/db && pnpm typecheck 2>&1 | head -20
```

Expected: errors **only** in `cycle.test.ts` (e.g. line 39, `relationalWriter.write({ resourceType: 'Patient', id: 'p1' })`).

**If typecheck flags a PRODUCTION file other than `cycle.ts`, STOP and report it** — the spec
established that `applyProjection` is the only production caller, and a second one would mean
another path is silently dropping provenance too. That is a finding, not a chore.

- [ ] **Step 4: Update the test call sites**

For each `relationalWriter.write(x)` in `cycle.test.ts`, pass provenance **explicitly** — `{}` where
the test doesn't care, e.g. `await relationalWriter.write({ resourceType: 'Patient', id: 'p1' }, {});`.

Passing `{}` explicitly is the point: it's a visible decision rather than a silent default.

- [ ] **Step 5: Run — expect GREEN**

```bash
cd /d/Projects/Repositories/openldr_ce/packages/db && npx vitest run src/projection/cycle.test.ts 2>&1 | tail -12 && pnpm typecheck
```

Expected: all tests pass — including Task 3's `source_system` / `batch_id` assertions. Typecheck clean.

- [ ] **Step 6: Commit**

```bash
cd /d/Projects/Repositories/openldr_ce
git add packages/db/src/relational-writer.ts packages/db/src/projection/cycle.ts packages/db/src/projection/cycle.test.ts
git commit -m "fix(db): carry provenance through the deferred projection

applyProjection called write(canonical) with no provenance and write()
defaulted it to {}, so source_system/plugin_id/plugin_version/batch_id were
NULL in every projected row, for every producer — silently defeating the
batchId design persist-store-service.ts:11-17 implements deliberately.

provenance is now REQUIRED on write()/RelationalWriteItem. The default was
the bug: it made forgetting indistinguishable from meaning it. A caller with
none passes {} explicitly."
```

---

## Task 5: Repo-wide gate

**Files:** none

- [ ] **Step 1: Full gate**

```bash
cd /d/Projects/Repositories/openldr_ce && pnpm turbo run typecheck test --force 2>&1 | grep -E "Tasks:|FAIL|failed" | head -20
```

**Do NOT pipe turbo through `tail`** (Windows lock/EPERM race).

Expected: green. Some packages are known-flaky under parallel turbo (audit / studio-pages / users / db / marketplace / plugins / bootstrap store) — if one fails, re-run **that package's** `vitest run` directly to confirm before treating it as real.

- [ ] **Step 2: Report**

Report the gate result and stop. **Task 6 (live verification) is a human step** — it needs the dev stack up and a real ingest, and an operator's judgement about whether to re-project existing rows.

---

## Task 6: Live verification (HUMAN — do not run unattended)

**Files:** none

Requires `AUTH_DEV_BYPASS=true` and a running dev API. That flag makes the API **unauthenticated and LAN-reachable** (`0.0.0.0:3000`) — see the runbook in
`docs/superpowers/specs/2026-07-16-cdr-fhir-ingest-to-ce-design.md`. Restore it afterwards.

- [ ] **Step 1: Re-ingest one CDR lab and compare canonical vs projected**

```bash
docker exec -i openldr_ce-postgres-1 psql "$INTERNAL_DATABASE_URL" -t -A -F' | ' -c \
  "select resource_type, source_system, batch_id from fhir.fhir_resources where id like 'TZDISA%' limit 3;"
docker exec -i openldr_ce-postgres-1 psql "$TARGET_DATABASE_URL" -t -A -F' | ' -c \
  "select id, source_system, batch_id from public.lab_requests where id like 'TZDISA%' limit 3;"
```

Expected **after re-projection**: the two `source_system` / `batch_id` values match.

- [ ] **Step 2: Understand why old rows still look broken**

Rows projected **before** this fix keep NULL provenance until re-projected. `reprojectAll` exists and
would heal them, but running it is an operational decision and is **out of scope** (see the spec).
An operator checking the read model right after deploying will still see NULLs on old rows — that is
expected, not a failed fix.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `getWithProvenance` — additive, `get` untouched | 2 |
| Selects resource + the 4 provenance columns, maps to `Provenance` | 2 |
| Returns `{}` (not undefined/throw) for NULL columns | 2 (test + impl) |
| `get` unchanged so `terminology-store.ts:161` still compiles | 2 (explicit test) |
| `applyProjection` passes provenance through | 4 |
| `provenance` required on `write` | 4 |
| `provenance` required on `RelationalWriteItem` (`writeMany`) | 4 |
| Regression test: projected row carries provenance | 3 |
| Required-provenance is a compile-time assertion | 4 Step 3 |
| Live verification | 6 (human) |
| Backfill out of scope | 6 Step 2 (explicit note) |
| Repo gate | 5 |

No gaps.

**Placeholder scan:** no TBD/TODO; every code step carries complete code; new code marked SKETCH,
and every quoted existing line carries a `file:line`.

**Type consistency:** `getWithProvenance(resourceType: string, id: string): Promise<{ resource: FhirResource; provenance: Provenance } | null>` — declared in Task 2 Step 3, implemented Step 4,
consumed in Task 4 Step 2 as `found.resource` / `found.provenance`. `write(resource, provenance)` —
made required in Task 4 Step 1, called with two args in Step 2 and in the tests in Step 4.
`Provenance` is the existing exported type (`packages/db/src/provenance.ts`).

**One thing worth restating:** Task 4 Step 3 uses `pnpm typecheck` as a discovery tool — if it flags
a production caller other than `cycle.ts`, that is a **second silently-broken path**, and the plan
says STOP rather than mechanically add `{}`. Adding `{}` there would reintroduce the exact bug this
slice exists to remove.
