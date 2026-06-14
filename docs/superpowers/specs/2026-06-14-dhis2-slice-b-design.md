# DHIS2 Integration — Slice B (Tracker events + full sync model) — Design

**Status:** Approved (brainstorming) — ready for implementation plan
**Date:** 2026-06-14
**Builds on:** Slice A (aggregate push, merged — Phase-2 §7 step 3, P2-DHIS2). Reuses its `ReportingTargetPort`, `adapter-dhis2`, `@openldr/dhis2` engine, `dhis2_mappings` / `dhis2_orgunit_map`, `createDhis2Context`, and the `dhis2` CLI group.
**PRD coverage:** P2-DHIS2-2 (tracker mappings), P2-DHIS2-4 (both modes selectable), P2-DHIS2-5 (sync model: scheduled aggregate + event-driven tracker via the eventing port; dry-run), P2-DHIS2-6 (push auditing), P2-NFR-2 (idempotent, auditable). **Deferred:** P2-DHIS2-7 (authoring UI → a UI slice).

---

## Goal

Extend the DHIS2 integration with (1) a **tracker (event-program) push mode** sourced per-record from the external flat tables, and (2) a **full sync model** — scheduled push aligned to reporting periods (via self-rescheduling outbox events) plus optional event-driven tracker push on ingest. Aggregate and tracker share one adapter, one mapping store, one schedule mechanism, and one audit/dry-run shape.

## Settled decisions (from brainstorming)

- **Tracker depth:** event-program events only (`program` + `programStage` + `orgUnit` + `occurredAt` + `dataValues`). No tracked-entity instances / enrollments (deferred).
- **Tracker source:** the external/warehouse **flat tables**, one row per record, multi-driver (Postgres + SQL Server), no raw SQL — a new `EventSource` catalog parallel to the report catalog.
- **Schedule trigger:** **self-rescheduling outbox events** via the existing eventing port (no built-in cron).
- **Record scoping:** **period-windowing** — each push selects source rows whose event-date falls in the target period's range. Scheduled push = just-closed period; event-driven push = current period. No watermark table.
- **Idempotency:** deterministic DHIS2 event UIDs derived from the record key ⇒ re-push updates in place. Combined with key-based aggregate idempotency, the schedule is **at-least-once + idempotent** (not exactly-once).
- **Structure:** extend existing seams in place (Approach A) — additive port changes, reuse of Slice-A storage, scheduling orchestration in `bootstrap`.

---

## Architecture & package changes

| Package | Change |
|---|---|
| `@openldr/ports` | `ReportingTargetPort` gains `pushEvents(payload: unknown): Promise<PushResult>`. `TargetMetadata` gains `programs: {id,name}[]` + `programStages: {id,name,program}[]`. `EventingPort.publish(event, opts?: { availableAt?: Date })` — additive, backward-compatible delayed enqueue. |
| `@openldr/dhis2` (pure) | `TrackerMapping` type + discriminated `DhisMapping`; pure `buildEvents()`; `dhis2Uid(seed)`; period helpers (`period.ts`); `validateTrackerMapping()`. No DB/adapter imports (purity preserved). |
| `@openldr/reporting` | `EventSource` interface + `eventSourceCatalog()`/`getEventSource(id)` + built-in `amr-isolates`. Multi-driver, no raw SQL. Exposed via `ctx.reporting.runEventSource(id, window)`. |
| `@openldr/db` | Migration `009_dhis2_schedules` + `dhis2_schedules` table + `ScheduleStore`. Reuse `dhis2_mappings` (now `kind`-discriminated) + `dhis2_orgunit_map`. |
| `@openldr/adapter-dhis2` | `pushEvents()` → `POST /api/tracker`; `pullMetadata()` extended to fetch programs + programStages. |
| `@openldr/config` | Optional `DHIS2_SYNC_ENABLED` (default `true` when `REPORTING_TARGET_ADAPTER=dhis2`). |
| `@openldr/bootstrap` | `createDhis2Context` gains unified `runMapping`, `pushTracker`, `schedules`, and `registerSyncWorker(eventing)` + `reconcileSchedules()`. |
| `apps/server` | On boot: `registerSyncWorker` + `reconcileSchedules` (guarded by `DHIS2_SYNC_ENABLED`). |
| `@openldr/cli` | `dhis2 tracker push`; `dhis2 schedule add\|list\|remove\|run`; `validate`/`map import` dispatch by `kind`; extended `pull-metadata`/`status`. |

**Port reuse:** `PushResult` (`status`/`imported`/`updated`/`ignored`/`deleted`/`conflicts`) maps onto DHIS2 tracker `stats {created,updated,deleted,ignored}` + `validationReport.errorReports`. Aggregate and tracker share one result type.

**Mapping discrimination:** `dhis2_mappings.definition` jsonb gains a top-level `kind: 'aggregate' | 'tracker'` (absent ⇒ `'aggregate'`, back-compat with Slice-A rows). One `MappingStore`, dispatched by `kind` at load.

---

## Tracker mapping engine (`@openldr/dhis2`, pure)

```ts
type DhisMapping = AggregateMapping | TrackerMapping;   // discriminated by `kind`

interface TrackerMapping {
  kind: 'tracker';
  id: string; name: string;
  source: { kind: 'event-source'; sourceId: string; params?: Record<string, string> };
  program: string; programStage: string;
  orgUnitColumn: string;    // row col → facility key → orgUnit (via dhis2_orgunit_map)
  eventDateColumn: string;  // row col → event occurredAt (ISO date)
  idColumn: string;         // row col → stable record key for the deterministic event UID
  dataValues: { column: string; dataElement: string }[];
}

interface TrackerEvent {
  event: string;            // deterministic UID
  program: string; programStage: string; orgUnit: string;
  occurredAt: string;       // ISO date
  dataValues: { dataElement: string; value: string }[];
}
interface BuildEventsOutput { payload: { events: TrackerEvent[] }; skipped: SkipRecord[] }
```

`buildEvents(rows, mapping, orgUnitMap): BuildEventsOutput` — one event per row:
- resolve `orgUnit` from `orgUnitColumn` → skip (recorded) if unmapped;
- `occurredAt` from `eventDateColumn` → skip if empty;
- `event = dhis2Uid(`${mapping.id}:${row[idColumn]}`)` → deterministic ⇒ re-push updates in place;
- `dataValues` = non-empty mapped columns.
Rows are already period-windowed by the source, so `buildEvents` takes no `period` (events carry their own `occurredAt`).

`dhis2Uid(seed)` — DHIS2 UID format (11 chars, leading ASCII letter, then `[A-Za-z0-9]`). Deterministic: `sha256(seed)` → base62 → first 11 chars, first coerced to a letter. Pure; unit-tested for format + determinism.

`period.ts` (pure, clock injected): `PeriodType = 'monthly'|'quarterly'|'yearly'`; `periodRange(p) → {from,to}` (inclusive ISO dates; e.g. `2026Q1 → {2026-01-01, 2026-03-31}`); `currentPeriod(type, now)`; `previousPeriod(type, now)`; `nextPeriodBoundary(type, now)` (next due time). DHIS2 formats `YYYYMM` / `YYYYQn` / `YYYY`.

`validateTrackerMapping(mapping, metadata): string[]` — `program`, `programStage`, and each `dataElement` exist in pulled metadata (parallels `validateMapping`).

## Event sources (`@openldr/reporting`)

```ts
interface EventSource {
  id: string; name: string;
  run(db: Kysely<ExternalSchema>, window: { from: string; to: string }, params?: Record<string, string>): Promise<{ rows: Record<string, unknown>[] }>;
}
```
- `eventSourceCatalog()` + `getEventSource(id)`, parallel to the report catalog; no raw SQL; multi-driver.
- Built-in **`amr-isolates`**: one row per AST observation — columns `{ id, facility, eventDate, organism, antibiotic, result }`; joins observations → specimen/service-request + patient `managing_organization` for facility; windowed on `eventDate ∈ [from, to]`.
- Exposed as `ctx.reporting.runEventSource(id, window)`; injected into the dhis2 context as a `runEventSource` callback (mirroring Slice A's `runReport`), keeping `@openldr/dhis2` DB-free.

---

## Adapter tracker push (`adapter-dhis2`)

`pushEvents(payload)` → `POST /api/tracker?async=false&importStrategy=CREATE_AND_UPDATE`, body `{ events: [...] }`. Parse the DHIS2 2.40 tracker import report → `PushResult`: `status` from `body.status` (OK→success / WARNING→warning / ERROR→error), `imported=stats.created`, `updated=stats.updated`, `ignored`/`deleted` likewise, `conflicts=validationReport.errorReports[]`. **Reuses the Slice-A robustness fix**: parse the report even on HTTP 409; throw only when the body carries no usable report.

`pullMetadata()` extended: `/api/programs.json?fields=id,name&paging=false` + `/api/programStages.json?fields=id,name,program&paging=false` → `TargetMetadata.programs/programStages`.

## Storage — `dhis2_schedules` (migration `009_dhis2_schedules`)

```
id text pk | mapping_id text not null | mode text ('aggregate'|'tracker')
period_type text ('monthly'|'quarterly'|'yearly') | event_driven boolean default false
enabled boolean default true | last_run_at timestamptz null | next_due_at timestamptz null
created_at timestamptz default now() | updated_at timestamptz default now()
```
`ScheduleStore`: `create` / `list` / `get` / `remove` / `setNextDue` / `markRun` (SQL surface; verified by live acceptance, like the Slice-A stores).

## Sync orchestration (`bootstrap`)

Unified `runMapping({ mappingId, period, dryRun, runReport, runEventSource })` loads the mapping and **dispatches by `kind`**: aggregate → `runReport` + `buildDataValueSet` + `pushAggregate`; tracker → `runEventSource(sourceId, periodRange(period))` + `buildEvents` + `pushEvents`. Both share dry-run (no send, no audit) + best-effort audit (`dhis2.push` / `dhis2.tracker.push` / `*.failed`, DP-7). CLI `push` / `tracker push` are thin wrappers that error on a `kind` mismatch.

`registerSyncWorker(eventing)` (called by `apps/server` on boot when `DHIS2_SYNC_ENABLED`):
- `subscribe('dhis2.sync.due', { scheduleId })`: load schedule (skip, no re-enqueue, if disabled) → `period = previousPeriod(type, now)` → `runMapping(dryRun:false)` → `markRun` → **re-enqueue exactly one** `dhis2.sync.due` at `nextPeriodBoundary(...)` and `setNextDue`. A **push failure is audited but still re-enqueues the next period** (a transient DHIS2 outage skips one audited period rather than stalling the chain); the outbox's own retry is reserved for unexpected handler crashes.
- `subscribe('ingest.batch.done', ...)`: for each enabled `mode:'tracker', event_driven:true` schedule → `runMapping` for the **current** period (near-real-time push of freshly-ingested isolates), audited `source:'ingest-event'`.

`reconcileSchedules()` on boot: for each enabled schedule with `next_due_at` null or ≤ now, enqueue a due event. **Scheduling guarantee — at-least-once + idempotency:** deterministic UIDs + key-based aggregate make a duplicate fire harmless (re-push of the same period updates, no double-count, P2-NFR-2), so reconcile can self-heal a broken chain without exactly-once machinery.

Enabling a schedule (`schedule add`) seeds one due event at `nextPeriodBoundary` and sets `next_due_at`.

---

## CLI surface (`dhis2` group additions)

- `dhis2 tracker push <mappingId> --period <p> [--dry-run] [--json]`
- `dhis2 schedule add <mappingId> --mode <aggregate|tracker> --period-type <monthly|quarterly|yearly> [--event-driven] [--json]`
- `dhis2 schedule list [--json]` · `dhis2 schedule remove <scheduleId> [--json]` · `dhis2 schedule run <scheduleId> [--json]` (manual immediate run of the just-closed period)
- `dhis2 validate <mappingId>` + `dhis2 map import <file>` dispatch by `kind`; `pull-metadata` also reports program/stage counts; `status` also lists schedules + recent sync/tracker events.

All commands support `--json`.

## Config

Optional `DHIS2_SYNC_ENABLED` boolean (default `true` when `REPORTING_TARGET_ADAPTER=dhis2`) — an ops off-switch so `apps/server` can run without automated pushing even when schedules exist. The worker is otherwise inert when no enabled schedules exist.

## Error handling & idempotency

- Push failures: audited + best-effort, never crash (DP-7); the schedule re-enqueues the next period.
- Idempotency: deterministic event UIDs (tracker) + key-based (aggregate) ⇒ safe re-push (P2-NFR-2).
- Dry-run: sends nothing, writes no audit, previews `payload` + `skipped`.
- Unknown mapping/schedule, invalid period, or `kind` mismatch → clear error, exit 1.

## Testing

**Stack-free unit (vitest):** `buildEvents` (orgUnit/empty skips, deterministic UID, dataValues); `dhis2Uid` (format + determinism); period helpers (ranges + current/previous/next-boundary across month/quarter/**year boundaries**); `validateTrackerMapping`; adapter `pushEvents` parsing (success / warning / 409-with-report / error via stubbed fetch); **sync-handler decision logic** (re-enqueue on success, re-enqueue-after-failure, skip-disabled) with mocked eventing/store/push. The `amr-isolates` query + `ScheduleStore` are SQL surfaces verified by live acceptance. depcruise stays clean (only bootstrap imports the adapter; `@openldr/dhis2` stays pure). Full gates: `typecheck` / `test` / `depcruise` / `build:check`.

**Live acceptance (Dockerized DHIS2, SL demo has tracker programs):** pick an event program + stage + dataElements; tracker `--dry-run` → events preview; tracker push → `created>0`; re-push → `updated` (idempotent); `schedule add` (tracker, event-driven) → WHONET ingest → `ingest.batch.done` fires an event-driven push (audit `source:ingest-event`); `schedule run <id>` manual push; confirm the self-rescheduling due-event chain; aggregate path un-regressed.

## Carry-forwards (Slice B)

- Full tracker (tracked-entity instances + enrollments) deferred (a later slice).
- Mapping / orgUnit **authoring UI** (P2-DHIS2-7) deferred to a UI slice.
- Incremental watermark + bulk/load performance → P2-HARD.
- `amr-isolates` date reliability depends on the WHONET plugin stamping observation dates (existing reporting carry-forward); rows with no usable date fall outside the window.
- One event source in this slice (more domain sources later).
- Scheduling is **at-least-once + idempotent**, not exactly-once.

## Task decomposition (preview for the plan)

1. Port extensions (`pushEvents`, `TargetMetadata` programs/stages, `EventingPort.publish` `availableAt`).
2. `@openldr/dhis2`: period helpers + `dhis2Uid` (TDD).
3. `@openldr/dhis2`: `TrackerMapping` + `buildEvents` + `validateTrackerMapping` (TDD).
4. `@openldr/reporting`: `EventSource` + `amr-isolates` + `runEventSource` wiring.
5. Migration `009_dhis2_schedules` + `ScheduleStore`.
6. `adapter-dhis2`: `pushEvents` + metadata extension (TDD with stubbed fetch).
7. Config `DHIS2_SYNC_ENABLED`.
8. Bootstrap: unified `runMapping` + `pushTracker` + schedules + `registerSyncWorker`/`reconcileSchedules` (+ sync-handler unit tests).
9. `apps/server`: boot wiring (guarded).
10. CLI: `tracker push` + `schedule *` + kind-dispatch + extended `status`/`pull-metadata`.
11. Live acceptance (Dockerized DHIS2) + memory + finish.
