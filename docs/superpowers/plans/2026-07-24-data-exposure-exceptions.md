# Data Exposure (Settings → Data Exposure) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the dashboard builder's hardcoded column denylists into a runtime-editable, DB-backed per-table policy managed from a new Settings → Data Exposure page (plus CLI parity).

**Architecture:** One `column_exposure_policy` table becomes the single source of truth (row present = column hidden; absent = exposed). The hardcoded lists in `registry.ts` survive only as the seed source and runtime fallback (`HARDCODED_DENY_UNION`). A `ColumnPolicy` (`Map<table, Set<hiddenColumn>>`) is threaded through the six server-side functions that already gate exposure; bootstrap holds it in an in-memory cache refreshed on write. No client-side security logic changes — the browser only receives already-filtered data.

**Tech Stack:** TypeScript, Kysely (Postgres), Fastify, React + react-router + react-i18next, Commander (CLI), Vitest.

## Global Constraints

- **Deny-list, exposed-by-default.** A column absent from the policy is exposed. New schema columns appear automatically. No allowlist mode.
- **No hard floor.** Admins may hide OR expose any column, including PII. Mitigate with a PII badge + un-hide confirm + audit event — never a code-enforced block.
- **Fail-safe on absence.** If the policy store has no entry for a table (empty/unreachable), fall back to `HARDCODED_DENY_UNION[table]` so known PII is never silently exposed.
- **Enforcement stays server-side.** All filtering runs in `@openldr/dashboards` invoked from `apps/server`/bootstrap. Raw denylists / hidden-column names never travel to the browser except through the Data Exposure API (gated by `data_exposure.manage`).
- **Capability naming:** `group.verb` snake_case (matches `@openldr/rbac` catalog). New cap: `data_exposure.manage`.
- **CLI operator parity:** every policy mutation available in the UI must also be an `openldr` CLI command sharing the store via `@openldr/bootstrap`.
- **i18n:** all new UI strings get en/fr/pt keys.
- **No `Co-Authored-By: Claude` trailer** on commits.

---

### Task 1: Policy-aware registry (core, pure package)

Introduce the `ColumnPolicy` type, the `HARDCODED_DENY_UNION` seed/fallback constant, the `PII_COLUMNS` display-classification, and rewrite the six exposure functions to consult an injected policy. This is the security core; everything else threads it through.

**Files:**
- Modify: `packages/dashboards/src/models/registry.ts`
- Test: `packages/dashboards/src/models/registry.test.ts`

**Interfaces:**
- Consumes: `EXTERNAL_TABLE_COLUMNS`, `ExternalSchema` from `@openldr/db/schema/external`.
- Produces:
  - `type ColumnPolicy = Map<string, Set<string>>`
  - `const HARDCODED_DENY_UNION: Record<string, string[]>`
  - `const PII_COLUMNS: Record<string, string[]>`
  - `function tableExposableColumns(table: keyof ExternalSchema, policy?: ColumnPolicy): string[]`
  - `function joinableColumns(jt: JoinableTable, policy?: ColumnPolicy): string[]`
  - `function exposableColumns(model: QueryModel, alias: string, policy?: ColumnPolicy): string[]`
  - `function exposableFor(model: QueryModel, alias: string, policy?: ColumnPolicy): string[]`
  - `function modelsForClient(models?: QueryModel[], policy?: ColumnPolicy): ClientQueryModel[]`
  - `function joinableTablesForClient(policy?: ColumnPolicy): ClientJoinableTable[]`

- [ ] **Step 1: Write the failing tests**

Add to `packages/dashboards/src/models/registry.test.ts`:

```ts
import { HARDCODED_DENY_UNION, PII_COLUMNS, tableExposableColumns, type ColumnPolicy } from './registry';

describe('policy-aware exposure', () => {
  it('HARDCODED_DENY_UNION is the per-table union of every hardcoded denylist', () => {
    expect(new Set(HARDCODED_DENY_UNION.patients)).toEqual(new Set([
      'id', 'patient_guid', 'surname', 'firstname', 'national_id', 'phone', 'email',
      'date_of_birth', 'replaced_by_id', 'plugin_id', 'plugin_version', 'batch_id',
    ]));
    // source_system unioned in from the per-model specimen/request joins:
    expect(HARDCODED_DENY_UNION.specimens).toContain('source_system');
    expect(HARDCODED_DENY_UNION.lab_requests).toContain('source_system');
  });

  it('tableExposableColumns falls back to the union when the policy has no entry', () => {
    expect(tableExposableColumns('patients')).toContain('sex');
    expect(tableExposableColumns('patients')).not.toContain('national_id');
  });

  it('tableExposableColumns honors an explicit policy (exposed-by-default)', () => {
    const policy: ColumnPolicy = new Map([['patients', new Set(['sex'])]]);
    const cols = tableExposableColumns('patients', policy);
    expect(cols).not.toContain('sex');       // hidden by policy
    expect(cols).toContain('national_id');   // NOT in policy => exposed (no floor)
  });

  it('PII_COLUMNS flags patient identifiers', () => {
    expect(PII_COLUMNS.patients).toEqual(expect.arrayContaining(['national_id', 'phone', 'surname']));
  });
});
```

Update the two existing tests that asserted the OLD fail-safe-closed behavior (now intentionally exposed-by-default):
- `joinableColumns returns [] when a table has no policy (fail-safe closed)` → replace with: an unknown/empty policy now falls back to the union, so real tables still hide PII (assert `joinableColumns(getJoinableTable('patients')!)` excludes `national_id`).
- `joinableColumns applies an allowlist policy` → delete (allowlist mode is removed per Global Constraints).
- In `modelsForClient projects optional joins…` and the `MODEL_WITH_OPTIONAL` test: the `jf` join (no denylist) is no longer dropped for "empty exposable" — it now exposes its table's columns minus the union fallback. Adjust the expectation to include `jf` (see Step 3 note) — assert on `jp` presence only, and drop the `jf … dropped` assertion.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/models/registry.test.ts`
Expected: FAIL — `HARDCODED_DENY_UNION`, `PII_COLUMNS`, `tableExposableColumns` not exported.

- [ ] **Step 3: Implement**

In `packages/dashboards/src/models/registry.ts`:

1. Add the type + constants near the top (after imports):

```ts
/** table name -> set of columns that MUST be hidden. Absent table/column => exposed. */
export type ColumnPolicy = Map<string, Set<string>>;

/**
 * Per-table UNION of every hardcoded denylist that existed before the runtime policy
 * (JOINABLE_TABLES[].denyColumns + every MODELS[].joins[].denyColumns). This is BOTH the
 * seed for column_exposure_policy AND the runtime fallback when the policy has no entry
 * for a table (empty/unreachable store) — so known PII is never silently exposed.
 */
export const HARDCODED_DENY_UNION: Record<string, string[]> = {
  patients: ['id', 'patient_guid', 'surname', 'firstname', 'national_id', 'phone', 'email',
             'date_of_birth', 'replaced_by_id', 'plugin_id', 'plugin_version', 'batch_id'],
  specimens: ['id', 'patient_id', 'accession', 'source_system', 'plugin_id', 'plugin_version', 'batch_id'],
  lab_requests: ['id', 'request_id', 'patient_id', 'source_system', 'plugin_id', 'plugin_version', 'batch_id'],
  facilities: ['plugin_id', 'plugin_version', 'batch_id'],
  diagnostic_reports: ['id', 'patient_id', 'plugin_id', 'plugin_version', 'batch_id'],
};

/** Columns classified as PII for the Data Exposure UI badge + un-hide confirmation ONLY.
 *  Display metadata — never an enforcement input. */
export const PII_COLUMNS: Record<string, string[]> = {
  patients: ['patient_guid', 'surname', 'firstname', 'national_id', 'phone', 'email', 'date_of_birth'],
  specimens: [], lab_requests: [], facilities: [], diagnostic_reports: [], lab_results: [],
};

/** Hidden-column set for a table: the policy entry, else the hardcoded union fallback. */
function hiddenFor(table: string, policy?: ColumnPolicy): Set<string> {
  return policy?.get(table) ?? new Set(HARDCODED_DENY_UNION[table] ?? []);
}

/** Exposable columns of a table = all real columns minus the hidden set. */
export function tableExposableColumns(table: keyof ExternalSchema, policy?: ColumnPolicy): string[] {
  const deny = hiddenFor(table, policy);
  return EXTERNAL_TABLE_COLUMNS[table].filter((c) => !deny.has(c));
}
```

2. Rewrite the exposure functions to delegate to `tableExposableColumns`:

```ts
export function exposableColumns(model: QueryModel, alias: string, policy?: ColumnPolicy): string[] {
  const j = (model.joins ?? []).find((x) => x.alias === alias);
  if (!j || !j.optional) return [];
  return tableExposableColumns(j.table, policy);
}

export function exposableFor(model: QueryModel, alias: string, policy?: ColumnPolicy): string[] {
  const j = (model.joins ?? []).find((x) => x.alias === alias);
  return j?.exposable ?? exposableColumns(model, alias, policy);
}

export function joinableColumns(jt: JoinableTable, policy?: ColumnPolicy): string[] {
  return tableExposableColumns(jt.table, policy);
}

export function joinableTablesForClient(policy?: ColumnPolicy): ClientJoinableTable[] {
  return JOINABLE_TABLES
    .map((jt) => ({ table: jt.table, label: jt.label, columns: joinableColumns(jt, policy), primaryKeys: jt.primaryKeys ?? [], allColumns: EXTERNAL_TABLE_COLUMNS[jt.table] }))
    .filter((t) => t.columns.length > 0);
}

export function modelsForClient(models: QueryModel[] = MODELS, policy?: ColumnPolicy): ClientQueryModel[] {
  return models.map((m) => {
    const optionalJoins = (m.joins ?? [])
      .filter((j) => j.optional)
      .map((j) => ({ alias: j.alias, label: j.label ?? j.table, left: j.left, right: j.right, exposableColumns: exposableColumns(m, j.alias, policy) }))
      .filter((oj) => oj.exposableColumns.length > 0);
    const { id, label, table, dimensions, metrics } = m;
    const tableColumns = EXTERNAL_TABLE_COLUMNS[table];
    return optionalJoins.length ? { id, label, table, dimensions, metrics, optionalJoins, tableColumns }
                                : { id, label, table, dimensions, metrics, tableColumns };
  });
}
```

3. Delete the now-unused `exposableColumns`-with-denylist docblock's fail-safe wording and the old `joinableColumns` allowlist/deny branching. Remove the `columns?: string[]` allowlist field usage (leave the field on `JoinableTable` if other code references it — grep first; otherwise delete it). The per-model `denyColumns` and `JOINABLE_TABLES[].denyColumns` fields stay in the file (documentation + they feed the union constant conceptually) but are no longer read at runtime.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/models/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/models/registry.ts packages/dashboards/src/models/registry.test.ts
git commit -m "feat(dashboards): policy-aware column exposure in registry"
```

---

### Task 2: Thread the policy through the compile/run path

`effectiveModel`, `compileBuilderQuery`, and `runBuilderQuery` call the registry functions; give them an optional `policy` parameter so a hand-edited widget JSON is validated against the runtime policy, not just the fallback.

**Files:**
- Modify: `packages/dashboards/src/compile.ts`
- Test: `packages/dashboards/src/compile.test.ts`

**Interfaces:**
- Consumes: `exposableFor`, `getJoinableTable`, `joinableColumns`, `type ColumnPolicy` from `./models/registry` (Task 1).
- Produces (updated signatures, `policy` optional & last so existing callers still compile):
  - `effectiveModel(model, q, policy?)`
  - `compileBuilderQuery(db, model, q, policy?)`
  - `runBuilderQuery(db, model, q, policy?)`

- [ ] **Step 1: Write the failing test**

Add to `packages/dashboards/src/compile.test.ts`:

```ts
import { type ColumnPolicy } from './models/registry';

it('runBuilderQuery rejects an adhoc column the runtime policy hides', async () => {
  // 'sex' is normally exposable on patients; a policy that hides it must reject the adhoc dim.
  const policy: ColumnPolicy = new Map([['patients', new Set(['sex'])]]);
  await expect(runBuilderQuery(db, getModel('service_requests')!, q({
    adhocDimensions: [{ key: 'x', label: 'X', column: 'sex', kind: 'string', join: 'jp' }],
  }) as any, policy)).rejects.toThrow(/not exposable/);
});

it('runBuilderQuery accepts a column the policy exposes that the union would hide', async () => {
  // 'source_system' is in the union fallback (hidden) but an explicit empty policy exposes it.
  const policy: ColumnPolicy = new Map([['patients', new Set()]]);
  const res = await runBuilderQuery(db, getModel('service_requests')!, q({
    adhocDimensions: [{ key: 'ss', label: 'SS', column: 'source_system', kind: 'string', join: 'jp' }],
    dimension: { key: 'ss' }, metric: { key: 'count' },
  }) as any, policy);
  expect(res).toBeTruthy(); // no throw = column accepted
});
```

(Reuse the existing `db`/`q` harness already defined in the file for the "rejects a denied adhoc column" test at line 366.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/compile.test.ts`
Expected: FAIL — `runBuilderQuery` ignores the 4th arg; the policy-hides-`sex` case does not throw.

- [ ] **Step 3: Implement**

In `packages/dashboards/src/compile.ts`:

```ts
import { exposableFor, getJoinableTable, joinableColumns, type ColumnPolicy } from './models/registry';

export function effectiveModel(model: QueryModel, q: BuilderQuery, policy?: ColumnPolicy): QueryModel {
  // ...unchanged body, EXCEPT the two policy-sensitive calls:
  //   synth.push({ ..., exposable: joinableColumns(jt, policy) });
  //   if (!exposableFor(eff, a.join, policy).includes(a.column)) throw ...
}

export function compileBuilderQuery(db: Kysely<ExternalSchema>, model: QueryModel, q: BuilderQuery, policy?: ColumnPolicy): AnyQB {
  model = effectiveModel(model, q, policy);
  // ...rest unchanged...
}

export async function runBuilderQuery(db: Kysely<ExternalSchema>, model: QueryModel, q: BuilderQuery, policy?: ColumnPolicy): Promise<ReportResultData> {
  model = effectiveModel(model, q, policy);
  // ...rest unchanged, but pass policy where it re-enters compileBuilderQuery/runWideQuery:
  //   if (q.metrics && q.metrics.length > 0) return runWideQuery(db, model, q, policy);
  //   const rows = (await compileBuilderQuery(db, model, q, policy).execute()) ...
}
```

Update `runWideQuery`'s signature the same way (`policy?: ColumnPolicy` last) and pass it into its internal `compileBuilderQuery` call. `effectiveModel` is called once at the top of `runBuilderQuery`; the model it returns already has synth joins with their `exposable` baked in, so the inner `compileBuilderQuery(db, model, q, policy)` re-running `effectiveModel` is idempotent (documented behavior).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/compile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/compile.ts packages/dashboards/src/compile.test.ts
git commit -m "feat(dashboards): thread column policy through compile/run path"
```

---

### Task 3: Database migration + schema type

Create the `column_exposure_policy` table and register it.

**Files:**
- Create: `packages/db/src/migrations/internal/063_column_exposure_policy.ts`
- Modify: `packages/db/src/migrations/internal/index.ts` (import + registry entry)
- Modify: `packages/db/src/schema/internal.ts` (`ColumnExposurePolicyTable` interface + `InternalSchema` entry)
- Test: `packages/db/src/migrations/migrations.test.ts` (existing round-trip test picks up the new migration automatically — verify it still passes)

**Interfaces:**
- Produces: table `column_exposure_policy(table_name text, column_name text, updated_at timestamptz, updated_by text, PK(table_name, column_name))`; TS type `ColumnExposurePolicyTable`.

- [ ] **Step 1: Write the migration**

Create `packages/db/src/migrations/internal/063_column_exposure_policy.ts`:

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('column_exposure_policy')
    .ifNotExists()
    .addColumn('table_name', 'text', (c) => c.notNull())
    .addColumn('column_name', 'text', (c) => c.notNull())
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_by', 'text')
    .addPrimaryKeyConstraint('column_exposure_policy_pk', ['table_name', 'column_name'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('column_exposure_policy').ifExists().execute();
}
```

- [ ] **Step 2: Register the migration**

In `packages/db/src/migrations/internal/index.ts`: add `import * as m063 from './063_column_exposure_policy';` after the `m062` import, and `'063_column_exposure_policy': { up: m063.up, down: m063.down },` after the `062_rbac` entry.

- [ ] **Step 3: Add the schema type**

In `packages/db/src/schema/internal.ts`, add the interface (near `DashboardsTable`):

```ts
export interface ColumnExposurePolicyTable {
  table_name: string;
  column_name: string;
  updated_at: Generated<Date>;
  updated_by: string | null;
}
```

and add to `InternalSchema` (after `dashboards: DashboardsTable;`):

```ts
  column_exposure_policy: ColumnExposurePolicyTable;
```

- [ ] **Step 4: Run the migration round-trip test**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations/migrations.test.ts`
Expected: PASS (up/down applies cleanly; type-checks).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/internal/063_column_exposure_policy.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts
git commit -m "feat(db): column_exposure_policy table + schema type"
```

---

### Task 4: Column-policy store + seeding

A Kysely-backed store: read the hidden set per table, replace a table's hidden set, and build a `ColumnPolicy` map. Includes a `seedColumnExposurePolicy` that inserts `HARDCODED_DENY_UNION` idempotently.

**Files:**
- Create: `packages/dashboards/src/column-policy-store.ts`
- Modify: `packages/dashboards/src/index.ts` (export the store + types)
- Test: `packages/dashboards/src/column-policy-store.test.ts`

**Interfaces:**
- Consumes: `Kysely<InternalSchema>` from `@openldr/db`; `HARDCODED_DENY_UNION`, `type ColumnPolicy` from `./models/registry`.
- Produces:
  - `interface ColumnPolicyStore { load(): Promise<ColumnPolicy>; listHidden(): Promise<Record<string,string[]>>; replaceTable(table: string, hidden: string[], updatedBy?: string): Promise<void>; }`
  - `function createColumnPolicyStore(db: Kysely<InternalSchema>): ColumnPolicyStore`
  - `function seedColumnExposurePolicy(db: Kysely<InternalSchema>): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `packages/dashboards/src/column-policy-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { newTestDb } from '@openldr/db/testing'; // existing in-memory/pg test helper — mirror what store.test.ts uses
import { createColumnPolicyStore, seedColumnExposurePolicy } from './column-policy-store';
import { HARDCODED_DENY_UNION } from './models/registry';

let db: Kysely<any>;
beforeEach(async () => { db = await newTestDb(); });

describe('column policy store', () => {
  it('seeds the hardcoded union idempotently', async () => {
    await seedColumnExposurePolicy(db);
    await seedColumnExposurePolicy(db); // second run must not throw / duplicate
    const store = createColumnPolicyStore(db);
    const hidden = await store.listHidden();
    expect(new Set(hidden.patients)).toEqual(new Set(HARDCODED_DENY_UNION.patients));
  });

  it('load() returns a ColumnPolicy map', async () => {
    await seedColumnExposurePolicy(db);
    const policy = await createColumnPolicyStore(db).load();
    expect(policy.get('patients')?.has('national_id')).toBe(true);
  });

  it('replaceTable swaps a table hidden set wholesale', async () => {
    await seedColumnExposurePolicy(db);
    const store = createColumnPolicyStore(db);
    await store.replaceTable('patients', ['national_id'], 'tester');
    const hidden = await store.listHidden();
    expect(hidden.patients).toEqual(['national_id']); // surname etc. now exposed
  });
});
```

(Match the DB test bootstrap actually used by `packages/dashboards/src/store.test.ts` — reuse that exact helper import/setup instead of `newTestDb` if it differs.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/column-policy-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `packages/dashboards/src/column-policy-store.ts`:

```ts
import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import { HARDCODED_DENY_UNION, type ColumnPolicy } from './models/registry';

export interface ColumnPolicyStore {
  /** Build the enforcement map from the DB (table -> hidden column set). */
  load(): Promise<ColumnPolicy>;
  /** Plain per-table hidden lists for the API/CLI. */
  listHidden(): Promise<Record<string, string[]>>;
  /** Replace a single table's hidden set atomically. */
  replaceTable(table: string, hidden: string[], updatedBy?: string): Promise<void>;
}

export function createColumnPolicyStore(db: Kysely<InternalSchema>): ColumnPolicyStore {
  return {
    async load() {
      const rows = await db.selectFrom('column_exposure_policy').select(['table_name', 'column_name']).execute();
      const map: ColumnPolicy = new Map();
      for (const r of rows) {
        const set = map.get(r.table_name) ?? new Set<string>();
        set.add(r.column_name);
        map.set(r.table_name, set);
      }
      return map;
    },
    async listHidden() {
      const rows = await db.selectFrom('column_exposure_policy').select(['table_name', 'column_name']).orderBy('table_name').orderBy('column_name').execute();
      const out: Record<string, string[]> = {};
      for (const r of rows) (out[r.table_name] ??= []).push(r.column_name);
      return out;
    },
    async replaceTable(table, hidden, updatedBy) {
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('column_exposure_policy').where('table_name', '=', table).execute();
        if (hidden.length) {
          await trx.insertInto('column_exposure_policy')
            .values(hidden.map((column_name) => ({ table_name: table, column_name, updated_by: updatedBy ?? null })) as never)
            .execute();
        }
      });
    },
  };
}

/** Seed the policy from the hardcoded union. Idempotent via ON CONFLICT DO NOTHING on the PK. */
export async function seedColumnExposurePolicy(db: Kysely<InternalSchema>): Promise<void> {
  const values = Object.entries(HARDCODED_DENY_UNION).flatMap(([table_name, cols]) =>
    cols.map((column_name) => ({ table_name, column_name, updated_by: 'seed' })));
  if (!values.length) return;
  await db.insertInto('column_exposure_policy')
    .values(values as never)
    .onConflict((oc) => oc.columns(['table_name', 'column_name']).doNothing())
    .execute();
}
```

- [ ] **Step 4: Export from the package**

In `packages/dashboards/src/index.ts` add:

```ts
export { createColumnPolicyStore, seedColumnExposurePolicy, type ColumnPolicyStore } from './column-policy-store';
export { HARDCODED_DENY_UNION, PII_COLUMNS, type ColumnPolicy } from './models/registry';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/column-policy-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboards/src/column-policy-store.ts packages/dashboards/src/column-policy-store.test.ts packages/dashboards/src/index.ts
git commit -m "feat(dashboards): column_exposure_policy store + seed"
```

---

### Task 5: Bootstrap wiring — policy cache + DashboardsApi

Load the policy into an in-memory cache at startup, seed it on start, thread it into every DashboardsApi consumer, and expose the store + a `reloadColumnPolicy()`.

**Files:**
- Modify: `packages/bootstrap/src/index.ts` (`DashboardsApi` interface + the `dashboards` wiring block near line 491–524)
- Modify: `packages/bootstrap/src/seed.ts` (call `seedColumnExposurePolicy`)
- Test: `packages/bootstrap/src/index.test.ts` (extend the "real wiring" dashboards test)

**Interfaces:**
- Consumes: `createColumnPolicyStore`, `seedColumnExposurePolicy`, `type ColumnPolicy`, `runBuilderQuery`, `compileBuilderQuery`, `modelsForClient`, `joinableTablesForClient` from `@openldr/dashboards`.
- Produces (extended `DashboardsApi`):
  - `columnPolicy: ColumnPolicyStore`
  - `reloadColumnPolicy(): Promise<void>`
  - (existing `models()/joinableTables()/query()/compileSql()` now reflect the cache)

- [ ] **Step 1: Write the failing test**

Extend `packages/bootstrap/src/index.test.ts` (the "real wiring" test around line 57):

```ts
it('dashboards.models() reflects a written column policy', async () => {
  const ctx = await createAppContext(testConfig()); // same harness the file already uses
  try {
    await ctx.dashboards.columnPolicy.replaceTable('patients', [], 'test'); // expose everything on patients
    await ctx.dashboards.reloadColumnPolicy();
    const models = ctx.dashboards.models();
    const results = models.find((m) => m.id === 'observations')!;
    // 'jp' was a non-optional patient join; the arbitrary-join universe now exposes national_id:
    const jt = ctx.dashboards.joinableTables().find((t) => t.table === 'patients')!;
    expect(jt.columns).toContain('national_id');
  } finally { await ctx.close(); }
});
```

(Use the exact context/config helpers already imported at the top of `index.test.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/index.test.ts`
Expected: FAIL — `ctx.dashboards.columnPolicy` / `reloadColumnPolicy` undefined.

- [ ] **Step 3: Implement bootstrap wiring**

In `packages/bootstrap/src/index.ts`:

1. Extend the `DashboardsApi` interface (line ~93):

```ts
export interface DashboardsApi {
  store: DashboardStore;
  models(): ClientQueryModel[];
  joinableTables(): ClientJoinableTable[];
  query(q: WidgetQuery): Promise<ReportResult>;
  compileSql(q: Extract<WidgetQuery, { mode: 'builder' }>): Promise<string>;
  columnPolicy: ColumnPolicyStore;
  reloadColumnPolicy(): Promise<void>;
}
```

2. In the wiring block (replace lines ~491–524). Build the store + cache BEFORE `runDashboardQuery`, thread `policyCache` into every consumer:

```ts
const dashboardStore = createDashboardStore(internal.db, referenceCapture);
const columnPolicy = createColumnPolicyStore(internal.db);
let policyCache: ColumnPolicy = await columnPolicy.load();
const reloadColumnPolicy = async () => { policyCache = await columnPolicy.load(); };

const runDashboardQuery = async (q: WidgetQuery): Promise<ReportResult> => {
  let data;
  if (q.mode === 'builder') {
    const model = getModel(q.model);
    if (!model) throw new DashboardQueryError(`unknown model: ${q.model}`);
    data = await runBuilderQuery(reportingDb, model, q, policyCache);
  } else {
    // ...unchanged sql branch...
  }
  return { ...data, meta: { generatedAt: new Date().toISOString(), rowCount: data.rows.length } };
};

const compileDashboardSql = async (q: Extract<WidgetQuery, { mode: 'builder' }>): Promise<string> => {
  const model = getModel(q.model);
  if (!model) throw new DashboardQueryError(`unknown model: ${q.model}`);
  const { sql: compiledSql, parameters } = compileBuilderQuery(reportingDb, model, q, policyCache).compile();
  return formatSql(compiledSql, parameters);
};

const dashboards: DashboardsApi = {
  store: dashboardStore,
  models: () => modelsForClient(undefined, policyCache),
  joinableTables: () => joinableTablesForClient(policyCache),
  query: runDashboardQuery,
  compileSql: compileDashboardSql,
  columnPolicy,
  reloadColumnPolicy,
};
```

3. Add imports at the top of the file: `createColumnPolicyStore`, `type ColumnPolicyStore`, `type ColumnPolicy` from `@openldr/dashboards` (extend the existing multi-name import on line 19).

- [ ] **Step 4: Seed on start**

In `packages/bootstrap/src/seed.ts`, import `seedColumnExposurePolicy` from `@openldr/dashboards` and call it in the same place other idempotent seeds run (alongside the terminology/dashboard seeds — it must run whether or not `SEED_ON_START` is true, like the other minimum seeds; grep the file for the always-run seed section and add `await seedColumnExposurePolicy(db);`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/index.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/index.ts packages/bootstrap/src/seed.ts packages/bootstrap/src/index.test.ts
git commit -m "feat(bootstrap): column-policy cache + seed + DashboardsApi wiring"
```

---

### Task 6: RBAC capability

Add `data_exposure.manage` to the catalog and admin preset.

**Files:**
- Modify: `packages/rbac/src/catalog.ts`
- Modify: `packages/rbac/src/presets.ts`
- Test: `packages/rbac/src/presets.test.ts` (extend admin-preset assertion if it enumerates keys)

**Interfaces:**
- Produces: capability key `data_exposure.manage` present in `CAPABILITY_KEYS` and the admin preset.

- [ ] **Step 1: Write the failing test**

In `packages/rbac/src/catalog.test.ts` (or the nearest catalog test — create an assertion if none):

```ts
import { CAPABILITY_KEYS } from './catalog';
it('includes the data_exposure.manage capability', () => {
  expect(CAPABILITY_KEYS).toContain('data_exposure.manage');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/rbac exec vitest run`
Expected: FAIL — key absent.

- [ ] **Step 3: Implement**

In `packages/rbac/src/catalog.ts`, add (after the `settings.*` group, before `activity.*`):

```ts
{ key: 'data_exposure.manage', group: 'data_exposure', label: 'Manage data exposure',
  description: 'Control which table columns may be exposed through dashboards, queries, and reports.' },
```

In `packages/rbac/src/presets.ts`, add `'data_exposure.manage',` to the admin/labadmin preset capability array (the full-access preset — mirror where `settings.feature_flags` sits).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/rbac exec vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rbac/src/catalog.ts packages/rbac/src/presets.ts packages/rbac/src/catalog.test.ts
git commit -m "feat(rbac): data_exposure.manage capability"
```

---

### Task 7: Server API routes

`GET`/`PUT /api/dashboards/column-policy`, gated by `data_exposure.manage`, PUT audit-logged and cache-reloading.

**Files:**
- Modify: `apps/server/src/dashboards-routes.ts`
- Test: `apps/server/src/dashboards-routes.test.ts`

**Interfaces:**
- Consumes: `ctx.dashboards.columnPolicy`, `ctx.dashboards.reloadColumnPolicy`, `EXTERNAL_TABLE_COLUMNS`, `PII_COLUMNS`, `recordAudit`, `requireCapability`.
- Produces:
  - `GET` → `{ tables: Array<{ table: string; label: string; columns: Array<{ name: string; hidden: boolean; pii: boolean }> }> }`
  - `PUT` body `{ [table: string]: string[] }` (hidden column names per table) → `{ ok: true }`

- [ ] **Step 1: Write the failing test**

Add to `apps/server/src/dashboards-routes.test.ts` (mirror the existing harness that builds a fake `ctx`):

```ts
it('GET /api/dashboards/column-policy returns per-column hidden+pii flags', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/dashboards/column-policy' });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  const patients = body.tables.find((t: any) => t.table === 'patients');
  const natId = patients.columns.find((c: any) => c.name === 'national_id');
  expect(natId).toMatchObject({ hidden: true, pii: true });
});

it('PUT /api/dashboards/column-policy replaces + reloads + audits', async () => {
  const res = await app.inject({ method: 'PUT', url: '/api/dashboards/column-policy', payload: { patients: ['national_id'] } });
  expect(res.statusCode).toBe(200);
  expect(reloadSpy).toHaveBeenCalled();     // wire a spy on ctx.dashboards.reloadColumnPolicy
  expect(auditSpy).toHaveBeenCalled();
});
```

Extend the test's fake `ctx.dashboards` with a `columnPolicy` stub (`listHidden`/`replaceTable`) and a `reloadColumnPolicy` spy.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server exec vitest run src/dashboards-routes.test.ts`
Expected: FAIL — routes 404.

- [ ] **Step 3: Implement the routes**

In `apps/server/src/dashboards-routes.ts`, add imports and routes inside `registerDashboardRoutes`:

```ts
import { EXTERNAL_TABLE_COLUMNS } from '@openldr/db/schema/external';
import { PII_COLUMNS } from '@openldr/dashboards';

const EXPOSURE = { preHandler: requireCapability('data_exposure.manage') };
// The governed tables + labels shown on the page (subset of EXTERNAL_TABLE_COLUMNS that is joinable/modeled):
const GOVERNED: Array<{ table: keyof typeof EXTERNAL_TABLE_COLUMNS; label: string }> = [
  { table: 'patients', label: 'Patient' }, { table: 'specimens', label: 'Specimen' },
  { table: 'lab_requests', label: 'Request' }, { table: 'facilities', label: 'Facility' },
  { table: 'diagnostic_reports', label: 'Report' },
];

app.get('/api/dashboards/column-policy', EXPOSURE, async () => {
  const hidden = await ctx.dashboards.columnPolicy.listHidden();
  return {
    tables: GOVERNED.map(({ table, label }) => {
      const hiddenSet = new Set(hidden[table] ?? []);
      const pii = new Set(PII_COLUMNS[table] ?? []);
      return {
        table, label,
        columns: EXTERNAL_TABLE_COLUMNS[table].map((name) => ({ name, hidden: hiddenSet.has(name), pii: pii.has(name) })),
      };
    }),
  };
});

app.put('/api/dashboards/column-policy', EXPOSURE, async (req, reply) => {
  try {
    const body = req.body as Record<string, string[]>;
    const before = await ctx.dashboards.columnPolicy.listHidden();
    for (const { table } of GOVERNED) {
      if (!Array.isArray(body[table])) continue;
      // validate names against real columns — reject unknown columns rather than persisting junk
      const valid = new Set(EXTERNAL_TABLE_COLUMNS[table]);
      const hidden = body[table].filter((c) => valid.has(c));
      await ctx.dashboards.columnPolicy.replaceTable(table, hidden, actorNameOf(req));
    }
    await ctx.dashboards.reloadColumnPolicy();
    const after = await ctx.dashboards.columnPolicy.listHidden();
    await recordAudit(ctx, req, { action: 'data_exposure.policy.updated', entityType: 'column_exposure_policy', entityId: 'global', before, after });
    return { ok: true };
  } catch (err) { return mapError(err, reply); }
});
```

Use the existing actor-name accessor the file/`recordAudit` already relies on for `actorNameOf(req)` (grep `recordAudit` usage / `audit-helper` for the actor source; pass whatever `recordAudit` expects — it already derives the actor from `req`, so `updated_by` can simply be `req.user?.name ?? null` following the pattern used elsewhere).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/server exec vitest run src/dashboards-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/dashboards-routes.ts apps/server/src/dashboards-routes.test.ts
git commit -m "feat(server): data-exposure column-policy routes"
```

---

### Task 8: Studio API client

Typed client functions for the two routes.

**Files:**
- Modify: `apps/studio/src/api.ts`
- Test: (covered by the page test in Task 9; no separate client test unless `api.ts` has one — mirror existing dashboard client funcs)

**Interfaces:**
- Produces:
  - `type ColumnPolicyTable = { table: string; label: string; columns: { name: string; hidden: boolean; pii: boolean }[] }`
  - `getColumnPolicy(): Promise<ColumnPolicyTable[]>`
  - `saveColumnPolicy(payload: Record<string, string[]>): Promise<void>`

- [ ] **Step 1: Implement the client functions**

In `apps/studio/src/api.ts` (near the dashboard functions at line ~310), following the existing `authFetch`/`okJson` pattern:

```ts
export interface ColumnPolicyColumn { name: string; hidden: boolean; pii: boolean }
export interface ColumnPolicyTable { table: string; label: string; columns: ColumnPolicyColumn[] }

export async function getColumnPolicy(): Promise<ColumnPolicyTable[]> {
  return authFetch('/api/dashboards/column-policy')
    .then((r) => okJson<{ tables: ColumnPolicyTable[] }>(r, 'load column policy'))
    .then((b) => b.tables);
}

export async function saveColumnPolicy(payload: Record<string, string[]>): Promise<void> {
  const r = await authFetch('/api/dashboards/column-policy', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  await okJson(r, 'save column policy');
}
```

(Match the exact `authFetch` options signature used by `saveDashboard` at line ~333.)

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @openldr/studio exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/src/api.ts
git commit -m "feat(studio): column-policy API client"
```

---

### Task 9: Settings → Data Exposure page

New page + sub-nav entry + route + i18n. Follows house conventions: edge-to-edge, ⋯-dots menu for Save/Discard, one collapsible section per table, PII badge + un-hide confirm.

**Files:**
- Create: `apps/studio/src/pages/settings/DataExposure.tsx`
- Modify: `apps/studio/src/pages/settings/SettingsShell.tsx` (SUB_NAV entry)
- Modify: `apps/studio/src/App.tsx` (nested route + parent-gate cap array)
- Modify: `apps/studio/src/i18n/locales/{en,fr,pt}.json` (or wherever the translation JSON lives — grep `settings.subNav.general`)
- Test: `apps/studio/src/pages/settings/DataExposure.test.tsx`

**Interfaces:**
- Consumes: `getColumnPolicy`, `saveColumnPolicy`, `type ColumnPolicyTable` (Task 8); `useAuth().hasCapability`.

- [ ] **Step 1: Write the failing test**

Create `apps/studio/src/pages/settings/DataExposure.test.tsx` (mirror `Connectors.test.tsx` render/mocking harness):

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DataExposure } from './DataExposure';
import * as api from '@/api';

vi.spyOn(api, 'getColumnPolicy').mockResolvedValue([
  { table: 'patients', label: 'Patient', columns: [
    { name: 'sex', hidden: false, pii: false },
    { name: 'national_id', hidden: true, pii: true },
  ] },
]);

it('renders a PII badge and asks to confirm when un-hiding PII', async () => {
  render(<DataExposure />);
  await waitFor(() => screen.getByText('national_id'));
  expect(screen.getByText(/PII/i)).toBeInTheDocument();
  // toggling national_id from hidden->shown opens a confirm dialog
  fireEvent.click(screen.getByLabelText('toggle national_id'));
  expect(await screen.findByRole('dialog')).toHaveTextContent(/national_id/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/pages/settings/DataExposure.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the page**

Create `apps/studio/src/pages/settings/DataExposure.tsx`. Copy the scaffold of an existing settings sibling (`Connectors.tsx`) for the header + ⋯-dots menu + loading/empty states. Structure:

- Load with `getColumnPolicy()` into state on mount (use the existing data-loading hook/pattern in `Connectors.tsx`).
- Local editable copy: `Map<table, Set<hiddenColumn>>`; `dirty` flag.
- Render each table as a collapsible section (use the existing collapsible/section primitive; grep for one used elsewhere). Each column row: label (with a red PII `Badge` when `pii`), and a shadcn `Switch` labeled "Shown/Hidden" — `aria-label={`toggle ${name}`}`. Shown = NOT hidden.
- Toggling a PII column from hidden→shown opens a shadcn confirm `Dialog` naming the column and the exposure risk; confirm applies, cancel reverts.
- Header ⋯ `DropdownMenu`: **Save** → `saveColumnPolicy(Object.fromEntries([...map].map(([t, set]) => [t, [...set]])))` then toast + clear dirty; **Discard** → reload from server.
- All strings via `useTranslation()` under `settings.dataExposure.*`.

(No standalone footer buttons — Save/Discard live in the ⋯ menu, per house convention.)

- [ ] **Step 4: Wire the sub-nav + route + i18n**

In `apps/studio/src/pages/settings/SettingsShell.tsx`, add to `SUB_NAV` (after `roles`):

```ts
{ labelKey: 'settings.subNav.dataExposure', to: '/settings/data-exposure', caps: ['data_exposure.manage'] },
```

In `apps/studio/src/App.tsx`:
- Add `import { DataExposure } from '@/pages/settings/DataExposure';`
- Add `'data_exposure.manage'` to the parent `/settings` `RequireCapability caps={[...]}` array (line ~56).
- Add the child route after `roles`:

```tsx
<Route path="data-exposure" element={<RequireCapability cap="data_exposure.manage"><DataExposure /></RequireCapability>} />
```

In the translation JSON files (en/fr/pt), add `settings.subNav.dataExposure` and the `settings.dataExposure.*` keys (title, description, save, discard, shown, hidden, piiBadge, confirmTitle, confirmBody). English values written out; fr/pt translated.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/pages/settings/DataExposure.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/pages/settings/DataExposure.tsx apps/studio/src/pages/settings/DataExposure.test.tsx apps/studio/src/pages/settings/SettingsShell.tsx apps/studio/src/App.tsx apps/studio/src/i18n
git commit -m "feat(studio): Settings -> Data Exposure page"
```

---

### Task 10: CLI parity

`openldr data-exposure list|hide|show`.

**Files:**
- Create: `packages/cli/src/data-exposure.ts`
- Modify: `packages/cli/src/index.ts` (import + `program.command('data-exposure')` group)
- Test: `packages/cli/src/data-exposure.test.ts`

**Interfaces:**
- Consumes: `createAppContext`, `loadConfig`, `cliActor`; `ctx.dashboards.columnPolicy`.
- Produces: `runDataExposureList(opts)`, `runDataExposureHide(table, columns, opts)`, `runDataExposureShow(table, columns, opts)`.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/data-exposure.test.ts` (mirror `settings.test.ts` harness that stubs `createAppContext`):

```ts
import { describe, it, expect, vi } from 'vitest';
// stub @openldr/bootstrap createAppContext to a fake ctx exposing dashboards.columnPolicy
// (copy the mocking approach from settings.test.ts)
import { runDataExposureHide } from './data-exposure';

it('hide adds columns to a table policy', async () => {
  const replaceTable = vi.fn();
  // ...wire ctx.dashboards.columnPolicy = { listHidden: async () => ({ patients: [] }), replaceTable, load: async () => new Map() }
  const code = await runDataExposureHide('patients', ['national_id'], { json: false });
  expect(code).toBe(0);
  expect(replaceTable).toHaveBeenCalledWith('patients', expect.arrayContaining(['national_id']), expect.anything());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/cli exec vitest run src/data-exposure.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the CLI**

Create `packages/cli/src/data-exposure.ts` (mirror `roles.ts` structure — `createAppContext`/`loadConfig`/`ctx.close()`):

```ts
import { createAppContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { cliActor } from './cli-actor';

interface JsonOpt { json: boolean }
function emit(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? JSON.stringify(payload, null, 2) + '\n' : human + '\n');
}

export async function runDataExposureList(opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const hidden = await ctx.dashboards.columnPolicy.listHidden();
    emit(opts.json, hidden, Object.entries(hidden).map(([t, cols]) => `${t}\t${cols.join(', ')}`).join('\n') || '(no hidden columns)');
    return 0;
  } finally { await ctx.close(); }
}

async function mutate(table: string, columns: string[], hide: boolean, opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const hidden = await ctx.dashboards.columnPolicy.listHidden();
    const set = new Set(hidden[table] ?? []);
    for (const c of columns) hide ? set.add(c) : set.delete(c);
    await ctx.dashboards.columnPolicy.replaceTable(table, [...set], cliActor());
    await ctx.dashboards.reloadColumnPolicy();
    emit(opts.json, { table, hidden: [...set] }, `${table} hidden: ${[...set].join(', ') || '(none)'}`);
    return 0;
  } finally { await ctx.close(); }
}

export const runDataExposureHide = (table: string, columns: string[], opts: JsonOpt) => mutate(table, columns, true, opts);
export const runDataExposureShow = (table: string, columns: string[], opts: JsonOpt) => mutate(table, columns, false, opts);
```

In `packages/cli/src/index.ts`, add the import and command group (mirror the `roles` group at line ~171):

```ts
import { runDataExposureList, runDataExposureHide, runDataExposureShow } from './data-exposure';

const de = program.command('data-exposure').description('Column exposure policy for dashboards/queries/reports');
de.command('list').description('List hidden columns per table').option('--json', 'emit JSON', false)
  .action((opts) => runDataExposureList(opts).then((c) => process.exit(c)));
de.command('hide <table> <columns...>').description('Hide columns from analytics').option('--json', 'emit JSON', false)
  .action((table, columns, opts) => runDataExposureHide(table, columns, opts).then((c) => process.exit(c)));
de.command('show <table> <columns...>').description('Expose columns to analytics').option('--json', 'emit JSON', false)
  .action((table, columns, opts) => runDataExposureShow(table, columns, opts).then((c) => process.exit(c)));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/cli exec vitest run src/data-exposure.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/data-exposure.ts packages/cli/src/data-exposure.test.ts packages/cli/src/index.ts
git commit -m "feat(cli): data-exposure list/hide/show commands"
```

---

### Task 11: Full gate + manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full turbo gate**

Run: `pnpm turbo run typecheck test build`
Expected: PASS across all packages. (Watch for the known flakes noted in repo conventions — re-run the flaky package once if it trips, don't "fix" it.)

- [ ] **Step 2: Manual live check**

Bring up the dev stack, sign in as an admin, and verify:
1. Settings shows a **Data Exposure** entry; a non-admin (no `data_exposure.manage`) does not see it and `/settings/data-exposure` bounces.
2. `patients.national_id` shows hidden + PII badge. Un-hiding it prompts a confirm.
3. Un-hide `national_id`, Save. Open the dashboard widget builder → add a Patient join → `national_id` now appears as an exposable column. Re-hide it → it disappears. (This proves the cache reload + end-to-end enforcement.)
4. `openldr data-exposure list` reflects the same state; `openldr data-exposure hide patients national_id` re-hides it and the builder loses the column on next load.
5. Check the audit log for a `data_exposure.policy.updated` event after a UI save.

- [ ] **Step 3: Commit any doc/screenshot updates** (if applicable), otherwise done.

---

## Self-Review

**Spec coverage:**
- Data model / table → Task 3. Seed-from-union → Task 4 (`seedColumnExposurePolicy`) + verified constant in Task 1. Fallback → Task 1 (`hiddenFor`). ✓
- Enforcement threading (six functions + compile path) → Tasks 1–2. In-memory cache + reload → Task 5. ✓
- API GET/PUT + audit → Task 7. RBAC cap → Task 6. UI page → Task 9. PII badge/confirm → Tasks 1 (`PII_COLUMNS`), 7 (flag), 9 (UI). CLI parity → Task 10. ✓
- No-floor / new-column-exposure risks → encoded as exposed-by-default behavior (Task 1) + validated in tests. ✓

**Placeholder scan:** No "TBD"/"handle edge cases"/uncoded steps. Every code step shows code. Grep-to-confirm notes (e.g. exact translation-JSON path, `authFetch` options shape, DB test helper) are explicit lookups, not deferred work.

**Type consistency:** `ColumnPolicy = Map<string, Set<string>>` used identically in Tasks 1/2/4/5. `ColumnPolicyStore` (`load`/`listHidden`/`replaceTable`) consistent across Tasks 4/5/7/10. `reloadColumnPolicy`/`columnPolicy` consistent on `DashboardsApi` across Tasks 5/7/10. Route DTO (`tables[].columns[].{name,hidden,pii}`) consistent across Tasks 7/8/9. ✓

**Behavior-change callouts (intentional, in-plan):** (a) optional-join fail-safe-closed → exposed-by-default (Task 1 test updates); (b) `source_system` tightened in the arbitrary-join universe via the union seed (Task 1 constant); (c) allowlist mode removed (Task 1). All owner-approved in the spec.
