# Report Builder — Design Spec

**Date:** 2026-07-03
**Status:** Approved for planning
**Related:** [reports-page-workstream], [workflow-report-pipeline-workstream], dashboards query layer, Form Builder

## Problem

Reports in OpenLDR CE are **static and code-defined**. Each report (e.g. `turnaround-time`,
`amr-resistance`) is a TypeScript `ReportDefinition` in `packages/reporting/src/reports/*.ts`
that hardcodes its query (`run()`), parameters, summary metrics, columns, and chart. The PDF is a
single fixed layout produced by `renderReportPdf` (`packages/report-pdf`, pdfkit): title →
generated-at/params line → one data table → footer. Adding or restyling a report requires a code
change and a deploy.

We want a **Report Builder**: a drag-and-drop authoring page — living beside the Reports library
as a "New report" option, exactly as the Form Builder lives beside Forms — where an author composes
both the **data queries** and the **page layout**, and sees a live **PDF preview**. Built reports
are dynamic (DB-stored, no deploy) and coexist with the existing code reports.

## Decisions (locked during brainstorm)

1. **Scope:** full self-service — authors compose **query + layout** (not layout-only).
2. **Data binding:** **hybrid** — an optional **primary dataset** drives a paginating table, plus
   **free-standing blocks** (KPI/chart/table/text) that each carry their own query.
3. **PDF engine:** **extend pdfkit** (server-side, single source of truth) + a separate HTML edit
   canvas. Real-PDF preview is shown via the existing `PdfCanvasViewer` (pdf.js). A **shared pure
   layout function** keeps the two painters from drifting.
4. **Layout model:** **grid of rows × columns**. Header/footer are full-width rows flagged
   "repeat on every page." The primary table is a full-width cell that auto-paginates.
5. **Permissions:** authoring (create/edit/delete) gated to `lab_admin` + `lab_manager`; everyone
   can run/download. New admin surface also gets **CLI parity**.

## Architecture

### Where it lives & coexistence

- Reports library ([apps/studio/src/reports/ReportLibrary.tsx]) gets a **"New report"** action
  (admins/managers only) → routes `/reports/builder/new` and `/reports/builder/:id`.
- **Dynamic (built) reports coexist with code-defined reports.** Code reports contain real JS logic
  (e.g. `turnaround-time` pairs specimens to reports in JS) that a grid+query builder cannot
  express, so they remain. The report **catalog merges** code reports + DB-stored built reports into
  one library list; built reports show a "custom" badge. Both kinds flow through the **same**
  existing run → params → Document(PDF)/Spreadsheet → history → schedule → download infrastructure.

### Reuse map (why this is tractable)

| Concern | Reused from |
| --- | --- |
| Query building | `packages/dashboards`: `QueryModel` registry, `WidgetQuery` (builder/SQL), `compile.ts`, `sql-runner.ts` — unchanged |
| Parameters | existing `ReportParamMeta` (`daterange`, `select` + `optionsKey`) + `ReportParametersBar` |
| PDF preview surface | existing `PdfCanvasViewer` (pdf.js) |
| Store / permissions / CLI patterns | Forms + Dashboards stores |
| Scheduling / email | `report-scheduler` (already renders PDFs server-side) — no changes |
| Undo/redo, builder shell | `useTemplateHistory`, `BuilderHeader`, three-pane Form Builder shape |

## Data model

New package `packages/report-builder` with a `/pure` subpath export (browser-safe, like
`@openldr/forms/pure`). Zod-validated `ReportTemplate`, persisted in a new `report_templates` table.

```
ReportTemplate
├─ id, name, description, category, status: 'draft' | 'published'
├─ page:       { size: 'A4' | 'Letter', orientation: 'portrait' | 'landscape', margins }
├─ parameters: ReportParamMeta[]              // reuses existing param model
├─ dataset?:   WidgetQuery                     // optional PRIMARY dataset (drives paginating table)
└─ rows:       ReportRow[]
     ReportRow { id, repeat?: 'header' | 'footer' | undefined, cells: ReportCell[] }
       ReportCell { colSpan: number, block: Block }
         Block =
           | Title    { text, style }                        // {{param}} / {{dataset.field}} interpolation
           | Text     { content, style }                     // interpolation supported
           | KPI      { query: WidgetQuery, label, format }
           | Chart    { query: WidgetQuery, chartType: 'bar'|'line'|'pie', visual }
           | Table    { source: 'primary' | WidgetQuery, columns }   // 'primary' paginates
           | Image    { src: 'org-logo' | url }
           | Divider  {}
           | Spacer   { height }
           | PageBreak{}
```

Notes:
- `repeat: 'header' | 'footer'` rows render on **every** page (page number, org branding).
- A `Table` block with `source: 'primary'` binds the report-level `dataset` and auto-paginates;
  any other data block carries its own `query`.
- Text/Title interpolation resolves `{{param.*}}` (report parameters) and `{{dataset.*}}`
  (first row / aggregates of the primary dataset).

## Builder UI (three panes — Form-Builder-shaped)

- **Left — Block palette:** draggable Title, Text, KPI, Table, Chart, Image, Divider, Spacer, Page
  break. Header also exposes **Page setup** and **Parameters**.
- **Center — Grid canvas:** the page as an HTML/DOM approximation. Rows stack vertically; each row
  splits into columns; drop a block into a cell; drag to reorder rows and resize colSpans. **Editing
  chrome only** — not the source of truth for the PDF.
- **Right — Inspector:** config for the selected block. Data blocks embed the **same query editor
  the dashboard widgets use** (model + metric + dimension + filters, or raw SQL). Text/Title blocks
  edit content, interpolation, and basic style (bold/italic/size).
- **Header actions:** name, page size/orientation, Parameters, **Preview PDF** (renders the real
  server PDF into `PdfCanvasViewer`), Save, Publish. Undo/redo via `useTemplateHistory`.

## Rendering engine

New `packages/report-builder/src/render/`. The **shared pure layout function** is the anti-drift
keystone:

- `computeLayout(template, page) → PositionedBox[]` — pure; resolves every row/cell into absolute
  boxes `{ x, y, w, h, page }` for a given page width, and decides page breaks (including where the
  primary table spills). **Both** painters consume its output:
  - **HTML painter** (builder canvas) → positioned `<div>`s.
  - **pdfkit painter** (server, authoritative) → pdfkit primitives at the **same** boxes.
  Geometry is computed once and shared, so the two codepaths differ only in draw calls, never layout.
- **Pagination:** header/footer rows re-emitted per page; body rows flow; the primary `Table`
  measures row height and breaks across pages, re-drawing column headers per page (generalizing the
  current `drawHeader` loop in `report-pdf`).
- **Charts:** pdfkit has no chart primitives, so a small `drawChart()` renders the supported print
  chart types — **bar, line, pie, KPI** — as pdfkit vector ops, fed by `compile.ts` → `sql-runner.ts`.
  (Scatter/gauge/funnel are out for print v1.)
- **Data fetch:** `runTemplate(template, params)` resolves the primary dataset + each block's query
  (dedup identical queries), then hands rows to the renderer. Used identically by preview, download,
  and scheduler.

The current `@openldr/report-pdf` becomes the low-level primitive layer this builds on (or is
absorbed into `report-builder/render`).

## Infrastructure

- **Store:** `report_templates` table + `ReportTemplateStore` in `packages/db` (mirrors form/
  dashboard stores) with a migration.
- **API** (`packages/bootstrap`): `GET/POST/PUT/DELETE /api/report-templates`;
  `POST /api/report-templates/:id/preview` → PDF bytes (debounced from the builder). Built reports
  surface in the existing `/api/reports*` catalog endpoints so run/PDF/spreadsheet/history/schedule
  routes work unchanged.
- **Permissions:** author (create/edit/delete) → `lab_admin` + `lab_manager`; run/download → all.
  Matches Forms/Schedules gating.
- **CLI parity:** `openldr report-template list|export|import|delete`, sharing logic via
  `@openldr/bootstrap`, `--force` for destructive ops.
- **Scheduling:** `report-scheduler` already renders PDFs server-side and emails them — built
  reports plug in with zero scheduler changes.

## Testing

- **Pure/unit:** Zod schema; `computeLayout` geometry + page-break math; `{{param}}` interpolation;
  `drawChart` data mapping — all pure, table-driven, no PDF needed.
- **Renderer:** pdfkit output asserted via `bufferedPageRange`/text extraction (as
  `report-pdf/index.test.ts` does) — page count, header/footer repeat, table spill.
- **Builder UI:** RTL tests mirroring `FormBuilderPage.test.tsx` — drop block, edit inspector, save.
- **Store/API:** CRUD + permission-gate tests like the forms store.

## Scope boundaries (YAGNI for v1)

**In:** grid layout; primary dataset + free blocks; bar/line/pie/KPI print charts; parameters;
A4/Letter × portrait/landscape; header/footer repeat; PDF preview/download/schedule; coexistence with
code reports.

**Out (later):** free absolute positioning; scatter/gauge/funnel in print; rich-text WYSIWYG beyond
bold/italic/size; conditional block visibility; sub-reports / grouping bands; multi-language report
content; image upload pipeline (v1 uses org logo + URL images).

## Phasing (each its own plan/PR)

1. **Schema + store + API + CLI** — data foundation, no UI.
2. **pdfkit renderer + `computeLayout`** — headless, fully testable; the riskiest piece, proven
   before any UI is built.
3. **Builder UI** — three panes, drag-drop, inspector, real-PDF preview.
4. **Library integration** — coexistence, "custom" badges, run/schedule wiring.
