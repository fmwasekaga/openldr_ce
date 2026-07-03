# Report Builder — Phase 3b-4: Multi-Series Charts — Design Spec

**Date:** 2026-07-03
**Status:** Approved for planning
**Depends on:** P3b-3 (`b9269fe0`) — SQL mode
**Parent design:** `docs/superpowers/specs/2026-07-03-report-builder-phase3b-data-parameters-design.md` (§E, decomposition #4)
**Related:** [report-builder-workstream], Phase-2 renderer (`paint.ts` `toChartData`, `charts/index.ts` `drawChart`), dashboards `compileBuilderQuery`/`runBuilderQuery`, `ChartWidget`

## Problem

Report charts are single-series: Phase-2's `toChartData` always emits one series, so the multi-series legend
already coded in `drawChart` is dead, and a chart can't show, e.g., OPD vs ICU counts by month. P3b-4 adds
multi-series bar/line charts fed two ways — **multiple numeric columns** (SQL/wide results) and a **builder
breakdown dimension** (a second group-by) — with the live canvas and the PDF agreeing via a shared pivot.

## What already exists (no work needed)

- **PDF renderer is multi-series-ready.** `charts/index.ts` `drawBar`/`drawLine` already draw grouped bars /
  multiple lines and a legend (`hasLegend = showLegend !== false && series.length > 1`). Only `toChartData`
  (paint.ts) needs to emit N series. Pie uses `series[0]` (single-series inherently); kpi uses
  `series[0].values[0]`.
- **`ChartData`/`ChartSeries`** types (`{ title, categories, series:[{name,values}] }`) already model
  multi-series.
- `ReportColumn.kind` (`'number'|'string'|'date'`) is on every result column, so numeric columns are
  identifiable without heuristics-on-values.

## Decisions (locked during brainstorm 2026-07-03)

1. **Both sources:** multi-numeric-column (SQL/wide) **and** a builder **breakdown dimension**.
2. **Anti-drift pivot:** a single pure `resultToChartData(result, opts)` in `@openldr/report-builder/pure`,
   used by both the PDF `toChartData` and the canvas — they cannot disagree.
3. **Canvas renderer = a new report-specific `ReportChart`** (recharts, multi-series), NOT an extension of
   the shared dashboards `ChartWidget` (which renders a single `dataKey` and is shared with dashboards).
4. **Breakdown field on the dashboards builder query** (`WidgetQuerySchema` gains `breakdown?:
   DimensionRef`), compiled as a second group-by; the breakdown **UI control lives in the report
   `QueryEditor`**, not the shared `BuilderForm` (so dashboards widget editing is untouched).

## Architecture

### A. Pure pivot — `resultToChartData(result, opts)`

New pure module in `@openldr/report-builder` (exported from `./pure`), returning `ChartData`
(`{ title?, categories, series }`). `opts = { title?, categoryKey?, breakdownKey?, valueKeys? }`:

- **breakdown given** (`breakdownKey` set; long result `[category, breakdown, value]`): pivot long→wide.
  `categories` = distinct `categoryKey` values in first-seen order; one `series` per distinct
  `breakdownKey` value (first-seen order); `series.values[i]` = the `value` at (category_i, series) or
  **0** if that pair is absent.
- **no breakdown** (wide result): `categories` = `result.rows` mapped over `categoryKey` (default: first
  non-number column, else first column); one `series` per key in `valueKeys` (default: every numeric
  column) → `{ name: col.key/label, values: rows.map(r => Number(r[key] ?? 0)) }`.
- Empty result → `{ categories: [], series: [] }`.

`ChartData`/`ChartSeries` move to (or are re-exported from) the pure barrel so both server paint and the
browser canvas import them without pulling pdfkit. (`charts/index.ts` keeps drawing; only the type origin
and the new pivot are shared.)

### B. PDF path — `toChartData` uses the pivot

`paint.ts` `toChartData` becomes a thin adapter: derive `opts` from the block, call `resultToChartData`.
`drawBlock` already has the `block`, so for a chart it derives `opts` from `block.query` (see §D). `drawChart`
is unchanged — it already renders `series` + legend.

### C. Canvas — `ReportChart` + `CanvasBlock`

New `apps/studio/src/reports-builder/ReportChart.tsx`: a recharts component taking `(chartType, ChartData,
visual)` and rendering one `<Bar>`/`<Line>` per series (bar = grouped, line = multi-line) with a `<Legend>`
when `series.length > 1`; pie renders the single series' categories. `CanvasBlock` renders **chart** blocks
via `ReportChart` (fed by `resultToChartData(result, opts)`); **kpi/table** stay on the existing
`renderWidget`/`blockToWidgetConfig`. Colors reuse the existing report palette so canvas ≈ PDF.

### D. Deriving `opts` from a block (shared rule)

A tiny pure helper `chartOpts(block)` (in `@openldr/report-builder/pure`, used by paint + canvas):

- builder query **with** `breakdown` → `{ categoryKey:'label', breakdownKey:'series', valueKeys:['value'] }`
  (the long shape `runBuilderQuery` emits).
- otherwise (SQL/wide, or builder without breakdown) → `{}` (defaults: first non-number = category, all
  numeric = series). A builder query without breakdown yields exactly `[label, value]` → 1 series (legend
  off), preserving current behavior.

### E. Builder breakdown — `@openldr/dashboards`

- **Schema:** builder `WidgetQuerySchema` gains `breakdown: DimensionRefSchema.optional()`.
- **`compileBuilderQuery`:** when `q.breakdown`, add `select(sql.ref(breakdownCol).as('series'))` +
  `groupBy(breakdownCol)` + `orderBy` after the primary dimension.
- **`runBuilderQuery`:** when `q.breakdown`, shape rows to long `{ label, series, value }` (3 columns:
  `label`, `series`, `value`); date-grain bucketing keys by `(grainKey(label), series)` and sums. Columns
  gain a `series` column (kind `'string'`). Without breakdown, behavior is unchanged.
- **UI:** the report `QueryEditor` (builder mode) adds a **"Breakdown → series"** `<select>` of the model's
  dimensions (excluding the one chosen as the primary `dimension`), writing `query.breakdown`. Shown for
  **chart** blocks only.

### F. Renderer agreement

The one hard invariant: PDF `toChartData` and canvas `ReportChart` must produce the same `{categories,
series}` from the same `ReportResult` + block. Guaranteed because both call `resultToChartData` with
`chartOpts(block)`. Tested against one shared fixture (§ Testing).

## Testing

- **`resultToChartData`** (pure unit): wide multi-column → N series in column order; long+breakdown → pivot
  with first-seen ordering + 0-fill for missing pairs; single numeric column → 1 series; empty → empty.
- **Agreement:** one fixture `ReportResult` + a breakdown block → assert the `opts`+pivot used by paint and
  by `ReportChart` yield identical `{categories, series}` (call `chartOpts` + `resultToChartData` directly).
- **`compileBuilderQuery`** (dashboards): with `breakdown`, the compiled SQL groups by both the dimension
  and the breakdown column (assert via the query builder's compiled SQL / existing compile test pattern).
- **`runBuilderQuery`** (dashboards): breakdown → long `[label, series, value]` rows; grain+breakdown
  bucketing sums correctly.
- **`ReportChart`** (RTL): a 2-series pivot renders 2 `<Bar>`/`<Line>` (by test id / recharts DOM) + legend;
  1-series renders no legend.
- **`QueryEditor`** (RTL): the breakdown dropdown (chart block) writes `query.breakdown`; clearing removes it.

## Scope boundaries (YAGNI for P3b-4)

**In:** multi-series **bar/line** via multi-numeric-column (SQL) and builder breakdown dimension; shared
pure pivot; `ReportChart` canvas renderer; dashboards `breakdown` compile; legend activation.

**Out:** stacked/percent/area multi-series; per-series color pickers; more than one breakdown level;
multi-series pie; scatter/gauge/funnel in reports; the P3b-2/P3b-3 deferred lint items (P3c).

## Non-obvious constraints

- **Purity:** `resultToChartData`/`chartOpts`/`ChartData` live in `@openldr/report-builder/pure` (browser +
  server safe). `ReportChart` is studio (recharts). `paint.ts` stays server-side. Never import paint into
  studio.
- **Cross-package (mandatory forced typecheck):** this slice changes `@openldr/dashboards` (schema +
  compile), `@openldr/report-builder` (pure + paint), and `apps/studio` (canvas + QueryEditor) — plus every
  consumer of the dashboards `WidgetQuery` type. Run `pnpm turbo run typecheck --force`.
- **Dashboards compatibility:** `breakdown` is optional and additive; existing dashboards widgets and the
  single-dimension path are unchanged. `runBuilderQuery` without breakdown returns the exact current
  `[label, value]` shape.
- **Pivot ordering must be deterministic** (first-seen), or the canvas and PDF could order series/categories
  differently across runs — the agreement test guards this.
- **KPI/pie untouched:** `toChartData` for kpi still yields `series[0].values[0]`; pie uses `series[0]`.
  Only bar/line consume multiple series.
