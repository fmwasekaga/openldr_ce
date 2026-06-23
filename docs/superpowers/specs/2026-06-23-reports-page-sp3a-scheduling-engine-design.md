# Reports Page — Corlix Parity, SP-3a (Scheduling Engine) — Design

**Date:** 2026-06-23
**Status:** Approved for planning
**Workstream:** Reports page (corlix parity). SP-3 split into **3a (backend engine)**
and **3b (UI)** for tighter review cycles. This is **3a**. Builds on SP-1
(`01b3f0c`) + SP-2 (`9efe947`), both merged to local `main`.

## Goal

A working, API-drivable report-scheduling backend: persist schedules, fire them
at their cron boundary via the durable event bus (mirroring the DHIS2 scheduler),
render each run's output (CSV/XLSX/PDF) to blob storage, record the run, and
expose CRUD + run-now + scheduled-run-list + authenticated-download routes.

After 3a, a `lab_admin`/`lab_manager` can create a schedule via the API and it
will generate and store outputs on schedule and on demand. **No UI in 3a** — the
Schedules drawer, Schedule dialog, History "Scheduled Runs" tab, and the
`Switch`/`Tabs` primitives are **SP-3b**.

### Out of scope (SP-3b)
All `apps/web` work: `ScheduleDialog`, `ReportSchedulesDrawer`, enabling the
"Schedules" menu item, the History drawer "Scheduled Runs" tab, `Switch`/`Tabs`
shadcn primitives, `Reports.tsx` wiring, `api.ts` client helpers, i18n.

## Context

- The event bus (`packages/ports/src/eventing.ts`) is durable (PG outbox):
  `publish(event, { availableAt })` schedules future delivery; `subscribe(type,
  handler)` consumes. The **DHIS2 scheduler** (`packages/bootstrap/src/dhis2-context.ts`
  `registerSync` + `reconcileSchedules`, wired in `apps/server/src/index.ts:56-60`
  with `ingest.eventing`) is the exact pattern to mirror.
- `ctx.blob` (`BlobStoragePort`): `put(key, body, contentType?)`, `get(key)`,
  `presign(key, expires?)`. Used to store rendered outputs (MinIO/S3).
- `ctx.reporting`: `run(id, params)`, `renderPdf(id, params)`, `list()` (enriched
  with `parameters`, so the runner can detect a `daterange` param).
- `toCsv(columns, rows)` (`@openldr/reporting`) renders CSV. `xlsx` (SheetJS) is
  a root dep usable server-side for XLSX.
- `requireRole(...)` from `apps/server/src/rbac` is used as a Fastify `preHandler`
  (e.g. `requireRole('lab_admin')`). Management routes gate on
  `lab_admin`/`lab_manager` (confirm `requireRole` accepts multiple roles during
  planning; the DHIS2 routes pass a single role).
- Next internal migration number is **026**. The SP-2 gotcha: a hard-coded
  migration-list assertion in `packages/db/src/migrations/migrations.test.ts` must
  be updated when a migration is added.

## Architecture

### 1. Data model — migration `026_report_schedules`

**`report_schedules`**
- `id` text pk
- `report_id` text not null
- `params` jsonb not null default `'{}'`  (non-date param template; the date
  window `from`/`to` is computed per period at run time)
- `frequency` text not null  (`daily` | `weekly` | `monthly` | `quarterly`)
- `day_of_week` integer  (0–6, Sun–Sat; for `weekly`; nullable)
- `day_of_month` integer  (1–28; for `monthly`; nullable)
- `output_format` text not null  (`csv` | `xlsx` | `pdf`)
- `enabled` boolean not null default true
- `last_run_at` timestamptz
- `next_due_at` timestamptz
- `created_by` text  (user id, nullable)
- `created_at` timestamptz not null default `now()`
- `updated_at` timestamptz not null default `now()`

**`report_schedule_runs`**
- `id` text pk
- `schedule_id` text not null
- `report_id` text not null
- `report_name` text not null
- `run_at` timestamptz not null default `now()`
- `period_start` timestamptz
- `period_end` timestamptz
- `output_format` text not null
- `object_key` text  (blob key; null on failure)
- `byte_size` integer
- `row_count` integer
- `status` text not null  (`success` | `failed`)
- `error_message` text
- `created_at` timestamptz not null default `now()`

Indexes: `report_schedules_report_idx` on `(report_id)`;
`report_schedule_runs_schedule_created_idx` on `(schedule_id, created_at desc)`.
Both tables added to `InternalSchema` (`schema/internal.ts`) and the migration
registered in `migrations/internal/index.ts` **and** the
`migrations.test.ts` assertion list.

### 2. Schedule date math — `packages/reporting/src/schedule-period.ts` (pure)

Mirrors corlix's `calculateNextRunAt`; all UTC; runs anchor at 06:00 UTC.

```ts
export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly';

/** Next firing time strictly after `from`. */
export function nextRunAt(
  frequency: ScheduleFrequency,
  dayOfWeek: number | null,
  dayOfMonth: number | null,
  from: Date,
): Date;

/** The just-completed period the run should cover. */
export function periodFor(frequency: ScheduleFrequency, runAt: Date):
  { start: Date; end: Date };
```

- `nextRunAt`: daily → next day 06:00; weekly → next occurrence of `dayOfWeek`
  (default 1=Mon) at 06:00; monthly → next month, day `min(dayOfMonth ?? 1, 28)`
  at 06:00; quarterly → first day of next quarter at 06:00.
- `periodFor`: daily → previous calendar day; weekly → the 7 days ending at the
  run's date (exclusive of the run day, i.e. `[runDay-7, runDay)`); monthly →
  previous calendar month; quarterly → previous calendar quarter.

These are the gnarliest pieces and get exhaustive unit tests (fixed input dates,
no `Date.now()` in the helpers — `from`/`runAt` are passed in).

### 3. Store — `packages/db/src/report-schedule-store.ts`

`createReportScheduleStore(db: Kysely<InternalSchema>): ReportScheduleStore` with:
- `create(s: NewSchedule): Promise<void>` (caller supplies `id`, `nextDueAt`)
- `get(id): Promise<ScheduleRecord | null>`
- `list(opts: { reportId?: string }): Promise<ScheduleRecord[]>`
- `update(id, patch: { enabled?; frequency?; dayOfWeek?; dayOfMonth?;
  outputFormat?; params?; nextDueAt? }): Promise<void>` (bumps `updated_at`)
- `remove(id): Promise<void>`
- `setNextDue(id, at: Date): Promise<void>` · `markRun(id, at: Date): Promise<void>`
- `recordRun(run: NewScheduleRun): Promise<void>` (generates run id)
- `listRuns(opts: { reportId?; scheduleId?; limit; offset }):
  Promise<{ runs: ScheduleRunRecord[]; total: number }>`
- `getRun(runId): Promise<ScheduleRunRecord | null>` (for the download route)

Records map snake_case ↔ camelCase like the existing stores; `params` jsonb is
inserted via `JSON.stringify(...) as never` (repo convention, per SP-2). Exposed
as `ctx.reportSchedules` (constructed in `packages/bootstrap/src/index.ts`).

### 4. Runner — `packages/bootstrap/src/report-scheduler.ts`

`createReportScheduler(deps)` (deps = `{ reporting, blob, schedules, reporting
catalog access, logger }`, sourced from `ctx`) returns:
- `runDue(scheduleId)`: load schedule; if missing/disabled, no-op; compute
  `period = periodFor(freq, now)`; build params: start from `schedule.params`,
  and **if the report declares a `daterange` parameter** (via
  `ctx.reporting.list()` metadata), inject `from = period.start (YYYY-MM-DD)` /
  `to = period.end (YYYY-MM-DD)`; render:
  - `csv` → `toCsv(result.columns, result.rows)` → bytes
  - `xlsx` → SheetJS workbook from columns/rows → bytes
  - `pdf` → `ctx.reporting.renderPdf(id, params)` → Buffer
  then `blob.put('report-schedules/{scheduleId}/{runId}.{ext}', bytes,
  contentType)`, `recordRun({ status:'success', objectKey, byteSize, rowCount,
  periodStart, periodEnd, ... })`, `markRun(now)`. On any error:
  `recordRun({ status:'failed', errorMessage })` and log. Always re-arm next due.
- `registerRunner(eventing)`: `subscribe('report.schedule.due', async (e) => {
  const { scheduleId } = e.payload; await runDue(scheduleId); /* re-arm */ })`.
  After a scheduled run, compute `due = nextRunAt(...)`, `setNextDue(id, due)`,
  and `publish('report.schedule.due', { scheduleId }, { availableAt: due })` —
  exactly the DHIS2 self-re-arming loop.
- `reconcile(eventing)`: startup sweep — for each enabled schedule with
  `next_due_at` null or `<= now`, set/keep next due and publish a due event at
  that time (mirrors `dhis2.reconcileSchedules`).
- `runNow(scheduleId)`: publish `report.schedule.due` with `availableAt = now`
  (immediate) — used by the run-now route; it flows through the same `runDue`
  path so behavior is identical to a scheduled firing.

**Wiring:** in `apps/server/src/index.ts`, alongside the DHIS2 block
(`dhis2.registerSync` / `reconcileSchedules`), construct the report scheduler from
`ctx` and call `registerRunner(ingest.eventing)` + `reconcile(ingest.eventing)`
using the same eventing instance. (The runner is created from `ctx`, so it can
also be referenced by the routes for `runNow`; expose it as `ctx.reportScheduler`
or pass it into `registerReportRoutes`. **Decision:** expose `ctx.reportScheduler`
on `AppContext` so routes can call `runNow` without re-wiring eventing.)

Re-arming uses the same self-publishing loop as DHIS2, so a separate row in the
event outbox carries the next firing; the durable bus survives restarts and
`reconcile` heals anything missed while down.

### 5. Routes — `apps/server/src/reports-routes.ts`

Management routes gated `requireRole('lab_admin', 'lab_manager')`; viewing routes
require only authentication. Body validation via zod; errors via `mapError`.
Register the static `schedule-runs`/`schedules` paths so they aren't shadowed by
`:id`.

- `GET  /api/reports/:id/schedules` → `ctx.reportSchedules.list({ reportId })`.
- `POST /api/reports/:id/schedules` (gated) — body `{ frequency, dayOfWeek?,
  dayOfMonth?, outputFormat, params? }`; compute `nextDueAt = nextRunAt(freq,
  dow, dom, now)`; `create({ id: uuid, reportId, ..., createdBy: req.user?.id,
  nextDueAt })`; publish a due event at `nextDueAt`; return 201 with the record.
- `PATCH /api/reports/schedules/:sid` (gated) — partial update; if timing fields
  (`frequency`/`dayOfWeek`/`dayOfMonth`) change, recompute `nextDueAt` and
  publish a new due event; if `enabled` toggled true, ensure it's armed; return
  the updated record. (404 if unknown.)
- `DELETE /api/reports/schedules/:sid` (gated) → `remove`; 204/200.
- `POST /api/reports/schedules/:sid/run` (gated) — `ctx.reportScheduler.runNow(sid)`
  (404 if unknown); return 202.
- `GET  /api/reports/schedule-runs?reportId=&scheduleId=&limit=&offset=` (authed)
  → `listRuns(...)` `{ runs, total }`, newest-first, limit clamped [1,200].
- `GET  /api/reports/schedule-runs/:runId/download` (authed) — `getRun(runId)`;
  404 if missing or no `object_key`; stream `ctx.blob.get(object_key)` with the
  format's content-type and `Content-Disposition: attachment; filename=...`.

### 6. Config

`report-schedules/` blob keys live in the existing `S3_BUCKET`. No new config.
The runner's render reuses existing `ctx.reporting` (same DB the reports already
query). If the event bus is unavailable the runner simply doesn't fire (no crash);
`reconcile` re-arms on next startup.

## Error handling

- Runner: any failure during render/store → `recordRun(status:'failed',
  errorMessage)` + `logger.error`; the schedule is still re-armed so one bad run
  doesn't kill the schedule.
- Routes: 400 on invalid body (zod via `mapError`), 404 on unknown
  schedule/run/report, 403 via `requireRole` for non-managers on gated routes.
- Download: 404 when the run failed (no `object_key`) or the blob is missing.

## Testing

- **`schedule-period.ts`**: exhaustive unit tests for `nextRunAt` (each frequency,
  day-of-week wrap-around, day-of-month cap at 28, quarter boundaries) and
  `periodFor` (each frequency, month/quarter/year boundaries). Fixed input dates.
- **`ReportScheduleStore`** (pg-mem via `makeMigratedDb`): create/get/list/update/
  remove, setNextDue/markRun, recordRun + listRuns ordering/paging/total, getRun.
- **Migration** `026`: registered (incl. `migrations.test.ts`) + both tables
  writable.
- **Runner** (`report-scheduler.test.ts`, stubbed `reporting`/`blob`/`schedules`):
  `runDue` runs the report, injects `from`/`to` for a daterange report, renders
  the right format, puts the blob, records a success run, re-arms next due; a
  thrown render records a failed run and still re-arms; `runNow` publishes an
  immediate due event.
- **Routes** (`reports-routes.test.ts`, stubbed stores + injected `req.user` +
  role): CRUD happy paths, role gating (manager allowed, others 403 — if the test
  harness can simulate roles; otherwise assert the `preHandler` is attached),
  run-now 202, schedule-runs list shape, download streams bytes / 404 on missing.
- Full gate: `turbo typecheck lint test build` + depcruise. Web is untouched in 3a.

## Files

**Backend only**
- `packages/db/src/migrations/internal/026_report_schedules.ts` (+ test)
- `packages/db/src/migrations/internal/index.ts` (register)
- `packages/db/src/migrations/migrations.test.ts` (assertion list)
- `packages/db/src/schema/internal.ts` (`ReportSchedulesTable`,
  `ReportScheduleRunsTable`, `InternalSchema`)
- `packages/db/src/report-schedule-store.ts` (+ test)
- `packages/db/src/index.ts` (barrel export)
- `packages/reporting/src/schedule-period.ts` (+ test)
- `packages/reporting/src/index.ts` (export the period helpers if barreled)
- `packages/bootstrap/src/report-scheduler.ts` (+ test)
- `packages/bootstrap/src/index.ts` (`ctx.reportSchedules` + `ctx.reportScheduler`)
- `apps/server/src/reports-routes.ts` (+ test) — 7 routes
- `apps/server/src/index.ts` (wire `registerRunner` + `reconcile`)
- `apps/server/src/app.test.ts` (extend the AppContext stub with the new fields)

## Risks / notes

- **`requireRole` arity:** confirm it accepts multiple roles; if it only takes
  one, gate on `lab_manager` OR add an `OR` check, or extend `requireRole`. Decide
  in the plan.
- **XLSX server-side:** SheetJS `writeXLSX`/`write` with `type:'buffer'` yields
  bytes without touching the filesystem — use the in-memory write, not `writeFile`.
- **`runNow` vs inline:** run-now publishes an immediate event (not inline
  execution) so all runs share one code path and the route returns fast (202).
- **Event-bus test seam:** the runner takes `eventing` as a parameter
  (`registerRunner`/`reconcile`), so tests inject a fake bus; `runDue` is tested
  directly without a bus.
- **Migration-list assertion:** update `migrations.test.ts` (SP-2 lesson).
