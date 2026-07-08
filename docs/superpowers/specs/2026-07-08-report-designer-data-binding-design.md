# Report Designer — Data-Binding + PDF + Preview Design Spec

**Date:** 2026-07-08
**Status:** Design approved; implementation not started
**Builds on:** the completed persistence slice (`3e3a10e8`) — designs now persist via `@openldr/report-designer` + `report_designs` + `/api/report-designs` CRUD. This slice makes them **produce output**.
**Reference patterns:** report-builder render/preview — `@openldr/report-builder` `src/render/{index,run-template,paint,layout}.ts` (pdfkit), `@openldr/report-pdf` (`renderReportPdf`, pre-resolved data); `apps/server/src/report-templates-routes.ts` (`POST /:id/preview`); `apps/studio/src/reports-builder/PreviewPdfDialog.tsx` + `apps/studio/src/reports/PdfCanvasViewer.tsx`; the `/query` custom-query run pipeline (`apps/server/src/query-routes.ts` `POST /api/query/run`, `apps/server/src/query-sql.ts` `substituteParams`, `packages/dashboards/src/sql-runner.ts` `validateSelectSql`, `ctx.workflows.services.runConnectorSql`); the custom-query store `packages/db/src/custom-query-store.ts`.

---

## 1. Purpose

Report Designer edits a free-form, absolute-positioned page of elements (text/table/image/line/rect/datetime) but produces nothing — `boundReport` is a display label, Preview/Export are `noop`. This slice delivers the first **data-and-output** capability:

1. A **table** element binds to a durable **Custom Query** (from the `/query` workbench) by id.
2. A new server route **resolves** each bound table's rows and **renders the whole design to PDF** (server-side pdfkit).
3. A **Preview modal** shows the rendered PDF of the *current in-editor design* (unsaved edits included).

Editing stays local; rendering is on-demand and server-side. This is a **separate resource** from report-builder (different model, different query-source: `/query` custom queries, not dashboards `WidgetQuery`).

---

## 2. Data-binding decisions (settled)

- **Data source:** a table binds to a `/query` **Custom Query** by id (`dataSource: { kind: 'custom-query'; queryId }`). Server runs it via the shared custom-query pipeline.
- **Parameters:** **design-level**. The design's `parameters` list supplies values, matched by `key → the query's declared param `id``, at render time. No prompt in the Preview modal.
- **Columns:** **pick + reorder + relabel**. Binding a query lets the user Load its result columns, then choose/order/relabel which become table columns (`boundColumns: {key,label}[]`). Render projects exactly those from each row (fallback: all result columns if none picked).
- **Render/execution boundary:** **Approach A** — the renderer is a **pure** `(design, resolvedData) → Buffer`; the preview route does all DB/query/param work and passes pre-resolved data. (The designer's absolute layout needs no data to lay out, unlike report-builder's flow layout.)
- **Preview previews the working design** (POST the in-editor design body), not a save-first reload.
- **v1 table overflow is clipped to the element rect** (no cross-page pagination).
- **Preview route roles:** `lab_admin`, `lab_manager`, `data_analyst` (matches the `/query` workbench, since preview executes SQL).

---

## 3. Model changes — `@openldr/report-designer/pure` (`schema.ts`)

Additive and backward-compatible (the 3 seed designs keep parsing; an unbound table renders its static `columns`/`rows` exactly as today):

- `DesignElement` gains:
  - `dataSource?: { kind: 'custom-query'; queryId: string }` — the real table binding.
  - `boundColumns?: { key: string; label: string }[]` — the picked/reordered/relabeled projection of the query's result columns.
  - The existing `boundReport?: string` is kept but **deprecated** (a display label; superseded by `dataSource`). The existing `columns?: string[]` / `rows?: string[][]` remain the **static fallback** for unbound tables.
- `TemplateParam` extends from `{ key, label, value }` to:
  ```ts
  { key: string; label: string; type?: 'text' | 'select' | 'daterange';
    value?: string | { from: string; to: string } }
  ```
  A plain string `value` stays valid (text/select). `daterange` carries `{ from, to }` (ISO date strings), which feeds `{{param.from}}`/`{{param.to}}` in the query SQL.

`ReportDesignSchema` continues to strip unknown keys and apply the existing defaults. New fields are optional; the migration/table shape is unchanged (all of this lives inside the JSON `pages`/`parameters` columns).

---

## 4. Renderer — new Node-only module in `@openldr/report-designer`

- New `src/render/` using **pdfkit** (Node-only). Add `pdfkit` + `@types/pdfkit` to the package deps.
- Exported **only** from the package's `.` barrel (`index.ts`) — **never** from `./pure`. Studio imports only `/pure` (browser-safe); server/bootstrap/cli import `.` (already the case for store/seed).
- Entry: **`renderReportDesignPdf(design: ReportDesign, resolved: Map<string, ResolvedTable>): Promise<Buffer>`** — a **pure** function (no DB, no async query execution).
  - `type ResolvedTable = { columns: { key: string; label: string }[]; rows: Record<string, unknown>[] } | { error: string }`.
  - The map is keyed by **table element id**.
- Rendering:
  - Page size from `design.paper`/`orientation` in **PDF points @72dpi** (`A4 595.28×841.89`, `Letter 612×792`); one PDF page per `design.pages[]`.
  - Convert every element `rect{x,y,w,h}` from designer **px@96dpi → pt@72dpi (×0.75)**. Apply the same style defaults the canvas uses (`PageCanvas.tsx`): text `fontSize` 11 / `color #262626` / `bold` / `align`; line stroke `#a3a3a3` w1; rect border `#d4d4d4` w1, `fill:'none'` → transparent.
  - Element kinds:
    - `rect` — border + optional fill.
    - `line` — stroke across the rect.
    - `text` — `interpolate` `{{param.<key>}}` (from `design.parameters`) and `{{date}}`, then draw styled/clipped to the rect.
    - `datetime` — `{{date}}`/now token → formatted date.
    - `image` — `src` (data-URI or URL) embedded; on missing/invalid → dashed placeholder box (mirrors the canvas).
    - `table` — with a `resolved` entry: draw a striped header+rows grid of `boundColumns` (or all result columns if none picked), **clipped to the element rect** (overflow truncated in v1). With `{error}`: red placeholder (mirror report-builder `drawErrorPlaceholder`). Unbound (no entry / no `dataSource`): draw static `columns`/`rows`.

The renderer is unit-testable with a hand-built `resolved` map and a fake/none data path — no DB or connectors.

---

## 5. Server — shared run helper + preview route (`apps/server`)

- **Extract** the inline `/api/query/run` pipeline into a reusable helper:
  **`runStoredQuery(deps, queryId, values): Promise<{ columns: {key,label}[]; rows: Record<string,unknown>[] }>`** — load the record (`createCustomQueryStore(ctx.internalDb).get(queryId)`), `substituteParams(sql, record.params, values)`, `validateSelectSql`, then `ctx.workflows.services.runConnectorSql({ connectorId: record.connectorId, sql })`. Refactor `POST /api/query/run` to call it (no behavior change) so the SELECT-only + Postgres + missing-required-param gates live in one place. (May promote the store to `ctx.customQueries`.)
- **New `POST /api/report-designs/preview`** (resource-less — renders the posted body, so it works for transient/unsaved designs too) — `requireRole('lab_admin','lab_manager','data_analyst')`:
  - Body: the **working design** (`ReportDesign`, Zod-parsed → 400 on bad body) — preview reflects unsaved edits; the posted body is the sole source of truth for what's rendered (no server-side load by id).
  - For each table element with a `dataSource.queryId`: load the query's declared params, build a `values` map by matching each param `id` to `design.parameters` (text/select → string; daterange → `{from,to}`), call `runStoredQuery` (per-table `try/catch` → `{ error }`).
  - Assemble the `resolved` Map → `renderReportDesignPdf(design, resolved)` → reply `content-type: application/pdf`, `content-disposition: inline`, the Buffer.
  - Modeled on `report-templates-routes.ts` `POST /:id/preview` but body-driven rather than id-loaded (no SQL-authoring gate needed — the query is a pre-authored custom query; the SELECT gate in `runStoredQuery` still applies).

---

## 6. Studio (`apps/studio`)

- **`api.ts`:** `previewReportDesign(design: ReportDesign): Promise<Blob>` via **`authFetch`** (`POST /api/report-designs/preview`, body = working design, → `r.blob()`). Reuse `queryApi.list()` (custom-query picker) and `queryApi.run(...)` (column loading) — all already `authFetch`-backed.
- **Data tab** (`DataTab.tsx`) — replace the mock label list. When a **table** element is selected:
  1. **Custom-query picker** (`queryApi.list()`) → sets `dataSource.queryId` (patch via the existing `onPatchElement`).
  2. **Load columns** action → runs the query with the current design param values → lists result columns → include / drag-reorder / relabel → writes `boundColumns`.
  3. **Design parameters editor** — edit `design.parameters` (key/label/type/value; `daterange` → from/to inputs), patched via `onPatchPage`-style wiring at the design level; each edit is one undo step, persisted on Save.
  When a non-table element (or nothing) is selected, the tab shows a thin hint (page-level params still editable). Reuse the shared `NumberField`/`ColorField`/`Select` primitives + edge-to-edge rows.
- **Preview modal:** the kebab **Preview** item (currently `noop`) opens `PreviewReportDesignDialog` — a mirror of `PreviewPdfDialog` + `PdfCanvasViewer`: `Dialog` `max-w-4xl` / `h-[70vh]`, loading ("rendering…") / error (destructive text) / blob (`PdfCanvasViewer`) states, `active`-guard against stale responses, re-fetch keyed on open + design identity + a serialization of the design/params. It POSTs the **current in-editor design**.
- **Canvas:** unchanged — bound tables keep showing headers (from `boundColumns`) with placeholder rows; **no queries run on the canvas** (live data only in Preview/PDF).

---

## 7. Testing

- **Renderer (`@openldr/report-designer` `.`):** given a design + a hand-built `resolved` map → non-empty PDF Buffer; N pages for N design pages; a `{error}` entry → placeholder path (no throw); px→pt (×0.75) conversion; every element kind drawn; unbound table falls back to static `columns`/`rows`.
- **`runStoredQuery` + `/api/query/run` refactor:** substitute→validate→run with a fake connector runner; SELECT gate rejects DML/multi-statement; missing required param throws; existing `/api/query/run` tests stay green.
- **Preview route:** fake ctx (fake `runStoredQuery`) → `application/pdf` inline for a posted design; 400 on an invalid design body; 403 without an allowed role; a failing bound query → per-table placeholder, **not** a 500; a design with no bound tables → still renders.
- **Studio:** Data-tab binding (picker sets `dataSource`; Load-columns populates from a mocked `queryApi.run`; column pick/reorder/relabel writes `boundColumns`; param editor writes `design.parameters`); `PreviewReportDesignDialog` calls `previewReportDesign` and renders the blob; `previewReportDesign` hits the right URL/method via a mocked `authFetch`. Mock the api module; preserve existing report-designer tests.
- **i18n:** all new strings (picker/load-columns/param editor/preview states) get en/fr/pt with `EnShape` parity (`src/i18n/parity.test.ts`).
- **Gate:** `pnpm turbo run typecheck test --force` green modulo the two known flakes ([[studio-test-vitest-dedupe-flake]] + parallel-turbo timeouts). Live smoke: bind a seeded/real custom query to a table, set params, Preview → real rows in the PDF; verify against the port-5433 dev DB (`docker compose up -d postgres`, API `node dev.mjs` no `--watch`, `AUTH_DEV_BYPASS=true`, vite studio; drive with throwaway `e2e/*.mjs` Playwright).

---

## 8. Explicitly out of scope (fast-follows)

- **Excel export** (the kebab's Export ▸ Excel stays `noop`).
- **Multi-page table pagination** — v1 clips table overflow to the element rect.
- **Chart/kpi element binding**, and binding **text/datetime** to single query values (only `{{param.*}}`/`{{date}}` interpolation in text this pass).
- **Query-result caching** and any canvas live-data preview (canvas stays placeholder).
- **Non-Postgres connectors** — custom-query execution is Postgres-only today; MSSQL-backed queries are excluded until the run path supports them.
- **Autosave / versioning** (still explicit Save; carried from the persistence slice).
- **`data_analyst` write access to designs** — unchanged; only the *preview* route adds that role, CRUD writes stay `lab_admin`/`lab_manager`.

---

## 9. Reference (copy end-to-end)

- Render structure + error placeholder: `@openldr/report-builder` `src/render/{index,paint}.ts`; pre-resolved-data drawing: `@openldr/report-pdf` `src/index.ts`.
- Preview route: `apps/server/src/report-templates-routes.ts` `POST /:id/preview`. Preview UI: `apps/studio/src/reports-builder/PreviewPdfDialog.tsx` + `apps/studio/src/reports/PdfCanvasViewer.tsx`; client `previewReportTemplate` (`apps/studio/src/api.ts`).
- Custom-query run pipeline to extract: `apps/server/src/query-routes.ts` (`/api/query/run`), `apps/server/src/query-sql.ts` (`substituteParams`), `packages/dashboards/src/sql-runner.ts` (`validateSelectSql`), `ctx.workflows.services.runConnectorSql`; record store `packages/db/src/custom-query-store.ts`; client `queryApi` (`apps/studio/src/query/api.ts`).
- Coordinate/style source of truth to match: `apps/studio/src/report-designer/PageCanvas.tsx` + `model.ts` (`PAPER_PX`, `paperSize`, style defaults).
