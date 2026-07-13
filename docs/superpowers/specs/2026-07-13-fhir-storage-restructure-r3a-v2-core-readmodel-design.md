# FHIR Storage Restructure — R3a: v2 Relational Read-Model (Core Lab Data) — Slice Design

**Date:** 2026-07-13
**Status:** Approved-pending-review (brainstorm). First sub-slice of **R3** in the restructure north-star (`docs/superpowers/specs/2026-07-13-fhir-internal-storage-restructure-design.md`). Builds on R2 (async projection worker, merged `331f1f8c`).
**Relates to:** `fhir-storage-restructure-workstream`, openldr-v2 `02-openldr_external.sql` (the target relational shape), `mysql-mariadb-target-workstream` + `mssql-toolchain` (engine-pluggable external target).

## Scope

R3 (grow the external read-model from the thin flat schema into the full v2 relational structure) is a large program that re-architects the analytics surface. **R3a proves the relational-projection pattern on core lab data only**, additively, without disturbing anything that works today.

**In scope:** project 4 core resource types into **v2-shaped relational tables** — `Patient → v2_patients`, `ServiceRequest → v2_lab_requests`, `Observation → v2_lab_results`, `Organization`/`Location → v2_facilities` — via a new relational projector wired into the R2 projection worker, **alongside** the existing thin flat projection; engine-aware DDL (PG/MSSQL/MySQL) reusing `dialect.ts`; a real-Postgres acceptance test.

**Out of scope (later R3 sub-slices):** AMR tables (`isolates`/`susceptibility_tests`/`breakpoints`/…); terminology replication + `concept_id` resolution; `Specimen`/`DiagnosticReport` projection; the full v2 column set (R3a populates the FHIR-derivable subset); migrating reports/dashboards/AMR/query-page off the thin schema; the eventual thin-schema cutover (rename `v2_*` → canonical + drop thin); live MSSQL/MySQL acceptance.

## Locked decisions (brainstorm)

1. **Foundational subset first** — 4 core resource types → 4 v2-shaped tables; prove the pattern, defer the rest.
2. **Additive** — the v2-core projection runs *alongside* the thin flat projection (a second write in the worker's apply path). Every existing report keeps reading the thin tables untouched. New `v2_*` tables have no consumers yet.
3. **FHIR-id keyed, soft references** — each table's `id` = the FHIR logical id (as the thin schema does); FK columns (`patient_id`, `request_id`, …) hold *referenced FHIR ids* with **no enforced FK constraints** (projection processes resources out of order, so hard FKs would fail). Diverges deliberately from v2's synthetic-UUID-PK + `patient_guid` model — this is a FHIR projection, not a v2-native ingest.
4. **Denormalize coded fields from the FHIR resource** — populate raw `*_code`/`*_system`/`*_desc` from the resource's own `CodeableConcept` (which carries the display text); leave `*_concept_id` FK columns null. No internal-terminology lookup in R3a.
5. **PG-first** — write engine-aware DDL + upsert for all three engines (reusing flat-writer's PG `onConflict` / MSSQL `MERGE` / MySQL `onDuplicateKey` patterns), but live-acceptance-test only Postgres in R3a.

**Table naming:** the thin schema already has `patients`; to coexist additively across all engines (MySQL has no portable schema-namespace), the v2-core tables are **table-name-prefixed** `v2_patients` / `v2_lab_requests` / `v2_lab_results` / `v2_facilities`. A later cutover slice renames them to the canonical v2 names and drops the thin schema.

## 1. Architecture

The R2 worker's `applyProjection` currently: canonical present → `flatWriter.write`; absent → `flatWriter.deleteById`. R3a adds a **second projector** so each changed resource is projected into *both* schemas:

```
applyProjection(task):
  canonical = fhirStore.get(type, id)
  if canonical:
     flatWriter.write(canonical)          // thin schema (existing; reports read this)
     relationalWriter.write(canonical)    // v2-core tables (new; no consumer yet)
  else:
     flatWriter.deleteById(type, id)
     relationalWriter.deleteById(type, id)
```

`reprojectAll` likewise writes both. `ProjectionDeps` gains `relationalWriter`; `db-context`/`index.ts` construct it from the same external DB + engine and pass it. No change to the frontier/cursor/change_log — R3a is purely a second downstream sink.

## 2. Target tables (v2-shaped, FHIR-id keyed, engine-aware)

Migration `external/003_v2_core` creates 4 tables in the external DB using `dialect.ts` type helpers (`keyType`/`textType`/`floatType`/`timestampType`/`nowExpr`) so one definition emits valid DDL on PG/MSSQL/MySQL. Each table uses v2's **column names** (forward-compatible) but only the **FHIR-derivable subset** of columns (later slices add the rest). `id` (keyType) is the PK; provenance columns (`source_system`, `plugin_id`, `plugin_version`, `batch_id`, `created_at`) mirror the thin tables. No enforced FK constraints.

- **`v2_patients`** (from `Patient`): `id`, `patient_guid`, `surname`, `firstname`, `date_of_birth`, `sex`, `national_id`, `phone`, `email` + provenance.
- **`v2_lab_requests`** (from `ServiceRequest`): `id`, `request_id`, `patient_id` (subject ref id, soft), `panel_code`, `panel_system`, `panel_desc`, `status`, `priority`, `authored_at` + provenance. (`panel_concept_id`, specimen/workflow columns → later.)
- **`v2_lab_results`** (from `Observation`): `id`, `request_id` (basedOn ServiceRequest ref id, soft), `observation_code`, `observation_system`, `observation_desc`, `result_type`, `numeric_value` (floatType), `numeric_units`, `coded_value`, `text_value`, `abnormal_flag`, `result_timestamp` + provenance. (`observation_concept_id`, ranges → later.)
- **`v2_facilities`** (from `Organization` and `Location` — both project here, keyed by their own FHIR id): `id`, `facility_code`, `facility_name`, `facility_type`, `source_resource` (`'Organization'`|`'Location'` discriminator) + provenance.

## 3. Relational projector (`packages/db/src/relational/`)

Mirrors `flatten/`: per-resource mappers + a `projectResource` dispatcher.
- `relational/patient.ts`, `service-request.ts`, `observation.ts`, `facility.ts` — each `(resource, prov) → row` for its `v2_*` table. Reuse the existing FHIR-extraction helpers (`flatten/extract.ts`: reference-id stripping, CodeableConcept code/system/text, value[x], identifier) so extraction logic isn't duplicated.
- `relational/index.ts`: `projectResource(resource, prov) → { table, row } | null` (switch on `resourceType`; `Organization`/`Location` both → `v2_facilities`; unknown → null) and `tableForResourceType(resourceType) → keyof ExternalSchema | null` (for delete).

## 4. Relational writer (`packages/db/src/relational-writer.ts`)

Mirrors `flat-writer.ts` — `createRelationalWriter(db, engine)` returning `{ write, writeMany, deleteById }`, engine-aware upsert-by-`id`. **DRY:** extract flat-writer's per-engine upsert helpers (`insertBatchPg`/`mergeBatchMssql`/`insertBatchMysql` + the single-row upsert + the param-budget chunking) into a shared `packages/db/src/upsert.ts` and reuse from both writers, rather than duplicating. `deleteById(resourceType, id)` resolves the `v2_*` table via `tableForResourceType` and `deleteFrom(table).where('id','=',id)`.

## 5. Wiring

- `ProjectionDeps` (`projection/cycle.ts`) gains `relationalWriter: RelationalWriter`; `applyProjection` + `reprojectAll` call it alongside `flatWriter` (§1).
- `db-context.ts` / `bootstrap/src/index.ts`: construct `relationalWriter = createRelationalWriter(externalDb, engine)` (same external store + engine as `flatWriter`) and pass into the projection runner.
- `external.ts` schema + `external/index.ts` migration list updated.

## 6. Testing strategy

- **Unit (pg-mem external DB via `makeMigratedExternalDb`, extended with the `003` migration):**
  - each mapper: a representative FHIR resource → correct `v2_*` row (denormalized codes, soft refs, sex/value mapping);
  - `projectResource` dispatch incl. Organization+Location → `v2_facilities`, unknown → null;
  - `relationalWriter` write/upsert/deleteById round-trip; `writeMany` batching;
  - `applyProjection`/`reprojectAll` populate BOTH thin and v2 tables (extend `cycle.test.ts`).
- **Real-Postgres acceptance:** extend `scripts/projection-live-acceptance.ts` with a v2-core phase — persist Patient + ServiceRequest + Observation + Organization, run cycles, assert `v2_patients`/`v2_lab_requests`/`v2_lab_results`/`v2_facilities` are populated with the right denormalized fields + soft refs; delete → v2 row removed; `reprojectAll` rebuilds them. (`pnpm projection:accept`.)

## 7. Open items (resolve at slice/plan time)

- Exact FHIR→column mappings per field (e.g. `sex` = `gender` first-letter uppercased M/F/U/O; `result_type` from `value[x]` kind) — pin in the plan against the existing thin flatteners for consistency.
- `v2_lab_results.request_id` source: `Observation.basedOn` (ServiceRequest) primarily; null if absent — confirm in the plan.
- Whether the second projection should be flag-gated (default: always-on; no flag — YAGNI; the `v2_*` tables are new with no consumers) — settle at plan.
- Later sub-slices (not R3a): Specimen/DiagnosticReport; AMR tables + isolate/AST derivation at projection time; terminology replication + `concept_id` resolution; full v2 column set; report migration + thin cutover; live MSSQL/MySQL acceptance.
