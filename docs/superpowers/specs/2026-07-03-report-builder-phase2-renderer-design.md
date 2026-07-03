# Report Builder — Phase 2: pdfkit Renderer + computeLayout — Design Spec

**Date:** 2026-07-03
**Status:** Approved for planning
**Depends on:** Phase 1 (data foundation) — merged local `main` (`b9a9ed83`)
**Parent design:** `docs/superpowers/specs/2026-07-03-report-builder-design.md`
**Related:** [report-builder-workstream], dashboards query layer, `@openldr/report-pdf`

## Problem

Phase 1 persists a `ReportTemplate` (page setup, parameters, an optional primary `dataset`, and a grid
of rows/cells each holding a typed block). Nothing renders it yet. Phase 2 builds the **server-side
rendering pipeline** that turns a `ReportTemplate` + parameter values into PDF bytes, plus the ways to
exercise it (a preview API endpoint, a CLI render command, and tests) — **the riskiest piece, proven
headless before any builder UI exists (Phase 3)**.

The parent design mandates pdfkit as the single source of truth, with a **shared pure `computeLayout`**
function so the Phase-3 HTML edit canvas and the pdfkit painter can never drift on geometry.

## Decisions (locked during brainstorm)

1. **Measurement:** `computeLayout` is pure/deterministic and takes an **injected `Measurer`**
   (`measureText(text, style, maxWidth) → height`). Server passes a pdfkit-backed measurer; tests pass a
   deterministic fake; Phase-3 browser passes a canvas/DOM one. This keeps layout pure yet accurate.
2. **Verification surface:** build a `POST /api/report-templates/:id/preview` endpoint, an
   `openldr report-template render` CLI command, and golden/structural tests.
3. **Chart fidelity:** richer — title, y-axis ticks + gridlines, category/x labels, marks, value labels,
   and a legend (with basic multi-series). Charts get their own module + focused tests.

## Architecture

### Module structure & boundaries

All new code under `packages/report-builder/src/render/`. Split along the Phase-1 pure/node boundary:

| File | Purpose | Barrel |
| --- | --- | --- |
| `render/layout.ts` | `Measurer` interface, `PositionedBox` + layout types, `computeLayout()` — **pure**, no pdfkit/node | `./pure` (+ `./`) |
| `render/run-template.ts` | `runTemplate(template, params, queryFn)` data resolution + `resolveQueryParams` | `./` (server) |
| `render/measurer.ts` | pdfkit-backed `Measurer` (wraps `doc.heightOfString`) | `./` |
| `render/charts/{bar,line,pie,kpi}.ts` + `charts/{scale,legend}.ts` | vector chart drawers + helpers | `./` |
| `render/paint.ts` | `drawBlock(doc, box, resolvedBlock)` dispatcher + per-kind drawers | `./` |
| `render/index.ts` | `renderReportTemplatePdf(template, params, queryFn) → Promise<Buffer>` orchestrator | `./` |

**No dependency cycle:** `runTemplate` takes an injected `queryFn: (q: WidgetQuery) => Promise<ReportResult>`.
Bootstrap/routes/CLI pass `ctx.dashboards.query` (the existing `runDashboardQuery`, which already handles
builder + SQL modes, SQL vetting, and filter-value substitution). `report-builder` never imports
`@openldr/bootstrap`. New deps: `pdfkit`, `@types/pdfkit`. `@openldr/report-pdf` (legacy code-report
renderer) is untouched — coexistence is Phase 4.

### Data resolution — `runTemplate(template, params, queryFn)`

Returns a `ResolvedTemplate`: the template plus a resolved result for the primary dataset and for each
data block. Steps:

1. **Param binding** — `resolveQueryParams(query, params)` replaces `{{param.<id>}}` tokens inside builder
   filter values / SQL `values` with actual parameter values, reusing the same `{{param.x}}` convention as
   Phase 1's `interpolate()`. (Which filter binds to which param is authored in the Phase-3 UI; Phase 2
   only resolves tokens already present.)
2. **Dedup** — identical resolved queries (JSON-serialized) run once and share results.
3. **Primary dataset** — resolved once; `Table` blocks with `source:'primary'` bind to it; other data
   blocks (`kpi`, `chart`, `table` with an inline `WidgetQuery`) use their own `query`.
4. **Error isolation** — a query that throws attaches an `{ error }` marker to that block; the painter
   draws an error placeholder in the block's box. One failing block never fails the whole PDF.

### Layout — `computeLayout(resolved, page, measurer) → PositionedBox[]`

Pure and deterministic given the injected `measurer`.

- **Grid:** usable width = page width − left/right margins; each row's cells split it by `colSpan/12`,
  laid out left-to-right; rows stack top-to-bottom in the body.
- **Intrinsic heights:** KPI / chart / image / divider / spacer are fixed or config-driven; **title/text**
  height = `measurer.measureText(text, style, cellWidth)`; **table** height = header row + N rows at a
  fixed row height with ellipsis truncation (wrapped multi-line cells are future work).
- **Pagination:** body rows flow; a row that won't fit starts a new page. The primary `Table` splits
  across pages, re-emitting its column header each page (generalizing `report-pdf`'s `drawHeader` loop).
  A `pageBreak` block forces a new page.
- **Header/footer:** rows flagged `repeat:'header'|'footer'` are positioned at the top/bottom of *every*
  page and excluded from the flowing body; the body's usable height is reduced to reserve their space.
- **Output:** a flat `PositionedBox[]` — `{ page: number, x, y, w, h, cellRef }` — consumed identically by
  the pdfkit painter (now) and the Phase-3 HTML canvas.

### Painting — `render/paint.ts` + `renderReportTemplatePdf()`

`renderReportTemplatePdf(template, params, queryFn)` orchestrates: `runTemplate` → construct the
pdfkit-backed `measurer` from the live doc → `computeLayout` → paint each `PositionedBox` → return bytes
(promise-wrapped pdfkit stream, as `report-pdf` does today).

- `paint.ts` owns `drawBlock(doc, box, resolvedBlock)` with one focused drawer per block kind. Title/text
  run through `interpolate()` (`ctx.params` = parameter values; `ctx.dataset` = the primary dataset's
  first row + simple aggregates). The table drawer paints header + rows within its box, honoring the
  page-break boundaries `computeLayout` already decided.
- **Page furniture:** after the body is painted, iterate `doc.bufferedPageRange()` to stamp the repeating
  header/footer boxes and a page-number footer.
- **Measurer:** `render/measurer.ts` exposes `measureText` via `doc.heightOfString`; tests use a
  deterministic fake (`height = lineCount × lineHeight`).

### Charts — `render/charts/`

`drawChart(doc, box, chartType, data, visual)` dispatches to `bar.ts` / `line.ts` / `pie.ts` / `kpi.ts`.
Shared helpers: `charts/scale.ts` (linear scale + nice-tick generation), `charts/legend.ts`. Each drawer
renders title, plot area, **y-axis ticks + gridlines**, category/x labels, the marks (bars / line+points /
slices / big number), value labels, and a **legend** (basic multi-series where the data carries series).
Colors from `visual.color`/`secondaryColor` with a default categorical ramp fallback. Each type gets
focused structural/snapshot tests.

### Wiring & verification

- **Preview endpoint:** `POST /api/report-templates/:id/preview` (`apps/server`) — load the template,
  call `renderReportTemplatePdf(tpl, body.params, ctx.dashboards.query)`, return `application/pdf`.
  Reads-open (same posture as running a report); mirrors the `/api/reports/:id.pdf` handler shape.
- **CLI:** `openldr report-template render <id> --params k=v,k2=v2 -o out.pdf` — resolve an `AppContext`,
  render, write the file. Core `renderTemplateToFile(store, queryFn, id, params, outPath)` is store-injected
  and unit-testable.
- **Tests:**
  - `computeLayout` (fake measurer): grid widths, intrinsic heights, page-break math, header/footer
    exclusion + repeat, primary-table spill. Table-driven, no PDF.
  - `runTemplate` (fake `queryFn`): dedup, primary-dataset binding, `{{param.x}}` resolution, per-block
    error isolation.
  - Chart drawers + painter: structural assertions via `doc.bufferedPageRange()` + text extraction
    (as `report-pdf/index.test.ts`): page count, header/footer repeat, chart title/label presence.
  - End-to-end golden: a fixture template (KPI + chart + primary table + header/footer) rendered with a
    fake `queryFn`, asserting page count and key text.

## Scope boundaries (YAGNI for Phase 2)

**In:** `runTemplate` + param binding + error isolation; `computeLayout` + `Measurer`; pdfkit painter for
all block kinds; richer bar/line/pie/KPI charts; preview endpoint; CLI render; the tests above.

**Out (later):** the HTML canvas painter (Phase 3 — but `computeLayout` is pure now so it drops in);
wrapped multi-line table cells; scatter/gauge/funnel chart types; font embedding beyond built-in
Helvetica; catalog coexistence / run / schedule (Phase 4).

## Internal phasing (each its own plan section / commit cluster)

1. `runTemplate` + `resolveQueryParams` + error isolation (data; fully faked `queryFn`).
2. `computeLayout` + `Measurer` interface + pdfkit measurer (geometry).
3. Charts module (bar/line/pie/kpi + scale/legend helpers).
4. `paint.ts` + `renderReportTemplatePdf` orchestrator (assembles 1–3).
5. Preview endpoint + CLI render + end-to-end golden test.
