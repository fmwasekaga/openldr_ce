# Payload Lifecycle / Activity view — design

**Date:** 2026-07-03
**Status:** Approved (brainstorm) → ready for implementation plan

## Problem

When a payload is POSTed to OpenLDR CE (a workflow webhook) the caller gets back a bare
`{ ok: true }`. There is no way to see a payload's **lifecycle** — whether it was
received, validated, persisted, and pushed downstream, or where it got stuck. OpenLDR v2
had a "pipeline runs" page that showed exactly this. CE has the underlying tracking but
never surfaces it as one coherent view.

## Current state (what already exists)

Tracking already happens in two subsystems, and — crucially — a correlation id already
flows between them:

- **The `batchId` correlation primitive.** `createPersistStoreService`
  (`packages/bootstrap/src/persist-store-service.ts`) generates a fresh `batchId` per
  persist ("a fresh per-run correlation id"), stamps it into every persisted row's
  provenance (`fhir_*` tables carry a `batch_id` column — see `packages/db/src/fhir-store.ts`
  and the flat tables in `export-data.ts`), and publishes it in the `data.persisted`
  event payload `{ source, batchId, resourceTypes, count }`.
- **The event bus already indexes it.** `packages/adapter-event-bus/src/index.ts` extracts
  `payload.batchId` into an `outbox_events.batch_id` column.
- **Workflow runs.** `workflow_runs` (`packages/db/src/run-store.ts`, migration
  `028_workflow_runs.ts`) records `{ id, workflowId, triggerSource, status, startedAt,
  finishedAt, result, error }`. `result` holds per-node status/detail. Surfaced only
  *inside* the Workflow Builder's run history, per workflow.
- **Ingest batches.** The v2-style batch lifecycle (`ctx.accept` → `batchId` → `ingest.received`
  → persist → `ingest.batch.done`) is tracked by the batch store (`createBatchStore`,
  `packages/bootstrap/src/ingest-context.ts`). CLI-only today (`openldr pipeline status|retry|logs`,
  `openldr queue status`); no web surface.
- **The trigger-runner** (`packages/workflows/src/trigger-runner.ts`) consumes
  `data.persisted` (with `batchId`) and fires reactive workflows via `runAndRecord`.

**The gap:** the `batchId` is not a queryable field on `workflow_runs`, so an originating
run (that persisted) and the reactive run it spawned (that pushed) cannot be joined; and
there is no read model or UI that assembles a single payload's timeline across runs,
batches, and events.

## Goals

- Reuse the existing `batchId` as a first-class **correlation id**.
- Assemble a single payload's lifecycle — `received → validated → persisted → pushed` —
  across ingest batches, workflow runs, and `data.persisted` events.
- A Studio **Activity** page: recent payloads, their current stage, where a stuck one
  stopped, and click-through to the underlying run/node detail.
- Return `runId` + `correlationId` from the webhook ack so callers can deep-link.

## Non-goals

- No new tracking of payloads that never persist (a pure-transform run has no
  correlation id and appears only in per-workflow run history — by design).
- No change to the ingest batch pipeline's own semantics; it is read, not rewritten.
- No real-time streaming/websockets; the page polls like the rest of the app.

## Approach (chosen: A — correlate via existing `batchId`, assemble at read time)

Rejected **B** (a materialized `lifecycle_events` table written at every stage): more
write plumbing, duplicates data already in runs/batches/events, and risks drift. **A**
leverages the correlation id that already flows and adds exactly one new persisted field.

### 1. Data-model change (the only new write)

Add `correlation_id text` (nullable, indexed) to `workflow_runs` via a new internal
migration, and to the `workflow_runs` type in `packages/db/src/schema/internal.ts` and
`WorkflowRun` in `packages/workflows/src/types.ts` + `run-store.ts` mapping.

Populate it in the single choke-point `runAndRecord` (`trigger-runner.ts`), which every
trigger path (webhook, ingest, event, schedule) funnels through:
- **Reactive / ingest runs:** the trigger `input` already contains `batchId` (from the
  `data.persisted` or `ingest.*` event) → use it.
- **Originating runs (webhook that persists):** after the run, read the Persist Store
  node's `meta.batchId` from the run result → use it.
- Otherwise `null`.

### 2. Read model — the lifecycle assembler

A pure function + a bootstrap service `getPayloadLifecycle(correlationId)` that gathers by
that id:
- ingest batch row (if any) from the batch store,
- all `workflow_runs` where `correlation_id = id`,
- the `data.persisted` event from `outbox_events` where `batch_id = id`,
- the persisted resource count/types (already in the event payload; optionally the
  `fhir_*` rows by `batch_id`).

It derives an ordered list of **stages**, each `{ stage, status, at, runId?, detail }`:

| Stage | Source of truth |
| --- | --- |
| `received` | earliest signal: ingest `ingest.received` / the originating run's `startedAt` (trigger = webhook or ingest) |
| `validated` | a Form Validate node succeeded in the originating run (from `result` node statuses); omitted if the workflow has no validate node |
| `persisted` | the `data.persisted` event (`at`, `count`, `resourceTypes`) |
| `pushed` | a sink/push node succeeded in a downstream reactive run correlated to this id; may occur 0..N times |

Overall status: `complete` (reached `persisted`, and `pushed` if any push run exists),
`stuck` (`received`/`validated` present, no `persisted`), or `failed` (a run in the chain
failed). A list model `listRecentPayloads({ limit, offset })` returns the most recent
correlation ids with their latest stage + overall status + source + timestamps, built from
`workflow_runs` (distinct `correlation_id`) unioned with ingest batches.

### 3. API

- `GET /api/activity` → recent payloads (id, source, startedAt, currentStage, status).
- `GET /api/activity/:correlationId` → full stage timeline + the linked run ids (for
  click-through to existing `/api/workflows/:id/runs/:runId` node detail).
- Role-gated consistent with audit/reports (lab_manager / administrator / data_analyst).

### 4. Webhook ack (folds in the earlier cheap win)

`POST /api/workflows/hooks/*` returns `{ ok: true, runId, correlationId }` instead of
`{ ok: true }`. `runAndRecord` must surface the created run id (+ correlation id) to the
route; today it returns `void`. Minimal signature change, or an out-param, decided in the
plan.

### 5. UI — Studio "Activity" page

New top-level nav entry (`AppShell.tsx` `NAV`), roles as above. A table of recent payloads
with a compact stage indicator (received → validated → persisted → pushed, highlighting
where a stuck payload stopped), source, time, and status badge. Row click opens a
lifecycle detail: the stage timeline with timestamps, and links into each contributing
workflow run's node detail. Edge-to-edge / shadcn conventions per the repo.

## Error / edge cases

- **No-persist runs:** `correlation_id = null`, excluded from Activity (correct).
- **Stuck payload:** `received`/`validated` but no `persisted` event → status `stuck`,
  indicator stops at the last reached stage.
- **Multiple pushes:** several reactive runs for one `batchId` → multiple `pushed` entries.
- **Ingest-only (CLI) payloads:** appear via the batch store even if no workflow ran.
- **Backfill:** existing runs have `correlation_id = null` (no retro-correlation); the view
  is forward-looking. Acceptable and noted.

## Testing

- Assembler unit tests: batch + runs + event fixtures → expected stage list, including
  `stuck`, `failed`, and multi-`pushed`.
- `runAndRecord` correlation-stamping tests (reactive-from-event vs originating-persist).
- Route tests for `/api/activity` and `/api/activity/:id` (+ role gating).
- Integration test: POST a webhook to a validate→persist workflow → assert the lifecycle
  shows received→validated→persisted and a reactive push run links in as `pushed`.
- Webhook-ack test: response includes `runId` + `correlationId`.

## Decomposition (for the plan)

- **S1 — Correlation field:** migration + schema/type + `run-store` mapping + `runAndRecord`
  stamping + tests.
- **S2 — Assembler + read model:** `getPayloadLifecycle` / `listRecentPayloads` (pure core +
  bootstrap wiring) + tests.
- **S3 — API + webhook ack:** `/api/activity` routes, webhook returns `runId`/`correlationId`,
  route tests.
- **S4 — Studio Activity page:** nav entry, list + detail, api client, i18n (en/fr/pt).
- **S5 — Verify:** integration test end-to-end; gate `--force`.

## Risks / open questions

- Deriving `validated`/`pushed` from node results depends on node `type`/`action`
  conventions (Form Validate; sink/push nodes). The plan pins the exact matchers.
- The exact ingest batch-store table/columns to union in the list model — confirmed in S2.
- `runAndRecord` returning the run id is a small ripple through its callers — enumerated in S3.
