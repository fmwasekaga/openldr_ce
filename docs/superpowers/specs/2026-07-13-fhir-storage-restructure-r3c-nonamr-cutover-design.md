# FHIR Storage Restructure — R3c: Cut Over the Non-AMR Reports (→ v2) — Slice Design

**Date:** 2026-07-13
**Status:** Approved-pending-review (brainstorm). Sub-slice of **R3 / the full cutover program** (north-star `docs/superpowers/specs/2026-07-13-fhir-internal-storage-restructure-design.md`). Builds on R3b (first cutover, merged `96b676ed`).
**Relates to:** `fhir-storage-restructure-workstream`, `reports-page-workstream`, `query-model-expansion-workstream`.

## Scope

The full cutover (drop the thin schema) is a 3-sub-slice program: **R3c (non-AMR reports)** → R3d (AMR) → R3e (rename `v2_*`→canonical + drop thin). R3c moves the 3 non-AMR reports off thin, extending the R3b mechanic, and adds the two v2 tables one of them needs.

**In scope:** add `v2_specimens` + `v2_diagnostic_reports` tables (mappers + projection); cut over `q-facilities`, `q-test-volume`, `q-turnaround-time` in-place (all 3 engine variants each); prove each `thin ≡ v2` on real PG; extend the parity harness wipe-list.

**Out of scope (later):** the 5 AMR reports + AMR catalog code (`amr/query.ts`, `reports/amr-isolates.ts`) — R3d; the rename/drop-thin finale, `export-data`/`helpers`/dashboard repointing, upgrade re-seed — R3e; live MSSQL/MySQL parity (PG-first); Specimen/DiagnosticReport columns beyond what these reports need.

## Grounded report requirements (verified in `report-seeds.ts`)

- **`q-facilities`** (`select distinct managing_organization from patients`): → `from v2_patients`. `v2_patients.managing_organization` already exists (R3b). No new columns.
- **`q-test-volume`** (reads only `service_requests`: `authored_on`, `code_text`; NO patient join, NO facility filter in SQL): → `from v2_lab_requests`, `authored_on`→`authored_at`, `code_text`→`panel_desc`. No new columns.
- **`q-turnaround-time`** (reads `specimens`: `subject_ref`,`received_time`; `diagnostic_reports`: `subject_ref`,`issued`,`code_text`; facility subquery to `patients`): → needs `v2_specimens` + `v2_diagnostic_reports`; join rewritten to bare `patient_id` (see §2).

## Locked decisions (extending R3a/R3b's patterns)

1. **Additive, in-place, thin≡v2-proven** — same mechanic as R3b: v2 tables/columns land alongside thin; report SQL rewritten in-place; a real-PG proof asserts the v2 report output is byte-identical to the pre-cutover thin output over one FHIR fixture.
2. **Bare `patient_id` soft refs** (consistent with `v2_lab_requests`/`v2_lab_results`) — `v2_specimens.patient_id` = `referenceId(subject)`, `v2_diagnostic_reports.patient_id` = `referenceId(subject)`. The turnaround join (thin: `specimens.subject_ref = diagnostic_reports.subject_ref`) becomes `r.patient_id = dr.patient_id`; the facility subquery (thin: `dr.subject_ref in (select 'Patient/'||p.id …)`) becomes `dr.patient_id in (select p.id from v2_patients p …)`. Behavior-preserving because both resources' subjects map identically, and `v2_patients.id` = the bare FHIR id.

## 1. New v2 tables (migration `external/005_v2_specimen_diagreport`, engine-aware)

Mirror the `003`/`004` `withCommon` + `dialect.ts` pattern. FHIR-id keyed (`id`), provenance columns, no enforced FKs. v2 column names, FHIR-derivable subset.

- **`v2_specimens`** (from `Specimen`): `id`, `patient_id` (subject bare), `received_time`, `accession`, `status`, `type_code`, `type_text` + provenance.
- **`v2_diagnostic_reports`** (from `DiagnosticReport`): `id`, `patient_id` (subject bare), `status`, `code_code`, `code_text`, `issued`, `effective`, `conclusion` + provenance.

Schema types (`schema/external.ts`): `V2SpecimensTable`, `V2DiagnosticReportsTable` extending `ProvenanceColumns` + `ExternalSchema` keys. Add both to `EXTERNAL_TABLE_COLUMNS` in `export-data.ts` (keep exhaustive; `exportFlatTables` still ignores v2).

## 2. Mappers (`relational/`)

- `relational/specimen.ts` (`projectSpecimen`): `id`, `patient_id: referenceId(r['subject'])`, `received_time: str(r['receivedTime'])`, `accession`/`status`/`type_*` via existing extract helpers (mirror `flatten/specimen.ts`).
- `relational/diagnostic-report.ts` (`projectDiagnosticReport`): `id`, `patient_id: referenceId(r['subject'])`, `status`, `code_code`/`code_text` (`codeable(r['code'])`), `issued`, `effective` (`effectiveDateTime`), `conclusion` (mirror `flatten/diagnostic-report.ts`).
- `relational/index.ts` `projectResource` + `v2TableForResourceType`: add `Specimen → v2_specimens`, `DiagnosticReport → v2_diagnostic_reports`. (The relational writer + projection worker then project them automatically; the parity harness already routes every fixture item through `createRelationalWriter`, so these auto-seed once the mappers exist.)

## 3. Report SQL rewrites (in-place, `report-seeds.ts`, all 3 dialect variants each)

- **`q-facilities`:** `from patients` → `from v2_patients`. (managing_organization unchanged.)
- **`q-test-volume`:** `from service_requests sr` → `from v2_lab_requests sr`; `sr.authored_on` → `sr.authored_at`; `sr.code_text` → `sr.panel_desc`.
- **`q-turnaround-time`:** `from specimens` → `from v2_specimens`; `from diagnostic_reports dr` → `from v2_diagnostic_reports dr`; `from patients p` → `from v2_patients p`; the `received` CTE groups by `patient_id` (was `subject_ref`) with `received_time`; the join `r.subject_ref = dr.subject_ref` → `r.patient_id = dr.patient_id`; the facility subquery `dr.subject_ref in (select 'Patient/' || p.id …)` → `dr.patient_id in (select p.id from v2_patients p where p.managing_organization = {{param.facility}})`. All else (date filters, hours math, grouping, ordering) unchanged. Update each report's explanatory comment to note the v2 cutover.

## 4. Parity harness + real-PG proof

- `scripts/lib/reports-parity-fixture.ts` `TABLES`: add `v2_specimens`, `v2_diagnostic_reports` to the wipe list (the harness already seeds them via `createRelationalWriter` once the mappers exist).
- **Proof:** generalize `scripts/demographics-cutover-accept.ts` (or add `scripts/reports-cutover-accept.ts` / `pnpm reports:accept`) to prove EACH cut-over report — `q-patient-demographics` (existing), `q-facilities`, `q-test-volume`, `q-turnaround-time` — against a verbatim copy of its PRE-cutover PG SQL: seed the fixture into both schemas (flat + relational), run OLD-thin vs NEW-v2 PG SQL for representative param bags, assert `firstDiff` null (identical). No hand-computed expecteds. Settle standalone-vs-extend at plan time (lean: a general `reports-cutover-accept.ts` parameterized over `{id, thinPgSql, paramBags}`, folding in demographics).

## 5. Testing strategy

- **Unit (pg-mem):** migration `005` creates the tables (test); `projectSpecimen`/`projectDiagnosticReport` map correctly + `projectResource` dispatch (extend `relational.test.ts`).
- **Real-Postgres:** the §4 proof (each report thin≡v2); harness wipe-list updated.

## 6. Open items (resolve at slice/plan time)

- Proof script shape (extend `demographics-cutover-accept` vs new parameterized `reports-cutover-accept`) — plan.
- `q-test-volume`'s pre-cutover comment says the catalog declares but never applies `facility` — the cutover keeps that faithfully (no facility in the SQL). Confirm at plan.
- After R3c: 4/9 reports on v2 (demographics/facilities/test-volume/turnaround-time); remaining = the 5 AMR reports (R3d) + AMR catalog code; then R3e rename/drop.
