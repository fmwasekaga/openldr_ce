# Dashboard Widget Builder — Builder ⇆ SQL toggle (guided, no-SQL authoring)

**Date:** 2026-07-22
**Origin:** A supervisor demo raised: the Metabase-like dashboard has a powerful
SQL editor, but no visual builder for non-scripters. The dashboards already ship a
`builder` query mode (schema + compiler + runtime render), and an orphaned
`BuilderForm` — but the widget editor drops everyone straight into CodeMirror. This
revives guided authoring without diverging from the SQL editor, so users grow
familiar with both.
**Status:** Design — ready for implementation plan.

## Goal

Let a non-scripter build a dashboard widget without SQL — pick a source, a measure,
filters, a grouping, a chart — inside the **existing** widget editor, via a
`Builder | SQL` toggle that swaps **only** the CodeMirror region. The SQL editor,
preview, results table, chart config, and variables all stay exactly where they are.
An analyst can flip to SQL at any time and see (a compiled projection of) what the
builder produced. Hand-written SQL that maps onto the builder can be imported back;
SQL that can't is refused loudly with a reason, and the Builder tab is disabled
until the SQL parses clean.

## Decisions locked in brainstorming

- **One shell, two authoring modes** — NOT a separate dialog. A `Builder | SQL`
  segmented toggle sits in the editor **footer**, before the "N rows" counter. It
  swaps the top-left authoring region between the guided controls and the existing
  CodeMirror editor ([`WidgetEditorDialog.tsx`](../../../apps/studio/src/dashboard/editor/WidgetEditorDialog.tsx)).
  Everything downstream is unchanged because it all consumes the resulting
  `WidgetQuery`, whichever mode built it.
- **v1 = revive the guided builder for the non-scripter AND the analyst.** Joins /
  multi-stage are the **ceiling**, added later as additive schema, not v1.
- **Stored builder object is canonical** (Tier-0). A builder-authored widget
  persists its structured `builder` query, so Builder→SQL and back is a free,
  lossless render of one object — no parsing.
- **SQL→Builder is best-effort recognition** (Tier-1), never general translation.
  It bails safely with a reason string; the reason **is** the toast copy.
- **Filters v1 = flat list** (the existing `MetricConditionEditor` shape). The
  recursive AND/OR `filterTree` (schema + compiler already exist) is a pre-planned
  fast-follow, not v1.
- **Measure v1 = single measure + group-by + breakdown.** Multi-metric tables and
  derived ratios (schema already supports both) ship with a later guided tier.
- **One schema addition in v1: `limit` (top-N).** Measured on the real corpus it is
  the single change that most raises recognizer coverage and is independently useful
  (top-15 lists). A null-check filter op is deferred — its only beneficiary is the
  multi-metric scatter, which is itself deferred.

## Current state (measured, not assumed)

What already exists end-to-end:

- **Builder query model + compiler + runtime render.** `WidgetQuery` discriminated
  union has `mode:'builder'` ([`types.ts:68`](../../../packages/dashboards/src/types.ts));
  `compileBuilderQuery` / `runBuilderQuery` compile + shape it
  ([`compile.ts`](../../../packages/dashboards/src/compile.ts)); `DashboardWidget`
  renders builder widgets ([`DashboardWidget.tsx`](../../../apps/studio/src/dashboard/DashboardWidget.tsx)).
- **Dashboard-filter binding for builder widgets already runs.** `bindQuery`
  ([`DashboardWidget.tsx:5`](../../../apps/studio/src/dashboard/DashboardWidget.tsx))
  reads `q.variableBindings` (dimension key → dashboard filter id) and injects the
  live filter value as an `eq` filter at run time, dropping blanks. **The mechanism
  exists; only the authoring UI and richer ops (date-range) are missing.**
- **A guided form exists but is orphaned.** `BuilderForm` (source / measure /
  metric-`where` / group-by) + `MetricConditionEditor`
  ([`BuilderForm.tsx`](../../../apps/studio/src/dashboard/editor/BuilderForm.tsx))
  are imported by nothing but their tests; the editor hardcodes `mode:'sql'`.
- **`filterTree` (AND/OR) schema + compiler** exist and are tested; the **editor UI**
  was never built (spec/plan only).

**Recognizer prototype, run against the 13 seeded `mode:'sql'` widgets**
([`samples/openldr-general.json`](../../../packages/dashboards/src/samples/openldr-general.json)):

| Config | Recognized |
|---|---|
| Builder query model as-is | 8 / 13 (62%) |
| + `limit` field | 9 / 13 (69%) |
| + null-check op + multi-metric authoring | 10 / 13 (77%) |

The refusals sort cleanly:
- **Rescued by `limit`** (v1): bar chart "Orders by Test" (`FETCH 15`).
- **Deferred with multi-metric + null-op**: scatter "Analyte Volume vs Avg Value"
  (two aggregates + `IS NOT NULL` on a measure column).
- **Correctly stay SQL forever**: funnel (`UNION` across 4 tables), "Recent Orders"
  (a non-aggregated detail row list), gauge "Result Finalisation %" (conditional
  `CASE` ratio whose `ELSE 100` guard would change the number if silently imported).

So **v1 target = 9/13 of first-party SQL recognized**, with the remaining 4 either
deferred to a known follow-up or genuinely SQL-only — exactly where the
toast-and-disable guardrail belongs. (First-party seed SQL is tidy; arbitrary
analyst SQL will score lower — treat 69% as an optimistic ceiling for clean SQL.)

## Architecture / boundaries

- **`@openldr/dashboards`** (shared, pure): schema addition (`limit`), compiler
  support (top-N in JS post-shaping), and a new pure `recognizeSql` module. Pure +
  testable, reused by studio (and available to the CLI later).
- **`apps/studio`**: `WidgetEditorDialog` gains a `mode` state, the footer toggle,
  the Builder pane (extend `BuilderForm`), the binding control, and recognizer
  wiring (toast + disable). `api.ts` hand-mirror of `WidgetQuery` gains `limit`.
  `bindQuery` extended for date-range bindings.
- **`apps/server`**: no route change — `/api/dashboards/query` already
  `WidgetQuerySchema.parse`es the body ([`dashboards-routes.ts:55`](../../../apps/server/src/dashboards-routes.ts)),
  so the additive `limit` flows through; `runBuilderQuery` gains top-N shaping.

Interfaces stay clean: the schema is the contract; the compiler consumes it; the UI
+ recognizer produce and inspect it.

## Part 1 — Schema (`packages/dashboards/src/types.ts`)

Add one optional field to the **builder** variant of `WidgetQuerySchema`:

```
limit: z.number().int().positive().optional(),  // top-N of the shaped result, by primary measure desc
```

Additive — existing stored builder queries (no `limit`) validate unchanged. Mirror
in the studio hand-type `WidgetQuery` ([`api.ts:267`](../../../apps/studio/src/api.ts)).

**Deferred (documented, not v1):** a null-check filter op
(`FILTER_OPS += 'is_null' | 'not_null'`, value-less) ships with multi-metric
authoring, since its only corpus beneficiary is the deferred scatter.

## Part 2 — Compiler (`packages/dashboards/src/compile.ts`)

`limit` applies to the **shaped** result, in JS, consistent with the repo convention
that math/bucketing happens in JS (date-grain already does). After `runBuilderQuery`
/ `runWideQuery` build `shaped` (and after grain bucketing), when `q.limit` is set:
sort `shaped` by the primary measure descending, then `slice(0, q.limit)`. This
gives correct "top 15 by count" semantics **after** any date-grain roll-up (a SQL
`LIMIT` would wrongly cut pre-bucket rows) and stays dialect-free (targets are
Postgres / MSSQL / MySQL).

**Backward-compat invariant:** with no `limit`, output is identical to today. A
`compile.test` assertion locks this.

## Part 3 — SQL → Builder recognizer (`packages/dashboards/src/recognize-sql.ts`)

A pure, best-effort function: `recognizeSql(sql: string): { ok: true; query:
BuilderQuery } | { ok: false; reason: string }`. It recognizes only the narrow shape
the **v1 builder UI can author** (the capability invariant below), and refuses
everything else with a human reason.

Recognition rules (validated by the prototype `scratchpad/tier1-recognizer.mjs`):

- **Reject up front, with a reason**: `UNION`, `JOIN`, `WITH`/CTE, window `OVER(`,
  `CASE` inside a measure. Each yields a plain-language `reason`.
- **Template dialect**: strip `[[ … ]]` optional clauses (treat each inner as an
  optional predicate) and keep `{{var}}` tokens — the SQL is a template, not plain
  SQL, so a general parser is the wrong tool.
- **FROM → model** via a reverse `(table) → model` map derived from the models
  registry ([`registry.ts`](../../../packages/dashboards/src/models/registry.ts)).
- **SELECT list**: classify each item as an aggregate (`COUNT(*)`,
  `COUNT(DISTINCT col)`, `SUM|AVG|MIN|MAX(col)`, unwrapping `ROUND(…)` / `CAST(… AS
  …)`) → mapped to a model metric, or the single labelled dimension. `substring(col,
  1,10) AS label` → date dimension at `grain:'day'`.
- **WHERE / optional clauses** → filters: `col op literal|{{var}}` (`= → eq`,
  `>= → gte`, `<= → lte`), `col IN (…)` → `in`, `1=1` ignored, `col IS NOT NULL`
  tolerated only on the group-by column (builder shows nulls as `(none)`).
- **`OFFSET n ROWS FETCH NEXT m ROWS ONLY` / `LIMIT m`** → `limit`.
- **`{{var}}` bound values** map to `variableBindings` when the widget's variable is
  bound to a dashboard filter, else stay literal tokens.

**Capability invariant (critical):** `recognizeSql` must accept a **subset** of what
the builder UI can author. v1 UI = single measure + group-by + breakdown + flat
filters + `limit`, so the recognizer refuses multi-aggregate SELECTs ("multiple
measures — not supported yet") even though the compiler could run them. This
prevents importing a builder state the UI can't render. When multi-metric authoring
lands, the recognizer relaxes in lockstep.

**Tier-0 vs Tier-1:**
- A **builder-authored** widget stores its `builder` object → Builder⇄SQL is free
  and lossless (render both views of one object); no recognizer involved.
- A **SQL-authored** widget only offers Builder if `recognizeSql` returns `ok`.

## Part 4 — UI (`apps/studio` widget editor)

### 4a. Mode state + footer toggle (`WidgetEditorDialog.tsx`)
Add `mode: 'builder' | 'sql'` state. A `Builder | SQL` segmented control in the
editor footer, before the "N rows" counter. The top-left region renders the Builder
pane or the existing CodeMirror by mode; **the preview, results table, ConfigPanel,
Charts/Tables/Variables sheets, Run, and Save are untouched** — they read the
current `WidgetQuery`.

- **New widget** defaults to **Builder** (non-scripter front door); existing widgets
  open in their **saved** mode.
- **Save** emits the mode's query: builder mode persists the `builder` object (today
  it hardcodes `mode:'sql'` — this is the core change to `save()`); sql mode persists
  as today.

### 4b. Builder pane (extend `BuilderForm.tsx`)
Source → Measure → **Filters** → Group by → **Breakdown**. Extensions to the
orphaned form:
- **Top-level `filters[]` editor** (the query's WHERE), reusing the
  `MetricConditionEditor` row shape. (The existing form only edits `metric.where`;
  v1 needs the query-level `filters[]` shown in the mock.)
- **Breakdown** (series) select for multi-series charts (`q.breakdown`).
- **Live preview** on change via the existing `runWidgetQuery` path (builder mode).

### 4c. Dashboard-filter binding control (surfaces existing `variableBindings`)
Each filter row gets a `Value ⇆ Dashboard filter` toggle. "Dashboard filter" writes
`variableBindings[dimensionKey] = filterId`; the run-time `bindQuery` already injects
the live value. **Extension:** `bindQuery` currently pushes only `op:'eq'`; extend it
so a **date-range** dashboard filter expands to `gte` + `lte` (from/to), and so the
op matches the row's op. Unset filter → dropped (already the behavior).

### 4d. Builder ⇆ SQL switching semantics
- **Builder → SQL**: fill CodeMirror with `compileBuilderQuery(q).compile().sql`
  (parameters inlined for readability). A one-line banner notes that JS-side shaping
  (date-grain roll-up, derived ratios, top-N) runs after the query and isn't in this
  SQL. Editing there, then Save, persists as **sql mode** (the builder object is
  discarded — one-way eject). *Faithful eject that regenerates grain/ratio/limit as
  dialect SQL is a follow-up.*
- **SQL → Builder**: run `recognizeSql(sqlText)`. On `ok`, populate the Builder pane
  and switch. On refusal, **toast the `reason`** and keep the Builder tab **disabled**
  with the reason as its tooltip until the SQL parses clean. Trigger on **toggle
  click** and once on load — never per keystroke.

### 4e. i18n
en/fr/pt for all new strings (`widget.mode.builder/sql`, `widget.builder.source/
measure/filters/groupBy/breakdown`, `widget.bind.value/dashboardFilter`,
`widget.builder.ejectBanner`, and the recognizer reason strings), fr/pt genuinely
translated against the typed `EnShape`.

## Data flow

Author picks Builder → edits source/measure/filters/group-by/breakdown (+ optional
dashboard-filter bindings) → `runWidgetQuery` previews live → Save persists the
`builder` object. On the dashboard, `bindQuery` injects live filter values →
`/api/dashboards/query` → `runBuilderQuery` compiles (now honoring `limit` in JS
shaping) → widget renders. Flipping to SQL compiles the object to CodeMirror text;
flipping back runs `recognizeSql`.

## Error handling / edge cases

- **Unrecognized SQL** → Builder disabled + toast reason; SQL unaffected.
- **`limit` with a breakdown** → sort/slice by primary measure within the shaped
  rows; document that top-N applies to the label dimension, not per-series.
- **Date-range binding** → `bindQuery` expands to gte+lte; a half-open range binds
  only the present bound.
- **Builder object present + someone hand-edits stored JSON to also set `sql`** →
  n/a; the discriminated union makes a query exactly one mode.
- **Eject of a grain/ratio/limit widget** → banner warns the compiled SQL omits
  JS-side shaping; no silent behavior change claimed.

## Testing

- **dashboards `compile.test`**: `limit` sorts by primary measure desc then slices,
  after grain bucketing; absent `limit` → byte-identical SQL + output (backward
  compat).
- **dashboards `recognize-sql.test`**: run against all 13 seeded widgets; assert the
  exact pass set (9 with `limit`) and the exact refusal `reason` for each of the 4
  (UNION, detail-rows, CASE-measure, multi-measure). Assert produced `BuilderQuery`
  objects (variables → bindings, `IN`, day-grain, `count_distinct` → metric). Lock
  the capability invariant: a two-aggregate SELECT refuses in v1.
- **studio**: `WidgetEditorDialog` — new widget defaults to Builder; toggle swaps
  only the editor region; Builder→SQL fills CodeMirror + shows the banner; SQL→Builder
  on recognizable SQL populates the pane, on unrecognizable SQL toasts + disables
  Builder. Builder pane edits `filters[]`/`breakdown`; binding writes
  `variableBindings`. `BuilderForm` existing tests stay green.
- **studio**: `bindQuery` expands a date-range binding to gte+lte.
- **Visual check** (dark + light) in the running editor: build a widget end-to-end,
  flip to SQL and back, import a seeded SQL widget, confirm the funnel/table/gauge
  refuse with the right toast.

## Gate

Forced 31-package typecheck + test (`pnpm turbo run typecheck --force` then
`test --force`) — schema/compiler/recognizer live in shared `@openldr/dashboards`,
consumed by dashboards, server, and studio. Never pipe turbo through `tail`.
Pre-existing unrelated flakes (studio `api.test.ts` vitest-dedupe; parallel-load
timeouts) are not regressions.

## Scope / non-goals

- **No joins / multi-stage** (the analyst ceiling) — additive later:
  `joins?` / `stages?` on the builder variant + a model relationship graph + an
  "Advanced" section in this same shell. Nothing here is thrown away.
- **No AND/OR `filterTree` UI** this slice (flat filters only) — the recursive editor
  is the pre-planned fast-follow ([`2026-07-06-visual-nested-query-builder-design.md`](2026-07-06-visual-nested-query-builder-design.md)).
- **No multi-metric / derived-ratio authoring** this slice (schema supports it; adds
  the scatter + the gauge-ratio import when it lands, with the null-check op).
- **No faithful grain/ratio/limit SQL eject** — the SQL view is the fetch query plus
  a banner; regenerating JS shaping as dialect SQL is a follow-up.
- **No general SQL→Builder** — infeasible by design; refuse with a reason.

## Follow-ups (optional, later)

- Multi-metric tables + derived ratios in the builder, + the `is_null`/`not_null`
  op → recognizer relaxes to 10/13, brings the scatter.
- AND/OR `filterTree` editor (reuse across dashboards + report-builder).
- Analyst tier: cross-model joins + multi-stage.
- Faithful Builder→SQL eject (per-dialect `date_trunc` / ratio / `LIMIT`).
