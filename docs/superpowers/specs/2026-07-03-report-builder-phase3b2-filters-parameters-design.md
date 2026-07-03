# Report Builder — Phase 3b-2: Filters + Parameters + Binding — Design Spec

**Date:** 2026-07-03
**Status:** Approved for planning
**Depends on:** P3b-1 (`e1ae1af6`) — builder query + live canvas
**Parent design:** `docs/superpowers/specs/2026-07-03-report-builder-phase3b-data-parameters-design.md` (§C, §D, decomposition #2)
**Related:** [report-builder-workstream], `DashboardFilterEditor`, `DashboardFilterBar`, `ReportParametersBar`, `BuilderForm`, `useBlockData`

## Problem

P3b-1 gave data blocks live builder queries in the canvas, but those queries can't be **filtered**, and
reports have no **parameters**. Filter values bound to `{{param.x}}` currently resolve to empty because
`useBlockData(template, {})` and `PreviewPdfDialog params={{}}` are both hardcoded. P3b-2 makes reports
filterable and parameterised: per-query filters (with literal ⇄ parameter binding), a report parameters
editor, and a persistent **values bar** that drives both the live canvas and the PDF preview.

## What already exists (no work needed)

- `QueryFilter = { dimension, op, value }` on builder `WidgetQuery` (`@openldr/dashboards`), with
  `FILTER_OPS = ['eq','in','contains','gte','lte','between']`.
- `{{param.x}}` substitution in **both** `useBlockData.resolve()` (client) and Phase-2 `resolveQueryParams`
  (server). Token key is arbitrary (`params[k]`).
- `ReportParam = { id, label, type: 'daterange'|'select'|'text', required, optionsKey? }` on
  `ReportTemplate.parameters[]`.
- Select-options-from-SQL pattern: `runWidgetQuery({ mode:'sql', sql })`, first result column = options
  (see `DashboardFilterBar.tsx`). Reused verbatim — **no new endpoint, no new SQL-authoring gating** in
  this slice.

## Decisions (locked during brainstorm 2026-07-03)

1. **Param values source = persistent values bar that drives the canvas too.** A `ParamValuesBar` in the
   builder holds `paramValues`; those values feed `useBlockData` (live canvas reflects params — true
   WYSIWYG) **and** `PreviewPdfDialog`. One source of truth. (Rejected: preview-only form — leaves
   param-bound filters empty in the canvas.)
2. **`select` parameter options = Options SQL.** Mirror dashboard filters' `optionsSql`, run via the
   existing `runWidgetQuery` sql path. (Rejected: inline literal list — less powerful; drop-select —
   loses a locked capability.)

## Schema change (one additive field, no migration)

`ReportParamSchema` in `@openldr/report-builder` gains:

```ts
optionsSql: z.string().optional(),
```

alongside the existing `optionsKey`. Templates persist as JSON blobs and the field is optional, so this is
fully backward-compatible — **no DB migration**. `QueryFilter` and the substitution rules are unchanged.

## Components

All new UI lives in `apps/studio/src/reports-builder/` and may import studio api + dashboard components
freely (browser code). Layout/type imports still come from `@openldr/report-builder/pure` only.

### A. `ParametersEditor` (dialog)

Mirrors `DashboardFilterEditor`'s **UX** (rows with add / remove / up-down reorder, save/cancel footer) but
writes the **ReportParam** shape, not `DashboardFilterDef`. Each row:

- `id` (Variable ID, sanitised to `[A-Za-z0-9_]`) · `label` · `type` (`daterange` / `select` / `text`) ·
  `required` (checkbox).
- When `type === 'select'`: an **Options SQL** input (stored as `optionsSql`).

Opened from a new **"Parameters"** button in the builder header. `onSave` writes `template.parameters[]`.

### B. `ParamValuesBar` (persistent strip)

Rendered below the header, **only when `template.parameters.length > 0`**. One control per parameter,
mirroring `ReportParametersBar`:

- `daterange` → `DateRangePicker`, writing `from` / `to` keys into `paramValues`.
- `select` → `Select` whose options come from running the param's `optionsSql` via
  `runWidgetQuery({ mode:'sql', sql })` (first column). No `optionsSql` → empty/disabled.
- `text` → `Input`.

Edge-to-edge divider (house style). `onChange` updates `paramValues` in `ReportBuilderPage`.

### C. `FilterListEditor` (inspector)

Inside `QueryEditor`, below `BuilderForm`, for kpi / chart / table-own-query blocks. Operates on the
builder query's `filters[]`. Each filter row:

- **dimension** — `Select` from the block model's dimensions.
- **op** — `Select` over `FILTER_OPS`.
- **value** — a **literal ⇄ parameter** toggle:
  - *literal* → `Input`. For `in`, comma-split to an array; for `between`, two comma-separated values →
    `[a, b]`; otherwise scalar.
  - *parameter* → `Select` of the report's parameters → stores `{{param.<id>}}` (scalar).
  - The toggle's current state is **derived** from the stored value (`/^\{\{\s*param\./` ⇒ parameter mode).
- Remove row; "Add filter" button.

`QueryEditor` receives `parameters: ReportParam[]` (threaded via `BlockInspector` from
`ReportBuilderPage`) to populate the parameter dropdown.

## Data flow

```
ParametersEditor ──writes──▶ template.parameters[]
                                     │
ParamValuesBar ◀── renders controls ─┘   ──onChange──▶ paramValues (ReportBuilderPage state)
                                                              │
                        ┌─────────────────────────────────────┼───────────────────────────┐
                        ▼                                     ▼                             ▼
             useBlockData(template, paramValues)   PreviewPdfDialog params=paramValues   (canvas)
                        │                                     │
             resolve() substitutes {{param.x}}    server resolveQueryParams substitutes
```

`FilterListEditor` writes `{{param.<id>}}` into `filters[].value`; those tokens are substituted at query
time by the same rule on both client (canvas) and server (preview PDF), so the live canvas and the PDF
agree.

## Edge cases / the daterange nuance

- **`in` / `between` literals:** single input, split as above. Param-binding is always scalar.
- **daterange param → `between` on a date dimension:** the common case is a single report "period".
  v1: the parameter dropdown for such a filter offers the daterange param's **`from`** / **`to`**
  sub-tokens (`{{param.from}}` / `{{param.to}}`), matching the `from`/`to` keys `ParamValuesBar` /
  `ReportParametersBar` emit. **v1 assumes a single daterange parameter**; multiple daterange params would
  collide on the `from`/`to` keys — deferred to P3c.
- **Options SQL** reuses the existing dashboards sql query path; no additional `dashboard.raw_sql`
  authoring gate is introduced here (that concern is P3b-3's SQL *authoring* mode).

## Testing

- **`ParametersEditor`** (RTL): add/edit/remove/reorder; save writes `template.parameters[]`;
  `select` type reveals the Options SQL field.
- **`FilterListEditor`** (RTL): add filter; dimension/op update; value → parameter serialises
  `{{param.<id>}}`; unbind → literal; `in`/`between` produce arrays.
- **`ParamValuesBar`** (RTL): renders the correct control per type; `select` runs `optionsSql`
  (mocked `runWidgetQuery`) and lists options; `daterange` writes `from`/`to`.
- **`useBlockData`**: non-empty `paramValues` substitutes into a bound filter's value (extends existing
  substitution test).
- **Preview**: `ReportBuilderPage` passes `paramValues` to `previewReportTemplate` via `PreviewPdfDialog`.

## Scope boundaries (YAGNI for P3b-2)

**In:** `optionsSql` schema field, `ParametersEditor`, `ParamValuesBar` (drives canvas + preview),
`FilterListEditor` with literal ⇄ parameter binding, wiring `paramValues` through `useBlockData` +
`PreviewPdfDialog`.

**Out:** SQL-mode query authoring + `dashboard.raw_sql` authoring gate (**P3b-3**); multi-series /
breakdown (**P3b-4**); multiple daterange params, per-block refresh, P3a hardening (save-refetch clobber,
delete confirm, true drag-reorder) (**P3c**).

## Non-obvious constraints

- **Purity:** new components import layout/types from `@openldr/report-builder/pure` only; never the server
  barrel (pulls pdfkit, breaks the browser bundle).
- **Cross-package:** the `optionsSql` schema edit is in `@openldr/report-builder` — run the forced
  cross-package typecheck (server + bootstrap + cli consume the package), not just the studio build.
- **Conventions:** shadcn controls only; mirror `DashboardFilterEditor` (ParametersEditor) and
  `ReportParametersBar` (ParamValuesBar); reuse `runWidgetQuery` for options SQL.
