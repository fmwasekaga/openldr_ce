# Custom column (Row-level Computed Dimension) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user define a **row-level computed group-by dimension** — a `concat(...)` of fields/literals (string) or a binary `+ − × ÷` (number) — through a structured, parser-free editor, usable in Group by and Breakdown like any dimension.

**Architecture:** A custom column is a **structured descriptor** (`Expr` = discriminated union) persisted on the builder query as `customColumns[]`. The compiler folds each into the effective model as a dimension carrying `compute:{kind:'expr',expr}` (mirroring the existing age-band computed dimension), builds a SQL expression whose operands are validated dimension refs or **bound literals**, and SELECT/GROUP BYs it. No parser, no free-text-as-code.

**Tech Stack:** TypeScript, Zod, Kysely, React + shadcn/Radix, Vitest + Testing Library.

## Design refinement vs. the spec (important)

The spec flagged string concat as dialect-sensitive and recommended threading the `engine` into the compiler. **That is unnecessary here.** The runtime target engines are `TargetEngine = 'postgres' | 'mssql' | 'mysql'` (`packages/db/src/engine.ts`) — SQLite appears only as a *no-execute* dialect in `compile.test.ts` for `.compile()` text generation. **`CONCAT(...)` is supported by all three runtime engines** (and auto-casts operands to text and is NULL-safe), so the compiler emits `concat(...)` **unconditionally** — no `engine` parameter, no dialect branch, no changes to `runBuilderQuery`/`compileBuilderQuery` signatures or the bootstrap call sites. Arithmetic `+ − × ÷` and `nullif` are likewise portable.

## Safety / curation stance (explicit)

- **No parser, no injection surface.** `Expr` is validated data. Field operands are dimension **keys**; string/number operands are **bound parameters** (`sql${value}`), never inlined.
- **Operands must reference an existing, non-computed dimension** (validated in the fold). This forbids nesting (referencing another custom column) *and* keeps every operand a column the user could already group by — a custom column adds expressiveness, not reach.
- **Custom columns cannot be used as filter/where fields in v1** (see Scope). `colName` throws if ever asked to resolve one, so a hand-edited widget JSON can't route one through the filter path.

## Scope / non-goals (v1)

- Usable in **Group by and Breakdown only** — *not* Filter (deliberate deviation from the spec's "Filter" mention; filtering on an expression would touch the entire flat/tree filter-compilation path). Filter-on-custom-column is a future item; the fold + `colName` guard keep it safe until then.
- Operators: `concat` and one binary `arithmetic` op. No nesting, no CASE, no unary/multi-term chains, no operand type-checking (arithmetic on a string column is the DB's problem, not a safety issue).

## File Structure

**Modify:**
- `packages/dashboards/src/types.ts` — `OperandSchema`, `ExprSchema`, `CustomColumnSchema`, `customColumns` on the builder query, `customColumnKind`.
- `packages/dashboards/src/models/registry.ts` — extend `ModelDimension.compute` union with `ExprCompute`.
- `packages/dashboards/src/compile.ts` — `exprToSql`/`operandSql`/`exprOperands`; fold + validate in `effectiveModel`; `colName` guard; `collectUsedJoins` recursion; dimension + breakdown `expr` branches.
- `apps/studio/src/api.ts` — add `CustomColumn`/`CustomColumnExpr`/`CustomColumnOperand` types + `customColumns` on the client `WidgetQuery`.
- `apps/studio/src/dashboard/editor/BuilderForm.tsx` — dimOptions include custom columns; filter list excludes them; "Custom column" tile + editor; "Custom columns" card.
- Test files: `types.test.ts`, `compile.test.ts`, `BuilderForm.test.tsx`.

**Create:**
- `apps/studio/src/dashboard/editor/customColumns.model.ts` (+ `.test.ts`) — pure helpers.
- `apps/studio/src/dashboard/editor/CustomColumnEditor.tsx` (+ `.test.tsx`) — the structured editor.

---

### Task 1: Schema — `Operand` / `Expr` / `CustomColumn` (+ `customColumns`, `customColumnKind`)

**Files:**
- Modify: `packages/dashboards/src/types.ts`
- Test: `packages/dashboards/src/types.test.ts`

- [ ] **Step 1: Write the failing tests**

Extend the import on line 2 of `types.test.ts` to add `ExprSchema, CustomColumnSchema, customColumnKind`, then append:

```ts
describe('custom column schema', () => {
  it('accepts a concat expression of fields and literals', () => {
    const ok = ExprSchema.safeParse({ kind: 'concat', parts: [
      { type: 'field', dimension: 'status' }, { type: 'string', value: ' / ' }, { type: 'field', dimension: 'priority' },
    ] });
    expect(ok.success).toBe(true);
  });

  it('requires at least one concat part', () => {
    expect(ExprSchema.safeParse({ kind: 'concat', parts: [] }).success).toBe(false);
  });

  it('accepts a binary arithmetic expression', () => {
    const ok = ExprSchema.safeParse({ kind: 'arithmetic', op: '/', left: { type: 'field', dimension: 'a' }, right: { type: 'number', value: 1000 } });
    expect(ok.success).toBe(true);
  });

  it('rejects an unknown arithmetic operator', () => {
    expect(ExprSchema.safeParse({ kind: 'arithmetic', op: '^', left: { type: 'number', value: 1 }, right: { type: 'number', value: 2 } }).success).toBe(false);
  });

  it('accepts a builder query carrying customColumns', () => {
    const ok = WidgetQuerySchema.safeParse({
      mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [],
      customColumns: [{ key: 'full', label: 'Full', expr: { kind: 'concat', parts: [{ type: 'field', dimension: 'status' }] } }],
    });
    expect(ok.success).toBe(true);
  });

  it('customColumnKind derives string for concat and number for arithmetic', () => {
    expect(customColumnKind({ kind: 'concat', parts: [{ type: 'string', value: 'x' }] })).toBe('string');
    expect(customColumnKind({ kind: 'arithmetic', op: '+', left: { type: 'number', value: 1 }, right: { type: 'number', value: 2 } })).toBe('number');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/dashboards test -- types.test.ts -t "custom column schema"`
Expected: FAIL — `ExprSchema`, `CustomColumnSchema`, `customColumnKind` are not exported.

- [ ] **Step 3: Add the schemas**

In `types.ts`, add after `DimensionRefSchema` / `AdhocDimensionSchema` (near line 67):

```ts
// A custom-column operand: a reference to an existing (non-computed) dimension, or a bound literal.
export const OperandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('field'), dimension: z.string() }),
  z.object({ type: z.literal('string'), value: z.string() }),
  z.object({ type: z.literal('number'), value: z.number() }),
]);
export type Operand = z.infer<typeof OperandSchema>;

// A structured, parser-free row-level expression. concat → string; arithmetic → number.
export const ExprSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('concat'), parts: z.array(OperandSchema).min(1) }),
  z.object({ kind: z.literal('arithmetic'), op: z.enum(['+', '-', '*', '/']), left: OperandSchema, right: OperandSchema }),
]);
export type Expr = z.infer<typeof ExprSchema>;

// A user-authored computed group-by dimension. `key` is query-local; group-by/breakdown reference it.
export const CustomColumnSchema = z.object({ key: z.string(), label: z.string(), expr: ExprSchema });
export type CustomColumn = z.infer<typeof CustomColumnSchema>;

/** The DimensionKind a custom column produces — derived from its expression, never stored. */
export function customColumnKind(expr: Expr): 'string' | 'number' {
  return expr.kind === 'concat' ? 'string' : 'number';
}
```

Then add to the builder branch of `WidgetQuerySchema` (next to `adhocDimensions`, line 89):

```ts
    customColumns: z.array(CustomColumnSchema).optional(), // row-level computed group-by dimensions
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/dashboards test -- types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/types.ts packages/dashboards/src/types.test.ts
git commit -m "feat(dashboards): custom-column schema (Operand/Expr/CustomColumn) + customColumns query field"
```

---

### Task 2: Compiler — fold, validate, build SQL, join recursion

**Files:**
- Modify: `packages/dashboards/src/models/registry.ts` (extend `ModelDimension.compute`)
- Modify: `packages/dashboards/src/compile.ts`
- Test: `packages/dashboards/src/compile.test.ts`

- [ ] **Step 1: Extend the compute union (type only)**

In `registry.ts`, import the `Expr` type (extend the existing `import type { Agg, DateGrain, DimensionKind } from '../types';`):

```ts
import type { Agg, DateGrain, DimensionKind, Expr } from '../types';
```

Add the `ExprCompute` interface next to `AgeBandCompute` and widen `ModelDimension.compute`:

```ts
export interface ExprCompute { kind: 'expr'; expr: Expr }
```

```ts
export interface ModelDimension { key: string; label: string; column: string; kind: DimensionKind; dateGrain?: DateGrain[]; compute?: AgeBandCompute | ExprCompute; join?: string }
```

- [ ] **Step 2: Write the failing compiler tests**

Append to `compile.test.ts`:

```ts
describe('custom columns (row-level computed dimension)', () => {
  it('compiles a concat custom column as a group-by via CONCAT with bound literals', () => {
    const model = getModel('service_requests')!;
    const { sql, parameters } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [],
      customColumns: [{ key: 'sp', label: 'Status/Priority', expr: { kind: 'concat', parts: [
        { type: 'field', dimension: 'status' }, { type: 'string', value: ' / ' }, { type: 'field', dimension: 'priority' },
      ] } }],
      dimension: { key: 'sp' },
    } as any).compile();
    expect(sql).toMatch(/concat\(/i);
    expect(sql).toMatch(/as "label"/i);
    expect(sql).toMatch(/group by/i);
    expect(parameters).toContain(' / ');       // literal is a bound parameter…
    expect(sql).not.toContain(' / ');          // …not inlined into the SQL text
  });

  it('compiles arithmetic with div-by-zero guarded by nullif', () => {
    const model = getModel('service_requests')!;
    const { sql } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [],
      customColumns: [{ key: 'ratio', label: 'Ratio', expr: { kind: 'arithmetic', op: '/',
        left: { type: 'field', dimension: 'status' }, right: { type: 'number', value: 1000 } } }],
      dimension: { key: 'ratio' },
    } as any).compile();
    expect(sql).toMatch(/nullif\(/i);
  });

  it('fires the join for a custom column whose operand references a joined dimension', () => {
    const model = getModel('observations')!;
    const { sql } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [],
      customColumns: [{ key: 'fc', label: 'Facility/Analyte', expr: { kind: 'concat', parts: [
        { type: 'field', dimension: 'facility' }, { type: 'string', value: '/' }, { type: 'field', dimension: 'code_text' },
      ] } }],
      dimension: { key: 'fc' },
    } as any).compile();
    expect(sql).toMatch(/left join "patients" as "jp"/i); // 'facility' → join jp, pulled in via the custom column
  });

  it('rejects a custom column referencing an unknown field', () => {
    const model = getModel('service_requests')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [],
      customColumns: [{ key: 'x', label: 'x', expr: { kind: 'concat', parts: [{ type: 'field', dimension: 'nope' }] } }],
      dimension: { key: 'x' },
    } as any)).toThrow(/unknown field/i);
  });

  it('rejects a custom column whose operand is itself computed (no nesting)', () => {
    const model = getModel('patients')!; // has age_band (computed)
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'patients', metric: { key: 'count', agg: 'count' }, filters: [],
      customColumns: [{ key: 'x', label: 'x', expr: { kind: 'concat', parts: [{ type: 'field', dimension: 'age_band' }] } }],
      dimension: { key: 'x' },
    } as any)).toThrow(/computed/i);
  });

  it('refuses to use a custom column as a filter field', () => {
    const model = getModel('service_requests')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' },
      customColumns: [{ key: 'sp', label: 'x', expr: { kind: 'concat', parts: [{ type: 'field', dimension: 'status' }] } }],
      filters: [{ dimension: 'sp', op: 'eq', value: 'X' }],
    } as any)).toThrow(/custom column/i);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @openldr/dashboards test -- compile.test.ts -t "custom columns"`
Expected: FAIL — the compiler doesn't yet handle `customColumns` (unknown dimension `sp`, etc.).

- [ ] **Step 4: Add the expression builder + operand helpers**

In `compile.ts`, extend the type import (line 5) to add `Expr, Operand`, and import `customColumnKind`:

```ts
import type { WidgetQuery, Metric, QueryFilter, DateGrain, ConditionNode, ConditionRule, Expr, Operand } from './types';
import { customColumnKind } from './types';
```

Add these helpers (near `ageBandExprs`, ~line 152):

```ts
/** The operands of an expression, flattened (concat parts, or the two arithmetic sides). */
function exprOperands(expr: Expr): Operand[] {
  return expr.kind === 'concat' ? expr.parts : [expr.left, expr.right];
}

/** SQL for one operand: a validated column ref (via colName) or a BOUND literal (never inlined). */
function operandSql(model: QueryModel, o: Operand, qualify: boolean) {
  if (o.type === 'field') return sql.ref(colName(model, o.dimension, qualify));
  return sql`${o.value}`;
}

/** Build the row-level SQL for a custom column. concat → portable CONCAT(); arithmetic → portable
 *  operators, with `/` guarded by nullif so div-by-zero yields NULL rather than an engine error. */
function exprToSql(model: QueryModel, expr: Expr, qualify: boolean) {
  if (expr.kind === 'concat') {
    const parts = expr.parts.map((p) => operandSql(model, p, qualify));
    return sql`concat(${sql.join(parts, sql`, `)})`;
  }
  const l = operandSql(model, expr.left, qualify);
  const r = operandSql(model, expr.right, qualify);
  switch (expr.op) {
    case '+': return sql`(${l} + ${r})`;
    case '-': return sql`(${l} - ${r})`;
    case '*': return sql`(${l} * ${r})`;
    case '/': return sql`(${l} / nullif(${r}, 0))`;
  }
}
```

- [ ] **Step 5: Guard `colName` against custom columns**

In `colName` (line 28), add the guard right after `const d = dim(model, dimKey);`:

```ts
function colName(model: QueryModel, dimKey: string, qualify: boolean): string {
  const d = dim(model, dimKey);
  if (d.compute?.kind === 'expr') throw new Error(`custom column cannot be used as a filter or where field: ${dimKey}`);
  if (d.join) return `${d.join}.${d.column}`;
  return qualify ? `${model.table}.${d.column}` : d.column;
}
```

(This only fires for a custom-column key used where a plain column is required — filters, metric `where`. The group-by/breakdown paths use `exprToSql` instead, and `operandSql` only calls `colName` on validated non-computed operands.)

- [ ] **Step 6: Fold + validate custom columns in `effectiveModel`**

Replace the whole `effectiveModel` function (lines 176-194) with a version that folds ad-hoc dims **then** custom columns:

```ts
export function effectiveModel(model: QueryModel, q: BuilderQuery): QueryModel {
  let eff = model;

  // 1) Ad-hoc join columns (unchanged behavior).
  const adhoc = q.adhocDimensions ?? [];
  if (adhoc.length) {
    const existing = new Set(eff.dimensions.map((d) => d.key));
    const extra: ModelDimension[] = [];
    for (const a of adhoc) {
      const j = (eff.joins ?? []).find((x) => x.alias === a.join);
      if (!j || !j.optional) throw new Error(`adhoc dimension ${a.key}: unknown or non-optional join: ${a.join}`);
      if (!exposableColumns(eff, a.join).includes(a.column)) throw new Error(`adhoc dimension ${a.key}: column not exposable: ${a.column}`);
      if (existing.has(a.key)) continue;
      extra.push({ key: a.key, label: a.label, column: a.column, kind: a.kind, join: a.join });
      existing.add(a.key);
    }
    if (extra.length) eff = { ...eff, dimensions: [...eff.dimensions, ...extra] };
  }

  // 2) Custom columns → computed-expr dimensions. Operands must reference an existing, NON-computed
  //    dimension (forbids nesting and keeps every operand a column the user could already group by).
  const customs = q.customColumns ?? [];
  if (customs.length) {
    const dims = [...eff.dimensions];
    const keys = new Set(dims.map((d) => d.key));
    for (const c of customs) {
      for (const o of exprOperands(c.expr)) {
        if (o.type !== 'field') continue;
        const ref = dims.find((d) => d.key === o.dimension);
        if (!ref) throw new Error(`custom column ${c.key}: unknown field ${o.dimension}`);
        if (ref.compute) throw new Error(`custom column ${c.key}: field ${o.dimension} is itself computed (not allowed)`);
      }
      if (keys.has(c.key)) continue; // trusted dimension wins / idempotent
      dims.push({ key: c.key, label: c.label, column: '', kind: customColumnKind(c.expr), compute: { kind: 'expr', expr: c.expr } });
      keys.add(c.key);
    }
    eff = { ...eff, dimensions: dims };
  }

  return eff;
}
```

- [ ] **Step 7: Recurse into custom-column operands in `collectUsedJoins`**

In `collectUsedJoins` (line 197), replace the `add` closure so it follows an expr dimension's field operands:

```ts
  const aliases = new Set<string>();
  const add = (dimKey?: string) => {
    if (!dimKey) return;
    const d = model.dimensions.find((x) => x.key === dimKey);
    if (!d) return;
    if (d.join) aliases.add(d.join);
    if (d.compute?.kind === 'expr') for (const o of exprOperands(d.compute.expr)) if (o.type === 'field') add(o.dimension);
  };
```

(Everything below — `add(q.dimension?.key)`, breakdown, filters, tree, metric-where, and the `.map(...)` that resolves aliases to joins — stays as-is.)

- [ ] **Step 8: Add the `expr` arm to the dimension and breakdown paths**

In the group-by block (line 246), change the age-band guard and add an expr arm:

```ts
  if (q.dimension) {
    const d = dim(model, q.dimension.key);
    if (d.compute?.kind === 'age-band') {
      const { label, rank } = ageBandExprs(d, q.dimension.reference);
      qb = qb.select(label.as('label') as never).groupBy(label as never).groupBy(rank as never).orderBy(rank as never);
    } else if (d.compute?.kind === 'expr') {
      const e = exprToSql(model, d.compute.expr, qualify);
      qb = qb.select(e.as('label') as never).groupBy(e as never).orderBy(e as never);
    } else {
      const ref = colName(model, q.dimension.key, qualify);
      qb = qb.select(sql.ref(ref).as('label')).groupBy(ref as never).orderBy(ref as never);
    }
  }
```

In the breakdown block (line 258), the same three-way branch:

```ts
  if (!wide && q.breakdown) {
    const b = dim(model, q.breakdown.key);
    if (b.compute?.kind === 'age-band') {
      const { label, rank } = ageBandExprs(b, undefined);
      qb = qb.select(label.as('series') as never).groupBy(label as never).groupBy(rank as never).orderBy(rank as never);
    } else if (b.compute?.kind === 'expr') {
      const e = exprToSql(model, b.compute.expr, qualify);
      qb = qb.select(e.as('series') as never).groupBy(e as never).orderBy(e as never);
    } else {
      const ref = colName(model, q.breakdown.key, qualify);
      qb = qb.select(sql.ref(ref).as('series')).groupBy(ref as never).orderBy(ref as never);
    }
  }
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `pnpm --filter @openldr/dashboards test -- compile.test.ts`
Expected: PASS (new `custom columns` block green; existing age-band, join, filter suites still green — the age-band guard now keys on `kind === 'age-band'`, which is unchanged behavior).

- [ ] **Step 10: Commit**

```bash
git add packages/dashboards/src/models/registry.ts packages/dashboards/src/compile.ts packages/dashboards/src/compile.test.ts
git commit -m "feat(dashboards): compile row-level custom columns (concat/arithmetic) as computed dimensions"
```

---

### Task 3: Studio types + pure model helpers

**Files:**
- Modify: `apps/studio/src/api.ts` (add types + `customColumns` on the client `WidgetQuery`)
- Create: `apps/studio/src/dashboard/editor/customColumns.model.ts`
- Test: `apps/studio/src/dashboard/editor/customColumns.model.test.ts`

- [ ] **Step 1: Add the client types**

In `api.ts`, add above `WidgetQuery` (near line 266):

```ts
export type CustomColumnOperand =
  | { type: 'field'; dimension: string }
  | { type: 'string'; value: string }
  | { type: 'number'; value: number };
export type CustomColumnExpr =
  | { kind: 'concat'; parts: CustomColumnOperand[] }
  | { kind: 'arithmetic'; op: '+' | '-' | '*' | '/'; left: CustomColumnOperand; right: CustomColumnOperand };
export interface CustomColumn { key: string; label: string; expr: CustomColumnExpr }
```

Add `customColumns` to the builder branch of `WidgetQuery` (next to `adhocDimensions`, line 274):

```ts
      customColumns?: CustomColumn[];
```

- [ ] **Step 2: Write the failing helper tests**

Create `customColumns.model.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { addCustomColumn, updateCustomColumn, removeCustomColumn, uniqueCustomKey, customColumnKind, deriveCustomLabel } from './customColumns.model';
import { setDimensionPatch, type BuilderQuery } from './builderForm.model';

const q0 = () => ({ mode: 'builder' as const, model: 'service_requests', metric: { key: 'count', agg: 'count', label: 'Count' }, filters: [] }) as BuilderQuery;
const col = { key: 'custom', label: 'S/P', expr: { kind: 'concat' as const, parts: [{ type: 'field' as const, dimension: 'status' }] } };

describe('customColumns.model', () => {
  it('customColumnKind maps concat→string, arithmetic→number', () => {
    expect(customColumnKind({ kind: 'concat', parts: [{ type: 'string', value: 'x' }] })).toBe('string');
    expect(customColumnKind({ kind: 'arithmetic', op: '+', left: { type: 'number', value: 1 }, right: { type: 'number', value: 2 } })).toBe('number');
  });

  it('uniqueCustomKey avoids collisions', () => {
    expect(uniqueCustomKey([])).toBe('custom');
    expect(uniqueCustomKey([{ key: 'custom', label: '', expr: { kind: 'concat', parts: [] } }])).toBe('custom-2');
  });

  it('deriveCustomLabel builds a readable default', () => {
    const dimLabel = (k: string) => ({ status: 'Status', priority: 'Priority' }[k] ?? k);
    expect(deriveCustomLabel({ kind: 'concat', parts: [{ type: 'field', dimension: 'status' }, { type: 'string', value: '/' }, { type: 'field', dimension: 'priority' }] }, dimLabel)).toBe('Status + "/" + Priority');
    expect(deriveCustomLabel({ kind: 'arithmetic', op: '/', left: { type: 'field', dimension: 'status' }, right: { type: 'number', value: 1000 } }, dimLabel)).toBe('Status / 1000');
  });

  it('addCustomColumn appends and dedupes by key', () => {
    const a = addCustomColumn(q0(), col);
    expect(a.customColumns).toEqual([col]);
    expect(addCustomColumn(a, col).customColumns).toEqual([col]); // no duplicate
  });

  it('updateCustomColumn patches one column by key', () => {
    const a = addCustomColumn(q0(), col);
    const b = updateCustomColumn(a, 'custom', { label: 'Renamed' });
    expect(b.customColumns![0].label).toBe('Renamed');
  });

  it('removeCustomColumn drops it and orphan-cleans a group-by that referenced it', () => {
    let q = addCustomColumn(q0(), col);
    q = setDimensionPatch(q, 'custom');
    const next = removeCustomColumn(q, 'custom');
    expect(next.customColumns).toEqual([]);
    expect(next.dimension).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @openldr/studio test -- customColumns.model.test.ts`
Expected: FAIL — module `./customColumns.model` does not exist.

- [ ] **Step 4: Implement `customColumns.model.ts`**

```ts
// Pure state-transition helpers for user-authored custom columns (row-level computed dimensions).
// React/DOM-free so they're unit-testable — see CustomColumnEditor.tsx for the shell.

import type { BuilderQuery } from './builderForm.model';
import type { CustomColumn, CustomColumnExpr, CustomColumnOperand } from '../../api';
import { pruneDimensions, type TreeGroup } from './conditionTree.model';

export type { CustomColumn, CustomColumnExpr, CustomColumnOperand };

/** concat → string, arithmetic → number (mirrors the server's customColumnKind). */
export function customColumnKind(expr: CustomColumnExpr): 'string' | 'number' {
  return expr.kind === 'concat' ? 'string' : 'number';
}

/** `custom`, then `custom-2`, `custom-3`, … until it doesn't collide. */
export function uniqueCustomKey(list: CustomColumn[], base = 'custom'): string {
  const keys = new Set(list.map((c) => c.key));
  if (!keys.has(base)) return base;
  let n = 2;
  while (keys.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

const operandLabel = (o: CustomColumnOperand, dimLabel: (k: string) => string): string =>
  o.type === 'field' ? dimLabel(o.dimension) : o.type === 'string' ? `"${o.value}"` : String(o.value);

/** A readable default label, e.g. `Status + "/" + Priority` or `Value / 1000`. */
export function deriveCustomLabel(expr: CustomColumnExpr, dimLabel: (k: string) => string): string {
  if (expr.kind === 'concat') return expr.parts.map((p) => operandLabel(p, dimLabel)).join(' + ');
  return `${operandLabel(expr.left, dimLabel)} ${expr.op} ${operandLabel(expr.right, dimLabel)}`;
}

/** Append a custom column (dedupe by key). */
export function addCustomColumn(value: BuilderQuery, col: CustomColumn): BuilderQuery {
  const list = value.customColumns ?? [];
  if (list.some((c) => c.key === col.key)) return value;
  return { ...value, customColumns: [...list, col] };
}

/** Patch one custom column by key. */
export function updateCustomColumn(value: BuilderQuery, key: string, patch: Partial<CustomColumn>): BuilderQuery {
  return { ...value, customColumns: (value.customColumns ?? []).map((c) => (c.key === key ? { ...c, ...patch } : c)) };
}

/** Remove a custom column and clear every reference it left behind (group-by, breakdown, filters, tree). */
export function removeCustomColumn(value: BuilderQuery, key: string): BuilderQuery {
  const next: BuilderQuery = { ...value, customColumns: (value.customColumns ?? []).filter((c) => c.key !== key) };
  if (next.dimension?.key === key) next.dimension = undefined;
  if (next.breakdown?.key === key) next.breakdown = undefined;
  if (next.filters?.length) next.filters = next.filters.filter((f) => f.dimension !== key);
  if (next.filterTree) next.filterTree = pruneDimensions(next.filterTree as TreeGroup, new Set([key])) as BuilderQuery['filterTree'];
  return next;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/studio test -- customColumns.model.test.ts` and `pnpm --filter @openldr/studio typecheck`
Expected: PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/dashboard/editor/customColumns.model.ts apps/studio/src/dashboard/editor/customColumns.model.test.ts
git commit -m "feat(studio): custom-column client types + pure add/update/remove/label helpers"
```

---

### Task 4: `CustomColumnEditor` component

**Files:**
- Create: `apps/studio/src/dashboard/editor/CustomColumnEditor.tsx`
- Test: `apps/studio/src/dashboard/editor/CustomColumnEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `CustomColumnEditor.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CustomColumnEditor } from './CustomColumnEditor';

const dims = [
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
];

describe('CustomColumnEditor', () => {
  it('renders the operation select and a concat operand row by default', () => {
    render(<CustomColumnEditor dims={dims} existing={[]} onAdd={() => {}} onCancel={() => {}} />);
    expect(screen.getByLabelText('Operation')).toBeInTheDocument();
    expect(screen.getByLabelText('Operand type')).toBeInTheDocument();
  });

  it('shows an operator select after switching to Arithmetic', () => {
    render(<CustomColumnEditor dims={dims} existing={[]} onAdd={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByLabelText('Operation'));
    fireEvent.click(screen.getByRole('option', { name: /arithmetic/i }));
    expect(screen.getByLabelText('Operator')).toBeInTheDocument();
  });

  it('emits a concat custom column built from a chosen field', () => {
    const onAdd = vi.fn();
    render(<CustomColumnEditor dims={dims} existing={[]} onAdd={onAdd} onCancel={() => {}} />);
    // The default operand type is 'field'; pick 'Status' via the real Radix Select.
    fireEvent.click(screen.getByLabelText('Operand field'));
    fireEvent.click(screen.getByRole('option', { name: 'Status' }));
    fireEvent.click(screen.getByRole('button', { name: /add column/i }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      key: 'custom',
      label: 'Status',
      expr: { kind: 'concat', parts: [{ type: 'field', dimension: 'status' }] },
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- CustomColumnEditor.test.tsx`
Expected: FAIL — module `./CustomColumnEditor` does not exist.

- [ ] **Step 3: Implement `CustomColumnEditor.tsx`**

```tsx
import { useState } from 'react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { uniqueCustomKey, deriveCustomLabel, type CustomColumn, type CustomColumnExpr, type CustomColumnOperand } from './customColumns.model';

type Dim = { key: string; label: string };

const defaultOperand = (t: CustomColumnOperand['type']): CustomColumnOperand =>
  t === 'field' ? { type: 'field', dimension: '' } : t === 'string' ? { type: 'string', value: '' } : { type: 'number', value: 0 };

/** One operand: a field reference or a literal. `allowString` is false for arithmetic operands. */
function OperandInput({ operand, dims, allowString, onChange }: {
  operand: CustomColumnOperand; dims: Dim[]; allowString: boolean; onChange: (o: CustomColumnOperand) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Select value={operand.type} onValueChange={(t) => onChange(defaultOperand(t as CustomColumnOperand['type']))}>
        <SelectTrigger aria-label="Operand type" className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="field">Field</SelectItem>
          {allowString && <SelectItem value="string">Text</SelectItem>}
          <SelectItem value="number">Number</SelectItem>
        </SelectContent>
      </Select>
      {operand.type === 'field' ? (
        <Select value={operand.dimension} onValueChange={(d) => onChange({ type: 'field', dimension: d })}>
          <SelectTrigger aria-label="Operand field" className="h-7 flex-1 text-xs"><SelectValue placeholder="Field" /></SelectTrigger>
          <SelectContent>{dims.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
        </Select>
      ) : operand.type === 'string' ? (
        <Input aria-label="Operand text" className="h-7 flex-1 text-xs" value={operand.value} onChange={(e) => onChange({ type: 'string', value: e.target.value })} />
      ) : (
        <Input aria-label="Operand number" type="number" className="h-7 flex-1 text-xs" value={operand.value} onChange={(e) => onChange({ type: 'number', value: Number(e.target.value) })} />
      )}
    </div>
  );
}

export function CustomColumnEditor({ dims, existing, onAdd, onCancel }: {
  dims: Dim[]; existing: CustomColumn[]; onAdd: (col: CustomColumn) => void; onCancel: () => void;
}) {
  const [kind, setKind] = useState<'concat' | 'arithmetic'>('concat');
  const [parts, setParts] = useState<CustomColumnOperand[]>([defaultOperand('field')]);
  const [left, setLeft] = useState<CustomColumnOperand>(defaultOperand('field'));
  const [op, setOp] = useState<'+' | '-' | '*' | '/'>('+');
  const [right, setRight] = useState<CustomColumnOperand>(defaultOperand('number'));
  const [label, setLabel] = useState('');

  const dimLabel = (k: string) => dims.find((d) => d.key === k)?.label ?? k;
  const build = (): CustomColumnExpr =>
    kind === 'concat' ? { kind: 'concat', parts } : { kind: 'arithmetic', op, left, right };

  const confirm = () => {
    const expr = build();
    onAdd({ key: uniqueCustomKey(existing), label: label || deriveCustomLabel(expr, dimLabel), expr });
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2 text-sm">
      <label>
        Operation
        <Select value={kind} onValueChange={(k) => setKind(k as 'concat' | 'arithmetic')}>
          <SelectTrigger aria-label="Operation" className="mt-1 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="concat">Concatenate (text)</SelectItem>
            <SelectItem value="arithmetic">Arithmetic (number)</SelectItem>
          </SelectContent>
        </Select>
      </label>

      {kind === 'concat' ? (
        <div className="flex flex-col gap-1">
          {parts.map((p, i) => (
            <OperandInput key={i} operand={p} dims={dims} allowString onChange={(o) => setParts(parts.map((x, j) => (j === i ? o : x)))} />
          ))}
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="ghost" className="h-6 self-start text-[11px]" onClick={() => setParts([...parts, defaultOperand('field')])}>+ part</Button>
            {parts.length > 1 && (
              <Button type="button" size="sm" variant="ghost" className="h-6 self-start text-[11px]" onClick={() => setParts(parts.slice(0, -1))}>− part</Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <OperandInput operand={left} dims={dims} allowString={false} onChange={setLeft} />
          <Select value={op} onValueChange={(v) => setOp(v as '+' | '-' | '*' | '/')}>
            <SelectTrigger aria-label="Operator" className="h-7 w-14 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{['+', '-', '*', '/'].map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
          </Select>
          <OperandInput operand={right} dims={dims} allowString={false} onChange={setRight} />
        </div>
      )}

      <label>
        Label
        <Input aria-label="Custom column label" className="mt-1 h-8" placeholder="(auto)" value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>

      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={confirm}>Add column</Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio test -- CustomColumnEditor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/dashboard/editor/CustomColumnEditor.tsx apps/studio/src/dashboard/editor/CustomColumnEditor.test.tsx
git commit -m "feat(studio): CustomColumnEditor (structured concat/arithmetic, no free-text)"
```

---

### Task 5: Wire `BuilderForm` — dimOptions, filter exclusion, tile, editor, card

**Files:**
- Modify: `apps/studio/src/dashboard/editor/BuilderForm.tsx`
- Test: `apps/studio/src/dashboard/editor/BuilderForm.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append a block to `BuilderForm.test.tsx` (reuse the top-level `models`/`base` from the file):

```ts
describe('BuilderForm custom columns', () => {
  it('offers a "Custom column" tile', () => {
    render(<BuilderForm models={models} value={base} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /custom column/i })).toBeInTheDocument();
  });

  it('renders active custom columns in a card and removes one on ×', () => {
    const onChange = vi.fn();
    const value = { ...base, customColumns: [{ key: 'sp', label: 'Status/Priority', expr: { kind: 'concat', parts: [{ type: 'field', dimension: 'status' }] } }] } as never;
    render(<BuilderForm models={models} value={value} onChange={onChange} />);
    expect(screen.getByText('Status/Priority')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /remove Status\/Priority/i }));
    const last = onChange.mock.calls.at(-1)![0];
    expect(last.customColumns ?? []).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/studio test -- BuilderForm.test.tsx -t "custom columns"`
Expected: FAIL — no "Custom column" tile; no custom-columns card.

- [ ] **Step 3: Update imports in `BuilderForm.tsx`**

Add `Calculator` to the lucide import (line 3):

```ts
import { Sigma, Filter, Rows3, Columns3, ArrowUpDown, Combine, Calculator, type LucideIcon } from 'lucide-react';
```

Add the editor + helpers imports (after the `JoinDataPicker` import):

```ts
import { CustomColumnEditor } from './CustomColumnEditor';
import { addCustomColumn, removeCustomColumn, customColumnKind } from './customColumns.model';
```

- [ ] **Step 4: Extend dimOptions, add a filter-only list, and editor state**

In the component body, after the `dimOptions` definition (line 71-74), add custom columns to it and derive a filter-safe list + editor operand list:

```ts
  const customColumns = value.customColumns ?? [];
  // Custom columns are first-class group-by/breakdown dimensions (kind derived from their expr).
  dimOptions.push(...customColumns.map((c) => ({ key: c.key, label: c.label, column: '', kind: customColumnKind(c.expr) })));
  // Filters can't reference a computed expression in v1 → exclude custom columns from the filter list.
  const filterDimOptions = dimOptions.filter((d) => !customColumns.some((c) => c.key === d.key));
  // Operands may reference only plain (non-computed) dimensions: model dims (minus age-band) + ad-hoc.
  const operandDims = [
    ...(model?.dimensions ?? []).filter((d) => !d.compute).map((d) => ({ key: d.key, label: d.label })),
    ...adhoc.map((a) => ({ key: a.key, label: a.label })),
  ];
```

Add the editor toggle state next to `showPicker` (line 76):

```ts
  const [showCustom, setShowCustom] = useState(false);
```

Change the Filter section's `dimensions` prop (line 113) from `dimOptions` to `filterDimOptions`:

```tsx
          dimensions={filterDimOptions}
```

- [ ] **Step 5: Render the custom-columns card**

In `visibleBlocks`, after the per-relationship join cards, append a custom-columns card:

```tsx
    ...(customColumns.length > 0
      ? [
          <SectionCard key="__customcols__" label="Custom columns" onRemove={() => onChange(customColumns.reduce((q, c) => removeCustomColumn(q, c.key), value))}>
            <div className="flex flex-wrap gap-1">
              {customColumns.map((c) => (
                <span key={c.key} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
                  {c.label}
                  <button type="button" aria-label={`Remove ${c.label}`} onClick={() => onChange(removeCustomColumn(value, c.key))}>×</button>
                </span>
              ))}
            </div>
          </SectionCard>,
        ]
      : []),
```

- [ ] **Step 6: Add the tile + render the editor**

In the `addBlock` definition, render the editor when `showCustom` (add this branch ahead of the tiles branch — e.g. make the ternary chain `showPicker ? <JoinDataPicker…> : showCustom ? <editor> : hasTiles ? <tiles> : null`):

```tsx
    ) : showCustom ? (
      <div className="pt-2">
        <CustomColumnEditor
          dims={operandDims}
          existing={customColumns}
          onAdd={(col) => { onChange(addCustomColumn(value, col)); setShowCustom(false); }}
          onCancel={() => setShowCustom(false)}
        />
      </div>
    ) : hasTiles ? (
```

Add a "Custom column" tile in the tiles row (after the Join-column tile block, before the tiles `</div>`):

```tsx
        <button
          type="button"
          onClick={() => setShowCustom(true)}
          className="flex min-w-[76px] flex-col items-center gap-1 rounded-md border border-border bg-card px-3 py-2 text-xs hover:bg-muted"
        >
          <Calculator size={16} aria-hidden="true" />
          Custom column
        </button>
```

Since "Custom column" is always offered once a model is selected, make the tiles row always render — change the `hasTiles` guard (line 217) to:

```ts
  const hasTiles = true; // section tiles and/or Join column may vary, but Custom column is always offered
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @openldr/studio test -- BuilderForm.test.tsx`
Expected: PASS (new custom-columns tests green; existing section/join tests still green).

- [ ] **Step 8: Commit**

```bash
git add apps/studio/src/dashboard/editor/BuilderForm.tsx apps/studio/src/dashboard/editor/BuilderForm.test.tsx
git commit -m "feat(studio): add Custom column to the builder (tile, editor, card, group-by/breakdown option)"
```

---

### Task 6: Full-suite verification

- [ ] **Step 1: Run the affected package suites**

Run: `pnpm --filter @openldr/dashboards test && pnpm --filter @openldr/studio test`
Expected: all green.

- [ ] **Step 2: Typecheck the touched packages**

Run: `pnpm --filter @openldr/dashboards typecheck && pnpm --filter @openldr/studio typecheck`
Expected: clean.

- [ ] **Step 3 (manual smoke, optional):** Launch studio, open the widget builder on **Test Orders**, click **Custom column**, choose **Concatenate**, add fields **Status** and **Priority** with a `" / "` literal between, **Add column**; confirm it appears in the Custom columns card and as a **Group by** option, and the widget renders grouped by the concatenated key. Then add an **Arithmetic** column and confirm div-by-zero produces no error.

---

## Self-Review

**Spec coverage:**
- "Row-level computed dimension, structured, no parser" → Task 1 (schemas) + Task 2 (`exprToSql`, bound literals).
- "concat + binary arithmetic; operands = curated dimensions or literals" → Task 1 schema + Task 2 fold validation (operands must be existing, non-computed dims).
- "Fold into effective model as a computed dimension; SELECT/GROUP BY like age-band" → Task 2 Steps 6, 8.
- "collectUsedJoins recurses into operand joins" → Task 2 Step 7.
- "div-by-zero → nullif" → Task 2 Step 4 + test.
- "Server-side rejection of unknown/foreign operands" → Task 2 Step 6 + tests (unknown field, nested/computed).
- "Selectable in Group by / Breakdown" → Task 5 (dimOptions). **Filter is explicitly deferred** (see Scope) — documented deviation, enforced by the `colName` guard + `filterDimOptions`.
- "Studio editor, patch helpers, orphan cleanup, custom-columns card" → Tasks 3, 4, 5.
- Dialect note → resolved better than the spec: `CONCAT()` is portable across the 3 runtime engines, so **no engine threading** (documented up top).

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `Expr`/`Operand`/`CustomColumn` (dashboards, Task 1) mirror `CustomColumnExpr`/`CustomColumnOperand`/`CustomColumn` (studio, Task 3); `customColumnKind` exists in both packages (server derives kind in the fold, client derives kind for dimOptions/editor); `CustomColumnEditor` props (`dims`, `existing`, `onAdd`, `onCancel`) match between Task 4 and Task 5; `ModelDimension.compute` union widened in Task 2 Step 1 before `compile.ts` uses `compute.kind === 'expr'`.

**Notes / assumptions to verify at execution time:**
- Radix `<Select>` interaction under jsdom works via the repo's `setupTests.ts` polyfills (proven by `JoinColumnPicker.test.tsx`); the `CustomColumnEditor` "emit" test uses one such interaction.
- `pruneDimensions(tree, Set<string>)` signature confirmed via `builderForm.model.ts`.
- If the repo's test/typecheck invocation differs from `pnpm --filter <pkg> …`, adapt the commands — test *content* is unaffected.
