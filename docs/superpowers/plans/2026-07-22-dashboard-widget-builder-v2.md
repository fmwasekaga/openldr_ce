# Dashboard Widget Builder v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three capabilities to the guided (no-SQL) dashboard widget builder — Top-N (limit), multi-measure + derived-ratio "Summarize", and an AND/OR filter tree — wiring UI over the already-present dashboards schema/compiler.

**Architecture:** The engine (`packages/dashboards/src/compile.ts`) and schema (`types.ts`) already compile `limit`, `metrics[]` + `MetricSchema.where`/`derived`, and `filterTree`. This plan is UI + pure state-transition helpers in `apps/studio`, following the v1 pattern: all logic lives in pure `*.model.ts` files unit-tested without jsdom; React components are thin shadcn shells with render smoke-tests only. Two touches leave pure-UI territory: extending runtime binding (`bindQuery`) to walk `filterTree`, and relaxing the SQL→Builder recognizer to emit `metrics[]`.

**Tech Stack:** React + TypeScript, shadcn/ui, Zod schema in `@openldr/dashboards`, Kysely compiler, Vitest, React Testing Library.

## Global Constraints

- **shadcn/ui controls only** — never native `<select>`; reuse `@/components/ui/*`.
- **Pure logic in `*.model.ts`, unit-tested; components are smoke-tested only.** Radix Selects are not jsdom-drivable — do not write interaction tests against them; cover behavior through the pure helpers.
- **`recognizeSql` is imported by studio via `@openldr/dashboards/pure`** (the package root pulls kysely into the browser). Never import it from `@openldr/dashboards`.
- **Builder labels are literal JSX strings** (matching existing `BuilderForm.tsx`: `Source`, `Measure`, `Group by` are not `t()`-wrapped). Only reuse `t('widgetEditor.*')` where the surrounding code already does. No new i18n keys are required by this plan.
- **Verify each touched package in isolation.** A repo-wide `turbo test --force` cascades unrelated DB/parallel-load flakes; run the specific package's vitest instead.
  - Studio: `pnpm --filter @openldr/studio test -- <path>`
  - Dashboards: `pnpm --filter @openldr/dashboards test -- <path>`
- **Commit messages: no `Co-Authored-By: Claude` trailer** (repo rule — the user is sole contributor).
- Branch: `builder-v2` (already created; the spec is committed there as `f2e25c50`).

### Deviation from the spec (verified against code)

The spec proposed a new `displayMetricKey` visual field so a KPI card can pick which measure to show from a wide result. **This is unnecessary and is dropped.** `KpiWidget` (`apps/studio/src/dashboard/widgets/KpiWidget.tsx`) already reads `config.visual.yAxisKey`, and `ConfigPanel` (in `WidgetEditorDialog.tsx`) already renders a "Value Column" picker bound to `yAxisKey` for KPI/valueOnly widget types. A wide query's preview columns include one key per measure, so the existing picker already selects the displayed measure. Task 9 adds a test proving this; no schema change is made.

---

## File Structure

**Slice 1 — Top-N**
- Modify `apps/studio/src/dashboard/editor/builderForm.model.ts` — add `setLimitPatch`.
- Modify `apps/studio/src/dashboard/editor/builderForm.model.test.ts`.
- Modify `apps/studio/src/dashboard/editor/BuilderForm.tsx` — add Limit control (gated on group-by/breakdown).
- Modify `apps/studio/src/dashboard/editor/BuilderForm.test.tsx`.

**Slice 2 — Filter tree**
- Create `apps/studio/src/dashboard/editor/conditionTree.model.ts` — pure tree helpers + runtime `bindFilterTree`.
- Create `apps/studio/src/dashboard/editor/conditionTree.model.test.ts`.
- Create `apps/studio/src/dashboard/editor/FilterTreeEditor.tsx` — recursive shadcn shell.
- Create `apps/studio/src/dashboard/editor/FilterTreeEditor.test.tsx` — render smoke-test.
- Modify `apps/studio/src/dashboard/editor/builderForm.model.ts` — add `setFilterTreePatch`.
- Modify `apps/studio/src/dashboard/editor/BuilderForm.tsx` — swap `FilterConditionEditor` for `FilterTreeEditor`.
- Modify `apps/studio/src/dashboard/DashboardWidget.tsx` — `bindQuery` walks `filterTree`.
- Modify `apps/studio/src/dashboard/DashboardWidget.test.tsx`.

**Slice 3 — Summarize**
- Create `apps/studio/src/dashboard/editor/measures.model.ts` — measures-list helpers + list↔`metric`/`metrics[]` mapping.
- Create `apps/studio/src/dashboard/editor/measures.model.test.ts`.
- Create `apps/studio/src/dashboard/editor/MeasuresEditor.tsx` — rows + formula editor (reuses `conditionModel` for per-measure "only where").
- Create `apps/studio/src/dashboard/editor/MeasuresEditor.test.tsx` — render smoke-test.
- Modify `apps/studio/src/dashboard/editor/builderForm.model.ts` — add `setMeasuresPatch`, `measuresOf`.
- Modify `apps/studio/src/dashboard/editor/BuilderForm.tsx` — swap the single Measure select for `MeasuresEditor`.
- Modify `apps/studio/src/dashboard/editor/WidgetEditorDialog.tsx` — chart→table auto-switch when multi-measure.
- Modify `apps/studio/src/dashboard/widgets/widgets.test.tsx` — KPI reads a chosen measure column from a wide result.

**Slice 4 — Recognizer**
- Modify `packages/dashboards/src/recognize-sql.ts` — emit `metrics[]` instead of refusing multi-measure.
- Modify `packages/dashboards/src/recognize-sql.test.ts` — core test + corpus gate 9→10.

---

## Slice 1 — Top-N

### Task 1: `setLimitPatch` pure helper

**Files:**
- Modify: `apps/studio/src/dashboard/editor/builderForm.model.ts`
- Test: `apps/studio/src/dashboard/editor/builderForm.model.test.ts`

**Interfaces:**
- Produces: `setLimitPatch(value: BuilderQuery, limit: number | undefined): BuilderQuery` — sets `limit` when a positive integer is given, deletes it otherwise (0, NaN, negative, or `undefined` all clear it).

- [ ] **Step 1: Write the failing test**

Add inside the existing top-level `describe('builderForm.model', …)` block in `builderForm.model.test.ts`, and add `setLimitPatch` to the import on line 2:

```ts
  it('setLimitPatch sets a positive integer limit', () => {
    expect(setLimitPatch(base, 10)).toEqual({ ...base, limit: 10 });
  });

  it('setLimitPatch clears the limit for undefined / 0 / negative', () => {
    const withLimit = { ...base, limit: 10 };
    expect(setLimitPatch(withLimit, undefined)).toEqual(base);
    expect(setLimitPatch(withLimit, 0)).toEqual(base);
    expect(setLimitPatch(withLimit, -5)).toEqual(base);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- src/dashboard/editor/builderForm.model.test.ts`
Expected: FAIL — `setLimitPatch is not defined`.

- [ ] **Step 3: Write minimal implementation**

Append to `builderForm.model.ts`:

```ts
/** Set (or, for a non-positive / undefined value, clear) the top-N row limit. */
export function setLimitPatch(value: BuilderQuery, limit: number | undefined): BuilderQuery {
  const next = { ...value };
  // Floor BEFORE the positivity gate so a fractional value in (0,1) clears rather than rounds to 0.
  const floored = limit !== undefined ? Math.floor(limit) : undefined;
  if (floored && Number.isFinite(floored) && floored > 0) next.limit = floored;
  else delete next.limit;
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio test -- src/dashboard/editor/builderForm.model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/dashboard/editor/builderForm.model.ts apps/studio/src/dashboard/editor/builderForm.model.test.ts
git commit -m "feat(studio): setLimitPatch helper for builder top-N"
```

### Task 2: Limit control in BuilderForm

**Files:**
- Modify: `apps/studio/src/dashboard/editor/BuilderForm.tsx`
- Test: `apps/studio/src/dashboard/editor/BuilderForm.test.tsx`

**Interfaces:**
- Consumes: `setLimitPatch` (Task 1).
- Produces: a numeric "Limit" `Input` (aria-label `"Limit"`) rendered only when `value.dimension` or `value.breakdown` is set.

- [ ] **Step 1: Write the failing test**

Add to `BuilderForm.test.tsx` inside `describe('BuilderForm', …)`:

```ts
  it('renders a Limit control only when there is a group-by or breakdown', () => {
    const { queryByLabelText } = render(<BuilderForm models={models} value={base} onChange={vi.fn()} />);
    expect(queryByLabelText('Limit')).toBeNull();
    const grouped = { ...base, dimension: { key: 'status' } } as Extract<WidgetQuery, { mode: 'builder' }>;
    const { getByLabelText } = render(<BuilderForm models={models} value={grouped} onChange={vi.fn()} />);
    expect(getByLabelText('Limit')).toBeTruthy();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- src/dashboard/editor/BuilderForm.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: Limit`.

- [ ] **Step 3: Write minimal implementation**

In `BuilderForm.tsx`, add `Input` to the imports and `setLimitPatch` to the model import:

```tsx
import { Input } from '@/components/ui/input';
```
```tsx
import {
  setModelPatch,
  setMetricPatch,
  setDimensionPatch,
  setGrainPatch,
  setBreakdownPatch,
  setFiltersPatch,
  setLimitPatch,
  type BuilderQuery,
} from './builderForm.model';
```

Then, immediately before the closing `</div>` of the outer `<div className="flex flex-col gap-3 p-1">`, add the Limit block (it reads `value.dimension`/`value.breakdown` which are already in scope):

```tsx
      {(value.dimension || value.breakdown) && (
        <label className="text-sm">
          Limit
          <Input
            type="number"
            min={1}
            aria-label="Limit"
            className="mt-1 h-8 w-full text-xs"
            placeholder="All rows"
            value={value.limit ?? ''}
            onChange={(e) => onChange(setLimitPatch(value, e.target.value === '' ? undefined : Number(e.target.value)))}
          />
          <span className="mt-0.5 block text-[11px] text-muted-foreground">Top rows by the first measure, highest first.</span>
        </label>
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio test -- src/dashboard/editor/BuilderForm.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/dashboard/editor/BuilderForm.tsx apps/studio/src/dashboard/editor/BuilderForm.test.tsx
git commit -m "feat(studio): top-N Limit control in the guided builder"
```

---

## Slice 2 — AND/OR filter tree

### Task 3: `conditionTree.model.ts` pure helpers

**Files:**
- Create: `apps/studio/src/dashboard/editor/conditionTree.model.ts`
- Test: `apps/studio/src/dashboard/editor/conditionTree.model.test.ts`

**Interfaces:**
- Produces (structural types mirroring the `@openldr/dashboards` `ConditionGroup`/`ConditionRule` schema; defined locally, matching how `conditionModel.ts` defines its own `FilterCondition`):
  - `type TreeRule = { kind: 'rule'; dimension: string; op: string; value: unknown }`
  - `type TreeGroup = { kind: 'group'; combinator: 'and' | 'or'; children: TreeNode[] }`
  - `type TreeNode = TreeRule | TreeGroup`
  - `type Path = number[]` — indexes into successive `children` arrays; `[]` is the root group.
  - `emptyTree(): TreeGroup`
  - `filtersToTree(filters: { dimension: string; op: string; value: unknown }[]): TreeGroup` — legacy flat → root AND group of rules.
  - `hasRules(node: TreeNode): boolean` — any rule descendant exists.
  - `addRule(root: TreeGroup, path: Path, dims: { key: string }[]): TreeGroup`
  - `addGroup(root: TreeGroup, path: Path): TreeGroup`
  - `updateRule(root: TreeGroup, path: Path, patch: Partial<TreeRule>): TreeGroup`
  - `removeAt(root: TreeGroup, path: Path): TreeGroup` — removing the root (`[]`) yields an empty tree.
  - `setCombinator(root: TreeGroup, path: Path, combinator: 'and' | 'or'): TreeGroup`
  - `bindFilterTree(tree: TreeGroup, bindings: Record<string, string>, filterValues: Record<string, unknown>): TreeGroup` — runtime: prune rules whose dimension is bound, then AND the resolved binding value(s) with the pruned tree.

- [ ] **Step 1: Write the failing test**

Create `conditionTree.model.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  emptyTree, filtersToTree, hasRules, addRule, addGroup, updateRule, removeAt, setCombinator, bindFilterTree,
} from './conditionTree.model';

const dims = [{ key: 'status' }, { key: 'priority' }];

describe('conditionTree.model', () => {
  it('emptyTree is an AND group with no children', () => {
    expect(emptyTree()).toEqual({ kind: 'group', combinator: 'and', children: [] });
  });

  it('filtersToTree wraps flat filters in a root AND group', () => {
    expect(filtersToTree([{ dimension: 'status', op: 'eq', value: 'F' }])).toEqual({
      kind: 'group', combinator: 'and',
      children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: 'F' }],
    });
  });

  it('hasRules is false for an empty/all-group tree and true once a rule exists', () => {
    expect(hasRules(emptyTree())).toBe(false);
    expect(hasRules(filtersToTree([{ dimension: 'status', op: 'eq', value: 'F' }]))).toBe(true);
  });

  it('addRule appends a default rule to the addressed group', () => {
    expect(addRule(emptyTree(), [], dims)).toEqual({
      kind: 'group', combinator: 'and',
      children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: '' }],
    });
  });

  it('addGroup appends a nested OR group', () => {
    const t = addGroup(emptyTree(), []);
    expect(t.children[0]).toEqual({ kind: 'group', combinator: 'or', children: [] });
  });

  it('updateRule patches the rule at a nested path', () => {
    let t = addRule(emptyTree(), [], dims);       // root.children[0] = rule
    t = addGroup(t, []);                           // root.children[1] = group
    t = addRule(t, [1], dims);                     // root.children[1].children[0] = rule
    t = updateRule(t, [1, 0], { value: 'high', dimension: 'priority' });
    expect((t.children[1] as any).children[0]).toEqual({ kind: 'rule', dimension: 'priority', op: 'eq', value: 'high' });
  });

  it('removeAt drops the addressed node', () => {
    let t = addRule(emptyTree(), [], dims);
    t = addRule(t, [], dims);
    t = removeAt(t, [0]);
    expect(t.children.length).toBe(1);
  });

  it('setCombinator flips a group between and/or', () => {
    expect(setCombinator(emptyTree(), [], 'or').combinator).toBe('or');
  });

  it('bindFilterTree ANDs a scalar binding value and prunes the bound dimension', () => {
    const tree = filtersToTree([
      { dimension: 'status', op: 'eq', value: 'F' },
      { dimension: 'priority', op: 'eq', value: '' }, // stale literal for a bound row
    ]);
    const out = bindFilterTree(tree, { priority: 'prio' }, { prio: 'stat' });
    expect(out).toEqual({
      kind: 'group', combinator: 'and',
      children: [
        { kind: 'group', combinator: 'and', children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: 'F' }] },
        { kind: 'rule', dimension: 'priority', op: 'eq', value: 'stat' },
      ],
    });
  });

  it('bindFilterTree expands a date-range binding into gte + lte', () => {
    const out = bindFilterTree(emptyTree(), { authored_on: 'period' }, { period: { from: '2024-01-01', to: '2024-03-31' } });
    expect(out.children).toEqual([
      { kind: 'rule', dimension: 'authored_on', op: 'gte', value: '2024-01-01' },
      { kind: 'rule', dimension: 'authored_on', op: 'lte', value: '2024-03-31' },
    ]);
  });

  it('bindFilterTree returns the pruned tree unchanged when no binding has a value', () => {
    const tree = filtersToTree([{ dimension: 'status', op: 'eq', value: 'F' }]);
    expect(bindFilterTree(tree, { priority: 'prio' }, {})).toEqual(tree);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- src/dashboard/editor/conditionTree.model.test.ts`
Expected: FAIL — cannot resolve `./conditionTree.model`.

- [ ] **Step 3: Write minimal implementation**

Create `conditionTree.model.ts`:

```ts
// Pure state-transition helpers for the recursive AND/OR filter tree (ConditionGroup / ConditionRule
// in @openldr/dashboards). Kept free of React/DOM so they're unit-testable without jsdom or Radix —
// see FilterTreeEditor.tsx, a thin shadcn shell over these functions. Types are defined locally
// (structurally identical to the schema) to match conditionModel.ts's own FilterCondition.

export type TreeRule = { kind: 'rule'; dimension: string; op: string; value: unknown };
export type TreeGroup = { kind: 'group'; combinator: 'and' | 'or'; children: TreeNode[] };
export type TreeNode = TreeRule | TreeGroup;
export type Path = number[];

export function emptyTree(): TreeGroup {
  return { kind: 'group', combinator: 'and', children: [] };
}

/** Adapt a legacy flat filter list into a root AND group of rules. */
export function filtersToTree(filters: { dimension: string; op: string; value: unknown }[]): TreeGroup {
  return { kind: 'group', combinator: 'and', children: filters.map((f) => ({ kind: 'rule', dimension: f.dimension, op: f.op, value: f.value })) };
}

/** True when the node (or any descendant) contains at least one rule. */
export function hasRules(node: TreeNode): boolean {
  return node.kind === 'rule' ? true : node.children.some(hasRules);
}

/** Recursively rebuild the group at `path`, applying `fn` to it; returns a new tree. */
function mapGroupAt(root: TreeGroup, path: Path, fn: (g: TreeGroup) => TreeGroup): TreeGroup {
  if (path.length === 0) return fn(root);
  const [i, ...rest] = path;
  const child = root.children[i];
  if (!child || child.kind !== 'group') return root;
  const children = root.children.slice();
  children[i] = mapGroupAt(child, rest, fn);
  return { ...root, children };
}

export function addRule(root: TreeGroup, path: Path, dims: { key: string }[]): TreeGroup {
  const rule: TreeRule = { kind: 'rule', dimension: dims[0]?.key ?? '', op: 'eq', value: '' };
  return mapGroupAt(root, path, (g) => ({ ...g, children: [...g.children, rule] }));
}

export function addGroup(root: TreeGroup, path: Path): TreeGroup {
  const group: TreeGroup = { kind: 'group', combinator: 'or', children: [] };
  return mapGroupAt(root, path, (g) => ({ ...g, children: [...g.children, group] }));
}

export function setCombinator(root: TreeGroup, path: Path, combinator: 'and' | 'or'): TreeGroup {
  return mapGroupAt(root, path, (g) => ({ ...g, combinator }));
}

/** Patch the rule at `path` (last index addresses a rule within its parent group). */
export function updateRule(root: TreeGroup, path: Path, patch: Partial<TreeRule>): TreeGroup {
  if (path.length === 0) return root;
  const parent = path.slice(0, -1);
  const idx = path[path.length - 1];
  return mapGroupAt(root, parent, (g) => {
    const child = g.children[idx];
    if (!child || child.kind !== 'rule') return g;
    const children = g.children.slice();
    children[idx] = { ...child, ...patch };
    return { ...g, children };
  });
}

/** Remove the node at `path`. Removing the root ([]) yields an empty tree. */
export function removeAt(root: TreeGroup, path: Path): TreeGroup {
  if (path.length === 0) return emptyTree();
  const parent = path.slice(0, -1);
  const idx = path[path.length - 1];
  return mapGroupAt(root, parent, (g) => ({ ...g, children: g.children.filter((_, j) => j !== idx) }));
}

/** Recursively drop every rule whose dimension is in `bound`; prune groups that become empty. */
function pruneBound(node: TreeNode, bound: Set<string>): TreeNode | null {
  if (node.kind === 'rule') return bound.has(node.dimension) ? null : node;
  const children = node.children.map((c) => pruneBound(c, bound)).filter((c): c is TreeNode => c != null);
  return { ...node, children };
}

/**
 * Runtime binding: replace bound-dimension rules with the resolved dashboard-filter value(s),
 * ANDed with the rest of the tree. ANDing at a fresh root keeps the injected value correct even
 * when the user's own root group is an OR. Mirrors the flat bindQuery logic.
 */
export function bindFilterTree(tree: TreeGroup, bindings: Record<string, string>, filterValues: Record<string, unknown>): TreeGroup {
  const bound = new Set(Object.keys(bindings));
  const pruned = pruneBound(tree, bound) as TreeGroup;
  const injected: TreeRule[] = [];
  for (const [dimKey, filterId] of Object.entries(bindings)) {
    const v = filterValues[filterId];
    if (v == null || v === '') continue;
    if (typeof v === 'object' && 'from' in v && 'to' in v) {
      const range = v as { from: string; to: string };
      if (range.from) injected.push({ kind: 'rule', dimension: dimKey, op: 'gte', value: range.from });
      if (range.to) injected.push({ kind: 'rule', dimension: dimKey, op: 'lte', value: range.to });
    } else {
      injected.push({ kind: 'rule', dimension: dimKey, op: 'eq', value: v });
    }
  }
  if (injected.length === 0) return pruned;
  const base = hasRules(pruned) ? [pruned] : [];
  return { kind: 'group', combinator: 'and', children: [...base, ...injected] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio test -- src/dashboard/editor/conditionTree.model.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/dashboard/editor/conditionTree.model.ts apps/studio/src/dashboard/editor/conditionTree.model.test.ts
git commit -m "feat(studio): pure AND/OR filter-tree model + runtime binding helper"
```

### Task 4: `FilterTreeEditor` component + `setFilterTreePatch`

**Files:**
- Create: `apps/studio/src/dashboard/editor/FilterTreeEditor.tsx`
- Test: `apps/studio/src/dashboard/editor/FilterTreeEditor.test.tsx`
- Modify: `apps/studio/src/dashboard/editor/builderForm.model.ts` — add `setFilterTreePatch`.

**Interfaces:**
- Consumes: `conditionTree.model` helpers (Task 3), `conditionModel`'s `OPS`, `toValue`, `toLiteral` (Task uses the same operator vocabulary as flat filters).
- Produces:
  - `<FilterTreeEditor value={TreeGroup} dimensions={ModelDimension[]} onChange={(t: TreeGroup) => void} />` — recursive editor; the root group renders an "Add condition"/"Add group" pair (aria-labels `"Add condition"` / `"Add group"`).
  - `setFilterTreePatch(value: BuilderQuery, tree: TreeGroup | undefined): BuilderQuery` — sets `filterTree` and clears the legacy flat `filters` (to `[]`) so the compiler uses the tree; clears `filterTree` when `undefined`.

- [ ] **Step 1: Write the failing test**

Create `FilterTreeEditor.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { FilterTreeEditor } from './FilterTreeEditor';
import { emptyTree } from './conditionTree.model';
import type { ModelDimension } from '../../api';

const dims: ModelDimension[] = [
  { key: 'status', label: 'Status', column: 'status', kind: 'string' },
  { key: 'priority', label: 'Priority', column: 'priority', kind: 'string' },
];

describe('FilterTreeEditor', () => {
  // Radix Selects aren't jsdom-drivable — behavior is covered by conditionTree.model.test.ts;
  // this is a render smoke-test only.
  it('renders the root group add controls', () => {
    const { getByLabelText } = render(<FilterTreeEditor value={emptyTree()} dimensions={dims} onChange={vi.fn()} />);
    expect(getByLabelText('Add condition')).toBeTruthy();
    expect(getByLabelText('Add group')).toBeTruthy();
  });

  it('renders a row per rule', () => {
    const tree = { kind: 'group' as const, combinator: 'and' as const, children: [
      { kind: 'rule' as const, dimension: 'status', op: 'eq', value: 'F' },
    ] };
    const { getAllByLabelText } = render(<FilterTreeEditor value={tree} dimensions={dims} onChange={vi.fn()} />);
    expect(getAllByLabelText('Filter field').length).toBe(1);
  });
});
```

Add to `builderForm.model.test.ts` (import `setFilterTreePatch` on line 2):

```ts
  it('setFilterTreePatch sets the tree and clears the flat filters', () => {
    const tree = { kind: 'group' as const, combinator: 'and' as const, children: [] };
    expect(setFilterTreePatch(base, tree)).toEqual({ ...base, filterTree: tree, filters: [] });
  });

  it('setFilterTreePatch clears the tree for undefined', () => {
    const withTree = { ...base, filterTree: { kind: 'group' as const, combinator: 'and' as const, children: [] } };
    expect(setFilterTreePatch(withTree, undefined)).toEqual({ ...base, filters: base.filters });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- src/dashboard/editor/FilterTreeEditor.test.tsx src/dashboard/editor/builderForm.model.test.ts`
Expected: FAIL — cannot resolve `./FilterTreeEditor`; `setFilterTreePatch is not defined`.

- [ ] **Step 3: Write minimal implementation**

Append to `builderForm.model.ts` (add the type import at the top: `import type { TreeGroup } from './conditionTree.model';`):

```ts
/** Author the AND/OR tree: set `filterTree` and clear the legacy flat `filters` (compiler prefers
 *  the tree when present). Passing `undefined` reverts to the flat `filters`. */
export function setFilterTreePatch(value: BuilderQuery, tree: TreeGroup | undefined): BuilderQuery {
  const next = { ...value };
  if (tree) { next.filterTree = tree as BuilderQuery['filterTree']; next.filters = []; }
  else delete next.filterTree;
  return next;
}
```

Create `FilterTreeEditor.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Trash2, Plus, FolderPlus } from 'lucide-react';
import type { ModelDimension } from '../../api';
import { OPS, toValue, toLiteral } from './conditionModel';
import {
  addRule, addGroup, updateRule, removeAt, setCombinator,
  type TreeGroup, type TreeNode, type Path,
} from './conditionTree.model';

function GroupView({ group, path, dimensions, onChange, isRoot }: {
  group: TreeGroup; path: Path; dimensions: ModelDimension[];
  onChange: (mutate: (root: TreeGroup) => TreeGroup) => void; isRoot: boolean;
}) {
  return (
    <div className={isRoot ? 'flex flex-col gap-1' : 'flex flex-col gap-1 rounded-md border border-border/70 bg-muted/30 p-2'}>
      <div className="flex items-center gap-1">
        <Select value={group.combinator} onValueChange={(v) => onChange((r) => setCombinator(r, path, v as 'and' | 'or'))}>
          <SelectTrigger aria-label="Match type" className="h-7 w-24 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="and">All</SelectItem>
            <SelectItem value="or">Any</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-[11px] text-muted-foreground">of the following</span>
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Add condition" onClick={() => onChange((r) => addRule(r, path, dimensions))}>
            <Plus className="h-3 w-3" />
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Add group" onClick={() => onChange((r) => addGroup(r, path))}>
            <FolderPlus className="h-3 w-3" />
          </Button>
          {!isRoot && (
            <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Remove group" onClick={() => onChange((r) => removeAt(r, path))}>
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      {group.children.map((child: TreeNode, i) =>
        child.kind === 'group' ? (
          <div key={i} className="ml-3">
            <GroupView group={child} path={[...path, i]} dimensions={dimensions} onChange={onChange} isRoot={false} />
          </div>
        ) : (
          <div key={i} className="ml-3 flex items-center gap-1">
            <Select value={child.dimension} onValueChange={(v) => onChange((r) => updateRule(r, [...path, i], { dimension: v }))}>
              <SelectTrigger aria-label="Filter field" className="h-7 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dimensions.map((d) => (
                  <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={child.op} onValueChange={(v) => onChange((r) => updateRule(r, [...path, i], { op: v, value: toValue(v, toLiteral(child.value)) }))}>
              <SelectTrigger aria-label="Filter operator" className="h-7 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPS.map((o) => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label="Filter value"
              className="h-7 flex-1 text-xs"
              value={toLiteral(child.value)}
              onChange={(e) => onChange((r) => updateRule(r, [...path, i], { value: toValue(child.op, e.target.value) }))}
            />
            <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Remove filter" onClick={() => onChange((r) => removeAt(r, [...path, i]))}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ),
      )}
    </div>
  );
}

/**
 * Recursive shadcn shell over conditionTree.model.ts. Owns no state transitions itself — every
 * edit routes through a pure helper (addRule/updateRule/…) applied to the whole tree. Radix Selects
 * aren't jsdom-drivable, so behavior is covered by conditionTree.model.test.ts; this gets a render
 * smoke-test only (FilterTreeEditor.test.tsx).
 */
export function FilterTreeEditor({ value, dimensions, onChange }: {
  value: TreeGroup; dimensions: ModelDimension[]; onChange: (t: TreeGroup) => void;
}): JSX.Element {
  return <GroupView group={value} path={[]} dimensions={dimensions} onChange={(mutate) => onChange(mutate(value))} isRoot />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio test -- src/dashboard/editor/FilterTreeEditor.test.tsx src/dashboard/editor/builderForm.model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/dashboard/editor/FilterTreeEditor.tsx apps/studio/src/dashboard/editor/FilterTreeEditor.test.tsx apps/studio/src/dashboard/editor/builderForm.model.ts apps/studio/src/dashboard/editor/builderForm.model.test.ts
git commit -m "feat(studio): recursive FilterTreeEditor + setFilterTreePatch"
```

### Task 5: Wire the tree into BuilderForm

**Files:**
- Modify: `apps/studio/src/dashboard/editor/BuilderForm.tsx`
- Test: `apps/studio/src/dashboard/editor/BuilderForm.test.tsx`

**Interfaces:**
- Consumes: `FilterTreeEditor` (Task 4), `setFilterTreePatch` (Task 4), `filtersToTree` + `emptyTree` (Task 3).
- Produces: the Filters section renders `FilterTreeEditor`. Existing widgets with flat `filters` display as a root AND group (adapted on the fly); edits always write `filterTree`.

- [ ] **Step 1: Write the failing test**

Replace the smoke-test assertions in `BuilderForm.test.tsx`'s first test to include the tree's root controls, and add a legacy-adapt test:

```ts
  it('renders the AND/OR filter tree root controls', () => {
    const { getByLabelText } = render(<BuilderForm models={models} value={base} onChange={vi.fn()} />);
    expect(getByLabelText('Add condition')).toBeTruthy();
    expect(getByLabelText('Add group')).toBeTruthy();
  });

  it('adapts a legacy flat-filters widget into a tree (renders its rule)', () => {
    const legacy = { ...base, filters: [{ dimension: 'status', op: 'eq', value: 'F' }] } as Extract<WidgetQuery, { mode: 'builder' }>;
    const { getAllByLabelText } = render(<BuilderForm models={models} value={legacy} onChange={vi.fn()} />);
    expect(getAllByLabelText('Filter field').length).toBe(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- src/dashboard/editor/BuilderForm.test.tsx`
Expected: FAIL — no `Add condition` label (still rendering `FilterConditionEditor`).

- [ ] **Step 3: Write minimal implementation**

In `BuilderForm.tsx`: remove the `FilterConditionEditor` import (line 3) and add:

```tsx
import { FilterTreeEditor } from './FilterTreeEditor';
import { emptyTree, filtersToTree } from './conditionTree.model';
```
Add `setFilterTreePatch` to the `builderForm.model` import list. Then replace the entire Filters `<div className="text-sm">…</div>` block with:

```tsx
      <div className="text-sm">
        Filters
        <div className="mt-1">
          <FilterTreeEditor
            value={value.filterTree ?? (value.filters?.length ? filtersToTree(value.filters) : emptyTree())}
            dimensions={model?.dimensions ?? []}
            onChange={(tree) => onChange(setFilterTreePatch(value, tree))}
          />
        </div>
      </div>
```

Note: the `dashboardFilters` prop and `variableBindings` binding UI are intentionally not rendered inside the tree in this cut — a rule's runtime binding is still authored via the existing Variables sheet path and applied by `bindQuery` (Task 6). Leave the `dashboardFilters` prop on `BuilderForm` in place (unused here) so the signature is unchanged for `WidgetEditorDialog`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio test -- src/dashboard/editor/BuilderForm.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/dashboard/editor/BuilderForm.tsx apps/studio/src/dashboard/editor/BuilderForm.test.tsx
git commit -m "feat(studio): use FilterTreeEditor in the guided builder; adapt legacy flat filters"
```

### Task 6: `bindQuery` walks `filterTree`

**Files:**
- Modify: `apps/studio/src/dashboard/DashboardWidget.tsx`
- Test: `apps/studio/src/dashboard/DashboardWidget.test.tsx`

**Interfaces:**
- Consumes: `bindFilterTree` (Task 3).
- Produces: `bindQuery` unchanged signature. When the builder query has a `filterTree`, binding injects resolved dashboard-filter values into the tree via `bindFilterTree` instead of the flat `filters` array.

- [ ] **Step 1: Write the failing test**

Add to the `describe('bindQuery', …)` block in `DashboardWidget.test.tsx`:

```ts
  it('injects a scalar binding into a filterTree, pruning the bound dimension', () => {
    const q = {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [],
      filterTree: { kind: 'group', combinator: 'and', children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: 'F' }] },
      variableBindings: { priority: 'prio' },
    } as any;
    const out = bindQuery(q, { prio: 'stat' }) as any;
    expect(out.filterTree).toEqual({
      kind: 'group', combinator: 'and',
      children: [
        { kind: 'group', combinator: 'and', children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: 'F' }] },
        { kind: 'rule', dimension: 'priority', op: 'eq', value: 'stat' },
      ],
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- src/dashboard/DashboardWidget.test.tsx`
Expected: FAIL — `out.filterTree` is the original tree (binding went to `filters`, ignored by the compiler).

- [ ] **Step 3: Write minimal implementation**

In `DashboardWidget.tsx`, add the import:

```ts
import { bindFilterTree } from './editor/conditionTree.model';
```

Then, inside `bindQuery`'s `if (q.mode === 'builder') {` branch, immediately after `if (!q.variableBindings) return q;`, add the tree path (before the existing flat-filters logic):

```ts
    if (q.filterTree) {
      const filterTree = bindFilterTree(q.filterTree as any, q.variableBindings, filterValues);
      return { ...q, filterTree } as WidgetQuery;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio test -- src/dashboard/DashboardWidget.test.tsx`
Expected: PASS (existing flat-filter bindQuery tests still pass — that path is untouched).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/dashboard/DashboardWidget.tsx apps/studio/src/dashboard/DashboardWidget.test.tsx
git commit -m "feat(studio): bindQuery injects dashboard-filter values into filterTree"
```

---

## Slice 3 — Summarize (multi-measure + derived ratios)

### Task 7: `measures.model.ts` pure helpers

**Files:**
- Create: `apps/studio/src/dashboard/editor/measures.model.ts`
- Test: `apps/studio/src/dashboard/editor/measures.model.test.ts`

**Interfaces:**
- Produces:
  - `type Measure = { key: string; label?: string; agg: string; column?: string; where?: { dimension: string; op: string; value: unknown }[]; derived?: { numerator: string; denominator: string; scale: number; decimals: number } }` (structurally the schema `Metric`).
  - `uniqueKey(list: Measure[], base: string): string` — `base`, `base-2`, … avoiding collisions.
  - `addMeasure(list: Measure[], model: { metrics: { key: string; label: string; agg: string; column?: string }[] }): Measure[]` — appends the model's first metric (or a `count`) with a unique key.
  - `addFormula(list: Measure[]): Measure[]` — appends a derived row (placeholder `agg: 'count'`, `derived` referencing the first two aggregate measures, or empty strings when fewer than two exist), `scale: 100`, `decimals: 1`.
  - `updateMeasure(list: Measure[], i: number, patch: Partial<Measure>): Measure[]`
  - `removeMeasure(list: Measure[], i: number): Measure[]` — also blanks any formula's numerator/denominator that referenced the removed measure's key (so no formula dangles).
  - `aggregateMeasures(list: Measure[]): Measure[]` — non-derived rows (valid numerator/denominator choices).
  - `toBuilderMetrics(list: Measure[]): { metric: Measure; metrics?: Measure[] }` — one non-derived row → `{ metric }`; otherwise `{ metric: firstAggregate, metrics: list }`.

- [ ] **Step 1: Write the failing test**

Create `measures.model.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { uniqueKey, addMeasure, addFormula, updateMeasure, removeMeasure, aggregateMeasures, toBuilderMetrics, type Measure } from './measures.model';

const model = { metrics: [{ key: 'count', label: 'Count', agg: 'count' }, { key: 'avg_value', label: 'Avg', agg: 'avg', column: 'v' }] };

describe('measures.model', () => {
  it('uniqueKey suffixes on collision', () => {
    expect(uniqueKey([{ key: 'count', agg: 'count' }], 'count')).toBe('count-2');
    expect(uniqueKey([], 'count')).toBe('count');
  });

  it('addMeasure appends the first model metric with a unique key', () => {
    const one: Measure[] = [{ key: 'count', label: 'Count', agg: 'count' }];
    expect(addMeasure(one, model)).toEqual([
      { key: 'count', label: 'Count', agg: 'count' },
      { key: 'count-2', label: 'Count', agg: 'count' },
    ]);
  });

  it('addFormula references the first two aggregate measures', () => {
    const two: Measure[] = [{ key: 'a', agg: 'count' }, { key: 'b', agg: 'count' }];
    const out = addFormula(two);
    expect(out[2]).toEqual({ key: 'ratio', label: 'Ratio', agg: 'count', derived: { numerator: 'a', denominator: 'b', scale: 100, decimals: 1 } });
  });

  it('updateMeasure patches one row', () => {
    const two: Measure[] = [{ key: 'a', agg: 'count' }, { key: 'b', agg: 'count' }];
    expect(updateMeasure(two, 1, { label: 'B' })[1]).toEqual({ key: 'b', agg: 'count', label: 'B' });
  });

  it('removeMeasure clears a formula reference to the removed key', () => {
    const list: Measure[] = [
      { key: 'a', agg: 'count' },
      { key: 'b', agg: 'count' },
      { key: 'r', agg: 'count', derived: { numerator: 'a', denominator: 'b', scale: 100, decimals: 1 } },
    ];
    const out = removeMeasure(list, 0); // remove 'a'
    expect(out.find((m) => m.key === 'r')!.derived).toEqual({ numerator: '', denominator: 'b', scale: 100, decimals: 1 });
  });

  it('aggregateMeasures excludes derived rows', () => {
    const list: Measure[] = [{ key: 'a', agg: 'count' }, { key: 'r', agg: 'count', derived: { numerator: 'a', denominator: 'a', scale: 100, decimals: 1 } }];
    expect(aggregateMeasures(list).map((m) => m.key)).toEqual(['a']);
  });

  it('toBuilderMetrics returns a single metric for one aggregate row', () => {
    const one: Measure[] = [{ key: 'count', agg: 'count' }];
    expect(toBuilderMetrics(one)).toEqual({ metric: one[0], metrics: undefined });
  });

  it('toBuilderMetrics returns metric + metrics for multiple rows', () => {
    const list: Measure[] = [{ key: 'a', agg: 'count' }, { key: 'b', agg: 'count' }];
    expect(toBuilderMetrics(list)).toEqual({ metric: list[0], metrics: list });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- src/dashboard/editor/measures.model.test.ts`
Expected: FAIL — cannot resolve `./measures.model`.

- [ ] **Step 3: Write minimal implementation**

Create `measures.model.ts`:

```ts
// Pure state-transition helpers for the Summarize measures list. A row is a schema Metric; a list of
// one non-derived row compiles to the single `metric` field, more than one to `metrics[]` (wide table).
// Kept free of React/DOM for unit-testing — see MeasuresEditor.tsx.

export type Measure = {
  key: string; label?: string; agg: string; column?: string;
  where?: { dimension: string; op: string; value: unknown }[];
  derived?: { numerator: string; denominator: string; scale: number; decimals: number };
};

/** `base`, then `base-2`, `base-3`, … until it doesn't collide with an existing key. */
export function uniqueKey(list: Measure[], base: string): string {
  const keys = new Set(list.map((m) => m.key));
  if (!keys.has(base)) return base;
  let n = 2;
  while (keys.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function addMeasure(list: Measure[], model: { metrics: { key: string; label: string; agg: string; column?: string }[] }): Measure[] {
  const m = model.metrics[0] ?? { key: 'count', label: 'Count', agg: 'count' };
  const key = uniqueKey(list, m.key);
  const next: Measure = { key, label: m.label, agg: m.agg };
  if (m.column) next.column = m.column;
  return [...list, next];
}

export function addFormula(list: Measure[]): Measure[] {
  const aggs = aggregateMeasures(list);
  const key = uniqueKey(list, 'ratio');
  return [...list, {
    key, label: 'Ratio', agg: 'count', // agg is an unused placeholder for a derived row (schema requires it)
    derived: { numerator: aggs[0]?.key ?? '', denominator: aggs[1]?.key ?? '', scale: 100, decimals: 1 },
  }];
}

export function updateMeasure(list: Measure[], i: number, patch: Partial<Measure>): Measure[] {
  return list.map((m, j) => (j === i ? { ...m, ...patch } : m));
}

export function removeMeasure(list: Measure[], i: number): Measure[] {
  const removed = list[i]?.key;
  return list
    .filter((_, j) => j !== i)
    .map((m) => {
      if (!m.derived || !removed) return m;
      const d = { ...m.derived };
      if (d.numerator === removed) d.numerator = '';
      if (d.denominator === removed) d.denominator = '';
      return { ...m, derived: d };
    });
}

export function aggregateMeasures(list: Measure[]): Measure[] {
  return list.filter((m) => !m.derived);
}

export function toBuilderMetrics(list: Measure[]): { metric: Measure; metrics?: Measure[] } {
  const firstAggregate = aggregateMeasures(list)[0] ?? list[0];
  if (list.length <= 1) return { metric: list[0], metrics: undefined };
  return { metric: firstAggregate, metrics: list };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio test -- src/dashboard/editor/measures.model.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/dashboard/editor/measures.model.ts apps/studio/src/dashboard/editor/measures.model.test.ts
git commit -m "feat(studio): pure measures-list model (multi-measure + derived ratios)"
```

### Task 8: `setMeasuresPatch`/`measuresOf` + `MeasuresEditor` component + wire into BuilderForm

**Files:**
- Modify: `apps/studio/src/dashboard/editor/builderForm.model.ts` — add `measuresOf`, `setMeasuresPatch`.
- Modify: `apps/studio/src/dashboard/editor/builderForm.model.test.ts`.
- Create: `apps/studio/src/dashboard/editor/MeasuresEditor.tsx`
- Create: `apps/studio/src/dashboard/editor/MeasuresEditor.test.tsx`
- Modify: `apps/studio/src/dashboard/editor/BuilderForm.tsx` — replace the single Measure select with `MeasuresEditor`.
- Modify: `apps/studio/src/dashboard/editor/BuilderForm.test.tsx`.

**Interfaces:**
- Consumes: `measures.model` (Task 7), `conditionModel` (per-measure "only where" reuses `addCondition`/`updateCondition`/`removeCondition`/`OPS`/`toValue`/`toLiteral`).
- Produces:
  - `measuresOf(value: BuilderQuery): Measure[]` — `value.metrics ?? [value.metric]`.
  - `setMeasuresPatch(value: BuilderQuery, list: Measure[]): BuilderQuery` — maps via `toBuilderMetrics`, setting `metric` and `metrics` (or clearing `metrics`).
  - `<MeasuresEditor value={Measure[]} model={QueryModel | undefined} onChange={(list: Measure[]) => void} />` — one row per measure with an expand toggle; `+ Add measure` (aria-label `"Add measure"`) and `+ Formula` (aria-label `"Add formula"`).

- [ ] **Step 1: Write the failing test**

Add to `builderForm.model.test.ts` (import both new fns):

```ts
  it('measuresOf returns the single metric as a one-item list', () => {
    expect(measuresOf(base)).toEqual([base.metric]);
  });

  it('setMeasuresPatch maps one row to metric, clearing metrics', () => {
    const out = setMeasuresPatch({ ...base, metrics: [base.metric, base.metric] }, [base.metric]);
    expect(out.metric).toEqual(base.metric);
    expect(out.metrics).toBeUndefined();
  });

  it('setMeasuresPatch maps multiple rows to metric + metrics', () => {
    const a = { key: 'a', agg: 'count' as const };
    const b = { key: 'b', agg: 'count' as const };
    const out = setMeasuresPatch(base, [a, b]);
    expect(out.metric).toEqual(a);
    expect(out.metrics).toEqual([a, b]);
  });
```

Create `MeasuresEditor.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MeasuresEditor } from './MeasuresEditor';
import type { QueryModel } from '../../api';

const model: QueryModel = {
  id: 'observations', label: 'Results',
  dimensions: [{ key: 'interpretation_code', label: 'Interpretation', column: 'abnormal_flag', kind: 'string' }],
  metrics: [{ key: 'count', label: 'Count', agg: 'count' }, { key: 'avg_value', label: 'Avg', agg: 'avg', column: 'numeric_value' }],
} as unknown as QueryModel;

describe('MeasuresEditor', () => {
  it('renders a row per measure and the add controls', () => {
    const list = [{ key: 'count', label: 'Count', agg: 'count' }];
    const { getByLabelText, getByText } = render(<MeasuresEditor value={list} model={model} onChange={vi.fn()} />);
    expect(getByLabelText('Add measure')).toBeTruthy();
    expect(getByLabelText('Add formula')).toBeTruthy();
    expect(getByText('Count')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- src/dashboard/editor/MeasuresEditor.test.tsx src/dashboard/editor/builderForm.model.test.ts`
Expected: FAIL — cannot resolve `./MeasuresEditor`; `measuresOf`/`setMeasuresPatch` not defined.

- [ ] **Step 3: Write minimal implementation**

Append to `builderForm.model.ts` (add `import { toBuilderMetrics, type Measure } from './measures.model';`):

```ts
/** The current measures as a list (the single `metric`, or the `metrics[]` array when wide). */
export function measuresOf(value: BuilderQuery): Measure[] {
  return (value.metrics as Measure[] | undefined) ?? [value.metric as Measure];
}

/** Persist an edited measures list back into the query's `metric`/`metrics` fields. */
export function setMeasuresPatch(value: BuilderQuery, list: Measure[]): BuilderQuery {
  const { metric, metrics } = toBuilderMetrics(list);
  const next = { ...value, metric: metric as BuilderQuery['metric'] };
  if (metrics) next.metrics = metrics as BuilderQuery['metrics'];
  else delete next.metrics;
  return next;
}
```

Create `MeasuresEditor.tsx`:

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { ChevronDown, ChevronRight, Plus, Sigma, Trash2 } from 'lucide-react';
import type { QueryModel } from '../../api';
import { addMeasure, addFormula, updateMeasure, removeMeasure, aggregateMeasures, type Measure } from './measures.model';
import { OPS, toValue, toLiteral, addCondition, updateCondition, removeCondition, type FilterCondition } from './conditionModel';

// Local agg vocabulary (mirrors @openldr/dashboards AGGS) — kept here to avoid pulling the package
// root into the browser bundle.
const AGGS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'] as const;

export function MeasuresEditor({ value, model, onChange }: {
  value: Measure[]; model?: QueryModel; onChange: (list: Measure[]) => void;
}): JSX.Element {
  const [open, setOpen] = useState<number | null>(null);
  const dims = model?.dimensions ?? [];
  const aggChoices = aggregateMeasures(value);
  return (
    <div className="flex flex-col gap-1">
      {value.map((m, i) => {
        const expanded = open === i;
        const isFormula = !!m.derived;
        return (
          <div key={i} className="rounded-md border border-border/70">
            <div className="flex items-center gap-1 px-2 py-1">
              <button type="button" aria-label="Toggle measure" className="text-muted-foreground" onClick={() => setOpen(expanded ? null : i)}>
                {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
              <span className="flex-1 truncate text-xs">
                {m.label || m.key} <span className="text-muted-foreground">{isFormula ? '· formula' : `· ${m.agg}`}</span>
              </span>
              <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0" aria-label="Remove measure" onClick={() => { onChange(removeMeasure(value, i)); setOpen(null); }}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            {expanded && (
              <div className="flex flex-col gap-2 border-t border-border/70 p-2">
                {isFormula ? (
                  <>
                    <div className="flex items-center gap-1">
                      <Select value={m.derived!.numerator} onValueChange={(v) => onChange(updateMeasure(value, i, { derived: { ...m.derived!, numerator: v } }))}>
                        <SelectTrigger aria-label="Numerator" className="h-7 flex-1 text-xs"><SelectValue placeholder="Numerator" /></SelectTrigger>
                        <SelectContent>{aggChoices.map((a) => <SelectItem key={a.key} value={a.key}>{a.label || a.key}</SelectItem>)}</SelectContent>
                      </Select>
                      <span className="text-xs text-muted-foreground">÷</span>
                      <Select value={m.derived!.denominator} onValueChange={(v) => onChange(updateMeasure(value, i, { derived: { ...m.derived!, denominator: v } }))}>
                        <SelectTrigger aria-label="Denominator" className="h-7 flex-1 text-xs"><SelectValue placeholder="Denominator" /></SelectTrigger>
                        <SelectContent>{aggChoices.map((a) => <SelectItem key={a.key} value={a.key}>{a.label || a.key}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-1">
                      <Select value={String(m.derived!.scale)} onValueChange={(v) => onChange(updateMeasure(value, i, { derived: { ...m.derived!, scale: Number(v) } }))}>
                        <SelectTrigger aria-label="Format" className="h-7 flex-1 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="100">Percent (×100)</SelectItem><SelectItem value="1">Number</SelectItem></SelectContent>
                      </Select>
                      <Input aria-label="Decimals" type="number" min={0} max={4} className="h-7 w-16 text-xs" value={m.derived!.decimals} onChange={(e) => onChange(updateMeasure(value, i, { derived: { ...m.derived!, decimals: Number(e.target.value) } }))} />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-1">
                      <Select value={m.agg} onValueChange={(v) => onChange(updateMeasure(value, i, { agg: v }))}>
                        <SelectTrigger aria-label="Aggregate" className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{AGGS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                      </Select>
                      {m.agg !== 'count' && (
                        <Input aria-label="Column" className="h-7 flex-1 text-xs" placeholder="column" value={m.column ?? ''} onChange={(e) => onChange(updateMeasure(value, i, { column: e.target.value || undefined }))} />
                      )}
                    </div>
                    <WhereEditor value={(m.where ?? []) as FilterCondition[]} dims={dims} onChange={(w) => onChange(updateMeasure(value, i, { where: w.length ? (w as Measure['where']) : undefined }))} />
                  </>
                )}
                <Input aria-label="Measure label" className="h-7 text-xs" placeholder="Label" value={m.label ?? ''} onChange={(e) => onChange(updateMeasure(value, i, { label: e.target.value || undefined }))} />
              </div>
            )}
          </div>
        );
      })}
      <div className="flex gap-1">
        <Button type="button" size="sm" variant="outline" className="h-7 flex-1" aria-label="Add measure" onClick={() => onChange(addMeasure(value, model ?? { metrics: [] }))}>
          <Plus className="mr-1 h-3 w-3" /> Add measure
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7" aria-label="Add formula" onClick={() => onChange(addFormula(value))}>
          <Sigma className="mr-1 h-3 w-3" /> Formula
        </Button>
      </div>
    </div>
  );
}

function WhereEditor({ value, dims, onChange }: { value: FilterCondition[]; dims: { key: string; label: string }[]; onChange: (c: FilterCondition[]) => void }) {
  return (
    <div className="flex flex-col gap-1 rounded border border-dashed border-border/70 p-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Only where</span>
      {value.map((c, i) => (
        <div key={i} className="flex items-center gap-1">
          <Select value={c.dimension} onValueChange={(v) => onChange(updateCondition(value, i, { dimension: v }))}>
            <SelectTrigger aria-label="Where field" className="h-6 w-28 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{dims.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={c.op} onValueChange={(v) => onChange(updateCondition(value, i, { op: v, value: toValue(v, toLiteral(c.value)) }))}>
            <SelectTrigger aria-label="Where operator" className="h-6 w-20 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{OPS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
          </Select>
          <Input aria-label="Where value" className="h-6 flex-1 text-xs" value={toLiteral(c.value)} onChange={(e) => onChange(updateCondition(value, i, { value: toValue(c.op, e.target.value) }))} />
          <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0" aria-label="Remove where" onClick={() => onChange(removeCondition(value, i))}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" className="h-6 self-start text-[11px]" onClick={() => onChange(addCondition(value, dims))}>+ condition</Button>
    </div>
  );
}
```

In `BuilderForm.tsx`: remove the single "Measure" `<label>…</label>` block and the now-unused `setMetricPatch` import; add:

```tsx
import { MeasuresEditor } from './MeasuresEditor';
import { measuresOf, setMeasuresPatch } from './builderForm.model';
```
(fold `measuresOf`/`setMeasuresPatch` into the existing `./builderForm.model` import instead of a second import line). Replace the removed Measure block with:

```tsx
      <div className="text-sm">
        Summarize
        <div className="mt-1">
          <MeasuresEditor value={measuresOf(value)} model={model} onChange={(list) => onChange(setMeasuresPatch(value, list))} />
        </div>
      </div>
```

Update `BuilderForm.test.tsx`'s first smoke test: replace the `getByLabelText('Measure')` assertion with `expect(getByLabelText('Add measure')).toBeTruthy();`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio test -- src/dashboard/editor/MeasuresEditor.test.tsx src/dashboard/editor/builderForm.model.test.ts src/dashboard/editor/BuilderForm.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/dashboard/editor/MeasuresEditor.tsx apps/studio/src/dashboard/editor/MeasuresEditor.test.tsx apps/studio/src/dashboard/editor/builderForm.model.ts apps/studio/src/dashboard/editor/builderForm.model.test.ts apps/studio/src/dashboard/editor/BuilderForm.tsx apps/studio/src/dashboard/editor/BuilderForm.test.tsx
git commit -m "feat(studio): Summarize measures list with per-measure where + derived formula rows"
```

### Task 9: Chart→table auto-switch + KPI wide-result display test

**Files:**
- Modify: `apps/studio/src/dashboard/editor/WidgetEditorDialog.tsx`
- Modify: `apps/studio/src/dashboard/widgets/widgets.test.tsx`

**Interfaces:**
- Consumes: `measuresOf` (Task 8).
- Produces: when the builder query becomes multi-measure (`metrics.length > 1`) while `type` is a chart (not `table`/`kpi`/`gauge`/`progress-bar`/`traffic-light`), the dialog switches `type` to `'table'`.

- [ ] **Step 1: Write the failing test (KPI reads a wide-result measure column)**

First inspect `widgets/widgets.test.tsx` to match its render helper, then add a KPI test proving a chosen measure column is shown. Add:

```tsx
import { KpiWidget } from './KpiWidget';
// ...
describe('KpiWidget wide result', () => {
  it('shows the measure named by visual.yAxisKey', () => {
    const config = { id: 'w', type: 'kpi', title: '% Abnormal', refreshIntervalSec: 0, visual: { yAxisKey: 'pct' }, query: { mode: 'sql', sql: '' } } as any;
    const result = { columns: [{ key: 'label', label: 'Facility' }, { key: 'total', label: 'Total' }, { key: 'pct', label: '%' }], rows: [{ label: 'Mbeya', total: 1204, pct: 12.3 }] } as any;
    const { getByText } = render(<KpiWidget config={config} result={result} />);
    expect(getByText('12.3')).toBeTruthy();
  });
});
```

(Use the same `render` import the file already has; if the file lacks a top-level `render` import from `@testing-library/react`, add it.)

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `pnpm --filter @openldr/studio test -- src/dashboard/widgets/widgets.test.tsx`
Expected: PASS immediately (proves the existing `yAxisKey` path already selects the measure — this test guards the "no `displayMetricKey` needed" decision). If it fails, `KpiWidget` needs the `row[yKey]` lookup, which it already has per current source — investigate before proceeding.

- [ ] **Step 3: Implement the chart→table auto-switch**

In `WidgetEditorDialog.tsx`, add `measuresOf` to the `./builderForm.model` import. Then add this effect right after the existing builder-preview effect (the one keyed on `[mode, JSON.stringify(builderQuery)]`):

```tsx
  // Multi-measure results are a table (all measures → columns). If the user adds a second measure
  // while a chart type is selected, switch to Table — charts plot only one measure.
  useEffect(() => {
    if (mode !== 'builder') return;
    const multi = measuresOf(builderQuery).length > 1;
    const singleValue = ['table', 'kpi', 'gauge', 'progress-bar', 'traffic-light'].includes(type);
    if (multi && !singleValue) setType('table');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, JSON.stringify(builderQuery.metrics ?? null)]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/studio test -- src/dashboard/widgets/widgets.test.tsx src/dashboard/editor/WidgetEditorDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/dashboard/editor/WidgetEditorDialog.tsx apps/studio/src/dashboard/widgets/widgets.test.tsx
git commit -m "feat(studio): auto-switch to table on multi-measure; KPI shows selected measure column"
```

---

## Slice 4 — Recognizer relax (multi-measure)

### Task 10: Emit `metrics[]` instead of refusing multi-measure

**Files:**
- Modify: `packages/dashboards/src/recognize-sql.ts`
- Test: `packages/dashboards/src/recognize-sql.test.ts`

**Interfaces:**
- Produces: `recognizeSql` now returns a builder query with `metrics[]` (and `metric` = the first measure) for a SELECT projecting multiple aggregate measures over one group-by dimension. The `multi_measure` refusal code is removed from the emitted refusals.

- [ ] **Step 1: Update the failing tests**

In `recognize-sql.test.ts`, replace the `refuses multiple measures` test with a recognition test:

```ts
  it('recognizes multiple measures as a wide (metrics[]) query', () => {
    const r = recognizeSql('SELECT observation_desc AS label, COUNT(*) AS x, AVG(numeric_value) AS y FROM lab_results GROUP BY observation_desc');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.query.metric).toMatchObject({ key: 'count', agg: 'count' });
      expect(r.query.metrics?.map((m) => m.key)).toEqual(['count', 'avg_value']);
      expect(r.query.dimension).toEqual({ key: 'code_text' });
    }
  });
```

Update the corpus test to expect 10 passes and drop `multi_measure` from refusals:

```ts
  it('recognizes exactly 10 of the 13 seeded widgets, with expected refusal codes', () => {
    const results = board.widgets.map((w: any) => ({ title: w.title, r: recognizeSql(w.query.sql) }));
    const passed = results.filter((x) => x.r.ok).map((x) => x.title);
    expect(passed.length).toBe(10);
    const refusals = Object.fromEntries(results.filter((x) => !x.r.ok).map((x) => [x.title, (x.r as any).code]));
    expect(refusals).toEqual({
      'Result Finalisation %': 'case_measure',
      'Order → Report Pipeline': 'union',
      'Recent Orders': 'detail_rows',
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/dashboards test -- src/recognize-sql.test.ts`
Expected: FAIL — multi-measure still refused; corpus still 9.

- [ ] **Step 3: Implement**

In `recognize-sql.ts`:

1. Change the measure-alias capture so the FIRST measure's alias wins (the primary measure). Replace line 106 (`if (agg) { measures.push(agg); if (alias) measureAlias = alias; continue; }`) with — note the alias is captured only while `measures` is still empty, before the push:

```ts
      if (agg) { if (alias && measures.length === 0) measureAlias = alias; measures.push(agg); continue; }
```

2. Delete the refusal on line 111:

```ts
    if (measures.length > 1) refuse('multi_measure', 'multiple measures — not supported in the builder yet');
```

3. Build the query with `metrics[]` when multiple. Replace the final query assembly (lines 155–157) with:

```ts
    const query: BuilderQuery = { mode: 'builder', model: reg!.model, metric: measures[0] as never, filters };
    if (measures.length > 1) query.metrics = measures as never;
    if (dimension) query.dimension = dimension;
    if (limit != null) query.limit = limit;
```

Leave the `'multi_measure'` entry in the `RecognizeCode` union (Task keeps the type stable; it is simply no longer emitted). Optionally remove it — leaving it is lower-risk.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/dashboards test -- src/recognize-sql.test.ts`
Expected: PASS — multi-measure recognized; corpus 10/13.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/recognize-sql.ts packages/dashboards/src/recognize-sql.test.ts
git commit -m "feat(dashboards): recognize multi-measure SQL into metrics[] (corpus 9->10)"
```

---

## Final verification (whole-branch)

- [ ] Run the full studio and dashboards suites in isolation:

Run: `pnpm --filter @openldr/studio test`
Expected: PASS (all prior studio tests + the new ones).

Run: `pnpm --filter @openldr/dashboards test`
Expected: PASS.

- [ ] Typecheck both packages:

Run: `pnpm --filter @openldr/studio exec tsc --noEmit`
Run: `pnpm --filter @openldr/dashboards exec tsc --noEmit`
Expected: no errors.

- [ ] **Live visual acceptance (manual, dark + light):** with the dev stack up (postgres `:5433`, studio `:5173`, api `:3000`), open a dashboard widget editor and confirm: (1) a Limit field appears once a Group by is set; (2) Summarize adds measures, a per-measure "only where", and a Formula row that computes a percent; (3) adding a 2nd measure flips the widget to a table; (4) the Filters section shows the AND/OR tree, nesting a group renders an "Any of" sub-group; (5) a `% Abnormal` KPI card shows the percent when its Value Column is set to the formula measure. This mirrors the v1 held-for-user visual acceptance.

---

## Self-Review

**Spec coverage:**
- Multi-measure list + `metric`/`metrics[]` mapping → Tasks 7, 8. ✓
- Per-measure "only where" (flat AND) → Task 8 (`WhereEditor`, reuses `conditionModel`). ✓
- Derived ratio (Formula row) → Tasks 7 (`addFormula`, aggregate-only refs, dangling-ref guard), 8 (formula UI). ✓
- Composable-first / shortcut deferred → shortcut is not in this plan (matches spec's deferral). ✓
- Display: Table (all columns) + KPI (pick measure) → Task 9 proves KPI uses `yAxisKey`; Table renders all columns via existing `TableWidget`. `displayMetricKey` dropped with rationale. ✓
- Charts stay single-measure; 2nd measure → table → Task 9 auto-switch. ✓
- Validation (unique keys, formula refs) → Task 7. ✓
- AND/OR tree always-on, arbitrary depth, legacy flat still compiles → Tasks 3, 4, 5. ✓
- `bindQuery` filterTree walk → Tasks 3 (`bindFilterTree`), 6. ✓
- Top-N number, gated on group-by/breakdown → Tasks 1, 2. ✓
- Recognizer relax 9→10; tree recognizer stays flat → Task 10 (multi-measure only; OR SQL still refuses via existing predicate parsing). ✓
- Eject faithfulness unchanged → no change to `compileBuilderToSql`; existing banner covers it. ✓

**Placeholder scan:** No `TODO`/`TBD`/"implement later" remain. Every code step carries the actual code to apply.

**Type consistency:** `Measure` (measures.model) is structurally the schema `Metric`; `setMeasuresPatch` casts to `BuilderQuery['metric']`/`['metrics']` at the boundary. `TreeGroup` (conditionTree.model) is cast to `BuilderQuery['filterTree']` in `setFilterTreePatch` and to the schema type in `bindQuery`. `measuresOf`/`setMeasuresPatch`/`setLimitPatch`/`setFilterTreePatch` are all added to `builderForm.model.ts` and imported consistently. `aggregateMeasures`/`toBuilderMetrics`/`addFormula` names match across Tasks 7–8.

**Open item flagged for review:** the tree editor does not (in this cut) surface the per-rule dashboard-filter binding toggle that the old flat `FilterConditionEditor` had; runtime binding still works (Task 6) but authoring a new binding for a builder widget currently routes through the Variables sheet. If per-rule binding UI in the tree is wanted, it is a follow-up task, not part of this plan.
