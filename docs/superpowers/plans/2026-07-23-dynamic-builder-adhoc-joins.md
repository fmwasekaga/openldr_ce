# Dynamic Widget Builder + Ad-hoc Join Columns — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the fixed-section widget builder into a dynamic clause builder (pinned Source/Summarize + an "Add" menu of removable, separated clauses), and add a power-user "join column" escape hatch that surfaces a column from an admin-declared *optional* join (any column minus a per-join denylist).

**Architecture:** Ad-hoc join columns are modeled as extra `ModelDimension`s carried on the builder query (`adhocDimensions[]`) and merged into the model via a single new `effectiveModel()` seam in the compiler — so the existing `dim()` / `colName()` / `collectUsedJoins()` → `leftJoin` machinery works unchanged. The server exposes only denylist-filtered columns to the client (`modelsForClient()`), so denied PII column names never reach the browser. The compiler independently validates every ad-hoc dim against the optional-join + denylist rules (defense in depth against hand-edited widget JSON).

**Tech Stack:** TypeScript, Zod (query schema), Kysely (`packages/dashboards` compiler), React + shadcn/ui (`apps/studio` builder), Vitest.

**Spec:** [docs/superpowers/specs/2026-07-23-dynamic-builder-adhoc-joins-design.md](../specs/2026-07-23-dynamic-builder-adhoc-joins-design.md)

---

## File Structure

**Server / shared (`packages/`)**
- `packages/dashboards/src/models/registry.ts` — extend `ModelJoin` (`optional`, `denyColumns`, `label?`); add `exposableColumns()` + `modelsForClient()`; add one demo optional join to the `service_requests` model.
- `packages/dashboards/src/models/registry.test.ts` — tests for the two helpers + fail-safe rule.
- `packages/dashboards/src/types.ts` — `AdhocDimensionSchema` + `adhocDimensions` on the builder `WidgetQuerySchema`.
- `packages/dashboards/src/compile.ts` — `effectiveModel()` (validate + merge); call it at the top of `compileBuilderQuery`, `runBuilderQuery`, `runWideQuery`.
- `packages/dashboards/src/compile.test.ts` — merge, auto-join, and rejection tests.
- `packages/bootstrap/src/index.ts` — `DashboardsApi.models` returns the client projection.

**Studio (`apps/studio/`)**
- `apps/studio/src/api.ts` — add `adhocDimensions` to the builder `WidgetQuery`; add `optionalJoins` to `QueryModel`.
- `apps/studio/src/dashboard/editor/builderForm.model.ts` — `addAdhocDimensionPatch` / `removeAdhocDimensionPatch`; clear ad-hoc on model switch; orphan cleanup.
- `apps/studio/src/dashboard/editor/builderForm.model.test.ts` — patch tests.
- `apps/studio/src/dashboard/editor/JoinColumnPicker.tsx` — the 3-step picker (new).
- `apps/studio/src/dashboard/editor/JoinColumnPicker.test.tsx` — picker tests (new).
- `apps/studio/src/dashboard/editor/BuilderForm.tsx` — restructure to core + Add menu + removable ad-hoc sections.
- `apps/studio/src/dashboard/editor/BuilderForm.test.tsx` — extend for the Add menu + ad-hoc flow.

Build order is server-first (Tasks 1–5) so the studio (Tasks 6–9) builds against real types.

---

## Task 1: Registry — extend `ModelJoin` and add `exposableColumns()`

**Files:**
- Modify: `packages/dashboards/src/models/registry.ts`
- Test: `packages/dashboards/src/models/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/dashboards/src/models/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { exposableColumns, type QueryModel } from './registry';

const MODEL_WITH_OPTIONAL: QueryModel = {
  id: 'm', label: 'M', table: 'lab_requests',
  dimensions: [],
  metrics: [{ key: 'count', label: 'Count', agg: 'count' }],
  joins: [
    { table: 'patients', alias: 'jp', left: 'patient_id', right: 'id',
      optional: true, denyColumns: ['surname', 'firstname', 'national_id', 'phone', 'email', 'patient_guid', 'date_of_birth'] },
    { table: 'facilities', alias: 'jf', left: 'facility_id', right: 'id', optional: true }, // no denyColumns → unavailable
    { table: 'patients', alias: 'jauto', left: 'patient_id', right: 'id' },                 // not optional
  ],
};

describe('exposableColumns', () => {
  it('returns table columns minus denyColumns for a configured optional join', () => {
    const cols = exposableColumns(MODEL_WITH_OPTIONAL, 'jp');
    expect(cols).toContain('managing_organization');
    expect(cols).toContain('sex');
    expect(cols).not.toContain('surname');
    expect(cols).not.toContain('national_id');
  });

  it('fail-safe: an optional join with NO denyColumns exposes nothing', () => {
    expect(exposableColumns(MODEL_WITH_OPTIONAL, 'jf')).toEqual([]);
  });

  it('returns [] for a non-optional join alias', () => {
    expect(exposableColumns(MODEL_WITH_OPTIONAL, 'jauto')).toEqual([]);
  });

  it('returns [] for an unknown alias', () => {
    expect(exposableColumns(MODEL_WITH_OPTIONAL, 'nope')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/dashboards test -- registry.test.ts`
Expected: FAIL — `exposableColumns` is not exported.

- [ ] **Step 3: Implement**

In `packages/dashboards/src/models/registry.ts`, add `EXTERNAL_TABLE_COLUMNS` to the existing import from `@openldr/db`:

```ts
import { type ExternalSchema, EXTERNAL_TABLE_COLUMNS } from '@openldr/db';
```

Extend the `ModelJoin` interface (add the three optional fields):

```ts
export interface ModelJoin {
  table: keyof ExternalSchema;
  alias: string;
  left: string;
  leftReplace?: [string, string];
  right: string;
  optional?: boolean;      // offered in the "+ Add → Join column" picker instead of firing via a default dimension
  label?: string;          // display name for the join in the picker (defaults to the table name)
  denyColumns?: string[];  // columns that may NOT be exposed; REQUIRED for an optional join to be usable (fail-safe)
}
```

At the bottom of the file (after `getModel`), add:

```ts
/**
 * Columns a power user may expose from an OPTIONAL join, i.e. the joined table's columns minus the
 * join's `denyColumns`. Fail-safe: an optional join with no `denyColumns` declared exposes nothing
 * (returns []), so a newly added join never leaks columns until an admin declares its denylist.
 * Non-optional / unknown aliases return [] — only optional joins are user-selectable.
 */
export function exposableColumns(model: QueryModel, alias: string): string[] {
  const j = (model.joins ?? []).find((x) => x.alias === alias);
  if (!j || !j.optional || !j.denyColumns) return [];
  const deny = new Set(j.denyColumns);
  return EXTERNAL_TABLE_COLUMNS[j.table].filter((c) => !deny.has(c));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/dashboards test -- registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/models/registry.ts packages/dashboards/src/models/registry.test.ts
git commit -m "feat(dashboards): optional joins + exposableColumns() with fail-safe denylist"
```

---

## Task 2: Registry — demo optional join + `modelsForClient()` projection

**Files:**
- Modify: `packages/dashboards/src/models/registry.ts`
- Test: `packages/dashboards/src/models/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/dashboards/src/models/registry.test.ts`:

```ts
import { modelsForClient, getModel } from './registry';

describe('service_requests demo optional join', () => {
  it('declares an optional patients join with a PII denylist', () => {
    const j = (getModel('service_requests')!.joins ?? []).find((x) => x.alias === 'jp');
    expect(j?.optional).toBe(true);
    expect(j?.denyColumns).toEqual(expect.arrayContaining(['surname', 'firstname', 'national_id']));
  });
});

describe('modelsForClient', () => {
  it('projects optional joins to {alias,label,exposableColumns} and omits raw joins/denyColumns', () => {
    const m = modelsForClient().find((x) => x.id === 'service_requests')!;
    expect((m as Record<string, unknown>).joins).toBeUndefined();
    const oj = m.optionalJoins!.find((x) => x.alias === 'jp')!;
    expect(oj.label).toBe('Patient');
    expect(oj.exposableColumns).toContain('managing_organization');
    expect(oj.exposableColumns).not.toContain('surname'); // denied names never reach the client
  });

  it('omits optionalJoins for models without optional joins', () => {
    const m = modelsForClient().find((x) => x.id === 'diagnostic_reports')!;
    expect(m.optionalJoins).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/dashboards test -- registry.test.ts`
Expected: FAIL — `modelsForClient` not exported; `service_requests` has no `jp` join.

- [ ] **Step 3: Implement**

In `registry.ts`, add a `joins` array to the **`service_requests`** model object (it currently has none). Insert it right after the `table: 'lab_requests',` line of that model:

```ts
    joins: [
      { table: 'patients', alias: 'jp', left: 'patient_id', right: 'id', optional: true, label: 'Patient',
        denyColumns: ['id', 'patient_guid', 'surname', 'firstname', 'national_id', 'phone', 'email', 'date_of_birth',
                      'replaced_by_id', 'plugin_id', 'plugin_version', 'batch_id'] },
    ],
```

Then add the client projection type + function at the bottom of the file:

```ts
export interface ClientOptionalJoin { alias: string; label: string; exposableColumns: string[] }
export interface ClientQueryModel {
  id: string; label: string; table: keyof ExternalSchema;
  dimensions: ModelDimension[]; metrics: ModelMetric[];
  optionalJoins?: ClientOptionalJoin[];
}

/**
 * Model list shaped for the browser. Raw `joins`/`denyColumns` are dropped; each usable optional
 * join becomes `{ alias, label, exposableColumns }` where the columns are already denylist-filtered,
 * so denied PII column names never travel to the client. A join whose `exposableColumns` is empty
 * (fail-safe: no denylist declared) is omitted entirely.
 */
export function modelsForClient(): ClientQueryModel[] {
  return MODELS.map((m) => {
    const optionalJoins = (m.joins ?? [])
      .filter((j) => j.optional)
      .map((j) => ({ alias: j.alias, label: j.label ?? String(j.table), exposableColumns: exposableColumns(m, j.alias) }))
      .filter((oj) => oj.exposableColumns.length > 0);
    const { id, label, table, dimensions, metrics } = m;
    return optionalJoins.length ? { id, label, table, dimensions, metrics, optionalJoins }
                                : { id, label, table, dimensions, metrics };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/dashboards test -- registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/models/registry.ts packages/dashboards/src/models/registry.test.ts
git commit -m "feat(dashboards): demo optional patients join + modelsForClient() PII-safe projection"
```

---

## Task 3: Query schema — `adhocDimensions` on the builder query

**Files:**
- Modify: `packages/dashboards/src/types.ts`
- Test: `packages/dashboards/src/types.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/dashboards/src/types.test.ts`:

```ts
import { WidgetQuerySchema } from './types';

describe('builder adhocDimensions', () => {
  const base = { mode: 'builder' as const, model: 'service_requests', metric: { key: 'count', agg: 'count' as const }, filters: [] };

  it('accepts a well-formed adhoc dimension', () => {
    const parsed = WidgetQuerySchema.parse({
      ...base,
      adhocDimensions: [{ key: 'jp__sex', label: 'Patient Sex', join: 'jp', column: 'sex', kind: 'string' }],
    });
    expect(parsed.mode).toBe('builder');
    if (parsed.mode === 'builder') expect(parsed.adhocDimensions?.[0].column).toBe('sex');
  });

  it('rejects an adhoc dimension with an invalid kind', () => {
    expect(() => WidgetQuerySchema.parse({
      ...base,
      adhocDimensions: [{ key: 'x', label: 'X', join: 'jp', column: 'sex', kind: 'boolean' }],
    })).toThrow();
  });

  it('omits the field cleanly when absent', () => {
    const parsed = WidgetQuerySchema.parse(base);
    if (parsed.mode === 'builder') expect(parsed.adhocDimensions).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/dashboards test -- types.test.ts`
Expected: FAIL — the first test's `adhocDimensions` is stripped/ignored (assertion on `.column` fails) and the invalid-kind case does not throw.

- [ ] **Step 3: Implement**

In `packages/dashboards/src/types.ts`, add the schema just above `WidgetQuerySchema` (after `DimensionRefSchema`):

```ts
// A user-authored dimension backed by a column from an OPTIONAL join (the "join column" escape hatch).
// `key` is a query-local identifier; group-by/breakdown/filter reference it like any dimension key.
export const AdhocDimensionSchema = z.object({
  key: z.string(),
  label: z.string(),
  join: z.string(),
  column: z.string(),
  kind: z.enum(['string', 'date', 'number']),
});
export type AdhocDimension = z.infer<typeof AdhocDimensionSchema>;
```

Then add one line inside the `mode: 'builder'` object in `WidgetQuerySchema`, right after the `filterTree` line:

```ts
    adhocDimensions: z.array(AdhocDimensionSchema).optional(), // "join column" escape-hatch dimensions
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/dashboards test -- types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/types.ts packages/dashboards/src/types.test.ts
git commit -m "feat(dashboards): adhocDimensions on the builder query schema"
```

---

## Task 4: Compiler — `effectiveModel()` (validate + merge) and wire it in

**Files:**
- Modify: `packages/dashboards/src/compile.ts`
- Test: `packages/dashboards/src/compile.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/dashboards/src/compile.test.ts` (this file already imports `getModel` and exercises `compileBuilderQuery` — reuse its existing db/compile helpers; the snippet below uses `effectiveModel` directly plus a compile assertion):

```ts
import { effectiveModel, compileBuilderQuery } from './compile';
import { getModel } from './models/registry';

const SR = () => getModel('service_requests')!;
const q = (over: Record<string, unknown>) => ({
  mode: 'builder' as const, model: 'service_requests',
  metric: { key: 'count', agg: 'count' as const }, filters: [], ...over,
});

describe('effectiveModel', () => {
  it('merges a valid adhoc dimension into the model dimensions', () => {
    const em = effectiveModel(SR(), q({
      adhocDimensions: [{ key: 'jp__sex', label: 'Patient Sex', join: 'jp', column: 'sex', kind: 'string' }],
    }));
    expect(em.dimensions.find((d) => d.key === 'jp__sex')).toMatchObject({ column: 'sex', join: 'jp' });
  });

  it('is a no-op (same reference) when there are no adhoc dimensions', () => {
    const m = SR();
    expect(effectiveModel(m, q({}))).toBe(m);
  });

  it('rejects an adhoc dimension on a non-optional / unknown join', () => {
    expect(() => effectiveModel(SR(), q({
      adhocDimensions: [{ key: 'x', label: 'X', join: 'nope', column: 'sex', kind: 'string' }],
    }))).toThrow(/join/i);
  });

  it('rejects an adhoc dimension whose column is denied or not exposable', () => {
    expect(() => effectiveModel(SR(), q({
      adhocDimensions: [{ key: 'x', label: 'X', join: 'jp', column: 'surname', kind: 'string' }],
    }))).toThrow(/column/i);
  });
});

describe('compileBuilderQuery with an adhoc join column', () => {
  it('adds the LEFT JOIN and groups by the joined column', () => {
    const em = q({
      adhocDimensions: [{ key: 'jp__sex', label: 'Patient Sex', join: 'jp', column: 'sex', kind: 'string' }],
      dimension: { key: 'jp__sex' },
    });
    const sql = compileBuilderQuery(makeDb(), getModel('service_requests')!, em).compile().sql;
    expect(sql).toMatch(/left join .*patients/i);
    expect(sql).toMatch(/jp"?\."?sex/i);
  });
});
```

> Note: `makeDb()` above stands in for whatever Kysely test instance `compile.test.ts` already constructs — reuse the existing helper in that file rather than adding a new one.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/dashboards test -- compile.test.ts`
Expected: FAIL — `effectiveModel` is not exported; the compile assertion errors on `unknown dimension: jp__sex`.

- [ ] **Step 3: Implement**

In `packages/dashboards/src/compile.ts`:

Add `exposableColumns` to the registry import:

```ts
import type { QueryModel, ModelDimension, ModelJoin } from './models/registry';
import { exposableColumns } from './models/registry';
```

Add `effectiveModel` just above `collectUsedJoins`:

```ts
/**
 * Fold a query's ad-hoc join columns into the model as real dimensions, so the rest of the compiler
 * (dim/colName/collectUsedJoins → leftJoin) treats them like any joined dimension. Validates each
 * ad-hoc dim against the optional-join + denylist rules — this is the server-side guard that stops a
 * hand-edited widget JSON from exposing a denied or foreign column. No-op (returns the same model)
 * when the query has no ad-hoc dimensions.
 */
export function effectiveModel(model: QueryModel, q: BuilderQuery): QueryModel {
  const adhoc = q.adhocDimensions ?? [];
  if (adhoc.length === 0) return model;
  const existing = new Set(model.dimensions.map((d) => d.key));
  const extra: ModelDimension[] = [];
  for (const a of adhoc) {
    const j = (model.joins ?? []).find((x) => x.alias === a.join);
    if (!j || !j.optional) throw new Error(`adhoc dimension ${a.key}: unknown or non-optional join: ${a.join}`);
    if (!exposableColumns(model, a.join).includes(a.column)) {
      throw new Error(`adhoc dimension ${a.key}: column not exposable: ${a.column}`);
    }
    if (existing.has(a.key)) continue; // idempotent: safe to call on an already-merged model
    extra.push({ key: a.key, label: a.label, column: a.column, kind: a.kind, join: a.join });
  }
  return extra.length ? { ...model, dimensions: [...model.dimensions, ...extra] } : model;
}
```

Wire it in at the top of each public entry point (shadow the `model` param so all downstream calls use the merged model):

In `compileBuilderQuery`, make the first line:

```ts
export function compileBuilderQuery(db: Kysely<ExternalSchema>, model: QueryModel, q: BuilderQuery): AnyQB {
  model = effectiveModel(model, q);
  const wide = !!(q.metrics && q.metrics.length > 0);
```

In `runBuilderQuery`, add as the first line of the body:

```ts
export async function runBuilderQuery(
  db: Kysely<ExternalSchema>, model: QueryModel, q: BuilderQuery,
): Promise<ReportResultData> {
  model = effectiveModel(model, q);
  if (q.metrics && q.metrics.length > 0) return runWideQuery(db, model, q);
```

In `runWideQuery`, add as the first line of the body:

```ts
async function runWideQuery(
  db: Kysely<ExternalSchema>, model: QueryModel, q: BuilderQuery,
): Promise<ReportResultData> {
  model = effectiveModel(model, q);
  const metrics = q.metrics!;
```

(`effectiveModel` is idempotent, so the nested `runWideQuery`/`compileBuilderQuery` calls re-applying it are harmless.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/dashboards test -- compile.test.ts`
Expected: PASS. Also run the full package to confirm no regression: `pnpm --filter @openldr/dashboards test` (recognizer corpus + existing compile tests stay green because the query shape is unchanged when `adhocDimensions` is absent).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/compile.ts packages/dashboards/src/compile.test.ts
git commit -m "feat(dashboards): effectiveModel() merges + validates adhoc join columns"
```

---

## Task 5: Bootstrap — serve the client model projection

**Files:**
- Modify: `packages/bootstrap/src/index.ts:95` (the `DashboardsApi.models` type) and `packages/bootstrap/src/index.ts:506` (the `dashboards` object)
- Test: `apps/server/src/dashboards-routes.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/server/src/dashboards-routes.test.ts` (this file already sets up an app + calls `/api/dashboards/models`; add one assertion-focused case using the existing harness):

```ts
it('GET /api/dashboards/models returns optionalJoins with denylist-filtered columns and no raw joins', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/dashboards/models', headers: authHeaders });
  expect(res.statusCode).toBe(200);
  const models = res.json() as Array<Record<string, any>>;
  const sr = models.find((m) => m.id === 'service_requests')!;
  expect(sr.joins).toBeUndefined();
  const jp = sr.optionalJoins.find((j: any) => j.alias === 'jp');
  expect(jp.label).toBe('Patient');
  expect(jp.exposableColumns).toContain('managing_organization');
  expect(jp.exposableColumns).not.toContain('surname');
});
```

> Reuse whatever `app` / `authHeaders` the surrounding `describe` already builds; do not add a new fixture.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server test -- dashboards-routes.test.ts`
Expected: FAIL — response still includes raw `joins` and no `optionalJoins`.

- [ ] **Step 3: Implement**

In `packages/bootstrap/src/index.ts`:

Update the import from `@openldr/dashboards` to include `modelsForClient` and its type (add to the existing import list):

```ts
import { /* …existing… */ modelsForClient, type ClientQueryModel } from '@openldr/dashboards';
```

Change the `DashboardsApi` interface member (line ~95) from:

```ts
  models(): ReturnType<typeof listModels>;
```

to:

```ts
  models(): ClientQueryModel[];
```

Change the `dashboards` object (line ~506) from `models: () => listModels()` to:

```ts
  const dashboards: DashboardsApi = { store: dashboardStore, models: () => modelsForClient(), query: runDashboardQuery, compileSql: compileDashboardSql };
```

(Leave `runDashboardQuery` / `compileDashboardSql` on the full `getModel()` server-side path — they must keep the real `joins`/`denyColumns` for validation. If `listModels` is now unused in this file after the change, remove it from the import to satisfy lint.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/server test -- dashboards-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/index.ts apps/server/src/dashboards-routes.test.ts
git commit -m "feat(bootstrap): serve client model projection (optionalJoins) from /models"
```

---

## Task 6: Studio API types — `adhocDimensions` + `optionalJoins`

**Files:**
- Modify: `apps/studio/src/api.ts:267-289`

- [ ] **Step 1: (types-only task — no unit test)**

This task changes TypeScript types only; there is no runtime behavior to unit-test. Verification is the type-check in Step 4. Skip Step 2.

- [ ] **Step 3: Implement**

In `apps/studio/src/api.ts`, in the `mode: 'builder'` branch of `WidgetQuery` (after the `limit?: number;` line), add:

```ts
      adhocDimensions?: { key: string; label: string; join: string; column: string; kind: 'string' | 'date' | 'number' }[];
```

And extend `QueryModel` (line ~289) to carry the optional-join projection:

```ts
export interface ClientOptionalJoin { alias: string; label: string; exposableColumns: string[] }
export interface QueryModel { id: string; label: string; dimensions: ModelDimension[]; metrics: ModelMetric[]; optionalJoins?: ClientOptionalJoin[] }
```

- [ ] **Step 4: Type-check**

Run: `pnpm --filter @openldr/studio exec tsc --noEmit`
Expected: PASS (no type errors introduced).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/api.ts
git commit -m "feat(studio): types for adhocDimensions + model optionalJoins"
```

---

## Task 7: Builder model helpers — ad-hoc patches + cleanup

**Files:**
- Modify: `apps/studio/src/dashboard/editor/builderForm.model.ts`
- Test: `apps/studio/src/dashboard/editor/builderForm.model.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/studio/src/dashboard/editor/builderForm.model.test.ts`:

```ts
import { addAdhocDimensionPatch, removeAdhocDimensionPatch, setModelPatch, setDimensionPatch } from './builderForm.model';

const baseQ = () => ({
  mode: 'builder' as const, model: 'service_requests',
  metric: { key: 'count', agg: 'count', label: 'Count' }, filters: [],
});
const adhoc = { key: 'jp__sex', label: 'Patient Sex', join: 'jp', column: 'sex', kind: 'string' as const };

describe('adhoc dimension patches', () => {
  it('adds an adhoc dimension', () => {
    const next = addAdhocDimensionPatch(baseQ(), adhoc);
    expect(next.adhocDimensions).toEqual([adhoc]);
  });

  it('removes an adhoc dimension and clears any group-by that referenced it', () => {
    let q = addAdhocDimensionPatch(baseQ(), adhoc);
    q = setDimensionPatch(q, 'jp__sex');
    const next = removeAdhocDimensionPatch(q, 'jp__sex');
    expect(next.adhocDimensions).toEqual([]);
    expect(next.dimension).toBeUndefined();       // orphan cleanup
  });

  it('drops the adhocDimensions field when the list becomes empty', () => {
    const q = addAdhocDimensionPatch(baseQ(), adhoc);
    const next = removeAdhocDimensionPatch(q, 'jp__sex');
    expect('adhocDimensions' in next ? next.adhocDimensions?.length : 0).toBe(0);
  });

  it('clears adhoc dimensions when the source model changes', () => {
    const models = [
      { id: 'service_requests', label: 'Test Orders', dimensions: [], metrics: [{ key: 'count', label: 'Count', agg: 'count' }] },
      { id: 'observations', label: 'Results', dimensions: [], metrics: [{ key: 'count', label: 'Count', agg: 'count' }] },
    ] as never;
    const q = addAdhocDimensionPatch(baseQ(), adhoc);
    const next = setModelPatch(models, q, 'observations');
    expect(next.adhocDimensions).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- builderForm.model.test.ts`
Expected: FAIL — `addAdhocDimensionPatch` / `removeAdhocDimensionPatch` not exported; `setModelPatch` does not clear `adhocDimensions`.

- [ ] **Step 3: Implement**

In `apps/studio/src/dashboard/editor/builderForm.model.ts`:

Add an `AdhocDimension` type near the top (after the `BuilderQuery` type alias):

```ts
export type AdhocDimension = { key: string; label: string; join: string; column: string; kind: 'string' | 'date' | 'number' };
```

Add `adhocDimensions: undefined` to the reset object returned by `setModelPatch` (it already resets `dimension`, `breakdown`, `filters`, `filterTree`):

```ts
  return {
    ...value,
    model: id,
    metric: m.metrics[0] ?? value.metric,
    metrics: undefined,
    dimension: undefined,
    breakdown: undefined,
    filters: [],
    filterTree: undefined,
    adhocDimensions: undefined,
  };
```

Add the two patch helpers (after `setMeasuresPatch`):

```ts
/** Append a "join column" ad-hoc dimension to the query. */
export function addAdhocDimensionPatch(value: BuilderQuery, dim: AdhocDimension): BuilderQuery {
  const list = [...((value.adhocDimensions as AdhocDimension[] | undefined) ?? []), dim];
  return { ...value, adhocDimensions: list as BuilderQuery['adhocDimensions'] };
}

/** Remove an ad-hoc dimension by key, dropping the field when empty and clearing any group-by/
 *  breakdown that referenced it (mirrors the derived-measure orphan cleanup in measures.model.ts). */
export function removeAdhocDimensionPatch(value: BuilderQuery, key: string): BuilderQuery {
  const list = ((value.adhocDimensions as AdhocDimension[] | undefined) ?? []).filter((d) => d.key !== key);
  const next = { ...value } as BuilderQuery;
  if (list.length) next.adhocDimensions = list as BuilderQuery['adhocDimensions'];
  else delete next.adhocDimensions;
  if (next.dimension?.key === key) next.dimension = undefined;
  if (next.breakdown?.key === key) next.breakdown = undefined;
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio test -- builderForm.model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/dashboard/editor/builderForm.model.ts apps/studio/src/dashboard/editor/builderForm.model.test.ts
git commit -m "feat(studio): adhoc dimension patch helpers + model-switch/orphan cleanup"
```

---

## Task 8: `JoinColumnPicker` component

**Files:**
- Create: `apps/studio/src/dashboard/editor/JoinColumnPicker.tsx`
- Test: `apps/studio/src/dashboard/editor/JoinColumnPicker.test.tsx`

The picker takes the model's `optionalJoins` and emits a finished `AdhocDimension` (with a generated unique `key`) on confirm. It is a controlled form: join → column → label/kind.

- [ ] **Step 1: Write the failing test**

Create `apps/studio/src/dashboard/editor/JoinColumnPicker.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { JoinColumnPicker, adhocKey } from './JoinColumnPicker';

const optionalJoins = [
  { alias: 'jp', label: 'Patient', exposableColumns: ['sex', 'managing_organization'] },
];

describe('adhocKey', () => {
  it('builds a stable join__column key', () => {
    expect(adhocKey('jp', 'sex')).toBe('jp__sex');
  });
});

describe('JoinColumnPicker', () => {
  it('emits an AdhocDimension with a default label when confirmed', () => {
    const onAdd = vi.fn();
    render(<JoinColumnPicker optionalJoins={optionalJoins} onAdd={onAdd} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('Column'), { target: { value: 'sex' } });
    fireEvent.click(screen.getByRole('button', { name: /add column/i }));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'jp__sex', join: 'jp', column: 'sex', kind: 'string', label: expect.any(String) }),
    );
  });
});
```

> If the shadcn `Select` used elsewhere in this folder does not fire on a raw `fireEvent.change` (Radix Select is not a native `<select>`), match the interaction pattern already used in `MeasuresEditor.test.tsx` / `BuilderForm.test.tsx` for choosing a Select option, and adjust these two `fireEvent` lines to that pattern. Verify by reading those sibling tests before writing.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- JoinColumnPicker.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `apps/studio/src/dashboard/editor/JoinColumnPicker.tsx`:

```tsx
import { useState } from 'react';
import type { ClientOptionalJoin } from '../../api';
import type { AdhocDimension } from './builderForm.model';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/** Query-local key for an ad-hoc join column. */
export function adhocKey(join: string, column: string): string { return `${join}__${column}`; }

// Columns that look like dates/numbers get a better default kind; everything else is a string.
function inferKind(column: string): AdhocDimension['kind'] {
  if (/(_at|_time|date|timestamp|issued|authored|received|effective)/i.test(column)) return 'date';
  if (/(count|value|amount|age|number|_id$)/i.test(column)) return 'number';
  return 'string';
}

const humanize = (column: string) => column.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function JoinColumnPicker({ optionalJoins, onAdd, onCancel }: {
  optionalJoins: ClientOptionalJoin[];
  onAdd: (dim: AdhocDimension) => void;
  onCancel: () => void;
}) {
  const [alias, setAlias] = useState(optionalJoins[0]?.alias ?? '');
  const [column, setColumn] = useState('');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<AdhocDimension['kind']>('string');
  const join = optionalJoins.find((j) => j.alias === alias);

  const pickColumn = (c: string) => {
    setColumn(c);
    setKind(inferKind(c));
    setLabel(`${join?.label ?? alias} → ${humanize(c)}`);
  };

  const confirm = () => {
    if (!alias || !column) return;
    onAdd({ key: adhocKey(alias, column), label: label || humanize(column), join: alias, column, kind });
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2 text-sm">
      <label>Join
        <Select value={alias} onValueChange={(a) => { setAlias(a); setColumn(''); setLabel(''); }}>
          <SelectTrigger aria-label="Join" className="mt-1 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {optionalJoins.map((j) => <SelectItem key={j.alias} value={j.alias}>{j.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>

      <label>Column
        <Select value={column} onValueChange={pickColumn}>
          <SelectTrigger aria-label="Column" className="mt-1 w-full"><SelectValue placeholder="Pick a column" /></SelectTrigger>
          <SelectContent>
            {(join?.exposableColumns ?? []).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>

      <label>Label
        <Input aria-label="Label" className="mt-1 h-8" value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>

      <label>Kind
        <Select value={kind} onValueChange={(k) => setKind(k as AdhocDimension['kind'])}>
          <SelectTrigger aria-label="Kind" className="mt-1 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="string">string</SelectItem>
            <SelectItem value="date">date</SelectItem>
            <SelectItem value="number">number</SelectItem>
          </SelectContent>
        </Select>
      </label>

      <div className="flex gap-2">
        <Button size="sm" disabled={!column} onClick={confirm}>Add column</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
```

> Before writing, confirm the exact import paths for `Button` (and that `Select`/`Input` match `BuilderForm.tsx`'s imports) by reading a sibling component in this folder. The Radix empty-value caveat noted in `BuilderForm.tsx` applies: never render a `SelectItem value=""` — `column` is `''` only as not-yet-chosen state, and no `SelectItem` uses `''`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio test -- JoinColumnPicker.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/dashboard/editor/JoinColumnPicker.tsx apps/studio/src/dashboard/editor/JoinColumnPicker.test.tsx
git commit -m "feat(studio): JoinColumnPicker for the join-column escape hatch"
```

---

## Task 9: `BuilderForm` — Add menu + removable ad-hoc sections

**Files:**
- Modify: `apps/studio/src/dashboard/editor/BuilderForm.tsx`
- Test: `apps/studio/src/dashboard/editor/BuilderForm.test.tsx`

Add a "+ Add" menu that offers "Join column" (only when `model.optionalJoins` exists), render added ad-hoc columns as removable chips, and make Group by / Breakdown option lists include the query's `adhocDimensions` alongside `model.dimensions`.

- [ ] **Step 1: Write the failing test**

Append to `apps/studio/src/dashboard/editor/BuilderForm.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BuilderForm } from './BuilderForm';

const models = [{
  id: 'service_requests', label: 'Test Orders',
  dimensions: [{ key: 'status', label: 'Status', column: 'status', kind: 'string' }],
  metrics: [{ key: 'count', label: 'Count', agg: 'count' }],
  optionalJoins: [{ alias: 'jp', label: 'Patient', exposableColumns: ['sex', 'managing_organization'] }],
}] as never;
const value = { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count', label: 'Count' }, filters: [] } as never;

describe('BuilderForm Add menu + join column', () => {
  it('offers "Join column" in the Add menu when the model has optional joins', () => {
    render(<BuilderForm models={models} value={value} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(screen.getByText(/join column/i)).toBeInTheDocument();
  });

  it('adds an adhoc dimension through the picker and emits it on change', () => {
    const onChange = vi.fn();
    render(<BuilderForm models={models} value={value} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    fireEvent.click(screen.getByText(/join column/i));
    fireEvent.change(screen.getByLabelText('Column'), { target: { value: 'sex' } });
    fireEvent.click(screen.getByRole('button', { name: /add column/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      adhocDimensions: [expect.objectContaining({ key: 'jp__sex', column: 'sex' })],
    }));
  });
});
```

> Adjust the two Select interactions to the same pattern the sibling tests use (see the note in Task 8 Step 1) if Radix Select does not respond to `fireEvent.change`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- BuilderForm.test.tsx`
Expected: FAIL — there is no "Add" button / "Join column" entry yet.

- [ ] **Step 3: Implement**

Edit `apps/studio/src/dashboard/editor/BuilderForm.tsx`:

1. Add imports (place the `Button`/menu imports next to the existing `@/components/ui/*` imports; confirm the dropdown-menu path exists — see step 4):

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { JoinColumnPicker } from './JoinColumnPicker';
```

Add `addAdhocDimensionPatch, removeAdhocDimensionPatch` to the existing `./builderForm.model` import list.

2. Compute the effective dimension option list (model dims + ad-hoc) once, near the top of the component body (after the existing `const model = …` / `const dim = …` lines):

```tsx
  const adhoc = (value.adhocDimensions ?? []) as { key: string; label: string; join: string; column: string; kind: 'string' | 'date' | 'number' }[];
  const dimOptions = [...(model?.dimensions ?? []), ...adhoc.map((a) => ({ key: a.key, label: a.label, kind: a.kind }))];
  const [showPicker, setShowPicker] = useState(false);
```

Replace both `model?.dimensions.map((d) => …)` blocks (the Group by `SelectContent` and the Breakdown `SelectContent`) with `dimOptions.map((d) => …)`. (Leave the Grain block keyed off `dim` as-is; ad-hoc columns are not date-grained in this iteration.)

3. Just before the final closing `</div>` of the returned form, add the ad-hoc chips + the Add control:

```tsx
      {adhoc.length > 0 && (
        <div className="text-sm">
          Join columns
          <div className="mt-1 flex flex-wrap gap-1">
            {adhoc.map((a) => (
              <span key={a.key} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
                {a.label}
                <button aria-label={`Remove ${a.label}`} onClick={() => onChange(removeAdhocDimensionPatch(value, a.key))}>×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="border-t pt-2">
        {!showPicker && (
          <Button size="sm" variant="outline" onClick={() => setShowPicker(true)} disabled={!model?.optionalJoins?.length}>
            ＋ Add
          </Button>
        )}
        {showPicker && model?.optionalJoins && (
          <JoinColumnPicker
            optionalJoins={model.optionalJoins}
            onAdd={(d) => { onChange(addAdhocDimensionPatch(value, d)); setShowPicker(false); }}
            onCancel={() => setShowPicker(false)}
          />
        )}
      </div>
```

> **Scope note:** this iteration adds the "+ Add" button (whose only entry today is Join column, opening the picker inline), the ad-hoc chips, and ad-hoc awareness in Group by / Breakdown. The test clicks a button named `/add/i` and then `/join column/i`; the simplest passing shape is a two-step: the "＋ Add" button reveals a small inline list containing a "Join column" item that opens the picker. If you prefer a real dropdown, wire `@/components/ui/dropdown-menu` (only if it already exists in the studio — search for an existing usage; do not add a new dependency) and keep the same accessible names. Converting the existing Filter/Group-by/Breakdown into fully removable add-on-demand sections is a deliberate **follow-up**, out of scope here to limit churn on the existing `BuilderForm.test.tsx` cases.

To satisfy both test clicks with no new dependency, use this minimal inline menu instead of a dropdown primitive:

```tsx
        {!showPicker && (
          <details>
            <summary className="cursor-pointer text-sm"><span role="button">＋ Add</span></summary>
            {model?.optionalJoins?.length ? (
              <button className="mt-1 block text-sm" onClick={() => setShowPicker(true)}>Join column</button>
            ) : <span className="text-xs text-muted-foreground">No optional joins</span>}
          </details>
        )}
```

Pick one of the two "Add" shapes above (plain Button+picker, or `<details>` menu) — the `<details>` version is what the Task-9 test's two-click flow expects; use it.

- [ ] **Step 4: Confirm UI import paths**

Before running, verify `@/components/ui/button` resolves (grep a sibling: `grep -rn "components/ui/button" apps/studio/src`). If the studio has no `button` component, replace `<Button …>` with a plain `<button className="…">` — do not add a dependency.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @openldr/studio test -- BuilderForm.test.tsx`
Expected: PASS. Then the folder suite: `pnpm --filter @openldr/studio test -- src/dashboard/editor`
Expected: existing builder tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/dashboard/editor/BuilderForm.tsx apps/studio/src/dashboard/editor/BuilderForm.test.tsx
git commit -m "feat(studio): Add menu + join-column escape hatch in the widget builder"
```

---

## Final verification

- [ ] **Full test sweep**

Run: `pnpm --filter @openldr/dashboards test && pnpm --filter @openldr/server test && pnpm --filter @openldr/studio test`
Expected: all PASS.

- [ ] **Type-check the touched packages**

Run: `pnpm --filter @openldr/dashboards exec tsc --noEmit && pnpm --filter @openldr/studio exec tsc --noEmit`
Expected: no errors.

- [ ] **Manual smoke (optional)**

Open a dashboard widget → Builder → source "Test Orders" → "＋ Add" → "Join column" → Join "Patient", Column "sex" → Add → set Group by to the new "Patient → Sex" → confirm the widget runs and the compiled SQL includes a `left join ... patients`.

---

## Notes for the executor

- **DRY/YAGNI:** ad-hoc columns deliberately reuse the `ModelDimension` shape and the existing join machinery — do not add a parallel join code path.
- **Security invariant:** the client only ever receives denylist-filtered columns (`modelsForClient`), *and* the server re-validates every ad-hoc dim in `effectiveModel`. Keep both — the UI filter is convenience, the compiler check is the guard.
- **Regression guard:** every server task ends by confirming the existing recognizer/compile suites stay green; the query shape is unchanged when `adhocDimensions` is absent, so they should.
- **Package/test-runner commands** assume pnpm workspaces with Vitest (matching the repo's existing `*.test.ts(x)` files). If the repo uses a different filter/runner invocation, mirror the command used by a sibling package's existing test script.
