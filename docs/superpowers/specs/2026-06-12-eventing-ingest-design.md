# Sub-project 4 — Eventing + Ingest Pipeline

**Date:** 2026-06-12
**Status:** Approved design (ready for implementation planning)
**PRD:** `openldr-ce-prd-phase1.md` — P1-INGEST-1..6, P1-OBS-1, the eventing port (§3.3/§3.4), and the `ingest`/`pipeline`/`queue`/`provenance audit` slice of P1-CLI-1
**Build-sequence step:** §8 step 4

---

## 1. Purpose & scope

Turn two stubs — the `event-bus` adapter's `publish`/`subscribe` and the `@openldr/ingest` placeholder — into a working ingest pipeline that realizes §3.4:

```
payload → raw stored in blob (provenance: source, timestamp, batch id)
   → event emitted (eventing port) → worker picks it up
   → convert to FHIR R4 (Converter; WASM plugin is §8 step 5)
   → provenance stamped (converter id+version, batch id)
   → persisted: canonical FHIR internally + flattened externally (2b persistResource)
   → on any stage failure: mark + queue/retry with backoff + structured log, never crash the app
```

**In scope (4):**
- **Eventing:** `@openldr/db` internal migration `002_outbox`; the real `EventingPort` in `adapter-event-bus` (publish + drain + startWorker + stats) over a Postgres outbox + `pg_notify`, with retry + exponential backoff.
- **Conversion:** a `Converter` interface + registry in `@openldr/ingest`, with two built-ins (`fhir-bundle`, `questionnaire-response`).
- **Ingest:** internal migration `003_ingest_batches`; `acceptPayload` + `handleIngestEvent` orchestration with batch-id provenance and graceful failure.
- **Composition:** `createIngestContext` in `@openldr/bootstrap`; `apps/server` runs the worker.
- **CLI:** `ingest`, `pipeline status|retry|logs`, `queue status`, `provenance audit`.

**Out of scope (deferred):**
- The WASM plugin runtime (§8 step 5) — it registers as another `Converter`; this sub-project leaves that seam.
- Kafka/Inngest eventing adapters (§7) — the outbox is the only eventing impl.
- Distributed/multi-process worker coordination beyond `FOR UPDATE SKIP LOCKED` (single deployable, §3.1).
- React/UI for pipeline monitoring — CLI only.
- Dead-letter replay UI; `pipeline retry` (re-queue) is the Phase-1 recovery surface.

---

## 2. Cross-cutting principles this sub-project demonstrates

- **DP-3 Provenance** — every ingested record carries source, converter id+version, and batch id; `ingest_batches` links to the raw blob payload.
- **DP-7 Graceful degradation** — a stage failure marks/queues/retries with backoff and logs; it never crashes the app. External-DB unreachability degrades only the persist stage (inherited from 2b `persistResource`).
- **DP-5 Lean** — Postgres outbox + `pg_notify` + a worker pool; no Kafka.
- **DP-4 Agent-operability** — `ingest`/`pipeline`/`queue`/`provenance audit` with `--json`.
- **P1-OBS-1** — structured pino logs with `batchId` as the correlation key end to end.
- **DP-1** — `@openldr/ingest` uses the `BlobStoragePort`/`EventingPort` interfaces and never imports a concrete adapter; only `bootstrap` composes.

---

## 3. Eventing — Postgres outbox (`adapter-event-bus` + `@openldr/db`)

### 3.1 Outbox migration (`@openldr/db` internal `002_outbox`)
```
outbox_events(
  id           uuid primary key,
  type         text not null,
  payload      jsonb not null,
  status       text not null default 'pending',   -- pending | processing | done | failed
  attempts     int  not null default 0,
  max_attempts int  not null default 5,
  last_error   text,
  batch_id     text,
  available_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
)
```
Index on `(status, available_at)`. Added to `InternalSchema` (typed) for the `stats`/queue reads, but the adapter's claim logic uses raw SQL.

### 3.2 `adapter-event-bus` real `EventingPort`
`createEventBus({url}, deps)` returns an `EventBus extends EventingPort` with:
- `publish(event)` — `INSERT INTO outbox_events (id, type, payload, batch_id) VALUES (...)` with `id = randomUUID()` and `batch_id` read from `event.payload.batchId` if present; then `select pg_notify('openldr_events', $type)`.
- `subscribe(type, handler)` — store `handler` in a `Map<type, EventHandler>`.
- `drain(opts?: { limit?: number })` — in a transaction, `SELECT ... FROM outbox_events WHERE status='pending' AND available_at <= now() ORDER BY available_at LIMIT $limit FOR UPDATE SKIP LOCKED`; mark each `processing`; commit; then for each, look up the handler by `type` and run it:
  - success → `status='done', updated_at=now()`.
  - throw → `attempts = attempts+1`; if `attempts < max_attempts` → `status='pending', available_at = now() + backoff(attempts), last_error=<redacted>`; else `status='failed', last_error=<redacted>`.
  - no registered handler → leave `pending` (logged) — not an error.
  Returns `{ processed: number, failed: number }`.
- `startWorker(opts?: { intervalMs?: number })` — `LISTEN openldr_events`; on notification or every `intervalMs` (default 2000), call `drain()`. Returns `stop(): Promise<void>`.
- `stats()` — `SELECT status, count(*) ... GROUP BY status` → `Record<status, number>`.
- `healthCheck()` (unchanged), `close()`.

`backoff(attempts)` — `Math.min(MAX_BACKOFF_MS, BASE_MS * 2 ** attempts)` with `BASE_MS=1000`, `MAX_BACKOFF_MS=300000` (pure, unit-tested).

---

## 4. Conversion — `Converter` (`@openldr/ingest`)

```ts
export interface ConvertContext { source?: string; batchId: string; }
export interface Converter {
  readonly id: string;
  readonly version: string;
  convert(raw: Uint8Array, ctx: ConvertContext): Promise<FhirResource[]>;
}
export class ConverterRegistry {
  register(c: Converter): void;
  get(id: string): Converter | undefined;
  list(): string[];
}
```

Built-ins (registered by default):
- **`fhir-bundle`** (`version '1'`) — `JSON.parse(text)`; if `resourceType === 'Bundle'` return `entry[].resource`; else if it has a `resourceType` return `[resource]`; else throw a clear error.
- **`questionnaire-response`** (`version '1'`) — `JSON.parse(text)` expecting `{ questionnaire: Questionnaire, response: QuestionnaireResponse }`; call `@openldr/forms` `extractResources(response, questionnaire, { subject? })` and return `result.resources` (and throw if `result.invalid.length > 0`, surfacing the outcome).

`@openldr/ingest` depends on `@openldr/forms`, `@openldr/fhir`, `@openldr/db`, `@openldr/ports`, `@openldr/core` — all domain/supporting packages; **no adapter import** (DP-1, depcruise-enforced).

---

## 5. Ingest pipeline (`@openldr/ingest`)

### 5.1 `ingest_batches` migration (`@openldr/db` internal `003_ingest_batches`)
```
ingest_batches(
  batch_id       text primary key,
  source         text,
  blob_key       text not null,
  content_type   text,
  converter      text not null,
  status         text not null default 'received',  -- received | processing | done | failed
  resource_count int  not null default 0,
  attempts       int  not null default 0,
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
)
```
`ingest_batches` is the user-facing pipeline + provenance state (read by `pipeline status`/`logs`), distinct from the internal `outbox_events` queue.

### 5.2 `acceptPayload`
```ts
interface AcceptInput { data: Uint8Array; source: string; converter: string; contentType?: string; filename?: string; }
interface AcceptDeps { blob: BlobStoragePort; eventing: EventingPort; batches: BatchStore; logger: Logger; }
function acceptPayload(deps: AcceptDeps, input: AcceptInput): Promise<{ batchId: string; blobKey: string }>;
```
`batchId = randomUUID()`; `blobKey = 'ingest/' + batchId + '/' + (filename ?? 'payload')`; `blob.put(blobKey, data, contentType)`; `batches.create({ batchId, source, blobKey, contentType, converter, status:'received' })`; `eventing.publish({ type: 'ingest.received', payload: { batchId, blobKey, source, converter } })`; structured log. (P1-INGEST-1/2.)

### 5.3 `handleIngestEvent` (the subscribed worker handler)
```ts
interface HandleDeps { blob: BlobStoragePort; persist: (r: unknown, p: Provenance) => Promise<PersistResult>; converters: ConverterRegistry; batches: BatchStore; logger: Logger; }
function handleIngestEvent(deps: HandleDeps, event: EventEnvelope): Promise<void>;
```
Flow (P1-INGEST-3/4/5/6):
1. read `{ batchId, blobKey, source, converter }` from `event.payload`; `batches.markProcessing(batchId)` (attempts++).
2. `raw = await blob.get(blobKey)`.
3. `c = converters.get(converter)` (throw if unknown); `resources = await c.convert(raw, { source, batchId })`.
4. `provenance = { sourceSystem: source, pluginId: c.id, pluginVersion: c.version, batchId }`.
5. for each resource: `await deps.persist(resource, provenance)` (2b — canonical internal + flattened external + DP-7).
6. `batches.markDone(batchId, resources.length)`; log success (keyed by `batchId`).
- On any thrown error: `batches.markFailed(batchId, redact(message))`, log, and **rethrow** — the eventing layer retries with backoff (and finally marks the outbox `failed`); the app never crashes.

### 5.4 `BatchStore` (over internal Kysely)
`createBatchStore(db: Kysely<InternalSchema>)` → `{ create, markProcessing, markDone, markFailed, get, list, requeueable }` plus `provenanceGaps()` for the audit (queries `fhir_resources` for rows with null `source_system`/`plugin_id`/`batch_id`).

---

## 6. Composition + server

`@openldr/bootstrap` `createIngestContext(config)` builds the full pipeline world: `createInternalDb`, the `db-store`/`s3-bucket`/`event-bus` adapters, `createFhirStore`/`createFlatWriter`/`persistResource`, a `ConverterRegistry` with the two built-ins, a `BatchStore`, and binds:
```ts
interface IngestContext {
  accept(input: AcceptInput): Promise<{ batchId: string; blobKey: string }>;
  drain(): Promise<{ processed: number; failed: number }>;
  startWorker(): { stop(): Promise<void> };
  batches: BatchStore;
  eventing: { stats(): Promise<Record<string, number>> };
  migrateAll(): Promise<unknown>;   // reused from db-context so the CLI can migrate
  close(): Promise<void>;
}
```
It `subscribe`s `handleIngestEvent` to `ingest.received` so both `drain()` and `startWorker()` process ingest events. `apps/server` calls `createIngestContext` + `startWorker()` on boot (background worker in the same deployable) and closes it on shutdown.

---

## 7. CLI (P1-CLI-1)

All under `@openldr/cli`, using `createIngestContext`:
- `openldr ingest <file> [--source <s>] [--converter <id>] [--json]` — read the file, `accept(...)`, then `drain()` once (so a single command runs the whole pipeline without a server); print `batchId` + final batch status. Default `--converter fhir-bundle`, `--source cli`.
- `openldr pipeline status [--json]` — `batches.list()` (batch id, source, converter, status, resource_count, attempts, last_error).
- `openldr pipeline retry <batchId> [--json]` — re-publish `ingest.received` for the batch (reset batch to `received`), then `drain()`.
- `openldr pipeline logs <batchId> [--json]` — the batch's attempt/error history (status, attempts, last_error, timestamps).
- `openldr queue status [--json]` — `eventing.stats()` (outbox counts by status).
- `openldr provenance audit [--json]` — `batches.provenanceGaps()` → records in `fhir_resources` missing source/plugin/batch; exit non-zero if any gap (P1-NFR-6).

---

## 8. Testing & acceptance

**Unit (no infra)**
- `backoff(attempts)` exponential, capped.
- `fhir-bundle` converter: a Bundle → its resources; a single resource → `[resource]`; non-FHIR → throws.
- `questionnaire-response` converter: a `{ questionnaire, response }` → extracted resources; an invalid extraction surfaces (throws).
- `acceptPayload` with fake blob+eventing+batches: blob `put` called, batch created `received`, `ingest.received` published with `batchId`.
- `handleIngestEvent` happy path (fake deps): converter run, `persist` called once per resource with the right provenance, batch `done` + `resource_count`.
- `handleIngestEvent` failure: converter throws → batch `failed`, error recorded, the handler rethrows.
- `provenanceGaps` logic with fake rows.

**Integration (docker stack, via `pnpm openldr`/tsx)**
- `openldr db migrate` now creates `outbox_events` + `ingest_batches` (plus the 2b tables).
- `openldr ingest fixtures/sample-bundle.json --source test` → batch `done`; the Bundle's resources appear in internal `fhir_resources` (with `batch_id` + `source_system='test'`) **and** the external flat tables.
- `openldr ingest fixtures/sample-qr.json --converter questionnaire-response` → extracted Patient persisted; `pipeline status` shows `done` with `resource_count >= 1`.
- `queue status` shows the events `done`.
- `provenance audit` → **zero gaps** (P1-NFR-6) on the ingested records.
- A forced failure (`openldr ingest fixtures/bad.json`) → batch `failed`, the outbox event retried then `failed`, exit non-zero, **no crash**; `pipeline retry <id>` after fixing re-runs it.

**Gate**
- `pnpm -r typecheck && pnpm -r test && pnpm depcruise && pnpm -r build && pnpm build:check` green; `depcruise` confirms `@openldr/ingest` imports no adapter/app, and only `bootstrap` imports `adapter-event-bus`/`adapter-s3-bucket`/`adapter-db-store`.

---

## 9. Acceptance criteria checklist

- [ ] Real `EventingPort` over a Postgres outbox + `pg_notify`; `publish`/`drain`/`startWorker`/`stats`; retry + exponential backoff (replaces the stubs).
- [ ] `acceptPayload`: raw stored in blob with provenance (source, timestamp, batch id) + event emitted (P1-INGEST-1/2).
- [ ] `Converter` interface + `fhir-bundle` and `questionnaire-response` built-ins; plugin seam for §8 step 5 (P1-INGEST-3).
- [ ] Provenance stamped (converter id+version, batch id) on every persisted record (P1-INGEST-4, DP-3).
- [ ] Persisted via 2b `persistResource` — canonical internal + flattened external (P1-INGEST-5).
- [ ] Graceful failure: stage error → mark/queue/retry with backoff + structured log, no app crash (P1-INGEST-6, DP-7).
- [ ] `ingest`/`pipeline status|retry|logs`/`queue status`/`provenance audit` CLI with `--json` (P1-CLI-1/2, DP-4).
- [ ] `provenance audit` returns zero gaps on the reference flow (P1-NFR-6).
- [ ] Structured pino logs keyed by `batchId` end to end (P1-OBS-1).
- [ ] Full gate green; dependency-cruiser clean.

---

## 10. Open items carried forward (not blocking 4)

- WASM plugin runtime + SDK + WHONET reference plugin (§8 step 5) — registers as a `Converter`; provenance already carries `pluginId`/`pluginVersion`.
- Kafka/Inngest eventing adapters behind the port (§7).
- Multi-process/horizontal worker scaling, dead-letter replay UI, backpressure tuning.
- A dedicated structured-log sink/table for richer `pipeline logs` (currently attempt/error history on the batch).
- License headers pending company/legal sign-off (§9).
