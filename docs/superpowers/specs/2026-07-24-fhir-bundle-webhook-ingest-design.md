# FHIR Bundle ingestion through the webhook (design)

**Date:** 2026-07-24
**Repo:** `openldr_ce` (the new node + seed change). Producer-side change (cdr-toolchain emits a
Bundle) is a small section at the end; it lives in the `cdr-toolchain` repo.

## Problem

CE ingests pre-built FHIR today by POSTing a **bare JSON array** of resources to a workflow
webhook (`webhook → split-out(body) → persist-store`). That works, but a bare array is **not
FHIR-standard transport**. The standard way to submit multiple related resources in one request is
a **`transaction` Bundle**. CE has a `Bundle` *schema* (`packages/fhir/src/resources/bundle.ts`)
but **no Bundle *processor*** — a Bundle POSTed to the webhook 200s and persists nothing, because
`split-out` can only explode an array, not a Bundle.

We want the existing webhook to **accept a FHIR Bundle**, unwrap it, resolve its references, and
persist its contents through the machinery that already works — making CE ingestion FHIR-standard
while staying on the workflow-engine path the operator already knows.

## Approach

Add one new workflow node, **`unwrap-bundle`**, that turns a Bundle (or a bare array) into the flat
list of FHIR resources the existing `persist-store` node already consumes. All validation and
persistence are unchanged — the only new logic is **unwrap + reference resolution**.

Decision (from brainstorming): the webhook accepts the Bundle (not a separate `POST /fhir`
endpoint); the node supports **both** real-id and `urn:uuid` reference styles; transaction and
batch types are both processed atomically in v1.

### Why no manual ordering is needed

The obvious worry — "a lab result can't be saved without its ServiceRequest, so save requests
first" — does **not** require ordering here, because CE validates the **whole batch as a unit**:

- `result-requires-request` (`packages/fhir/src/rules/result-requires-request.ts:49-54`) is
  satisfied if the referenced ServiceRequest is **anywhere in the same batch OR already in the
  store**. A ServiceRequest + its Observation in one Bundle validate together regardless of entry
  order.
- The read model uses **soft references** (no enforced foreign keys), so persist order never causes
  a failure.

The **one** genuinely order-sensitive step is **reference resolution**: `urn:uuid:` references must
be rewritten to real ids *before* validation, or `Observation.basedOn` points at a phantom and the
rule fails. That happens inside the node, before anything is validated.

## Component: the `unwrap-bundle` node

New handler in `packages/workflows/src/engine/node-handlers/unwrap-bundle.ts`, registered in
`node-handlers/index.ts` under key `'unwrap-bundle'` (mirrors `split-out`). Pure/data-only, like
the other handlers.

**Config:** `{ sourcePath?: string }` — where to read the payload from each input item's `json`
(default `'body'`, matching the webhook envelope `{method,body,headers,query}` and the
`form-validate` `sourcePath` convention).

**Input handling (per item):**
1. Read `payload = item.json[sourcePath]`.
2. Classify:
   - `payload.resourceType === 'Bundle'` → **Bundle path**.
   - `Array.isArray(payload)` → **bare-array path** (backward-compat with today's cdr output).
   - otherwise → **fail this item** with a clear error (`unwrap-bundle: expected a FHIR Bundle or an
     array of resources`). (Atomic: a failed item fails the run — see Transaction semantics.)
3. Bundle path only — validate `Bundle.type` ∈ {`transaction`, `batch`, `collection`}; other types
   (`document`, `message`, `searchset`, …) are rejected in v1.

**Unwrap + resolve (Bundle path):**
1. Collect `entry[]`. For each entry take `entry.resource` (skip entries without one).
2. **`request.method` gate (v1):** `POST`/`PUT` (and absent, treated as upsert) are allowed; any
   `DELETE`/`PATCH`/`GET`/other → reject the whole Bundle with a clear error. (Rationale: v1 is an
   ingest/upsert path; delete/patch semantics are out of scope.)
3. **Assign ids where missing:** an entry whose `resource` has no `id` (a `urn:uuid` create) gets a
   freshly minted id (`randomUUID`). An entry whose resource already has an `id` keeps it (upsert).
4. **Build the resolution map** `key → "Type/id"`:
   - `entry.fullUrl` (e.g. `urn:uuid:abc` or `ServiceRequest/obr1`) → the resource's final
     `Type/id`.
   - also map bare `"Type/id"` → itself (so already-relative references are a no-op).
5. **Rewrite references:** walk every resource recursively; for every object shaped
   `{ reference: <string>, … }`, if `<string>` matches a map key, replace it with the mapped
   `Type/id`. Unmatched references (e.g. an external/absolute reference, or a reference to a
   resource already in the store) are left untouched.
6. Emit **one output item per resolved resource** (`{ json: resource }`), in entry order.

**Bare-array path:** emit one item per array element unchanged (no resolution — today's contract,
where the cdr already uses real ids). Equivalent to what `split-out(body)` does now, so switching
`Ingest-raw` to `unwrap-bundle` loses nothing.

**Output:** the flat resource-item list → `persist-store` → `validateBatch` + `persistResources`,
unchanged.

## Transaction semantics

Atomic all-or-nothing, which is already how the downstream behaves: `validateBatch`
(`packages/fhir/src/validate-batch.ts`) fails the entire set if any resource is structurally or
clinically invalid, and nothing is persisted. To make persistence itself all-or-nothing, the
persist step wraps its writes in a single transaction (verify the current `persist-store` path
already does; if not, wrap it). v1 treats `transaction` and `batch` Bundle types identically
(atomic). Honoring `batch` as per-entry partial success is out of scope.

## Pipeline change (seeded `Ingest-raw`)

`buildDefaultWorkflows` (`packages/workflows/src/sample-workflow.ts`): the `Ingest-raw` workflow's
middle node changes from `split-out` (`config.field='body'`) to `unwrap-bundle`
(`config.sourcePath='body'`). Path (`cdr-ingest`), secret, persist source, and disabled-by-default
all stay the same. Because `unwrap-bundle` also accepts a bare array, this is backward-compatible
with any sender still POSTing an array.

## Producer: cdr-toolchain emits a transaction Bundle

`cdr-toolchain` `buildCeResources` currently returns a bare `FhirResource[]`. Add a wrapper
`toTransactionBundle(resources)` that returns:

```json
{ "resourceType": "Bundle", "type": "transaction",
  "entry": [ { "fullUrl": "ServiceRequest/<id>",
               "resource": { … },
               "request": { "method": "PUT", "url": "ServiceRequest/<id>" } }, … ] }
```

Real deterministic ids + `PUT` + relative references (`"Type/id"`) — idempotent (re-ingesting a lab
upserts, no duplicates), and a valid FHIR transaction Bundle. The `export-batch` CE branch POSTs
this Bundle instead of the bare array. (`urn:uuid`/`POST` is CE-supported for other senders but the
toolchain uses the idempotent PUT style.)

## Data flow

```
POST Bundle → webhook (envelope {method,body:Bundle,headers,query})
  → unwrap-bundle(sourcePath=body): entry[].resource → resolve fullUrl/urn:uuid refs → resource list
    → persist-store → validateBatch (whole set; refs now real) → persistResources (one transaction)
      → fhir store + projection (Observation→lab_results, QuestionnaireResponse→questionnaire_responses, …)
```

## Error handling

- Non-Bundle, non-array payload → item error, run fails.
- Unsupported `Bundle.type` or `request.method` → Bundle rejected with a specific message.
- Any resource fails `validateBatch` → whole set rejected, nothing persisted (atomic), the reason
  recorded on the workflow run (same as today).
- Unresolved `urn:uuid` reference (a ref with no matching `fullUrl`) → left as-is; if it was a
  required intra-bundle link, `validateBatch` catches it downstream (fails the batch) rather than
  persisting a dangling reference.
- The webhook returns `{ ok, runId }` (async); per-resource outcomes live on the run record. No FHIR
  `OperationOutcome`/Bundle-response — a limitation of the webhook path vs a real `POST /fhir`.

## Testing

- **`unwrap-bundle` unit tests** (`unwrap-bundle.test.ts`):
  - transaction Bundle, real ids + relative refs → resources emitted, refs unchanged.
  - `urn:uuid` Bundle → refs rewritten from `urn:uuid:X` to `Type/id`; missing ids minted.
  - mixed real-id + `urn:uuid` entries → both resolved.
  - bare array → passthrough (parity with `split-out`).
  - non-Bundle non-array → error; unsupported `Bundle.type` → error; `DELETE` entry → error.
  - a ServiceRequest + an Observation referencing it (via `urn:uuid`) → after unwrap the
    Observation's `basedOn` is the ServiceRequest's real id.
- **Integration** (workflow run): a Bundle through `unwrap-bundle → persist-store` validates + persists
  the whole set, including the ServiceRequest+Observation-in-one-Bundle case (no ordering).
- **Producer** (cdr-toolchain): `toTransactionBundle` wraps `buildCeResources` output into a valid
  transaction Bundle (PUT entries, relative refs); the CE branch posts the Bundle.
- **End-to-end (live):** cdr emits a Bundle → POST to `cdr-ingest` → the QR + test leg land in
  `questionnaire_responses` / `lab_results` (same acceptance already proven for the bare array).

## Out of scope (v1)

- A real standard `POST /fhir` transaction endpoint + FHIR `OperationOutcome`/Bundle-response (the
  webhook path returns the workflow-run shape).
- `DELETE`/`PATCH` Bundle entries; honoring `batch` as per-entry partial success.
- Conditional references / conditional create (`ifNoneExist`), and cross-request reference resolution
  beyond the store lookup `validateBatch` already does.
