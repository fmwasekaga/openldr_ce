# FHIR Storage Restructure — R0: `fhir` Schema Move — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate the canonical FHIR store (`fhir_resources`) from the internal DB's `public` schema into a dedicated `fhir` schema, repointing every code reference, with **zero behavior change**.

**Architecture:** This is slice **R0** of the restructure north-star (`docs/superpowers/specs/2026-07-13-fhir-internal-storage-restructure-design.md`). It only moves the table and repoints code — no versioning, no change-log, no async projection (those are R1/R2). A new internal migration `045_fhir_schema` moves the table; the `InternalSchema` Kysely type gets a schema-qualified key (`'fhir.fhir_resources'`) so the TypeScript compiler flags every call site that still points at the old location.

**Tech Stack:** TypeScript, Kysely (Postgres dialect), pg-mem (in-memory Postgres for unit tests), Vitest, pnpm workspaces + turbo.

**Key facts established before writing this plan (do not re-derive):**
- Only **three code files** query `fhir_resources` through the typed `Kysely<InternalSchema>`: `packages/db/src/fhir-store.ts` (3 sites), `packages/db/src/export-data.ts` (1), `packages/ingest/src/batch-store.ts` (1). Migrations use an untyped `Kysely<any>`, so they are unaffected by the type change.
- `fhir_resources` has **no secondary indexes** — migration `001` creates only the composite primary key `(resource_type, id)`. No later migration alters its columns. Its full column set is: `resource_type, id, version_id, resource, source_system, plugin_id, plugin_version, batch_id, created_at, updated_at`.
- Unit tests run against **pg-mem** via `makeMigratedDb()` ([test-helpers.ts](../../..\packages\db\src\migrations\internal\test-helpers.ts)), which executes each migration's `up()` in order. **pg-mem cannot parse `ALTER TABLE … SET SCHEMA`** but fully supports `CREATE SCHEMA`, schema-qualified DDL/DML (`fhir.fhir_resources`), and cross-schema `insert…select` (verified by spike).
- Migration `014_value_sets.ts` inserts a row into `fhir_resources` unqualified; it runs **before** `045`, so it correctly targets `public.fhir_resources` and needs **no change**.
- Default connection `search_path` is `"$user", public`; the `fhir` schema is **not** on it. All runtime access must be schema-qualified — which the dotted-key typing enforces. No `search_path` change is made.

---

## File Structure

**Create:**
- `packages/db/src/migrations/internal/045_fhir_schema.ts` — the move migration (up: try `SET SCHEMA`, catch → create+copy+drop; down: reverse).
- `packages/db/src/migrations/internal/045_fhir_schema.test.ts` — asserts the table lands in the `fhir` schema and `FhirStore` round-trips.

**Modify:**
- `packages/db/src/migrations/internal/index.ts` — register `045_fhir_schema`.
- `packages/db/src/migrations/migrations.test.ts` — add `'045_fhir_schema'` to the expected internal-migration key list.
- `packages/db/src/schema/internal.ts` — rename the `InternalSchema` key `fhir_resources` → `'fhir.fhir_resources'`.
- `packages/db/src/fhir-store.ts` — repoint 3 query sites.
- `packages/db/src/export-data.ts` — repoint 1 query site.
- `packages/ingest/src/batch-store.ts` — repoint 1 query site.

---

## Task 1: Move `fhir_resources` into the `fhir` schema and repoint all code

The migration and the repoint are **atomic** — the test suite is only green when both land together (the migration moves the table; the code must follow). Do them in one commit.

**Files:**
- Create: `packages/db/src/migrations/internal/045_fhir_schema.ts`
- Create: `packages/db/src/migrations/internal/045_fhir_schema.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/migrations/migrations.test.ts:7`
- Modify: `packages/db/src/schema/internal.ts:501`
- Modify: `packages/db/src/fhir-store.ts:37,56,66`
- Modify: `packages/db/src/export-data.ts:25`
- Modify: `packages/ingest/src/batch-store.ts:76`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/migrations/internal/045_fhir_schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import { createFhirStore } from '../../fhir-store';

describe('045 fhir schema move', () => {
  it('relocates fhir_resources into the fhir schema and FhirStore round-trips', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db);

    await store.save({ resourceType: 'Patient', id: 'p1', name: [{ family: 'X' }] } as never);
    const got = await store.get('Patient', 'p1');
    expect(got?.id).toBe('p1');

    // The canonical table is schema-qualified now.
    const rows = await db
      .selectFrom('fhir.fhir_resources')
      .select(['resource_type', 'id'])
      .execute();
    expect(rows).toEqual([{ resource_type: 'Patient', id: 'p1' }]);

    // The old public.fhir_resources no longer exists.
    await expect(
      db.selectFrom('public.fhir_resources').select(['id']).execute(),
    ).rejects.toThrow();

    await db.destroy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations/internal/045_fhir_schema.test.ts`
Expected: FAIL — `makeMigratedDb()` has no `045` yet, so `fhir.fhir_resources` does not exist (error like `relation "fhir"."fhir_resources" does not exist`).

- [ ] **Step 3: Create the migration**

Create `packages/db/src/migrations/internal/045_fhir_schema.ts`:

```ts
import { type Kysely, sql } from 'kysely';

// R0 of the FHIR storage restructure: relocate the canonical FHIR store from the
// `public` schema into a dedicated `fhir` schema. Real Postgres uses
// `ALTER TABLE ... SET SCHEMA` (instant metadata move, preserves PK + data). Engines
// that cannot parse it (pg-mem in unit tests) fall back to create-in-fhir + copy + drop.
// Column set mirrors 001_fhir_resources exactly (no later migration alters it).

const COLUMNS = [
  'resource_type',
  'id',
  'version_id',
  'resource',
  'source_system',
  'plugin_id',
  'plugin_version',
  'batch_id',
  'created_at',
  'updated_at',
] as const;

async function createFhirResourcesIn(db: Kysely<any>, schema: 'fhir' | 'public'): Promise<void> {
  await db.schema
    .withSchema(schema)
    .createTable('fhir_resources')
    .ifNotExists()
    .addColumn('resource_type', 'text', (c) => c.notNull())
    .addColumn('id', 'text', (c) => c.notNull())
    .addColumn('version_id', 'text')
    .addColumn('resource', 'jsonb', (c) => c.notNull())
    .addColumn('source_system', 'text')
    .addColumn('plugin_id', 'text')
    .addColumn('plugin_version', 'text')
    .addColumn('batch_id', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('fhir_resources_pkey', ['resource_type', 'id'])
    .execute();
}

export async function up(db: Kysely<any>): Promise<void> {
  await sql`create schema if not exists fhir`.execute(db);
  try {
    await sql`alter table public.fhir_resources set schema fhir`.execute(db);
  } catch {
    // Fallback path (pg-mem / engines without SET SCHEMA): recreate in fhir, copy, drop.
    await createFhirResourcesIn(db, 'fhir');
    const rows = await db.selectFrom('fhir_resources').select(COLUMNS as unknown as string[]).execute();
    if (rows.length > 0) {
      await db.insertInto('fhir.fhir_resources').values(rows).execute();
    }
    await db.schema.dropTable('fhir_resources').ifExists().execute();
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  try {
    await sql`alter table fhir.fhir_resources set schema public`.execute(db);
  } catch {
    await createFhirResourcesIn(db, 'public');
    const rows = await db.selectFrom('fhir.fhir_resources').select(COLUMNS as unknown as string[]).execute();
    if (rows.length > 0) {
      await db.insertInto('fhir_resources').values(rows).execute();
    }
    await db.schema.withSchema('fhir').dropTable('fhir_resources').ifExists().execute();
  }
  // Drop the schema only if empty (later slices' tables would block this; ignore errors).
  await sql`drop schema if exists fhir restrict`.execute(db).catch(() => undefined);
}
```

- [ ] **Step 4: Register the migration**

In `packages/db/src/migrations/internal/index.ts`, add the import alongside the others and the map entry. Add near the other imports:

```ts
import * as m045 from './045_fhir_schema';
```

And add to the migrations map object (after the `'044_drop_report_templates'` entry):

```ts
  '045_fhir_schema': { up: m045.up, down: m045.down },
```

- [ ] **Step 5: Update the migration-map test**

In `packages/db/src/migrations/migrations.test.ts:7`, append `'045_fhir_schema'` to the expected array (last element, after `'044_drop_report_templates'`):

```ts
    expect(Object.keys(internalMigrations)).toEqual(['001_fhir_resources', '002_outbox', '003_ingest_batches', '004_plugins', '005_audit_events', '006_users', '007_terminology', '008_dhis2', '009_dhis2_schedules', '010_ingest_batch_config', '011_dashboards', '012_terminology_admin', '013_term_mappings', '014_value_sets', '015_ontology', '016_form_definitions', '017_reference_terminology_seeds', '018_snomed_code_system', '019_form_versions', '020_form_fhir_metadata', '021_user_profiles', '022_dhis2_metadata_cache', '023_marketplace_publishers', '024_plugin_registry', '025_report_runs', '026_report_schedules', '027_workflows', '028_workflow_runs', '029_workflow_schedules', '030_marketplace_installs', '031_workflow_datasets', '032_workflow_dataset_published', '033_connectors', '034_marketplace_registries', '035_plugin_data', '036_dhis2_to_plugin_data', '037_connectors_host_type', '038_app_settings', '039_workflow_runs_correlation', '040_report_templates', '041_custom_queries', '042_report_designs', '043_reports', '044_drop_report_templates', '045_fhir_schema']);
```

- [ ] **Step 6: Retype the `InternalSchema` key**

In `packages/db/src/schema/internal.ts:501`, change the key (the interface value type is unchanged):

```ts
  'fhir.fhir_resources': FhirResourcesTable;
```

(Leave the other ~44 keys as-is. This single dotted key is what the compiler now enforces.)

- [ ] **Step 7: Repoint `fhir-store.ts`**

In `packages/db/src/fhir-store.ts`, change all three table references from `'fhir_resources'` to `'fhir.fhir_resources'`:
- Line ~37: `.insertInto('fhir_resources')` → `.insertInto('fhir.fhir_resources')`
- Line ~56: `.selectFrom('fhir_resources')` → `.selectFrom('fhir.fhir_resources')`
- Line ~66: `.selectFrom('fhir_resources')` → `.selectFrom('fhir.fhir_resources')`

- [ ] **Step 8: Repoint `export-data.ts`**

In `packages/db/src/export-data.ts:25`, change:

```ts
  const rows = await db.selectFrom('fhir.fhir_resources').select('resource').orderBy('resource_type').orderBy('id').execute();
```

- [ ] **Step 9: Repoint `batch-store.ts`**

In `packages/ingest/src/batch-store.ts:76`, change `.selectFrom('fhir_resources')` to `.selectFrom('fhir.fhir_resources')` (the surrounding `.select(['resource_type', 'id'])` and `where` clauses are unchanged).

- [ ] **Step 10: Type-check `@openldr/db` (exhaustiveness gate)**

Run: `pnpm --filter @openldr/db exec tsc --noEmit`
Expected: PASS with no errors. If any file still references `'fhir_resources'` through `Kysely<InternalSchema>`, this fails with `Argument of type '"fhir_resources"' is not assignable…` — repoint it and re-run.

- [ ] **Step 11: Type-check `@openldr/ingest`**

Run: `pnpm --filter @openldr/ingest exec tsc --noEmit`
Expected: PASS. (Catches `batch-store.ts` if step 9 was missed.)

- [ ] **Step 12: Run the new test and the full db + ingest suites**

Run: `pnpm --filter @openldr/db exec vitest run`
Expected: PASS — including `045_fhir_schema.test.ts`, `fhir-store.test.ts`, `export-data` tests, and `migrations.test.ts`.

Run: `pnpm --filter @openldr/ingest exec vitest run`
Expected: PASS — including `batch-store` tests.

- [ ] **Step 13: Commit**

```bash
git add packages/db/src/migrations/internal/045_fhir_schema.ts \
        packages/db/src/migrations/internal/045_fhir_schema.test.ts \
        packages/db/src/migrations/internal/index.ts \
        packages/db/src/migrations/migrations.test.ts \
        packages/db/src/schema/internal.ts \
        packages/db/src/fhir-store.ts \
        packages/db/src/export-data.ts \
        packages/ingest/src/batch-store.ts
git commit -m "feat(db): relocate canonical fhir_resources into a dedicated fhir schema (restructure R0)"
```

---

## Task 2: Cross-package verification gate

The `InternalSchema` type is consumed beyond `@openldr/db` (e.g. `@openldr/bootstrap` db-context, `apps/server`). Confirm no downstream package broke. No code changes are expected here — this is a guard.

**Files:** none (verification only).

- [ ] **Step 1: Type-check the downstream consumers**

Run each (do NOT pipe turbo through `tail` per repo convention; run per-package):

```bash
pnpm --filter @openldr/bootstrap exec tsc --noEmit
pnpm --filter @openldr/server exec tsc --noEmit
```

Expected: PASS for both. If either fails referencing `fhir_resources`, repoint the offending site to `'fhir.fhir_resources'` and re-run Task 1's step 12 suites, then re-commit with `git commit --amend` or a follow-up commit.

- [ ] **Step 2: Run the bootstrap + server suites**

```bash
pnpm --filter @openldr/bootstrap exec vitest run
pnpm --filter @openldr/server exec vitest run
```

Expected: PASS. These exercise `createDbContext` / persist paths against pg-mem and confirm the move is transparent end-to-end.

- [ ] **Step 3: Final gate — targeted typecheck + test across touched packages**

```bash
pnpm turbo run typecheck test --filter=@openldr/db --filter=@openldr/ingest --filter=@openldr/bootstrap --filter=@openldr/server --force
```

Expected: PASS. (Scoped `--filter` avoids a full-graph run; `--force` avoids stale turbo cache masking a break. If Windows lock/EPERM flakes appear, re-run the individual `vitest run` commands from Task 1/Task 2 to confirm.)

---

## Self-Review

**Spec coverage (R0 scope only):** The north-star's R0 is "Create schema `fhir`; move `fhir_resources` into it; repoint fhir-store, migrator, persist, and every query/reference. Zero behavior change. Only `fhir_resources` moves." → Task 1 covers the migration (move), the type change, and all three repoint sites; Task 2 covers the "and every reference" guarantee across downstream packages. History/change-log/versioning/async projection are correctly **excluded** (R1/R2). ✔

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step shows the exact command + expected result. ✔

**Type consistency:** The dotted key `'fhir.fhir_resources'` is defined once in `internal.ts` (step 6) and used identically in every repoint (steps 7–9) and the test (step 1). `createFhirResourcesIn(db, schema)` is defined and called consistently in both `up` and `down`. `COLUMNS` is defined once and reused. ✔

**Risk note for the executor:** The migration's `try/catch` around `SET SCHEMA` is deliberate dialect tolerance (real Postgres takes the fast path; pg-mem takes the fallback) — do not "simplify" it to a single path, and do not swallow errors from the fallback body (only the outer `SET SCHEMA` attempt is expected to throw on unsupported engines).
