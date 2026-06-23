# DHIS2 as a WASM Sink Plugin + Dynamic Connectors — Design

Date: 2026-06-23
Status: **Approved (brainstorm complete). Implementation deferred to a new session.**
Author: brainstormed with Fredrick

## Goal

Turn DHIS2 from a host-side package into a **WebAssembly sink plugin** (run via Extism,
like the `whonet-sqlite` source plugin), and make it configurable/testable **live in the
app** through a new generic **Connector** model — no `.env` edits, no server restart.

Verification bar: **live end-to-end in the browser** against a **local DHIS2 in Docker**.
First live milestone = **aggregate (`dataValueSets`) push + metadata pull**. Tracker
(`events`) push is ported into the plugin in the same build (so the old package deletes
cleanly) but its live verification is a fast-follow.

Ultimate north-star (separate, later work): a single workflow that **ingests a WHONET
file → converts to the OpenLDR/FHIR structure → pushes to DHIS2**, all from the builder.

## Background — how the relevant systems work today

- **Plugins** are Rust → `wasm32-wasip1`, run by **Extism** (`@extism/extism`), discovered
  from a DB registry (`plugins` table) + blob storage, loaded on demand by id and cached.
  A source plugin exports one entrypoint, `convert(bytes) -> NDJSON FHIR`. Host imports:
  `log`, `progress`. Sandbox is default-deny; `net-egress` capability maps to Extism
  `allowed_hosts`. Key files: `wasm/openldr-plugin-sdk/`, `packages/plugins/src/*`
  (`extism-runner.ts`, `runtime.ts`, `wasm-converter.ts`, `manifest.ts`, `store.ts`).
- **Ingestion** is accept → event → convert → persist: `openldr ingest` → blob + batch row
  + `ingest.received` event → `handle()` resolves a converter (built-in registry → else
  plugin loader) → `convert()` → dual-write to FHIR store (internal PG) + flat-writer
  (analytics DB). The converter resolver is a chain; a WASM plugin is just another
  converter. Key files: `packages/ingest/src/*`, `packages/bootstrap/src/ingest-context.ts`.
- **DHIS2 today** is host-side and cleanly layered:
  - `@openldr/ports` — `ReportingTargetPort` (`pushAggregate`, `pushEvents`,
    `pullMetadata`, `healthCheck`) — the sink contract.
  - `@openldr/adapter-dhis2` — HTTP egress implementing the port (POST
    `/api/dataValueSets`, `/api/tracker`; GET metadata; import-summary parsing).
  - `@openldr/dhis2` — **mixed**: aggregate mapping (`buildDataValueSet`), tracker mapping
    (`buildEvents`/`uid`), **plus host-only helpers** — `period.ts` (scheduling math),
    `validate.ts` (mapping-vs-metadata), `types.ts` (mapping shapes), `dispatchReportSource`.
  - `packages/bootstrap/src/dhis2-context.ts` — `runMapping` orchestration: load mapping
    (DB) → org-unit map (DB) → **run report (host)** → **map** → **push (HTTP)** → audit.
    Plus scheduled sync (event-bus `dhis2.sync.due`, `reconcileSchedules`).
  - Connection config (`DHIS2_BASE_URL/USERNAME/PASSWORD`, `REPORTING_TARGET_ADAPTER`) is
    read from `.env` **once at startup** (`apps/server/src/index.ts`). Changing it requires
    a server restart. Mappings/org-units/schedules are already dynamic (DB + admin UI).
- **No secrets-at-rest encryption exists** today — every connection secret lives in `.env`
  (`packages/bootstrap/src/target-store.ts`).
- **`net-egress` capability already modeled** in `packages/marketplace/src/capabilities.ts`
  (`{ kind: 'net-egress', allowedHosts: [...] }`), explicitly intended to drive Extism
  `allowed_hosts`, and consent-gated at install.

### Hard constraint that shaped the design

A WASM sink plugin receives **input data + config**, transforms, and pushes out. It
**cannot** run OpenLDR reports (no DB access), subscribe to the event bus, own scheduling,
or store config. So "DHIS2 is a plugin" means: **all DHIS2 protocol/egress logic moves
into the plugin**; the host keeps generic concerns (produce rows, schedule, store config,
render UI) and hands rows + mapping + credentials to the plugin per call.

## Chosen approach (Approach A)

**Plugin-backed `ReportingTargetPort` with named entrypoints.** Keep the port as the
host-side sink seam (sync, ops, admin UI keep calling it); swap only its *implementation*
to "resolve connector → load sink plugin → invoke." Revise the port so mapping moves into
the plugin. Connectors are **generic** (bound to any sink `pluginId`) so future sinks reuse
L3–L5; only L1 is DHIS2-specific.

Rejected: a brand-new symmetric `SinkPlugin` abstraction (more rewiring, retires a working
seam — YAGNI); a single `invoke(op,json)` dispatch ABI (less self-documenting, weaker
per-op capability gating than named exports).

## Architecture — five layers, built in dependency order

```
L5 UI            Settings▸Connectors (create/edit/TEST) + workflow node (pick + TEST live)
L4 Host wiring   connector-resolved target via ReportingTargetPort; DELETE adapter-dhis2;
                 shrink @openldr/dhis2 to host helpers
L3 Store+crypto  connectors table (migration) + AES-256-GCM at rest + SECRETS_ENCRYPTION_KEY
L2 Sink runtime  manifest kind:"sink"; WasmSink wrapper; loadSink(); net-egress→allowedHosts
L1 ABI + wasm    sink entrypoints in SDK; wasm/dhis2-sink (Rust): health/metadata/aggregate/tracker
```

Build order: L1 → L2 → L3 → L4 → L5 → live e2e. Each lower layer is independently testable.

### L1 — Sink-plugin ABI + DHIS2 wasm plugin

Manifest gains `kind` (`"source"|"sink"`, default `"source"` ⇒ existing plugins unchanged)
and `entrypoints`. A sink exports **named entrypoints**, each `bytes → bytes` JSON:

- `push_aggregate` — input `{ rows, mapping:{orgUnitColumn,periodColumn?,columns[]},
  orgUnitMap, period, dryRun }`; config (Extism config map, the secrets)
  `{ baseUrl, username, password }`; output `{ payload:{dataValues[]}, skipped:[{row,reason}],
  result?:{status,imported,updated,ignored,deleted,conflicts[],raw} }`. `result` present
  only when `dryRun=false`; `payload` always returned (the dry-run preview). Mapping has
  exactly one home (the plugin).
- `pull_metadata` — `{}` → `{ dataElements, orgUnits, categoryOptionCombos, programs,
  programStages }`.
- `health_check` — cheap `GET /api/system/info` → `{ ok, version? }`.
- `push_tracker` — tracker analogue of `push_aggregate` (ported now; live-verified later).

Egress/secrets: plugin declares `net-egress` intent; the **concrete allowed host is pinned
by the connector at runtime** (host passes `allowedHosts:[connectorHost]` to the runner —
least privilege). Credentials arrive via the Extism config map, never persisted by the
plugin. HTTP via `extism_pdk::http::request` (Extism enforces `allowed_hosts`).

`wasm/dhis2-sink` (new Rust crate) ports `buildDataValueSet`/`buildEvents`/`uid` mapping
from `@openldr/dhis2` and the HTTP/import-summary parsing from `@openldr/adapter-dhis2`.

### L2 — Sink host runtime (`packages/plugins`)

- `manifest.ts`: parse `kind` + `entrypoints` (missing `kind` ⇒ `"source"`).
- New `wasm-sink.ts`: `createWasmSink(manifest, wasm, runner, logger, capabilities)` →
  `invoke(entrypoint, inputJson, { config, allowedHosts })`; serializes input, calls the
  **existing** Extism runner (already supports `entrypoint`/`config`/`allowedHosts`), parses
  JSON; **fail-closes** if a host is requested but the plugin lacks `net-egress`.
- `runtime.ts`: add `loadSink(id, version?) → WasmSink` (same store lookup + SHA256 verify +
  cache as converter `load()`). Runtime stays connector-agnostic (config/host are per-call).

### L3 — Connector store + secret encryption

- Crypto in `@openldr/core` (zero-dep, reusable): `seal(plaintext,key)`/`open(blob,key)`
  AES-256-GCM; packed blob = `iv + ciphertext + authTag`. Key from new config var
  `SECRETS_ENCRYPTION_KEY` (base64, 32 bytes). **Fail-closed**: using a secret-bearing
  connector with the key unset throws a clear error; never stores plaintext.
- Migration — `connectors` table: `{ id, name, plugin_id, kind, config_encrypted,
  allowed_host, enabled, created_at, updated_at }`. Whole secret config object encrypted
  into `config_encrypted`; `allowed_host` derived from `baseUrl` kept in clear so egress can
  be pinned without decrypting.
- `createConnectorStore(db)` in `@openldr/db` (next to `createMappingStore` etc.):
  `create/get/list/update/delete` + `getDecryptedConfig(id,key)`. `list()` **masks secrets**.

### L4 — Host rewiring

- **Delete `@openldr/adapter-dhis2`** entirely (logic → plugin).
- **Shrink `@openldr/dhis2`** to host-only helpers: `period.ts`, `validate.ts`, `types.ts`,
  `dispatchReportSource`. Mapping (`buildDataValueSet`/`buildEvents`/`uid`) leaves.
- `ReportingTargetPort.pushAggregate` signature changes from `(builtPayload)` to
  `({ rows, mapping, orgUnitMap, period, dryRun })`, returns `{ payload, skipped, result? }`
  (same shape change for `pushEvents`).
- Target resolution becomes **per-connector**: `runMapping` gains `connectorId`; resolves on
  demand — load connector → decrypt config → `loadSink(pluginId)` → bind `{config,
  allowedHosts}` → call. Mapping record, schedule record, and workflow node each carry a
  `connectorId`. Sync/ops/admin UI keep calling the port unchanged above this seam.

### L5 — UI + API

- **Settings ▸ Connectors** (new generic page): list (name·plugin·host·enabled·last-test);
  create/edit dialog (name, pick sink plugin, baseUrl, username, password); **Test
  connection** → `health_check` + `pull_metadata` live, shows status + metadata summary.
  Secrets **write-only** in UI (`••• set`, only sent when changed; never returned).
  `lab_admin`-gated.
- **Workflow `dhis2-push` node**: config → connector picker + mapping picker + period +
  dry-run; **Test** button runs a live dry-run/real push for that node, shows summary inline.
- **DHIS2 ops + schedules** (`/settings/dhis2`): add a connector selector wherever a push is
  triggered.
- **API** (`lab_admin`): `GET/POST /api/connectors`, `GET/PUT/DELETE /api/connectors/:id`
  (list masks secrets), `POST /api/connectors/:id/test`. Node "Test" reuses the workflow
  dry-run path with a `connectorId`.

## End-to-end data flow (aggregate push)

1. Trigger (workflow node / schedule / ops) with `connectorId, mappingId, period, dryRun`.
2. Host `runMapping`: load mapping (DB), org-unit map (DB), `dispatchReportSource` →
   `runReport(reportId, params)` → rows.
3. `resolveTarget(connectorId)`: connector store get → `getDecryptedConfig(key)` →
   `loadSink(connector.pluginId)` → `createPluginTarget(sink, config, allowedHost)`.
4. `target.pushAggregate({rows, mapping, orgUnitMap, period, dryRun})` →
   `WasmSink.invoke('push_aggregate', input, {config, allowedHosts:[host]})` → Extism runner
   → plugin maps rows→dataValues; if `!dryRun` POST `/api/dataValueSets` via Extism HTTP →
   parse import summary.
5. Host gets `{payload, skipped, result}`; audits (`dhis2.push` / `dhis2.push.failed`);
   returns outcome; UI shows import summary + skip count.

Connector "Test" / `validate` flow: `resolveTarget` → `pull_metadata` → summary; validation
compares mapping against pulled metadata host-side (`@openldr/dhis2` `validate.ts`).

## Error handling

- `net-egress` fail-closed: plugin without the capability requesting a host → host refuses.
- Egress to a non-pinned host → Extism blocks it.
- `SECRETS_ENCRYPTION_KEY` unset while decrypting → clear `ConfigError`, never plaintext.
- DHIS2 import errors → `result.status='error'`/throw → host audits failure, surfaces to UI.
- Runner timeout (manifest `limits.timeoutMs`) → error.
- `dryRun` → no egress; payload preview only.
- Secrets never logged (masked at the store + redaction boundary).

## Testing strategy

- **L1**: Rust unit tests porting existing `mapping.test.ts`/tracker cases; host-side
  `WasmSink` test runs the built `.wasm` in **dry-run** (no network) for mapping, and against
  a **local mock DHIS2** (Fastify) with `allowedHosts` pinned for the push path.
- **L3**: crypto round-trip tests; connector store via pg-mem; secret-masking test.
- **L4**: `dhis2-context.runMapping` tests updated to connector-resolved target with a mocked
  sink; port-signature change covered.
- **L5**: web component tests (connectors page, node connector picker); API route tests
  (CRUD + masking + test endpoint + role gating).
- **Live e2e**: `docker compose` DHIS2 (`dhis2/core` + Postgres/PostGIS), seed minimal
  metadata + org units, create a connector via the UI, run an aggregate push from the
  workflow builder, verify dataValues landed (`GET /api/dataValueSets`), capture screenshots.
  Aggregate + metadata is the milestone; tracker live-verify follows.

## Decomposition into sub-projects (each: spec → plan → implement → green gate)

- **SP-1 — Sink-plugin ABI + host runtime** (L1 SDK/manifest + L2). Deliverable: a trivial
  test sink loads and `invoke()`s (dry-run) through the runtime.
- **SP-2 — `wasm/dhis2-sink` Rust plugin** (mapping aggregate+tracker, metadata, push;
  ported from the TS packages; Rust unit tests). Depends on SP-1.
- **SP-3 — Connector store + crypto** (L3: migration, AES-GCM in core, config var, store).
  Largely parallel to SP-1/SP-2.
- **SP-4 — Host rewiring** (L4: delete `adapter-dhis2`, shrink `@openldr/dhis2`, per-connector
  target resolution, `runMapping` `connectorId`, update sync/ops). Depends on SP-2 + SP-3.
- **SP-5 — UI + API** (L5: Connectors settings page, node connector picker + Test, routes).
  Depends on SP-4.
- **SP-6 — Live e2e + docs** against Docker DHIS2 (aggregate + metadata); tracker live-verify
  as a follow-up.

## Out of scope / deferred

- Tracker **live** verification (ported + unit-tested now, live later).
- Additional sink plugins (connectors are generic, but only the DHIS2 plugin is built).
- Marketplace publish/federation of the DHIS2 sink plugin.
- Migrating existing `.env` DHIS2 vars into a connector automatically (decide in SP-4:
  one-time import vs. just remove the vars).

## Open items to confirm at implementation start

- Docker DHIS2 image/version + minimal seed strategy for the e2e.
- Whether `SECRETS_ENCRYPTION_KEY` is required at boot or only when a secret connector is
  used (lean: required only on first decrypt, clear error otherwise).
- Exact home of the host-side mapping helpers after `@openldr/dhis2` shrinks (keep the
  package slimmed vs. fold into bootstrap) — decide in SP-4.

## Related (separate work, noted here for context)

- **Workflow list/index page is missing.** `/workflows` (`apps/web/src/workflows/page.tsx`)
  drops straight into the builder for a single `workflowId`; there's no list and no way to
  switch designs. n8n-style fix: list at `/workflows`, builder at `/workflows/:id`. Needed
  before the WHONET→OpenLDR→DHIS2 north-star workflow is practical. Track as its own piece.
