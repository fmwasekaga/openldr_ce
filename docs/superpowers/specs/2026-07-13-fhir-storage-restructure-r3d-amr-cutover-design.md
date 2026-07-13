# FHIR Storage Restructure — R3d: AMR reports + catalog code cutover to v2

**Date:** 2026-07-13
**Slice:** R3d (restructure) — the AMR sub-slice of the full drop-thin cutover
**Branch:** `feat/fhir-amr-cutover`
**Predecessors:** R0/R1/R2/R3a/R3b/R3c DONE + merged + pushed (`origin/main` `7fa6b317`)
**Successor:** R3e (rename `v2_*`→canonical + drop thin schema)

## Context

The FHIR storage restructure moved to an async-projection CQRS model: an internal versioned
canonical `fhir` schema → append-only `change_log` → projection worker → external read models.
The external read surface is being migrated from the legacy **thin** flat tables
(`observations`/`specimens`/`patients`/…) to the **v2** relational read model
(`v2_lab_results`/`v2_specimens`/`v2_patients`/…).

The full cutover (so the thin schema can be dropped in R3e) is a 3-sub-slice program:

- **R3c (DONE):** 3 non-AMR reports (`q-facilities`, `q-test-volume`, `q-turnaround-time`) +
  `v2_specimens`/`v2_diagnostic_reports`, proven via `scripts/reports-cutover-accept.ts`.
- **R3d (THIS SPEC):** the 5 AMR reports + the AMR catalog code.
- **R3e (NEXT):** rename `v2_*`→canonical, drop thin, repoint remaining helpers.

After R3c, 4/9 reports read v2. R3d moves the remaining 5 (all AMR), leaving only R3e's
rename/drop.

## Goal

Cut every remaining thin AMR consumer onto v2, so R3e can drop the thin schema without breaking
AMR. Behavior must be preserved: the new v2-reading SQL must produce byte-identical report output
to the current thin-reading SQL, proven on real Postgres over a fixed FHIR fixture.

PG-first, matching R3c: the Postgres variant is proven by the accept harness; the MSSQL/MySQL
variants are ported by the same mechanical rules R3c used, but their live parity is deferred (no
live MSSQL/MySQL parity run in this slice).

## The decision (resolved in brainstorming)

**Chosen: Option B — query-time derivation over the v2 relational tables.**

Two approaches were weighed:

- **Option A — projection-time AMR tables.** Build `v2_isolates` + `v2_susceptibility_tests` and
  move the `buildIsolates` derivation (organism Observation ⨯ its AST Observations, correlated by
  specimen) into the projection worker. Reports then read clean AMR tables. Rejected: this requires
  a genuinely new *cross-resource* projection pattern (the current relational mappers are
  1-resource→1-row; AMR needs many-resources→aggregated-rows, with ordering/update/delete
  correlation across resources that may arrive in any order). High-risk new machinery,
  disproportionate to R3d's goal.

- **Option B — query-time over v2 (CHOSEN).** The gap between what the AMR derivation reads and
  what v2 already exposes turned out to be only **3 additive columns**. Adding them lets the AMR SQL
  derive isolates/AST at query time exactly as today, with the CTE logic unchanged. This is the
  identical mechanic proven in R3b/R3c (additive columns → SQL rewrite → thin≡v2 accept proof),
  carries no new projection machinery, and does not foreclose Option A later: because
  `v2_lab_results` will now carry the patient/specimen linkage, native AMR tables could be added as
  a 3rd projection sink in a future slice if ever wanted.

## What reads thin today (R3d scope)

The old catalog reports (`amr-resistance.ts`, `amr-glass-ris.ts`, etc.) were already removed in
prior slices — `packages/reporting/src/reports/` now contains only `amr-isolates.ts`. The remaining
thin AMR consumers are:

1. **The 5 `q-amr-*` seed SQL reports** (`packages/reporting/src/seed/report-seeds.ts`) — the live
   report path (Reports page / `runStoredQuery`). Each has 3 engine variants (postgres/mssql/mysql):
   - `q-amr-resistance` (~L130)
   - `q-amr-facility-summary` (~L560)
   - `q-amr-glass-ris` (~L630)
   - `q-amr-first-isolate-summary` (~L963)
   - `q-amr-antibiogram` (~L1239)

2. **`amrIsolates` EventSource** (`packages/reporting/src/reports/amr-isolates.ts`) — registered in
   `eventsource.ts`'s `SOURCES`, consumed via `runEventSource` by DHIS2 orchestration
   (`packages/bootstrap/src/dhis2-orchestration.ts`) to push AMR isolates to DHIS2. Reads thin
   `observations` + `patients`. **Live.**

3. **`fetchAmrData`** (`packages/reporting/src/amr/query.ts`) — exported from the package index
   (`export * from './amr/query'`) but has **no live in-repo caller** (referenced only in seed-SQL
   comments as the parity oracle). Reads thin `observations`/`specimens`/`patients`. Because R3e will
   drop thin from the `ExternalSchema` type, its `db.selectFrom('observations')` calls would fail to
   typecheck; it must be repointed (chosen) or deleted.

Not in scope (pure, DB-free — untouched): `buildIsolates` + `firstIsolate` (`amr/isolates.ts`),
`toGlassRis`/aggregation (`amr/glass.ts`, `amr/aggregate.ts`) and their unit tests operate on
in-memory `Isolate[]`/`Raw*` inputs.

## What v2 already has vs. what AMR needs

Every AMR-consumed thin column maps to an existing v2 column except three:

| AMR needs (thin) | v2 today | gap |
| --- | --- | --- |
| organism id `observations.code_code = '634-6'` | `v2_lab_results.observation_code` | — |
| pathogen `value_code` / `value_text` | `coded_value` / `text_value` | — |
| AST `interpretation_code` ∈ {S,I,R} | `abnormal_flag` | — |
| antibiotic name `code_text` | `observation_desc` | — |
| obs date `effective_date_time` | `result_timestamp` | — |
| obs → patient `subject_ref` (`Patient/<id>`) | `v2_lab_results` has only `request_id` | **add `patient_id`** |
| obs → specimen `specimen_ref` (`Specimen/<id>`) | `v2_lab_results` has no specimen link | **add `specimen_id`** |
| specimen `type_code` / `received_time` | `v2_specimens.type_code` / `received_time` | — |
| specimen `origin` (FHIR ext) | `v2_specimens` has no origin | **add `origin`** |
| patient `gender` | `v2_patients.sex` (`M`/`F`/`O`/`U`) | mapped — see below |
| patient `birth_date` | `v2_patients.date_of_birth` | — (rename) |
| patient facility `managing_organization` | `v2_patients.managing_organization` (R3b) | — |

`v2_patients` is already complete for AMR (R3b added `managing_organization`). The only schema
additions are the 3 columns above.

## Design

### 1. Migration `006_v2_amr_links` (additive, engine-aware)

New file `packages/db/src/migrations/external/006_v2_amr_links.ts`, mirroring `004`'s
`alterTable().addColumn()` shape with engine-aware `textType(engine)`:

- `v2_lab_results` → add `patient_id` (text), `specimen_id` (text)
- `v2_specimens` → add `origin` (text)

`down()` drops all three. Register `'006_v2_amr_links'` in
`packages/db/src/migrations/external/index.ts`.

Column naming rationale: `patient_id`/`specimen_id` (bare-id, no `_ref` suffix) matches the
established v2 convention (`v2_specimens.patient_id`, `v2_lab_requests.patient_id` all store bare
ids via `referenceId`). This is intentionally cleaner than thin's `subject_ref`/`specimen_ref`,
which stored full `Patient/<id>` / `Specimen/<id>` strings — the SQL joins simplify to bare-to-bare
(see §3).

### 2. Type + export + test touchpoints for the new columns

- `packages/db/src/schema/external.ts`: add `patient_id: string | null` and
  `specimen_id: string | null` to `V2LabResultsTable`; add `origin: string | null` to
  `V2SpecimensTable`.
- `packages/db/src/export-data.ts`: append the new columns to `EXTERNAL_TABLE_COLUMNS.v2_lab_results`
  (`patient_id`, `specimen_id`) and `EXTERNAL_TABLE_COLUMNS.v2_specimens` (`origin`), placed after
  the existing data columns and before the provenance columns to match the column order in the
  other entries.
- `packages/db/src/migrations/migrations.test.ts`: extend the exact external-migration key-list
  assertion to include `'006_v2_amr_links'`.
- `packages/db/src/export-data.test.ts`: **no change** — it asserts only the key *set* (table names,
  unchanged) and that each entry contains `id`/`source_system`/`batch_id`. Adding data columns does
  not affect it.

### 3. Projection mappers (2 one-line additions)

- `packages/db/src/relational/observation.ts` (`projectObservation`): add
  `patient_id: referenceId(r['subject'])` and `specimen_id: referenceId(r['specimen'])`.
- `packages/db/src/relational/specimen.ts` (`projectSpecimen`): add
  `origin: readSpecimenOrigin(r)` (import `readSpecimenOrigin` from `@openldr/fhir` — already a
  `packages/db` dependency, used by `flatten/specimen.ts`). `readSpecimenOrigin` returns
  `'inpatient' | 'outpatient' | 'unknown' | null`, identical to what the thin flatten stored.

### 4. Rewrite the 5 `q-amr-*` seed SQL (all 3 engine variants each)

Mechanical column/table swap; the derivation CTEs (isolate identification, first-isolate dedup,
GLASS age-banding, antibiogram cells) are structurally unchanged because v2 now carries the same
linkage:

| thin | v2 |
| --- | --- |
| `from observations o` | `from v2_lab_results o` |
| `o.code_code` | `o.observation_code` |
| `o.value_code` | `o.coded_value` |
| `o.value_text` | `o.text_value` |
| `o.interpretation_code` | `o.abnormal_flag` |
| `o.code_text` | `o.observation_desc` |
| `o.effective_date_time` | `o.result_timestamp` |
| `o.subject_ref = 'Patient/' \|\| p.id` | `o.patient_id = p.id` (bare-to-bare) |
| `o.specimen_ref = 'Specimen/' \|\| s.id` | `o.specimen_id = s.id` (bare-to-bare) |
| `o.subject_ref in (select 'Patient/' \|\| p.id …)` | `o.patient_id in (select p.id …)` |
| `o.specimen_ref is not null and o.specimen_ref <> ''` | `o.specimen_id is not null and o.specimen_id <> ''` |
| `from specimens s` (`type_code`/`received_time`/`origin`) | `from v2_specimens s` (same column names) |
| `from patients p` | `from v2_patients p` |
| `p.birth_date` | `p.date_of_birth` |
| `p.managing_organization` | `p.managing_organization` (unchanged) |
| `coalesce(p.gender, 'unknown')` | inverse-map of `p.sex` — see below |

**Gender parity rule (the one non-mechanical rewrite).** Thin `patients.gender` stores the raw FHIR
gender (`male`/`female`/`other`/`unknown`); `v2_patients.sex` stores the mapped code
(`male→M`, `female→F`, `other→O`, `unknown→U`, any other value → `U`, null gender → null). The AMR
reports (notably `q-amr-glass-ris` and `q-amr-first-isolate-summary`) emit gender as a **pass-through
grouping value**, so a raw `p.gender`→`p.sex` swap would change the output value and break parity.
Instead the v2 SQL must invert the mapping to reproduce thin's raw gender string. Where thin wrote
`coalesce(p.gender, 'unknown')`, v2 writes (postgres):

```sql
case p.sex
  when 'M' then 'male'
  when 'F' then 'female'
  when 'O' then 'other'
  else 'unknown'   -- covers 'U' and NULL, matching thin's coalesce(..., 'unknown')
end
```

with the equivalent `case` ported to mssql/mysql. This is parity-exact for every valid FHIR gender
code (the FHIR `administrative-gender` binding is required, so only male/female/other/unknown occur
in real data). It is lossy only for a non-standard input gender (thin would echo the raw string;
v2's `sex` collapsed it to `U`→`unknown`) — an impossible case under the required binding, and not
exercised by the fixture. This mirrors R3b's decision to adapt the v2 read at query time rather than
add a redundant column, keeping `v2_patients` on its `sex`-only convention. Document this in the
`q-amr-glass-ris` seed comment (the SQL-comment style already used across `report-seeds.ts`).

All existing per-variant porting rules from R3c carry forward unchanged: `||`→`+` (mssql) /
`concat()` (mysql); `::int`→`cast(... as int/signed)`; `::float8`→`cast(... as float/double)`;
double-quoted aliases → backticks (mysql); `date_trunc`/`age()` → the documented mssql/mysql
equivalents; `distinct on` → the `row_number()` CTE port (mssql/mysql).

### 5. Repoint the 2 catalog readers to v2

- `packages/reporting/src/reports/amr-isolates.ts` (`amrIsolates.run`): rewrite to read
  `v2_lab_results` (AST rows via `abnormal_flag in ('S','I','R')`, antibiotic via `observation_desc`,
  date via `result_timestamp`, facility via `patient_id` → `v2_patients.managing_organization`). Its
  declared output columns (`id`/`facility`/`eventDate`/`antibiotic`/`result`) and the existing
  `amr-isolates.test.ts` column assertion are unchanged. Note: `amrIsolates` reads via Kysely's typed
  query builder (not raw SQL), so it uses the bare `patient_id` join directly.
- `packages/reporting/src/amr/query.ts` (`fetchAmrData`): rewrite its 4 `selectFrom` queries to read
  `v2_lab_results` / `v2_specimens` / `v2_patients`, mapping the v2 columns back into the same
  `RawOrgObs`/`RawAstObs`/`RawSpecimen`/`RawPatient` shapes it returns today (org rows =
  `observation_code = '634-6'`; ast rows = `abnormal_flag in ('S','I','R')`; specimen `origin` from
  the new column; patient `gender` reconstructed from `sex` via the same inverse map as §4, so
  `buildIsolates`'s downstream output is unchanged). Public API and return types stay identical;
  `buildIsolates`/`glass`/`aggregate` and their unit tests are untouched.

### 6. Proof — extend `scripts/reports-cutover-accept.ts`

Add 5 AMR cases to the `CASES[]` array. For each, the `thinPgSql` is the **postgres** variant copied
**verbatim** from `git show 7fa6b317:packages/reporting/src/seed/report-seeds.ts` (the pre-R3d base
— at `7fa6b317` these read the thin tables). The harness seeds the shared FHIR fixture into both
schemas (`createFlatWriter` → thin, `createRelationalWriter` → v2) on real Postgres `:5433`, runs
OLD-thin vs NEW-v2 SQL for each param bag, and asserts `firstDiff` is null.

Param bags per report (every `{{param.x}}` token the SQL references must be present, or
`substituteParams` throws `unbound parameter`):

- `q-amr-resistance`: params `from`/`to`/`facility` → test `facility: ''` and a real facility.
- `q-amr-facility-summary`: params `from`/`to` → `{ from, to }`.
- `q-amr-glass-ris`: params `from`/`to`/`country`/`year` → test with `country`/`year` unset (`''`) and set.
- `q-amr-first-isolate-summary`: params `from`/`to` → `{ from, to }`.
- `q-amr-antibiogram`: params `from`/`to` → `{ from, to }`.

Add the same "the thin SQL must actually read the thin table" sanity regex guards the harness
already uses for the R3c cases (e.g. assert each copied AMR thin SQL matches `/from\s+observations\b/`),
so a wrong-commit copy fails loudly.

Fixture: **no change**. `scripts/lib/reports-parity-fixture.ts` already carries the full AMR fixture
(organism `634-6` observations, specimen-scoped AST observations, `amr-sp1/2/3` specimens with the
`specimen-origin` extension incl. inpatient/outpatient/none, dateless + duplicate-isolate-key +
non-specimen-scoped-AST edge cases), and `TABLES` already lists every v2 table for the wipe.

Update the harness's header comment and final success banner to include the AMR reports.

## Testing strategy

- **Unit (per-package, in-memory / pg-mem):** `pnpm --filter @openldr/db exec vitest run` and
  `pnpm --filter @openldr/reporting exec vitest run` — covers the migration key-list assertion, the
  mapper changes (relational writer tests), the export-data key assertion, and the reporting
  unit/EventSource tests. New: assert the mappers populate `patient_id`/`specimen_id`/`origin` (extend
  `relational.test.ts` / `relational-writer.test.ts`).
- **Type gate:** `tsc --noEmit` on `@openldr/db` and `@openldr/reporting` (the new schema columns +
  mapper fields + `fetchAmrData`/`amrIsolates` rewrites must typecheck against `ExternalSchema`).
- **Behavior proof (real PG, the load-bearing check):** `pnpm reports:accept` with dev Postgres
  `:5433` up (`docker compose up -d postgres`), all 5 AMR cases PASS (`firstDiff` null for every
  param bag). Report-SQL correctness is real-PG-only — pg-mem cannot run these queries.
- **Cross-package gate (periodic, per convention):** `pnpm turbo run typecheck test --force` — never
  piped through `tail` (Windows lock/EPERM race); verify any flakes by running the package's
  `vitest run` directly. `@openldr/cli#build` is a known Windows-only esbuild-native failure — ignore.

## Task breakdown

1. **Migration 006 + schema/export/index/test** — `006_v2_amr_links.ts`, register in index, extend
   `V2LabResultsTable`/`V2SpecimensTable`, `EXTERNAL_TABLE_COLUMNS`, `migrations.test.ts` key list.
2. **Projection mappers** — `patient_id`/`specimen_id` in `observation.ts`, `origin` in `specimen.ts`;
   extend relational writer/mapper tests to assert the new columns populate.
3. **Rewrite the 5 `q-amr-*` seed SQL** — all 3 engine variants each, per the §4 mapping table +
   gender inverse-map; keep/extend the explaining seed comments.
4. **Repoint the 2 catalog readers** — `amrIsolates` EventSource + `fetchAmrData` to v2.
5. **Extend the accept harness** — 5 AMR `CASES[]` with verbatim `7fa6b317` thin PG SQL + param bags +
   sanity guards; run `pnpm reports:accept` on real PG and confirm all PASS.
6. **Whole-slice review + gate** — spec-conformance + quality review; run the per-package
   `vitest`/`tsc` gate; then merge `--no-ff` to local `main` + push.

## Constraints & conventions

- Additive only — no thin schema changes; R3e owns the rename/drop.
- PG-first: MSSQL/MySQL SQL ported by the mechanical rules but live parity deferred.
- Bare `patient_id`/`specimen_id` (no enforced FK) — soft refs, consistent with v2.
- Next external migration index = **006** (007+ reserved for later slices).
- No `Co-Authored-By: Claude`/`Codex` trailers on commits or PRs (sole contributor = fmwasekaga).
- Work merges to local `main` (`--no-ff` per slice); push to origin when the slice is green.
