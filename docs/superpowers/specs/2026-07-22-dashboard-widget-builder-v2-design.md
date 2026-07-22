# Dashboard Widget Builder v2 — Design

**Date:** 2026-07-22
**Status:** Design approved; ready for implementation plan
**Predecessor:** [Dashboard Widget Builder + Builder⇆SQL toggle](./2026-07-22-dashboard-widget-builder-sql-toggle-design.md) (v1)

## Summary

Make the guided (no-SQL) dashboard widget builder advanced enough to author the
widgets that today can only be hand-written as JSON. v1 shipped a *single-measure*
guided builder (source → measure → filters → group-by → breakdown). This adds three
capabilities to that same builder:

1. **Summarize / multi-measure** — stack several measures, attach a per-measure
   condition, and compute one measure from another (derived ratio) → unlocks
   percentage KPIs (% positive, % rejected, % abnormal) and multi-column tables.
2. **AND/OR filter tree** — nested `A AND (B OR C)` conditions, replacing the flat
   ANDed filter list.
3. **Top-N** — "show the top N rows by the primary measure."

Analyst-tier cross-model joins and multi-stage queries stay out of scope (a separate
later track that needs real engine + model-graph work).

## The core premise (verified — RULE 0)

The dashboards **schema and compiler already support all three features**; only the
builder UI is missing. This was confirmed by reading the code, not assumed:

- **Top-N:** `WidgetQuerySchema` (builder arm) has `limit?: number`
  (`packages/dashboards/src/types.ts`). `applyTopN()`
  (`packages/dashboards/src/compile.ts`) sorts the shaped rows by the primary
  measure descending and slices to `limit`.
- **Multi-measure + derived + per-measure where:** `MetricSchema` has `where?`
  (ANDed predicate) and `derived?` (`DerivedRatioSchema`: numerator/denominator/
  scale/decimals); the builder arm has `metrics?: Metric[]`. `runWideQuery()`
  compiles the wide table, emits conditional `sum(case when … )` aggregates for
  `where`, and computes derived ratios post-aggregation (`ratio()`).
- **AND/OR tree:** the builder arm has `filterTree?: ConditionGroup`
  (recursive `ConditionGroup` / `ConditionRule`). `compileNode()` recursively
  compiles it to Kysely `eb.and` / `eb.or`; `filterTree` supersedes flat `filters`
  when present.

The current UI (`apps/studio/src/dashboard/editor/BuilderForm.tsx` +
`builderForm.model.ts`) authors only the single `metric` and the flat `filters`.

Consequence: v2 is **UI + pure-model wiring**, with exactly **two small
engine/schema touches** (below). No changes to query compilation.

## Layout

One tall, sectioned vertical panel — the shape approved in the orientation mockup.
Sections top-to-bottom: **Source → Summarize → Filters → Group by (+ grain) →
Breakdown → Limit**. New complexity is progressively disclosed (expandable measure
rows, group chrome that only appears when a filter group is added); the simple
single-measure / single-filter path looks essentially identical to v1.

---

## 1. Summarize — multi-measure + derived ratios

### Measures list
The single "Measure" `Select` becomes a **measures list**:

- **One row** → serialized as the existing single `metric` (charts/KPIs behave
  exactly as v1).
- **Two or more rows** → serialized as `metrics[]` (wide/table shape via
  `runWideQuery`). The first row is the **primary** measure (used for the chart Y
  axis and Top-N sort).

The `metric` ⇄ `metrics[]` duality is hidden from the user: they always see "a list
of measures"; the model layer maps list-length to the right schema field on save.

### Measure row (composable)
Each row expands inline (collapse/expand, no per-measure dialog) to edit:

- **Aggregate:** `count | count_distinct | sum | avg | min | max` (the `AGGS` enum).
- **Column:** required for every agg except `count` (matches `metricExpr`).
- **Only where** (optional): a **flat, ANDed** condition list scoped to this one
  measure (`Metric.where`). This is deliberately *not* the AND/OR tree — the engine's
  per-metric predicate is a flat `QueryFilter[]`. Produces the conditional
  `sum(case when … then 1 else 0 end)` aggregate. This is what makes a *filtered*
  count (e.g. "count where abnormal = H") possible.
- **Label** (`Metric.label`) and an internal **key** (`Metric.key`, stable, unique).

### Formula row (derived ratio)
A distinct row type ("Formula — ratio of two measures") authoring `Metric.derived`:

- **Numerator** and **denominator** dropdowns — list only **aggregate (non-derived)
  measures** in the current list (the engine requires derived refs to resolve to
  `aggKeys`; a formula cannot reference another formula).
- **Format:** Percent (`scale = 100`) or plain number (`scale = 1`); **decimals**
  (`DerivedRatioSchema.decimals`).
- **Label.** Computed post-aggregation per output row; div-by-zero → 0 (engine `ratio()`).

### Percentage authoring
- **Now:** composable — the user adds the two counts, then a Formula row divides them
  (~3 rows for a percentage). Fully general, transparent, maps 1:1 to the engine.
- **Deferred fast-follow:** an "Add percentage" shortcut — one action ("percent of
  rows where X, out of all/where Y") that generates the hidden counts + formula row.
  Sugar over the composable foundation; not in the first cut.

### Display by widget type
Multi-measure is supported for two output families:

- **Table:** every measure becomes a column (`runWideQuery` columns; derived columns
  carry `kind:'percent'` + `decimals`).
- **KPI / single-value cards:** display **one** chosen measure. Requires a new
  **`displayMetricKey`** field on the visual config so the card knows which wide
  column to render (see Engine/schema touches). This is what makes the **% KPI card**
  work — the headline use case.
- **Charts (bar/line/area/row/pie/scatter/etc.):** stay **single-measure**. Adding a
  second measure while a chart type is selected **auto-switches the widget to Table**
  (the user can then switch to a KPI card + pick a display measure). Charts are not
  given a per-measure plot picker in this cut.

### Validation
- Measure keys unique within the list.
- A Formula's numerator/denominator must reference existing aggregate measures;
  deleting a measure that a Formula references is blocked (or warns and clears the
  reference) rather than producing an invalid query.
- `count` requires no column; all other aggs require a column.

---

## 2. Filters — AND/OR tree (always-on)

The flat `FilterConditionEditor` is replaced by a **group/rule tree**
(`react-awesome-query-builder`-style), authoring `filterTree`:

- A **root group** with an **All / Any** combinator (`ConditionGroup.combinator`
  = `and` / `or`), containing **rules** (`ConditionRule` = dimension/op/value) and
  **nested groups**. `+ condition` and `+ group` affordances; per-row / per-group
  delete.
- **Arbitrary nesting depth** (engine `compileNode` recurses); indentation is capped
  visually so deep trees stay readable.
- **Simple = flat:** a root "All" group containing only rules looks essentially
  identical to v1's flat list. Group chrome (the combinator pill, group borders) only
  appears once the user adds a nested group. **No "simple/advanced" mode toggle** —
  one surface.
- **Dashboard-filter binding preserved:** a rule can bind to a dashboard filter
  variable (as v1's flat rows can). Empty/all-null trees contribute no predicate
  (engine skips them).

### Backward compatibility & the binding work item
- Existing widgets persisted with flat `filters` keep working unchanged — the
  compiler reads `filterTree` when present, else `filters`. New widgets author
  `filterTree`. (Whether to migrate old `filters` → a root group on load, or leave
  them as-is and only write `filterTree` for newly-touched widgets, is an
  implementation choice for the plan; both compile identically.)
- **Real work item (not free):** runtime dashboard-filter binding lives in
  `bindQuery` in `apps/studio/src/dashboard/DashboardWidget.tsx` and today walks only
  the **flat `filters`** array. It must be extended to walk `filterTree` and inject
  the live filter value at the bound rule; otherwise a binding placed *inside a group*
  silently fails to apply at runtime.

---

## 3. Top-N (limit)

- A single **number** control ("Show top N"), authoring `limit`.
- **Shown only when the widget has a Group by or breakdown** — an ungrouped single
  value has nothing to rank.
- Ranks by the **primary (first) measure, highest first** — exactly what `applyTopN`
  does. No sort-measure picker and no ascending/"bottom N" in this cut (that would
  need an engine change to `applyTopN`); the user reorders measures to change what it
  ranks by. A "by [measure] [highest/lowest]" control is a possible later addition.

---

## Engine / schema touches (the only non-UI work)

1. **`displayMetricKey` on the visual schema** (`WidgetVisualSchema`, `types.ts`):
   optional string naming which measure a single-value (KPI-style) widget renders from
   a wide result. The KPI/single-value renderer reads it; falls back to the primary
   measure when unset. Small, additive, backward-compatible.
2. **`bindQuery` filterTree walk** (`DashboardWidget.tsx`): extend runtime binding to
   traverse `filterTree` in addition to flat `filters`.

Everything else — measures list, per-measure where, formula row, filter tree editor,
Top-N control — is UI plus pure state-transition helpers.

## Recognizer (SQL → Builder) invariant

`recognize-sql.ts` must accept **⊆** what the builder can author (v1 capability
invariant). With multi-measure authoring landing, relax the recognizer's
`multi_measure` refusal so the corpus gate improves **9/13 → 10/13** against the
seeded `mode:'sql'` widgets. The filter-tree recognizer stays **flat-AND only** —
recognizing arbitrary OR/nested SQL is out of scope; OR SQL simply refuses (still a
valid subset). Top-N is already recognized.

## Builder → SQL eject faithfulness

Unchanged from v1: derived ratios, date-grain bucketing, and multi-measure shaping run
in **JS after fetch**, so Builder→SQL eject is **not faithful** for those (the existing
warning banner covers it). The **filter tree does compile to SQL**, so it ejects
faithfully.

## Conventions (carried from v1)

- shadcn/ui controls only; never native `<select>`.
- Radix Selects are not jsdom-drivable → keep logic in **pure model helpers**
  (`builderForm.model.ts` and a new `conditionTree.model.ts` for the tree) and
  **unit-test those**; component tests are render smoke-tests; interaction is driven
  by a throwaway Playwright script.
- `recognizeSql` imported via `@openldr/dashboards/pure` (the root barrel pulls kysely
  into the browser).
- i18n strings in en/fr/pt, typed against `EnShape`.
- Verify each touched package **in isolation** (`turbo test --force` across the repo
  cascades unrelated DB/parallel-load flakes).
- Execute **subagent-driven** with a per-task review gate (it caught real bugs in v1).

## Suggested implementation slices (each independently shippable)

1. **Top-N control** — number input in the builder, gated on group-by/breakdown;
   pure-model + wiring. (Smallest; `limit` schema already present.)
2. **Filter tree** — `conditionTree.model.ts` + tree editor component replacing the
   flat editor; author `filterTree`; **extend `bindQuery`** to walk it; keep old flat
   `filters` compiling.
3. **Summarize** — measures list, per-measure "only where", Formula row, list ⇄
   `metric`/`metrics[]` mapping, chart→table auto-switch, `displayMetricKey` +
   KPI-card wide rendering.
4. **Recognizer relax + corpus gate** — drop the `multi_measure` refusal; re-measure
   the 13-widget corpus to confirm 10/13.

## Key files

- **UI:** `apps/studio/src/dashboard/editor/` — `WidgetEditorDialog.tsx`,
  `BuilderForm.tsx` + `builderForm.model.ts`, `FilterConditionEditor.tsx` +
  `conditionModel.ts` (+ new `conditionTree.model.ts`).
- **Runtime:** `apps/studio/src/dashboard/DashboardWidget.tsx` (`bindQuery`).
- **Engine:** `packages/dashboards/src/` — `types.ts`, `compile.ts`,
  `recognize-sql.ts`.
- **Corpus:** `packages/dashboards/src/samples/openldr-general.json`.

## Out of scope

- Analyst-tier cross-model joins and multi-stage queries (separate later track).
- The "Add percentage" shortcut (deferred fast-follow over composable measures).
- Sort-measure / ascending ("bottom N") control on Top-N.
- Per-measure plot pickers on chart widget types.
- Recognizing OR/nested SQL back into a `filterTree`.
