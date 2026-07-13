# FHIR Storage Restructure — R3b: Patient-Demographics Report Cutover (→ v2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the built-in `q-patient-demographics` report over to read `v2_patients` instead of the thin `patients`, proving one real consumer of the v2 read-model while preserving output exactly.

**Architecture:** Sub-slice of R3 (spec: `docs/superpowers/specs/2026-07-13-fhir-storage-restructure-r3b-demographics-cutover-design.md`). Adds `managing_organization` to `v2_patients`, rewrites the report's 3 engine SQL variants in-place, teaches the cross-dialect parity harness to seed the v2 tables, and proves behavior-preservation on real Postgres by running the OLD thin SQL vs the NEW v2 SQL over the same fixture and asserting identical rows. PG-first; live MSSQL/MySQL parity deferred.

**Tech Stack:** TypeScript, Kysely (Postgres + external engines), pg-mem (unit), real Postgres (proof), Vitest.

**Established facts (verified — do NOT re-derive):**
- `q-patient-demographics` lives in `SEED_QUERIES` (`packages/reporting/src/seed/report-seeds.ts`) with 3 dialect SQL variants (`postgres`/`mssql`/`mysql`). It reads `patients` (`birth_date`, `gender`, `managing_organization`), bands age, and aggregates `male`/`female`/`other`.
- `v2_patients` (R3a) has `date_of_birth` + `sex` (`M`/`F`/`O`/`U`/null via mapper) but NOT `managing_organization`. Next external migration = **004**.
- The thin flattener sets `patients.managing_organization = reference(r['managingOrganization'])` (full `"Organization/id"` string); the report's facility param is that same full string.
- Cross-dialect parity harness: `scripts/mysql-reports-parity.ts` + `scripts/mssql-reports-parity.ts` share `scripts/lib/reports-parity-fixture.ts`. `migrateAndClean` runs `externalMigrations(engine)` (now incl. 003/004) + wipes `TABLES`; `seedFixture` does `createFlatWriter(db, engine).writeMany([...fixture])`; then runs each SEED_QUERY's dialect SQL and compares. `TABLES` currently lists only the 7 thin tables.
- The report SQL uses PG functions (`age()`, `array_position`) not supported by pg-mem → correctness is real-Postgres-only.

---

## File Structure

**Create:**
- `packages/db/src/migrations/external/004_v2_patients_facility.ts` + `.test.ts`.
- `scripts/demographics-cutover-accept.ts` — the real-PG behavior-preservation proof.

**Modify:**
- `packages/db/src/schema/external.ts` — `V2PatientsTable.managing_organization`.
- `packages/db/src/migrations/external/index.ts` — register `004`.
- `packages/db/src/relational/patient.ts` — map `managing_organization`.
- `packages/db/src/relational/relational.test.ts` — assert it.
- `packages/reporting/src/seed/report-seeds.ts` — rewrite `q-patient-demographics`'s 3 SQL variants.
- `scripts/lib/reports-parity-fixture.ts` — add v2 tables to `TABLES`.
- `scripts/mysql-reports-parity.ts` + `scripts/mssql-reports-parity.ts` — seed v2 in `seedFixture`.
- `package.json` — `demographics:accept` script.

---

## Task 1: Add `managing_organization` to `v2_patients`

**Files:** Create `external/004_v2_patients_facility.ts`, `.test.ts`; Modify `external/index.ts`, `schema/external.ts`, `relational/patient.ts`, `relational/relational.test.ts`.

- [ ] **Step 1: Failing migration test** — `packages/db/src/migrations/external/004_v2_patients_facility.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { makeMigratedExternalDb } from '../../test-helpers-external';

describe('004 v2_patients.managing_organization', () => {
  it('adds the managing_organization column', async () => {
    const db = await makeMigratedExternalDb();
    await db.insertInto('v2_patients').values({ id: 'p1', managing_organization: 'Organization/org-1' }).execute();
    const row = await db.selectFrom('v2_patients').select(['id', 'managing_organization']).executeTakeFirstOrThrow();
    expect(row.managing_organization).toBe('Organization/org-1');
    await db.destroy();
  });
});
```

- [ ] **Step 2: Run — fails.** `pnpm --filter @openldr/db exec vitest run src/migrations/external/004_v2_patients_facility.test.ts` → FAIL.

- [ ] **Step 3: Create the migration** `packages/db/src/migrations/external/004_v2_patients_facility.ts`:
```ts
import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType } from './dialect';

// R3b: the patient-demographics report cutover needs the facility filter column on v2_patients.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  await db.schema.alterTable('v2_patients').addColumn('managing_organization', sql.raw(textType(engine))).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('v2_patients').dropColumn('managing_organization').execute();
}
```

- [ ] **Step 4: Register** in `packages/db/src/migrations/external/index.ts`: `import * as m004 from './004_v2_patients_facility';` + entry `'004_v2_patients_facility': { up: (db) => m004.up(db, engine), down: m004.down },` after `003`.

- [ ] **Step 5: Schema type** — in `packages/db/src/schema/external.ts`, add to `V2PatientsTable`: `managing_organization: string | null;`. Also add `'managing_organization'` to the `v2_patients` entry in `EXTERNAL_TABLE_COLUMNS` in `export-data.ts` if that Record lists per-table columns (check — R3a added the v2 entries there; keep it exhaustive/correct).

- [ ] **Step 6: Map it** — in `packages/db/src/relational/patient.ts`, add `reference` to the import from `../flatten/extract` and add to the returned row (full reference, matching thin): `managing_organization: reference(r['managingOrganization']),`.

- [ ] **Step 7: Assert in the mapper test** — in `packages/db/src/relational/relational.test.ts`, extend the Patient test's fixture with `managingOrganization: { reference: 'Organization/org-1' }` and add to its `toMatchObject`: `managing_organization: 'Organization/org-1'`.

- [ ] **Step 8: Run + typecheck.** `pnpm --filter @openldr/db exec vitest run src/migrations/external/004_v2_patients_facility.test.ts src/relational/relational.test.ts` → PASS. `pnpm --filter @openldr/db exec tsc --noEmit` → PASS. `pnpm --filter @openldr/db exec vitest run` → all green.

- [ ] **Step 9: Commit.**
```bash
git add packages/db/src/migrations/external/004_v2_patients_facility.ts packages/db/src/migrations/external/004_v2_patients_facility.test.ts packages/db/src/migrations/external/index.ts packages/db/src/schema/external.ts packages/db/src/export-data.ts packages/db/src/relational/patient.ts packages/db/src/relational/relational.test.ts
git commit -m "feat(db): add managing_organization to v2_patients + map it (restructure R3b)"
```

---

## Task 2: Rewrite `q-patient-demographics` SQL to read `v2_patients` (in-place)

**Files:** Modify `packages/reporting/src/seed/report-seeds.ts`.

READ the three `q-patient-demographics` SQL variants (postgres/mssql/mysql). Apply the SAME behavior-preserving substitutions to EACH variant (the age-ladder syntax differs per dialect but the table/column/gender lines are analogous):

- [ ] **Step 1: Apply substitutions to all 3 variants:**
  1. The `from` clause table: `patients p` → `v2_patients p` (postgres: `from patients p, params pr` → `from v2_patients p, params pr`; mssql/mysql: `from patients p cross join params pr` → `from v2_patients p cross join params pr`).
  2. Every `p.birth_date` → `p.date_of_birth` (postgres: bare + `::date`; mssql: inside `cast(... as date)`; mysql: inside `substr(...)`).
  3. The `banded` CTE's projected `p.gender` → `p.sex`.
  4. The outer aggregates (all 3 variants):
     - `when gender = 'male'` → `when sex = 'M'`
     - `when gender = 'female'` → `when sex = 'F'`
     - `when gender is null or gender not in ('male', 'female')` → `when sex is null or sex not in ('M', 'F')`
  5. `p.managing_organization` in the WHERE — unchanged (same column name; now exists on v2).

  Do NOT change the age-band thresholds, band order, param handling, or any other query. (Parity rationale: `sex` is `M`/`F`/`O`/`U`/null; the `other` bucket `sex is null or sex not in ('M','F')` = thin's null + `other` + `unknown` set. Output-identical on the same FHIR data.)

- [ ] **Step 2: Update the explanatory comment** above `q-patient-demographics` — the comment references `patients`/`gender`/`birth_date`; update it to note the report now reads `v2_patients` (date_of_birth/sex) per the R3b cutover, so the next reader isn't misled.

- [ ] **Step 3: Typecheck + any structural report-seed test.** `pnpm --filter @openldr/dashboards exec tsc --noEmit` and `pnpm --filter @openldr/reporting exec vitest run` → PASS. (The SEED_QUERIES structural tests assert catalog shape/counts, not SQL execution, so they stay green; the SQL correctness is proven in Task 4.) If a reporting test executes this SQL against pg-mem it will now fail on `v2_patients`/age() — such a test would already have been real-PG-only; confirm none regress.

- [ ] **Step 4: Commit.**
```bash
git add packages/reporting/src/seed/report-seeds.ts
git commit -m "feat(reporting): cut q-patient-demographics over to v2_patients (in-place, all engines) (restructure R3b)"
```

---

## Task 3: Teach the parity harness to seed the v2 tables

**Files:** Modify `scripts/lib/reports-parity-fixture.ts`, `scripts/mysql-reports-parity.ts`, `scripts/mssql-reports-parity.ts`.

Without this, the now-v2 `q-patient-demographics` query in the cross-dialect harness reads empty `v2_patients` on both engines → a false "identical (0 rows)" pass. The harness must create + seed the v2 tables.

- [ ] **Step 1: Add v2 tables to the wipe list** — in `scripts/lib/reports-parity-fixture.ts`, extend `TABLES` with the 4 v2 tables so `migrateAndClean` wipes them between runs:
```ts
export const TABLES = ['observations', 'diagnostic_reports', 'service_requests', 'specimens', 'patients', 'organizations', 'locations', 'v2_patients', 'v2_lab_requests', 'v2_lab_results', 'v2_facilities'] as const;
```

- [ ] **Step 2: Seed v2 in both harness scripts.** In `scripts/mysql-reports-parity.ts` AND `scripts/mssql-reports-parity.ts`, update `seedFixture` to also seed the relational writer. Add `createRelationalWriter` to the `@openldr/db` import, and in `seedFixture` after the `createFlatWriter` block:
```ts
  const relWriter = createRelationalWriter(db, engine);
  const relResults = await relWriter.writeMany(items);
  // relational writer skips resource types it doesn't project (specimens/reports) — that's expected;
  // only assert the flat writer's skip count (above), not the relational one.
```
(`items` is the same `[...patients, ...specimens, ...]` already built. The `engine` param type in these scripts is `'postgres' | 'mysql'` / `'postgres' | 'mssql'` — matches `createRelationalWriter`'s `TargetEngine`.)

- [ ] **Step 3: Typecheck the scripts** (tsx compiles on run; ensure no type error by a lint/tsc pass if the repo has one for scripts, else this is verified when Task 4 runs). Do NOT run the MSSQL/MySQL harnesses live (engines not required for R3b — PG-first). The PG side of these harnesses is exercised by Task 4's proof.

- [ ] **Step 4: Commit.**
```bash
git add scripts/lib/reports-parity-fixture.ts scripts/mysql-reports-parity.ts scripts/mssql-reports-parity.ts
git commit -m "test(parity): seed v2 tables in the cross-dialect report parity harness (restructure R3b)"
```

---

## Task 4: Real-Postgres behavior-preservation proof

**Files:** Create `scripts/demographics-cutover-accept.ts`; Modify `package.json`.

- [ ] **Step 1: Write the proof script** `scripts/demographics-cutover-accept.ts`. It proves the cutover preserves output by running the OLD thin SQL vs the NEW v2 SQL over the SAME fixture on real Postgres and asserting identical rows. Model the setup on `scripts/mysql-reports-parity.ts` (Postgres side only):
  1. Connect the PG target (`createDbStore({ url: TARGET_DATABASE_URL ?? 'postgresql://openldr:openldr@localhost:5433/openldr_target' })`), `createMigrator(..., externalMigrations('postgres')).migrateToLatest()`, wipe `TABLES`.
  2. Seed the fixture via BOTH `createFlatWriter(db,'postgres').writeMany(items)` and `createRelationalWriter(db,'postgres').writeMany(items)` (items = `[...patients]` — demographics only needs patients; include the rest harmlessly if you reuse the full fixture list).
  3. Keep a `THIN_DEMOGRAPHICS_PG_SQL` string constant = the PRE-cutover postgres SQL (the `from patients`/`birth_date`/`gender` version — copy it verbatim into the script as the reference). Get the NEW SQL from `SEED_QUERIES.find(q => q.id === 'q-patient-demographics').sql.postgres`.
  4. For several param bags — `{ facility: '' }`, `{ facility: 'Facility A' }`, `{ facility: 'Facility B' }`, `{ facility: '', asOf: '2020-01-01' }`, `{ facility: 'nonexistent' }` — `prepareSelect` both SQLs, run both against the PG target, `normalizeRows`, and assert the row arrays are deep-equal (reuse `firstDiff` from the fixture lib). (Facility values match the fixture's `managingOrganization` refs — the fixture uses `{ reference: 'Facility A' }` etc., so the full-reference `managing_organization` = `'Facility A'`.)
  5. `console.log('PASS: <case>')` per case; overall PASS + `process.exit(0)`; any diff → `FAIL` + `process.exit(1)`. Clean up (wipe fixture rows) in `finally`.
  Provide real, compilable code following the harness style. No placeholders.

- [ ] **Step 2: Add the script** to `package.json`: `"demographics:accept": "tsx scripts/demographics-cutover-accept.ts",` (match the `mysql:accept`/`projection:accept` runner).

- [ ] **Step 3: Run it live** against dev Postgres (`:5433`, `openldr_target`). `pnpm demographics:accept` → every param case prints identical (thin ≡ v2) and it exits 0. Paste full output. If a case differs, the cutover SQL diverges from thin — debug the substitution (most likely the gender→sex mapping or a missed `p.birth_date`).

- [ ] **Step 4: Commit.**
```bash
git add scripts/demographics-cutover-accept.ts package.json
git commit -m "test(accept): prove q-patient-demographics v2 output equals thin output on real PG (restructure R3b)"
```

---

## Task 5: Cross-package verification gate

**Files:** none.

- [ ] **Step 1: Per-package typecheck + tests** (never pipe turbo through `tail`):
```bash
pnpm --filter @openldr/db exec tsc --noEmit
pnpm --filter @openldr/db exec vitest run
pnpm --filter @openldr/reporting exec tsc --noEmit
pnpm --filter @openldr/reporting exec vitest run
pnpm --filter @openldr/dashboards exec tsc --noEmit
pnpm --filter @openldr/bootstrap exec vitest run
pnpm --filter @openldr/server exec vitest run
```
Expected: ALL PASS. If a reporting parity/structural test hardcoded the old demographics SQL text, update it to the new SQL (do not revert the cutover).

- [ ] **Step 2: Final scoped turbo gate** (informational — per-package authoritative on Windows):
```bash
pnpm turbo run typecheck test --filter=@openldr/db --filter=@openldr/reporting --force
```
Expected: PASS (ignore Windows lock/EPERM flakes; trust per-package).

---

## Self-Review

**Spec coverage:** `managing_organization` column + type + mapper (T1) · in-place SQL rewrite of all 3 variants (T2) · parity harness seeds v2 (T3) · real-PG behavior-preservation proof (T4) · gate (T5). In-place cutover / full-reference facility / gender→sex mapping / PG-first — all covered. Deferred (upgrade re-seed, other reports, live MSSQL/MySQL, thin drop) correctly excluded. ✔

**Placeholder scan:** Migration + mapper + harness edits have complete code; T2's rewrite is rule-based against the 3 concrete existing variants (exact substitutions listed); T4's proof script is specified as "provide real compilable code following the harness style" (a ~120-line script best written against the concrete `mysql-reports-parity.ts`) — no placeholders in shipped code. ✔

**Type consistency:** `V2PatientsTable.managing_organization: string|null` (T1) matches the migration column + the mapper's `reference()` output + the report's WHERE. `createRelationalWriter` reused in the harness + proof (T3/T4). The proof compares thin-SQL vs v2-SQL via the shared `normalizeRows`/`firstDiff`. ✔

**Risk notes for the executor:** (1) the cutover is behavior-preserving ONLY if all 3 substitutions land in every variant — the age ladder differs per dialect but table/column/gender lines are analogous; the T4 proof (thin ≡ v2) is the real guard. (2) Do not change fixture DATA — only add v2 seeding. (3) `managing_organization` MUST be the full reference (`reference()`), not `referenceId()`, or the facility filter breaks. (4) Existing-install upgrade re-seed is deferred (documented), not built here.
