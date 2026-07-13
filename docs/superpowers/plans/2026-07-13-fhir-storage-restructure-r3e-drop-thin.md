# FHIR Storage Restructure — R3e: Drop Thin + Rename v2→Canonical Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the legacy thin flat schema entirely (its write path, tables, types, and readers) and rename the six `v2_*` read-model tables to canonical names, ending at a clean canonical external warehouse — with report output proven unchanged.

**Architecture:** Drop-then-rename in one slice. First capture a golden snapshot of the 9 reports' output (safety net). Then remove the thin write path (the relational writer is already a complete peer sink), drop the thin tables + rename `v2_*`→canonical in migration 007, and mechanically swap every `v2_` identifier to canonical across schema/mappers/export/seed-SQL. Rewrite the sample dashboard onto canonical columns. Retire the thin-vs-v2 acceptance harnesses; the new `reports:accept` asserts the canonical reports equal the golden and smoke-runs the dashboard.

**Tech Stack:** TypeScript, Kysely (engine-aware DDL; MSSQL `sp_rename`), pg-mem (unit), real Postgres `:5433` (golden + projection proof), Vitest, pnpm/turbo.

**Spec:** `docs/superpowers/specs/2026-07-13-fhir-storage-restructure-r3e-drop-thin-design.md`

---

## Canonical rename map (used throughout)

| v2 table / interface / key | canonical |
| --- | --- |
| `v2_patients` / `V2PatientsTable` | `patients` / `PatientsTable` |
| `v2_lab_requests` / `V2LabRequestsTable` | `lab_requests` / `LabRequestsTable` |
| `v2_lab_results` / `V2LabResultsTable` | `lab_results` / `LabResultsTable` |
| `v2_facilities` / `V2FacilitiesTable` | `facilities` / `FacilitiesTable` |
| `v2_specimens` / `V2SpecimensTable` | `specimens` / `SpecimensTable` |
| `v2_diagnostic_reports` / `V2DiagnosticReportsTable` | `diagnostic_reports` / `DiagnosticReportsTable` |

The 7 thin interfaces (`PatientsTable`, `SpecimensTable`, `ServiceRequestsTable`, `DiagnosticReportsTable`, `ObservationsTable`, `OrganizationsTable`, `LocationsTable`) are **deleted**; four of their names are reused by the renamed v2 interfaces above.

Dashboard/report thin→canonical column map (Tasks 6, 7):

| thin | canonical |
| --- | --- |
| `service_requests` | `lab_requests` |
| `service_requests.authored_on` | `lab_requests.authored_at` |
| `service_requests.subject_ref` | `lab_requests.patient_id` |
| `service_requests.code_text` | `lab_requests.panel_desc` |
| `service_requests.identifier_value` | `lab_requests.request_id` |
| `observations` | `lab_results` |
| `observations.effective_date_time` | `lab_results.result_timestamp` |
| `observations.interpretation_code` | `lab_results.abnormal_flag` |
| `observations.code_text` | `lab_results.observation_desc` |
| `observations.value_quantity` | `lab_results.numeric_value` |

---

## Task 0: Cut the branch

**Files:** none (git only).

- [ ] **Step 1: Create and switch to the feature branch**

Run:
```bash
git checkout -b feat/fhir-drop-thin
git branch --show-current
```
Expected: prints `feat/fhir-drop-thin`. Working tree clean (spec committed on `main` at `07300086`, included in this branch).

---

## Task 1: Capture the reports golden snapshot

**Files:**
- Create (throwaway, NOT committed): `scripts/__capture-golden.ts`
- Create (committed): `scripts/lib/reports-golden.json`

The golden is captured from the CURRENT `v2_`-reading report SQL, so this task must run before any rename. It uses only `createRelationalWriter` (no thin), so it is independent of the later flat-writer deletion.

- [ ] **Step 1: Write a throwaway capture script**

Create `scripts/__capture-golden.ts` modeled on `scripts/reports-cutover-accept.ts` (read that file first for the exact imports/helpers — `createMigrator`, `externalMigrations`, `createRelationalWriter`, `SEED_QUERIES`, `prepareSelect`, the fixture from `scripts/lib/reports-parity-fixture.ts`, `normalizeRows`). It should: migrate a real-PG `openldr_target` to latest, wipe `TABLES`, seed the fixture via `createRelationalWriter`, then for each of the 9 `SEED_QUERIES` run `.sql.postgres` through `prepareSelect(sql, seed.params, bag)` for a fixed param bag and collect `{ id, bag, rows: normalizeRows(result) }`. Param bags to use (same as R3c/R3d accept harnesses):
```ts
const GOLDEN_CASES: { id: string; bag: Record<string, string> }[] = [
  { id: 'q-facilities', bag: {} },
  { id: 'q-test-volume', bag: { from: '2026-01-01', to: '2026-12-31' } },
  { id: 'q-turnaround-time', bag: { from: '2026-01-01', to: '2026-12-31', facility: '' } },
  { id: 'q-patient-demographics', bag: { facility: '', asOf: '' } },
  { id: 'q-amr-resistance', bag: { from: '2026-01-01', to: '2026-12-31', facility: '' } },
  { id: 'q-amr-facility-summary', bag: { from: '2026-01-01', to: '2026-12-31' } },
  { id: 'q-amr-glass-ris', bag: { from: '2026-01-01', to: '2026-12-31', country: '', year: '' } },
  { id: 'q-amr-first-isolate-summary', bag: { from: '2026-01-01', to: '2026-12-31' } },
  { id: 'q-amr-antibiogram', bag: { from: '2026-01-01', to: '2026-12-31' } },
];
```
Write the collected array to `scripts/lib/reports-golden.json` (pretty-printed). Verify the exact param names for `q-patient-demographics` against its seed def (it uses `facility`/`asOf`); if a bag is missing a `{{param.x}}` token the SQL references, `prepareSelect` throws `unbound parameter`.

- [ ] **Step 2: Run it against the current (pre-R3e) state on real PG**

Run:
```bash
docker compose up -d postgres
node_modules/.bin/tsx scripts/__capture-golden.ts
```
Expected: writes `scripts/lib/reports-golden.json` with 9 entries, each with a non-empty `rows` array (the fixture produces rows for every report — if any is empty, the bag or fixture is wrong; investigate before proceeding).

- [ ] **Step 3: Delete the throwaway script and commit only the golden**

```bash
rm scripts/__capture-golden.ts
git add scripts/lib/reports-golden.json
git commit -m "test(accept): capture pre-R3e reports golden snapshot (restructure R3e)"
```
The capture script is NOT committed (it would reference symbols the later tasks keep, and its job is done). No `Co-Authored-By` trailer.

---

## Task 2: Extract batch-upsert helpers + remove the thin write path

**Files:**
- Create: `packages/db/src/batch-upsert.ts`
- Modify: `packages/db/src/relational-writer.ts`
- Modify: `packages/db/src/index.ts`
- Delete: `packages/db/src/flat-writer.ts`, `packages/db/src/flat-writer.test.ts` (if present), `packages/db/src/flatten/` (entire dir + tests)
- Modify: `packages/db/src/projection/cycle.ts`, `packages/db/src/projection/cycle.test.ts`
- Modify: `packages/bootstrap/src/db-context.ts`, `packages/bootstrap/src/ingest-context.ts`, `packages/bootstrap/src/index.ts`

- [ ] **Step 1: Extract the shared batch-upsert helpers into a new module**

Create `packages/db/src/batch-upsert.ts` by MOVING (verbatim) from `flat-writer.ts`: the `WriteResult` type, the `PG_PARAM_BUDGET`/`MSSQL_PARAM_BUDGET`/`MSSQL_MAX_VALUES_ROWS`/`MYSQL_PARAM_BUDGET` constants, the `chunkSize` helper, and the three exported functions `insertBatchPg`, `mergeBatchMssql`, `insertBatchMysql`. Keep the explanatory comments. It needs only `import { type Kysely, sql } from 'kysely';`.

- [ ] **Step 2: Repoint relational-writer to the new module**

In `packages/db/src/relational-writer.ts` change:
```ts
import { insertBatchPg, mergeBatchMssql, insertBatchMysql, type WriteResult } from './flat-writer';
```
to:
```ts
import { insertBatchPg, mergeBatchMssql, insertBatchMysql, type WriteResult } from './batch-upsert';
```

- [ ] **Step 3: Delete the flat writer + flatten dir**

Delete `packages/db/src/flat-writer.ts` and `packages/db/src/flatten/` (the whole directory: `index.ts`, `patient.ts`, `specimen.ts`, `service-request.ts`, `diagnostic-report.ts`, `observation.ts`, `organization.ts`, `location.ts`, and any `*.test.ts`). Also delete `packages/db/src/flat-writer.test.ts` if it exists.

- [ ] **Step 4: Update the db package index**

In `packages/db/src/index.ts`: remove `export * from './flatten/index';` and `export * from './flat-writer';`, and add `export * from './batch-upsert';` (so `WriteResult`/the batch helpers remain exported for the acceptance scripts).

- [ ] **Step 5: Remove flatWriter from the projection cycle**

In `packages/db/src/projection/cycle.ts`:
- Delete `import type { FlatWriter } from '../flat-writer';` and remove `flatWriter: FlatWriter;` from `ProjectionDeps`.
- In `applyProjection`, remove the two `deps.flatWriter.write(canonical)` / `deps.flatWriter.deleteById(...)` lines (keep the `relationalWriter` ones).
- In `reprojectAll`, change the `Pick<ProjectionDeps, 'internalDb' | 'flatWriter' | 'relationalWriter'>` to `Pick<ProjectionDeps, 'internalDb' | 'relationalWriter'>` and remove the `deps.flatWriter.writeMany(...)` line.

- [ ] **Step 6: Update the projection cycle test**

In `packages/db/src/projection/cycle.test.ts`, remove the `flatWriter` from the test `ProjectionDeps` it constructs (and any `createFlatWriter` import / assertions on thin tables — switch those to the relational writer / canonical tables if present). Read the file to see its exact shape; keep the test meaningful (it should still assert the relational sink is written).

- [ ] **Step 7: Unwire flatWriter from bootstrap**

- `packages/bootstrap/src/db-context.ts`: remove `createFlatWriter` and `type FlatWriter` from the `@openldr/db` import; remove `flatWriter: FlatWriter;` from the `DbContext` interface; remove `const flatWriter = createFlatWriter(externalDb, engine);` and the `flatWriter,` field in the returned object. First `grep -rn "\.flatWriter" packages apps --include=*.ts | grep -v node_modules` to confirm no consumer reads `dbContext.flatWriter` — if one does, repoint it to `relationalWriter` or report it.
- `packages/bootstrap/src/ingest-context.ts`: remove `createFlatWriter` from the import and delete the dead `const flatWriter = createFlatWriter(externalDb, engine);` line (it is never used).
- `packages/bootstrap/src/index.ts`: remove `createFlatWriter` from the import; delete `const workflowFlatWriter = createFlatWriter(externalDb, engine);`; in the `createProjectionRunner({...})` call remove the `flatWriter: workflowFlatWriter,` line (keep `relationalWriter: workflowRelationalWriter,`).

- [ ] **Step 8: Typecheck + test**

Run: `pnpm --filter @openldr/db exec tsc --noEmit && pnpm --filter @openldr/bootstrap exec tsc --noEmit`
Expected: PASS (no dangling `FlatWriter`/`flattenResource`/`createFlatWriter` references). If tsc flags a missed importer, fix it.
Run: `pnpm --filter @openldr/db exec vitest run` and `pnpm --filter @openldr/bootstrap exec vitest run`
Expected: PASS (the projection cycle test now exercises only the relational sink).

Note: the acceptance scripts in `scripts/` (mssql/mysql live-acceptance, reports/demographics cutover-accept, reports-parity) still import `createFlatWriter` and will not typecheck until Task 9 — that's expected; they are not part of the per-package gate. Do NOT fix them here.

- [ ] **Step 9: Commit**

```bash
git add -A packages/db packages/bootstrap
git commit -m "refactor(db): extract batch-upsert; remove thin write path (flatWriter + flatten) (restructure R3e)"
```

---

## Task 3: Migration 007 — drop thin + rename v2→canonical

**Files:**
- Create: `packages/db/src/migrations/external/007_drop_thin_rename_v2.ts`
- Create: `packages/db/src/migrations/external/007_drop_thin_rename_v2.test.ts`
- Modify: `packages/db/src/migrations/external/index.ts`
- Modify: `packages/db/src/migrations/migrations.test.ts`

- [ ] **Step 1: Add the migration key to the test first (fails)**

In `packages/db/src/migrations/migrations.test.ts`, append `'007_drop_thin_rename_v2'` to the external migration key-list assertion (currently ending `'006_v2_amr_links'`).

Run: `pnpm --filter @openldr/db exec vitest run src/migrations/migrations.test.ts`
Expected: FAIL (key not registered yet).

- [ ] **Step 2: Write the migration**

Create `packages/db/src/migrations/external/007_drop_thin_rename_v2.ts`:
```ts
import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';

const THIN_TABLES = ['patients', 'specimens', 'service_requests', 'diagnostic_reports', 'observations', 'organizations', 'locations'];
const RENAMES: [string, string][] = [
  ['v2_patients', 'patients'],
  ['v2_lab_requests', 'lab_requests'],
  ['v2_lab_results', 'lab_results'],
  ['v2_facilities', 'facilities'],
  ['v2_specimens', 'specimens'],
  ['v2_diagnostic_reports', 'diagnostic_reports'],
];

async function rename(db: Kysely<unknown>, engine: TargetEngine, from: string, to: string): Promise<void> {
  if (engine === 'mssql') {
    // SQL Server has no ALTER TABLE ... RENAME TO; sp_rename takes the object name + new name.
    await sql`EXEC sp_rename ${sql.lit(from)}, ${sql.lit(to)}`.execute(db);
  } else {
    await db.schema.alterTable(from).renameTo(to).execute(); // PG + MySQL: ALTER TABLE ... RENAME TO
  }
}

// R3e: the thin flat read-model is fully superseded by the v2 relational tables. Drop the 7 thin
// tables, THEN rename the 6 v2_ tables to canonical (drop first so v2_specimens->specimens etc. do
// not collide with the thin table of the same name).
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  for (const t of THIN_TABLES) await db.schema.dropTable(t).ifExists().execute();
  for (const [from, to] of RENAMES) await rename(db, engine, from, to);
}

// One-directional: renames canonical back to v2_ (so a dev down-migrate restores the pre-007 table
// NAMES). Recreating the dropped thin tables is intentionally out of scope — the thin schema is gone
// for good; down() runs only on real PG in dev, never under pg-mem tests.
export async function down(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  for (const [from, to] of RENAMES) await rename(db, engine, to, from);
}
```
Check `sql.lit` exists in the installed Kysely; if not, use `sql.raw("'" + from + "'")` (the names are trusted internal constants, not user input). Confirm `renameTo` is available on the alterTable builder for the installed Kysely version (it is in modern Kysely).

- [ ] **Step 3: Register in the index**

In `packages/db/src/migrations/external/index.ts` add `import * as m007 from './007_drop_thin_rename_v2';` and, as the last entry in the returned object, `'007_drop_thin_rename_v2': { up: (db) => m007.up(db, engine), down: (db) => m007.down(db, engine) },` (note `down` needs `engine` too — pass it like `up`).

- [ ] **Step 4: Write the migration test**

Create `packages/db/src/migrations/external/007_drop_thin_rename_v2.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedExternalDb } from '../../test-helpers-external';

describe('007 drop thin + rename v2->canonical', () => {
  it('drops thin tables and renames v2_ tables to canonical', async () => {
    const db = await makeMigratedExternalDb();
    // canonical tables exist and accept inserts (these are the renamed v2_ tables)
    await db.insertInto('patients').values({ id: 'p1', sex: 'M' }).execute();
    await db.insertInto('lab_results').values({ id: 'o1', abnormal_flag: 'R', patient_id: 'p1' }).execute();
    await db.insertInto('specimens').values({ id: 's1', patient_id: 'p1', origin: 'inpatient' }).execute();
    expect(await db.selectFrom('patients').selectAll().execute()).toHaveLength(1);
    expect(await db.selectFrom('lab_results').selectAll().execute()).toHaveLength(1);
    // a dropped thin-only column/table is gone: the old thin `observations` table no longer exists
    await expect(sql`select 1 from observations`.execute(db)).rejects.toThrow();
    await db.destroy();
  });
});
```
(Uses the canonical `ExternalSchema` types from Task 4 — so this test compiles only after Task 4. If executing strictly task-by-task, write this test's body now but expect it to typecheck-fail until Task 4; run it at the end of Task 4. Alternatively, use `sql`...`` raw inserts here to avoid the type dependency. Prefer raw `sql` inserts so this task is self-contained:)
```ts
    await sql`insert into patients (id, sex) values ('p1','M')`.execute(db);
    const rows = await sql`select id, sex from patients`.execute(db);
    expect(rows.rows).toHaveLength(1);
    await expect(sql`select 1 from observations`.execute(db)).rejects.toThrow();
```

- [ ] **Step 5: Run the migration tests**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations`
Expected: the `007` test PASSES (pg-mem supports rename + drop, spike-verified) and `migrations.test.ts` now passes with the appended key. The existing `003`/`004`/`005` migration tests will FAIL here because they insert into `v2_*` tables that 007 has renamed — that is expected and fixed in Task 5 (they move to canonical names). If you want a green run now, temporarily note it; the whole-package gate is green only after Task 5.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/migrations/external/007_drop_thin_rename_v2.ts packages/db/src/migrations/external/007_drop_thin_rename_v2.test.ts packages/db/src/migrations/external/index.ts packages/db/src/migrations/migrations.test.ts
git commit -m "feat(db): migration 007 — drop thin tables + rename v2_->canonical (restructure R3e)"
```

---

## Task 4: Rename schema types + export-data → canonical

**Files:**
- Modify: `packages/db/src/schema/external.ts`
- Modify: `packages/db/src/export-data.ts`
- Modify: `packages/db/src/export-data.test.ts`

- [ ] **Step 1: Rewrite the external schema types**

In `packages/db/src/schema/external.ts`:
- Delete the 7 thin interfaces: `PatientsTable`, `SpecimensTable`, `ServiceRequestsTable`, `DiagnosticReportsTable`, `ObservationsTable`, `OrganizationsTable`, `LocationsTable`.
- Rename the 6 `V2*Table` interfaces to their canonical names per the map (e.g. `export interface V2PatientsTable` → `export interface PatientsTable`). Keep their bodies unchanged.
- Rewrite `ExternalSchema` to have ONLY the 6 canonical keys:
```ts
export interface ExternalSchema {
  patients: PatientsTable;
  lab_requests: LabRequestsTable;
  lab_results: LabResultsTable;
  facilities: FacilitiesTable;
  specimens: SpecimensTable;
  diagnostic_reports: DiagnosticReportsTable;
}
```

- [ ] **Step 2: Rewrite EXTERNAL_TABLE_COLUMNS + exportFlatTables**

In `packages/db/src/export-data.ts`:
- In `EXTERNAL_TABLE_COLUMNS`, delete the 7 thin entries and rename the 6 `v2_` keys to canonical (keep each column array as-is — they already list the v2 columns):
```ts
export const EXTERNAL_TABLE_COLUMNS: Record<keyof ExternalSchema, string[]> = {
  patients: ['id', 'patient_guid', 'surname', 'firstname', 'date_of_birth', 'sex', 'national_id', 'phone', 'email', 'managing_organization', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  lab_requests: ['id', 'request_id', 'patient_id', 'panel_code', 'panel_system', 'panel_desc', 'status', 'priority', 'authored_at', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  lab_results: ['id', 'request_id', 'observation_code', 'observation_system', 'observation_desc', 'result_type', 'numeric_value', 'numeric_units', 'coded_value', 'text_value', 'abnormal_flag', 'result_timestamp', 'patient_id', 'specimen_id', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  facilities: ['id', 'facility_code', 'facility_name', 'facility_type', 'source_resource', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  specimens: ['id', 'patient_id', 'received_time', 'accession', 'status', 'type_code', 'type_text', 'origin', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  diagnostic_reports: ['id', 'patient_id', 'status', 'code_code', 'code_text', 'issued', 'effective', 'conclusion', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
};
```
- Rewrite `exportFlatTables` to read the 6 canonical tables:
```ts
export async function exportFlatTables(db: Kysely<ExternalSchema>): Promise<TableExport[]> {
  return [
    { table: 'patients', columns: EXTERNAL_TABLE_COLUMNS.patients, rows: (await db.selectFrom('patients').selectAll().execute()) as Record<string, unknown>[] },
    { table: 'facilities', columns: EXTERNAL_TABLE_COLUMNS.facilities, rows: (await db.selectFrom('facilities').selectAll().execute()) as Record<string, unknown>[] },
    { table: 'specimens', columns: EXTERNAL_TABLE_COLUMNS.specimens, rows: (await db.selectFrom('specimens').selectAll().execute()) as Record<string, unknown>[] },
    { table: 'lab_requests', columns: EXTERNAL_TABLE_COLUMNS.lab_requests, rows: (await db.selectFrom('lab_requests').selectAll().execute()) as Record<string, unknown>[] },
    { table: 'lab_results', columns: EXTERNAL_TABLE_COLUMNS.lab_results, rows: (await db.selectFrom('lab_results').selectAll().execute()) as Record<string, unknown>[] },
    { table: 'diagnostic_reports', columns: EXTERNAL_TABLE_COLUMNS.diagnostic_reports, rows: (await db.selectFrom('diagnostic_reports').selectAll().execute()) as Record<string, unknown>[] },
  ];
}
```

- [ ] **Step 3: Update export-data.test.ts**

In `packages/db/src/export-data.test.ts`, update the `Object.keys(EXTERNAL_TABLE_COLUMNS).sort()` assertion to the 6 canonical keys: `['diagnostic_reports', 'facilities', 'lab_requests', 'lab_results', 'patients', 'specimens']`. Keep the per-entry `id`/`source_system`/`batch_id` checks.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @openldr/db exec tsc --noEmit`
Expected: FAIL in `relational/` + `report-seeds` consumers still referencing `v2_*` keys — that's expected; those are Tasks 5–6. But `export-data.ts` + `schema/external.ts` themselves must be internally consistent. Run `pnpm --filter @openldr/db exec vitest run src/export-data.test.ts` — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/external.ts packages/db/src/export-data.ts packages/db/src/export-data.test.ts
git commit -m "refactor(db): rename external schema types + export-data to canonical (restructure R3e)"
```

---

## Task 5: Rename relational mappers/writer + migration/relational tests → canonical

**Files:**
- Modify: `packages/db/src/relational/index.ts`
- Modify: `packages/db/src/relational/*.ts` (per-resource mappers — the `Insertable<V2*Table>` return types)
- Modify: `packages/db/src/relational/relational.test.ts`, `packages/db/src/relational-writer.test.ts`
- Modify: `packages/db/src/migrations/external/003_v2_core.test.ts`, `004_v2_patients_facility.test.ts`, `005_v2_specimen_diagreport.test.ts`

- [ ] **Step 1: Rename table targets in relational/index.ts**

In `packages/db/src/relational/index.ts`, change every `table:` value in `projectResource` and every return in `v2TableForResourceType` from `v2_*` to canonical (`'v2_patients'`→`'patients'`, `'v2_lab_requests'`→`'lab_requests'`, `'v2_lab_results'`→`'lab_results'`, `'v2_facilities'`→`'facilities'`, `'v2_specimens'`→`'specimens'`, `'v2_diagnostic_reports'`→`'diagnostic_reports'`). Rename the exported `v2TableForResourceType` to `tableForResourceType` (the thin one that had this name is deleted) and update its importer in `relational-writer.ts`.

- [ ] **Step 2: Rename the mapper return types**

In each `packages/db/src/relational/*.ts` (`patient.ts`, `service-request.ts`, `observation.ts`, `facility.ts`, `specimen.ts`, `diagnostic-report.ts`), change the `Insertable<V2XxxTable>` type import + annotation to the canonical `Insertable<XxxTable>`. (e.g. `observation.ts`: `import type { V2LabResultsTable }` → `import type { LabResultsTable }`, and `Insertable<V2LabResultsTable>` → `Insertable<LabResultsTable>`.)

- [ ] **Step 3: Rename v2_ references in db tests**

- `relational.test.ts` + `relational-writer.test.ts`: change every `insertInto('v2_x')`/`selectFrom('v2_x')`/`table: 'v2_x'` assertion to canonical.
- `003_v2_core.test.ts`, `004_v2_patients_facility.test.ts`, `005_v2_specimen_diagreport.test.ts`: change every `insertInto('v2_x')`/`selectFrom('v2_x')` to canonical (these run `makeMigratedExternalDb()` which now migrates through 007, so the tables are canonical). Their `describe` labels can stay (historical) or be lightly noted.

- [ ] **Step 4: Typecheck + full db test suite**

Run: `pnpm --filter @openldr/db exec tsc --noEmit`
Expected: PASS (all `v2_` schema references within `@openldr/db` are now canonical).
Run: `pnpm --filter @openldr/db exec vitest run`
Expected: PASS — migrations (incl. 003–007), relational mappers, relational writer, export-data all green against the canonical schema.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/relational packages/db/src/relational-writer.ts packages/db/src/migrations/external
git commit -m "refactor(db): rename relational mappers + tests to canonical tables (restructure R3e)"
```

---

## Task 6: Rename report seed SQL + AMR catalog → canonical

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts`
- Modify: `packages/reporting/src/amr/query.ts`, `packages/reporting/src/reports/amr-isolates.ts`

- [ ] **Step 1: Swap all v2_ identifiers to canonical**

In `packages/reporting/src/seed/report-seeds.ts`, replace every `v2_patients`→`patients`, `v2_lab_requests`→`lab_requests`, `v2_lab_results`→`lab_results`, `v2_specimens`→`specimens`, `v2_diagnostic_reports`→`diagnostic_reports`, `v2_facilities`→`facilities` across all 9 reports (all 3 engine variants; ~77 occurrences). This is a pure identifier rename — NO column names or logic change (columns are already the v2 columns). Do the same in `packages/reporting/src/amr/query.ts` and `packages/reporting/src/reports/amr-isolates.ts` (their `selectFrom('v2_x')` calls). Add a one-line R3e note to the `report-seeds.ts` header comment in the established style.

Careful: only swap the `v2_`-prefixed table identifiers. Do NOT touch column names, comments describing history, or the word `v2` in prose comments.

- [ ] **Step 2: Typecheck + reporting tests**

Run: `pnpm --filter @openldr/reporting exec tsc --noEmit`
Expected: PASS (the `selectFrom('v2_lab_results')` calls in `amr/query.ts`/`amr-isolates.ts` now reference canonical `ExternalSchema` keys).
Run: `pnpm --filter @openldr/reporting exec vitest run`
Expected: PASS (unit tests unaffected; SQL is template strings — proven on real PG in Task 9).

- [ ] **Step 3: Grep for stray v2_ in reporting**

Run: `grep -rn "v2_" packages/reporting/src --include=*.ts | grep -v "// " | grep -v "\.test\.ts"`
Expected: no SQL/identifier hits remain (only prose comments, if any). Report the result.

- [ ] **Step 4: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts packages/reporting/src/amr/query.ts packages/reporting/src/reports/amr-isolates.ts
git commit -m "refactor(reporting): rename report + AMR SQL to canonical tables (restructure R3e)"
```

---

## Task 7: Cut the sample dashboard over to canonical

**Files:**
- Modify: `packages/dashboards/src/samples/openldr-general.json`

- [ ] **Step 1: Rewrite each widget + filter SQL to canonical columns**

Apply the thin→canonical column map (top of plan) to every `sql`/`optionsSql` string in `openldr-general.json`. Read the file first. Concretely:
- **`test` filter `optionsSql`**: `SELECT DISTINCT code_text FROM service_requests ...` → `SELECT DISTINCT panel_desc FROM lab_requests WHERE panel_desc IS NOT NULL ORDER BY panel_desc`.
- **s1 (Total Orders)**: `FROM service_requests`, `authored_on`→`authored_at`, `code_text`→`panel_desc` (in the `[[AND code_text = {{test}}]]` clause → `[[AND panel_desc = {{test}}]]`), `priority` unchanged.
- **s2 (Distinct Patients)**: `COUNT(DISTINCT subject_ref)`→`COUNT(DISTINCT patient_id)`, `FROM service_requests`→`lab_requests`, `authored_on`→`authored_at`, `code_text`→`panel_desc`.
- **s3 (Results Recorded)**: `FROM observations`→`lab_results`, `effective_date_time`→`result_timestamp`, `code_text`→`observation_desc`.
- **s4 (Result Finalisation %) — SEMANTIC REMAP**: change `FROM observations` to `FROM diagnostic_reports` (the canonical diagnostic_reports table has `status`). The query becomes `SELECT CASE WHEN COUNT(*) > 0 THEN ROUND(SUM(CASE WHEN status IN ('final','amended') THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 0) ELSE 100 END AS value FROM diagnostic_reports`. (Rationale: `v2_lab_results` has no `status`; report finalisation matches the widget title. This is the one deliberate non-1:1 change.)
- **s5 (Orders by Test)**: `FROM service_requests`→`lab_requests`, `code_text`→`panel_desc` (both the `SELECT ... AS label`, the `WHERE code_text IS NOT NULL`, and `GROUP BY`), `authored_on`→`authored_at`.
- **s6 (Orders Trend)**: `service_requests`→`lab_requests`, `authored_on`→`authored_at` (in SELECT substring, WHERE, GROUP BY), `code_text`→`panel_desc`.
- **s7 (Orders by Status)**: `service_requests`→`lab_requests`, `authored_on`→`authored_at`, `code_text`→`panel_desc`, `status` unchanged.
- **s8 (Orders by Priority)**: `service_requests`→`lab_requests`, `authored_on`→`authored_at`, `code_text`→`panel_desc`, `priority` unchanged.
- **s9 (funnel)**: `FROM service_requests`→`lab_requests`; `FROM specimens WHERE received_time IS NOT NULL` (canonical `specimens` has `received_time` — unchanged name); `FROM observations`→`lab_results`; `FROM diagnostic_reports WHERE issued IS NOT NULL` (canonical `diagnostic_reports` has `issued` — unchanged name).
- **s10 (Abnormal Results)**: `FROM observations`→`lab_results`, `interpretation_code`→`abnormal_flag`, `effective_date_time`→`result_timestamp`.
- **s11 (Results Trend)**: `FROM observations`→`lab_results`, `effective_date_time`→`result_timestamp`, `code_text`→`observation_desc`.
- **s12 (scatter)**: `FROM observations`→`lab_results`, `value_quantity`→`numeric_value`, `code_text`→`observation_desc`.
- **s13 (Recent Orders table)**: `FROM service_requests`→`lab_requests`, `identifier_value`→`request_id`, `code_text`→`panel_desc`, `authored_on`→`authored_at`, `status`/`priority` unchanged.

Keep the `[[ … ]]` optional-clause syntax, `{{param}}` tokens, `variableBindings`, `variables`, `visual`, `layout`, and the `OFFSET n ROWS FETCH NEXT m ROWS ONLY` clauses.

- [ ] **Step 2: Validate JSON + dashboards tests**

Run: `node -e "JSON.parse(require('fs').readFileSync('packages/dashboards/src/samples/openldr-general.json','utf8')); console.log('valid json')"`
Expected: `valid json`.
Run: `pnpm --filter @openldr/dashboards exec vitest run` and `pnpm --filter @openldr/dashboards exec tsc --noEmit`
Expected: PASS (if a sample-schema test validates the JSON against `DashboardSchema`, it stays green — only SQL strings changed).

- [ ] **Step 3: Commit**

```bash
git add packages/dashboards/src/samples/openldr-general.json
git commit -m "feat(dashboards): cut sample dashboard over to canonical tables (restructure R3e)"
```

---

## Task 8: facilityOptions + repo-wide stray-thin sweep

**Files:**
- Verify (likely no change): `packages/reporting/src/helpers.ts`
- Modify: any remaining thin readers surfaced by the sweep

- [ ] **Step 1: Confirm facilityOptions repoints transparently**

`packages/reporting/src/helpers.ts` `facilityOptions` does `db.selectFrom('patients').select('managing_organization')`. After the rename, `patients` is the canonical table (which has `managing_organization`), so this compiles + works unchanged. Verify with `pnpm --filter @openldr/reporting exec tsc --noEmit` (already green from Task 6). No edit expected — if tsc complains, the canonical `PatientsTable` is missing `managing_organization` (it is not — R3b added it), so investigate.

- [ ] **Step 2: Repo-wide sweep for any remaining thin readers/writers**

Run:
```bash
grep -rn "selectFrom('observations'\|selectFrom('service_requests'\|selectFrom('organizations'\|selectFrom('locations'\|createFlatWriter\|flattenResource\|from './flatten'\|FlatWriter" packages apps --include=*.ts | grep -v node_modules | grep -v "\.test\.ts"
```
Expected: no hits in `packages/`/`apps/` product code (only `scripts/` acceptance harnesses, fixed in Task 9). If any product file still reads a dropped thin table or imports the deleted flat writer, repoint/remove it and note it. (Known clear: `facilityOptions` reads `patients` which is now canonical; that's fine.)

- [ ] **Step 3: Commit (only if changes were needed)**

```bash
git add -A packages apps
git commit -m "refactor: repoint remaining thin readers to canonical (restructure R3e)"
```
If Step 2 found nothing and Step 1 needed no edit, skip this commit and note "no residual thin readers".

---

## Task 9: Rewrite/retire acceptance harnesses + prove on real PG

**Files:**
- Create: `scripts/reports-golden-accept.ts` (the new `reports:accept`)
- Modify: `package.json` (root) — repoint the `reports:accept` script; remove `demographics:accept`
- Delete: `scripts/reports-cutover-accept.ts`, `scripts/demographics-cutover-accept.ts`
- Modify: `scripts/lib/reports-parity-fixture.ts`
- Modify: `scripts/mssql-live-acceptance.ts`, `scripts/mysql-live-acceptance.ts`, `scripts/mssql-reports-parity.ts`, `scripts/mysql-reports-parity.ts`
- Modify: `scripts/projection-live-acceptance.ts`

- [ ] **Step 1: Update the shared fixture to relational-only + canonical TABLES**

In `scripts/lib/reports-parity-fixture.ts`: remove the `createFlatWriter` seeding path (keep only the `createRelationalWriter` seed helper); change the `TABLES` wipe-list from the thin+`v2_` names to the 6 canonical names (`patients`, `lab_requests`, `lab_results`, `facilities`, `specimens`, `diagnostic_reports`). Read the file to see how `seedFixture`/`TABLES` are exported and keep the interface the other harnesses use.

- [ ] **Step 2: Write the new golden acceptance harness**

Create `scripts/reports-golden-accept.ts` (model on the retired `reports-cutover-accept.ts` structure): migrate real-PG `openldr_target` to latest (canonical schema), wipe `TABLES`, seed the fixture via `createRelationalWriter`, then:
- Load `scripts/lib/reports-golden.json`. For each entry, run the matching `SEED_QUERIES` `.sql.postgres` via `prepareSelect(sql, seed.params, bag)`, `normalizeRows` the result, and assert deep-equal to the golden rows (`firstDiff`-style; print + non-zero exit on any diff).
- Dashboard smoke: import the sample dashboard JSON (`@openldr/dashboards` sample) — for each widget's `query.sql` and each filter's `optionsSql`, strip `[[ … ]]` clauses (regex: remove `\[\[[^\]]*\]\]`) and run the resulting SQL directly on the seeded canonical DB; assert it executes without throwing and (for widget SQL) returns rows whose keys include the widget's declared output columns (`value`/`label`/etc.). Non-zero exit on any error.
Print `PASS`/`FAIL` per report and per widget and a final banner.

- [ ] **Step 3: Repoint package.json scripts**

In root `package.json`: point `reports:accept` at `tsx scripts/reports-golden-accept.ts`; remove the `demographics:accept` script entry. (Grep for other references to the removed script names and update/remove.)

- [ ] **Step 4: Delete the retired harnesses**

```bash
git rm scripts/reports-cutover-accept.ts scripts/demographics-cutover-accept.ts
```

- [ ] **Step 5: Rewrite the MSSQL/MySQL harnesses onto the relational writer + canonical tables**

In `scripts/mssql-live-acceptance.ts` + `scripts/mysql-live-acceptance.ts`: replace `createFlatWriter` with `createRelationalWriter`, and change every `selectFrom('patients')`/`selectFrom('service_requests')` etc. (and thin column reads like `family_name`/`authored_on`) to the canonical read-model tables/columns the relational writer produces (`patients` with `surname`/`sex`, `lab_requests` with `panel_desc`/`authored_at`, etc.). The goal is a harness that COMPILES and is logically correct against the canonical schema; live runs stay deferred. In `scripts/mssql-reports-parity.ts` + `scripts/mysql-reports-parity.ts`: same relational-only + canonical `TABLES` update as the fixture (Step 1); if they duplicated the thin-vs-v2 comparison, repoint them to run the canonical reports vs the golden (or reduce them to a canonical smoke run) — keep them compiling. Read each file; these are the largest edits in this task.

- [ ] **Step 6: Update projection-live-acceptance to canonical**

In `scripts/projection-live-acceptance.ts`: change the post-projection existence checks from thin (`selectFrom('patients')` with thin columns / `selectFrom('observations')`) to canonical read-model tables (`patients`, `lab_results`). It should assert the projection worker (now relational-only) writes the canonical tables.

- [ ] **Step 7: Typecheck the scripts + run the PG proofs**

Run: `pnpm --filter @openldr/db exec tsc --noEmit` and a repo-root `tsc --noEmit` if scripts are covered by a root tsconfig (else `node_modules/.bin/tsc --noEmit -p tsconfig.json`) to confirm the scripts compile with no `createFlatWriter`/thin references left.
Run the load-bearing proofs on real PG:
```bash
docker compose up -d postgres
pnpm reports:accept
pnpm projection:accept
```
Expected: `reports:accept` — all 9 reports equal the golden AND every dashboard widget smoke-runs; `projection:accept` — projection writes the canonical read model, all phases pass. Both exit 0. If a report diverges from golden, a rename typo slipped in (fix the seed SQL in Task 6, not the golden). If a dashboard widget throws, fix its SQL in Task 7.

- [ ] **Step 8: Commit**

```bash
git add -A scripts package.json
git commit -m "test(accept): golden reports:accept + dashboard smoke; rewrite mssql/mysql + projection harnesses to canonical (restructure R3e)"
```

---

## Task 10: Whole-slice review, gate, merge & push

**Files:** none (review + git).

- [ ] **Step 1: Cross-package gate**

Run: `pnpm turbo run typecheck test --force`
Expected: PASS for `@openldr/db`, `@openldr/reporting`, `@openldr/dashboards`, `@openldr/bootstrap` (and no NEW failures elsewhere). **Never pipe turbo through `tail`.** Ignore the known `@openldr/users` parallel-turbo flake (verify it passes via `pnpm --filter @openldr/users test` in isolation) and the `@openldr/cli#build` Windows esbuild-native failure. Re-run `pnpm reports:accept` + `pnpm projection:accept` to confirm the PG proofs still green.

- [ ] **Step 2: Whole-slice review**

Re-read the diff against the spec: thin write path gone (no `createFlatWriter`/`flatten`/`FlatWriter` in product code); migration 007 drops thin + renames v2; no `v2_` identifiers remain in schema/mappers/export/seed-SQL/dashboard (grep `grep -rn "v2_" packages --include=*.ts --include=*.json | grep -v node_modules | grep -v "// "` — only prose comments/history may remain); `facilityOptions` repointed; reports equal golden; dashboard smoke green; s4 remap documented. Confirm no `Co-Authored-By` trailers.

- [ ] **Step 3: Merge to local main (no-ff) + push**

```bash
git checkout main
git merge --no-ff feat/fhir-drop-thin -m "Merge branch 'feat/fhir-drop-thin': drop thin schema + rename v2->canonical (restructure R3e)"
git log --oneline -1
git push origin main
```
Expected: clean merge; push succeeds. After this, the thin schema is gone and the external read model is pure canonical v2 — the storage restructure's read-model migration is complete.

- [ ] **Step 4: Update memory**

Update `fhir-storage-restructure-workstream.md` + `MEMORY.md`: R3e DONE + pushed (new `origin/main` SHA); the full drop-thin cutover is complete; note the deferred upgrade re-seed (existing installs need a manual re-seed) and the deferred live MSSQL/MySQL harness runs.

---

## Self-review notes

- **Spec coverage:** golden capture (§Phase 1)→Task 1; write-path removal + batch extraction (§Phase 2)→Task 2; migration 007 (§Phase 3)→Task 3; schema/export rename (§Phase 4)→Task 4; mapper/writer/test rename (§Phase 4)→Task 5; seed-SQL rename (§Phase 4)→Task 6; dashboard cutover incl. s4 remap (§Phase 5)→Task 7; facilityOptions + sweep (§Phase 5)→Task 8; harness fate + PG proofs (§Phase 6)→Task 9; gate/merge/push (§Phase 7)→Task 10. All spec phases covered.
- **Ordering safety:** golden captured before any rename (Task 1); batch helpers extracted before flat-writer deleted (Task 2); thin dropped before v2 renamed within migration 007 (name-collision safety); reports stay on `v2_` (known-good) until the mechanical swap (Task 6), and the golden proves the swap (Task 9).
- **Name consistency:** the 6-table canonical map is applied identically in migration 007, schema types, `ExternalSchema`, `EXTERNAL_TABLE_COLUMNS`, `exportFlatTables`, relational `projectResource`/`tableForResourceType`, all seed SQL, the dashboard, and every test/harness.
- **The one non-mechanical change** (dashboard s4 `observations.status`→`diagnostic_reports.status`) is called out explicitly and excluded from the golden (dashboard is smoke-only).
