# Reports Page — Corlix Parity, SP-1 (Core) — Design

**Date:** 2026-06-22
**Status:** Approved for planning
**Workstream:** Reports page rebuilt to match the corlix reports UI, with OpenLDR-related reports.

## Goal

Replace OpenLDR's minimal reports page (a grid of cards at `/reports` + a basic
`/reports/:id` detail page) with the full corlix reports experience: a
collapsible report library, a parameters bar, a KPI summary strip, and a tabbed
content area with a **Document** tab (PDF viewer) and a **Spreadsheet** tab
(sortable/filterable/exportable grid).

This is **SP-1 of three** sub-projects. SP-1 delivers the full page wired to the
existing reporting backend. Run History (SP-2) and Scheduling (SP-3) are separate
specs that follow.

### Out of scope for SP-1 (deferred to later sub-projects)
- Run history persistence + History drawer "Preview Runs" tab → **SP-2**.
- Report scheduling (tables, event-bus runner, Schedules drawer, scheduled-run
  download, History drawer "Scheduled Runs" tab) → **SP-3**.
- Live on-screen charts on the reports page. The PDF already contains the chart;
  live/interactive chart visualization remains the **dashboard page's** job.
- Deep-linking to a specific report by URL (`/reports/:id`). Selection is in-page.

## Context / current state

- Backend: `packages/reporting` exposes 7 reports through `ctx.reporting`:
  `amr-resistance`, `test-volume`, `patient-demographics`, `turnaround-time`,
  `amr-antibiogram`, `amr-first-isolate-summary`, `amr-glass-ris`.
  - `list()` currently returns only `{ id, name, description }`.
  - `run(id, params)` returns `{ columns, rows, chart, meta }`.
  - `renderPdf(id, params)` returns a `Buffer` (pdfkit), served at
    `GET /api/reports/:id.pdf`. CSV at `GET /api/reports/:id.csv`.
  - All report params are optional (`from`, `to`, `facility`, plus a couple of
    report-specific ones). No dynamic option lists, no history, no scheduling.
- Frontend: `apps/web` already has the building blocks:
  - `AppShell` supports a `fullBleed` mode (full-height, no padding).
  - `components/data-table/` (`useTableState`, `applyTableState`,
    `DataTableToolbar`) — the same pattern corlix uses for its spreadsheet tab.
  - shadcn primitives: `date-range-picker`, `select`, `combobox`, `sheet`,
    `dropdown-menu`, `badge`, `table`, `table-pagination`, `dialog`, etc.
  - `xlsx` (SheetJS) is a root dependency, usable for client-side XLSX export.
  - New dependency required: **`pdfjs-dist`** for the canvas PDF viewer.

## Design

### 1. Backend: catalog enrichment

Extend `ReportDefinition` (`packages/reporting/src/types.ts`) with optional UI
metadata. `params` (Zod) and `run` are unchanged.

```ts
export type ReportCategory = 'amr' | 'operational' | 'quality' | 'regulatory';

export interface ReportParamMeta {
  id: string;                                   // matches a query param key
  label: string;
  type: 'daterange' | 'select' | 'text';
  required: boolean;
  optionsKey?: string;                          // key into the /options response
}

export interface ReportMetricMeta {
  id: string;
  label: string;
  type: 'count' | 'sum' | 'avg' | 'pct';
  column?: string;                              // for sum/avg/pct
  match?: string;                               // for pct (value to match)
}

export interface ReportDefinition<P = unknown> {
  id: string;
  name: string;
  description: string;
  category: ReportCategory;                     // NEW
  parameters: ReportParamMeta[];                // NEW
  summaryMetrics?: ReportMetricMeta[];          // NEW
  params: ZodType<P>;                           // unchanged
  run(db, params): Promise<ReportResultData>;   // unchanged
  // NEW: resolves dynamic select options (e.g. distinct facilities)
  options?(db: Kysely<ExternalSchema>): Promise<Record<string, string[]>>;
}
```

- `ReportSummary` grows to include `category`, `parameters`, `summaryMetrics`.
  `reportSummaries()` / `ctx.reporting.list()` return the enriched objects.
- A `daterange` parameter maps to the two query keys `from` and `to`
  (the bar emits both; the report's Zod schema is unchanged).
- New route `GET /api/reports/:id/options` → `Record<string, string[]>`.
  Implemented via a new `ctx.reporting.options(id)` that calls the report's
  `options(db)` (or returns `{}` if undefined). Facility option source =
  `SELECT DISTINCT managing_organization FROM patients` (non-null, sorted).
- Category assignment:
  - **amr**: `amr-resistance`, `amr-antibiogram`, `amr-first-isolate-summary`
  - **operational**: `test-volume`, `turnaround-time`
  - **quality**: `patient-demographics`
  - **regulatory**: `amr-glass-ris`
- Each report declares `parameters` matching its existing optional params, e.g.
  `amr-resistance`: a `daterange` (`from`/`to`) + a `select` facility
  (`optionsKey: 'facility'`). `summaryMetrics` declared where meaningful
  (e.g. AMR: count of antibiotics tested, avg %R).

### 2. Frontend: page layout

`apps/web/src/pages/Reports.tsx` becomes the combined page (library + detail in
one view, like corlix), wrapped in `<AppShell title="Reports" fullBleed>` with a
`flex h-full` split. New components under `apps/web/src/reports/`:

- **`ReportLibrary`** (~230px, collapsible): search input, pinned section,
  category-grouped list; selected row = blue left border (`#5A9BD6`); collapse to
  a narrow rail. Pinned ids + last-used params persisted in `localStorage`
  (`reports.pinned`, `reports.lastParams`) via a small `report-preferences.ts`
  helper ported from corlix (localStorage instead of SQLite settings).
- **Main panel**: header (name + description on the left, **`ReportActionsMenu`**
  3-dot on the right); **`ReportParametersBar`**; **`ReportSummaryStrip`**; then a
  tab strip (Document | Spreadsheet) with run metadata (row count + run time) on
  the right; then the active tab body.
- **`ReportActionsMenu`**: a shadcn `DropdownMenu` with "Run History" and
  "Schedules" items, both **disabled** with a "Coming soon" tooltip/label in SP-1
  (wired live in SP-2/SP-3).
- **`ReportParametersBar`**: renders one control per `ReportParamMeta` — shadcn
  `date-range-picker` for `daterange`, `select` (with an "All" option) for
  `select` (options from `GET /api/reports/:id/options`), `input` for `text`.
  Required params show a red asterisk and gate the **Run** button. Since all
  current report params are optional, Run is enabled by default; the
  required-gating logic is implemented for completeness.
- **`ReportSummaryStrip`**: horizontal KPI boxes computed by a ported
  `computeSummaryMetrics(metrics, rows)` (`reports/lib/report-summary.ts`).
  Renders nothing when the report defines no metrics or no result yet.

### 3. Document tab — PDF viewer

- **`ReportDocumentTab`**: on run (or tab open), fetches
  `/api/reports/:id.pdf?<params>` via `authFetch` as a blob, passes it to
  `PdfCanvasViewer`. Shows a loading state while fetching and an error state on
  failure or empty result.
- **`PdfCanvasViewer`** (ported from corlix): uses `pdfjs-dist` to render the
  current page to a `<canvas>`, device-pixel-ratio aware for crisp text. Toolbar:
  prev/next page + "N / total", zoom 0.5×–3× (0.2 steps, shows %), and a download
  button (saves the blob). Worker loaded via
  `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`.
- New dependency: `pdfjs-dist` added to `apps/web/package.json`.

### 4. Spreadsheet tab

- **`ReportSpreadsheetTab`**: builds columns from `result.columns`; uses the
  existing `data-table` primitives (`useTableState` + `applyTableState` +
  `DataTableToolbar`) for client-side sort / filter / pagination (default 25
  rows). Cells formatted by column `kind` (percent → `N%`, null → `—`).
- Export dropdown: **CSV** links to the existing `/api/reports/:id.csv?<params>`;
  **XLSX** generates client-side from the *filtered* rows via `xlsx` (SheetJS),
  using the `selectExportRows` helper ported from corlix
  (`reports/lib/report-export.ts`).

### 5. Charts

No live charts on the reports page (confirmed). The chart is embedded in the
server PDF (Document tab). Interactive chart visualization belongs to the
dashboard page, which already has chart widgets.

### 6. Routing

- `/reports` renders the new combined page.
- The `/reports/:id` route and `pages/ReportDetail.tsx` are **removed**.
- `pages/Reports.tsx` is replaced; the old card-grid `ReportCard`/`ReportView`
  usage on this page is removed. `reports/ReportView.tsx` (the recharts component)
  is no longer used by the reports page; leave it in place only if still imported
  elsewhere (e.g. dashboard) — otherwise delete it and its test.

### 7. Files

**Backend**
- `packages/reporting/src/types.ts` — extend `ReportDefinition`, `ReportSummary`.
- `packages/reporting/src/reports/*.ts` — add `category`, `parameters`,
  `summaryMetrics`, optional `options()` per report.
- `packages/reporting/src/catalog.ts` — `reportSummaries()` returns enriched data.
- `packages/bootstrap/src/index.ts` — `ReportingApi` gains `options(id)`.
- `apps/server/src/reports-routes.ts` — add `GET /api/reports/:id/options`.

**Frontend (`apps/web/src`)**
- `pages/Reports.tsx` — new combined page (rewrite).
- `reports/ReportLibrary.tsx`, `ReportParametersBar.tsx`, `ReportSummaryStrip.tsx`,
  `ReportActionsMenu.tsx`, `ReportDocumentTab.tsx`, `ReportSpreadsheetTab.tsx`,
  `PdfCanvasViewer.tsx`.
- `reports/lib/report-summary.ts`, `report-export.ts`, `report-preferences.ts`.
- `api.ts` — enriched `ReportSummary` type; `fetchReportOptions(id)`; pdf-blob
  fetch helper.
- `App.tsx` — drop the `/reports/:id` route.
- `package.json` — add `pdfjs-dist`.
- Remove `pages/ReportDetail.tsx`; remove/retire `reports/ReportView.tsx` if unused.

### 8. Testing

- **Backend**: catalog metadata shape (every report has a valid category +
  parameters; metric `column`s reference real columns); `/api/reports/:id/options`
  route returns the expected map (stubbed `ctx.reporting`).
- **Frontend**: `ReportLibrary` (search filters, pin toggle persists to
  localStorage, select fires `onSelect`); `ReportParametersBar` (required-gating);
  `ReportSpreadsheetTab` (sort/filter + CSV link + XLSX export wiring);
  `PdfCanvasViewer` (mock `pdfjs-dist`, page-nav/zoom state). Update/replace
  `Reports.test.tsx`; remove `ReportView.test.tsx` if the component is retired.
- Full gate: `turbo typecheck lint test build` + depcruise green.

## Risks / notes

- `pdfjs-dist` worker bundling under Vite: use the `?url` worker import (proven in
  corlix). Verify the version's `pdf.worker.min.mjs` path during implementation.
- The `data-table` primitives must accept the dynamic `result.columns` shape;
  confirm their API during planning (they're already used by `TableWidget`).
- Facility option query assumes `patients.managing_organization` holds facility
  ids; matches how `amr-resistance` already filters by facility.
