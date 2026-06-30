# Workflow Ingestion Loop — Slice 2 (Event Trigger) — Design

**Date:** 2026-06-30
**Status:** Approved (brainstorm) — ready for implementation planning
**Depends on:** Slice 1 (Persist Store emits `data.persisted`) — merged to local `main`.
**Topic:** A generic, builder-configurable **Event Trigger** that fires a workflow whenever a matching internal domain event occurs (pass one: `data.persisted`).

---

## 1. Problem

Slice 1's Persist Store node emits a `data.persisted` event (`{ source, resourceTypes, count }`) onto the Postgres `LISTEN/NOTIFY` event bus after every successful persist. Nothing consumes it yet. To close the ingestion loop (Slice 3), a workflow must be able to **start from that event** and keep listening indefinitely — the user's "notification source." This slice adds that trigger, both the backend and the builder UI.

### Established mechanism (verified)

The Event Trigger mirrors the existing **`ingest`** trigger almost exactly (`packages/workflows/src/trigger-runner.ts`):
- A closure-captured `Set<string>` of workflow ids that have the trigger (`ingestIds`, populated by `setIngestWorkflowIds`).
- A subscriber registered in `registerRunner` (`eventing.subscribe('ingest.batch.done', …)`) that iterates the id set, applies a per-node filter (`ingestNodeMatches` reads `config.sourceFilter`), and calls `runAndRecord(workflowId, source, payload)`.
- The id set is rebuilt at boot (`apps/server/src/index.ts`) and on every workflow create/update/delete (`apps/server/src/workflows-routes.ts` via `listIngestWorkflowIds`).
- Trigger nodes are `node.type === 'trigger'` with `node.data.triggerType` ∈ `TRIGGER_SOURCES`; the builder configures them with bespoke per-trigger forms (`WebhookForm`, `ScheduleForm`, `IngestForm`).

---

## 2. Approved decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Slice scope | **Backend + builder UI together** (no separate 2b). |
| 2 | Trigger model | A generic **`event`** trigger type; pass one wires only `data.persisted` (the event is a select, so more events slot in later). |
| 3 | Filter semantics | `source`: case-insensitive exact match, empty = all. `resourceType`: membership in the event payload's `resourceTypes[]`, empty = all. |
| 4 | Run input | The event payload `{ source, resourceTypes, count }` becomes the trigger item (a pointer; downstream queries the store). |
| 5 | Config UI | A bespoke `EventTriggerForm` (mirroring `IngestForm`) — triggers aren't descriptor-driven, so this does not use the Slice-1b declarative form. |
| 6 | Loop safety | **Document, don't guard** (pass one). An event-triggered workflow that itself persists would re-emit `data.persisted`; the intended outbound (push to an external sink) doesn't persist back, so no loop in practice. A real guard (origin/depth marker) is a future enhancement. |

---

## 3. Backend components (mirror the ingest path)

### 3.1 `packages/workflows/src/types.ts`
Add `'event'` to `TRIGGER_SOURCES`: `['manual', 'schedule', 'webhook', 'ingest', 'event']`.

### 3.2 `packages/workflows/src/trigger-runner.ts`
- Add `const DATA_PERSISTED = 'data.persisted';`.
- Add an `eventIds` closure set + `setEventWorkflowIds(ids: string[])` to both the `WorkflowTriggerRunner` interface and the implementation (exactly like `ingestIds` / `setIngestWorkflowIds`).
- Add `eventNodeMatches(workflowId, payload)`: load the workflow, find the node with `type === 'trigger' && data.triggerType === 'event'`, read `config.source` and `config.resourceType`, and return whether the payload matches (source case-insensitive exact or empty; resourceType in `payload.resourceTypes` or empty).
- In `registerRunner`, subscribe to `DATA_PERSISTED`: iterate `eventIds`, `continue` on non-match, else `runAndRecord(workflowId, 'event', event.payload)`, each wrapped in try/catch that logs and continues (mirroring the ingest subscriber).

### 3.3 `apps/server/src/index.ts` (boot)
After `registerRunner`, scan workflows for an `event` trigger and seed the set — next to the existing ingest scan:
`runner.setEventWorkflowIds((await store.list()).filter(w => JSON.stringify(w.definition).includes('"triggerType":"event"')).map(w => w.id))`.

### 3.4 `apps/server/src/workflows-routes.ts`
- Add `listEventWorkflowIds(ctx)` (parse each workflow's definition; keep those with an `event` trigger node) — mirroring `listIngestWorkflowIds`.
- Call `ctx.workflows.runner.setEventWorkflowIds(await listEventWorkflowIds(ctx))` after the existing `setIngestWorkflowIds` call in POST, PUT, and DELETE `/api/workflows`.

---

## 4. Builder UI

### 4.1 `apps/web/src/workflows/constants.ts`
Add an `event-trigger` palette template grouped with the other triggers:
`node('event-trigger', 'trigger', 'Event Trigger', 'Radio', 'Run when a domain event fires (e.g. data persisted)', { keywords: ['event','trigger','data.persisted','notify'], data: { triggerType: 'event', config: { event: 'data.persisted', source: '', resourceType: '' } } })`.
Add `'event-trigger'` to `IMPLEMENTED_TEMPLATE_IDS`.

### 4.2 `apps/web/src/workflows/components/node-forms/event-trigger-form.tsx`
A small bespoke form (mirroring `IngestForm`): a Label field; an **Event** `select` with one option (`data.persisted`, value `data.persisted`); a **Source filter** text input (`config.source`); a **Resource type filter** text input (`config.resourceType`). Reads/writes `node.data.config`. Register it in `node-forms/index.tsx` under `templateId: 'event-trigger'`.

---

## 5. Data flow

Inbound workflow persists → Persist Store emits `data.persisted { source, resourceTypes, count }` → event bus (`outbox_events` + `pg_notify`) → the `DATA_PERSISTED` subscriber wakes → for each indexed event-trigger workflow, `eventNodeMatches` checks `source`/`resourceType` filters → on match, `runAndRecord(wfId, 'event', payload)` → the event-triggered workflow runs with the payload as its trigger item.

---

## 6. Error handling

- Each workflow run in the subscriber loop is wrapped in try/catch (one failure doesn't block the others); errors are logged.
- The event bus delivers durably (outbox + retry/backoff); a failed run is recorded with status `failed` via `runAndRecord`.
- Empty/missing filters mean "match all" (never throws).

---

## 7. Testing

- **Unit (`packages/workflows`):** `eventNodeMatches` — source exact/case-insensitive/empty, resourceType membership/empty; the `data.persisted` subscriber fires `runAndRecord('event', payload)` only for matching indexed workflows (fake store + fake eventing).
- **Unit (`apps/server`):** `listEventWorkflowIds` selects only workflows with an `event` trigger node; the create/update/delete routes call `setEventWorkflowIds` (extend `workflows-routes.test.ts` fakes with a `setEventWorkflowIds` spy).
- **Web (`apps/web`, isolated):** `EventTriggerForm` renders the event select + source/resourceType fields and writes `data.config`; the palette includes Event Trigger as draggable.
- **North-star (seed demo):** seed the Slice-1 inbound workflow + a second workflow (Event Trigger → Log) filtered on `source = demo-lab`; run the inbound; assert a new run record appears for the second workflow (it auto-fired). Provides the "see it working" demo.

---

## 8. Out of scope (YAGNI / later)

- Event types beyond `data.persisted` (the generic select makes adding them trivial later).
- A loop/re-entrancy guard (documented constraint for now).
- Precisely targeting the just-persisted rows in an outbound query — that targeting problem is **Slice 3**'s central design question, not this slice's.
