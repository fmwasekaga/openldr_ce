# DHIS2 Admin UI — SP-D: Operations (dry-run, push, history, schedules) Design

**Date:** 2026-06-22
**Status:** Approved (brainstorming) — ready for implementation planning
**Depends on:** SP-A (DHIS2 routes module + Settings page + `Dhis2RouteDeps` + `buildApp(ctx, dhis2)` wiring), SP-B (metadata cache, `ctx.internalDb`), SP-C1/C2 (mappings + the mappings list page). This is the **final** DHIS2 Admin UI sub-project.

## Background

SP-A–C delivered status, orgUnit mapping, metadata cache, and mapping authoring. SP-D adds **operations** on existing mappings.

Relevant backend (`packages/bootstrap/src/dhis2-context.ts`, `packages/db/src/dhis2-schedule-store.ts`):
- `Dhis2Context.runMapping({ mappingId, period, dryRun, trigger? } & RunCallbacks): Promise<RunOutcome>` where `RunCallbacks = { runReport(id, params?): Promise<{rows}>; runEventSource(id, window): Promise<{rows}> }`. `RunOutcome` is `AggregateOutcome { kind:'aggregate'; dryRun; build: { payload: { dataValues[] }; skipped: {row,reason}[] }; result?: PushResult }` or `TrackerOutcome { kind:'tracker'; dryRun; build: { payload: { events[] }; skipped[] }; result? }`. Dry-run returns `build` only; push returns `build` + `result` and the context audits internally (`dhis2.push`/`dhis2.tracker.push`(`.failed`), `entityType:'dhis2-mapping'`).
- `PushResult = { status: 'success'|'warning'|'error'; imported; updated; ignored; deleted; conflicts: {object,value}[]; raw }`.
- `recentPushes(n)` reads `audit.list({ entityType:'dhis2-mapping', limit })`.
- `ScheduleStore` (`createScheduleStore(db)`): `create(NewSchedule)`, `get`, `list(): ScheduleRecord[]`, `remove`, `setNextDue`, `markRun`. **No `setEnabled`.** `ScheduleRecord = { id; mappingId; mode:'aggregate'|'tracker'; periodType:'monthly'|'quarterly'|'yearly'; eventDriven; enabled; lastRunAt; nextDueAt }`. `NewSchedule = { id; mappingId; mode; periodType; eventDriven }` (DB defaults `enabled=true`).
- `reconcileSchedules(eventing)` arms enabled schedules: sets `nextDue = nextPeriodBoundary(...)` and publishes a `dhis2.sync.due` event (`availableAt: due`). Runs at startup in `index.ts` only when `DHIS2_SYNC_ENABLED`. `registerSync(eventing, cb)` subscribes the firing handler (also gated on `DHIS2_SYNC_ENABLED`).
- `index.ts` order: `ctx` → `ingest` → `dhis2` context (when adapter=dhis2) → `buildApp(ctx, dhis2)` → `registerSync`/`reconcileSchedules` (when sync enabled).

## Goal

Let an operator: dry-run a mapping for a period and preview the built payload; push it to DHIS2; see push history; and create/enable/disable/delete recurring schedules that fire live (without a restart) when sync is enabled.

## Decisions (locked during brainstorming)

1. **Live schedule arming** — thread the eventing port into the DHIS2 routes; schedule create/enable calls `dhis2.reconcileSchedules(eventing)` so a UI-created schedule fires going forward (still requires `DHIS2_SYNC_ENABLED` + `dhis2 != null`).
2. **Push history from local audit** — `GET /api/dhis2/pushes` reads `ctx.audit.list({entityType:'dhis2-mapping'})`, so historical pushes show even when DHIS2 is currently unconfigured.
3. **Run period = free-text** with a format hint (mappings don't carry a periodType): monthly `202601`, quarterly `2026Q1`, yearly `2026`.
4. **Schedule mode derived from the mapping's kind** (aggregate/tracker) on create.
5. Role gate `lab_admin` everywhere.

## Architecture

### 1. Backend

**Store** (`packages/db/src/dhis2-schedule-store.ts`): add to `ScheduleStore`:
```ts
setEnabled(id: string, enabled: boolean): Promise<void>;
```
(`update dhis2_schedules set enabled = ? where id = ?`.)

**Eventing into routes:**
- `buildApp(ctx: AppContext, dhis2: Dhis2Context | null = null, eventing: EventingPort | null = null)` — `index.ts` calls `buildApp(ctx, dhis2, ingest.eventing)`. `EventingPort` from `@openldr/ports`.
- `registerDhis2Routes(app, ctx, dhis2, deps, eventing)` — gains the 5th `eventing` param. `deps` gains `scheduleStore: createScheduleStore(ctx.internalDb)`.
- A helper inside the registrar:
  ```ts
  async function armSchedules() {
    if (dhis2 && eventing) { try { await dhis2.reconcileSchedules(eventing); } catch { /* arming is best-effort */ } }
  }
  ```
  called after schedule create + enable. (No-op when not configured / no eventing — the row still persists and arms at next startup.)

**Routes** (all `requireRole('lab_admin')`):

`POST /api/dhis2/mappings/:id/run` — body `{ period: string (min 1), dryRun: boolean }` (zod).
- `409` if `dhis2 === null`.
- `outcome = await dhis2.runMapping({ mappingId: id, period, dryRun, trigger: 'manual', runReport: (rid, p) => ctx.reporting.run(rid, p ?? {}).then((r) => ({ rows: r.rows })), runEventSource: (sid, w) => ctx.reporting.runEventSource(sid, w) })`.
- Return a trimmed shape: `{ kind, dryRun, counts: { values: payload.dataValues?.length ?? payload.events?.length ?? 0, skipped: build.skipped.length }, skipped: build.skipped, result: outcome.result ?? null }`. (Don't dump the full payload; counts + skipped reasons + the push result.)
- Errors: `runMapping` throws on unknown mapping (`OpenLdrError`) → `400`; push transport failures are caught inside `runMapping` (it audits `.failed` and rethrows) → `502 redact(...)`. Wrap in try/catch: not-configured/unknown → appropriate code; otherwise `502`.

`GET /api/dhis2/pushes?limit=N` (default 20, clamp ≤100) → `ctx.audit.list({ entityType: 'dhis2-mapping', limit })` → the audit events (id, occurredAt, action, entityId, metadata). Works `dhis2`-null.

`GET /api/dhis2/schedules` → compose `deps.scheduleStore.list()` with mapping names from `deps.mappingStore.list()` → `[{ id, mappingId, mappingName, mode, periodType, eventDriven, enabled, lastRunAt, nextDueAt }]`.

`POST /api/dhis2/schedules` — body `{ mappingId: string, periodType: 'monthly'|'quarterly'|'yearly', eventDriven: boolean }` (zod). Derive `mode` from the mapping (`deps.mappingStore.get(mappingId)` → `definition.kind` === 'tracker' ? 'tracker' : 'aggregate'); `404` if the mapping is unknown. `create({ id: 'sched-'+uuid, mappingId, mode, periodType, eventDriven })`; `await armSchedules()`; audit `dhis2.schedule.create`; return the created record.

`POST /api/dhis2/schedules/:id/enabled` — body `{ enabled: boolean }`. `setEnabled(id, enabled)`; if `enabled` → `await armSchedules()`; audit `dhis2.schedule.update` (metadata `{enabled}`); return `{ ok: true }`.

`DELETE /api/dhis2/schedules/:id` → `remove(id)`; audit `dhis2.schedule.delete`; `204`.

### 2. Web

**API client** (`apps/web/src/api.ts`):
- `Dhis2RunResult = { kind:'aggregate'|'tracker'; dryRun: boolean; counts: { values: number; skipped: number }; skipped: { row: number; reason: string }[]; result: PushResultClient | null }`; `PushResultClient = { status:string; imported:number; updated:number; ignored:number; deleted:number; conflicts:{object:string;value:string}[] }`.
- `Dhis2Push = { id; occurredAt; action; entityId; metadata?: Record<string,unknown> }` (reuse SP-A's `Dhis2RecentPush` shape).
- `Dhis2Schedule = { id; mappingId; mappingName; mode; periodType; eventDriven; enabled; lastRunAt: string|null; nextDueAt: string|null }`.
- `runDhis2Mapping(id, { period, dryRun })`; `listDhis2Pushes(limit?)`; `listDhis2Schedules()`; `createDhis2Schedule({mappingId, periodType, eventDriven})`; `setDhis2ScheduleEnabled(id, enabled)`; `deleteDhis2Schedule(id)`.

**Run dialog** (`apps/web/src/pages/dhis2/RunMappingDialog.tsx` or inline in the mappings page): triggered by a "Run" row action on the SP-C1 `Dhis2Mappings` list. Fields: a period `Input` (placeholder/hint per format), a **Dry run** button → renders `counts.values`/`counts.skipped` + a skipped-rows list (row + reason), and a **Push** button → renders the `PushResult` (status badge + imported/updated/ignored/conflicts). Inline error banner; both buttons disabled with a hint when DHIS2 is not configured (read from the SP-A `getDhis2Status()` `configured` flag, or a 409 surfaced as a message).

**Schedules page** (`apps/web/src/pages/Dhis2Schedules.tsx`) at `/dhis2/schedules` (guarded `lab_admin`), reached via a "Manage →" link on the Settings Overview "Schedules: N": a table (mapping name, periodType, event-driven, enabled, last run, next due) with enable/disable (toggle → `setDhis2ScheduleEnabled`) and delete (confirm dialog). A "New schedule" control: pick a mapping (from `listDhis2Mappings()`), periodType, event-driven → `createDhis2Schedule`. A muted note: "Schedules run only when the server has DHIS2_SYNC_ENABLED."

**Push history** (`apps/web/src/pages/Dhis2Pushes.tsx`) at `/dhis2/pushes` (guarded): a table from `listDhis2Pushes()` — time, action, mapping (entityId), and key metadata (period/status/imported from `metadata`). Reached via the Settings "recent pushes" area (a "View all →" link) — the SP-A Overview already shows the latest few.

**i18n:** `dhis2.ops.*` (run + schedules + pushes).

### 3. Data Flow

1. Mappings list → "Run" → dialog. Dry run → `runDhis2Mapping(id,{period,dryRun:true})` → preview counts/skipped. Push → `dryRun:false` → `PushResult` (audited server-side).
2. Schedules page → create/enable/disable/delete; create/enable arm the schedule live (when configured + sync on).
3. Pushes page / Settings → `listDhis2Pushes` history.

## Error Handling

- **DHIS2 not configured:** run → `409` (dialog shows a "configure DHIS2 first" message; buttons disabled); schedules CRUD still works (rows persist; arming is a no-op until configured + restart); pushes history still lists.
- **Push transport failure:** `502 redact(...)`; the dialog shows the error; the failure is audited (`dhis2.push.failed`) and appears in history.
- **Unknown mapping** on run/schedule-create: `400`/`404`.
- **Invalid body:** `400` (zod).
- **No role:** `403`; web routes redirect via `RequireRole`.
- Arming is best-effort (wrapped) — a reconcile failure never fails the schedule mutation.

## Testing

- **DB — `dhis2-schedule-store.test.ts`** (new or extend): `create` then `setEnabled(false)` flips `enabled`; `list`/`remove` behave.
- **Server — `dhis2-routes.test.ts`** (extend; `fakeDeps` gains `scheduleStore`; `appWith` passes a fake `eventing`; `fakeDhis2` gains `runMapping`/`reconcileSchedules`):
  - run: dry-run returns counts/skipped (fake `runMapping` returning a build); push returns `result`; `409` when `dhis2` null; `400` on bad body.
  - pushes: returns audit events from a fake `ctx.audit.list`; clamps limit.
  - schedules: list (joined with mapping names); create derives mode from the mapping + calls reconcile (assert the fake eventing/reconcile was invoked) + audits + `404` unknown mapping; enabled toggle calls setEnabled + (on enable) reconcile + audits; delete `204` + audits; `403`s.
- **Web:**
  - Run dialog: dry-run shows counts; push shows the result (mock api).
  - `Dhis2Schedules.test.tsx`: lists schedules; create calls `createDhis2Schedule`; toggle calls `setDhis2ScheduleEnabled`; delete behind confirm.
  - `Dhis2Pushes.test.tsx`: renders history rows.
- **Gate:** `pnpm turbo typecheck lint test build` + `pnpm depcruise`.

## Out of Scope (later / not planned)

- Editable `source.params`; advanced retry/dead-letter/backoff UI; per-schedule "run now" beyond the manual run dialog; live acceptance against a real DHIS2 instance (tests use injected fakes).
