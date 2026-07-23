# Arbitrary (User-Defined) Joins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a widget-builder user join the base model's table to any admin-listed joinable table, on keys they choose, selecting columns within an admin per-table policy — multiple/aliased joins, Metabase-style — while the server keeps PII and table reachability under admin control.

**Architecture:** A `userJoin` (persisted on the builder query) is **synthesized into a `ModelJoin` in the effective model** by the compiler; from there the shipped `collectUsedJoins → leftJoin` and `adhocDimensions` machinery works unchanged. Admin governance lives in a new `JoinableTable[]` registry (which tables are joinable + per-table column policy + PK hints). Column selections reuse `adhocDimensions` (their `join` field references the userJoin `id`).

**Tech Stack:** TypeScript, Zod, Kysely, React + shadcn/Radix, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-23-builder-arbitrary-joins-design.md`. Read it first.

---

## Safety invariant (must hold end-to-end)

The server (`effectiveModel`) rejects, regardless of hand-edited widget JSON: (1) a `userJoin` to a table not in `JOINABLE_TABLES`; (2) a selected column outside the table's policy (`joinableColumns`); (3) a `left`/`right` key that isn't a real schema column. A joinable table with **no** policy (`columns` and `denyColumns` both undefined) exposes nothing (fail-safe closed). Fan-out is warned in the UI, not blocked.

## File Structure

**Modify:** `packages/dashboards/src/models/registry.ts` (JoinableTable config + helpers + `tableColumns` on client model), `packages/dashboards/src/compile.ts` (effectiveModel user-join synthesis; `exposableFor`), `packages/dashboards/src/types.ts` (`UserJoinSchema` + `userJoins`), `apps/studio/src/api.ts` (client types + `userJoins` + `tableColumns` + joinableTables), the models API route (bootstrap — see Task 5), `apps/studio/src/dashboard/editor/builderForm.model.ts` (pure helpers), `apps/studio/src/dashboard/editor/BuilderForm.tsx` (wire the join builder).
**Create:** `apps/studio/src/dashboard/editor/UserJoinBuilder.tsx` (+ `.test.tsx`).

---

### Task 1: Admin registry — `JoinableTable` config + helpers + base-table columns

**Files:** Modify `packages/dashboards/src/models/registry.ts`; Test `packages/dashboards/src/models/registry.test.ts`.

- [ ] **Step 1: Write the failing tests** — append to `registry.test.ts`:

```ts
import { JOINABLE_TABLES, joinableColumns, getJoinableTable, joinableTablesForClient } from './registry';

describe('joinable tables (arbitrary joins)', () => {
  it('joinableColumns applies a denylist policy (all-minus-deny)', () => {
    const patients = getJoinableTable('patients')!;
    const cols = joinableColumns(patients);
    expect(cols).toContain('sex');
    expect(cols).not.toContain('national_id'); // PII denied
    expect(cols).not.toContain('surname');
  });

  it('joinableColumns returns [] when a table has no policy (fail-safe closed)', () => {
    expect(joinableColumns({ table: 'patients', label: 'x' } as any)).toEqual([]);
  });

  it('joinableColumns applies an allowlist policy', () => {
    expect(joinableColumns({ table: 'facilities', label: 'F', columns: ['facility_name'] } as any)).toEqual(['facility_name']);
  });

  it('joinableTablesForClient ships policy-filtered columns + PKs + allColumns, never the raw denylist', () => {
    const p = joinableTablesForClient().find((t) => t.table === 'patients')!;
    expect(p.columns).not.toContain('national_id');
    expect(p.primaryKeys).toEqual(['id']);
    expect(p.allColumns).toContain('national_id'); // allColumns = every real column, for key pickers
    expect((p as any).denyColumns).toBeUndefined();
  });

  it('modelsForClient includes the base table columns for the left-key picker', () => {
    const m = modelsForClient().find((x) => x.id === 'service_requests')!;
    expect(m.tableColumns).toContain('patient_id');
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm --filter @openldr/dashboards test -- registry.test.ts -t "joinable tables"` (exports missing).

- [ ] **Step 3: Implement in `registry.ts`.** Add the interface + config + helpers (place after `exposableColumns`, before `modelsForClient`):

```ts
export interface JoinableTable {
  table: keyof ExternalSchema;
  label: string;
  columns?: string[];      // ALLOWLIST of exposable output columns, OR…
  denyColumns?: string[];  // …all-minus-denylist (an explicit [] means "all"). Exactly one is the policy.
  primaryKeys?: string[];  // unique columns → no fan-out warning when used as the right key
}

/** The admin-governed universe of joinable tables (global). Extend as needed. */
export const JOINABLE_TABLES: JoinableTable[] = [
  { table: 'patients', label: 'Patient', primaryKeys: ['id'],
    denyColumns: ['id', 'patient_guid', 'surname', 'firstname', 'national_id', 'phone', 'email',
                  'date_of_birth', 'replaced_by_id', 'plugin_id', 'plugin_version', 'batch_id'] },
  { table: 'facilities', label: 'Facility', primaryKeys: ['id'],
    denyColumns: ['plugin_id', 'plugin_version', 'batch_id'] },
  { table: 'specimens', label: 'Specimen', primaryKeys: ['id'],
    denyColumns: ['id', 'patient_id', 'accession', 'plugin_id', 'plugin_version', 'batch_id'] },
  { table: 'lab_requests', label: 'Request', primaryKeys: ['id'],
    denyColumns: ['id', 'patient_id', 'plugin_id', 'plugin_version', 'batch_id'] },
  { table: 'diagnostic_reports', label: 'Report', primaryKeys: ['id'],
    denyColumns: ['id', 'patient_id', 'plugin_id', 'plugin_version', 'batch_id'] },
];

export function getJoinableTable(table: string): JoinableTable | undefined {
  return JOINABLE_TABLES.find((t) => t.table === table);
}

/**
 * Exposable OUTPUT columns for a joinable table, per its admin policy. Allowlist wins; otherwise
 * all-minus-denylist (an explicit empty denylist means "all"); no policy at all → [] (fail-safe closed).
 */
export function joinableColumns(jt: JoinableTable): string[] {
  const all = EXTERNAL_TABLE_COLUMNS[jt.table];
  if (jt.columns) return jt.columns.filter((c) => all.includes(c));
  if (jt.denyColumns) { const deny = new Set(jt.denyColumns); return all.filter((c) => !deny.has(c)); }
  return [];
}

export interface ClientJoinableTable { table: string; label: string; columns: string[]; primaryKeys: string[]; allColumns: string[] }

/** Browser-safe projection: policy-filtered output `columns`, `primaryKeys`, and `allColumns` (every
 *  real column name, for the join-key pickers). Raw `denyColumns` never travel. Tables that expose no
 *  output columns are dropped (nothing to join to). */
export function joinableTablesForClient(): ClientJoinableTable[] {
  return JOINABLE_TABLES
    .map((jt) => ({ table: jt.table, label: jt.label, columns: joinableColumns(jt), primaryKeys: jt.primaryKeys ?? [], allColumns: EXTERNAL_TABLE_COLUMNS[jt.table] }))
    .filter((t) => t.columns.length > 0);
}
```

Then add base-table columns to the client model. In `ClientQueryModel` (the `type ClientQueryModel = …`), add `tableColumns: string[]`. In `modelsForClient`, include `tableColumns: EXTERNAL_TABLE_COLUMNS[m.table]` in BOTH returned object shapes (the `optionalJoins.length ? {...} : {...}` branches).

- [ ] **Step 4: Run → PASS** — `pnpm --filter @openldr/dashboards test -- registry.test.ts`. `pnpm --filter @openldr/dashboards typecheck` clean.

- [ ] **Step 5: Commit** — `git add packages/dashboards/src/models/registry.ts packages/dashboards/src/models/registry.test.ts && git commit -m "feat(dashboards): JoinableTable admin registry + joinableColumns/joinableTablesForClient + base tableColumns"`

---

### Task 2: `exposableFor` — unified exposability so synthesized user joins validate

**Files:** Modify `packages/dashboards/src/models/registry.ts`; Modify `packages/dashboards/src/compile.ts`; Test `registry.test.ts`.

Rationale: the ad-hoc fold validates columns via `exposableColumns` (which treats an empty denylist as *closed*). Synthesized user joins carry an explicit exposable list and must NOT be subject to that fail-safe. Introduce `ModelJoin.exposable?: string[]` and an `exposableFor(model, alias)` that returns it when present, else the existing `exposableColumns`.

- [ ] **Step 1: Failing test** — in `registry.test.ts`:

```ts
import { exposableFor } from './registry';
describe('exposableFor', () => {
  it('returns a synthesized join\'s explicit exposable list', () => {
    const model = { id: 'm', label: 'M', table: 'lab_requests',
      joins: [{ table: 'patients', alias: 'u1', left: 'patient_id', right: 'id', optional: true, exposable: ['sex'] }],
      dimensions: [], metrics: [] } as any;
    expect(exposableFor(model, 'u1')).toEqual(['sex']);
  });
  it('falls back to exposableColumns for an admin optional join', () => {
    const m = getModel('service_requests')!;
    expect(exposableFor(m, 'jp')).toEqual(exposableColumns(m, 'jp'));
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** In `registry.ts`, add `exposable?: string[]` to the `ModelJoin` interface, and:

```ts
/** Exposable columns for any join alias: a synthesized user join's explicit `exposable`, else the
 *  admin optional-join denylist rules (exposableColumns). */
export function exposableFor(model: QueryModel, alias: string): string[] {
  const j = (model.joins ?? []).find((x) => x.alias === alias);
  return j?.exposable ?? exposableColumns(model, alias);
}
```

In `compile.ts`, import `exposableFor` and change the ad-hoc fold's check from `exposableColumns(eff, a.join)` to `exposableFor(eff, a.join)` (behavior-identical for admin joins — no `exposable` field — so existing join tests stay green).

- [ ] **Step 4: Run → PASS** — `pnpm --filter @openldr/dashboards test` (full; existing ad-hoc/join tests must stay green). typecheck clean.

- [ ] **Step 5: Commit** — `git add packages/dashboards/src/models/registry.ts packages/dashboards/src/compile.ts packages/dashboards/src/models/registry.test.ts && git commit -m "feat(dashboards): exposableFor unifies admin-join and synthesized-user-join column exposability"`

---

### Task 3: Query schema — `UserJoinSchema` + `userJoins`

**Files:** Modify `packages/dashboards/src/types.ts`; Test `packages/dashboards/src/types.test.ts`.

- [ ] **Step 1: Failing test** — add to `types.test.ts` (extend the import to include `UserJoinSchema`):

```ts
describe('user joins schema', () => {
  it('accepts a userJoin', () => {
    expect(UserJoinSchema.safeParse({ id: 'u1', table: 'patients', left: 'patient_id', right: 'id', label: 'Patient' }).success).toBe(true);
  });
  it('accepts a builder query carrying userJoins', () => {
    const ok = WidgetQuerySchema.safeParse({
      mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [],
      userJoins: [{ id: 'u1', table: 'patients', left: 'patient_id', right: 'id' }],
    });
    expect(ok.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement in `types.ts`** — add near `AdhocDimensionSchema`:

```ts
// A user-defined join: base-model table column `left` = joined `table` column `right`. `id` is a
// query-local alias (distinct id → same table joinable twice). Columns selected from it are ordinary
// adhocDimensions whose `join` references this id.
export const UserJoinSchema = z.object({
  id: z.string(),
  table: z.string(),
  left: z.string(),
  right: z.string(),
  label: z.string().optional(),
});
export type UserJoin = z.infer<typeof UserJoinSchema>;
```

Add to the builder branch of `WidgetQuerySchema` (next to `adhocDimensions`): `userJoins: z.array(UserJoinSchema).optional(),`

- [ ] **Step 4: Run → PASS** — `pnpm --filter @openldr/dashboards test -- types.test.ts`. typecheck clean.

- [ ] **Step 5: Commit** — `git add packages/dashboards/src/types.ts packages/dashboards/src/types.test.ts && git commit -m "feat(dashboards): UserJoin schema + userJoins builder query field"`

---

### Task 4: Compiler — synthesize user joins in `effectiveModel`

**Files:** Modify `packages/dashboards/src/compile.ts`; Test `packages/dashboards/src/compile.test.ts`.

Fold order: **user joins → ad-hoc dimensions → custom columns.** Synthesize each user join into `eff.joins` BEFORE the ad-hoc fold, so ad-hoc columns referencing a user-join alias validate against it.

- [ ] **Step 1: Failing tests** — append to `compile.test.ts`:

```ts
describe('user-defined (arbitrary) joins', () => {
  it('synthesizes a user join into a leftJoin with qualified refs', () => {
    const model = getModel('service_requests')!; // base table lab_requests
    const { sql } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [],
      userJoins: [{ id: 'u1', table: 'patients', left: 'patient_id', right: 'id', label: 'Patient' }],
      adhocDimensions: [{ key: 'u1__sex', label: 'Patient Sex', join: 'u1', column: 'sex', kind: 'string' }],
      dimension: { key: 'u1__sex' },
    } as any).compile();
    expect(sql).toMatch(/left join "patients" as "u1"/i);
    expect(sql).toMatch(/"u1"\."sex" as "label"/i);
  });

  it('supports the same table joined twice under distinct aliases', () => {
    const model = getModel('service_requests')!;
    const { sql } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [],
      userJoins: [
        { id: 'u1', table: 'patients', left: 'patient_id', right: 'id' },
        { id: 'u2', table: 'patients', left: 'patient_id', right: 'id' },
      ],
      adhocDimensions: [
        { key: 'u1__sex', label: 'A', join: 'u1', column: 'sex', kind: 'string' },
        { key: 'u2__managing_organization', label: 'B', join: 'u2', column: 'managing_organization', kind: 'string' },
      ],
      dimension: { key: 'u1__sex' },
      filters: [{ dimension: 'u2__managing_organization', op: 'eq', value: 'Org/1' }],
    } as any).compile();
    expect(sql).toMatch(/left join "patients" as "u1"/i);
    expect(sql).toMatch(/left join "patients" as "u2"/i);
  });

  it('rejects a user join to a table not in the joinable set', () => {
    const model = getModel('service_requests')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [],
      userJoins: [{ id: 'u1', table: 'secret_table', left: 'patient_id', right: 'id' }],
      adhocDimensions: [{ key: 'u1__x', label: 'x', join: 'u1', column: 'x', kind: 'string' }],
      dimension: { key: 'u1__x' },
    } as any)).toThrow(/not joinable/i);
  });

  it('rejects selecting a denylisted (PII) column from a user join', () => {
    const model = getModel('service_requests')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [],
      userJoins: [{ id: 'u1', table: 'patients', left: 'patient_id', right: 'id' }],
      adhocDimensions: [{ key: 'u1__national_id', label: 'x', join: 'u1', column: 'national_id', kind: 'string' }],
      dimension: { key: 'u1__national_id' },
    } as any)).toThrow(/not exposable/i);
  });

  it('rejects a join key that is not a real column', () => {
    const model = getModel('service_requests')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [],
      userJoins: [{ id: 'u1', table: 'patients', left: 'evil', right: 'id' }],
      adhocDimensions: [{ key: 'u1__sex', label: 'x', join: 'u1', column: 'sex', kind: 'string' }],
      dimension: { key: 'u1__sex' },
    } as any)).toThrow(/unknown (left|right) key/i);
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm --filter @openldr/dashboards test -- compile.test.ts -t "user-defined"`.

- [ ] **Step 3: Implement in `compile.ts`.** Extend the registry import to add `exposableFor, getJoinableTable, joinableColumns`. Get `EXTERNAL_TABLE_COLUMNS` — match how the file already imports from `@openldr/db` (compile.ts is server-only; `import { EXTERNAL_TABLE_COLUMNS } from '@openldr/db/schema/external'` is the browser-safe subpath registry.ts uses and is safe here too).

At the TOP of `effectiveModel` (before the existing ad-hoc fold), add the synthesis:

```ts
  // 0) User-defined joins → synthesized ModelJoins, validated against the admin joinable universe.
  const userJoins = q.userJoins ?? [];
  if (userJoins.length) {
    const baseCols = EXTERNAL_TABLE_COLUMNS[eff.table];
    const synth: ModelJoin[] = [];
    for (const uj of userJoins) {
      const jt = getJoinableTable(uj.table);
      if (!jt) throw new Error(`user join ${uj.id}: table not joinable: ${uj.table}`);
      const rightCols = EXTERNAL_TABLE_COLUMNS[uj.table as keyof typeof EXTERNAL_TABLE_COLUMNS];
      if (!baseCols.includes(uj.left)) throw new Error(`user join ${uj.id}: unknown left key: ${uj.left}`);
      if (!rightCols || !rightCols.includes(uj.right)) throw new Error(`user join ${uj.id}: unknown right key: ${uj.right}`);
      synth.push({ table: uj.table as ModelJoin['table'], alias: uj.id, left: uj.left, right: uj.right, optional: true, exposable: joinableColumns(jt) });
    }
    eff = { ...eff, joins: [...(eff.joins ?? []), ...synth] };
  }
```

The existing ad-hoc fold (now calling `exposableFor(eff, a.join)` from Task 2) validates each user-join column against the synthesized `exposable` list — a denied column throws `/not exposable/i`. `collectUsedJoins` + the `leftJoin` builder are unchanged.

- [ ] **Step 4: Run → PASS** — `pnpm --filter @openldr/dashboards test` (full; all suites green). typecheck clean.

- [ ] **Step 5: Commit** — `git add packages/dashboards/src/compile.ts packages/dashboards/src/compile.test.ts && git commit -m "feat(dashboards): compile user-defined joins (synthesized into the effective model, validated)"`

---

### Task 5: Studio client — types, joinableTables fetch, pure helpers

**Files:** Modify `apps/studio/src/api.ts`; Modify the models API route (bootstrap); Modify `apps/studio/src/dashboard/editor/builderForm.model.ts`; Test `builderForm.model.test.ts`.

- [ ] **Step 1: Client types (`api.ts`).** Near `WidgetQuery`, add:

```ts
export interface UserJoin { id: string; table: string; left: string; right: string; label?: string }
export interface ClientJoinableTable { table: string; label: string; columns: string[]; primaryKeys: string[]; allColumns: string[] }
```
Add `userJoins?: UserJoin[];` to the builder branch of `WidgetQuery` (next to `adhocDimensions`). Add `tableColumns: string[];` to the `QueryModel` interface (mirrors the new server `tableColumns`).

- [ ] **Step 2: Ship joinableTables to the client.** Locate the models endpoint: `grep -rn "modelsForClient" packages/bootstrap/src`. It serves `modelsForClient()` at a route consumed by `listModels()` in `api.ts`. Extend that handler to also return `joinableTables: joinableTablesForClient()` (import from `@openldr/dashboards`), OR add a sibling route. Then in `api.ts` add `export async function fetchJoinableTables(): Promise<ClientJoinableTable[]>` (or return it from the existing models fetch). Keep it one round-trip. The data is exactly `joinableTablesForClient()`.

- [ ] **Step 3: Failing helper tests** — append to `builderForm.model.test.ts` (extend imports for `addUserJoinPatch, removeUserJoinPatch, setUserJoinKeysPatch, uniqueJoinId`):

```ts
describe('user join patches', () => {
  const q0 = () => ({ mode: 'builder' as const, model: 'service_requests', metric: { key: 'count', agg: 'count', label: 'Count' }, filters: [] });

  it('addUserJoinPatch appends a user join', () => {
    const next = addUserJoinPatch(q0(), { id: 'u1', table: 'patients', left: 'patient_id', right: 'id', label: 'Patient' });
    expect(next.userJoins).toEqual([{ id: 'u1', table: 'patients', left: 'patient_id', right: 'id', label: 'Patient' }]);
  });

  it('uniqueJoinId avoids collisions', () => {
    expect(uniqueJoinId([])).toBe('u1');
    expect(uniqueJoinId([{ id: 'u1' }])).toBe('u2');
  });

  it('setUserJoinKeysPatch updates one join\'s keys', () => {
    let q = addUserJoinPatch(q0(), { id: 'u1', table: 'patients', left: 'patient_id', right: 'id' });
    q = setUserJoinKeysPatch(q, 'u1', { right: 'patient_guid' });
    expect(q.userJoins![0].right).toBe('patient_guid');
  });

  it('removeUserJoinPatch removes the join, its adhoc columns, and orphan-cleans references', () => {
    let q: any = addUserJoinPatch(q0(), { id: 'u1', table: 'patients', left: 'patient_id', right: 'id' });
    q = { ...q, adhocDimensions: [{ key: 'u1__sex', label: 'Sex', join: 'u1', column: 'sex', kind: 'string' }], dimension: { key: 'u1__sex' } };
    const next = removeUserJoinPatch(q, 'u1');
    expect(next.userJoins ?? []).toHaveLength(0);
    expect((next.adhocDimensions ?? []).some((d: any) => d.join === 'u1')).toBe(false);
    expect(next.dimension).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run → FAIL.**

- [ ] **Step 5: Implement in `builderForm.model.ts`** (uses the already-exported `clearDimensionRefs`):

```ts
import type { UserJoin } from '../../api';

/** `u1`, `u2`, … avoiding collisions with existing user-join ids. */
export function uniqueJoinId(list: { id: string }[]): string {
  const used = new Set(list.map((j) => j.id));
  let n = 1;
  while (used.has(`u${n}`)) n++;
  return `u${n}`;
}

export function addUserJoinPatch(value: BuilderQuery, join: UserJoin): BuilderQuery {
  const list = value.userJoins ?? [];
  if (list.some((j) => j.id === join.id)) return value;
  return { ...value, userJoins: [...list, join] };
}

export function setUserJoinKeysPatch(value: BuilderQuery, id: string, patch: Partial<Pick<UserJoin, 'left' | 'right' | 'table' | 'label'>>): BuilderQuery {
  return { ...value, userJoins: (value.userJoins ?? []).map((j) => (j.id === id ? { ...j, ...patch } : j)) };
}

/** Remove a user join, all its ad-hoc columns, and orphan-clean any group-by/breakdown/filter refs. */
export function removeUserJoinPatch(value: BuilderQuery, id: string): BuilderQuery {
  const removedKeys = new Set((value.adhocDimensions ?? []).filter((d) => d.join === id).map((d) => d.key));
  const next: BuilderQuery = {
    ...value,
    userJoins: (value.userJoins ?? []).filter((j) => j.id !== id),
    adhocDimensions: (value.adhocDimensions ?? []).filter((d) => d.join !== id),
  };
  return clearDimensionRefs(next, removedKeys);
}
```
`BuilderQuery` = `Extract<WidgetQuery, { mode: 'builder' }>` now carries `userJoins` (Step 1). `clearDimensionRefs` is exported (from the earlier Custom-column DRY refactor).

- [ ] **Step 6: Run → PASS** — `pnpm --filter @openldr/studio test -- builderForm.model.test.ts`. `pnpm --filter @openldr/studio typecheck` clean.

- [ ] **Step 7: Commit** — `git add apps/studio/src/api.ts apps/studio/src/dashboard/editor/builderForm.model.ts apps/studio/src/dashboard/editor/builderForm.model.test.ts <bootstrap models route file> && git commit -m "feat(studio): user-join client types + joinableTables fetch + pure add/remove/keys helpers"`

---

### Task 6: UI — `UserJoinBuilder` + wire into `BuilderForm`

**Files:** Create `apps/studio/src/dashboard/editor/UserJoinBuilder.tsx` (+ `.test.tsx`); Modify `apps/studio/src/dashboard/editor/BuilderForm.tsx`.

- [ ] **Step 1: Failing test** — create `UserJoinBuilder.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { UserJoinBuilder } from './UserJoinBuilder';

const joinable = [
  { table: 'patients', label: 'Patient', columns: ['sex', 'managing_organization'], primaryKeys: ['id'], allColumns: ['id', 'patient_id', 'sex', 'managing_organization', 'national_id'] },
];
const baseColumns = ['id', 'patient_id', 'status'];
const join = { id: 'u1', table: 'patients', left: 'patient_id', right: 'id', label: 'Patient' };

describe('UserJoinBuilder', () => {
  it('renders the on-clause keys and the column checklist', () => {
    render(<UserJoinBuilder join={join} joinable={joinable} baseColumns={baseColumns} selected={[]} onChange={() => {}} onColumns={() => {}} onRemove={() => {}} />);
    expect(screen.getByText(/on/i)).toBeInTheDocument();
    expect(screen.getByLabelText('sex')).toBeInTheDocument();
  });

  it('warns when the right key is not a primary key', () => {
    const nonPk = { ...join, right: 'patient_id' }; // not in primaryKeys(['id'])
    render(<UserJoinBuilder join={nonPk} joinable={joinable} baseColumns={baseColumns} selected={[]} onChange={() => {}} onColumns={() => {}} onRemove={() => {}} />);
    expect(screen.getByText(/may inflate/i)).toBeInTheDocument();
  });

  it('emits column selection via onColumns', () => {
    const onColumns = vi.fn();
    render(<UserJoinBuilder join={join} joinable={joinable} baseColumns={baseColumns} selected={[]} onChange={() => {}} onColumns={onColumns} onRemove={() => {}} />);
    fireEvent.click(screen.getByLabelText('sex'));
    expect(onColumns).toHaveBeenCalledWith('u1', ['sex']);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `UserJoinBuilder.tsx`:**

```tsx
import type { UserJoin, ClientJoinableTable } from '../../api';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

export function UserJoinBuilder({ join, joinable, baseColumns, selected, onChange, onColumns, onRemove }: {
  join: UserJoin;
  joinable: ClientJoinableTable[];
  baseColumns: string[];
  selected: string[];                                   // columns currently selected for this join
  onChange: (patch: Partial<UserJoin>) => void;         // table/left/right edits
  onColumns: (id: string, columns: string[]) => void;   // column selection reconcile
  onRemove: () => void;
}) {
  const jt = joinable.find((t) => t.table === join.table);
  const fanout = jt ? !jt.primaryKeys.includes(join.right) : false;
  const toggle = (c: string) => onColumns(join.id, selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c]);

  return (
    <div className="mx-1 rounded-md border border-border bg-card p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">Join: {jt?.label ?? join.table}</span>
        <button type="button" aria-label={`Remove join ${join.id}`} className="text-muted-foreground hover:text-foreground" onClick={onRemove}>×</button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">Table
          <Select value={join.table} onValueChange={(t) => onChange({ table: t, right: '' })}>
            <SelectTrigger aria-label="Join table" className="mt-1 h-8 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>{joinable.map((t) => <SelectItem key={t.table} value={t.table}>{t.label}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        <span className="pb-2 text-xs text-muted-foreground">on</span>
        <label className="text-xs">Base key
          <Select value={join.left} onValueChange={(v) => onChange({ left: v })}>
            <SelectTrigger aria-label="Left key" className="mt-1 h-8 w-40"><SelectValue placeholder="column" /></SelectTrigger>
            <SelectContent>{baseColumns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        <span className="pb-2 text-xs text-muted-foreground">=</span>
        <label className="text-xs">{jt?.label ?? 'Joined'} key
          <Select value={join.right} onValueChange={(v) => onChange({ right: v })}>
            <SelectTrigger aria-label="Right key" className="mt-1 h-8 w-40"><SelectValue placeholder="column" /></SelectTrigger>
            <SelectContent>{(jt?.allColumns ?? []).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </label>
      </div>

      {fanout && <p className="mt-1 text-xs text-amber-500">Right key isn’t a primary key — counts may inflate (fan-out).</p>}

      <fieldset className="mt-2 flex flex-col gap-1">
        <legend className="mb-1 text-xs text-muted-foreground">Columns</legend>
        {(jt?.columns ?? []).map((c) => (
          <label key={c} className="flex items-center gap-2 text-xs">
            <input type="checkbox" aria-label={c} checked={selected.includes(c)} onChange={() => toggle(c)} />
            {c}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
```

- [ ] **Step 4: Run → PASS** — `pnpm --filter @openldr/studio test -- UserJoinBuilder.test.tsx`.

- [ ] **Step 5: Wire into `BuilderForm.tsx`.** (a) Thread `joinableTables: ClientJoinableTable[]` into `BuilderForm` as a prop (loaded in `WidgetEditorDialog` alongside `listModels`, Task 5 Step 2). (b) `baseColumns = model.tableColumns`. (c) Render one `<UserJoinBuilder>` per `value.userJoins`, wiring: `onChange` → `setUserJoinKeysPatch(value, id, patch)`; `onColumns(id, cols)` → `setRelationshipColumnsPatch(value, id, jtLabel, cols)` (already keyed by alias and auto-deriving label/kind — composes with a user-join `id`); `onRemove` → `removeUserJoinPatch(value, id)`; `selected` = `adhoc.filter(d => d.join === id).map(d => d.column)`. (d) Add a **"+ Add a join"** control to the Join-data affordance that calls `onChange(addUserJoinPatch(value, { id: uniqueJoinId(value.userJoins ?? []), table: joinableTables[0].table, left: '', right: '', label: joinableTables[0].label }))`. The existing curated `JoinDataPicker` and admin-relationship cards remain.

Update `BuilderForm.test.tsx`: pass a `joinableTables` fixture; assert the "+ Add a join" control renders and emits a `userJoins` entry; a value with `userJoins` renders a `UserJoinBuilder`. Use `getAllByRole` where names collide.

- [ ] **Step 6: Run → PASS** — `pnpm --filter @openldr/studio test -- BuilderForm.test.tsx UserJoinBuilder.test.tsx`; `cd apps/studio && npx vitest run src/dashboard/editor` green; typecheck clean.

- [ ] **Step 7: Commit** — `git add apps/studio/src/dashboard/editor/UserJoinBuilder.tsx apps/studio/src/dashboard/editor/UserJoinBuilder.test.tsx apps/studio/src/dashboard/editor/BuilderForm.tsx apps/studio/src/dashboard/editor/BuilderForm.test.tsx && git commit -m "feat(studio): arbitrary-join builder UI (table/keys/columns + fan-out warning), wired into BuilderForm"`

---

### Task 7: Full verification

- [ ] **Step 1** — `pnpm --filter @openldr/dashboards test && pnpm --filter @openldr/studio test` (ignore the pre-existing unrelated `api.reports.test.ts` `fetchReportPdf` failure).
- [ ] **Step 2** — `pnpm --filter @openldr/dashboards typecheck && pnpm --filter @openldr/studio typecheck` clean.
- [ ] **Step 3 (manual smoke)** — In studio, open a widget on Test Orders → Join data → Add a join → pick Patient, keys `patient_id = id`, check `sex` → it appears in Group by; add a second Patient join (u2) with different columns; pick a non-PK right key → fan-out warning shows; try `national_id` → not offered (denylist). Confirm the compiled widget runs.

---

## Self-Review

**Spec coverage:** table reachability + column policy + key validity → Task 1 + Task 4 (server validation) + Task 2 (`exposableFor`). Fail-safe closed → Task 1 `joinableColumns` returns `[]` with no policy. Multiple/aliased joins → Task 4 test (same table twice) + Task 5 `uniqueJoinId`. Fan-out warning → Task 6 (`primaryKeys` check). PII regression → Task 4 (reject `national_id`) + Task 1 (`joinableTablesForClient` strips denylist). Reuse of shipped machinery → Task 4 (synthesize into `model.joins`; `collectUsedJoins`/`leftJoin` unchanged). Fold order user→adhoc→custom → Task 4 (synthesis at top of `effectiveModel`).

**Placeholder scan:** two deliberate execution-time lookups are flagged, not vague: (Task 4 Step 3) which module exports `EXTERNAL_TABLE_COLUMNS` into `compile.ts` — use `@openldr/db/schema/external`; (Task 5 Step 2) the exact bootstrap route serving `modelsForClient` — `grep -rn "modelsForClient" packages/bootstrap/src`. Everything else is concrete code.

**Type consistency:** `UserJoin` (server Zod, Task 3) mirrors `UserJoin` (client, Task 5); `ModelJoin.exposable` (Task 2) is set by Task 4's synthesis and read by `exposableFor`; `ClientJoinableTable` identical in registry.ts (Task 1) and api.ts (Task 5); `tableColumns` added to both server `ClientQueryModel` (Task 1) and client `QueryModel` (Task 5); helper signatures (Task 5) match call sites (Task 6).

**Assumptions to verify at execution:** the `JOINABLE_TABLES` denylists are transcribed from `EXTERNAL_TABLE_COLUMNS` (`packages/db/src/schema/external.ts`) — re-check each table's real column list against that file when implementing Task 1. Confirm `setRelationshipColumnsPatch` (reused in Task 6) is alias-agnostic (it is — keyed purely by the alias string), so a user-join `id` works as its alias.
