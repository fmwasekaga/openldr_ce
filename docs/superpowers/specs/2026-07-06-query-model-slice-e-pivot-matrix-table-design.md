# Query-model Slice E — Pivot/Matrix Table

**Date:** 2026-07-06
**Origin:** Query-model-expansion workstream (memory `query-model-expansion-workstream`). Slices A/B/C/D done → three code reports are editable templates. Slice E adds a **pivot/matrix table** (row dimension × column breakdown × cell metric) to the Report Builder renderer, and seeds a count-cell crosstab.
**Status:** Design approved — ready for implementation plan.

## Goal

The Report Builder can render a table (fixed columns) and a multi-series chart (a
`dimension + breakdown` query pivoted to wide via `resultToChartData`). It cannot
render a **matrix table** — a table whose columns are discovered from a breakdown
dimension (row = dimension value, column = breakdown value, cell = a metric). Slice E
adds that: a table block whose `source` carries a `breakdown` renders as a pivoted
matrix, via a `resultToMatrix` helper mirroring `resultToChartData`.

## Decisions locked in brainstorming

- **Count-cell crosstab scope** — the cell is the query's single metric (e.g. count).
  Reuses the existing `dimension + breakdown` long result shape.
- **No new block type** — the existing **table** block is the pivot surface: when its
  `source` is a builder query with a `breakdown`, it pivots. The table `source` already
  accepts `breakdown` (WidgetQuery schema, added for charts in P3b-4) → **NO schema change**.
- **`resultToMatrix` mirrors `resultToChartData`** — one pure pivot helper feeds both the
  canvas table render and the PDF table painter (anti-drift, exactly how charts work).
- **Seed** an Analyte × Interpretation (R/I/S) count crosstab — expressible now.
- **The faithful amr-antibiogram is explicitly NOT this slice** (needs organism as a
  dimension, a %R-ratio cell, and first-isolate dedup / Slice F).

## Architecture / boundaries

- **`@openldr/report-builder/render`** — a new pure `matrix-data.ts` (`resultToMatrix` +
  `matrixOpts`), exported from `/pure`; `paint.ts` uses it in the table painter.
- **`apps/studio`** — `CanvasBlock` pivots the table result via `resultToMatrix`;
  `QueryEditor` enables the breakdown dropdown for table blocks.
- **Seed** — a crosstab template (`@openldr/report-builder` + `bootstrap/seed.ts`).

## Part 1 — `resultToMatrix` (`packages/report-builder/src/render/matrix-data.ts`, new)

Mirrors `chart-data.ts` (`resultToChartData`/`chartOpts`), reusing its `firstSeen` +
`PivotResult` structural shapes:

```ts
export interface MatrixOpts { rowKey: string; colKey: string; valueKey: string; rowLabel?: string }
// null → not a pivot (no breakdown); the caller renders the raw result as a normal table.
export function matrixOpts(query: WidgetQuery | undefined): MatrixOpts | null;
// Pivot a long [rowKey, colKey, valueKey] result into a wide table result:
//   columns = [ {key: rowKey, label: rowLabel, kind:'string'}, ...one per distinct colKey value (kind:'number') ]
//   rows    = one per distinct rowKey value; cell = value for (row, col), 0-fill for missing pairs
export function resultToMatrix(result: PivotResult, opts: MatrixOpts): PivotResult;
```

- `matrixOpts(query)`: returns `{ rowKey:'label', colKey:'series', valueKey:'value' }` when
  `query.mode === 'builder' && query.breakdown` (the exact long shape `runBuilderQuery`
  emits for a breakdown), else `null`.
- `resultToMatrix`: distinct row labels + distinct column names in **first-seen order**
  (same `label\0series` keying as `resultToChartData`); columns = row-label column + one
  numeric column per distinct breakdown value; rows carry `{ [rowKey]: label, [colName]:
  value, … }` with 0-fill. Pure, deterministic, unit-testable.

`PivotResult` (`{ columns: {key,label?,kind?}[]; rows: Record<string,unknown>[] }`) is the
same structural result type `resultToChartData` already uses — so a `resultToMatrix` output
is consumed transparently by any table renderer.

## Part 2 — Renderer (PDF + canvas pivot identically)

A table is a "pivot table" iff `block.kind === 'table'` and its `source` is a builder
query with a `breakdown` (`matrixOpts(source) !== null`).

- **PDF** (`packages/report-builder/src/render/paint.ts`): `drawTable` currently derives
  columns from `block.columns.length ? block.columns : result.columns`. Change: for a pivot
  table, first compute `const pivoted = resultToMatrix(cell.result, matrixOpts(source)!)`
  and use `pivoted.columns`/`pivoted.rows` (the block's `columns` are ignored for a pivot —
  columns are dynamic). Non-pivot tables are unchanged.
- **Canvas** (`apps/studio/src/reports-builder/CanvasBlock.tsx`): the table branch renders
  `renderWidget(blockToWidgetConfig(block, data.result), data.result)`. Change: for a pivot
  table, pivot first — `const tableResult = resultToMatrix(data.result, matrixOpts(source)!)`
  — and pass `tableResult` to both `blockToWidgetConfig` and `renderWidget`.

Both call the same `resultToMatrix` → the live canvas and the PDF show the identical matrix
(anti-drift, mirroring the chart `resultToChartData` agreement).

Column ordering: breakdown series come back SQL-ordered (the compiler's
`orderBy(breakdown column)` → alphabetical), so e.g. interpretation columns render `I, R, S`
— deterministic. Many columns fall back to the table's existing column-fit/ellipsis.

## Part 3 — Studio authoring (`QueryEditor.tsx`)

The breakdown `<select>` is currently gated `block.kind === 'chart'`. Enable it for
`block.kind === 'chart' || block.kind === 'table'`. On a table, picking a breakdown turns
it into a pivot/matrix; the cell is the table's single `metric`. i18n reuses the existing
`reportBuilder.query.breakdown`/`breakdownAria` strings. (A pivot uses the single `metric`
+ `breakdown`, not the wide `metrics[]` mode — the two are mutually exclusive and the
compiler already throws on `wide ⊕ breakdown`, so an author who sets both sees that error;
the seed template uses single-metric + breakdown correctly.)

## Part 4 — Seed template

A published **Analyte × Interpretation** crosstab
(`packages/report-builder/src/analyte-interpretation-template.ts`, mirrors the other seeds):
`ANALYTE_INTERPRETATION_TEMPLATE_ID = 'rt-analyte-interpretation'`. A table block whose
`source` = `{ mode:'builder', model:'observations', metric:{key:'count',label:'Count',
agg:'count'}, dimension:{key:'code_text'}, breakdown:{key:'interpretation_code'},
filters:[ effective_date_time gte/lte {{param.from/to}} ] }` and `columns: []` (dynamic),
plus a `daterange` param + title/intro. Renders as: rows = analytes, columns = R/I/S, cell =
count. Exported from `index.ts`; wired idempotently into `bootstrap/seed.ts`; `seed.test.ts`
count `4`→`5` + id array updated. This is the 4th editable template.

## Data flow

Author sets a table `source` with a `dimension` + `breakdown` (+ metric) → `runBuilderQuery`
returns the long `[label, series, value]` result → the table renderer (canvas + PDF) detects
the breakdown via `matrixOpts`, pivots via `resultToMatrix` → dynamic-column matrix.
`resolveQueryParams`/lint are unchanged (a pivot's params live in filters as usual).

## Error handling / edge cases

- **No breakdown** → `matrixOpts` returns null → the table renders the raw result as today
  (backward-compat; non-pivot tables byte-identical).
- **Empty result** → `resultToMatrix` returns the row-label column only + zero rows (header,
  no rows) — same as an empty normal table.
- **A pivot table with explicit `block.columns`** → ignored for a pivot (columns are dynamic
  from the breakdown); the seed and normal authoring leave `columns: []`.
- **Wide `metrics[]` + breakdown on a table** → the compiler throws (existing `wide ⊕
  breakdown` guard); the UI surfaces it as the block error. Not a new failure mode.
- **0-fill**: a `(row, col)` pair with no data → cell 0 (matches `resultToChartData`).

## Testing

- **report-builder**: `matrix-data.test.ts` — `matrixOpts` (breakdown → opts, else null);
  `resultToMatrix` pivot (first-seen row/column order, 0-fill missing pairs, empty result,
  single column). `paint.test.ts` — a pivot table draws dynamic columns (a `drawTable` test
  with a breakdown source produces the matrix columns). The seed template is lint-clean; a
  **pg-mem acceptance** runs the crosstab source (`runBuilderQuery`) → long result →
  `resultToMatrix` → asserts the analyte × R/I/S matrix with correct counts + 0-fill.
- **studio**: the breakdown dropdown renders for a table block; `CanvasBlock` pivots a
  table-with-breakdown result (a matrix, not the raw long result) — assert the dynamic
  columns appear.
- **Render agreement**: both paths call `resultToMatrix`; a test confirms the canvas and PDF
  consume the same pivot (mirroring the chart agreement test).
- Forced 31-package gate; the two known flakes aren't regressions.

## Gate

- Forced 31-package typecheck + test (`pnpm turbo run typecheck --force` then `test --force`).
  The changes are in `@openldr/report-builder` (renderer) + `apps/studio`; never pipe turbo
  through `tail`.
- Pre-existing flakes (studio `api.test.ts` vitest-dedupe; plugins/users/workflows
  parallel-load timeouts that pass in isolation) are not regressions.

## Scope / non-goals

- Count-cell (single-metric) pivot only — no `%R`-ratio cell (needs a 2D-group-by + derived
  change).
- No new block type (reuse the table block).
- No organism dimension (a separate observation, beyond the current model).
- No first-isolate dedup (Slice F).
- **No faithful amr-antibiogram** — it composes E + F + organism-source; deferred.
- No pivot for SQL-mode or wide-`metrics[]` table sources (builder + single-metric +
  breakdown only).

## Follow-ups (later)

- `%R`-ratio pivot cell (2D group-by + derived per cell) → resistance-rate matrix.
- Organism dimension + first-isolate (Slice F) → the faithful amr-antibiogram (E+F).
- Optional: a "hide null/empty column" toggle; author-controlled column order.
