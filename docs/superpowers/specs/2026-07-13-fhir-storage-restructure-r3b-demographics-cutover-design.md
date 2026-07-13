# FHIR Storage Restructure — R3b: First Report Cutover (Patient Demographics → v2) — Slice Design

**Date:** 2026-07-13
**Status:** Approved-pending-review (brainstorm). Sub-slice of **R3** (restructure north-star `docs/superpowers/specs/2026-07-13-fhir-internal-storage-restructure-design.md`). Builds on R3a (v2-core read-model, merged `29f11729`).
**Relates to:** `fhir-storage-restructure-workstream`, `reports-page-workstream`, `query-model-expansion-workstream` (built-in reports as seeded queries), `mysql-mariadb-target-workstream`/`mssql-toolchain` (cross-dialect report parity harness).

## Scope

R3a proved projection *into* the v2 read-model but nothing read it. R3b **cuts one real consumer over to v2** — the `q-patient-demographics` built-in report now reads `v2_patients` instead of the thin `patients` — to de-risk the eventual full report cutover and realize visible value. The report's cross-dialect parity harness is the correctness safety net.

**In scope:** add `managing_organization` to `v2_patients` (migration + type + mapper); rewrite `q-patient-demographics`'s 3 engine SQL variants (PG/MSSQL/MySQL) in the report seed to read `v2_patients`; teach the report-parity fixture/harness to also seed the v2 tables (via `createRelationalWriter`) so the harness stays meaningful; a real-Postgres correctness proof that the v2-reading report returns the same demographic bands as before.

**Out of scope (later):** cutting over the other 8 reports; the query-page/dashboard/AMR cutovers; renaming `v2_*` → canonical + dropping the thin schema; live MSSQL/MySQL parity run (PG-first); an **upgrade re-seed** so existing installs pick up the new SQL (the seed is idempotent-by-name — R3b changes fresh-install + test behavior; existing-install migration is a documented deployment follow-up).

## Locked decisions (brainstorm)

1. **Target = `q-patient-demographics`** — cleanest single-table map to `v2_patients` (age band from `date_of_birth`, gender from `sex`, facility from `managing_organization`).
2. **In-place cutover** — the report's seeded SQL reads `v2_patients` directly; thin `patients` no longer used by this report. (Existing installs keep the old SQL until an upgrade re-seed — noted, deferred.)
3. **`managing_organization` on `v2_patients` = the FULL reference** (`"Organization/seed-org"`), via `reference()` not `referenceId()` — because the report's facility param and the thin column are the full reference string; a bare id would break the filter. (A deliberate exception to R3a's bare-id soft refs, required for behavior parity.)
4. **PG-first proof** — real-Postgres correctness test; the cross-dialect harness fixture is updated to seed v2 (so it doesn't silently compare empty-vs-empty), but live MSSQL/MySQL parity runs stay deferred.

## 1. `managing_organization` on `v2_patients`

- **Migration `external/004_v2_patients_facility`** (engine-aware, `(db, engine)`): `alter table v2_patients add column managing_organization <textType>`. (pg-mem/PG/MSSQL/MySQL all support `ADD COLUMN`; reuse `dialect.ts`.) `down` drops it.
- **Schema type:** add `managing_organization: string | null` to `V2PatientsTable`.
- **Mapper (`relational/patient.ts`):** add `managing_organization: reference(r['managingOrganization'])` (the full `"Organization/id"` reference, matching the thin flattener `flatten/patient.ts` and the report's facility param format). Import `reference` from `../flatten/extract`.

## 2. Rewrite `q-patient-demographics` SQL (in `packages/reporting/src/seed/report-seeds.ts`)

For each of the 3 dialect variants (postgres/mssql/mysql), the substitutions are mechanical and behavior-preserving:
- `from patients p` → `from v2_patients p`
- `p.birth_date` → `p.date_of_birth`
- `p.managing_organization` → `p.managing_organization` (unchanged name; now exists on v2)
- gender→sex code mapping in the aggregate + `other`:
  - `sum(case when gender = 'male' …)` → `sum(case when sex = 'M' …)`
  - `sum(case when gender = 'female' …)` → `sum(case when sex = 'F' …)`
  - `sum(case when gender is null or gender not in ('male','female') …)` → `sum(case when sex is null or sex not in ('M','F') …)`

**Parity rationale:** `v2_patients.sex` is `M`/`F`/`O`/`U`/null via the mapper (`gender ? SEX[gender] ?? 'U' : null`). The `other` bucket (`sex is null or sex not in ('M','F')`) captures null (absent gender) + `O` (gender `other`) + `U` (gender `unknown`/unrecognized) — exactly the thin report's "null gender + any non-male/female" set. Age banding is unchanged (`date_of_birth` holds the same ISO string thin's `birth_date` did). So the v2 report is output-identical to the thin report on the same FHIR data.

## 3. Parity fixture/harness seeds v2

- `scripts/lib/reports-parity-fixture.ts` + the harness scripts (`scripts/mssql-reports-parity.ts`, `scripts/mysql-reports-parity.ts`) migrate the external schema (now includes v2 migrations `003`/`004`) and seed the FHIR fixture via `createFlatWriter`. Add a parallel `createRelationalWriter` seeding of the SAME fixture so the `v2_*` tables are populated in each engine — otherwise the now-v2 `q-patient-demographics` query compares empty-vs-empty (a false pass).
- No fixture DATA change (the existing `patients` fixture already has `gender`/`birthDate`/`managingOrganization` covering every band/edge). Only the seeding step gains the relational writer.

## 4. Real-Postgres correctness proof

A real-PG integration check (new `scripts/demographics-cutover-accept.ts`, or a phase reusing the existing acceptance harness pattern) that: migrates the external target (incl. `v2_patients` + `managing_organization`); seeds the report-parity FHIR `patients` fixture via BOTH `createFlatWriter` and `createRelationalWriter`; runs the rewritten `q-patient-demographics` **postgres** SQL for a few param cases; and asserts the expected `{band,total,male,female,other}` rows + fixed band order (the values the parity-test doc-comment enumerates: e.g. `facility:''` → all bands incl. `unknown` folding null/future birthdates; `facility:'Organization/…'` → the facility-scoped subset; the `other` bucket catching the null-gender + `other`-gender patients). Proves the cutover is correct end-to-end against real Postgres. `pnpm demographics:accept` (or fold into `projection:accept`).

## 5. Testing strategy

- **Unit (pg-mem):** migration `004` adds the column (extend the external migration test); `projectPatient` populates `managing_organization` with the full reference (extend `relational.test.ts`).
- **Real-Postgres:** the §4 correctness proof (v2 report ≡ expected bands); the cross-dialect harness updated to seed v2 (kept green on PG; MSSQL/MySQL live runs deferred).

## 6. Open items (resolve at slice/plan time)

- Whether the §4 proof is a standalone script (`demographics:accept`) or a phase appended to `projection:accept` — settle at plan (lean standalone: it needs the warehouse-report run path + fixture, distinct from the projection-worker acceptance).
- Upgrade re-seed for existing installs (update the stored `q-patient-demographics` SQL, not skip-by-name) — deferred deployment follow-up; note in the plan, don't build in R3b.
- The other 8 reports + the thin-schema cutover/drop — later sub-slices.
