# Reports Page — Corlix Parity, SP-3b (Scheduling UI) — Design

**Date:** 2026-06-23
**Status:** Approved for planning
**Workstream:** Reports page (corlix parity). Final piece. Builds on SP-1
(`01b3f0c`), SP-2 (`9efe947`), and **SP-3a scheduling engine** (`690c1d6`) — all
merged to local `main`.

## Goal

The frontend for report scheduling, sitting on the SP-3a backend: a Schedules
drawer (list / create / edit / enable-toggle / run-now / delete), a Schedule
dialog (frequency + day picker + output format + the report's non-date params),
and a "Scheduled Runs" tab in the History drawer with authenticated download.
This enables the currently-disabled "Schedules" menu item and completes the
corlix-parity reports page.

### Out of scope
Backend (done in SP-3a). No new report types, no email delivery.

## Context

- **SP-3a routes** (`apps/server/src/reports-routes.ts`):
  - `GET  /api/reports/:id/schedules` (auth) → `ScheduleRecord[]`
  - `POST /api/reports/:id/schedules` (lab_admin/lab_manager) — body
    `{ frequency, dayOfWeek?, dayOfMonth?, outputFormat, params? }` → 201 + record
  - `PATCH  /api/reports/schedules/:sid` (manager) — partial → record
  - `DELETE /api/reports/schedules/:sid` (manager) → `{ ok }`
  - `POST   /api/reports/schedules/:sid/run` (manager) → 202
  - `GET  /api/reports/schedule-runs?reportId=&scheduleId=&limit=&offset=` (auth)
    → `{ runs, total }`
  - `GET  /api/reports/schedule-runs/:runId/download` (auth) → file stream
- **Roles:** `useAuth()` (`apps/web/src/auth/AuthProvider`) exposes
  `hasRole(role)`. `canManageSchedules = hasRole('lab_admin') ||
  hasRole('lab_manager')`.
- **dayOfWeek convention:** JS `getUTCDay` — Sun=0…Sat=6; the SP-3a `nextRunAt`
  defaults to Monday=1. The dialog lists Monday(1)…Saturday(6), Sunday(0).
- **Existing components this builds on:** `ReportActionsMenu` (History live since
  SP-2; "Schedules" is a disabled placeholder), `ReportHistoryDrawer` (Sheet,
  single run-list today), `Reports.tsx` (selects a report, holds `params`/
  `options`/`ranParams`), `fetchReportOptions` (SP-1). The reports' `parameters`
  metadata (SP-1, `ReportParamMeta`) drives the dialog's param controls.
- **shadcn:** `Switch` and `Tabs` do NOT exist yet. `@radix-ui/react-dialog` and
  `@radix-ui/react-dropdown-menu` are installed; `@radix-ui/react-switch` and
  `@radix-ui/react-tabs` are NOT — add them.
- **Download pattern:** mirror `downloadReportCsv`/`PdfCanvasViewer` — `authFetch`
  the URL, read the blob, save via an object-URL anchor.

## Architecture (all in `apps/web/src`)

### 1. New shadcn primitives
- `components/ui/switch.tsx` — wraps `@radix-ui/react-switch` (`Switch` styled
  like the other primitives; controlled via `checked`/`onCheckedChange`).
- `components/ui/tabs.tsx` — wraps `@radix-ui/react-tabs` (`Tabs`, `TabsList`,
  `TabsTrigger`, `TabsContent`).
- Add `@radix-ui/react-switch` + `@radix-ui/react-tabs` to `apps/web/package.json`.

### 2. `api.ts` — types + helpers
```ts
export interface ReportSchedule {
  id: string; reportId: string; params: Record<string, string>;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  dayOfWeek: number | null; dayOfMonth: number | null;
  outputFormat: 'csv' | 'xlsx' | 'pdf';
  enabled: boolean; lastRunAt: string | null; nextDueAt: string | null;
  createdBy: string | null;
}
export interface ReportScheduleRun {
  id: string; scheduleId: string; reportId: string; reportName: string;
  runAt: string; periodStart: string | null; periodEnd: string | null;
  outputFormat: string; objectKey: string | null; byteSize: number | null;
  rowCount: number | null; status: 'success' | 'failed'; errorMessage: string | null;
}
export interface ScheduleInput {
  frequency: ReportSchedule['frequency'];
  dayOfWeek?: number | null; dayOfMonth?: number | null;
  outputFormat: ReportSchedule['outputFormat'];
  params?: Record<string, string>;
}
export function fetchSchedules(reportId): Promise<ReportSchedule[]>
export function createSchedule(reportId, body: ScheduleInput): Promise<ReportSchedule>
export function updateSchedule(sid, patch: Partial<ScheduleInput> & { enabled?: boolean }): Promise<ReportSchedule>
export function deleteSchedule(sid): Promise<void>
export function runScheduleNow(sid): Promise<void>
export function fetchScheduleRuns(opts: { reportId?; scheduleId?; limit?; offset? }): Promise<{ runs: ReportScheduleRun[]; total: number }>
export function downloadScheduleRun(runId): Promise<void>   // authFetch → blob → save
```
All use `authFetch`; mutating helpers throw on non-ok (the drawer surfaces the
error). `downloadScheduleRun` saves the blob with a filename from the
`Content-Disposition` header when present, else `${runId}`.

### 3. `reports/ScheduleDialog.tsx` (modal `Dialog`)
Props: `{ open, onClose, reportId, parameters, options, initialParams, existing,
onSaved }` (`existing?: ReportSchedule` → edit mode). Local state seeded from
`existing` or defaults (`frequency:'monthly'`, `dayOfWeek:'1'`, `dayOfMonth:'1'`,
`outputFormat:'xlsx'`, params from `initialParams`). Fields:
- **Frequency** `Select`.
- **Day of week** `Select` (Mon=1…Sun=0) shown when frequency is `weekly`;
  **Day of month** `Select` (1–28) shown when `monthly`.
- **Output format** `Select` (csv / xlsx / pdf).
- **Parameters**: for each `ReportParamMeta` with `type !== 'daterange'`, render a
  control — `select` → `Select` (options from `options[optionsKey]`, plus an "All"
  entry), `text` → `Input` — bound into a local `params` map seeded from
  `initialParams`.
- A read-only line: **"Date window: auto (covers the last period)."**
- **Save** → `createSchedule(reportId, body)` or `updateSchedule(existing.id,
  body)` (body includes `params`); on success `onSaved()` + `onClose()`. Error
  line on failure. **Cancel** → `onClose`.

### 4. `reports/ReportSchedulesDrawer.tsx` (`Sheet`)
Props: `{ open, onClose, reportId, parameters, options, currentParams }`. On open
(+ `reportId` change) loads `fetchSchedules(reportId)`. Header: title + **"+ New
Schedule"** button (opens `ScheduleDialog` with no `existing`,
`initialParams=currentParams`). Per-schedule row:
- Frequency label (e.g. "Weekly · Mon", "Monthly · day 1", "Daily", "Quarterly")
  + output-format `Badge`.
- Next run / last run (localized; "—" when null).
- **Enabled `Switch`** → `updateSchedule(id, { enabled })` then refetch.
- **Run-now ▶** (lucide `Play`) → `runScheduleNow(id)` (toast/inline "queued").
- **Edit** (lucide `Pencil`) → `ScheduleDialog` with `existing`.
- **Delete** (lucide `Trash2`) → confirm (existing `confirm-dialog` or window
  confirm) → `deleteSchedule(id)` then refetch.
Loading / empty / error states. All mutations refetch the list; failures set an
inline error.

### 5. `reports/ReportActionsMenu.tsx`
Add props `onOpenSchedules?: () => void` and `canManageSchedules?: boolean`. The
"Schedules" `DropdownMenuItem`:
- when `canManageSchedules` → enabled, `onSelect={() => onOpenSchedules?.()}`.
- else → `disabled` with the "coming soon"/insufficient-permission title (current
  behavior).
History item unchanged (SP-2).

### 6. `reports/ReportHistoryDrawer.tsx` — add "Scheduled Runs" tab
Wrap the body in `Tabs` with two `TabsTrigger`s: **"Activity"** (the existing
`fetchReportRuns` table — unchanged) and **"Scheduled Runs"**. The scheduled tab
lazily loads `fetchScheduleRuns({ reportId, limit: 50 })` on first activation and
renders a table: output-format `Badge` · status `Badge` (success=secondary,
failed=destructive) · period (`periodStart`–`periodEnd`, localized) · when
(`runAt`) · **Download** (link/button → `downloadScheduleRun(run.id)`, hidden when
`!objectKey`/failed; failed rows show `errorMessage` muted). The drawer already
receives `reportId`.

### 7. `pages/Reports.tsx`
- `const { hasRole } = useAuth();` →
  `const canManageSchedules = hasRole('lab_admin') || hasRole('lab_manager');`
- `const [schedulesOpen, setSchedulesOpen] = useState(false);`
- `<ReportActionsMenu onOpenHistory={…} onOpenSchedules={() => setSchedulesOpen(true)} canManageSchedules={canManageSchedules} />`
- Render, guarded by `selected`, alongside the history drawer:
  `<ReportSchedulesDrawer open={schedulesOpen} onClose={() => setSchedulesOpen(false)} reportId={selected.id} parameters={selected.parameters} options={options} currentParams={params} />`

### 8. i18n
New nested `reports.schedules.*` (en/fr/pt, parity): `title`, `new`, `frequency`,
`daily`/`weekly`/`monthly`/`quarterly`, `dayOfWeek`, `dayOfMonth`, `outputFormat`,
`dateWindowAuto`, `enabled`, `runNow`, `edit`, `delete`, `deleteConfirm`,
`nextRun`, `lastRun`, `empty`, `saveError`, `loadError`, `queued`, and
`scheduledRuns` (tab), `activity` (tab), `colStatus`, `colPeriod`, `statusSuccess`,
`statusFailed`, `download`.

## Data flow

1. Manager opens the 3-dot menu → "Schedules" → `ReportSchedulesDrawer` loads
   `fetchSchedules(reportId)`.
2. "+ New Schedule" → `ScheduleDialog` → `createSchedule` → drawer refetches; the
   POST also arms the first due event server-side (SP-3a).
3. Toggle `Switch` → `updateSchedule({enabled})`; Run-now → `runScheduleNow`
   (202, the runner generates async); Edit → `updateSchedule`; Delete →
   `deleteSchedule`.
4. History drawer "Scheduled Runs" tab → `fetchScheduleRuns({reportId})` → table;
   Download → `downloadScheduleRun(runId)` streams the stored blob.

## Error handling

- Mutating helpers throw on non-ok; the drawer catches and shows an inline error,
  leaving the list intact.
- `downloadScheduleRun` surfaces failures (explicit user action).
- `fetchScheduleRuns`/`fetchSchedules` errors render an error state in the
  drawer/tab.
- A non-manager never sees an enabled "Schedules" item; the routes also enforce
  the role server-side (defense in depth).

## Testing

- **`Switch`** (toggles `onCheckedChange`) + **`Tabs`** (switches panels) primitives.
- **api helpers**: each builds the right URL/method/body; `downloadScheduleRun`
  fetches with auth and saves; mutating helpers reject on non-ok.
- **`ScheduleDialog`**: frequency `weekly` shows the day-of-week picker, `monthly`
  shows day-of-month; non-daterange params render and seed from `initialParams`;
  Save calls `createSchedule`/`updateSchedule` with the assembled body (incl.
  `params`).
- **`ReportSchedulesDrawer`**: renders a schedule row; toggle → `updateSchedule`;
  run-now → `runScheduleNow`; delete → `deleteSchedule`; "+ New" opens the dialog.
- **`ReportHistoryDrawer`**: the "Scheduled Runs" tab loads + renders runs with a
  download control; failed run shows the error and no download.
- **`ReportActionsMenu`**: "Schedules" enabled + fires `onOpenSchedules` when
  `canManageSchedules`; disabled otherwise. (History test unchanged.)
- **`Reports.tsx`**: opening Schedules from the menu mounts the drawer (mock the
  api + `useAuth` to a manager).
- Full gate: `turbo typecheck lint test build` + depcruise + i18n parity. Web
  `lint` is a no-op (typecheck is the static gate); scope single web tests with
  `npx vitest run <path>`.

## Files

**New (`apps/web/src`)**
- `components/ui/switch.tsx`, `components/ui/tabs.tsx` (+ deps)
- `reports/ScheduleDialog.tsx` (+ test)
- `reports/ReportSchedulesDrawer.tsx` (+ test)

**Modified**
- `api.ts` (types + 7 helpers)
- `reports/ReportActionsMenu.tsx` (+ test) — `onOpenSchedules` + `canManageSchedules`
- `reports/ReportHistoryDrawer.tsx` (+ test) — Tabs + Scheduled Runs panel
- `pages/Reports.tsx` (+ test) — drawer wiring + role gating
- `i18n/en.ts`, `fr.ts`, `pt.ts`
- `package.json` (+ `@radix-ui/react-switch`, `@radix-ui/react-tabs`)

## Risks / notes

- **Radix Tabs in the Sheet portal:** the History drawer's Sheet portals into
  `document.body`; `Tabs` works inside it (a Radix component nests fine). Verify
  the Scheduled-Runs panel loads on tab activation (lazy fetch on first show).
- **`updateSchedule` body for enable-toggle:** send only `{ enabled }` (PATCH is
  partial) so toggling doesn't recompute the schedule's timing.
- **Param "All" sentinel:** reuse SP-1's `__all__` Select sentinel mapping to an
  omitted param, so a schedule with "facility: All" stores no `facility`.
- **dayOfWeek labels:** Monday=1…Saturday=6, Sunday=0 (JS `getUTCDay`), matching
  the SP-3a backend's `nextRunAt`.
- **i18n parity:** add the `reports.schedules.*` block to all three locales.
