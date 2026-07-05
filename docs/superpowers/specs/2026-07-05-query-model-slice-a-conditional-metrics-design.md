# Query-Model Expansion — Slice A: Conditional (Filtered) Metrics + Multi-Metric Tables

**Date:** 2026-07-05
**Workstream:** query-model-expansion (see memory `query-model-expansion-workstream`)
**Status:** Design approved — ready for implementation plan.

## Goal

Expand the shared `@openldr/dashboards` builder query model so a single grouped
query can express **conditional aggregate metrics** (`count where <dimension> =
<value>`) and carry **multiple metrics** as columns of one table. This is the
foundation the `amr-resistance` report needs: per antibiotic, the
Resistant/Intermediate/Susceptible counts (`tested`, `r`, `i`, `s`) are each a
conditional count over the same grouped set. The `%R` ratio that completes that
report is deferred to Slice B.

The change is in the **shared** dashboards package (dashboards widgets depend on
it too), so it must be **backward-compatible and additive**, and it must pass the
forced 31-package typecheck gate.

## Scope decisions (locked)

- **(a) Conditional predicate + multi-metric.** A metric gains an optional
  conditional predicate; a table query can carry several metrics that become
  columns of one grouped query. This is what makes `amr-resistance` reproducible
  (with `%R` arriving in Slice B).
- **SQL `CASE` conditional aggregation.** Portable ANSI SQL (identical on
  Postgres and MSSQL), one round-trip. This does *not* conflict with the repo's
  "math in JS, not dialect SQL" rule — that rule guards against non-portable date
  functions (`date_trunc`), whereas `CASE`/`SUM` is fully portable and the
  existing filter builder already emits SQL predicates.
- **Both UIs in this slice.** The reusable engine change lands for everyone; the
  Report Builder `QueryEditor` gains multi-metric + per-metric condition editing;
  the dashboards `BuilderForm` gains a conditional predicate on its single metric.

## Out of scope (YAGNI — explicit)

- `%R` / ratio (metric-from-metrics) → **Slice B**.
- **Param-binding** on metric predicates. Literals only in Slice A; the
  `amr-resistance` predicates are constant (`'R'`, `'I'`, `'S'`). (Query-level
  `filters` keep their existing param-binding; only the new metric `where` is
  literal-only.)
- `breakdown` + multi-metric simultaneously (mutually exclusive; validated).
- `avg`/`min`/`max` re-bucketed under a date grain (non-additive across buckets)
  — documented limitation; `amr-resistance` uses neither. Wide-mode date-grain
  bucketing sums each numeric column, which is correct for `count`/`sum` only.
- Wide-mode driving charts — wide mode is **table-oriented**. A default chart
  hint is emitted for schema completeness but the payoff is the table.
- Seeding the converted `amr-resistance` template → **Slice G**.

## Architecture

Three layers, each independently testable:

1. **Schema** (`packages/dashboards/src/types.ts`) — additive fields only.
2. **Compile/run** (`packages/dashboards/src/compile.ts`) — conditional
   aggregate expression + wide-table branch.
3. **UI** (`apps/studio/src/reports-builder/QueryEditor.tsx` + a new metric-list
   sub-component; `apps/studio/src/dashboard/editor/BuilderForm.tsx`; one shared
   literal-condition-row editor).

### 1. Schema (`packages/dashboards/src/types.ts`)

Reorder so `QueryFilterSchema` is defined **above** `MetricSchema` (it depends
only on `FILTER_OPS`, already at the top). Then:

```ts
export const MetricSchema = z.object({
  key: z.string(),
  label: z.string().optional(),
  agg: z.enum(AGGS),
  column: z.string().optional(),
  where: z.array(QueryFilterSchema).optional(),   // NEW — conditional predicate, ANDed
});

// within the builder branch of WidgetQuerySchema, additionally:
metrics: z.array(MetricSchema).optional(),        // NEW — multi-column table mode
```

- The metric predicate **reuses `QueryFilter`** (`dimension` / `op` / `value`) —
  same ops, same UI vocabulary as query-level filters.
- `metric` stays **required** → zero data migration; every stored dashboard and
  report template still validates unchanged.
- **Mode-selection rule:** `metrics` present and non-empty ⇒ *wide-table mode*
  (one column per metric, grouped by `dimension`); otherwise the existing
  single-`metric` path is used verbatim. Wide mode and `breakdown` are mutually
  exclusive (validated).

### 2. Compile (`packages/dashboards/src/compile.ts`)

**`condExpr(model, where: QueryFilter[])`** — new helper returning a portable
boolean SQL fragment. It mirrors `applyFilters`' op semantics but emits a `sql`
fragment instead of calling `.where()`:

| op | fragment |
|---|---|
| `eq` | `<ref> = <value>` |
| `in` | `<ref> in (<values…>)` |
| `contains` | `<ref> like <%escaped%>` (same escaping as `applyFilters`) |
| `gte` / `lte` | `<ref> >= <value>` / `<ref> <= <value>` |
| `between` | `<ref> >= <v0> and <ref> <= <v1>` |

- `value === null` conditions are skipped (as in `applyFilters`).
- Conditions are AND-ed: `(<f1> and <f2> …)`. Empty ⇒ `1=1`.
- Each `where.dimension` is validated via the existing `dim(model, …)` (throws on
  unknown dimension — guards against arbitrary columns).
- Values are **parameterized** via `${}` bindings (no injection). Columns via
  `sql.ref(dim.column)` are registry-sourced, never a raw user string.
- The `contains`-escaping regex is factored into a shared helper reused by
  `applyFilters` and `condExpr` so they can't drift.

**`metricExpr(model, m)`** — extend to wrap in `CASE` when `m.where` is present
and non-empty (no-`where` cases stay byte-identical to today):

| agg | with `where` |
|---|---|
| `count` | `sum(case when <cond> then 1 else 0 end)` |
| `sum` | `sum(case when <cond> then <col> else 0 end)` |
| `avg` | `avg(case when <cond> then <col> else null end)` |
| `min` / `max` | `min(case when <cond> then <col> else null end)` |
| `count_distinct` | `count(distinct case when <cond> then <col> else null end)` |

**`compileBuilderQuery`** — branch on mode:

- *Wide mode* (`q.metrics?.length`): select each metric expr `.as(metric.key)`;
  group by and order by `dimension` (label) if present; **no** breakdown.
- *Single mode*: existing path unchanged (one expr `.as('value')`, optional
  breakdown).

**`runBuilderQuery`** — branch on mode:

- *Wide mode*: fetched rows are `{ <labelCol>, <metricKey1>, <metricKey2>, … }`.
  - `columns` = `{ key: 'label', label: dim.label, kind }` + one
    `{ key: metric.key, label: metric.label ?? metric.key, kind: 'number' }` per
    metric.
  - `rows` map each fetched row to `{ label: r[labelCol] ?? '(none)',
    [metricKey]: Number(r[metricKey]) … }`.
  - If the dimension is a date with a grain: generalize the existing bucket loop
    to **sum every numeric metric column** per grain bucket (correct for
    count/sum; see out-of-scope note for non-additive aggs).
  - With no dimension: a single summary row with each metric as a column.
  - `chart` hint (table-oriented default): `{ type: 'bar', x: 'label', y:
    <firstMetric.key> }`.
- *Single mode*: unchanged.

### 3. UI

- **Reports `QueryEditor.tsx`** (table blocks): a new **Metrics list**
  sub-component — add/remove metric rows; each row = agg select + column select
  (from model dimensions/metric columns) + optional label + an inline
  **condition editor** producing a literal `QueryFilter[]` → `metric.where`. When
  the list is non-empty it sets `query.metrics`; `metric` is kept populated
  (default `count` / first metric) to satisfy the required field. This authors
  the `antibiotic | tested | r | i | s` table.
- **Dashboards `BuilderForm.tsx`**: after the existing metric `<select>`, an
  optional "only where…" condition editor → `metric.where` (conditional KPIs).
  Dashboards stay single-metric (KPIs are single-value); they get the predicate,
  not multi-metric.
- **Shared literal-condition-row editor**: one small component (under
  `apps/studio/src/dashboard/editor/` or a shared location) operating on
  `QueryFilter[]` against a model's dimensions, consumed by both UIs. Distinct
  from the existing `FilterListEditor` (which is coupled to `ReportParam`
  binding) — this one is literal-only.

## Validation & safety

- `metric.key` unique within `metrics[]` (used as the SQL column alias).
- Non-`count` aggs require `column` (existing rule, retained).
- `where.dimension` validated against `model.dimensions`.
- Metric `column` validated as a known dimension/metric column (existing
  `knownAsDimension`/`knownAsMetric` check, retained).
- Wide mode ⊕ breakdown enforced (error if both set).
- All predicate values parameterized; all column refs registry-sourced.

## Testing (TDD)

Engine (`packages/dashboards`):
- `metricExpr` compiled-SQL shape per agg × with/without `where`.
- `condExpr` per op (`eq/in/contains/gte/lte/between`), null-skip, AND-join,
  empty ⇒ `1=1`, unknown-dimension throws.
- `compileBuilderQuery` wide-mode select/group/order; breakdown-conflict error;
  duplicate-key error; missing-column error.
- `runBuilderQuery` wide-mode shaping; date-grain bucket sums each column;
  no-dimension single-row.
- **Backward-compat:** single-metric queries produce byte-identical SQL/shape to
  today.
- **Acceptance / the proof:** a wide query `dimension=code_text`,
  `metrics=[tested=count, r=count where interp=R, i=count where interp=I,
  s=count where interp=S]` against a fixture reproduces `pivotResistance`'s
  `r/i/s/tested` rows exactly (%R deferred to Slice B).

UI (`apps/studio`):
- `QueryEditor` renders the metric list; add/remove; condition editor edits
  `metric.where`; toggling to multi-metric sets `query.metrics`.
- `BuilderForm` conditional predicate sets `metric.where` on the single metric.

## Gate

- Forced 31-package typecheck (`turbo … --force`) — schema change is shared.
  Never pipe turbo through `tail` (masks exit code).
- Server routes passing `WidgetQuery` to compile are unaffected (additive
  schema). The report-builder renderer consumes `ReportResultData`
  (columns/rows) and already handles extra table columns.

## Follow-ups (later slices)

- **Slice B** — derived/ratio metrics (`%R = r / tested`); completes
  `amr-resistance`.
- **Slice G** — seed the converted `amr-resistance` builder template.
- Param-binding on metric predicates, if a later report needs a
  parameter-driven conditional metric.
