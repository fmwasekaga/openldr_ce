# Report Builder — Phase 4: Library Coexistence — Design Spec

**Date:** 2026-07-05
**Status:** Approved for planning
**Depends on:** Phase 3c complete (`c355d144`)
**Parent design:** `docs/superpowers/specs/2026-07-03-report-builder-design.md`
**Related:** [report-builder-workstream], [reports-page-workstream] (run-history + scheduling infra), the
reporting catalog (`@openldr/reporting`), the `ReportingApi` in `@openldr/bootstrap`

## Problem

Built report templates live in their own island: `/api/report-templates` + the builder's PDF preview. They
do NOT appear in the Reports library, so they can't be run, scheduled, downloaded, or found alongside the
code-defined reports. Phase 4 makes published templates **coexist** in the reports catalog with a "Custom"
badge and the full run-history / schedule / download pipeline — restricted to **PDF** (the only format a
layout template supports).

## The core tension (drives the design)

- Code reports are **tabular**: `ReportDefinition.run()` → `{columns, rows, chart}`, which feeds the data
  table, CSV, xlsx, tabular preview, AND a generic-table PDF.
- Report **templates** are **PDF-layout documents**: they have `parameters` but no tabular result;
  `renderReportTemplatePdf(template, params, queryFn)` produces a multi-block PDF directly.
- `ctx.reporting.list()` is **synchronous + static** (`reportSummaries()`), and is also consumed by the
  plugin-broker (`reports.list`) and back-compat callers expecting sync.

So templates can join the catalog for **listing + PDF** actions, but not CSV/xlsx/tabular.

## Decisions (locked during brainstorm 2026-07-05)

1. **Full PDF coexistence:** templates appear in the catalog with a "Custom" badge and get run-history +
   scheduling + download, **PDF format only**.
2. **Sync `list()` stays code-only** (plugin-broker + back-compat untouched); a NEW async
   **`listAll()`** merges catalog + templates. Routes use `listAll`.
3. **Published templates only** (`status:'published'`) surface in the library; drafts stay builder-only.

## Architecture

### A. `@openldr/reporting` — source discriminator

`ReportSummary` gains `source: 'catalog' | 'builder'` (optional; treat absent as `'catalog'`). Code
`reportSummaries()` set (or default) `source:'catalog'`. No other reporting-package change.

### B. `@openldr/bootstrap` — template-aware `ReportingApi`

The `ReportingApi` (currently `list/run/runEventSource/eventSources/renderPdf/options`) gains
**`listAll(): Promise<ReportSummary[]>`** and its `renderPdf`/`run`/`options` become template-aware. The
service already has `reportTemplateStore` and `runDashboardQuery` in scope (they're constructed a few lines
below `reporting`), plus `renderReportTemplatePdf`/`runTemplate` from `@openldr/report-builder`.

- **`list()`** — unchanged (sync, `reportSummaries()`, catalog only). Plugin-broker + existing callers keep
  working.
- **`listAll()`** — `[...reportSummaries(), ...(await templateSummaries())]` where `templateSummaries()`
  reads `reportTemplateStore.list()`, keeps only `status:'published'`, and maps each to a `ReportSummary`
  (`id`, `name`, `description`, `category`, `parameters: template.parameters`, `source:'builder'`).
- **`renderPdf(id, params)`** — if `id` resolves to a published template, `renderReportTemplatePdf(template,
  params, runDashboardQuery)`; else the existing catalog path (`runReport` → `renderReportPdf`).
- **`run(id, params)`** — if `id` is a template, throw a coded `AppError` (new `RP` code, e.g. "this report
  is PDF-only and has no tabular data"); else existing. The UI never calls tabular `run` for custom reports.
- **`options(id)`** — template id → `{}` (defer template select-option resolution); else existing.
- Internal helper **`findAny(id): Promise<{ kind:'catalog'|'builder'; … } | undefined>`** (or a
  `hasReport(id)`), used by the routes' existence checks so template ids are recognized.

### C. `apps/server` — reports routes

- `GET /api/reports` → `await ctx.reporting.listAll()` (merged; carries `source`).
- Existence checks in the run-history beacon (`POST /api/reports/:id/runs`), schedule-create
  (`POST /api/reports/:id/schedules`) → use the merged existence check (a template id must pass).
- `GET /api/reports/:id.pdf` → `renderPdf` (now template-aware) — no route change needed.
- `GET /api/reports/:id` (tabular run) + `/:id.csv` (+ any xlsx) → for a template id, the underlying `run`
  throws the PDF-only `AppError` → central handler renders it; the UI avoids these for custom reports.
- Scheduling a custom report: `outputFormat` forced to `pdf` (client sends pdf; server accepts). The
  scheduler already calls `reporting.renderPdf` for the pdf branch → works for templates unchanged. Schedule
  run download (`/schedule-runs/:runId/download`) is blob+format based → works for pdf.
- `runReport` name for run-history: the beacon records `reportName` from the merged summary
  (`listAll().find(id)?.name` or the template name).

### D. `apps/studio` — Reports page

- The reports list renders every summary; a `source:'builder'` row shows a **"Custom" badge**.
- Selecting a **custom** report renders a **PDF-only panel**: the existing `ReportParametersBar` (daterange/
  select/text) → **Preview PDF** (embed via the existing `PdfCanvasViewer`, fed by `/api/reports/:id.pdf` or
  the report-templates preview) + **Download PDF** + **Schedule (PDF)**. The tabular data table, CSV, and
  xlsx affordances are hidden for custom reports. Catalog reports are unchanged.
- The schedule dialog, when the selected report is custom, locks `outputFormat` to `pdf` (hide the other
  format options).
- The run-history beacon fires on PDF download for custom reports, same as catalog reports.

## Testing

- **`reporting.listAll`** (bootstrap unit): merges catalog + a mocked published template; a draft template is
  excluded; the template summary carries `source:'builder'` + its `parameters`.
- **`reporting.renderPdf`** (unit): a published-template id renders via `renderReportTemplatePdf` (mocked
  store + `runDashboardQuery`) → buffer starts `%PDF`; a catalog id unchanged.
- **`reporting.run` / options** (unit): a template id → the PDF-only `AppError`; `options(templateId)` →
  `{}`.
- **Routes** (`reports-routes.test.ts`): `GET /api/reports` includes a published template with
  `source:'builder'`; `POST /api/reports/:templateId/schedules` (pdf) → 201; the run-history beacon accepts a
  template id; `GET /api/reports/:templateId.csv` → the PDF-only error code.
- **Reports page** (RTL): a custom report shows the "Custom" badge + PDF actions and NO data-table/CSV/xlsx;
  a catalog report is unchanged; the schedule dialog for a custom report offers only PDF.

## Scope boundaries (YAGNI for P4)

**In:** `source` discriminator; `listAll` + template-aware `renderPdf`/`run`/`options`; route wiring
(list/existence/schedule); reports-page custom branch (badge, PDF-only actions, PDF-locked schedule);
**published templates only**.

**Out:** tabular/CSV/xlsx for templates (impossible — PDF-only); template `select` option resolution in the
reports param bar (`options` returns `{}`); making sync `list()` async (kept code-only); CLI parity for
listing templates as reports (the builder CLI already lists templates); the P3c-3 deferred a11y polish.

## Non-obvious constraints

- **Sync `list()` untouched:** only add `listAll()`; do NOT change `list()`'s signature (plugin-broker
  `reports.list` + `plugin-broker.ts` typing expect sync). Routes/scheduler existence use `listAll` or a new
  async helper.
- **PDF-only is enforced server-side too:** `run`/`.csv` throwing for templates prevents a client that
  ignores the badge from getting a broken tabular response — the coded error is the contract.
- **Reuse the exact preview call:** `renderReportTemplatePdf(tpl, params, runDashboardQuery)` is what
  `report-templates-routes.ts`'s preview already does — reuse it in `reporting.renderPdf`, don't reinvent.
- **Id space:** template ids (`rt-…`) and catalog ids don't collide; `findAny` checks catalog first then the
  template store. A template whose id somehow shadows a catalog id resolves to the catalog (documented).
- **Cross-package:** `@openldr/reporting` (type) + `@openldr/bootstrap` (service) + `apps/server` (routes) +
  `apps/studio` (page) — run the forced typecheck; the `ReportSummary` type change ripples to every consumer.
- **AppError code:** add one new `RP####` code for "report is PDF-only" to the `@openldr/core` catalog
  (follow the existing `RP0002`/`RP0004` pattern) so the central handler renders it uniformly.
