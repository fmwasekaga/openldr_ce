# Phase-2 sub-project 2 — Terminology service (Slice A, headless)

**Date:** 2026-06-14
**Status:** Approved design (ready for implementation planning)
**PRD:** `openldr-ce-prd-phase2.md` — P2-TERM-1/2/3/4 + the `terminology` CLI (§3) + a FHIR-style terminology HTTP API. **Deferred to later slices:** P2-TERM-5 (management UI), P2-TERM-6 (ingest binding-validation).
**Build-sequence step:** Phase-2 §7 step 2 (sliced)

---

## 1. Purpose & scope

Deliver a **headless terminology service**: store and serve FHIR `CodeSystem`/`ValueSet`/`ConceptMap`, run the four core terminology operations, and load real LOINC + WHONET-derived AMR reference terminology. This is the foundation forms, DHIS2 mappings, and reports bind to (later slices).

Mirrors the Phase-1 forms-engine precedent (headless engine first; UI deferred). The data model reuses the Phase-1 **canonical-jsonb + denormalized-index** pattern: canonical terminology resources in `fhir_resources`, plus a `terminology_concepts` index for fast operations (proven: 109k LOINC concepts load in ~4.4 s, indexed lookup ~2 ms — see [[terminology-data]]).

**In scope (Slice A):**
- `CodeSystem`/`ValueSet`/`ConceptMap` zod schemas added to `@openldr/fhir` (registered).
- New internal migration `007_terminology` (`terminology_concepts`, `terminology_systems`, `concept_map_elements`).
- `TerminologyStore` in `@openldr/db`; new `@openldr/terminology` package with the 4 operations (`$lookup`, `$validate-code`, `$expand`, `$translate`) + loaders.
- Loaders: generic FHIR-terminology JSON import; LOINC CSV loader (license-gated); WHONET-AMR loader (antibiotics + organisms from a WHONET fixture) + a WHONET→LOINC ConceptMap.
- CLI: `terminology import|lookup|validate-code|expand|translate`.
- HTTP API: FHIR-style `$lookup`/`$validate-code`/`$expand`/`$translate` endpoints on `apps/server`.
- Live acceptance against real LOINC + WHONET fixtures.

**Out of scope (deferred):**
- Terminology management **UI** + custom ValueSet authoring screens (P2-TERM-5 → Slice B).
- Ingest-time **binding validation** (coded results validated vs bound ValueSets) + forms/DHIS2 binding (P2-TERM-6 → Slice C).
- RxNorm / SNOMED (PRD §6 Open Decision); **materialized** ValueSet expansions (on-the-fly only); full FHIR terminology-service conformance (a pragmatic subset).
- Committing licensed LOINC/WHONET data to the repo — loaders read operator-provided fixtures (only tiny synthetic samples are committed for tests).

---

## 2. Cross-cutting principles this sub-project demonstrates

- **DP-6 FHIR R4 native** — terminology is FHIR `CodeSystem`/`ValueSet`/`ConceptMap`; operations return FHIR `Parameters`/`ValueSet`/`OperationOutcome` shapes.
- **DP-4 Agent-operability** — every `terminology` CLI verb supports `--json`; the HTTP ops are inspectable.
- **DP-5 Lean** — hand-written zod subset; denormalized index instead of a full terminology engine; on-the-fly expansion.
- **DP-1** — `@openldr/terminology` is a domain package (no adapters); `@openldr/db` owns the schema/store; bootstrap wires it.
- **P2-TERM-1/2/3/4** — storage, the four ops, LOINC loader, AMR reference terminology.

---

## 3. Packages & boundaries

- **`@openldr/fhir`** (extended) — add `CodeSystem`/`ValueSet`/`ConceptMap` schemas + register them.
- **`@openldr/db`** (extended) — migration `007_terminology`; `TerminologyStore` (Kysely over the internal DB): concept upsert/query, terminology-resource save/resolve-by-url, concept-map element upsert/query.
- **`@openldr/terminology`** (new domain package) — imports `@openldr/fhir` + `@openldr/db` + `@openldr/core` (+ `csv-parse` for the LOINC loader, `node:sqlite` for the WHONET loader). Holds: the 4 operations over a `ConceptSource` interface (unit-testable with an in-memory source), and the loaders.
- **`@openldr/bootstrap`** — exposes `ctx.terminology` (the service bound to the live `TerminologyStore`).
- **`apps/server`** — terminology HTTP routes. **`@openldr/cli`** — `terminology` commands.

`@openldr/terminology` must NOT import any `adapter-*` (DP-1; depcruise-enforced).

---

## 4. FHIR terminology resources (P2-TERM-1)

Add to `@openldr/fhir/src/resources/` (CE subset, `.passthrough()` to preserve extras, registered):
- **`CodeSystem`**: `url`, `version`, `name`, `status`, `content` (`complete|not-present|fragment`), `concept[]` (`code`, `display`, `property[]`).
- **`ValueSet`**: `url`, `version`, `name`, `status`, `compose.include[]/exclude[]` (each: `system`, `concept[]` (explicit), `filter[]` (`property`,`op`,`value`)), and `expansion.contains[]` (populated by `$expand`).
- **`ConceptMap`**: `url`, `version`, `status`, `sourceUri`/`targetUri`, `group[]` (`source`, `target`, `element[]` (`code`, `target[]` (`code`, `equivalence`))).

For LOINC, the stored `CodeSystem` has `content: 'not-present'` (the 109k concepts live in the index, not in the resource).

---

## 5. Storage — internal migration `007_terminology`

Three internal tables (Postgres; the internal DB is always Postgres):
- **`terminology_concepts`**: `system text`, `code text`, `display text`, `status text`, `properties jsonb`, PK `(system, code)` (the proven indexed point-lookup shape). Populated by the loaders.
- **`terminology_systems`**: `url text PK`, `version text`, `kind text` (`CodeSystem|ValueSet|ConceptMap`), `resource_id text` (FK-ish to `fhir_resources.id`) — resolves a canonical URL to its stored resource.
- **`concept_map_elements`**: `map_url text`, `source_system text`, `source_code text`, `target_system text`, `target_code text`, `equivalence text`, indexed `(map_url, source_system, source_code)` — the `$translate` fast path.

Canonical `CodeSystem`/`ValueSet`/`ConceptMap` resources are saved in `fhir_resources` (jsonb) via `FhirStore`; `terminology_systems` indexes them by `url`.

`TerminologyStore` (in `@openldr/db`) is the only SQL surface: `upsertConcepts(batch)`, `getConcept(system, code)`, `findConcepts({system, filter, limit, offset})`, `countConcepts(...)`, `saveResource(resource)` (+ `terminology_systems` row), `resolveUrl(url)`, `upsertMapElements(batch)`, `translate(mapUrl|source, system, code)`.

---

## 6. The four operations (P2-TERM-2) — `@openldr/terminology`

Pure logic over a `ConceptSource` interface (the `TerminologyStore` implements it; tests use an in-memory fake):
- **`lookup(system, code)`** → `{ found, display, properties }` (→ FHIR `Parameters`). Indexed point query.
- **`validateCode({ system, code } | { valueSetUrl, code, system? })`** → `{ result: boolean, message }`. CodeSystem mode: concept exists. ValueSet mode: code is in the ValueSet's expansion (resolve compose → indexed query).
- **`expand(valueSetUrl, { filter?, count=100, offset=0 })`** → `ValueSet` with `expansion.contains[]` + `expansion.total`, **paginated**. Compose support: `include` by whole system, explicit `concept[]` lists, and simple `filter` (`property = value`, `code is-a` where the index supports it); union of includes minus excludes, computed on-the-fly via indexed queries. Unsupported/over-broad filters return an `OperationOutcome` rather than scanning unboundedly.
- **`translate(conceptMapUrl | { system, code, targetSystem })`** → matching `{ targetSystem, targetCode, equivalence }[]` (→ `Parameters`). Indexed query on `concept_map_elements`.

All return discriminated results that the CLI/HTTP layers render as FHIR `Parameters`/`ValueSet`/`OperationOutcome`.

---

## 7. Loaders (P2-TERM-3/4)

A shared `LoadResult { system, conceptsLoaded, resourceUrl }`. All upsert via `TerminologyStore` (idempotent on `(system, code)`).

- **Generic** `importTerminologyResource(json)` — validate a FHIR `CodeSystem`/`ValueSet`/`ConceptMap` (via `@openldr/fhir`), save canonical, and for an inline-`concept[]` CodeSystem populate the index; for a ConceptMap populate `concept_map_elements`.
- **LOINC** `loadLoinc(loincTableDir, { acceptLicense })` — **throws unless `acceptLicense` is true** (P2-TERM-3). Streams `LoincTable/Loinc.csv` (`csv-parse`) → concepts `{ system: 'http://loinc.org', code: LOINC_NUM, display: LONG_COMMON_NAME, status: STATUS, properties: { COMPONENT, PROPERTY, SYSTEM, SCALE_TYP, METHOD_TYP, CLASS } }`, batched (1000/insert); saves a `content: 'not-present'` LOINC `CodeSystem` header.
- **WHONET-AMR** `loadWhonetAmr(whonetSqlitePath)` — reads a WHONET code sqlite (e.g. `ASIARS-Net.sqlite`) via `node:sqlite`: joins `Antibiotics_ForwardLookup` (WHONET abbrev → numeric) with `Antibiotics_ReverseLookup` (numeric → name) → an **antibiotic CodeSystem** (`http://whonet.org/fhir/CodeSystem/antibiotic`, code = WHONET abbrev e.g. AMP/CIP/GEN, display = name) + an "all antibiotics" ValueSet; same for `Organisms_*` → an **organism CodeSystem** + ValueSet. Also emits a **WHONET→LOINC antibiotic ConceptMap** by matching antibiotic display names to LOINC `ABXBACT` susceptibility components (e.g. AMP → `101477-8` Ampicillin) — populating `concept_map_elements` for `$translate`.
- A **tiny committed AMR sample** (`@openldr/terminology` test fixture: a handful of antibiotic + organism codes incl. AMP/CIP/GEN) backs unit tests + a minimal default ValueSet, so tests need no licensed fixtures.

LOINC and WHONET licensed data are **operator-provided** (read from a fixture path); the repo commits only the tiny synthetic sample.

---

## 8. CLI (PRD §3)

`openldr terminology`:
- `import loinc <loincTableDir> --accept-license [--json]`
- `import amr <whonetSqlitePath> [--json]`
- `import resource <fhir-json-file> [--json]` (generic CodeSystem/ValueSet/ConceptMap)
- `lookup <system> <code> [--json]`
- `validate-code --system <s> --code <c> [--valueset <url>] [--json]`
- `expand <valueSetUrl> [--filter <p=v>] [--count <n>] [--offset <n>] [--json]`
- `translate <conceptMapUrl> --system <s> --code <c> [--json]`

Each prints a human summary or FHIR JSON (`--json`); non-zero exit on validate-code = false / not-found, consistent with the existing CLI error map.

---

## 9. HTTP API (FHIR-style)

On `apps/server`, under `/api/terminology` (registered before the SPA fallback, like the reports routes):
- `GET /api/terminology/CodeSystem/$lookup?system=&code=` → `Parameters`.
- `GET /api/terminology/ValueSet/$validate-code?url=&system=&code=` → `Parameters`.
- `GET /api/terminology/ValueSet/$expand?url=&filter=&count=&offset=` → `ValueSet`.
- `GET /api/terminology/ConceptMap/$translate?url=&system=&code=` → `Parameters`.
Error map reuses the existing 400 (bad params)/404 (unknown url)/503 (conn)/500 pattern; bind via `ctx.terminology` from bootstrap.

---

## 10. Testing & live acceptance

- **Unit (no DB; stays in `pnpm test`):** the 4 ops over an in-memory `ConceptSource` (lookup hit/miss; validate-code in/out of a ValueSet; expand pagination + compose include/exclude/filter; translate hit/miss). The LOINC CSV-row→concept mapping (parse a few sample rows). The WHONET join → CodeSystem mapping (over a tiny synthetic sqlite or fixture rows). FHIR schema validation of the three new resources.
- **Live acceptance (real fixtures + DB):**
  1. `db migrate` (adds `007_terminology`).
  2. `terminology import loinc D:/Projects/Repositories/corlix/fixtures/Loinc/2.82/LoincTable --accept-license` → ~109k concepts (~seconds).
  3. `terminology lookup http://loinc.org 2160-0` → "Creatinine [Mass/volume] in Serum or Plasma".
  4. `terminology import amr D:/Projects/Repositories/corlix/fixtures/WHONET/Codes/ASIARS-Net.sqlite` → antibiotic + organism CodeSystems/ValueSets + WHONET→LOINC ConceptMap.
  5. `terminology expand http://whonet.org/fhir/ValueSet/antibiotics` → contains **AMP/CIP/GEN** (the codes the AMR report uses).
  6. `terminology validate-code --system http://whonet.org/fhir/CodeSystem/organism --code <known>` → true; an unknown code → false.
  7. `terminology translate <whonet→loinc map> --system http://whonet.org/fhir/CodeSystem/antibiotic --code AMP` → a LOINC ABXBACT target (e.g. `101477-8`).
  8. The same via the HTTP `$lookup`/`$expand`/`$validate-code`/`$translate` endpoints (curl/Playwright request) returning FHIR JSON.
  9. `$expand` a LOINC-based ValueSet with `count`/`offset` → paginated.
- `pnpm typecheck && pnpm test && pnpm depcruise && pnpm build:check` green.

Passing the acceptance demonstrates **P2-TERM-1/2/3/4**.

---

## 11. Risks & mitigations

- **$expand over a whole-of-LOINC ValueSet** could return 109k rows → always paginate (`count` default 100, `expansion.total` from a count query); reject unbounded filter ops with an `OperationOutcome`.
- **CSV robustness** (quoted commas/newlines) → `csv-parse` streaming (validated in the probe); `--accept-license` gate prevents accidental import.
- **WHONET sqlite shape varies by surveillance config** → the loader targets the `Antibiotics_*`/`Organisms_*` Forward/Reverse lookup tables (present in `ASIARS-Net.sqlite`); if a provided sqlite lacks them, fail with a clear message naming the expected tables.
- **IP boundary (§10/IP):** loaders read operator-provided licensed data (LOINC/WHONET) — not committed; the WHONET-derived CodeSystems are CE-authored extracts of standard codes, not copied Corlix source. Only a tiny synthetic AMR sample is committed.
- **Concept index vs canonical drift** → the loaders write both in one operation; `terminology_systems` is the single URL resolver.
- **node:sqlite is experimental** (Node 24) → already used in Phase-1 (`make-whonet-sample`); acceptable, isolated to the WHONET loader.
