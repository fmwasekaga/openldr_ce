# Report Builder — Phase 3b: Data + Parameters — Design Spec

**Date:** 2026-07-03
**Status:** Approved for planning
**Depends on:** Phase 1 (`b9a9ed83`) + Phase 2 renderer (`10c6cf1c`) + Phase 3a builder UI (`2b6cf96d`)
**Parent design:** `docs/superpowers/specs/2026-07-03-report-builder-phase3-builder-ui-design.md`
**Related:** [report-builder-workstream], dashboards query editor (`BuilderForm`, `WidgetEditorDialog`, `DashboardFilterEditor`, `renderWidget`)

## Problem

Phase 3a shipped the builder shell + WYSIWYG canvas, but data blocks (kpi/chart/table) have no way to
configure their queries — charts render placeholders, and there are no report parameters. Phase 3b makes
reports **actually query and filter data**: an inspector query editor (builder + SQL), live data in the
canvas (real recharts/tables), report parameters bound into query filters, and multi-series charts.

## Decisions (locked during brainstorm)

1. **Canvas data:** **live** — each data block runs its query via the existing `runWidgetQuery`
   (`/api/dashboards/query`), cached by resolved-query-JSON + debounced, so the canvas shows real data and
   true row counts.
2. **Query authoring:** **builder + SQL** — reuse `BuilderForm` for builder mode; reuse the
   `WidgetEditorDialog` SQL machinery (CodeMirror + `dashboard.raw_sql` gating + template vetting) for SQL.
3. **Multi-series charts:** **yes** — multiple value columns (SQL) or a breakdown dimension (builder) →
   multiple series + the legend already coded in the Phase-2 chart drawers.
4. **(inherited) Full param binding:** a filter's value can bind to a defined parameter, stored as
   `{{param.<id>}}` and resolved at render by Phase-2 `resolveQueryParams`.

The `ReportTemplate` data model is largely unchanged (params + block queries already exist); the only
schema addition is an optional **breakdown dimension** on chart queries (§E).

## Architecture

### Reuse map

| New capability | Built on (existing) |
| --- | --- |
| Editor query layer (`useBlockData`) | `runWidgetQuery` (`/api/dashboards/query`) |
| Live chart/KPI rendering in canvas | `renderWidget(config, result)` (recharts) |
| Builder query editing | `BuilderForm` (source/metric/group-by/grain) |
| SQL query editing | `WidgetEditorDialog` SQL machinery (CodeMirror, `dashboard.raw_sql`, vetting) |
| Parameters editor | mirror `DashboardFilterEditor` (id/label/type/default) |
| Filter editor + param binding | **new** `FilterListEditor` (dimension/op/value⇄param) |
| Multi-series | `toChartData` (Phase-2 `paint.ts`) + canvas recharts mapping |

Purity note: canvas/layout code still imports from `@openldr/report-builder/pure` only. `useBlockData`,
`QueryEditor`, and the recharts rendering live in `apps/studio` and may import the studio api + dashboard
components freely (browser code).

### B. Live-data layer — `useBlockData(template, params)`

The browser twin of the server's `runTemplate`. For each data block (kpi/chart/table with its own query,
plus the primary dataset), it resolves the query (applying `{{param.x}}` via the same substitution rule
as `resolveQueryParams`), runs it through `runWidgetQuery`, **caches by resolved-query-JSON** (identical
queries fetch once), and **debounces** so inspector typing doesn't hammer the API. Returns
`Map<cellKey, { result?, error?, loading }>` (cellKey = `${rowIndex}:${cellIndex}`, plus a `primary` key).

The canvas consumes it: real `ReportResult`s feed recharts/tables/KPIs, and **real row counts feed
`computeLayout`** (replacing P3a's fixed sample count) so canvas pagination is accurate. Per-block
loading/error render inline.

### C. Inspector `QueryEditor` (kpi/chart/table)

A **Builder/SQL toggle** atop the data-block inspector:

- **Builder mode:** reused `BuilderForm` (source/metric/group-by/grain) + a new **`FilterListEditor`**:
  each filter is `dimension` (model dimensions dropdown) · `op` (eq/in/contains/gte/lte/between) ·
  **value** with a **literal ⇄ parameter** toggle. "Parameter" swaps the value input for a dropdown of
  the report's parameters and stores `{{param.<id>}}`. Chart blocks add a **chart-type** control
  (bar/line/pie) and a **Breakdown → series** dimension (§E); table blocks add a primary-vs-own-query
  switch + column picker.
- **SQL mode:** a compact CodeMirror SQL editor reusing the `WidgetEditorDialog` machinery — `{{var}}`
  detection, `dashboard.raw_sql` gating (SQL read-only when the flag is off; vetted templates still
  preview), template vetting. SQL `{{var}}`s bind to report parameters (var → parameter dropdown),
  writing `variableBindings`/`values` so the server substitutes at render.

### D. Parameters — `ParametersEditor`

Opened from the header "Parameters" affordance; mirrors `DashboardFilterEditor`. Each report parameter:
`id` · `label` · `type` (`daterange`/`select`/`text`) · options/default. Populates the parameter
dropdowns in filter/SQL binding, and the **preview param form** in `PreviewPdfDialog` (collect values →
render the real PDF). Writes the existing `ReportTemplate.parameters[]` — no schema change.

### E. Multi-series charts

The one piece that reaches back into Phase 2:
- **Schema:** a chart's builder query gains an optional **breakdown dimension** (a second group-by); SQL
  results naturally carry multiple value columns.
- **Renderer (`toChartData` in Phase-2 `paint.ts`):** pivot on the breakdown / map each numeric result
  column to a series → the multi-series legend already coded in the chart drawers activates. Chart height
  in `computeLayout` stays fixed. Single-series charts omit the legend (closes the Phase-2 "dead legend"
  note).
- **Canvas:** the recharts preview (`renderWidget`) receives the same multi-column result, so the live
  chart matches the PDF.
- **UI:** the "Breakdown → series" dropdown (builder) or column selection (SQL).

This modifies Phase-2 renderer code, so it is its own sub-plan with cross-package care (the pdfkit
renderer and the recharts canvas must agree on the pivot).

## Testing

- **`useBlockData`:** mocked `runWidgetQuery` — dedup (identical queries fetch once), `{{param.x}}`
  substitution, per-block loading/error, refetch on query change.
- **`QueryEditor` (builder):** RTL — source/metric/group-by updates the query; filter value → parameter
  serializes `{{param.<id>}}`; unbind → literal.
- **`FilterListEditor` / `ParametersEditor`:** RTL — add/edit/remove; ParametersEditor writes
  `template.parameters[]`.
- **Live canvas:** `CanvasBlock` given a `ReportResult` renders recharts / real table / KPI.
- **SQL mode:** RTL — toggle to SQL, read-only when `dashboard.raw_sql` off, var→param binding writes
  `variableBindings`.
- **Multi-series:** `toChartData` unit test — multi-value-column result yields N series; recharts mapping.
- **Preview param form:** collects values → `previewReportTemplate` called with them.

## Scope boundaries (YAGNI for P3b)

**In:** live-data layer, builder + SQL query editing, filters + full param binding, parameters editor,
preview param form, multi-series bar/line/pie.

**Out:** scatter/gauge/funnel in reports (renderer supports bar/line/pie/kpi/table only); auto-refresh /
per-block refresh intervals; the P3a-deferred hardening (save-refetch clobber, delete confirmation, true
drag-reorder) — those stay in **P3c**.

## Decomposition — four shippable sub-plans (each its own plan + subagent execution)

1. **P3b-1 — Builder query + live canvas:** `useBlockData` (fetch/dedup/debounce via `runWidgetQuery`) +
   `BuilderForm` in the inspector for kpi/chart/table + live recharts/table/KPI canvas rendering + real
   row counts into `computeLayout` (single-series). *Deliverable: build a builder-query chart, see live
   data in the canvas.*
2. **P3b-2 — Filters + parameters + binding:** `FilterListEditor` (dimension/op/value⇄param) +
   `ParametersEditor` + preview param form.
3. **P3b-3 — SQL mode:** builder↔SQL toggle + compact CodeMirror editor + `dashboard.raw_sql`
   gating/vetting + SQL var→param binding.
4. **P3b-4 — Multi-series:** breakdown dimension + `toChartData` multi-series (Phase-2 renderer) + canvas
   recharts mapping + legend + series-column UI.

Build order 1 → 2 → 3 → 4. This spec covers all four; the first implementation plan is **P3b-1**.

## Non-obvious constraints

- **Purity:** `useBlockData` reuses `resolveQueryParams`' substitution rule; it may import the pure helper
  from `@openldr/report-builder/pure` OR re-implement the tiny token replace client-side — do NOT import
  the server `runTemplate`.
- **Conventions:** shadcn controls only; reuse `BuilderForm`/`renderWidget`/`WidgetEditorDialog` pieces
  rather than reimplementing; mirror `DashboardFilterEditor` for `ParametersEditor`.
- **Renderer agreement (P3b-4):** the multi-series pivot in Phase-2 `toChartData` and the canvas
  `renderWidget` mapping must produce the same series from the same `ReportResult`, or the WYSIWYG
  promise breaks. Test both against one fixture result.
