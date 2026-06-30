# Workflow Ingestion Loop — Slice 3 (Close the Loop: batch-targeted push) — Design

**Date:** 2026-06-30
**Status:** Approved (brainstorm) — ready for implementation planning
**Depends on:** Slice 1 (Persist Store + `data.persisted`), Slice 2 (Event Trigger) — merged to local `main`.
**Topic:** Let an event-triggered workflow query **exactly** the rows a persist run produced, and push them onward (dhis2-sink) — closing the inbound→outbound loop.

---

## 1. Problem

The `data.persisted` event (Slice 1) carries `{ source, resourceTypes, count }` — enough to *trigger* an outbound workflow (Slice 2), but not enough to *target* the rows that were just persisted. Without a correlation key, an outbound query would have to guess (time windows, source-only), which races with concurrent persists and over/under-selects.

### Established facts (verified)

- **`batch_id` columns already exist** on `fhir_resources` (`packages/db/src/migrations/internal/001_fhir_resources.ts`) and on every flat table (`observations`, `patients`, … — `packages/db/src/migrations/external/001_flat_tables.ts`). The `Provenance` type (`packages/db/src/provenance.ts`) already has a `batchId` field, and `persistResources`/`fhirStore.save`/`flatWriter` already stamp all provenance columns.
- **Persist Store does NOT currently set `batchId`** (`packages/bootstrap/src/persist-store-service.ts` sets only `sourceSystem`), and the event payload omits it.
- **`sql-query` templates `{{ $json.x }}`** (`packages/workflows/src/engine/node-handlers/sql.ts` + `template.ts`) and runs over the target/flat tables — so `where batch_id = '{{ $json.batchId }}'` works today.
- **dhis2-sink consumes flat rows** (`{ json: <flat row> }`, columns = mapping `orgUnitColumn` + `columns[].column`), not FHIR — confirmed by `packages/plugins/src/dhis2-wf-push.integration.test.ts` and the live north-star `apps/server/src/dhis2-live.acceptance.test.ts`. Its config is `{ mapping, orgUnitMap, period, dryRun }`.
- The Event Trigger, `sql-query`, and `dhis2-sink` nodes **already exist** — the loop is composition, not new nodes.

---

## 2. Approved decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Row targeting | **Batch id correlation.** Persist Store stamps a per-run `batchId` into provenance and the event; the outbound query filters `where batch_id = '…'`. (Rejected: time-window+source — races; fat-event — bloat/coupling.) |
| 2 | New nodes/UI | **None.** The outbound workflow composes existing nodes (Event Trigger → sql-query → [reshape] → dhis2-sink). |
| 3 | Demo endpoint | End at a **Log** showing the batch-targeted rows; **also** end at `dhis2-sink` with `dryRun: true` + a minimal aggregate mapping **if** the dhis2-sink plugin is installed in the dev env (shows the built DHIS2 dataValues without a live server). |
| 4 | Loop-safety guard | Still deferred (documented in Slice 2). |

---

## 3. Code change — Persist Store (only)

`packages/bootstrap/src/persist-store-service.ts`:
- Add a `newId: () => string` dependency to `PersistStoreServiceDeps` (bootstrap wires `() => randomUUID()`; injecting it makes the unit test deterministic).
- In the returned function: `const batchId = deps.newId();`
- Provenance: `const provenance: Provenance = source ? { batchId, sourceSystem: source } : { batchId };`
- Event payload: publish `{ type: 'data.persisted', payload: { source: source ?? null, batchId, resourceTypes: [...resourceTypes], count: persisted } }`.
- Return `meta` gains `batchId`: `{ persisted, batchId, flattened, resourceTypes }`.

`packages/workflows/src/engine/services.ts`: add `batchId: string` to `RunPersistStoreOutput['meta']`.

`packages/bootstrap/src/index.ts`: pass `newId: () => randomUUID()` into `createPersistStoreService({ … })` (import `randomUUID` from `node:crypto` if not already imported).

Net effect: every `fhir_resources` row and flat-table row from a persist run carries `batch_id = <batchId>`; the `data.persisted` event and the Persist Store node's Output-tab `meta` both expose it.

---

## 4. The outbound workflow (existing nodes, composed)

**Event Trigger** (filter `source`/`resourceType` from Slice 2) → **sql-query** with
`select * from observations where batch_id = '{{ $json.batchId }}'`
→ optional **Set/Code** reshape into the mapping's expected row shape → **dhis2-sink** (`{ mapping, orgUnitMap, period, dryRun }`).

The Event Trigger run receives the full event payload `{ source, batchId, resourceTypes, count }` as its input item, so `{{ $json.batchId }}` resolves to the just-persisted run's batch. No new code — this is what a user wires in the builder.

---

## 5. Data flow

Inbound persists (provenance `batchId=B`) → every row stamped `batch_id=B` → `data.persisted { …, batchId: B }` → Event Trigger fires the outbound run with input `{ …, batchId: B }` → sql-query resolves `where batch_id = 'B'` → returns exactly that run's rows → [reshape] → dhis2-sink builds dataValues (dryRun shows them; live pushes them).

---

## 6. Error handling

- **No matched rows** → empty result set → downstream no-ops (no push). Harmless.
- **`dryRun: true`** → dhis2-sink skips HTTP egress and returns the built dataValues in `meta`.
- **Live push** inherits the existing plugin egress + retry/connector path.
- The batch id is a server-generated UUID, so the templated SQL filter value is safe.

---

## 7. Testing

- **Unit (`persist-store-service.test.ts`):** with an injected `newId: () => 'batch-1'`, assert `persist()` was called with provenance containing `batchId: 'batch-1'`, the `data.persisted` payload contains `batchId: 'batch-1'`, and `meta.batchId === 'batch-1'`. Keep the existing assertions (counts, flattened, no-publish-on-zero).
- **Integration / demo (controller, post-merge):** extend `scripts/seed-form-ingestion-demo.ts` with an outbound **"Demo: On Persist → Push"** workflow (Event Trigger `source=demo-lab` → sql-query `where batch_id = '{{ $json.batchId }}'` → Log; append a `dhis2-sink` dryRun node only if the plugin is installed). A `verify` script: run inbound → `ctx.eventing.drain()` → assert the outbound run executed and its sql-query node output contains only rows with the run's batch id.

---

## 8. Out of scope (YAGNI)

- No new node types or builder UI (the loop composes existing nodes).
- Building arbitrary FHIR→DHIS2 mappings (existing `dhis2-mapping` capability).
- Live DHIS2 push as part of this slice's gate (the existing `dhis2:accept` north-star covers live egress).
- The loop-safety/re-entrancy guard (documented constraint from Slice 2).
