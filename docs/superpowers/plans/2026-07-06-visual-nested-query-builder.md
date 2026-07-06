# Visual (Nested AND/OR) Query Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let report authors build nested AND/OR filter logic in a visual editor that compiles to correct SQL, via an additive `filterTree` on the builder query, a recursive Kysely compiler, and a lightweight recursive shadcn editor behind a Simple/Advanced toggle.

**Architecture:** A recursive `ConditionGroup` schema + optional `filterTree` in `@openldr/dashboards` (additive; supersedes flat `filters` when present). A recursive compiler emits `eb.and`/`eb.or`. `@openldr/report-builder`'s `resolveQueryParams` and `lintReportTemplate` recurse the tree. `apps/studio`'s report-builder `QueryEditor` gets a Simple/Advanced toggle and a recursive `QueryGroupEditor`.

**Tech Stack:** TypeScript, Zod (recursive `z.lazy`), Kysely expression builder (`eb.and`/`eb.or`), React + shadcn/Tailwind, react-i18next (en/fr/pt typed `EnShape`), Vitest + Testing Library.

**Build order:** schema → compiler → param-resolve → lint (the capability, all backend/pure) → tree model → RuleValueEditor extraction → recursive editor → toggle + i18n (the UI) → forced gate. The UI can't store a tree until the schema exists; the compiler/resolve/lint are independent of the UI and land first so the capability is testable end-to-end before any React.

**Pre-existing facts (do not re-derive):**
- `applyFilters` (`packages/dashboards/src/compile.ts:86-108`) applies flat filters as chained `.where(...)` — all-AND, no OR/nesting. `compileBuilderQuery` calls it at line 141.
- `dim(model, key)` returns the model dimension (`.column`); `likePattern(v)` builds the `contains` LIKE pattern; `sql` is imported from kysely — all already in `compile.ts`. Reuse them.
- `QueryFilterSchema` (`types.ts:18`) = `z.object({ dimension, op: z.enum(FILTER_OPS), value })`; `FILTER_OPS = ['eq','in','contains','gte','lte','between']` (`types.ts:12`). The builder `WidgetQuerySchema` variant is at `types.ts:53-63`.
- `resolveQueryParams` (`packages/report-builder/src/render/run-template.ts:25-39`) substitutes `{{param.*}}` + blank-drops flat filters via `subst`/`isBlankValue` (same file).
- `lintReportTemplate`'s `paramRefs` (`packages/report-builder/src/lint.ts:26-38`) scans flat filter values for `{{param.<id>}}`.
- `apps/studio/src/api.ts:259-267` hand-mirrors `WidgetQuery` (builder union member has `filters`, `breakdown`, etc.) — must be kept in sync.
- `FilterListEditor.tsx` inlines the literal⇄param value control (`literalToValue`/`valueToLiteral`/`isParamValue`/`paramId`, the value/param toggle + select + Input).

---

## Task 1: Recursive condition schema (`@openldr/dashboards`)

**Files:**
- Modify: `packages/dashboards/src/types.ts` (after `QueryFilterSchema`, ~line 22; and the builder `WidgetQuerySchema` variant ~line 61)
- Test: `packages/dashboards/src/types.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/dashboards/src/types.test.ts`:

```ts
import { ConditionGroupSchema, WidgetQuerySchema } from './types';

describe('ConditionGroup (nested filter tree)', () => {
  const tree = {
    kind: 'group', combinator: 'and',
    children: [
      { kind: 'rule', dimension: 'status', op: 'eq', value: 'completed' },
      { kind: 'group', combinator: 'or', children: [
        { kind: 'rule', dimension: 'code_text', op: 'eq', value: 'Blood culture' },
        { kind: 'rule', dimension: 'code_text', op: 'eq', value: 'Urine culture' },
      ] },
    ],
  };

  it('parses an arbitrarily nested AND/OR tree', () => {
    const parsed = ConditionGroupSchema.parse(tree);
    expect(parsed.combinator).toBe('and');
    expect(parsed.children).toHaveLength(2);
  });

  it('accepts a builder query carrying a filterTree', () => {
    const q = WidgetQuerySchema.parse({ mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [], filterTree: tree });
    expect(q).toMatchObject({ mode: 'builder', filterTree: { combinator: 'and' } });
  });

  it('a builder query with no filterTree still parses (backward-compat)', () => {
    const q = WidgetQuerySchema.parse({ mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] });
    expect(q).not.toHaveProperty('filterTree');
  });

  it('rejects an unknown combinator', () => {
    expect(() => ConditionGroupSchema.parse({ kind: 'group', combinator: 'nand', children: [] })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/dashboards test -- types.test.ts`
Expected: FAIL — `ConditionGroupSchema` is not exported.

- [ ] **Step 3: Implement the schema**

In `packages/dashboards/src/types.ts`, immediately after `QueryFilterSchema`/`QueryFilter` (~line 22), add:

```ts
// A single condition — reuses the flat filter shape (dimension/op/value) plus a discriminant.
export const ConditionRuleSchema = QueryFilterSchema.extend({ kind: z.literal('rule') });
export type ConditionRule = z.infer<typeof ConditionRuleSchema>;

// A recursive AND/OR group of rules and nested groups. Zod needs z.lazy + an explicit type.
export type ConditionNode = ConditionRule | ConditionGroup;
export interface ConditionGroup { kind: 'group'; combinator: 'and' | 'or'; children: ConditionNode[] }
export const ConditionGroupSchema: z.ZodType<ConditionGroup> = z.lazy(() =>
  z.object({
    kind: z.literal('group'),
    combinator: z.enum(['and', 'or']),
    children: z.array(z.union([ConditionRuleSchema, ConditionGroupSchema])),
  }),
);
```

Then in the builder variant of `WidgetQuerySchema` (the `z.object({ mode: z.literal('builder'), ... })` around line 61), add one field after `filters`:

```ts
    filters: z.array(QueryFilterSchema).default([]),
    filterTree: ConditionGroupSchema.optional(), // recursive AND/OR tree; supersedes `filters` when present
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/dashboards test -- types.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the package typecheck**

Run: `pnpm --filter @openldr/dashboards typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboards/src/types.ts packages/dashboards/src/types.test.ts
git commit -m "feat(dashboards): recursive ConditionGroup schema + optional filterTree"
```

---

## Task 2: Recursive compiler (`@openldr/dashboards`)

**Files:**
- Modify: `packages/dashboards/src/compile.ts` (add helpers near `applyFilters` ~line 86; branch in `compileBuilderQuery` ~line 141)
- Test: `packages/dashboards/src/compile.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/dashboards/src/compile.test.ts` (match the file's existing import of `compileBuilderQuery`, `getModel`/model fixture, and its SQL-inspection style — read the top of the file first to reuse its `db`/model setup and its `.compile().sql` assertions):

```ts
describe('compileBuilderQuery filterTree (nested AND/OR)', () => {
  const model = getModel('service_requests')!; // adjust to the file's existing model-fetch helper

  it('compiles a nested AND/OR tree into and/or SQL', () => {
    const q = {
      mode: 'builder' as const, model: 'service_requests',
      metric: { key: 'count', agg: 'count' as const }, filters: [],
      filterTree: { kind: 'group', combinator: 'and', children: [
        { kind: 'rule', dimension: 'status', op: 'eq', value: 'completed' },
        { kind: 'group', combinator: 'or', children: [
          { kind: 'rule', dimension: 'code_text', op: 'eq', value: 'Blood culture' },
          { kind: 'rule', dimension: 'code_text', op: 'eq', value: 'Urine culture' },
        ] },
      ] },
    };
    const { sql } = compileBuilderQuery(db, model, q).compile();
    expect(sql).toMatch(/where/i);
    expect(sql).toMatch(/\bor\b/i);   // the OR subgroup
    expect(sql).toMatch(/\band\b/i);  // the AND root
  });

  it('ignores flat filters when a filterTree is present (precedence)', () => {
    const q = {
      mode: 'builder' as const, model: 'service_requests',
      metric: { key: 'count', agg: 'count' as const },
      filters: [{ dimension: 'priority', op: 'eq', value: 'urgent' }],
      filterTree: { kind: 'group', combinator: 'and', children: [ { kind: 'rule', dimension: 'status', op: 'eq', value: 'completed' } ] },
    };
    const { sql } = compileBuilderQuery(db, model, q).compile();
    expect(sql).not.toMatch(/priority/i); // flat filter superseded
  });

  it('emits SQL identical to today when no filterTree (backward-compat)', () => {
    const q = { mode: 'builder' as const, model: 'service_requests', metric: { key: 'count', agg: 'count' as const }, filters: [{ dimension: 'status', op: 'eq', value: 'completed' }] };
    const { sql } = compileBuilderQuery(db, model, q).compile();
    expect(sql).toMatch(/where/i);
    expect(sql).toMatch(/status/i);
    expect(sql).not.toMatch(/\bor\b/i);
  });
});
```

Note: match the exact `db`/model construction the existing `compile.test.ts` uses (it already tests `compileBuilderQuery`). If the model-fetch helper differs from `getModel`, use the file's convention. Do NOT weaken the OR/AND assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/dashboards test -- compile.test.ts`
Expected: FAIL — `filterTree` is ignored (no OR in the SQL).

- [ ] **Step 3: Implement the recursive compiler**

In `packages/dashboards/src/compile.ts`, add above `compileBuilderQuery` (after `applyFilters`, ~line 109). Type `eb`/return loosely (`any`) to match the file's `AnyQB`/`as never` convention:

```ts
// True iff the tree contains at least one rule (so it produces a predicate).
function treeHasRules(node: ConditionNode): boolean {
  return node.kind === 'rule' ? true : node.children.some(treeHasRules);
}

// Compile one rule to a Kysely expression, mirroring applyFilters' operator logic.
function compileRule(eb: any, model: QueryModel, rule: ConditionRule): any {
  const ref = dim(model, rule.dimension).column as never;
  const v = rule.value;
  switch (rule.op) {
    case 'in': return eb(ref, 'in', (Array.isArray(v) ? v : [v]) as never);
    case 'contains': return eb(ref, 'like', likePattern(v) as never);
    case 'gte': return eb(ref, '>=', v as never);
    case 'lte': return eb(ref, '<=', v as never);
    case 'between':
      return Array.isArray(v) && v.length === 2
        ? eb.and([eb(ref, '>=', v[0] as never), eb(ref, '<=', v[1] as never)])
        : null;
    case 'eq':
    default: return eb(ref, '=', v as never);
  }
}

// Compile a node; returns null for an empty group (no rule descendants) so callers can skip it.
function compileNode(eb: any, model: QueryModel, node: ConditionNode): any {
  if (node.kind === 'rule') return node.value === null ? null : compileRule(eb, model, node);
  const parts = node.children.map((c) => compileNode(eb, model, c)).filter((p: any) => p != null);
  if (parts.length === 0) return null;
  return node.combinator === 'or' ? eb.or(parts) : eb.and(parts);
}
```

Import the new types at the top of the file (add to the existing `./types` import): `ConditionNode`, `ConditionRule`. `QueryModel` is already imported.

Then change the filter application in `compileBuilderQuery` (line 141) from:

```ts
  qb = applyFilters(qb, model, q.filters ?? []);
```

to:

```ts
  if (q.filterTree) {
    // filterTree supersedes flat filters. An empty tree (no rules) adds no predicate.
    if (treeHasRules(q.filterTree)) qb = qb.where((eb: any) => compileNode(eb, model, q.filterTree!)) as AnyQB;
  } else {
    qb = applyFilters(qb, model, q.filters ?? []);
  }
```

(`treeHasRules` guarantees ≥1 rule, so `compileNode` returns non-null here.) `BuilderQuery` is the compiler's input type — since `filterTree` is now on `WidgetQuerySchema`'s builder variant, `q.filterTree` is typed; no cast needed beyond the existing `as never`/`AnyQB` idioms.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/dashboards test -- compile.test.ts`
Expected: PASS (3 new + existing green).

- [ ] **Step 5: Full package check**

Run: `pnpm --filter @openldr/dashboards typecheck` and `pnpm --filter @openldr/dashboards test`
Expected: clean; all green (existing compile/run tests unaffected — backward-compat branch preserves the flat path).

- [ ] **Step 6: Commit**

```bash
git add packages/dashboards/src/compile.ts packages/dashboards/src/compile.test.ts
git commit -m "feat(dashboards): compile filterTree to nested eb.and/eb.or (supersedes flat filters)"
```

---

## Task 3: `resolveQueryParams` walks the tree (`@openldr/report-builder`)

**Files:**
- Modify: `packages/report-builder/src/render/run-template.ts` (`resolveQueryParams`, ~line 25)
- Test: `packages/report-builder/src/render/run-template.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/report-builder/src/render/run-template.test.ts`:

```ts
import { resolveQueryParams } from './run-template';

describe('resolveQueryParams filterTree', () => {
  const base = { mode: 'builder' as const, model: 'observations', metric: { key: 'count', agg: 'count' as const }, filters: [] };

  it('substitutes a bound param inside a rule', () => {
    const q = { ...base, filterTree: { kind: 'group', combinator: 'and', children: [ { kind: 'rule', dimension: 'effective_date_time', op: 'gte', value: '{{param.from}}' } ] } };
    const r = resolveQueryParams(q, { from: '2026-01-01' }) as any;
    expect(r.filterTree.children[0].value).toBe('2026-01-01');
  });

  it('drops a rule whose param resolves blank, then prunes the emptied group', () => {
    const q = { ...base, filterTree: { kind: 'group', combinator: 'and', children: [
      { kind: 'rule', dimension: 'code_text', op: 'eq', value: 'Blood culture' },
      { kind: 'group', combinator: 'or', children: [ { kind: 'rule', dimension: 'effective_date_time', op: 'gte', value: '{{param.from}}' } ] },
    ] } };
    const r = resolveQueryParams(q, {}) as any; // from is unset
    expect(r.filterTree.children).toHaveLength(1);              // the empty OR subgroup pruned
    expect(r.filterTree.children[0].kind).toBe('rule');
  });

  it('deletes filterTree entirely when the whole tree prunes to empty', () => {
    const q = { ...base, filterTree: { kind: 'group', combinator: 'and', children: [ { kind: 'rule', dimension: 'effective_date_time', op: 'lte', value: '{{param.to}}' } ] } };
    const r = resolveQueryParams(q, {}) as any;
    expect(r.filterTree).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/report-builder test -- run-template.test.ts`
Expected: FAIL — `resolveQueryParams` doesn't touch `filterTree` yet.

- [ ] **Step 3: Implement the recursion**

In `packages/report-builder/src/render/run-template.ts`, add a pure tree-resolver above `resolveQueryParams` (reusing the existing `subst`/`isBlankValue`), and call it in the builder branch:

```ts
// Substitute params in rule values and drop blank rules / emptied groups. Returns null if the
// node resolves to nothing (a blank rule, or a group with no surviving children).
function resolveNode(node: any, params: Record<string, string>): any {
  if (node.kind === 'rule') {
    const value = subst(node.value, params);
    return isBlankValue(value) ? null : { ...node, value };
  }
  const children = node.children.map((c: any) => resolveNode(c, params)).filter((c: any) => c != null);
  return children.length ? { ...node, children } : null;
}
```

Then in `resolveQueryParams`, inside the `if (clone.mode === 'builder') { ... }` block, after the existing `clone.filters = ...` line, add:

```ts
    if ((clone as any).filterTree) {
      const resolved = resolveNode((clone as any).filterTree, params);
      if (resolved) (clone as any).filterTree = resolved; else delete (clone as any).filterTree;
    }
```

(The `as any` matches the file's handling of the loosely-typed clone; `WidgetQuery` from `@openldr/dashboards` now includes `filterTree`, so a cleaner typed access is fine too if it compiles.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/report-builder test -- run-template.test.ts`
Expected: PASS (3 new + existing green — the flat-filter blank-drop path is unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/report-builder/src/render/run-template.ts packages/report-builder/src/render/run-template.test.ts
git commit -m "feat(report-builder): resolveQueryParams substitutes + blank-prunes filterTree"
```

---

## Task 4: `lintReportTemplate` walks the tree (`@openldr/report-builder`)

**Files:**
- Modify: `packages/report-builder/src/lint.ts` (`paramRefs`, ~line 26)
- Test: `packages/report-builder/src/lint.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/report-builder/src/lint.test.ts` (reuse the file's helper for building a minimal template with a data block; match its existing template-construction style):

```ts
describe('lint filterTree param refs', () => {
  function tplWithTreeRule(paramToken: string, params: { id: string; label: string; type: 'text' | 'daterange' }[] = []) {
    return {
      id: 't', name: 'T', description: '', category: 'operational' as const, status: 'draft' as const,
      page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
      parameters: params,
      rows: [{ id: 'r1', cells: [{ colSpan: 12, block: { kind: 'chart' as const, chartType: 'bar' as const, visual: {},
        query: { mode: 'builder' as const, model: 'observations', metric: { key: 'count', agg: 'count' as const }, filters: [],
          filterTree: { kind: 'group', combinator: 'and', children: [ { kind: 'rule', dimension: 'code_text', op: 'eq', value: paramToken } ] } } } }] }],
    };
  }

  it('flags an orphaned param referenced only inside a filterTree rule', () => {
    const issues = lintReportTemplate(tplWithTreeRule('{{param.ghost}}'));
    expect(issues.some((i) => i.code === 'orphaned-param-ref')).toBe(true);
  });

  it('counts a defined param used when bound inside a filterTree rule (no unused warning)', () => {
    const issues = lintReportTemplate(tplWithTreeRule('{{param.site}}', [{ id: 'site', label: 'Site', type: 'text' }]));
    expect(issues.some((i) => i.code === 'orphaned-param-ref')).toBe(false);
    expect(issues.some((i) => i.code === 'unused-parameter' && i.paramId === 'site')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/report-builder test -- lint.test.ts`
Expected: FAIL — `paramRefs` ignores `filterTree`, so `ghost` isn't flagged and `site` reads as unused.

- [ ] **Step 3: Implement the recursion**

In `packages/report-builder/src/lint.ts`, extend `paramRefs` (line 26-38). After the existing `if (q.mode === 'builder') for (const f of q.filters ?? []) scan(f.value);` line, add a tree walk:

```ts
  if (q.mode === 'builder' && (q as { filterTree?: unknown }).filterTree) {
    const walk = (node: any) => {
      if (node.kind === 'rule') scan(node.value);
      else for (const c of node.children) walk(c);
    };
    walk((q as any).filterTree);
  }
```

(Place it inside `paramRefs`, alongside the existing flat-filter scan, before `return ids;`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/report-builder test -- lint.test.ts`
Expected: PASS (2 new + existing green).

- [ ] **Step 5: Commit**

```bash
git add packages/report-builder/src/lint.ts packages/report-builder/src/lint.test.ts
git commit -m "feat(report-builder): lint walks filterTree for param refs"
```

---

## Task 5: Pure tree helpers for the editor (`apps/studio`)

**Files:**
- Create: `apps/studio/src/reports-builder/queryTreeModel.ts`
- Create: `apps/studio/src/reports-builder/queryTreeModel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/studio/src/reports-builder/queryTreeModel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { newRule, newGroup, seedTreeFromFilters, isFlatRepresentable, flattenToFilters, type ConditionGroup } from './queryTreeModel';

const dims = [{ key: 'status', label: 'Status', column: 'status', kind: 'string' as const }];

describe('queryTreeModel', () => {
  it('newRule uses the first dimension and eq/empty defaults', () => {
    expect(newRule(dims)).toEqual({ kind: 'rule', dimension: 'status', op: 'eq', value: '' });
  });
  it('newGroup is an empty AND group', () => {
    expect(newGroup()).toEqual({ kind: 'group', combinator: 'and', children: [] });
  });
  it('seedTreeFromFilters wraps flat filters in one AND group of rules', () => {
    const t = seedTreeFromFilters([{ dimension: 'status', op: 'eq', value: 'completed' }]);
    expect(t).toEqual({ kind: 'group', combinator: 'and', children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: 'completed' }] });
  });
  it('isFlatRepresentable: AND group of only rules → true; OR or nested → false', () => {
    const flat: ConditionGroup = { kind: 'group', combinator: 'and', children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: 'x' }] };
    const or: ConditionGroup = { kind: 'group', combinator: 'or', children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: 'x' }] };
    const nested: ConditionGroup = { kind: 'group', combinator: 'and', children: [{ kind: 'group', combinator: 'and', children: [] }] };
    expect(isFlatRepresentable(flat)).toBe(true);
    expect(isFlatRepresentable(or)).toBe(false);
    expect(isFlatRepresentable(nested)).toBe(false);
  });
  it('flattenToFilters drops the kind discriminant back to flat filters', () => {
    const flat: ConditionGroup = { kind: 'group', combinator: 'and', children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: 'completed' }] };
    expect(flattenToFilters(flat)).toEqual([{ dimension: 'status', op: 'eq', value: 'completed' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- queryTreeModel.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the helpers**

Create `apps/studio/src/reports-builder/queryTreeModel.ts`:

```ts
import type { ModelDimension } from '../api';

// Studio-local mirror of the dashboards ConditionGroup/ConditionRule shapes (kept loose like
// the api.ts WidgetQuery mirror). Rule value mirrors the flat BuilderFilter value (unknown).
export interface ConditionRule { kind: 'rule'; dimension: string; op: string; value: unknown }
export interface ConditionGroup { kind: 'group'; combinator: 'and' | 'or'; children: ConditionNode[] }
export type ConditionNode = ConditionRule | ConditionGroup;

export interface FlatFilter { dimension: string; op: string; value: unknown }

export function newRule(dimensions: ModelDimension[]): ConditionRule {
  return { kind: 'rule', dimension: dimensions[0]?.key ?? '', op: 'eq', value: '' };
}

export function newGroup(): ConditionGroup {
  return { kind: 'group', combinator: 'and', children: [] };
}

export function seedTreeFromFilters(filters: FlatFilter[]): ConditionGroup {
  return { kind: 'group', combinator: 'and', children: filters.map((f) => ({ kind: 'rule', dimension: f.dimension, op: f.op, value: f.value })) };
}

// True iff the tree can be shown as the simple flat list: a single AND group whose children are all rules.
export function isFlatRepresentable(root: ConditionGroup): boolean {
  return root.combinator === 'and' && root.children.every((c) => c.kind === 'rule');
}

export function flattenToFilters(root: ConditionGroup): FlatFilter[] {
  return root.children.filter((c): c is ConditionRule => c.kind === 'rule').map((r) => ({ dimension: r.dimension, op: r.op, value: r.value }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio test -- queryTreeModel.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/queryTreeModel.ts apps/studio/src/reports-builder/queryTreeModel.test.ts
git commit -m "feat(studio): pure query-tree helpers (seed/flatten/flat-representable)"
```

---

## Task 6: Extract `RuleValueEditor` from `FilterListEditor` (`apps/studio`)

**Files:**
- Create: `apps/studio/src/reports-builder/RuleValueEditor.tsx`
- Modify: `apps/studio/src/reports-builder/FilterListEditor.tsx` (consume the extracted component)
- Test: `apps/studio/src/reports-builder/RuleValueEditor.test.tsx` (new); existing `FilterListEditor` tests must stay green.

- [ ] **Step 1: Write the failing test**

Create `apps/studio/src/reports-builder/RuleValueEditor.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { RuleValueEditor } from './RuleValueEditor';

const params = [{ id: 'site', label: 'Site', type: 'text' as const, required: false }];

describe('RuleValueEditor', () => {
  it('edits a literal value', () => {
    const onChange = vi.fn();
    render(<RuleValueEditor op="eq" value="" parameters={[]} onChange={onChange} idPrefix="r0" />);
    fireEvent.change(screen.getByLabelText('r0-value'), { target: { value: 'completed' } });
    expect(onChange).toHaveBeenCalledWith('completed');
  });

  it('switches to param mode and emits a {{param.id}} token', () => {
    const onChange = vi.fn();
    render(<RuleValueEditor op="eq" value="" parameters={params} onChange={onChange} idPrefix="r0" />);
    fireEvent.click(screen.getByLabelText('r0-mode-param'));
    expect(onChange).toHaveBeenCalledWith('{{param.site}}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- RuleValueEditor.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement `RuleValueEditor` and refactor `FilterListEditor`**

Create `apps/studio/src/reports-builder/RuleValueEditor.tsx` by lifting the value/param control out of `FilterListEditor.tsx` (its `literalToValue`/`valueToLiteral`/`isParamValue`/`paramId`/`PARAM_TOKEN` helpers move here and are exported):

```tsx
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ReportParam } from '@openldr/report-builder/pure';

const PARAM_TOKEN = /^\{\{\s*param\.(\w+)\s*\}\}$/;
export function isParamValue(v: unknown): v is string { return typeof v === 'string' && PARAM_TOKEN.test(v); }
export function paramId(v: unknown): string { return typeof v === 'string' ? (v.match(PARAM_TOKEN)?.[1] ?? '') : ''; }
export function literalToValue(op: string, raw: string): unknown {
  if (op === 'in' || op === 'between') return raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
  return raw;
}
export function valueToLiteral(v: unknown): string { return Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v); }

export function RuleValueEditor({ op, value, parameters, onChange, idPrefix }: {
  op: string; value: unknown; parameters: ReportParam[]; onChange: (v: unknown) => void; idPrefix: string;
}): JSX.Element {
  const { t } = useTranslation();
  const paramMode = isParamValue(value);
  return (
    <div className="flex items-center gap-1">
      <div className="flex">
        <Button type="button" size="sm" className="h-7 rounded-r-none px-2 text-[10px]" aria-label={`${idPrefix}-mode-literal`}
          variant={paramMode ? 'outline' : 'default'} onClick={() => onChange('')}>{t('reportBuilder.filters.value')}</Button>
        <Button type="button" size="sm" className="h-7 rounded-l-none px-2 text-[10px]" aria-label={`${idPrefix}-mode-param`}
          variant={paramMode ? 'default' : 'outline'} disabled={parameters.length === 0}
          onClick={() => onChange(`{{param.${parameters[0]?.id ?? ''}}}`)}>{t('reportBuilder.filters.param')}</Button>
      </div>
      {paramMode ? (
        <select aria-label={`${idPrefix}-param`} className="h-7 flex-1 rounded border border-border bg-background text-xs"
          value={paramId(value)} onChange={(e) => onChange(`{{param.${e.target.value}}}`)}>
          {parameters.length === 0 && <option value="">{t('reportBuilder.filters.noParameters')}</option>}
          {parameters.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      ) : (
        <Input aria-label={`${idPrefix}-value`} className="h-7 flex-1 text-xs"
          value={valueToLiteral(value)} onChange={(e) => onChange(literalToValue(op, e.target.value))} />
      )}
    </div>
  );
}
```

Then edit `FilterListEditor.tsx`: remove the now-duplicated helpers and the inline value/param JSX; import `RuleValueEditor` (and, if still needed, the helpers from it), and render `<RuleValueEditor op={f.op} value={f.value} parameters={parameters} onChange={(v) => update(i, { value: v })} idPrefix={\`filter-${i}\`} />` in place of the removed block (keep the existing `filter-${i}-remove` button and the dimension/op selects). The `aria-label`s remain `filter-${i}-value`/`-mode-literal`/`-mode-param`/`-param` via the `idPrefix`, so the existing `FilterListEditor` tests keep matching.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/studio test -- RuleValueEditor FilterListEditor`
Expected: PASS — new RuleValueEditor tests green AND the existing FilterListEditor tests still green (same aria-labels, same behavior).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/RuleValueEditor.tsx apps/studio/src/reports-builder/FilterListEditor.tsx apps/studio/src/reports-builder/RuleValueEditor.test.tsx
git commit -m "refactor(studio): extract RuleValueEditor shared by flat + tree filter editors"
```

---

## Task 7: Recursive `QueryGroupEditor` + api.ts mirror (`apps/studio`)

**Files:**
- Create: `apps/studio/src/reports-builder/QueryGroupEditor.tsx`
- Modify: `apps/studio/src/api.ts` (mirror `filterTree` on the builder `WidgetQuery`)
- Test: `apps/studio/src/reports-builder/QueryGroupEditor.test.tsx` (new)

- [ ] **Step 1: Mirror `filterTree` in `api.ts`**

In `apps/studio/src/api.ts`, add mirror types near the `WidgetQuery` type (~line 259) and the field to the builder union member:

```ts
export interface ConditionRule { kind: 'rule'; dimension: string; op: string; value: unknown }
export interface ConditionGroup { kind: 'group'; combinator: 'and' | 'or'; children: (ConditionRule | ConditionGroup)[] }
```

and inside the builder object (the `{ mode: 'builder'; ... filters: {...}[] }` member), add `filterTree?: ConditionGroup;`.

- [ ] **Step 2: Write the failing test**

Create `apps/studio/src/reports-builder/QueryGroupEditor.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { QueryGroupEditor } from './QueryGroupEditor';
import { newGroup, type ConditionGroup } from './queryTreeModel';

const dims = [{ key: 'status', label: 'Status', column: 'status', kind: 'string' as const }, { key: 'code_text', label: 'Test', column: 'code_text', kind: 'string' as const }];

describe('QueryGroupEditor', () => {
  it('adds a rule to the group', () => {
    const onChange = vi.fn();
    render(<QueryGroupEditor group={newGroup()} dimensions={dims} parameters={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ children: [expect.objectContaining({ kind: 'rule' })] }));
  });

  it('adds a nested group', () => {
    const onChange = vi.fn();
    render(<QueryGroupEditor group={newGroup()} dimensions={dims} parameters={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add group/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ children: [expect.objectContaining({ kind: 'group' })] }));
  });

  it('toggles the combinator to OR', () => {
    const onChange = vi.fn();
    render(<QueryGroupEditor group={newGroup()} dimensions={dims} parameters={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /^or$/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ combinator: 'or' }));
  });

  it('renders a nested group card (recursion)', () => {
    const nested: ConditionGroup = { kind: 'group', combinator: 'and', children: [{ kind: 'group', combinator: 'or', children: [] }] };
    render(<QueryGroupEditor group={nested} dimensions={dims} parameters={[]} onChange={() => {}} />);
    // two combinator toggles present (outer + nested)
    expect(screen.getAllByRole('button', { name: /^and$/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('button', { name: /^or$/i }).length).toBeGreaterThanOrEqual(1);
  });
});
```

(Drop the unused `Harness` if not needed; the tests above use direct props + spies.)

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- QueryGroupEditor.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 4: Implement `QueryGroupEditor`**

Create `apps/studio/src/reports-builder/QueryGroupEditor.tsx`. Each level manages its direct children by index; nested groups recurse:

```tsx
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import type { ModelDimension } from '../api';
import type { ReportParam } from '@openldr/report-builder/pure';
import { RuleValueEditor } from './RuleValueEditor';
import { newRule, newGroup, type ConditionGroup, type ConditionNode, type ConditionRule } from './queryTreeModel';

const OPS = ['eq', 'in', 'contains', 'gte', 'lte', 'between'] as const;

function RuleRow({ rule, dimensions, parameters, onChange, onRemove, idPrefix }: {
  rule: ConditionRule; dimensions: ModelDimension[]; parameters: ReportParam[];
  onChange: (r: ConditionRule) => void; onRemove: () => void; idPrefix: string;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1 rounded border border-border p-2">
      <div className="flex gap-1">
        <select aria-label={`${idPrefix}-dimension`} className="h-7 flex-1 rounded border border-border bg-background text-xs"
          value={rule.dimension} onChange={(e) => onChange({ ...rule, dimension: e.target.value })}>
          {dimensions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
        <select aria-label={`${idPrefix}-op`} className="h-7 w-20 rounded border border-border bg-background text-xs"
          value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value })}>
          {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label={`${idPrefix}-remove`} onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
      </div>
      <RuleValueEditor op={rule.op} value={rule.value} parameters={parameters} onChange={(v) => onChange({ ...rule, value: v })} idPrefix={idPrefix} />
    </div>
  );
}

export function QueryGroupEditor({ group, dimensions, parameters, onChange, onRemove, depth = 0 }: {
  group: ConditionGroup; dimensions: ModelDimension[]; parameters: ReportParam[];
  onChange: (g: ConditionGroup) => void; onRemove?: () => void; depth?: number;
}): JSX.Element {
  const { t } = useTranslation();
  const setChild = (i: number, child: ConditionNode) => onChange({ ...group, children: group.children.map((c, j) => (j === i ? child : c)) });
  const removeChild = (i: number) => onChange({ ...group, children: group.children.filter((_, j) => j !== i) });
  const setComb = (combinator: 'and' | 'or') => onChange({ ...group, combinator });

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2" style={{ marginLeft: depth ? 8 : 0 }}>
      <div className="flex items-center justify-between">
        <div className="flex">
          <Button type="button" size="sm" className="h-7 rounded-r-none px-2 text-[10px]" aria-label="and"
            variant={group.combinator === 'and' ? 'default' : 'outline'} onClick={() => setComb('and')}>{t('reportBuilder.tree.and')}</Button>
          <Button type="button" size="sm" className="h-7 rounded-l-none px-2 text-[10px]" aria-label="or"
            variant={group.combinator === 'or' ? 'default' : 'outline'} onClick={() => setComb('or')}>{t('reportBuilder.tree.or')}</Button>
        </div>
        {onRemove && <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label={t('reportBuilder.tree.removeGroup')} onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>}
      </div>
      {group.children.map((child, i) => child.kind === 'rule'
        ? <RuleRow key={i} rule={child} dimensions={dimensions} parameters={parameters} onChange={(r) => setChild(i, r)} onRemove={() => removeChild(i)} idPrefix={`g${depth}-r${i}`} />
        : <QueryGroupEditor key={i} group={child} dimensions={dimensions} parameters={parameters} onChange={(g) => setChild(i, g)} onRemove={() => removeChild(i)} depth={depth + 1} />)}
      <div className="flex gap-1">
        <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => onChange({ ...group, children: [...group.children, newRule(dimensions)] })}>{t('reportBuilder.tree.addRule')}</Button>
        <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => onChange({ ...group, children: [...group.children, newGroup()] })}>{t('reportBuilder.tree.addGroup')}</Button>
      </div>
    </div>
  );
}
```

Add i18n keys `reportBuilder.tree.{and,or,addRule,addGroup,removeGroup}` to en/fr/pt (see Task 8's i18n block — or add them here and extend in Task 8). To keep this task self-contained, add these five keys now in en/fr/pt; Task 8 adds the toggle keys.

en: `and:'AND', or:'OR', addRule:'Add rule', addGroup:'Add group', removeGroup:'Remove group'`
fr: `and:'ET', or:'OU', addRule:'Ajouter une règle', addGroup:'Ajouter un groupe', removeGroup:'Supprimer le groupe'`
pt: `and:'E', or:'OU', addRule:'Adicionar regra', addGroup:'Adicionar grupo', removeGroup:'Remover grupo'`

(Nest under `reportBuilder.tree`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio test -- QueryGroupEditor i18n`
Expected: PASS (4 editor tests + parity green). Then `pnpm --filter @openldr/studio typecheck` — clean (api.ts mirror compiles).

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/reports-builder/QueryGroupEditor.tsx apps/studio/src/reports-builder/QueryGroupEditor.test.tsx apps/studio/src/api.ts apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): recursive QueryGroupEditor + filterTree api mirror"
```

---

## Task 8: Simple/Advanced toggle in `QueryEditor` (`apps/studio`)

**Files:**
- Modify: `apps/studio/src/reports-builder/QueryEditor.tsx`
- Modify: `apps/studio/src/i18n/{en,fr,pt}.ts` (toggle strings)
- Test: `apps/studio/src/reports-builder/QueryEditor.test.tsx` (append; or create if absent — check first)

- [ ] **Step 1: Add toggle i18n**

Add under `reportBuilder.query` (siblings of `builder`/`sql`) in en/fr/pt:
- en: `simple: 'Simple', advanced: 'Advanced (AND/OR)', revertBlocked: 'Advanced logic can\'t be shown as a simple list'`
- fr: `simple: 'Simple', advanced: 'Avancé (ET/OU)', revertBlocked: 'La logique avancée ne peut pas être affichée en liste simple'`
- pt: `simple: 'Simples', advanced: 'Avançado (E/OU)', revertBlocked: 'A lógica avançada não pode ser exibida como lista simples'`

- [ ] **Step 2: Write the failing test**

Append to `apps/studio/src/reports-builder/QueryEditor.test.tsx` (read the file for its existing render harness + api mock; QueryEditor fetches `listModels`, so reuse the existing mock that returns a model with dimensions). Add:

```tsx
it('switching to Advanced seeds a filterTree from existing flat filters', async () => {
  const onChange = vi.fn();
  const block = { kind: 'chart', chartType: 'bar', visual: {}, query: { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [{ dimension: 'code_text', op: 'eq', value: 'X' }] } };
  renderQueryEditor({ block, onChange }); // use the file's existing render helper/signature
  fireEvent.click(await screen.findByRole('button', { name: /advanced/i }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    query: expect.objectContaining({ filterTree: expect.objectContaining({ combinator: 'and', children: [expect.objectContaining({ kind: 'rule', dimension: 'code_text' })] }) }),
  }));
});
```

Adapt `renderQueryEditor`/`block` construction to the existing test file's helpers and the `QueryEditor` props (`block`, `parameters`, `sqlEnabled`, `onChange`). If no test file exists, create one mirroring the pattern in `ReportBuilderPage.test.tsx` (mock `../api`'s `listModels`).

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- QueryEditor.test.tsx`
Expected: FAIL — no Advanced toggle.

- [ ] **Step 4: Implement the toggle**

In `apps/studio/src/reports-builder/QueryEditor.tsx`:
- import `QueryGroupEditor`, `seedTreeFromFilters`, `isFlatRepresentable`, `flattenToFilters`, `newGroup` from the tree modules.
- Derive advanced mode from the query: `const advanced = !!(builderQuery as { filterTree?: unknown }).filterTree;`
- Render a **Simple / Advanced** segmented toggle in builder mode (next to, or above, the existing filter UI). Simple button is disabled when `advanced && !isFlatRepresentable(filterTree)` (revert guard) — with `title={t('reportBuilder.query.revertBlocked')}`.
  - Clicking **Advanced** (when not advanced): `setQuery({ ...builderQuery, filterTree: seedTreeFromFilters(builderQuery.filters ?? []), filters: [] })`.
  - Clicking **Simple** (when advanced & flat-representable): `setQuery({ ...builderQuery, filters: flattenToFilters(filterTree), filterTree: undefined })`.
- When `advanced`, render `<QueryGroupEditor group={filterTree ?? newGroup()} dimensions={dimensions} parameters={parameters} onChange={(g) => setQuery({ ...builderQuery, filterTree: g })} />` INSTEAD of `<FilterListEditor .../>`; when not advanced, render the existing `<FilterListEditor .../>` unchanged.

Keep the change scoped to the builder-mode filter region (the block that currently renders `FilterListEditor`). Do not alter the SQL-mode or breakdown UI.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio test -- QueryEditor.test.tsx i18n`
Expected: PASS (new toggle test + existing QueryEditor tests + parity). Then `pnpm --filter @openldr/studio typecheck` — clean.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/reports-builder/QueryEditor.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts apps/studio/src/reports-builder/QueryEditor.test.tsx
git commit -m "feat(studio): Simple/Advanced filter toggle wires the nested query editor"
```

---

## Task 9: Forced full-workspace gate

**Files:** none (verification only)

- [ ] **Step 1: Forced typecheck**

Run: `pnpm turbo run typecheck --force`
Expected: `31 successful, 31 total`. Never pipe turbo through `tail`. Fix any consumer that breaks on the widened `WidgetQuery` (server, cli, bootstrap all import it).

- [ ] **Step 2: Forced tests**

Run: `pnpm turbo run test --force`
Expected: green except the two known pre-existing flakes — studio `api.test.ts` (vitest-dedupe) and parallel-load timeouts (plugins/users/etc. that pass in isolation). Re-run any red package in isolation to confirm it's a flake (`pnpm --filter <pkg> test`). A genuine failure in dashboards/report-builder/studio touched code is a regression — fix it.

- [ ] **Step 3: Commit (only if a gate fix was needed)**

```bash
git add -A && git commit -m "fix: resolve cross-package gate breakage from filterTree schema change"
```

---

## Post-plan: review + finish

After Task 9, the subagent-driven flow runs the final holistic review, then `finishing-a-development-branch` (merge `--no-ff` to local `main`, delete branch, update memory). A live visual check (build an `A AND (B OR C)` tree in the running builder — dev stack is up at API `:3000` / vite `:5199` — and confirm the live canvas + Preview PDF reflect the OR logic) closes it out.

---

## Self-review notes (checked against the spec)

- **Spec §Part 1 schema** → Task 1 (ConditionRule/Group + filterTree, additive, backward-compat test). **api.ts mirror** → Task 7 Step 1.
- **Spec §Part 2 compiler** → Task 2 (compileNode/compileRule/treeHasRules + precedence branch + backward-compat SQL test).
- **Spec §3a resolveQueryParams** → Task 3 (substitute + blank-prune rules/groups + delete-when-empty). **§3b lint** → Task 4.
- **Spec §4a RuleValueEditor** → Task 6. **§4b QueryGroupEditor + queryTreeModel** → Tasks 5 + 7. **§4c toggle + revert guard** → Task 8.
- **Spec testing/gate** → per-task tests + Task 9 forced gate.
- **Type consistency:** `ConditionGroup`/`ConditionRule`/`ConditionNode` are defined in dashboards `types.ts` (Task 1), mirrored loosely in studio `queryTreeModel.ts` (Task 5) and `api.ts` (Task 7) — the studio mirrors are intentionally structural (like the existing `WidgetQuery` mirror), not imports, matching the repo convention. `filterTree` field name, `combinator: 'and'|'or'`, `kind: 'rule'|'group'` identical across schema, compiler, resolve, lint, and UI.
- **Precedence** (filterTree supersedes flat filters) implemented in the compiler (Task 2) and enforced in the UI by clearing `filters` on switch-to-Advanced (Task 8).
- **Naming:** `seedTreeFromFilters`/`isFlatRepresentable`/`flattenToFilters`/`newRule`/`newGroup` consistent between Task 5 (definition) and Tasks 7–8 (use).
