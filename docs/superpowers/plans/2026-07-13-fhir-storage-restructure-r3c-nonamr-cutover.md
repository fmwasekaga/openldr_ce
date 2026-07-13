# FHIR Storage Restructure — R3c: Cut Over Non-AMR Reports (→ v2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the 3 non-AMR built-in reports (`q-facilities`, `q-test-volume`, `q-turnaround-time`) over to read v2 tables, adding the two v2 tables `q-turnaround-time` needs, proving each report's output unchanged.

**Architecture:** Sub-slice of the full-cutover program (spec: `docs/superpowers/specs/2026-07-13-fhir-storage-restructure-r3c-nonamr-cutover-design.md`). Extends the R3b mechanic: additive v2 tables + in-place SQL rewrite + real-PG `thin ≡ v2` proof. New `v2_specimens`/`v2_diagnostic_reports` use bare `patient_id` soft refs (consistent with R3a).

**Tech Stack:** TypeScript, Kysely (Postgres + external engines), pg-mem (unit), real Postgres (proof), Vitest.

**Established facts (verified — do NOT re-derive):**
- `v2_lab_requests` already has `authored_at` + `panel_desc` (R3a) — `q-test-volume` needs no new columns. `v2_patients.managing_organization` exists (R3b) — `q-facilities` needs none.
- `q-facilities` reads only `patients.managing_organization`; `q-test-volume` reads only `service_requests` (`authored_on`,`code_text`, no join/facility); `q-turnaround-time` reads `specimens`(`subject_ref`,`received_time`) + `diagnostic_reports`(`subject_ref`,`issued`,`code_text`) + a facility subquery to `patients`.
- Thin flatteners to mirror: `flatten/specimen.ts`, `flatten/diagnostic-report.ts`. `referenceId`/`reference`/`codeable`/`str`/`provColumns`/`firstIdentifier` in `flatten/extract.ts` (codeable → `{code,text,system}`; referenceId → bare id).
- Next external migration = **005**. Migration pattern: `withCommon` + `dialect.ts` (`003_v2_core.ts`/`004`). `makeMigratedExternalDb` auto-includes 005 once registered. `migrations.test.ts` has an exhaustive external-migration key-list — update it.
- Parity harness (`scripts/mssql/mysql-reports-parity.ts` `seedFixture`) already routes EVERY fixture item through `createRelationalWriter`, so new Specimen/DiagnosticReport mappers auto-seed; only `TABLES` (wipe list) needs the 2 new tables.
- `EXTERNAL_TABLE_COLUMNS` in `export-data.ts` is `Record<keyof ExternalSchema,...>` — new schema keys force new entries (keep exhaustive; `exportFlatTables` still uses its fixed 7-thin-table list).
- Report SQL correctness is real-Postgres-only (age/date functions); proven by a `thin ≡ v2` script, not pg-mem.

---

## File Structure

**Create:** `external/005_v2_specimen_diagreport.ts` + `.test.ts`; `relational/specimen.ts`, `relational/diagnostic-report.ts`; `scripts/reports-cutover-accept.ts`.
**Modify:** `schema/external.ts`, `export-data.ts`, `external/index.ts`, `migrations/migrations.test.ts`, `relational/index.ts`, `relational/relational.test.ts`, `report-seeds.ts`, `scripts/lib/reports-parity-fixture.ts`, `package.json`.

---

## Task 1: `v2_specimens` + `v2_diagnostic_reports` tables

**Files:** Create `external/005_v2_specimen_diagreport.ts`, `.test.ts`; Modify `external/index.ts`, `schema/external.ts`, `export-data.ts`, `migrations/migrations.test.ts`.

- [ ] **Step 1: Failing migration test** — `packages/db/src/migrations/external/005_v2_specimen_diagreport.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { makeMigratedExternalDb } from '../../test-helpers-external';

describe('005 v2 specimen + diagnostic_report', () => {
  it('creates v2_specimens and v2_diagnostic_reports', async () => {
    const db = await makeMigratedExternalDb();
    await db.insertInto('v2_specimens').values({ id: 'sp1', patient_id: 'p1', received_time: '2026-01-01T00:00:00Z' }).execute();
    await db.insertInto('v2_diagnostic_reports').values({ id: 'dr1', patient_id: 'p1', code_text: 'CBC', issued: '2026-01-02T00:00:00Z' }).execute();
    expect(await db.selectFrom('v2_specimens').selectAll().execute()).toHaveLength(1);
    expect(await db.selectFrom('v2_diagnostic_reports').selectAll().execute()).toHaveLength(1);
    await db.destroy();
  });
});
```

- [ ] **Step 2: Run — fails.** `pnpm --filter @openldr/db exec vitest run src/migrations/external/005_v2_specimen_diagreport.test.ts` → FAIL.

- [ ] **Step 3: Create the migration** `packages/db/src/migrations/external/005_v2_specimen_diagreport.ts` (replicate `003`'s `withCommon` helper; FHIR-id keyed):
```ts
import { type Kysely, type CreateTableBuilder, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType, keyType, timestampType, nowExpr } from './dialect';

function withCommon(b: CreateTableBuilder<string, never>, engine: TargetEngine): CreateTableBuilder<string, never> {
  const text = sql.raw(textType(engine));
  let built = b
    .addColumn('source_system', text).addColumn('plugin_id', text).addColumn('plugin_version', text).addColumn('batch_id', text)
    .addColumn('created_at', sql.raw(timestampType(engine)), (c) => c.notNull().defaultTo(nowExpr(engine)));
  if (engine === 'mysql') built = built.modifyEnd(sql`character set utf8mb4`);
  return engine === 'postgres' ? built.ifNotExists() : built;
}

export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  const key = sql.raw(keyType(engine));
  await withCommon(
    db.schema.createTable('v2_specimens').addColumn('id', key, (c) => c.primaryKey())
      .addColumn('patient_id', text)
      .addColumn('received_time', text)
      .addColumn('accession', text)
      .addColumn('status', text)
      .addColumn('type_code', text)
      .addColumn('type_text', text),
    engine,
  ).execute();
  await withCommon(
    db.schema.createTable('v2_diagnostic_reports').addColumn('id', key, (c) => c.primaryKey())
      .addColumn('patient_id', text)
      .addColumn('status', text)
      .addColumn('code_code', text)
      .addColumn('code_text', text)
      .addColumn('issued', text)
      .addColumn('effective', text)
      .addColumn('conclusion', text),
    engine,
  ).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['v2_specimens', 'v2_diagnostic_reports']) await db.schema.dropTable(t).ifExists().execute();
}
```

- [ ] **Step 4: Register** in `external/index.ts`: `import * as m005 from './005_v2_specimen_diagreport';` + `'005_v2_specimen_diagreport': { up: (db) => m005.up(db, engine), down: m005.down },` after `004`.

- [ ] **Step 5: Schema types** — add to `packages/db/src/schema/external.ts`:
```ts
export interface V2SpecimensTable extends ProvenanceColumns {
  id: string;
  patient_id: string | null;
  received_time: string | null;
  accession: string | null;
  status: string | null;
  type_code: string | null;
  type_text: string | null;
}
export interface V2DiagnosticReportsTable extends ProvenanceColumns {
  id: string;
  patient_id: string | null;
  status: string | null;
  code_code: string | null;
  code_text: string | null;
  issued: string | null;
  effective: string | null;
  conclusion: string | null;
}
```
and to `ExternalSchema`: `v2_specimens: V2SpecimensTable;` `v2_diagnostic_reports: V2DiagnosticReportsTable;`.

- [ ] **Step 6: export-data + migration-map test.** In `export-data.ts` add `v2_specimens` + `v2_diagnostic_reports` entries to `EXTERNAL_TABLE_COLUMNS` (their column lists). In `migrations/migrations.test.ts`, append `'005_v2_specimen_diagreport'` to the exhaustive external-migration key array. (If `export-data.test.ts` asserts an exact external-table key set, add the 2 keys there too.)

- [ ] **Step 7: Run + typecheck.** `pnpm --filter @openldr/db exec vitest run src/migrations/external/005_v2_specimen_diagreport.test.ts` → PASS. `pnpm --filter @openldr/db exec tsc --noEmit` → PASS. `pnpm --filter @openldr/db exec vitest run` → all green.

- [ ] **Step 8: Commit.**
```bash
git add packages/db/src/migrations/external/005_v2_specimen_diagreport.ts packages/db/src/migrations/external/005_v2_specimen_diagreport.test.ts packages/db/src/migrations/external/index.ts packages/db/src/schema/external.ts packages/db/src/export-data.ts packages/db/src/migrations/migrations.test.ts
git commit -m "feat(db): v2_specimens + v2_diagnostic_reports read-model tables (restructure R3c)"
```

---

## Task 2: Specimen + DiagnosticReport mappers

**Files:** Create `relational/specimen.ts`, `relational/diagnostic-report.ts`; Modify `relational/index.ts`, `relational/relational.test.ts`.

- [ ] **Step 1: Failing test** — append to `packages/db/src/relational/relational.test.ts`:
```ts
  it('maps Specimen -> v2_specimens (bare patient_id, received_time)', () => {
    const out = projectResource({ resourceType: 'Specimen', id: 'sp1', subject: { reference: 'Patient/p1' }, receivedTime: '2026-01-01T00:00:00Z', type: { text: 'Blood' }, status: 'available' });
    expect(out?.table).toBe('v2_specimens');
    expect(out?.row).toMatchObject({ id: 'sp1', patient_id: 'p1', received_time: '2026-01-01T00:00:00Z', type_text: 'Blood', status: 'available' });
  });
  it('maps DiagnosticReport -> v2_diagnostic_reports (bare patient_id, code, issued)', () => {
    const out = projectResource({ resourceType: 'DiagnosticReport', id: 'dr1', subject: { reference: 'Patient/p1' }, status: 'final', code: { coding: [{ code: 'CBC' }], text: 'Complete Blood Count' }, issued: '2026-01-02T00:00:00Z', conclusion: 'ok' });
    expect(out?.table).toBe('v2_diagnostic_reports');
    expect(out?.row).toMatchObject({ id: 'dr1', patient_id: 'p1', status: 'final', code_code: 'CBC', code_text: 'Complete Blood Count', issued: '2026-01-02T00:00:00Z', conclusion: 'ok' });
  });
```
Also add to the existing "non-projected types" test that `v2TableForResourceType('Specimen')` is `'v2_specimens'` and `v2TableForResourceType('DiagnosticReport')` is `'v2_diagnostic_reports'`.

- [ ] **Step 2: Run — fails.** `pnpm --filter @openldr/db exec vitest run src/relational/relational.test.ts` → FAIL.

- [ ] **Step 3: Create `relational/specimen.ts`:**
```ts
import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { V2SpecimensTable } from '../schema/external';
import { provColumns, codeable, referenceId, str } from '../flatten/extract';

export function projectSpecimen(r: Record<string, unknown>, prov: Provenance): Insertable<V2SpecimensTable> {
  const type = codeable(r['type']);
  const accession = (r['accessionIdentifier'] as Record<string, unknown> | undefined)?.['value'];
  const collected = (r['collection'] as Record<string, unknown> | undefined)?.['collectedDateTime'];
  return {
    id: String(r['id']),
    patient_id: referenceId(r['subject']),
    received_time: str(r['receivedTime']) ?? str(collected),
    accession: str(accession),
    status: str(r['status']),
    type_code: type.code,
    type_text: type.text,
    ...provColumns(prov),
  };
}
```

- [ ] **Step 4: Create `relational/diagnostic-report.ts`:**
```ts
import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { V2DiagnosticReportsTable } from '../schema/external';
import { provColumns, codeable, referenceId, str } from '../flatten/extract';

export function projectDiagnosticReport(r: Record<string, unknown>, prov: Provenance): Insertable<V2DiagnosticReportsTable> {
  const code = codeable(r['code']);
  return {
    id: String(r['id']),
    patient_id: referenceId(r['subject']),
    status: str(r['status']),
    code_code: code.code,
    code_text: code.text,
    issued: str(r['issued']),
    effective: str(r['effectiveDateTime']),
    conclusion: str(r['conclusion']),
    ...provColumns(prov),
  };
}
```

- [ ] **Step 5: Extend `relational/index.ts`** — add the two imports + re-exports, and the two `projectResource`/`v2TableForResourceType` cases:
```ts
import { projectSpecimen } from './specimen';
import { projectDiagnosticReport } from './diagnostic-report';
export * from './specimen';
export * from './diagnostic-report';
// in projectResource switch:
    case 'Specimen': return { table: 'v2_specimens', row: projectSpecimen(r, prov) };
    case 'DiagnosticReport': return { table: 'v2_diagnostic_reports', row: projectDiagnosticReport(r, prov) };
// in v2TableForResourceType switch:
    case 'Specimen': return 'v2_specimens';
    case 'DiagnosticReport': return 'v2_diagnostic_reports';
```

- [ ] **Step 6: Run + typecheck.** `pnpm --filter @openldr/db exec vitest run src/relational/relational.test.ts` → PASS. `pnpm --filter @openldr/db exec tsc --noEmit` → PASS. `pnpm --filter @openldr/db exec vitest run` → all green.

- [ ] **Step 7: Commit.**
```bash
git add packages/db/src/relational/specimen.ts packages/db/src/relational/diagnostic-report.ts packages/db/src/relational/index.ts packages/db/src/relational/relational.test.ts
git commit -m "feat(db): relational Specimen/DiagnosticReport mappers -> v2 (restructure R3c)"
```

---

## Task 3: Rewrite the 3 report SQL variants (in-place)

**Files:** Modify `packages/reporting/src/seed/report-seeds.ts`.

READ each report's 3 variants and apply the behavior-preserving substitutions. Change ONLY these reports.

- [ ] **Step 1: `q-facilities`** (all variants): `from patients` → `from v2_patients`. (Column `managing_organization` unchanged.)

- [ ] **Step 2: `q-test-volume`** (all variants): `from service_requests sr` → `from v2_lab_requests sr`; every `sr.authored_on` → `sr.authored_at`; every `sr.code_text` → `sr.panel_desc`. Nothing else.

- [ ] **Step 3: `q-turnaround-time`** (all variants):
  - `from specimens` → `from v2_specimens`
  - `from diagnostic_reports dr` → `from v2_diagnostic_reports dr`
  - `from patients p` → `from v2_patients p`
  - In the `received` CTE: `select subject_ref, min(received_time) …` → `select patient_id, min(received_time) …`; `where subject_ref is not null …` → `where patient_id is not null …`; `group by subject_ref` → `group by patient_id`.
  - The join `on r.subject_ref = dr.subject_ref` → `on r.patient_id = dr.patient_id`.
  - The facility subquery `dr.subject_ref in (select 'Patient/' || p.id from patients p where …)` → `dr.patient_id in (select p.id from v2_patients p where …)` (drop the `'Patient/' ||` / `+` / `concat(...)` prefix in each dialect — the mssql/mysql variants build the prefix differently; remove it so it selects the bare `p.id`).
  - All else (date filters, `issued >= r.received_time`, hours math, grouping by test, ordering) UNCHANGED.

- [ ] **Step 4: Update each report's explanatory comment** to note it now reads the v2 tables (so a future reader isn't misled).

- [ ] **Step 5: Typecheck + reporting tests.** `pnpm --filter @openldr/dashboards exec tsc --noEmit` and `pnpm --filter @openldr/reporting exec vitest run` → PASS (structural seed tests assert shape/counts, not execution). If a test hardcodes the old SQL text, update it to the new SQL (do not revert). Report if so.

- [ ] **Step 6: Commit.**
```bash
git add packages/reporting/src/seed/report-seeds.ts
git commit -m "feat(reporting): cut q-facilities/q-test-volume/q-turnaround-time over to v2 (restructure R3c)"
```

---

## Task 4: Parity wipe-list + real-PG `thin ≡ v2` proof

**Files:** Modify `scripts/lib/reports-parity-fixture.ts`; Create `scripts/reports-cutover-accept.ts`; Modify `package.json`.

- [ ] **Step 1: Wipe-list.** In `scripts/lib/reports-parity-fixture.ts`, add `'v2_specimens'`, `'v2_diagnostic_reports'` to `TABLES` (so the harness cleans them; it already seeds them via `createRelationalWriter`).

- [ ] **Step 2: Write the proof** `scripts/reports-cutover-accept.ts`. Model it on `scripts/demographics-cutover-accept.ts`: connect the PG target, migrate external to latest, wipe `TABLES`, seed the fixture into BOTH schemas (`createFlatWriter` + `createRelationalWriter`, items = the full fixture). Then, parameterized over a `CASES` array — one entry per cut-over report `{ id, thinPgSql, paramBags }` for `q-facilities`, `q-test-volume`, `q-turnaround-time` — run the report's PRE-cutover thin PG SQL vs its NEW v2 SQL (`SEED_QUERIES.find(q => q.id === id).sql.postgres`) for each param bag, `normalizeRows` both, assert `firstDiff` null. `thinPgSql` for each = the report's PG variant copied VERBATIM from BEFORE Task 3 — obtain via `git show <R3c-branch-base-sha>:packages/reporting/src/seed/report-seeds.ts` (the branch base, where these 3 still read thin) and paste each report's `postgres` string as a constant. Param bags:
  - `q-facilities`: `[{}]` (no params).
  - `q-test-volume`: `[{ from: '2026-01-01', to: '2026-12-31' }]`.
  - `q-turnaround-time`: `[{ from: '2026-01-01', to: '2026-12-31', facility: '' }, { from: '2026-01-01', to: '2026-12-31', facility: 'Facility A' }]`.
  Log `PASS: <id> <bag>` per case; overall PASS + `process.exit(0)`; any diff → print + `process.exit(1)`. Wipe `TABLES` in `finally`. Provide real compilable code following the demographics-accept style. No placeholders.

- [ ] **Step 3: package.json** — add `"reports:accept": "tsx scripts/reports-cutover-accept.ts",`.

- [ ] **Step 4: Run live** against dev PG (`:5433`). `pnpm reports:accept` → every case identical, exit 0. Paste output. Also re-run `pnpm demographics:accept` (still 5/5 — the fixture/schema changes must not regress it). Debug any diff (most likely the turnaround `patient_id` join rewrite or a missed `authored_on`/`code_text`).

- [ ] **Step 5: Commit.**
```bash
git add scripts/lib/reports-parity-fixture.ts scripts/reports-cutover-accept.ts package.json
git commit -m "test(accept): prove q-facilities/test-volume/turnaround-time v2 output equals thin on real PG (restructure R3c)"
```

---

## Task 5: Cross-package verification gate

- [ ] **Step 1: Per-package** (never pipe turbo through `tail`):
```bash
pnpm --filter @openldr/db exec tsc --noEmit
pnpm --filter @openldr/db exec vitest run
pnpm --filter @openldr/reporting exec tsc --noEmit
pnpm --filter @openldr/reporting exec vitest run
pnpm --filter @openldr/dashboards exec tsc --noEmit
pnpm --filter @openldr/bootstrap exec vitest run
pnpm --filter @openldr/server exec vitest run
```
Expected: ALL PASS.

- [ ] **Step 2: Scoped turbo** (informational): `pnpm turbo run typecheck test --filter=@openldr/db --filter=@openldr/reporting --force` → PASS (ignore Windows flakes; per-package authoritative).

---

## Self-Review

**Spec coverage:** v2_specimens/v2_diagnostic_reports tables+types (T1) · Specimen/DiagnosticReport mappers + dispatch (T2) · in-place rewrite of the 3 reports (T3) · parity wipe-list + real-PG thin≡v2 proof for all 3 (T4) · gate (T5). Bare patient_id + additive + in-place + proof — all covered. Deferred (AMR, rename/drop, MSSQL/MySQL live) excluded. ✔

**Placeholder scan:** Migration + mapper code complete; T3 rewrite is rule-based against the concrete existing variants; T4 proof specified as "real compilable code following demographics-accept" with the thin-reference SQL sourced from git — no placeholders shipped. ✔

**Type consistency:** `V2SpecimensTable`/`V2DiagnosticReportsTable` (T1) are the `Insertable<>` targets of the mappers (T2) and the `projectResource`/`v2TableForResourceType` cases (T2). `referenceId` (bare id) used for both `patient_id`s, consistent with the turnaround join rewrite (T3). `codeable`→`{code,text,system}` reused. ✔

**Risk notes for the executor:** (1) the turnaround rewrite must replace `subject_ref`→`patient_id` in the `received` CTE (select/where/group), the join, AND the facility subquery (dropping the `'Patient/'` prefix in each dialect) — a missed one breaks the join or the filter; the T4 proof (thin≡v2) is the guard. (2) `q-test-volume` has NO facility/patient join — do not add one. (3) Bare patient_id is intentional (consistent with R3a); do not add a subject_ref column.
