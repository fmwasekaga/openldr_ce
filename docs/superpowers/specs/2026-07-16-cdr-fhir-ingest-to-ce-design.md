# CDR → OpenLDR CE ingest — Design

**Date:** 2026-07-16
**Status:** design approved, not implemented
**Repos:** `cdr-toolchain` (engine changes) + `openldr_ce` (config only)
**Supersedes the framing in:** `docs/cdr-source-plugin-scoping.md` (see "Corrections" below)

## Purpose

Get **real DISA\*Lab data** into OpenLDR CE's FHIR store, so CE is exercised against real lab
data instead of synthetic seeds. This is the first slice of a larger migration workstream; it
deliberately excludes the plugin, the UI, and any Rust.

## Corrections to the earlier scoping

The three-read grounding investigation (2026-07-16) invalidated four assumptions in
`docs/cdr-source-plugin-scoping.md`. They are corrected here; that document should be read
only alongside this one.

1. **`cdr-toolchain` contains no FHIR.** Zero hits for `resourceType` / `DiagnosticReport` /
   `fhir` across the repo. `export-batch` maps DISA → a bespoke OpenLDR **v2 JSON** payload
   (`V2Payload`, `apps/cli/src/export/types.ts:139`) and POSTs it to v2's API. There is no
   DISA→FHIR mapping to reuse — it does not exist.
2. **`packages/disalab` is not a shared mapping core.** It is a DISA blob decoder + MSSQL
   reader (3,802 LOC; only deps `mssql`, `iconv-lite`). All mapping and validation live
   unexported in `apps/cli`: `toV2` (`apps/cli/src/export/v2-transform.ts`), the audit rules
   (`apps/cli/src/audit/detector.ts:540`), the compare engine (`apps/cli/src/compare/`).
3. **v1 / v2 / CE are one product line**, not separate products — deployment-generation
   labels used to disambiguate country deployments. CE is the destination going forward.
4. **The purpose is a side-by-side migration**, not merely test-data seeding. CDR is the
   source of truth; the compare-against-v1 is a **fidelity gate on the DISA decoder** (v1 is
   the trusted mirror), and quarantine-vs-push is the primary outcome. Sites will not turn
   off v1 until the data matches within a margin of error.

## Constraints (fixed)

- **CDR and OpenLDR v1 are read-only.** Verified: 39 `.query()` calls in `packages/disalab`,
  all `SELECT`; zero write DML in `packages/disalab/src` or `apps/cli/src`.
- **Live/remote source.** Both databases are reached over the network via
  `DISA_CONNECTION_STRING` and `OPENLDR_V1_CONNECTION_STRING` (`apps/cli/.env`, gitignored).
  Both are MSSQL (`apps/cli/src/openldr.ts:1-4`).
- **Full-fidelity PHI.** Identifiers map through unredacted: CE has redaction, and Zambia
  needs patient details to link with their EMR. Real patient data will land in whatever CE
  instance is targeted — during this slice, a local dev Postgres.
- **No changes to the working v2 push.** The existing Keycloak-authenticated v2 path stays
  untouched; the CE path is added alongside.

## Why the engine stays in the CLI

A CE plugin cannot read a database. Plugins are WASM sandboxes and the broker's op list is
closed — `storage.*`, `invoke`, `reports.*`, `connectors.{list,test,metadata,push,validate}`,
`fhir.facilities`, `schedule.*` (`packages/bootstrap/src/plugin-broker.ts:103`). **No op runs
SQL against a connector.** The host's `microsoft-sql` node reads one connector with one SQL
string (`packages/workflows/src/host-nodes.ts:68`); this workload needs two MSSQL databases
correlated per `RequestID`.

The language is not the obstacle — Extism's JS PDK could host the existing TypeScript, and
CE's runner is language-agnostic (`packages/plugins/src/extism-runner.ts` takes raw wasm
bytes). But no PDK grants a TCP socket, so the DB constraint is unchanged regardless.

Meanwhile the CLI already does the work, already runs at the lab next to both databases
(which matters: Moz runs v1 remotely for bandwidth reasons, so the two large reads must stay
local), and is already a separate third-party repo — which satisfies the "not in CE core"
constraint by construction.

## Architecture

```
DISA (MSSQL, read-only) ─┐
                         ├─ decode → compare vs v1 → audit → quarantine?
OpenLDR v1 (MSSQL, RO) ──┘                                      │
                                          ┌─────────────────────┴── quarantine/<labNo>.json
                                          │                          (unchanged)
                                          └─ toV2 → toFhir → POST ──▶ CE
                                                                      /api/workflows/hooks/<path>
                                                                      x-webhook-token
                                                                      Content-Type: application/json
                                                                      body: [ {FHIR}, {FHIR}, ... ]
                                                                              │
                                              webhook → split-out(body) → persist-store
                                                                              │
                                                                    fhir.* + change_log
```

Everything left of `toFhir` is existing, working code. The slice adds `toFhir`, a CE HTTP
client, and a target flag.

## Components

### cdr-toolchain (2 new files, 1 modified)

**`apps/cli/src/export/fhir-transform.ts`** — the deliverable. `V2Payload → FHIR resource[]`.

`V2Payload` is `{ patient, lab_request, lab_results[], isolates[], susceptibility_tests[],
data_quality? }` (`apps/cli/src/export/types.ts:139-149`). Target mapping:

| V2Payload | FHIR |
|---|---|
| `patient` | `Patient` |
| `lab_request` | `ServiceRequest` + `Specimen` + `DiagnosticReport` |
| `lab_results[]` | `Observation[]` |
| `isolates[]` | `Observation` (organism), linked from the culture via `hasMember` |
| `susceptibility_tests[]` | `Observation` (AST), linked from the isolate via `hasMember` |

This mapping is derived by **inverting** openldr-v2's
`apps/openldr-minio/default-plugins/schema/hl7-fhir.schema.js`, which converts FHIR → the same
canonical record `toV2` already emits. Specific inversion anchors: DiagnosticReport→lab_request
(`hl7-fhir.schema.js:927-956`), Patient→patient (`:913-926`), Observation→lab_results
(`:778-811`), the micro `hasMember` tree (`:492-773`, convention documented at `:496-518`).

Known gaps in that reference, which the inverse must decide explicitly rather than inherit:

- The shipped `.example.json` has no `hasMember` tree, so the micro projection is unexercised
  by the examples — isolates/AST mapping cannot be validated against the fixture alone.
- `abnormal_flag` / `rpt_range` are always null on the FHIR path (`:802-805`) but *are*
  populated on the v2 path (`:192-194`). Going FHIR-ward, these should map to
  `Observation.interpretation` and `Observation.referenceRange` rather than being dropped.
- `patient_guid` is set to `request_id` by `toV2` (`v2-transform.ts:197`) because DISA has no
  patient identity — so there is no cross-visit patient dedup. `Patient.id` inherits this.

**`apps/cli/src/api/ce-client.ts`** — POST with an `x-webhook-token` header instead of
`Bearer` + `X-DataFeed-Id`. Reuses the existing retry policy from `apps/cli/src/api/client.ts`
(4xx except 429 → reject; 429 → honour Retry-After; 5xx/network → exponential backoff).

**`apps/cli/src/commands/export-batch.ts`** — a CE target selected by `--ce-url` (base URL) and
`--ce-hook-path` (the `/api/workflows/hooks/<path>` suffix), authenticated by `--ce-token`.
Env equivalents: `OPENLDR_CE_URL`, `OPENLDR_CE_HOOK_PATH`, `OPENLDR_CE_WEBHOOK_TOKEN`. All
existing orchestration is reused unchanged: `--where/--limit/--offset`, `--concurrency`,
`--dry-run`, `--emit-payloads`, `--resume-from`, quarantine, the audit gate, and the
summary/exit codes.

### openldr_ce (no code changes)

One workflow, built by hand in Studio during this slice (not seeded), with the trigger secret
recorded into `cdr-toolchain`'s `apps/cli/.env` as `OPENLDR_CE_WEBHOOK_TOKEN`:

**webhook trigger → `split-out` (field: `body`) → `persist-store`**

- The webhook route is secret-gated, not user-authenticated: `POST /api/workflows/hooks/*`,
  token read from `x-webhook-token` only, constant-time compared, fail-closed when no secret
  is configured (`apps/server/src/workflows-routes.ts:403-413`).
- **The wire contract is a bare JSON array of FHIR resources**, sent with
  `Content-Type: application/json`. Verified chain:
  - the route calls `runAndRecord(workflowId, 'webhook', { method, body, headers, query })`
    (`workflows-routes.ts:425-428`);
  - `triggerHandler` returns `toItems(ctx.input)`
    (`packages/workflows/src/engine/node-handlers/trigger.ts:8-16`), and a record yields a
    single item (`packages/workflows/src/engine/items.ts:43`) — so the first item's `json` is
    `{ method, body, headers, query }`;
  - `splitOutHandler` reads `item.json[field]` — a **flat key lookup, not a path**
    (`packages/workflows/src/engine/node-handlers/split-out.ts:9`). Hence `field: "body"`.
    An array explodes to one item per element, each `json` being that element
    (`split-out.ts:11-19`).
  - **Therefore `{ resources: [...] }` must NOT be used**: `json.body` would be an object, not
    an array, so `split-out` passes it through untouched and `persist-store` receives one item
    whose `json` has no `resourceType` — failing validation. The body must be the array itself.
- **Content-Type matters.** If the content-type is not `application/json` and the body is a
  Buffer/stream, the route diverts it to blob storage as a file attachment and sets
  `webhookBody = undefined` (`workflows-routes.ts:417-424`) — the payload would vanish
  silently. Send `application/json`.
- `persist-store` takes **one FHIR resource per item** — `items.map((i) => i.json)`, each
  `json` being the resource (`packages/bootstrap/src/persist-store-service.ts:23`).
- Persist stamps a `batchId` into every row's provenance and publishes `data.persisted`
  (`persist-store-service.ts:40-47`), giving per-run observability for free.
- FHIR validation is already a hard gate inside persist — `validateResource` throws on an
  invalid resource (`packages/db/src/persist.ts:25-26,39`). No separate validation node is
  needed. Note it is **non-atomic across an array**: it throws on the first invalid resource
  having already saved the ones before it.

CE's supported resource types (13) include every type this mapping emits: Patient,
Organization, Location, Specimen, ServiceRequest, DiagnosticReport, Observation, Bundle,
Questionnaire, QuestionnaireResponse, CodeSystem, ValueSet, ConceptMap
(`packages/fhir/src/resources/index.ts`).

## Error handling

| Failure | Behaviour |
|---|---|
| DISA/v1 unreachable | Existing CLI behaviour; unchanged. |
| Audit finds ≥ threshold severity | Quarantine to `<dir>/<labNo>.json`; not sent. Unchanged. |
| CE returns 4xx | Report per-lab `errored`; batch continues (`processOneLab` catches internally, `export-batch.ts:689-700`). |
| CE returns 5xx / network | Existing exponential backoff, then fail that lab. |
| Invalid FHIR resource | `persist-store` throws; the workflow run fails. Partial saves possible within one payload (see non-atomicity above) — keep payloads to one lab so the blast radius is one record. |
| Wrong/missing webhook token | 401 from CE; fail fast and loudly (fail-closed by design). |

## Validation: who checks what

CE's validation is **structural, per-resource, and lenient** — `validateResource` resolves
`resourceType` → a zod schema → `safeParse` (`packages/fhir/src/validate.ts:19-38`). Schemas
are `.passthrough()` and nearly all fields are `.optional()`. Actually required:

| Resource | Required fields |
|---|---|
| `Specimen` | `resourceType` only — `{"resourceType":"Specimen"}` is valid |
| `DiagnosticReport` | `resourceType`, `status`, `code` |
| `Observation` | `resourceType`, `status`, `code` |

**CE is therefore not a safety net for mapping bugs.** Consequences this slice must respect:

- **Cross-resource clinical rules are not reachable by CE at all** — they span resources, and
  zod validates one resource in isolation. The two canonical examples are already **error**-level
  audit rules that quarantine upstream, before any push:
  `dob_after_specimen_date` (`apps/cli/src/audit/detector.ts:~208-230`, compares DOB against the
  earliest of taken/collected/received with a 1-day tolerance) and `specimen_missing`
  (`detector.ts:92-106`).
- **A stale message to fix:** `specimen_missing` says *"v2 storage will reject"*. **CE will not
  reject it** — CE is more lenient than v2 was. Correct the message; do not rely on CE.
- **`--no-check` is refused when the target is CE — enforced in code, not documentation.**
  On the v2 path, storage rejected specimen-less records as a backstop (hence
  `specimen_missing`'s message). CE has no such backstop, so on the CE path the audit gate is
  the *only* thing between bad source data and the store. `--no-check` (and any
  `--quarantine-severity` that disables the gate) must **exit non-zero before the first query
  runs** when a CE target is configured. A rule that depends on an operator reading a doc is
  not a rule; someone reaching for `--no-check` to force a stubborn batch through would land
  junk in the system of record silently.

**Mapper conformance is checked in cdr-toolchain's tests, not by CE.** Add
[`fhir-validator-js`](https://github.com/Outburn-IL/fhir-validator-js) (v1.4.1, 2026-06-28) as a
**devDependency**, run over the mapper's output. It wraps the official HL7 validator, so it
catches what CE waves through: bad date formats, wrong cardinality, invalid codes, missing
genuinely-required R4 fields. It self-provisions an Adoptium JRE and downloads the validator
JAR — no manual Java on dev or CI, and **it never ships**: the production CLI and any image
built from it require no JVM. Rejected alternatives: `@haste-health/fhir-validation`
(2 downloads/wk, last published 2026-01-20, repo link wrong — effectively abandoned) and
`@d4l/js-fhir-validator` (8 downloads/wk; JSON-schema only — no invariants, no profiles, so it
adds little over CE's zod).

## Testing

**Unit** (`fhir-transform`): the v2 `.example.json` bundle and `.v2.example.txt` encode the
same logical record, so `hl7-fhir.schema.js`'s `convert()` output is a known-good `V2Payload`
for a known-good FHIR bundle. Round-trip that fixture through the inverse mapping and assert
it reconstructs the bundle's resources. Add hand-built fixtures for the micro `hasMember` tree,
since the shipped example doesn't cover it.

**Conformance**: every resource the mapper emits passes `fhir-validator-js` against R4. Record
what strict R4 demands — that output is the input to the CE-strictness slice below.

**Audit**: add a rule asserting the mapper's output carries the fields CE's projection needs.
This defends the path we control; it is explicitly *not* a substitute for CE-side validation
(a different producer has no such gate).

**Live**, in order, gated at each step:
1. `--limit 1 --dry-run --emit-payloads` — inspect the FHIR without sending.
2. `--limit 1` against CE — verify one record lands in `fhir.fhir_resources`, check the
   `batchId` and the `data.persisted` event.
3. Widen to a small batch (`--limit 20`), confirm counts reconcile against the CLI summary.

**Gate:** `pnpm turbo run typecheck test --force` in `openldr_ce` (no code changes expected,
so this is a regression check); `pnpm turbo run typecheck test` in `cdr-toolchain`.

## Decisions on record (2026-07-16)

- **Full-fidelity PHI into the local dev Postgres (`:5433`) — approved.** Real Mozambique/Zambia
  patient data will land in a dev database on the development laptop. CE has redaction, and
  Zambia needs patient details to link with their EMR.
- **Running `--limit 1` against the live production DISA — approved.** Read-only is verified
  (39 `.query()` calls, all `SELECT`; zero write DML).
- **`abnormal_flag` → `Observation.interpretation` and `rpt_range` →
  `Observation.referenceRange` — confirmed.** The v2 schema's FHIR path nulls both
  (`hl7-fhir.schema.js:802-805`) while its v2 path populates them (`:192-194`); going
  FHIR-ward we map them rather than inherit the drop.
- **CE strictness levels — approved in principle, deferred to its own slice** (see below).

## Explicitly out of scope

- The marketplace plugin, its webview, and any wasm. (Deferred; see below.)
- Porting compare/audit into CE.
- An HTTP ingest route in CE core. The webhook path needs no CE code; if bulk volume later
  demands blob-backed batches, that is a separate decision.
- Pseudonymisation. Full-fidelity PHI is the explicit call.
- **Tightening CE's zod schemas.** Approved in principle, but a CE-core change with blast
  radius across sync, the projection worker, and existing producers. Its own slice.

## Follow-on: CE FHIR strictness levels (next slice, own spec)

Approved in principle 2026-07-16: **tighten CE's FHIR validation by default**, with a
strictness level — low / medium / high — settable in Settings and overridable on the
`persist-store` workflow node.

Rationale (the decisive argument): the CDR audit gate only defends *this* path. Any other
producer — a vendor plugin, another country's tooling, the DHIS2 path, a future
direct-from-DISA pusher — has no such gate, and CE accepts their output silently today. CE is
the system of record and cannot assume its producers validated first.

Why it is **not** in this slice: it is a CE-core change to `validateResource` with real blast
radius. Everything that persists FHIR today rides the lenient schemas — the `fhir-bundle`
converter (`packages/ingest/src/converters/fhir-bundle.ts`), plugins holding `emit-fhir`, the
seeds, and the sync workstream's `change_log` replay. Tightening by default may reject data CE
has already accepted, which must not land mid-live-sync-testing. That slice needs its own
"what breaks" investigation.

Sequencing: this slice's conformance run (above) establishes what strict R4 actually demands,
which defines what "high" means. Slice 1 informs slice 2.

Surfaces already exist: Settings feature flags, and `persist-store` already accepts node config
(`packages/workflows/src/host-nodes.ts:80`).

## Follow-on: review UI (not this slice)

The review UI, when it comes, needs no new CE machinery either: `POST /api/plugins/:id/broker`
already relays webview calls to the broker (`apps/server/src/plugin-ui-routes.ts`), `storage.*`
is ungated (`plugin-broker.ts` `gateFor` returns `undefined`), and the per-plugin document
store exists (`packages/db/src/plugin-data-store.ts`). `reference-plugins/ui-reference/` proves
exactly this surface. The CLI can file quarantine/audit/compare records via authenticated
`storage.put` broker calls, and a webview reads them back with `storage.list`.

Constraint to design around when that happens: `storage.list` caps at `limit ≤ 1000` and
`where` is a single `{field, eq}` (`plugin-broker.ts:81`) — a document store, not a query
engine.
