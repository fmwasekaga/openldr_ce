# FHIR Storage Restructure — R3d: AMR Cutover to v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all remaining thin-reading AMR consumers (5 `q-amr-*` seed reports + `amrIsolates` EventSource + `fetchAmrData`) onto the v2 relational read model, proven behavior-preserving on real Postgres, so R3e can drop the thin schema.

**Architecture:** Query-time derivation over v2 (Option B). Add 3 additive columns (`v2_lab_results.patient_id`, `v2_lab_results.specimen_id`, `v2_specimens.origin`) via migration `006`, populate them in the projection mappers, then mechanically rewrite the AMR SQL/queries to read v2. The isolate/AST/GLASS/antibiogram derivation logic is unchanged because v2 now carries the same linkage the thin tables did. Proof is the existing `scripts/reports-cutover-accept.ts` harness extended with 5 AMR cases: OLD thin SQL (copied verbatim from base commit `7fa6b317`) vs NEW v2 SQL over the same FHIR fixture on real PG, asserting identical rows.

**Tech Stack:** TypeScript, Kysely (engine-aware DDL), pg-mem (unit), real Postgres `:5433` (parity), Vitest, pnpm/turbo.

**Spec:** `docs/superpowers/specs/2026-07-13-fhir-storage-restructure-r3d-amr-cutover-design.md`

---

## Reference: the thin→v2 column mapping (used throughout Tasks 3–5)

| thin (source) | v2 (target) |
| --- | --- |
| `observations` | `v2_lab_results` |
| `observations.code_code` | `v2_lab_results.observation_code` |
| `observations.value_code` | `v2_lab_results.coded_value` |
| `observations.value_text` | `v2_lab_results.text_value` |
| `observations.interpretation_code` | `v2_lab_results.abnormal_flag` |
| `observations.code_text` | `v2_lab_results.observation_desc` |
| `observations.effective_date_time` | `v2_lab_results.result_timestamp` |
| `observations.subject_ref` (`Patient/<id>`) | `v2_lab_results.patient_id` (bare id) |
| `observations.specimen_ref` (`Specimen/<id>`) | `v2_lab_results.specimen_id` (bare id) |
| `specimens` | `v2_specimens` |
| `specimens.type_code` / `.received_time` / `.origin` | `v2_specimens.type_code` / `.received_time` / `.origin` (same names) |
| `patients` | `v2_patients` |
| `patients.birth_date` | `v2_patients.date_of_birth` |
| `patients.managing_organization` | `v2_patients.managing_organization` (unchanged) |
| `patients.gender` | inverse-map of `v2_patients.sex` (see below) |

**Bare-id joins.** Thin stored full references, so joins read `o.subject_ref = 'Patient/' || p.id` and `o.specimen_ref = 'Specimen/' || s.id`. v2 stores bare ids, so these become `o.patient_id = p.id` and `o.specimen_id = s.id` (drop the `'Patient/' ||` / `'Specimen/' ||` prefix on BOTH sides — postgres `||`, mssql `+`, mysql `concat`). The facility subquery `o.subject_ref in (select 'Patient/' || p.id from patients p where ...)` becomes `o.patient_id in (select p.id from v2_patients p where ...)`. The null/empty guards `o.specimen_ref is not null and o.specimen_ref <> ''` become `o.specimen_id is not null and o.specimen_id <> ''`.

**Gender inverse-map.** Thin `patients.gender` is raw FHIR (`male`/`female`/`other`/`unknown`); `v2_patients.sex` is mapped (`M`/`F`/`O`/`U`/null). Where the thin SQL wrote `coalesce(p.gender, 'unknown')`, write instead:

Postgres / MSSQL (identical `case` expression):
```sql
case p.sex when 'M' then 'male' when 'F' then 'female' when 'O' then 'other' else 'unknown' end
```
MySQL: same `case` expression (portable). The `else` branch covers both `U` and `NULL`, reproducing thin's `coalesce(..., 'unknown')`. Parity-exact for all valid FHIR gender codes.

**Aliasing to minimize churn.** In the CTE reports, alias the renamed/mapped source column back to the OLD name in the innermost `select` so the ~10 downstream CTE references never change. E.g. in `isolate_meta`:
- `coalesce(p.gender, 'unknown') as gender` → `case p.sex ... end as gender` (downstream `gender` references unchanged)
- `p.birth_date` → `p.date_of_birth as birth_date` (downstream `im.birth_date` / `birth_date is null` unchanged)

**Per-report touchpoint matrix** (what each report actually reads — apply only the relevant rows):

| report | reads observations | reads specimens | reads patients | emits gender? |
| --- | --- | --- | --- | --- |
| `q-amr-resistance` | AST (interp/code_text/effective) + `subject_ref` facility subquery | — | facility subquery only | no |
| `q-amr-facility-summary` | AST (interp/effective) + `subject_ref` join | — | `managing_organization` (join + filter) | no |
| `q-amr-glass-ris` | org `634-6` (value_code/value_text/effective) + AST + `subject_ref`/`specimen_ref` | `type_code`/`origin`/`received_time` | `gender` (→sex map), `birth_date` (→date_of_birth) | **yes (output)** |
| `q-amr-first-isolate-summary` | org + AST + `subject_ref`/`specimen_ref` | `type_code`/`origin`/`received_time` | `gender` (computed, **not** emitted), `birth_date` | no (carried-unused; still inverse-map for uniformity) |
| `q-amr-antibiogram` | org (value_code) + AST + `subject_ref`/`specimen_ref` | `type_code` only | — | no |

---

## Task 0: Cut the branch

**Files:** none (git only).

- [ ] **Step 1: Create and switch to the feature branch**

Run:
```bash
git checkout -b feat/fhir-amr-cutover
git branch --show-current
```
Expected: prints `feat/fhir-amr-cutover`. Working tree clean (spec already committed on `main` at `b0d2f222`, which this branch includes).

---

## Task 1: Migration 006 + schema types + export columns

**Files:**
- Create: `packages/db/src/migrations/external/006_v2_amr_links.ts`
- Modify: `packages/db/src/migrations/external/index.ts`
- Modify: `packages/db/src/schema/external.ts` (`V2LabResultsTable` ~L118, `V2SpecimensTable` ~L141)
- Modify: `packages/db/src/export-data.ts:23,25` (`EXTERNAL_TABLE_COLUMNS`)
- Test: `packages/db/src/migrations/migrations.test.ts:15` (external key-list assertion)

- [ ] **Step 1: Update the migration key-list test FIRST (it will fail)**

In `packages/db/src/migrations/migrations.test.ts:15`, add `'006_v2_amr_links'` to the end of the external-migration array:
```ts
    expect(Object.keys(ext)).toEqual(['001_flat_tables', '002_specimen_origin', '003_v2_core', '004_v2_patients_facility', '005_v2_specimen_diagreport', '006_v2_amr_links']);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations/migrations.test.ts`
Expected: FAIL — actual keys lack `006_v2_amr_links` (the migration isn't registered yet).

- [ ] **Step 3: Create the migration**

Create `packages/db/src/migrations/external/006_v2_amr_links.ts` (mirrors `004`'s shape — engine-aware `textType`, additive `alterTable().addColumn()`):
```ts
import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType } from './dialect';

// R3d: the AMR reports derive isolates/AST at query time and need obs→patient / obs→specimen
// linkage on v2_lab_results plus specimen origin on v2_specimens (which the thin tables carried
// as subject_ref/specimen_ref and specimens.origin). Additive columns only.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  await db.schema.alterTable('v2_lab_results').addColumn('patient_id', text).execute();
  await db.schema.alterTable('v2_lab_results').addColumn('specimen_id', text).execute();
  await db.schema.alterTable('v2_specimens').addColumn('origin', text).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('v2_lab_results').dropColumn('patient_id').execute();
  await db.schema.alterTable('v2_lab_results').dropColumn('specimen_id').execute();
  await db.schema.alterTable('v2_specimens').dropColumn('origin').execute();
}
```

- [ ] **Step 4: Register it in the migration index**

In `packages/db/src/migrations/external/index.ts`, add the import and the map entry:
```ts
import * as m006 from './006_v2_amr_links';
```
```ts
    '006_v2_amr_links': { up: (db) => m006.up(db, engine), down: m006.down },
```
(Add after the `005_v2_specimen_diagreport` line, inside the returned object.)

- [ ] **Step 5: Extend the schema types**

In `packages/db/src/schema/external.ts`, add to `V2LabResultsTable`:
```ts
  patient_id: string | null;
  specimen_id: string | null;
```
and to `V2SpecimensTable`:
```ts
  origin: string | null;
```
(Place each alongside the other data columns, before the provenance columns spread.)

- [ ] **Step 6: Extend EXTERNAL_TABLE_COLUMNS**

In `packages/db/src/export-data.ts`, update the two entries (insert the new columns after the existing data columns, before `'source_system'`):
```ts
  v2_lab_results: ['id', 'request_id', 'observation_code', 'observation_system', 'observation_desc', 'result_type', 'numeric_value', 'numeric_units', 'coded_value', 'text_value', 'abnormal_flag', 'result_timestamp', 'patient_id', 'specimen_id', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
```
```ts
  v2_specimens: ['id', 'patient_id', 'received_time', 'accession', 'status', 'type_code', 'type_text', 'origin', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
```

- [ ] **Step 7: Run the db test suite + typecheck to verify green**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations/migrations.test.ts src/export-data.test.ts`
Expected: PASS (migration key list now matches; export-data key-set assertion unaffected).
Run: `pnpm --filter @openldr/db exec tsc --noEmit`
Expected: PASS (new columns are `string | null`, consistent with the table interfaces).

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/migrations/external/006_v2_amr_links.ts packages/db/src/migrations/external/index.ts packages/db/src/schema/external.ts packages/db/src/export-data.ts packages/db/src/migrations/migrations.test.ts
git commit -m "feat(db): v2 AMR linkage columns (patient_id/specimen_id on v2_lab_results, origin on v2_specimens) — migration 006 (restructure R3d)"
```

---

## Task 2: Populate the new columns in the projection mappers

**Files:**
- Modify: `packages/db/src/relational/observation.ts`
- Modify: `packages/db/src/relational/specimen.ts`
- Test: `packages/db/src/relational/relational.test.ts`

- [ ] **Step 1: Add failing assertions to the mapper test**

Open `packages/db/src/relational/relational.test.ts`. Find the existing `projectObservation` test and add assertions that an Observation with a `subject` and `specimen` reference projects the bare ids. If the test file constructs an Observation inline, ensure it includes `subject: { reference: 'Patient/pt-1' }` and `specimen: { reference: 'Specimen/sp-1' }`, then assert:
```ts
    expect(row.patient_id).toBe('pt-1');
    expect(row.specimen_id).toBe('sp-1');
```
Find the existing `projectSpecimen` test; ensure its input Specimen carries the origin extension, e.g.:
```ts
      extension: [{ url: 'https://openldr.org/fhir/StructureDefinition/specimen-origin', valueCode: 'inpatient' }],
```
then assert:
```ts
    expect(row.origin).toBe('inpatient');
```
(If the file has no per-mapper unit tests and only exercises the writer, add the two assertions to the closest existing v2 observation/specimen test case instead — match the file's existing structure; do not invent a new harness.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openldr/db exec vitest run src/relational/relational.test.ts`
Expected: FAIL — `row.patient_id`/`row.specimen_id`/`row.origin` are `undefined` (mappers don't emit them yet).

- [ ] **Step 3: Add the fields to the observation mapper**

In `packages/db/src/relational/observation.ts` (`projectObservation`), add inside the returned object (near `request_id`):
```ts
    patient_id: referenceId(r['subject']),
    specimen_id: referenceId(r['specimen']),
```
`referenceId` is already imported in that file.

- [ ] **Step 4: Add the field to the specimen mapper**

In `packages/db/src/relational/specimen.ts` (`projectSpecimen`), add the import:
```ts
import { readSpecimenOrigin } from '@openldr/fhir';
```
and add inside the returned object:
```ts
    origin: readSpecimenOrigin(r),
```
(`@openldr/fhir` is already a `packages/db` dependency — see `flatten/specimen.ts`. `readSpecimenOrigin` returns `'inpatient' | 'outpatient' | 'unknown' | null`.)

- [ ] **Step 5: Run the test + typecheck to verify green**

Run: `pnpm --filter @openldr/db exec vitest run src/relational/relational.test.ts`
Expected: PASS.
Run: `pnpm --filter @openldr/db exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/relational/observation.ts packages/db/src/relational/specimen.ts packages/db/src/relational/relational.test.ts
git commit -m "feat(db): project obs subject/specimen + specimen origin into v2 columns (restructure R3d)"
```

---

## Task 3: Rewrite the 5 AMR seed SQL onto v2

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts` (the `sql:` blocks of the 5 reports — `q-amr-resistance` ~L162, `q-amr-facility-summary` ~L581, `q-amr-glass-ris` ~L673, `q-amr-first-isolate-summary` ~L979, `q-amr-antibiogram` ~L1272; all 3 engine variants each)

This task is mechanical: apply the **column mapping table** and the **bare-id join**, **gender inverse-map**, and **aliasing** rules from the Reference section to every variant. Use the per-report touchpoint matrix to know which rules apply. Update each report's leading `// Mirrors ...` comment with a one-line R3d note ("R3d cutover: reads v2_lab_results/v2_specimens/v2_patients; bare-id joins; gender via sex inverse-map") in the same style R3c used on `q-test-volume`/`q-turnaround-time`.

Worked example — `q-amr-resistance` **postgres** variant, before → after:

BEFORE (thin):
```sql
select
  coalesce(o.code_text, '(unknown)') as antibiotic,
  count(*)::int as tested,
  sum(case when o.interpretation_code = 'R' then 1 else 0 end)::int as r,
  sum(case when o.interpretation_code = 'I' then 1 else 0 end)::int as i,
  sum(case when o.interpretation_code = 'S' then 1 else 0 end)::int as s,
  round(100.0 * sum(case when o.interpretation_code = 'R' then 1 else 0 end) / nullif(count(*), 0), 1)::float8 as "percentR"
from observations o
where o.interpretation_code in ('S', 'I', 'R')
  and o.effective_date_time >= {{param.from}}
  and o.effective_date_time <= ({{param.to}} || 'T23:59:59.999Z')
  and ({{param.facility}} = '' or o.subject_ref in (
    select 'Patient/' || p.id from patients p where p.managing_organization = {{param.facility}}
  ))
group by coalesce(o.code_text, '(unknown)')
order by "percentR" desc
```
AFTER (v2):
```sql
select
  coalesce(o.observation_desc, '(unknown)') as antibiotic,
  count(*)::int as tested,
  sum(case when o.abnormal_flag = 'R' then 1 else 0 end)::int as r,
  sum(case when o.abnormal_flag = 'I' then 1 else 0 end)::int as i,
  sum(case when o.abnormal_flag = 'S' then 1 else 0 end)::int as s,
  round(100.0 * sum(case when o.abnormal_flag = 'R' then 1 else 0 end) / nullif(count(*), 0), 1)::float8 as "percentR"
from v2_lab_results o
where o.abnormal_flag in ('S', 'I', 'R')
  and o.result_timestamp >= {{param.from}}
  and o.result_timestamp <= ({{param.to}} || 'T23:59:59.999Z')
  and ({{param.facility}} = '' or o.patient_id in (
    select p.id from v2_patients p where p.managing_organization = {{param.facility}}
  ))
group by coalesce(o.observation_desc, '(unknown)')
order by "percentR" desc
```
Apply the analogous mssql (`+` concat) and mysql (`concat()`, backtick aliases, `cast(... as signed/double)`) transforms — the porting operators are unchanged from thin; only the table/column names and join shape change.

- [ ] **Step 1: Rewrite `q-amr-resistance`** (all 3 variants) per the example above.

- [ ] **Step 2: Rewrite `q-amr-facility-summary`** (all 3 variants). Join changes to `join v2_patients p on o.patient_id = p.id`; columns `interpretation_code`→`abnormal_flag`, `effective_date_time`→`result_timestamp`, `observations`→`v2_lab_results`; keep the `p.managing_organization is not null` filter and grouping.

- [ ] **Step 3: Rewrite `q-amr-glass-ris`** (all 3 variants). `org_obs`/`ast_obs`: `observations`→`v2_lab_results`, `code_code`→`observation_code`, `value_code`→`coded_value`, `value_text`→`text_value`, `code_text`→`observation_desc`, `interpretation_code`→`abnormal_flag`, `effective_date_time`→`result_timestamp`, `specimen_ref`→`specimen_id`, `subject_ref`→`patient_id`. `isolate_meta`: `left join v2_specimens s on oo.specimen_id = s.id`, `left join v2_patients p on oo.patient_id = p.id`; keep `s.type_code`/`s.origin`/`s.received_time`; alias `p.date_of_birth as birth_date`; replace `coalesce(p.gender,'unknown') as gender` with the gender inverse-map `... as gender`. All downstream CTE refs (`iso_date`, `age_years`, `birth_date`, `gender`, `specimen_ref`→now `specimen_id`) stay as-is EXCEPT `specimen_ref`→`specimen_id` and `subject_ref`→`patient_id` must be renamed consistently in every CTE that references them (`isolate_meta` output, `first_isolates` dedup key/order, `results` join). Keep the `distinct on`/`row_number()` dedup and the `partition by`/`order by` exactly (just the renamed columns).

- [ ] **Step 4: Rewrite `q-amr-first-isolate-summary`** (all 3 variants). Identical CTE transform to glass-ris (same `org_obs`/`isolate_meta`/`age_banded`/`first_isolates`/`ast_obs`/`results` chain). Gender is computed in `isolate_meta` but not emitted — still apply the inverse-map for uniformity. Final `select` groups by `specimen_type, pathogen_code, antibiotic` only — unchanged apart from the renamed source columns.

- [ ] **Step 5: Rewrite `q-amr-antibiogram`** (all 3 variants). Simpler chain (no gender/age/origin): `org_obs` + `isolate_meta` (only `specimen_type`/`pathogen_code`/`iso_date`, `left join v2_specimens s on oo.specimen_id = s.id`) + `first_isolates` (dedup) + `ast_obs` + `results`. Apply `observations`→`v2_lab_results`, `code_code`→`observation_code`, `value_code`→`coded_value`, `code_text`→`observation_desc`, `interpretation_code`→`abnormal_flag`, `effective_date_time`→`result_timestamp`, `specimen_ref`→`specimen_id`, `subject_ref`→`patient_id`. The `${ANTIBIOGRAM_PANEL.map(...antibiogramCellSql...)}` interpolation and `antibiogramCellSql` helper are unchanged (they operate on the `results` CTE columns `antibiotic`/`ris`, which are unchanged aliases).

- [ ] **Step 6: Typecheck + run reporting unit tests**

Run: `pnpm --filter @openldr/reporting exec tsc --noEmit`
Expected: PASS (the seed queries are template strings — this catches only TS errors, not SQL).
Run: `pnpm --filter @openldr/reporting exec vitest run`
Expected: PASS (existing reporting unit tests — the pure AMR helpers and any seed-shape tests — are unaffected; SQL parity is proven in Task 5, not here).

- [ ] **Step 7: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts
git commit -m "feat(reporting): cut 5 q-amr-* reports over to v2 read model (restructure R3d)"
```

---

## Task 4: Repoint the EventSource + fetchAmrData to v2

**Files:**
- Modify: `packages/reporting/src/reports/amr-isolates.ts`
- Modify: `packages/reporting/src/amr/query.ts`
- Test: `packages/reporting/src/reports/amr-isolates.test.ts` (column assertion — should stay green unchanged)

- [ ] **Step 1: Repoint the `amrIsolates` EventSource to v2**

Rewrite `amrIsolates.run` in `packages/reporting/src/reports/amr-isolates.ts` to read v2 (bare-id join, no `Patient/` prefix). Replace the body with:
```ts
  async run(db, window) {
    const obs = await db
      .selectFrom('v2_lab_results')
      .where('abnormal_flag', 'in', ['S', 'I', 'R'])
      .where('result_timestamp', '>=', window.from)
      .where('result_timestamp', '<=', endOfDay(window.to))
      .select(['id', 'observation_desc', 'abnormal_flag', 'result_timestamp', 'patient_id'])
      .execute();
    if (obs.length === 0) return { rows: [] };
    const patientIds = [...new Set(obs.map((o) => o.patient_id).filter((s): s is string => !!s))];
    const patients = patientIds.length
      ? await db.selectFrom('v2_patients').select(['id', 'managing_organization']).where('id', 'in', patientIds).execute()
      : [];
    const facilityById = new Map(patients.map((p) => [p.id, p.managing_organization]));
    const rows = obs.map((o) => ({
      id: o.id,
      facility: o.patient_id ? facilityById.get(o.patient_id) ?? null : null,
      eventDate: o.result_timestamp,
      antibiotic: o.observation_desc,
      result: o.abnormal_flag,
    }));
    return { rows };
  },
```
The declared `columns` array (`id`/`facility`/`eventDate`/`antibiotic`/`result`) is unchanged.

- [ ] **Step 2: Repoint `fetchAmrData` to v2**

Rewrite the four `selectFrom` calls in `packages/reporting/src/amr/query.ts` (`fetchAmrData`) to read v2, mapping each row back into the same `RawOrgObs`/`RawAstObs`/`RawSpecimen`/`RawPatient` shapes it returns today. Key changes:
- org rows: `db.selectFrom('v2_lab_results').where('observation_code', '=', '634-6').select(['id', 'patient_id', 'specimen_id', 'coded_value', 'text_value', 'result_timestamp'])`, then map `{ id, subjectRef: patient_id, specimenRef: specimen_id, valueCode: coded_value, valueText: text_value, date: result_timestamp }`.
- ast rows: `.where('abnormal_flag', 'in', ['S','I','R']).select(['id','patient_id','specimen_id','observation_desc','abnormal_flag','result_timestamp'])`, map `{ id, subjectRef: patient_id, specimenRef: specimen_id, antibiotic: observation_desc, ris: abnormal_flag, date: result_timestamp }`.
- specimens: `db.selectFrom('v2_specimens').select(['id','type_code','received_time','origin'])`, map `{ id, typeCode: type_code, receivedTime: received_time, origin }`.
- patients: `db.selectFrom('v2_patients').select(['id','sex','date_of_birth'])`, map `{ id, gender: <sex→gender inverse-map>, birthDate: date_of_birth }`. Inverse-map inline:
```ts
const genderFromSex = (sex: string | null): string =>
  sex === 'M' ? 'male' : sex === 'F' ? 'female' : sex === 'O' ? 'other' : 'unknown';
```
Because `patient_id`/`specimen_id` are already bare ids, the existing `refId()` helper (which strips the `Prefix/`) is now a no-op on them — keep the downstream `buildIsolates` call unchanged (it tolerates bare ids: `refId` returns the id as-is when there's no `/`). The `specDate`/`inWindow` logic and the returned `AmrData` shape stay identical.

- [ ] **Step 3: Typecheck + run reporting tests**

Run: `pnpm --filter @openldr/reporting exec tsc --noEmit`
Expected: PASS.
Run: `pnpm --filter @openldr/reporting exec vitest run`
Expected: PASS (including `amr-isolates.test.ts`'s column assertion and the pure `amr/*.test.ts` helper tests, which don't touch the DB).

- [ ] **Step 4: Commit**

```bash
git add packages/reporting/src/reports/amr-isolates.ts packages/reporting/src/amr/query.ts
git commit -m "feat(reporting): repoint amrIsolates EventSource + fetchAmrData to v2 (restructure R3d)"
```

---

## Task 5: Prove parity — extend the accept harness with 5 AMR cases

**Files:**
- Modify: `scripts/reports-cutover-accept.ts`

The harness runs each case's OLD thin PG SQL vs the seed's NEW v2 PG SQL over the shared fixture on real Postgres and asserts identical rows. The fixture (`scripts/lib/reports-parity-fixture.ts`) already contains the full AMR data and `TABLES` already lists every v2 table — no fixture change.

- [ ] **Step 1: Capture the pre-R3d thin AMR SQL**

For each of the 5 reports, extract the **postgres** variant as it stands at the base commit `7fa6b317` (the AMR reports there read thin):
```bash
git show 7fa6b317:packages/reporting/src/seed/report-seeds.ts > /tmp/amr-base.ts
```
Copy each report's `postgres` SQL string verbatim into a `THIN_*_PG_SQL` const in `scripts/reports-cutover-accept.ts` (mirroring the existing `THIN_FACILITIES_PG_SQL` etc.). Note `q-amr-antibiogram`'s postgres SQL contains a `${ANTIBIOGRAM_PANEL.map(...)}` interpolation — reproduce the **fully-expanded** SQL string (import `ANTIBIOGRAM_PANEL` + `antibiogramCellSql` from the reporting package and build the thin reference the same way the seed does, OR inline the expanded column list). The seed side is read from `SEED_QUERIES` as usual, so only the thin reference needs the expansion.

- [ ] **Step 2: Add the 5 cases to `CASES[]`**

```ts
  { id: 'q-amr-resistance', thinPgSql: THIN_AMR_RESISTANCE_PG_SQL, paramBags: [
    { from: '2026-01-01', to: '2026-12-31', facility: '' },
    { from: '2026-01-01', to: '2026-12-31', facility: 'Facility A' },
  ] },
  { id: 'q-amr-facility-summary', thinPgSql: THIN_AMR_FACILITY_SUMMARY_PG_SQL, paramBags: [
    { from: '2026-01-01', to: '2026-12-31' },
  ] },
  { id: 'q-amr-glass-ris', thinPgSql: THIN_AMR_GLASS_RIS_PG_SQL, paramBags: [
    { from: '2026-01-01', to: '2026-12-31', country: '', year: '' },
    { from: '2026-01-01', to: '2026-12-31', country: 'ZMB', year: '2026' },
  ] },
  { id: 'q-amr-first-isolate-summary', thinPgSql: THIN_AMR_FIRST_ISOLATE_PG_SQL, paramBags: [
    { from: '2026-01-01', to: '2026-12-31' },
  ] },
  { id: 'q-amr-antibiogram', thinPgSql: THIN_AMR_ANTIBIOGRAM_PG_SQL, paramBags: [
    { from: '2026-01-01', to: '2026-12-31' },
  ] },
```
(Use `'Facility A'` only if that value exists in the fixture's `patients[].managing_organization`; otherwise pick a facility value the fixture actually contains, or drop the non-empty-facility bag. Verify against `scripts/lib/reports-parity-fixture.ts`.)

- [ ] **Step 3: Add wrong-commit sanity guards**

Mirror the existing guards — after the consts, assert each thin AMR SQL still reads the thin table:
```ts
if (!/from\s+observations\b/.test(THIN_AMR_RESISTANCE_PG_SQL)) throw new Error('thin q-amr-resistance SQL does not read `from observations` — wrong commit copied');
```
Add one per report (glass-ris/first-isolate/antibiogram also read `observations`; facility-summary reads `observations` + `patients`). Update the harness header comment + final success banner to mention the AMR reports.

- [ ] **Step 4: Ensure dev Postgres is up, then run the harness**

Run:
```bash
docker compose up -d postgres
pnpm reports:accept
```
Expected: every case prints `PASS: q-amr-... {...} (N rows identical)` and the script exits 0 with `✅ ... cutover parity PASSED`. If any AMR case FAILs, the printed `firstDiff` (thin row vs v2 row) points at the exact divergence — fix the seed SQL in Task 3 (do NOT change the thin reference) and re-run.

- [ ] **Step 5: Commit**

```bash
git add scripts/reports-cutover-accept.ts
git commit -m "test(accept): prove 5 q-amr-* v2 output equals thin on real PG (restructure R3d)"
```

---

## Task 6: Whole-slice review, gate, merge & push

**Files:** none (review + git).

- [ ] **Step 1: Cross-package gate**

Run: `pnpm turbo run typecheck test --force`
Expected: PASS for `@openldr/db` and `@openldr/reporting` (and no NEW failures elsewhere). **Never pipe turbo through `tail`** (Windows lock/EPERM race). Ignore the known `@openldr/cli#build` Windows esbuild-native failure and the documented parallel-turbo flakes (verify any suspicious failure by running that package's `vitest run` directly). Re-run `pnpm reports:accept` once more to confirm parity still green.

- [ ] **Step 2: Whole-slice review**

Re-read the diff against the spec: 3 additive columns only (no thin changes); all 5 AMR reports + EventSource + `fetchAmrData` read v2; gender inverse-map applied wherever `p.gender` was read; accept harness proves thin≡v2 for every param bag. Confirm no `Co-Authored-By` trailers were added.

- [ ] **Step 3: Merge to local `main` (no-ff) and push**

```bash
git checkout main
git merge --no-ff feat/fhir-amr-cutover -m "Merge branch 'feat/fhir-amr-cutover': cut 5 AMR reports + AMR catalog code over to v2 (restructure R3d)"
git log --oneline -1
git push origin main
```
Expected: fast, clean merge; push succeeds. After this, 9/9 reports read v2 — only R3e (rename `v2_*`→canonical + drop thin) remains.

- [ ] **Step 4: Update memory**

Update `fhir-storage-restructure-workstream.md` and `MEMORY.md` to mark R3d DONE + pushed (new `origin/main` SHA), and note R3e is the sole remaining sub-slice. Delete/retire `fhir-cutover-r3d-amr-starting-point.md` (superseded).

---

## Self-review notes

- **Spec coverage:** migration 006 (§Design.1) → Task 1; type/export/test touchpoints (§Design.2) → Task 1; mappers (§Design.3) → Task 2; 5 AMR SQL rewrites + gender rule (§Design.4) → Task 3; EventSource + fetchAmrData repoint (§Design.5) → Task 4; accept-harness proof (§Design.6) → Task 5; gate/merge/push + process (§Process) → Task 6. All spec sections covered.
- **No new tables** (Option B) → `TABLES` wipe-list and fixture unchanged, confirmed in Task 5.
- **Column-name consistency:** `patient_id`/`specimen_id`/`origin` used identically in migration, schema types, export columns, mappers, and every SQL rewrite. `date_of_birth`/`sex`/`managing_organization` are the v2_patients names throughout.
- **Gender rule applied consistently:** SQL inverse-`case` (Task 3) and the `genderFromSex` TS helper (Task 4) produce the same mapping (M→male, F→female, O→other, else→unknown).
