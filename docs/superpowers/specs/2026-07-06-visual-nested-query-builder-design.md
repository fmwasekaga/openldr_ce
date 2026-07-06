# Visual (Nested AND/OR) Query Builder

**Date:** 2026-07-06
**Origin:** Third and final part of the Report Builder improvement sequence (after
layout/space and starter-gallery+charts). Motivated by non-scripters needing
richer filtering than the flat all-AND list, and by the earlier slices deferring a
"visual/nested query builder" (reference: react-awesome-query-builder). The team
chose to BUILD a lightweight recursive editor rather than adopt that library, since
the recursive schema + compiler must be written either way and a native shadcn
editor stays consistent with the app.
**Status:** Design approved — ready for implementation plan.

## Goal

Let report authors express nested boolean logic — arbitrary AND/OR groups, e.g.
`status = completed AND (test = "Blood culture" OR test = "Urine culture")` — in a
visual editor, and have it compile to correct SQL. Today filtering is a flat list
of `{ dimension, op, value }` conditions that the compiler ANDs together
(`applyFilters` in `packages/dashboards/src/compile.ts`); there is no OR or
nesting anywhere in the schema, compiler, or UI.

## Decisions locked in brainstorming

- **Arbitrary-depth nesting** — fully recursive groups within groups.
- **Build a lightweight recursive editor** in shadcn/Tailwind (not
  react-awesome-query-builder).
- **Additive `filterTree`** — a new optional field on the builder query; flat
  `filters[]` stays and behaves exactly as today. No migration.
- **Report-builder surface only, as a Simple/Advanced toggle.** Dashboards keep
  their flat UI; the shared compiler supports `filterTree` for both.
- **Param binding + blank-drop + lint tree-walking are IN scope** (required so the
  tree reaches parity with flat filters, e.g. binding a date-range param).

## Architecture / boundaries

- **Schema + compiler** in `@openldr/dashboards` — the capability that makes OR /
  nesting run. Recursive `ConditionGroup` type + optional `filterTree` on the
  builder query; a recursive compiler emitting Kysely `eb.and` / `eb.or`.
- **Param resolution + lint** in `@openldr/report-builder` — `resolveQueryParams`
  and `lintReportTemplate` recurse the tree so `{{param.*}}` binding, blank-drop,
  and orphan/unused detection work inside groups.
- **UI** in `apps/studio` report-builder `QueryEditor` — a Simple/Advanced toggle
  and a recursive shadcn group editor.

The three layers have clean interfaces: the schema is the contract; the compiler
consumes it; the UI and param/lint code produce and inspect it.

## Part 1 — Schema (`packages/dashboards/src/types.ts`)

Two new schemas (a rule reuses the existing `FILTER_OPS` and the `QueryFilter`
value shape):

```
ConditionRuleSchema = z.object({
  kind: z.literal('rule'),
  dimension: z.string(),
  op: z.enum(FILTER_OPS),                       // eq | in | contains | gte | lte | between
  value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]).nullable(),
});

// Recursive: a group holds rules and/or nested groups. Zod needs z.lazy + an explicit type.
type ConditionNode = z.infer<typeof ConditionRuleSchema> | ConditionGroup;
interface ConditionGroup { kind: 'group'; combinator: 'and' | 'or'; children: ConditionNode[] }
const ConditionGroupSchema: z.ZodType<ConditionGroup> = z.lazy(() => z.object({
  kind: z.literal('group'),
  combinator: z.enum(['and', 'or']),
  children: z.array(z.union([ConditionRuleSchema, ConditionGroupSchema])),
}));
```

The builder variant of `WidgetQuerySchema` gains `filterTree: ConditionGroupSchema.optional()`.
Additive — existing stored queries (no `filterTree`) validate unchanged. Exported
types: `ConditionRule`, `ConditionGroup`, `ConditionNode`.

`apps/studio/src/api.ts` hand-maintains a `WidgetQuery` mirror (line ~259); add
`filterTree?: ConditionGroup` (with a mirrored `ConditionGroup`/`ConditionRule`
type) to the builder union member so the studio types stay in sync.

**Precedence:** when `filterTree` is present it **supersedes** flat `filters` (the
compiler uses the tree and ignores `filters`); when absent, flat `filters` behave
exactly as today.

## Part 2 — Compiler (`packages/dashboards/src/compile.ts`)

Kysely's expression builder supports `eb.and([...])` / `eb.or([...])`. Add a
recursive compiler that mirrors the operator logic already in `applyFilters`
(lines ~86–103), but as expressions instead of chained `.where`:

```
function compileRule(eb, model, rule): Expression {
  const ref = <resolve dimension.column>;      // same lookup applyFilters uses
  switch (rule.op) {
    case 'eq':      return eb(ref, '=', rule.value);
    case 'in':      return eb(ref, 'in', Array.isArray(rule.value) ? rule.value : [rule.value]);
    case 'contains':return eb(ref, 'like', likePattern(rule.value));
    case 'gte':     return eb(ref, '>=', rule.value);
    case 'lte':     return eb(ref, '<=', rule.value);
    case 'between': return eb.and([eb(ref, '>=', rule.value[0]), eb(ref, '<=', rule.value[1])]);
  }
}
function compileNode(eb, model, node): Expression | null {
  if (node.kind === 'rule') return compileRule(eb, model, node);
  const parts = node.children.map((c) => compileNode(eb, model, c)).filter(Boolean);
  if (parts.length === 0) return null;          // empty group contributes nothing
  return node.combinator === 'or' ? eb.or(parts) : eb.and(parts);
}
```

`applyFilters` gains one branch at the top: if `q.filterTree` is set, compile it
once — `const expr = compileNode(eb, model, q.filterTree)` — and add the predicate
only when non-null (`qb = expr ? qb.where(expr) : qb`), skipping the flat loop;
otherwise run the existing flat loop unchanged. An absent/empty tree adds **no**
`where` clause (no tautology injected). The exact expression-builder wiring
(callback `qb.where((eb) => ...)` vs. a pre-built expression) is an implementation
detail for the plan; the invariant is: empty/absent tree ⇒ no predicate.

**Backward-compat invariant:** with no `filterTree`, the emitted SQL is
byte-identical to today. A `compile.test` assertion locks this.

`likePattern` and the dimension/column resolution already exist in the file —
reuse them; do not reimplement.

## Part 3 — Param resolution + lint (`@openldr/report-builder`)

### 3a. `resolveQueryParams` (`src/render/run-template.ts`)
Currently (builder mode) it substitutes `{{param.*}}` in each flat filter value and
drops blank-valued filters. Extend it to also process `filterTree` when present:

- Recurse the tree; for each **rule**, substitute `{{param.*}}` in `value`, then
  **drop the rule** if the value is blank (`isBlankValue`) — same semantics as the
  flat date-range-unset case.
- After pruning rules, **drop any group left with no children** (recursively). If
  the root group becomes empty, delete `filterTree` (no constraint).
- Flat `filters` handling is unchanged for queries that use it.

This means an unset optional param (e.g. a date range) contributes no constraint
inside the tree, matching the flat behavior and the PDF/canvas agreement.

### 3b. `lintReportTemplate` (`src/lint.ts`)
The param-ref collector (line ~26–36) scans flat `filters` values for
`{{param.<id>}}`. Extend it to also walk `filterTree` rule values, so
`orphaned-param-ref` and used-parameter tracking work identically whether a param
is bound in a flat filter or a tree rule. The existing `daterange` → `from`/`to`
handling applies unchanged.

## Part 4 — UI (`apps/studio` report-builder)

### 4a. `RuleValueEditor.tsx` (new, extracted)
`FilterListEditor` currently inlines the literal⇄param value control (the
`{{param.id}}` toggle + select + literal input, with `literalToValue`/
`valueToLiteral`/`isParamValue` helpers). Extract this into a shared
`RuleValueEditor` component so both the flat editor and the tree editor use one
implementation and can't drift. `FilterListEditor` is refactored to consume it
(behavior unchanged; its existing tests stay green).

### 4b. `QueryGroupEditor.tsx` (new, recursive)
Renders a **group card**: a combinator toggle (AND / OR), a list of children, and
`+ Rule` / `+ Group` / remove controls. Each child is either:
- a **rule row** — dimension `<select>` + op `<select>` + `RuleValueEditor` +
  remove; or
- a nested **group card** — the component renders **itself** recursively.

Immutable updates via a small set of pure tree helpers (add rule, add group,
update node at path, remove node at path, set combinator) kept in a
`queryTreeModel.ts` alongside the editor and unit-tested independently of React
(so recursion logic is tested without jsdom). Props: `{ group, dimensions,
parameters, onChange }`.

### 4c. `QueryEditor.tsx` toggle
Add a **Simple / Advanced (AND/OR)** segmented toggle in builder mode (for
kpi/chart/table-own-query). 
- *Simple* → the existing `FilterListEditor` bound to flat `filters` (unchanged).
- *Advanced* → `QueryGroupEditor` bound to `filterTree`.
- Switching **Simple → Advanced** seeds `filterTree` from the current flat filters
  as a single AND group: `{ kind:'group', combinator:'and', children: filters.map(f
  => ({ kind:'rule', ...f })) }` — nothing lost. While Advanced, `filterTree` is
  authoritative; flat `filters` is cleared on the stored query so there's no
  ambiguity (the compiler would ignore it anyway).
- The toggle **reflects reality**: if a loaded query already has `filterTree`, the
  editor opens in Advanced.
- **Advanced → Simple revert** is allowed **only** when the tree is
  flat-representable (a single AND-group whose children are all plain rules). Then
  it flattens back to `filters`. If the tree contains OR or nesting, the Simple
  button is disabled with a tooltip ("Advanced logic can't be shown as a simple
  list") — no silent data loss.

i18n en/fr/pt for all new strings (`reportBuilder.query.simple/advanced`,
`reportBuilder.tree.*` — and/or/addRule/addGroup/removeGroup/revertBlocked, etc.),
fr/pt genuinely translated (typed `EnShape`).

## Data flow

Author toggles Advanced → `QueryGroupEditor` edits `filterTree` → stored on the
block's `WidgetQuery` → `useBlockData` runs it live (via `runWidgetQuery`) and the
PDF preview runs it (via `runTemplate`), both after `resolveQueryParams` prunes
blank param rules → `compileBuilderQuery` translates `filterTree` to
`eb.and/eb.or` → SQL. Lint walks `filterTree` for param issues and gates Publish
as today.

## Error handling / edge cases

- **Empty group** (no children): compiles to no predicate; `resolveQueryParams`
  prunes it. A brand-new Advanced tree starts as one empty AND group (renders, adds
  no filter until a rule is added).
- **`between`/`in` value shapes**: reuse the flat editor's array handling via
  `RuleValueEditor` (comma-split).
- **Param blank-drop inside OR**: dropping an unset-param rule from an OR group
  leaves the other branches; an entirely-pruned group is removed (contributes no
  constraint) — documented, intended.
- **filterTree + flat filters both somehow present** (hand-authored payload):
  compiler uses `filterTree`, ignores `filters` (precedence rule); lint walks both
  (harmless — union of refs).
- **SQL mode**: `filterTree` is builder-only; the sql path is unaffected.

## Testing

- **dashboards `compile.test`**: a nested `filterTree`
  (`status=completed AND (test=X OR test=Y)`) compiles and runs against the fixture
  DB returning the expected rows; a flat-`filters` query with no tree emits SQL
  identical to today (backward-compat).
- **report-builder**: `resolveQueryParams` recursion — a rule bound to an unset
  param is dropped and its now-empty group pruned; a bound param substitutes.
  `lint` recursion — an orphaned `{{param.x}}` inside a nested group is reported;
  a bound one counts the param used.
- **studio**: `queryTreeModel` pure helpers (add rule/group, update/remove at path,
  set combinator) unit-tested; `QueryGroupEditor` renders nested groups, adds a
  rule and a subgroup, toggles AND/OR, removes a nested node, binds a param via
  `RuleValueEditor`; `QueryEditor` toggle seeds the tree from flat filters and the
  revert guard disables Simple when the tree has OR/nesting. `FilterListEditor`
  existing tests stay green after the `RuleValueEditor` extraction.
- **Visual check** (dark + light) in the running builder: build an AND/OR tree,
  confirm the live canvas + Preview PDF reflect the OR logic.

## Gate

- Forced 31-package typecheck + test (`pnpm turbo run typecheck --force` then
  `test --force`) — schema/compiler live in shared `@openldr/dashboards`, consumed
  by dashboards, report-builder, server, studio; run the full gate. Never pipe
  turbo through `tail`.
- Pre-existing unrelated flakes (studio `api.test.ts` vitest-dedupe; parallel-load
  timeouts incl. plugins/users that pass in isolation) are not regressions.

## Scope / non-goals

- No dashboards **UI** for the tree this slice (compiler supports it; the widget
  editor keeps its flat filter UI).
- No migration of existing flat `filters` to trees (additive `filterTree` only).
- No new operators beyond the existing `FILTER_OPS`.
- No cross-model / join conditions (that is query-model Slice D).
- No export to Mongo/JsonLogic/other targets (RAQB features we don't need).

## Follow-ups (optional, later)

- Bring the visual editor to the dashboards widget editor (reuse
  `QueryGroupEditor`).
- A "revert flattens lossily with confirm" option if authors ask for it.
- Per-rule value pickers driven by dimension type (date picker, enum dropdown) —
  currently free-text like the flat editor.
