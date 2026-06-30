# Workflow Ingestion Loop — Design

**Date:** 2026-06-30
**Status:** Approved (brainstorm) — ready for implementation planning
**Topic:** A closed, node-based ingestion loop that recreates OpenLDR v2's "form-bound feed" behavior inside the Workflow Builder.

---

## 1. Problem

In OpenLDR v2, ingestion had a clear beginning: a **plugin** shaped incoming data, a **data feed** (bound to a use case → project) was the entry point, and a **form** tied to that feed id told the incoming data what shape to be — the form was simultaneously the *shape contract*, the *validator*, and the *persistence target*.

OpenLDR CE replaced that linear chain with flexible node-based **workflows**, but decoupled those three jobs:

- **Triggers** (manual, webhook, schedule, ingest) begin pipelines.
- **Plugin nodes** shape data.
- **Sinks** persist data.

Nothing currently plays the v2 "form" role, so it is unclear where ingestion "begins" and how incoming data gets validated/shaped against a known contract before it flows downstream. This design fills that gap **and** closes the loop so that persisted data can drive downstream pushes (e.g. DHIS2) automatically.

### Key facts established during brainstorming

- **CE forms are definition-only.** `POST /api/forms/:id/responses` validates answers against the form, converts to a FHIR `QuestionnaireResponse`, extracts `Observation`/`ServiceRequest`, and audits — but there is **no submissions table**. The form is a *shape + validation contract*, not a save target. (`packages/forms/src/`, `apps/server/src/forms-routes.ts`)
- **A persistence target already exists.** `persistResources()` double-writes to the canonical `fhir_resources` table (internal DB) and the flattened analytics tables (`patients`, `observations`, … in the target DB). (`packages/db/src/persist.ts`, `fhir-store.ts`, `flat-writer.ts`)
- **The async backbone already exists.** A Postgres `LISTEN/NOTIFY` event bus with an `outbox_events` table drives `schedule`/`webhook`/`ingest` triggers that fire **without** pressing Run. New event-driven triggers subscribe to this bus exactly like the existing schedule/ingest subscribers. (`packages/adapter-event-bus/src/index.ts`, `packages/workflows/src/trigger-runner.ts`)
- **Format converters and DHIS2 push already exist as plugins.** whonet/hl7/tabular `wf_convert` nodes and the `dhis2-sink` `wf_push` node are reused unchanged.

---

## 2. Approved decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Does the framing capture the gap? | **Yes** — forms validate+shape but don't persist; triggers begin pipelines. |
| 2 | Anchor scenario | **C — full chained loop**: inbound save → emitted event → outbound push. |
| 3 | Implementation seam for the new pieces | **A — host extensions.** Form-Validate and Event Trigger need DB / forms-package / event-bus access the wasm sandbox denies, so they are **built-in host pieces**. Plugins stay for format conversion + external egress. |
| 4 | Where the inbound half lives | **A — all in the Workflow Builder.** Trigger → Convert → Form-Validate → Persist Store as nodes; the form is chosen in the Form-Validate node's config. (A bound-feed convenience may be added later via the same shared function.) |
| 5 | Event granularity | **C framing + A implementation.** Design a **generic Event Trigger** ("listen for a domain event + filter"); in pass one the only event wired is `data.persisted`. |
| 6 | Naming | Host pieces: **"Form Validate"**, **"Persist Store"**, **"Event Trigger"**. Drop the `openldr-sink`/`openldr-notification` plugin names. |
| 7 | n8n-style "Execute Workflow" / sub-workflows | **Deferred to its own spec.** The async fan-out half of reusability is already delivered by the Event Trigger; synchronous call-and-return composition is an orthogonal capability. |

---

## 3. Architecture

```
INBOUND workflow:   Trigger ──▶ Convert ──▶ Form-Validate ──▶ Persist Store ──┐
                    (webhook/   (whonet/    (form contract,   (fhir_resources  │ emits
                     upload)     hl7/csv)    QR + extract)      + flat tables)  │ "data.persisted"
                                                                                │
OUTBOUND workflow:  Event Trigger ──▶ Query new rows ──▶ dhis2-sink ◀───────────┘
                    (data.persisted   (sql-query /       (wf_push)
                     + filters)        fhir-query)
```

Two workflows joined by one domain event. The outbound workflow listens forever; the external push never writes back to the store, so there is **no cycle**.

### Color of each node

- **Host (built-in):** Trigger, **Form-Validate (NEW)**, **Persist Store (NEW)**, **Event Trigger (NEW)**, Query (`sql-query`/`fhir-query`).
- **Plugin (sandboxed wasm):** Convert (whonet/hl7/tabular), dhis2-sink.

---

## 4. New components

### 4.1 Form-Validate node (built-in, `transform`)

- **Purpose:** Validate/shape incoming items against a chosen form definition — the v2 "form tells the data what shape to be" property, relocated into a node.
- **Config:**
  - `formId` — `select`, populated by a **new `forms` options-resolver** (lists published forms, mirroring the existing `connectors`/`datasets` resolvers in `apps/server/src/workflows-node-options.ts`).
  - `mode` (optional) — `validate-only` vs `validate+extract` (default `validate+extract`).
- **Logic:** For each input item, treat `item.json` as the answer map. Run `toQuestionnaireResponse(formSchema, answers)` from `@openldr/forms/pure` (validation against the form's fields, cardinality, constraints). On success, output a `QuestionnaireResponse` item plus extracted `Observation`/`ServiceRequest` items (reusing the existing extractors / `questionnaire-response` converter logic).
- **Error handling:** Invalid items do **not** crash the run. They are collected into the node's `meta` with per-item reasons and surfaced in the Output tab; valid items flow downstream.
- **Reuses:** `@openldr/forms/pure` (`toQuestionnaireResponse`, extractors), the form store for loading definitions.

### 4.2 Persist Store node (built-in, `sink`)

- **Purpose:** Persist FHIR resource items to the canonical + flattened stores, and announce the persistence as a domain event.
- **Config:** `source` (a source-system label for provenance; optional, defaults from workflow/trigger).
- **Logic:** Pass input FHIR resource items to the existing `persistResources()` (canonical `fhir_resources` must succeed; flat write may degrade). On success, **publish a `data.persisted` event** to the event bus.
- **Emitted event:** `data.persisted` with payload `{ source, resourceTypes: string[], count: number, batchId?: string }`. Emitting from the node (rather than only from the ingest pipeline) is what closes the loop for the all-in-builder inbound path. The existing `ingest.batch.done` event may later be mapped onto the same Event Trigger abstraction.
- **Reuses:** `persistResources()`, `fhirStore`, `flatWriter`, the event bus publish path.

### 4.3 Event Trigger (new trigger type `event`)

- **Purpose:** The "notification source." Start a workflow run whenever a matching domain event occurs, and keep listening indefinitely.
- **Wiring:** Add `event` to `TRIGGER_SOURCES`. Add a subscriber in `trigger-runner` (mirroring the existing `workflow.schedule.due` / `ingest.batch.done` subscribers) that, on a matching event, calls `runAndRecord(workflowId, 'event', payload)`.
- **Config (generic by design):**
  - `event` — `select`. Pass one offers exactly one option: **`data.persisted`**.
  - `source` — optional filter (e.g. `amr-whonet`).
  - `resourceType` — optional filter (e.g. `Observation`).
- **Run input:** A single **pointer** item describing what changed (`{ source, resourceTypes, count, batchId? }`) — *not* the data. Downstream nodes query the store for the new rows. This keeps events small and lets the outbound workflow shape freely.
- **Reuses:** the event bus subscription pattern, `runAndRecord`, the trigger-node UI/config plumbing, the durable outbox/retry semantics.

---

## 5. Reused as-is

Webhook/upload triggers · convert plugins (whonet/hl7/tabular) · `persistResources` + `fhir_resources` + flat tables · `sql-query`/`fhir-query` nodes for "query new rows" · **dhis2-sink** plugin (`wf_push`) · the `pg_notify` event bus + outbox/retry · the node-options resolver framework · run-history / Output tab.

---

## 6. Build sequence — three runnable slices

Sequenced so a working result is visible as early as possible (the user explicitly values seeing it run).

1. **Inbound** — Form-Validate node + Persist Store node + `forms` resolver.
   *Demo:* upload WHONET → convert → form-validate → persist; rows appear in `fhir_resources` + flat tables; invalid rows show in the Output tab. **Working result here already.**
2. **Event** — Persist Store emits `data.persisted`; add the `event` trigger type + subscriber + builder config.
   *Demo:* a second workflow's Event Trigger fires automatically when slice 1 persists.
3. **Close the loop** — Event Trigger → query new rows → dhis2-sink.
   *Demo:* full C loop end-to-end, mirroring the existing whonet→dhis2 e2e, extended through form-validate + the event hop.

---

## 7. Error handling & safety

- **Validation failures** collect into node meta (run continues); valid items proceed.
- **Persist** keeps the existing rule: canonical (`fhir_resources`) write must succeed; flattened write may degrade without failing the run.
- **Event Trigger** inherits the event bus's durable retry/outbox semantics.
- **Loop safety:** the external DHIS2 push never writes back to the store, so the event cannot re-trigger itself.

---

## 8. Testing

- **Unit:** Form-Validate (valid vs invalid answers against a form schema; meta collection) · Persist Store (calls `persistResources`, emits `data.persisted`) · Event Trigger subscriber (matching event fires `runAndRecord`, filters honored).
- **Integration:** the existing seed-workflow-and-run pattern, asserting rows in the stores and a run recorded.
- **North-star e2e:** mirror the current whonet→dhis2 acceptance test, extended through Form-Validate + the `data.persisted` event hop, asserting the outbound workflow auto-runs and pushes.

---

## 9. Out of scope (future specs)

- **Workflow composition / sub-workflows** — n8n's "Execute Workflow" node (synchronous call-and-return). Tracked as Spec 2; brainstormed separately.
- **Bound-feed convenience** — exposing the shared Form-Validate function as a v2-style ingest-endpoint-bound-to-a-form (Approach 2 from the topology discussion). Optional follow-on; not required for the loop.
- **Finer-grained persist events** (per-resource beyond `data.persisted`) — the Event Trigger is generic, so additional event types slot in without redesign.
