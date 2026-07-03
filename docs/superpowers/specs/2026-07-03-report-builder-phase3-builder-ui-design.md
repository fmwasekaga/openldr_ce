# Report Builder — Phase 3: Builder UI — Design Spec

**Date:** 2026-07-03
**Status:** Approved for planning
**Depends on:** Phase 1 (data foundation, `b9a9ed83`) + Phase 2 (pdfkit renderer, `10c6cf1c`)
**Parent design:** `docs/superpowers/specs/2026-07-03-report-builder-design.md`
**Related:** [report-builder-workstream], Form Builder (`forms-builder/`), dashboards query editor

## Problem

Phases 1–2 give us a persisted `ReportTemplate` and a server-side renderer (PDF bytes via
`/api/report-templates/:id/preview`, exercised so far only by the CLI and tests). There is no UI to
author a template. Phase 3 builds the **three-pane drag-and-drop Report Builder** — the visible
feature — living beside the Reports library exactly as the Form Builder lives beside Forms.

## Decisions (locked during brainstorm)

1. **Center surface:** a **WYSIWYG HTML canvas** built on the pure Phase-2 `computeLayout` + a DOM text
   measurer (blocks sit where the PDF puts them), with a **"Preview PDF" toggle** showing the real
   server-rendered PDF via `PdfCanvasViewer`.
2. **Grid editing:** **drag to place + reorder**, **controls for width** — drag palette blocks onto row
   drop-zones, drag rows to reorder (`@dnd-kit`, as the Form Builder), set column width via a
   `3/4/6/8/12` segmented control; no pixel edge-resize.
3. **Parameters:** **full binding** — a filter's value can bind to a defined parameter (stored as
   `{{param.<id>}}`, resolved by Phase-2 `resolveQueryParams`); params also interpolate into title/text;
   preview collects param values via a form.

The `ReportTemplate` **data model is unchanged** — the UI reads/writes the exact shape from
`@openldr/report-builder/pure`. All rendering truth stays server-side.

## Architecture

### Placement, routing, data flow

New module `apps/studio/src/reports-builder/` (mirrors `forms-builder/`). Routes in `apps/studio/src/App.tsx`,
gated to `lab_admin`/`lab_manager`:
- `/reports/builder/new` and `/reports/builder/:id` → `ReportBuilderPage`.
- `apps/studio/src/pages/Reports.tsx` gets a **"New report"** button (admins/managers) → `/reports/builder/new`.

New `apps/studio/src/api.ts` functions mirroring the forms client: `fetchReportTemplates`,
`getReportTemplate`, `createReportTemplate`, `updateReportTemplate`, `deleteReportTemplate`,
`previewReportTemplate(id, params) → Blob` (POST `/preview`). Query models reuse the existing dashboards
`/api/dashboards/models` client. Load/edit/save lifecycle mirrors `FormBuilderPage`.

### Components (one responsibility each)

| Component | Responsibility | Reuses |
| --- | --- | --- |
| `ReportBuilderPage.tsx` | Shell: load/save/publish/delete, `ReportTemplate` state + `useTemplateHistory` undo/redo, wires panes, dirty tracking | `useTemplateHistory`, `AppShell`, `BuilderHeader` pattern |
| `BlockPalette.tsx` | Left: draggable block types | `@dnd-kit` |
| `ReportCanvas.tsx` | Center: WYSIWYG page via `computeLayout` + `domMeasurer` + HTML painter; row drag-reorder, palette drop-zones, selection, visible page breaks | `@openldr/report-builder/pure`, `@dnd-kit`, recharts |
| `domMeasurer.ts` | `Measurer` via canvas `measureText`, **char-width fallback** when canvas 2D is unavailable (jsdom) | Phase-2 `Measurer` interface |
| `BlockInspector.tsx` | Right: per-kind editor for the selected block + width control | — |
| `inspector/QueryEditor.tsx` | kpi/chart/table data: builder↔SQL + filters + param binding | `BuilderForm`, `SqlForm`, `DashboardFilterEditor` |
| `inspector/TextEditor.tsx` | title/text content + bold/italic/size/align | shadcn |
| `inspector/PageSetup.tsx` | size/orientation/margins | shadcn |
| `inspector/ParametersEditor.tsx` | define params (daterange/select/text: id, label, options, default) | shadcn |
| `PreviewPdfDialog.tsx` | param value form → `previewReportTemplate` → `PdfCanvasViewer` | `PdfCanvasViewer` |
| `reportBuilderModel.ts` | pure editor helpers: new-block factory, row/cell mutation, `lintReportTemplate` | — |

### The WYSIWYG canvas

- Builds a `LayoutModel` from the in-editor `ReportTemplate` (+ sample/last-preview data for table row
  counts) and calls the pure **`computeLayout(model, domMeasurer)`** — geometry is shared with the PDF,
  so no drift. `domMeasurer` measures text with canvas 2D `measureText` at matching font metrics.
- An **HTML painter** maps each `PositionedBox` to an absolutely-positioned `<div>` in a page-width
  container (points→px via one scale factor). Block visuals: title/text = styled text; table = small
  HTML table from sample rows; kpi = big number; **chart = a live recharts mini-chart** (bar/line/pie).
- **Interactions:** click a block → select (drives inspector); `@dnd-kit` row drag-handle reorders rows;
  palette blocks drop onto per-row drop-zones + a trailing "new row" drop-zone; width via the inspector
  segmented control (`colSpan`); add/remove cell per row; per-block toolbar (delete/duplicate,
  header/footer-repeat toggle).
- **Visible pagination:** because `computeLayout` returns `page` numbers, the canvas draws a page-break
  divider + "Page N" where consecutive boxes change page — spill is shown exactly as it prints.

### Inspector + parameter binding

- **Data blocks (kpi/chart/table):** `QueryEditor` embeds `BuilderForm` (source/metric/group-by/grain)
  with a builder↔SQL toggle (`SqlForm`) and a filters list on `DashboardFilterEditor`. Chart adds a
  bar/line/pie toggle; table adds primary-vs-own-query switch + column pick.
- **Parameter binding:** `ParametersEditor` (from the header) defines params. In the filters list, each
  filter value has a **literal↔parameter** toggle; "parameter" shows a dropdown of defined params and
  stores `{{param.<id>}}`. Title/text blocks list available `{{param.x}}` tokens for insertion.
- **Text/Title, Page setup:** shadcn controls only (per repo convention — never native `<select>`).

### Preview

"Preview PDF" opens `PreviewPdfDialog`: collects param values (daterange picker / select / text) if the
report has params, POSTs to `/preview`, renders the returned blob in `PdfCanvasViewer` — the real
server PDF, the honesty check against the HTML canvas. Preview renders the **saved** template, so a dirty
draft saves first.

### State, undo/redo, validation

- Local `ReportTemplate` state wrapped in `useTemplateHistory` (undo/redo). Immutable updates.
- Dirty flag gates Save; preview-while-dirty saves first.
- `lintReportTemplate` (pure) surfaced like the Form Builder's `LintSummary` — flags unnamed report, a
  data block with no query, a `{{param.x}}` referencing an undefined param, a required param without a
  default. Publish gated on no errors.

## Testing

- **RTL page tests** mirroring `FormBuilderPage.test.tsx`: render `/reports/builder/new`, add/drag a
  block, select, edit inspector, save (mocked api) — assert the persisted `ReportTemplate`.
- **`domMeasurer`:** unit-test the char-width fallback (canvas 2D absent under jsdom).
- **Param binding:** RTL — bind a filter to a param → value serializes to `{{param.<id>}}`; unbind →
  literal.
- **Preview dialog:** mock `previewReportTemplate` → `PdfCanvasViewer` receives the blob; param form
  collects values.
- `computeLayout`/render already covered by Phase 2 — the canvas consumes them.

## Scope boundaries (YAGNI for Phase 3)

**In:** builder page, palette, WYSIWYG canvas (drag-place + row-reorder + width control + selection +
visible pagination), inspector for all block kinds, query editor reuse, full param binding, page setup,
real-PDF preview, undo/redo, lint.

**Out (later/never):** collaborative editing; report versioning UI; conditional block visibility;
multi-series chart authoring (stays single-series — one group-by → one series, per the Phase-2 deferred
note); wrapped multi-line table cells; pixel-drag column resize.

## Decomposition — three shippable sub-plans (each its own plan + subagent execution)

1. **P3a — Editor foundation:** `reports-builder/` module + routing + Reports "New report" entry +
   `api.ts` functions + `ReportBuilderPage` shell (load/save/publish/delete + undo/redo) + `BlockPalette`
   + the **working WYSIWYG canvas** (`computeLayout` + `domMeasurer` + HTML painter; title/text/table/kpi,
   chart as a simple placeholder) with select + row-drag + palette-drop + width control + `PageSetup` +
   **real-PDF preview dialog**. A complete, usable builder.
2. **P3b — Data + parameters:** `QueryEditor` (BuilderForm/SqlForm/filters) for kpi/chart/table, **recharts**
   live chart previews in the canvas, `ParametersEditor` + **filter→param binding** + preview param form.
3. **P3c — Polish:** `lintReportTemplate` + `LintSummary`, keyboard shortcuts, block duplicate/delete,
   header/footer-repeat toggle, empty states, i18n (en/fr/pt).

Build order: P3a → P3b → P3c. This spec covers all three; the first implementation plan is P3a only.

## Non-obvious constraints

- **Purity:** the canvas imports `computeLayout`/`toLayoutModel`/types ONLY from `@openldr/report-builder/pure`
  (never the server barrel, which pulls in pdfkit). This is why Phase 2 kept `layout.ts` pdfkit-free.
- **Conventions:** shadcn controls only (no native `<select>`); edge-to-edge dividers on p-4 panes
  (`@/components/ui/bleed`); mirror `forms-builder/` structure and `FormBuilderPage` lifecycle.
- **Permissions:** authoring routes gated to `lab_admin`/`lab_manager` via `RequireRole`, matching the
  server-side write gate.
