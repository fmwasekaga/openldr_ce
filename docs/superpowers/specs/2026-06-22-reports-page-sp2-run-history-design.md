# Reports Page — Corlix Parity, SP-2 (Run History) — Design

**Date:** 2026-06-22
**Status:** Approved for planning
**Workstream:** Reports page (corlix parity). SP-2 of three. Builds on SP-1
(merged to local `main`, merge `01b3f0c`).

## Goal

Record every report run and export, and surface them in a **Run History** drawer
opened from the report's 3-dot actions menu. History is shared (all authenticated
users see all runs for a report), records who ran it, and clicking a past run
re-applies its parameters into the parameters bar.

This wires up the "Run History" item that SP-1 left as a disabled placeholder.
Scheduling (the Schedules drawer + scheduled-run history) remains **SP-3**.

## What gets logged

Four formats, each representing an explicit user action:

| format    | trigger                                             |
|-----------|-----------------------------------------------------|
| `preview` | the user clicks **Run** (the on-screen report run)  |
| `csv`     | the user clicks **Export CSV**                      |
| `pdf`     | the user clicks **Download** in the PDF viewer      |
| `xlsx`    | the user clicks **Export XLSX**                     |

**Logging is client-driven, user is server-stamped.** The browser knows which
explicit action occurred (and the row count / params for it), so it sends a
beacon; the server attaches the authenticated user identity (never trusting a
client-claimed identity) and persists. This gives precise *export* semantics —
e.g. a PDF is logged only on the explicit Download click, not merely because the
Document tab rendered a preview — through one uniform code path with no
side-effects on GET routes.

### CSV-auth fix (folded into SP-2)

All `/api/*` routes require a bearer token (`apps/server/src/auth-plugin.ts`
`onRequest` hook). SP-1's CSV export is a plain `<a href={csvUrl(...)}>` download,
which carries **no** Authorization header and therefore 401s under real auth
(it only works because `AUTH_DEV_BYPASS=true` in local dev). SP-2 changes the CSV
export to an `authFetch` → blob download (mirroring how the PDF is fetched). This
fixes the latent bug and makes the logged `csv` action truthful.

## Architecture

### Backend

**Migration `025_report_runs`** (`packages/db/src/migrations/internal/`)
Table `report_runs`:
- `id` text primary key
- `report_id` text not null
- `report_name` text not null  (denormalized for display)
- `format` text not null  (`preview` | `csv` | `pdf` | `xlsx`)
- `params` jsonb not null default `'{}'`
- `row_count` integer  (nullable)
- `user_id` text  (nullable — tolerate dev-bypass/synthetic actor)
- `user_name` text  (nullable)
- `created_at` timestamptz not null default `now()`

Index `report_runs_report_created_idx` on `(report_id, created_at desc)`.
`down()` drops the table.

**`InternalSchema`** (`packages/db/src/schema/internal.ts`) gains a `report_runs`
row-type matching the table (Kysely `Generated`/`ColumnType` where the existing
tables in that file do, e.g. `created_at` generated, `id` insertable).

**`ReportRunStore`** (`packages/db/src/report-run-store.ts`, mirrors the existing
store modules):
```ts
export interface ReportRunRecord {
  id: string; reportId: string; reportName: string;
  format: 'preview' | 'csv' | 'pdf' | 'xlsx';
  params: Record<string, unknown>;
  rowCount: number | null;
  userId: string | null; userName: string | null;
  createdAt: Date;
}
export interface NewReportRun {
  reportId: string; reportName: string;
  format: ReportRunRecord['format'];
  params: Record<string, unknown>;
  rowCount: number | null;
  userId: string | null; userName: string | null;
}
export interface ReportRunStore {
  record(run: NewReportRun): Promise<void>;
  list(opts: { reportId?: string; limit: number; offset: number }):
    Promise<{ runs: ReportRunRecord[]; total: number }>;
}
export function createReportRunStore(db: Kysely<InternalSchema>): ReportRunStore
```
`record` generates the `id` (e.g. `crypto.randomUUID()`); `list` orders by
`created_at desc`, filters by `reportId` when provided, and returns the total
count for paging.

**`AppContext`** gains `reportRuns: ReportRunStore`, created in
`packages/bootstrap/src/index.ts` from `internal.db` (alongside `audit`/`users`).

**Routes** (`apps/server/src/reports-routes.ts`)
- `POST /api/reports/:id/runs` — body zod `{ format: enum, rowCount?: number,
  params?: record }`. Resolve `report_name` from `getReport(id)`/the catalog
  (404 via `mapError` if unknown). Stamp `userId`/`userName` from `req.user`
  (nullable). Call `ctx.reportRuns.record(...)`. Return `reply.code(201)`.
- `GET /api/reports/runs?reportId=&limit=&offset=` — parse/clamp `limit`
  (default 50, max 200) and `offset` (default 0). Return
  `ctx.reportRuns.list(...)` as `{ runs, total }`. Any authenticated user
  (shared). Register both **before** the bare `/api/reports/:id` GET so the
  literal `runs` segment is not captured by `:id`.

### Frontend (`apps/web/src`)

**`api.ts`**
```ts
export interface ReportRun {
  id: string; reportId: string; reportName: string;
  format: 'preview' | 'csv' | 'pdf' | 'xlsx';
  params: Record<string, string>;
  rowCount: number | null;
  userName: string | null;
  createdAt: string;
}
export function logReportRun(id, body: { format; rowCount?; params? }): Promise<void>
export function fetchReportRuns(opts: { reportId?; limit?; offset? }): Promise<{ runs: ReportRun[]; total: number }>
export function downloadReportCsv(id, params): Promise<void>  // authFetch → blob → save
```
`logReportRun` POSTs and ignores the response body (fire-and-forget; a failed
log must never block the user's action — swallow/log errors). `downloadReportCsv`
fetches `/api/reports/:id.csv?<params>` with `authFetch`, saves the blob via an
object-URL anchor (same pattern as `PdfCanvasViewer`'s download).

**`ReportHistoryDrawer.tsx`** (new) — shadcn `Sheet` (right side, ~520px).
Props: `{ open, onClose, reportId, onApplyParams }`. On open (and `reportId`
change), loads `fetchReportRuns({ reportId, limit: 50 })`. Renders a table:
**Format** (shadcn `Badge`) · **Rows** · **User** · **When** (localized). Each
row is clickable → `onApplyParams(run.params)` then `onClose()`. Loading / empty
/ error states. i18n keys under `reports.history.*`.

**`ReportActionsMenu.tsx`** — gains `onOpenHistory?: () => void`. The "Run
History" item becomes enabled and calls it; "Schedules" stays disabled
(SP-3). (Existing test updated.)

**`PdfCanvasViewer.tsx`** — gains optional `onDownload?: () => void`, invoked
inside the existing download handler (after the save) so the page can log a
`pdf` run. No behavior change when the prop is absent.

**`ReportDocumentTab.tsx`** — gains optional `onDownload?: () => void`, passed
straight through to `PdfCanvasViewer`.

**`ReportSpreadsheetTab.tsx`** — CSV control switches from an `<a href>` to a
button calling `downloadReportCsv(reportId, params)` then an
`onExport?.('csv', rowCount)` callback; XLSX button additionally calls
`onExport?.('xlsx', rowCount)`. (rowCount = `result.rows.length`.) New optional
prop `onExport?: (format: 'csv' | 'xlsx', rowCount: number) => void`.

**`Reports.tsx`** — orchestration:
- `const [historyOpen, setHistoryOpen] = useState(false)`.
- Pass `onOpenHistory={() => setHistoryOpen(true)}` to `ReportActionsMenu`.
- Render `<ReportHistoryDrawer open={historyOpen} onClose={…} reportId={selected.id}
  onApplyParams={(p) => { setParams(p); setHistoryOpen(false); }} />`.
- `logReportRun(selectedId, { format: 'preview', rowCount: res.meta.rowCount,
  params })` after a successful Run.
- Pass `onExport={(format, rowCount) => logReportRun(selected.id, { format,
  rowCount, params: ranParams })}` to `ReportSpreadsheetTab`.
- Pass `onDownload={() => logReportRun(selected.id, { format: 'pdf',
  rowCount: result?.meta.rowCount, params: ranParams })}` to `ReportDocumentTab`.

(Exports use `ranParams` — the run-snapshot params from SP-1 — so the logged
params match the displayed result.)

## Data flow

1. User clicks Run → `fetchReport` → on success, `logReportRun('preview')`.
2. User clicks Export CSV → `downloadReportCsv` (authenticated) → `onExport('csv')`
   → `logReportRun('csv')`.
3. User clicks Export XLSX → client XLSX build → `onExport('xlsx')` →
   `logReportRun('xlsx')`.
4. User clicks Download in the PDF viewer → save blob → `onDownload` →
   `logReportRun('pdf')`.
5. Each beacon → `POST /api/reports/:id/runs` → server stamps user → insert.
6. User opens Run History → `GET /api/reports/runs?reportId=…` → drawer table.
7. User clicks a row → `onApplyParams` → params bar repopulated.

## Error handling

- `logReportRun` is fire-and-forget: network/HTTP errors are caught and ignored
  (optionally `console.warn`) so logging never blocks running/exporting.
- `downloadReportCsv` surfaces failures (it's the user's explicit action) —
  on error, show the existing error affordance / throw to a catch that sets an
  error message; do **not** silently fail the download.
- `fetchReportRuns` errors render an error state inside the drawer.
- POST route returns 400 on invalid body (zod), 404 on unknown report id.

## Testing

- **`ReportRunStore`** (pg-mem): `record` inserts; `list` orders newest-first,
  filters by `reportId`, paginates, returns `total`.
- **Routes** (`reports-routes.test.ts`, stubbed `ctx.reportRuns` + injected
  `req.user`): POST validates body, resolves name, stamps user, returns 201;
  POST unknown id → 404; POST bad format → 400; GET returns `{ runs, total }`
  and passes through `reportId`/`limit`/`offset`.
- **`ReportHistoryDrawer`**: renders rows from a mocked `fetchReportRuns`; a row
  click fires `onApplyParams` with that run's params; empty state renders.
- **`ReportActionsMenu`**: "Run History" enabled and fires `onOpenHistory`;
  "Schedules" still disabled.
- **api helpers**: `logReportRun` POSTs the right URL/body and swallows errors;
  `fetchReportRuns` builds the query string; `downloadReportCsv` fetches with
  auth and resolves.
- Full gate: `turbo typecheck lint test build` + depcruise green. Add the
  `report_runs` migration to any internal-migration test list if one exists.

## Files

**Backend**
- `packages/db/src/migrations/internal/025_report_runs.ts` (create)
- `packages/db/src/schema/internal.ts` (add `report_runs` to `InternalSchema`)
- `packages/db/src/report-run-store.ts` (+ test) (create)
- `packages/db/src/index.ts` (export the store if the package barrels stores)
- `packages/bootstrap/src/index.ts` (`AppContext.reportRuns` + construction)
- `apps/server/src/reports-routes.ts` (+ test) (POST + GET routes)

**Frontend (`apps/web/src`)**
- `api.ts` (`ReportRun`, `logReportRun`, `fetchReportRuns`, `downloadReportCsv`)
- `reports/ReportHistoryDrawer.tsx` (+ test) (create)
- `reports/ReportActionsMenu.tsx` (+ test) (`onOpenHistory`, enable History)
- `reports/PdfCanvasViewer.tsx` (`onDownload`)
- `reports/ReportDocumentTab.tsx` (`onDownload` passthrough)
- `reports/ReportSpreadsheetTab.tsx` (+ test) (CSV→authFetch, `onExport`)
- `pages/Reports.tsx` (+ test) (drawer wiring + four log call sites)
- `i18n/en.ts`, `fr.ts`, `pt.ts` (`reports.history.*` + format/badge labels)

## Risks / notes

- **GET side-effect avoidance:** runs are recorded via the explicit `POST`
  beacon, not as a side-effect of the preview/csv/pdf GET routes — keeps GETs
  safe/idempotent and gives accurate export counts.
- **rowCount availability:** the page always has `result.meta.rowCount` once a
  run exists (tabs only render post-run), and XLSX uses the filtered row count;
  so every beacon carries a meaningful count.
- **i18n parity:** new keys must be added to en/fr/pt (parity test).
- **Migration test lists:** if the repo asserts the internal migration set
  somewhere, register `025`.
