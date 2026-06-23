# Workflow Builder — SP-4: Triggers + Run History (Design)

**Date:** 2026-06-23
**Status:** Design — awaiting user approval of the written spec
**Branch / worktree:** `feat/workflow-builder-sp1` (continues on top of the unmerged SP-1 work in the same isolated worktree, parallel to the marketplace workstream)
**Builds on:** SP-1 (`packages/workflows` engine + `WorkflowStore` + Fastify CRUD/SSE + `/workflows` page). SP-2 (Code node) and SP-3 (domain data nodes) are **not** prerequisites — triggers fire whatever nodes a workflow contains (today: SP-1's declarative set).

---

## 1. Background & goal

SP-1 shipped manually-run workflows. SP-4 makes workflows **run themselves**: on a **cron schedule**, in response to an inbound **webhook**, or when **new lab data is ingested**. Because background runs have no UI watching the live SSE stream, SP-4 also adds **run persistence + a history UI** so any run (manual or background) can be inspected after the fact.

The user confirmed: build all three triggers **and** run history in one cohesive slice.

### Confirmed decisions
| Decision | Choice |
| --- | --- |
| Slice scope | All three triggers (scheduled, webhook, on-ingest) **+** run-history persistence and UI, together. |
| Webhook auth | **Per-webhook generated secret token** (header `X-Webhook-Token` or `?token=`); reject otherwise. Not RBAC (the endpoint is external). |
| Schedule model | **Full cron expressions** + timezone, via a `cron-parser` dependency. |
| Run history | Persist the **full `WorkflowRunResult`** (status, trigger source, per-node status/output/logs) in a `workflow_runs` table; surface a **Run History drawer** on the workflow page (mirrors the reports `ReportHistoryDrawer`). |
| Architecture | **(A)** Derived registries synced on save: schedule nodes → `workflow_schedules` arming table; webhook nodes → in-memory path→{workflowId,secret} registry; ingest nodes → in-memory workflow-id set. All reconciled at startup. |
| Engine/runtime | In-process, durable event-bus outbox (no new infra). Mirrors `report-scheduler`. |

### Architecture rationale (rejected alternatives)
- **Scan-on-demand** (no derived tables; scheduler scans all workflow JSON each tick): inefficient, hard to dedup re-arming, doesn't fit the durable-outbox model. Rejected.
- **Triggers as first-class entities** (separate source-of-truth table, nodes merely reference): cleaner data model but breaks the "config lives in the node" UX and duplicates state. Over-engineered for now. Rejected.

---

## 2. Run persistence (the foundation everything records into)

- **Migration** `workflow_runs`: `id text pk`, `workflow_id text` (indexed), `trigger_source text` (`manual|schedule|webhook|ingest`), `status text` (`completed|failed`), `started_at timestamptz`, `finished_at timestamptz`, `result jsonb` (the full `WorkflowRunResult` from the engine), `error text`. Index on `(workflow_id, started_at desc)`.
- **`WorkflowRunStore`** in `packages/workflows` (Zod-validated, pg-mem tested): `record(run)`, `list(workflowId, { limit, offset })`, `get(runId)`.
- **Manual runs record too:** the SP-1 `POST /api/workflows/:id/execute-stream` route gains a `record(...)` on completion (trigger_source `manual`), so history is uniform across manual + background runs. The SSE stream to the live UI is unchanged; recording happens after the final frame.

## 3. Scheduled trigger (cron)

- New dependency **`cron-parser`** for computing the next run time from a cron string + timezone. The arming/runner mechanism is **identical to `report-scheduler`**; only the "compute next due" call swaps from `@openldr/reporting`'s `nextRunAt` to `cron-parser`.
- **Migration** `workflow_schedules` (a *derived registry*, not user-authored directly): `workflow_id`, `node_id`, `cron text`, `tz text`, `enabled boolean`, `next_due_at timestamptz`, primary key `(workflow_id, node_id)`. `WorkflowScheduleStore`: `upsert`, `removeForWorkflow`, `list({enabled?})`, `setNextDue`, `get`.
- **Runner** (`createWorkflowTriggerRunner`) subscribes to `workflow.schedule.due {workflowId,nodeId}`: load workflow → `runWorkflow` → `runStore.record(...)` → re-arm by computing `cron-parser.next()` and `eventing.publish({type:'workflow.schedule.due', payload:{workflowId,nodeId}}, {availableAt})`. Re-fetch the schedule after the run so a mid-run cadence change is honored (same defensive pattern as report-scheduler).
- **`reconcile(eventing)`** at startup: for each enabled schedule not already armed in the future, compute next due and publish. Mirrors report-scheduler's reconcile (incl. the "skip if `next_due_at` is still in the future" dedup that prevents compounding duplicate runs across restarts).

## 4. Webhook trigger (per-webhook secret)

- The standalone `webhook-registry` is ported and extended to store `{ workflowId, secret }` per normalized path. `syncWorkflowWebhooks(workflowId, nodes)` reads each webhook trigger node's `path` + `secret` from node data.
- **Fastify catch-all** `POST /api/workflows/hooks/*` (namespaced away from the CRUD routes): normalize the wildcard path → `registry.resolve()` → if unknown path return 404 → **validate the secret** (`X-Webhook-Token` header or `?token=`; mismatch → 401) → `runWorkflow` with `{ method, body, headers, query }` as `ctx.input` → `runStore.record(...)` (trigger_source `webhook`) → return a small run summary (`{ runId, status }`). Not RBAC-gated; the secret is the gate.
- The registry is in-memory; `reconcile` rebuilds it at startup from `store.list()`.

## 5. On-ingest trigger

- The runner also subscribes to **`ingest.batch.done`** (payload = batch info: source/converter/count). For each enabled workflow whose derived trigger set includes an ingest trigger, `runWorkflow` with the batch info as `ctx.input` → `runStore.record(...)` (trigger_source `ingest`).
- The set of ingest-triggered workflow ids is held in memory, synced on save and rebuilt at startup in `reconcile`. An optional per-node **source filter** (e.g. only WHONET batches) is matched against the event payload before running.

## 6. Trigger sync on save

`workflows-routes` POST/PUT/DELETE call one cohesive `syncWorkflowTriggers(ctx, workflow)`:
- schedule nodes → `scheduleStore.upsert(...)` (+ arm via publish) / `removeForWorkflow` for deleted nodes;
- webhook nodes → `webhookRegistry.clear(id)` then `register(path, {workflowId, secret})`;
- ingest nodes → add/remove the workflow id in the in-memory ingest set.

This is the single place node-data → registrations, so the registries never drift from the saved definition.

## 7. Web UI

- Add the trigger templates to `IMPLEMENTED_TEMPLATE_IDS` so they're draggable: `schedule`, `webhook` (trigger), and a new `ingest` trigger.
- **`schedule-form`** (already in the ported tree): cron + timezone — keep as-is.
- **`webhook-form`**: path + **generated secret** with a regenerate button + a live URL preview (`/api/workflows/hooks/<path>`). Secret persisted in node data; never blank on create.
- **New ingest trigger** node template + form: pick the event (`ingest.batch.done`) and an optional source filter.
- **Run History drawer** on the workflow page, mirroring `apps/web/src/reports/ReportHistoryDrawer`: lists runs (trigger source badge, status, timestamps, row/error summary), paginated; clicking a run opens its per-node results/logs (reusing the existing log/results views). New API client + routes: `GET /api/workflows/:id/runs`, `GET /api/workflows/runs/:runId`.

## 8. Bootstrap & startup wiring

- In `packages/bootstrap`: construct `WorkflowRunStore`, `WorkflowScheduleStore`, the webhook registry, and `workflowTriggerRunner`; widen `ctx.workflows` to `{ store, runs, schedules, webhooks, runner }`.
- In `apps/server/src/index.ts`, after the report scheduler block: `await ctx.workflows.runner.registerRunner(ingest.eventing)` then `await ctx.workflows.runner.reconcile(ingest.eventing)`, wrapped in the same try/catch-continue posture used for report-schedule reconcile.

## 9. Roles, testing, collision

- **Roles:** run-history + trigger-management routes gated `lab_admin`/`lab_manager`. The webhook `/hooks/*` route is **secret-gated, not RBAC** (external callers have no session).
- **Tests:** `WorkflowRunStore` + `WorkflowScheduleStore` (pg-mem); the runner with a fake `EventingPort` (schedule-due → runs + re-arms; `ingest.batch.done` → runs matching workflows + respects source filter; webhook token accept/reject); route tests (history list/detail; webhook 404 unknown path, 401 bad token, 200 + recorded run on good token). Full `turbo typecheck lint test build` + depcruise green.
- **Collision with marketplace:** still additive. Two new migrations (`workflow_runs`, `workflow_schedules`) — numbers chosen at implementation time, renumber on merge if the marketplace work claimed them (idempotent `ifNotExists`, mechanical). Other touch-points (`bootstrap/index.ts`, `apps/server/src/index.ts`, `apps/server/src/app.ts`, web page/api) are the same files already changed on this branch — appended to, not restructured.

## 10. Open questions / deferred
- Exact migration integers (resolve at implementation time).
- `cron-parser` timezone API specifics (verify exact option names against the installed version at implementation time).
- Webhook secret rotation UX beyond "regenerate" (deferred).
- Concurrency: if a schedule fires while a prior run of the same workflow is still in flight, SP-4 lets them overlap (runs are independent rows). A single-flight guard is deferred.
- Retention/pruning of `workflow_runs` (deferred; the history drawer is paginated).
