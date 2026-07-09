# Linking Templates to Reports — Design

**Date:** 2026-07-09
**Status:** Approved for planning
**Workstream:** reports-page custom-queries + templates ([[reports-page-custom-queries-templates]])
**Visual companion:** `scratchpad/reports-template-linking-design.html` (artifact `4ead4546`)

## Problem

The `/reports` page today lists **eight hardcoded reports** (`packages/reporting`), each a
`ReportDefinition` with a Zod param schema, `parameters[]` metadata (which drives the filter bar), and a
`run(db, params)` that queries the analytics DB via Kysely and returns `{columns, rows, chart}`. Some do JS
post-processing (resistance R/I/S pivots, the antibiogram matrix, age bands).

Separately, the studio now has:

- **Custom Queries** (`custom_queries`, mig 041) — durable parameterized **raw SELECT** SQL, Postgres-only, run
  via `runStoredQuery(deps, id, values)` (`apps/server/src/run-stored-query.ts`).
- **Report-designer designs** (`report_designs`, `@openldr/report-designer`) — free-form PDF layouts whose tables
  already bind to a custom query (`dataSource:{kind:'custom-query',queryId}`), already carry `parameters[]`
  (`TemplateParam`), and already render **PDF + Excel + Preview** (`renderReportDesignPdf`,
  `POST /api/report-designs/preview`).

We want to retire the hardcoded reports and make `/reports` **data-driven**: each report is a **custom query**
(the data) + a **designer template** (the layout) + a lightweight **report** record (the link + on-page chrome).
The report's filters are read automatically from its template's parameters.

## Goals

1. **Move the reports → templates.** Reproduce each built-in report as a seeded `report_design`.
2. **Move their queries.** Reproduce each report's SQL as a seeded `custom_query` the template binds to.
3. **Link templates → reports.** A new `reports` record points at a template; its params auto-become the page
   filters. The `/reports` page layout is unchanged.
4. **Full cutover.** Delete the hardcoded `ReportDefinition` catalog once all eight are migrated.
5. **Preserve output parity.** Document (PDF), Spreadsheet (CSV/XLSX), and the summary strip + chart all keep
   working for the migrated reports.

## Non-goals (deferred)

- A **metrics/chart editor** in the New-report dialog (author-your-own on a user-created report). Seeded reports
  carry hand-authored metrics/chart; the editor is a fast-follow.
- Non-Postgres connectors (the designer is already Postgres-only).
- Versioning of reports/templates.
- Chart/KPI *element* binding inside the designer (unrelated deferred designer work).

## Decisions (resolved 2026-07-09)

| | Decision | Resolution |
|---|---|---|
| Model | How a report relates to a template | **Model B** — a thin `report` record *points to* a `design` + a `primaryQuery`. One template can back several reports. |
| Built-ins | Fate of the hardcoded catalog | **Full cutover** — migrate all 8, then delete the `ReportDefinition` logic. |
| Output | What a report shows | PDF + Spreadsheet + summary strip/chart — **all three preserved**. |
| A | Antibiogram (dynamic columns) | **Fixed antibiotic panel** via CASE columns (WHONET shape); first-isolate dedup in SQL; **migrated last**. Documented fallback: keep only the antibiogram as code if the fixed panel is too lossy. |
| B | Where a report is created | **Reports-page "New report" dialog** is the home; the designer gets an "Edit / Publish as report" shortcut. |
| C | Metrics + chart | **Store + render now** (record carries `summaryMetrics[]` + `chart`, feeds the existing strip; seeded reports keep parity). The author-your-own-metrics **editor** is deferred. |
| D | Demo designs | **Delete** `rt-amr-summary` / `rt-monthly-caseload` / `rt-lab-tat`; seed the 8 real templates instead. |

## Architecture

### Entity model (Model B)

New table **`reports`** (migration 043, `InternalSchema`) — the only new persistent entity:

```
reports {
  id             string  (PK)
  name           string
  description    string
  category       'amr' | 'operational' | 'quality' | 'regulatory'
  design_id      string  → report_designs.id
  primary_query_id string → custom_queries.id      -- feeds spreadsheet + strip + chart
  summary_metrics jsonb   ReportMetricMeta[]  (nullable)
  chart          jsonb   ChartHint            (nullable)
  param_options  jsonb   { [paramKey]: queryId }  (nullable) -- select-filter dropdown source
  status         'draft' | 'published'
  created_at     string
  updated_at     string
}
```

`report_designs` and `custom_queries` are **unchanged** except one additive field:

- `TemplateParam` gains optional `required?: boolean` (so a filter can be mandatory). Additive to
  `ReportDesignSchema`; survives the existing JSON `parameters` column.

### The reporting service — a third source

`ReportingApi` (`packages/bootstrap/src/index.ts`) already unifies **catalog** + **published builder templates**
behind `list / listAll / findSummary / run / renderPdf / options`. Data-driven reports become a **third source**
resolved by the same methods, keyed off the report id:

- `listAll()` → append published `reports` records (mapped to `ReportSummary`, `source: 'design'`), and (per full
  cutover) **stop** including `reportSummaries()` once migration completes.
- `findSummary(id)` → resolve a `reports` record → `ReportSummary` (name/description/category, `parameters` derived
  from the linked design's `parameters[]` mapped to `ReportParamMeta`).
- `run(id, params)` → load the report → `runStoredQuery(primary_query_id, values)` → shape into `ReportResult`
  (`columns` from the query result, `rows`, `chart` from `report.chart`). `summaryMetrics` ride on the summary.
- `renderPdf(id, params)` → load the report → load its `design` → for each bound table run its query with the
  filter values → `renderReportDesignPdf`. This is the existing `/api/report-designs/preview` pipeline, addressed
  by report id.
- `options(id)` → for each `select` param that has a `param_options[paramKey]` entry, run that one-column query via
  `runStoredQuery` and return `{ [paramKey]: string[] }`. No entry → the filter degrades to free text.

Because run-history (`ctx.reportRuns`), scheduling (`ctx.reportSchedules`), and the scheduler
(`ctx.reportScheduler`) only ever see a **report-id string** + `findSummary` for the name, they keep working with
**zero rework**.

### Param → filter mapping

The filter bar is generated from the linked design's `parameters[]`:

| TemplateParam | → | ReportParamMeta (filter bar) |
|---|---|---|
| `key` | → | `id` |
| `label` | → | `label` |
| `type` (`text`/`select`/`daterange`) | → | `type` |
| `required?` (new) | → | `required` |
| — | → | `optionsKey = key` when `param_options[key]` exists |

Filter values are substituted into the bound queries by matching `param.key` to the query's `:param` names — the
exact convention the designer preview route already uses (`design.param.key === query.param.id`).

### Run flow (two paths, one id)

```
filters (from + to + facility)
        │
        ▼
report id ──▶ ctx.reporting.findSummary/run/renderPdf ──▶ load report → design + primaryQuery
        │
        ├─ Document tab   → renderPdf(id, params)  → renderReportDesignPdf  (PDF)
        └─ Spreadsheet +  → run(id, params)        → runStoredQuery(primaryQuery)
           strip + chart                             → rows → CSV/XLSX, computeSummaryMetrics, chart hint
```

## UI

### Reports page (`apps/studio/src/pages/Reports.tsx`) — unchanged shape

- Library, header, filter bar, summary strip, Document/Spreadsheet tabs, history + schedules drawers: **all stay**.
- The filter bar is driven by `selected.parameters` exactly as today — now sourced from the template. A small
  "filters from template" affordance indicates provenance (optional polish).
- The kebab gains **Edit template** → deep-links to `/report-designer/:designId`.
- The `isCustom` (`source: 'builder'`) PDF-only branch generalizes: data-driven reports (`source: 'design'`) render
  **both** Document (via `renderPdf`) and Spreadsheet (via `run`).

### New report dialog (replaces the builder starter gallery on the New button)

Fields: **Name**, **Category**, **Description**, **Template** (picker over published designs), **Primary data
query** (defaults to the design's first bound table's query; editable). A read-only **"Filters this report will
expose"** section reflects the chosen template's params so the author sees the outcome before saving. Metrics/chart
are **not** in v1 (deferred editor).

Role-gated `lab_admin` / `lab_manager`, matching the existing New button.

### Designer shortcut (decision B)

`/report-designer` gains an **"Edit / Publish as report"** action (kebab) that either deep-links to the report that
already references this design, or opens the New-report dialog pre-filled with this design. Thin convenience; the
Reports page remains the source of truth for report records.

### API + CLI

- **`/api/report-defs`** CRUD for `reports` records: `GET` (open), `POST/PUT/DELETE`
  (`requireRole('lab_admin','lab_manager')`), Zod 400, audit `report.*`. Mirrors the `report_designs` route shape.
  Deliberately a distinct prefix from the existing `/api/reports` **run/render** routes (`/api/reports/:id` GET
  already means "run this report") — management of the record is `/api/report-defs`, execution stays `/api/reports`.
- Studio `api.ts` fns via **`authFetch`** (bare `fetch` 401s under Keycloak — repo gotcha).
- `openldr report list --json` / `report delete <id> --force` CLI parity (per [[cli-operator-parity]]), sharing
  logic through `@openldr/bootstrap`.

## Migration (the three deliverables, seeded on first run)

Each built-in report → one custom query + one simple template (title, date, param echo, one bound table) + one
report record, seeded idempotently (mirrors the existing `seedReportDesigns`). SQL is standard **CASE
conditional-aggregate** — no crosstab extension.

| Built-in (id) | Category | Query shape | Notes |
|---|---|---|---|
| `amr-resistance` | amr | `GROUP BY antibiotic` + `SUM(CASE interpretation …)` for R/I/S + %R | CASE columns |
| `amr-facility-summary` | amr | `GROUP BY facility`, counts + %R | plain |
| `amr-glass-ris` | regulatory | GLASS-shaped SELECT, one row per pathogen/antibiotic | plain |
| `amr-first-isolate-summary` | amr | window-function first isolate per patient → aggregate | CTE |
| `test-volume` | operational | `GROUP BY period/test`, `COUNT` | plain |
| `turnaround-time` | operational | `AVG`/percentile of `(result − collected)` | plain |
| `patient-demographics` | quality | age-band CASE + `GROUP BY sex` | CASE bands |
| `amr-antibiogram` | amr | organism × **fixed antibiotic panel** matrix, first-isolate dedup in SQL | **migrated last**; fallback = keep as code |

Facility (and similar) select options → seeded one-column custom queries referenced by `param_options`.

### What gets deleted at cutover

- The 8 `ReportDefinition`s + `reportCatalog()` / `getReport()` / `reportSummaries()`.
- **Kept** (still used elsewhere): `toCsv`, schedule math (`nextRunAt`, `schedule-period`), the
  `ChartHint`/`ReportResult`/`ReportParamMeta`/`ReportMetricMeta` types, AMR aggregation helpers.

### Migration risk — re-point report consumers first

The **DHIS2 push path** (`dispatchReportSource`) and **event sources** (`reporting.run` / `runEventSource` /
`eventSources`) currently call the catalog. These must be re-pointed to the data-driven path (or the specific
sources they need preserved) **before** the `ReportDefinition` code is removed. This is a hard gate on the cutover
slice.

## Testing

- **Package unit** (`@openldr/report-designer` render already covered): the 8 seeded custom-query SQL strings each
  produce output matching the current report for a seeded fixture DB (row-for-row where feasible; antibiogram
  compared on the fixed panel).
- **Store/API/CLI** for `reports` records mirror the `report_designs` suites (Zod parse, CRUD, idempotent seed).
- **Reporting service**: `listAll`/`findSummary`/`run`/`renderPdf`/`options` resolve a data-driven report id.
- **Live smoke** (per prior slices): seed → open `/reports` → select a migrated report → filters render from
  template → Run → PDF + Spreadsheet + strip populate → run-history row recorded → schedule creates. Compare a
  migrated report's numbers to the pre-cutover catalog output on the dev Postgres.
- **Gate:** `pnpm turbo run typecheck test --force`, modulo the two known flakes
  ([[studio-test-vitest-dedupe-flake]] + parallel-turbo timeouts).

## Slice decomposition (for the plan)

- **S1 — `reports` store + API + CLI** (record only, no rendering wired). Migration 043, Zod schema, CRUD route,
  studio api fns, CLI. No behavior change on `/reports` yet.
- **S2 — Reporting service third source.** `listAll/findSummary/run/renderPdf/options` resolve `reports` records;
  param→filter mapping; `param_options` resolution. `/reports` can now list + run a manually-seeded record.
- **S3 — New report dialog + designer shortcut.** Replace the New button's starter gallery; deep-link kebab.
- **S4 — Migrate the 7 plain/CASE reports** to seeded query+template+record (parity-tested each).
- **S5 — Re-point DHIS2/event-source consumers, then delete the catalog** (hard gate).
- **S6 — Antibiogram** (fixed panel) migrated last; or exercise the code-fallback if lossy.
- **S7 (fast-follow, out of this plan) — metrics/chart editor** in the report dialog.
