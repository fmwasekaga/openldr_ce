# FHIR Storage Restructure — R3a: v2 Relational Read-Model (Core Lab Data) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project 4 core FHIR resource types into v2-shaped relational tables (`v2_patients`/`v2_lab_requests`/`v2_lab_results`/`v2_facilities`), additively alongside the existing thin flat projection, via the R2 projection worker — proving the relational-projection pattern.

**Architecture:** Slice **R3a** of the restructure (spec: `docs/superpowers/specs/2026-07-13-fhir-storage-restructure-r3a-v2-core-readmodel-design.md`). A new `relational/` projector (mirroring `flatten/`) + `relational-writer.ts` (mirroring `flat-writer.ts`, reusing its engine-aware batch-upsert helpers) is wired as a SECOND sink into the R2 worker's `applyProjection`/`reprojectAll`, so each changed resource projects into both the thin schema (reports read this — untouched) and the new `v2_*` tables (no consumer yet). FHIR-id-keyed, soft (unenforced) references, coded fields denormalized from the resource. Engine-aware DDL/writer (PG/MSSQL/MySQL); PG live-acceptance-tested.

**Tech Stack:** TypeScript, Kysely (Postgres + external engines), pg-mem (unit), real Postgres `:5433` (acceptance), Vitest.

**Established facts (verified — do NOT re-derive):**
- External migrations take `(db, engine)` and build engine-aware DDL via `dialect.ts` (`textType`/`keyType`/`floatType`/`timestampType`/`nowExpr`) + a local `withCommon` helper (provenance cols + MySQL charset + PG `ifNotExists`). Pattern in `001_flat_tables.ts`. Registered in `external/index.ts` as `(db) => m003.up(db, engine)`. Next external migration = **003**.
- FHIR extraction helpers live in `flatten/extract.ts`: `provColumns`, `firstIdentifier` (→`{system,value}`), `codeable` (→`{code,text}`), `reference`, `str`, `num`. R3a extends `codeable` with `system` and adds `referenceId` (strip `Type/` prefix).
- `flat-writer.ts` has engine-aware batch upsert helpers `insertBatchPg`/`mergeBatchMssql`/`insertBatchMysql` (each `(db, table, rows)`, param-budget chunked). R3a exports them and reuses them (simpler + lower-risk than the spec's "extract to upsert.ts" — no code movement).
- R2 worker: `applyProjection`/`reprojectAll` in `projection/cycle.ts`; `ProjectionDeps` carries `flatWriter`. The projection runner is built in `bootstrap/src/index.ts` and the projection deps in `db-context.ts`.
- `makeMigratedExternalDb()` (`test-helpers-external.ts`) runs `externalMigrations('postgres')` — it auto-includes `003` once registered.
- The thin schema already has a `patients` table → v2 tables are `v2_`-prefixed to coexist. `tableForResourceType` already exists in `flatten/index.ts` → the relational one is named `v2TableForResourceType` to avoid a barrel collision.

---

## File Structure

**Create:**
- `packages/db/src/migrations/external/003_v2_core.ts` — the 4 `v2_*` tables (engine-aware).
- `packages/db/src/migrations/external/003_v2_core.test.ts` — migration creates the tables.
- `packages/db/src/relational/patient.ts` / `service-request.ts` / `observation.ts` / `facility.ts` — per-resource mappers.
- `packages/db/src/relational/index.ts` — `projectResource` + `v2TableForResourceType`.
- `packages/db/src/relational/relational.test.ts` — mapper + dispatch unit tests.
- `packages/db/src/relational-writer.ts` — `createRelationalWriter`.
- `packages/db/src/relational-writer.test.ts`.

**Modify:**
- `packages/db/src/flatten/extract.ts` — extend `codeable` with `system`; add `referenceId`.
- `packages/db/src/schema/external.ts` — 4 `V2*Table` interfaces + `ExternalSchema` keys.
- `packages/db/src/migrations/external/index.ts` — register `003`.
- `packages/db/src/flat-writer.ts` — `export` the 3 batch helpers.
- `packages/db/src/projection/cycle.ts` — `ProjectionDeps.relationalWriter`; call it in `applyProjection` + `reprojectAll`.
- `packages/db/src/projection/cycle.test.ts` — add `relationalWriter`; assert both projections.
- `packages/db/src/index.ts` — export `relational` + `relational-writer`.
- `packages/bootstrap/src/db-context.ts` + `packages/bootstrap/src/index.ts` — construct `relationalWriter`, pass to the runner.
- `scripts/projection-live-acceptance.ts` — v2-core phase.

---

## Task 1: Migration `003_v2_core` + external schema types

**Files:** Create `external/003_v2_core.ts`, `external/003_v2_core.test.ts`; Modify `external/index.ts`, `schema/external.ts`.

- [ ] **Step 1: Write the failing migration test** — `packages/db/src/migrations/external/003_v2_core.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeMigratedExternalDb } from '../../test-helpers-external';

describe('003 v2 core tables', () => {
  it('creates the v2_ core tables (FHIR-id keyed, provenance cols)', async () => {
    const db = await makeMigratedExternalDb();
    // Each table accepts an insert keyed by a FHIR id + provenance defaults.
    await db.insertInto('v2_patients').values({ id: 'p1', patient_guid: 'g1', surname: 'X' }).execute();
    await db.insertInto('v2_lab_requests').values({ id: 'sr1', request_id: 'r1', patient_id: 'p1' }).execute();
    await db.insertInto('v2_lab_results').values({ id: 'o1', request_id: 'sr1', observation_code: 'LOINC-1' }).execute();
    await db.insertInto('v2_facilities').values({ id: 'org1', facility_code: 'F1', source_resource: 'Organization' }).execute();
    expect(await db.selectFrom('v2_patients').selectAll().execute()).toHaveLength(1);
    expect(await db.selectFrom('v2_lab_requests').selectAll().execute()).toHaveLength(1);
    expect(await db.selectFrom('v2_lab_results').selectAll().execute()).toHaveLength(1);
    expect(await db.selectFrom('v2_facilities').selectAll().execute()).toHaveLength(1);
    await db.destroy();
  });
});
```

- [ ] **Step 2: Run — fails.** `pnpm --filter @openldr/db exec vitest run src/migrations/external/003_v2_core.test.ts` → FAIL (tables/types missing).

- [ ] **Step 3: Create the migration** `packages/db/src/migrations/external/003_v2_core.ts`:

```ts
import { type Kysely, type CreateTableBuilder, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType, keyType, floatType, timestampType, nowExpr } from './dialect';

// v2-core read-model tables (R3a), engine-aware. Mirrors 001_flat_tables' withCommon so PG/MSSQL/
// MySQL emit valid DDL from one definition. FHIR-id keyed; provenance columns; no enforced FKs.
function withCommon(b: CreateTableBuilder<string, never>, engine: TargetEngine): CreateTableBuilder<string, never> {
  const text = sql.raw(textType(engine));
  let built = b
    .addColumn('source_system', text)
    .addColumn('plugin_id', text)
    .addColumn('plugin_version', text)
    .addColumn('batch_id', text)
    .addColumn('created_at', sql.raw(timestampType(engine)), (c) => c.notNull().defaultTo(nowExpr(engine)));
  if (engine === 'mysql') built = built.modifyEnd(sql`character set utf8mb4`);
  return engine === 'postgres' ? built.ifNotExists() : built;
}

export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  const key = sql.raw(keyType(engine));
  const float = sql.raw(floatType(engine));

  await withCommon(
    db.schema.createTable('v2_patients').addColumn('id', key, (c) => c.primaryKey())
      .addColumn('patient_guid', text)
      .addColumn('surname', text)
      .addColumn('firstname', text)
      .addColumn('date_of_birth', text)
      .addColumn('sex', text)
      .addColumn('national_id', text)
      .addColumn('phone', text)
      .addColumn('email', text),
    engine,
  ).execute();

  await withCommon(
    db.schema.createTable('v2_lab_requests').addColumn('id', key, (c) => c.primaryKey())
      .addColumn('request_id', text)
      .addColumn('patient_id', text)
      .addColumn('panel_code', text)
      .addColumn('panel_system', text)
      .addColumn('panel_desc', text)
      .addColumn('status', text)
      .addColumn('priority', text)
      .addColumn('authored_at', text),
    engine,
  ).execute();

  await withCommon(
    db.schema.createTable('v2_lab_results').addColumn('id', key, (c) => c.primaryKey())
      .addColumn('request_id', text)
      .addColumn('observation_code', text)
      .addColumn('observation_system', text)
      .addColumn('observation_desc', text)
      .addColumn('result_type', text)
      .addColumn('numeric_value', float)
      .addColumn('numeric_units', text)
      .addColumn('coded_value', text)
      .addColumn('text_value', text)
      .addColumn('abnormal_flag', text)
      .addColumn('result_timestamp', text),
    engine,
  ).execute();

  await withCommon(
    db.schema.createTable('v2_facilities').addColumn('id', key, (c) => c.primaryKey())
      .addColumn('facility_code', text)
      .addColumn('facility_name', text)
      .addColumn('facility_type', text)
      .addColumn('source_resource', text),
    engine,
  ).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['v2_patients', 'v2_lab_requests', 'v2_lab_results', 'v2_facilities']) {
    await db.schema.dropTable(t).ifExists().execute();
  }
}
```

- [ ] **Step 4: Register it** in `packages/db/src/migrations/external/index.ts`: add `import * as m003 from './003_v2_core';` and the entry `'003_v2_core': { up: (db) => m003.up(db, engine), down: m003.down },` after `002`.

- [ ] **Step 5: Add schema types** to `packages/db/src/schema/external.ts` — 4 interfaces (extend the existing `ProvenanceColumns`) + `ExternalSchema` keys:

```ts
export interface V2PatientsTable extends ProvenanceColumns {
  id: string;
  patient_guid: string | null;
  surname: string | null;
  firstname: string | null;
  date_of_birth: string | null;
  sex: string | null;
  national_id: string | null;
  phone: string | null;
  email: string | null;
}
export interface V2LabRequestsTable extends ProvenanceColumns {
  id: string;
  request_id: string | null;
  patient_id: string | null;
  panel_code: string | null;
  panel_system: string | null;
  panel_desc: string | null;
  status: string | null;
  priority: string | null;
  authored_at: string | null;
}
export interface V2LabResultsTable extends ProvenanceColumns {
  id: string;
  request_id: string | null;
  observation_code: string | null;
  observation_system: string | null;
  observation_desc: string | null;
  result_type: string | null;
  numeric_value: number | null;
  numeric_units: string | null;
  coded_value: string | null;
  text_value: string | null;
  abnormal_flag: string | null;
  result_timestamp: string | null;
}
export interface V2FacilitiesTable extends ProvenanceColumns {
  id: string;
  facility_code: string | null;
  facility_name: string | null;
  facility_type: string | null;
  source_resource: string | null;
}
```

Add to the `ExternalSchema` interface:
```ts
  v2_patients: V2PatientsTable;
  v2_lab_requests: V2LabRequestsTable;
  v2_lab_results: V2LabResultsTable;
  v2_facilities: V2FacilitiesTable;
```

- [ ] **Step 6: Run + typecheck.** `pnpm --filter @openldr/db exec vitest run src/migrations/external/003_v2_core.test.ts` → PASS. `pnpm --filter @openldr/db exec tsc --noEmit` → PASS. `pnpm --filter @openldr/db exec vitest run` → all green (existing external/flat-writer tests unaffected).

- [ ] **Step 7: Commit.**
```bash
git add packages/db/src/migrations/external/003_v2_core.ts packages/db/src/migrations/external/003_v2_core.test.ts packages/db/src/migrations/external/index.ts packages/db/src/schema/external.ts
git commit -m "feat(db): v2-core read-model tables (v2_patients/lab_requests/lab_results/facilities), engine-aware (restructure R3a)"
```

---

## Task 2: Relational mappers + `projectResource`

**Files:** Modify `flatten/extract.ts`; Create `relational/patient.ts`, `service-request.ts`, `observation.ts`, `facility.ts`, `index.ts`, `relational/relational.test.ts`.

- [ ] **Step 1: Extend `flatten/extract.ts`** — add `system` to `codeable` (additive; existing destructuring callers ignore it) and add `referenceId`:

```ts
export function codeable(concept: unknown): { code: string | null; text: string | null; system: string | null } {
  const c = concept as Json | undefined;
  const coding = (c?.['coding'] as Json[] | undefined)?.[0];
  return {
    code: (coding?.['code'] as string) ?? null,
    text: (c?.['text'] as string) ?? (coding?.['display'] as string) ?? null,
    system: (coding?.['system'] as string) ?? null,
  };
}

// The bare id of a FHIR reference ("Patient/p1" -> "p1"); null if absent. Used for soft (unenforced)
// foreign keys in the v2 read-model.
export function referenceId(ref: unknown): string | null {
  const r = reference(ref);
  return r ? r.replace(/^[^/]+\//, '') : null;
}
```

- [ ] **Step 2: Write the failing mapper test** — `packages/db/src/relational/relational.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { projectResource, v2TableForResourceType } from './index';

describe('relational projectResource', () => {
  it('maps Patient -> v2_patients (denormalized, sex code)', () => {
    const out = projectResource({ resourceType: 'Patient', id: 'p1', identifier: [{ value: 'MRN-1' }], name: [{ family: 'Doe', given: ['Jane'] }], gender: 'female', birthDate: '1990-01-01', telecom: [{ system: 'phone', value: '123' }] });
    expect(out?.table).toBe('v2_patients');
    expect(out?.row).toMatchObject({ id: 'p1', patient_guid: 'MRN-1', surname: 'Doe', firstname: 'Jane', sex: 'F', date_of_birth: '1990-01-01', phone: '123' });
  });

  it('maps ServiceRequest -> v2_lab_requests (soft patient_id, denormalized code+system)', () => {
    const out = projectResource({ resourceType: 'ServiceRequest', id: 'sr1', identifier: [{ value: 'ACC-1' }], status: 'active', priority: 'routine', authoredOn: '2026-01-01', subject: { reference: 'Patient/p1' }, code: { coding: [{ system: 'http://loinc.org', code: '100', display: 'CBC' }] } });
    expect(out?.table).toBe('v2_lab_requests');
    expect(out?.row).toMatchObject({ id: 'sr1', request_id: 'ACC-1', patient_id: 'p1', panel_code: '100', panel_system: 'http://loinc.org', panel_desc: 'CBC', status: 'active', priority: 'routine', authored_at: '2026-01-01' });
  });

  it('maps Observation -> v2_lab_results (numeric result, soft request_id)', () => {
    const out = projectResource({ resourceType: 'Observation', id: 'o1', basedOn: [{ reference: 'ServiceRequest/sr1' }], code: { coding: [{ system: 'http://loinc.org', code: '200', display: 'Glucose' }] }, valueQuantity: { value: 5.5, unit: 'mmol/L' }, interpretation: [{ coding: [{ code: 'H' }] }], effectiveDateTime: '2026-01-02' });
    expect(out?.table).toBe('v2_lab_results');
    expect(out?.row).toMatchObject({ id: 'o1', request_id: 'sr1', observation_code: '200', observation_system: 'http://loinc.org', result_type: 'NM', numeric_value: 5.5, numeric_units: 'mmol/L', abnormal_flag: 'H', result_timestamp: '2026-01-02' });
  });

  it('maps Organization and Location -> v2_facilities with a source discriminator', () => {
    const org = projectResource({ resourceType: 'Organization', id: 'org1', identifier: [{ value: 'F1' }], name: 'Central Lab', type: [{ text: 'lab' }] });
    expect(org).toMatchObject({ table: 'v2_facilities', row: { id: 'org1', facility_code: 'F1', facility_name: 'Central Lab', facility_type: 'lab', source_resource: 'Organization' } });
    const loc = projectResource({ resourceType: 'Location', id: 'loc1', name: 'Ward A' });
    expect(loc).toMatchObject({ table: 'v2_facilities', row: { id: 'loc1', facility_name: 'Ward A', source_resource: 'Location' } });
  });

  it('returns null for non-projected types', () => {
    expect(projectResource({ resourceType: 'Bundle' })).toBeNull();
    expect(v2TableForResourceType('Bundle')).toBeNull();
    expect(v2TableForResourceType('Patient')).toBe('v2_patients');
  });
});
```

- [ ] **Step 3: Run — fails.** `pnpm --filter @openldr/db exec vitest run src/relational/relational.test.ts` → FAIL.

- [ ] **Step 4: Create the mappers.**

`packages/db/src/relational/patient.ts`:
```ts
import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { V2PatientsTable } from '../schema/external';
import { provColumns, firstIdentifier, str } from '../flatten/extract';

const SEX: Record<string, string> = { male: 'M', female: 'F', other: 'O', unknown: 'U' };

export function projectPatient(r: Record<string, unknown>, prov: Provenance): Insertable<V2PatientsTable> {
  const idn = firstIdentifier(r);
  const name = (r['name'] as Record<string, unknown>[] | undefined)?.[0];
  const telecom = (r['telecom'] as Record<string, unknown>[] | undefined) ?? [];
  const gender = str(r['gender']);
  return {
    id: String(r['id']),
    patient_guid: idn.value,
    surname: str(name?.['family']),
    firstname: str((name?.['given'] as string[] | undefined)?.[0]),
    date_of_birth: str(r['birthDate']),
    sex: gender ? (SEX[gender] ?? 'U') : null,
    national_id: null, // R3a: identifier-by-type resolution deferred
    phone: str(telecom.find((t) => t['system'] === 'phone')?.['value']),
    email: str(telecom.find((t) => t['system'] === 'email')?.['value']),
    ...provColumns(prov),
  };
}
```

`packages/db/src/relational/service-request.ts`:
```ts
import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { V2LabRequestsTable } from '../schema/external';
import { provColumns, firstIdentifier, codeable, referenceId, str } from '../flatten/extract';

export function projectServiceRequest(r: Record<string, unknown>, prov: Provenance): Insertable<V2LabRequestsTable> {
  const idn = firstIdentifier(r);
  const code = codeable(r['code']);
  return {
    id: String(r['id']),
    request_id: idn.value,
    patient_id: referenceId(r['subject']),
    panel_code: code.code,
    panel_system: code.system,
    panel_desc: code.text,
    status: str(r['status']),
    priority: str(r['priority']),
    authored_at: str(r['authoredOn']),
    ...provColumns(prov),
  };
}
```

`packages/db/src/relational/observation.ts`:
```ts
import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { V2LabResultsTable } from '../schema/external';
import { provColumns, codeable, referenceId, str, num } from '../flatten/extract';

export function projectObservation(r: Record<string, unknown>, prov: Provenance): Insertable<V2LabResultsTable> {
  const code = codeable(r['code']);
  const valueCc = codeable(r['valueCodeableConcept']);
  const quantity = r['valueQuantity'] as Record<string, unknown> | undefined;
  const interpretation = codeable((r['interpretation'] as unknown[] | undefined)?.[0]);
  const numericValue = num(quantity?.['value']);
  const textValue = valueCc.text ?? str(r['valueString']);
  const resultType = numericValue != null ? 'NM' : valueCc.code ? 'CE' : textValue ? 'ST' : null;
  return {
    id: String(r['id']),
    request_id: referenceId((r['basedOn'] as unknown[] | undefined)?.[0]),
    observation_code: code.code,
    observation_system: code.system,
    observation_desc: code.text,
    result_type: resultType,
    numeric_value: numericValue,
    numeric_units: str(quantity?.['unit']),
    coded_value: valueCc.code,
    text_value: textValue,
    abnormal_flag: interpretation.code,
    result_timestamp: str(r['effectiveDateTime']),
    ...provColumns(prov),
  };
}
```

`packages/db/src/relational/facility.ts`:
```ts
import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { V2FacilitiesTable } from '../schema/external';
import { provColumns, firstIdentifier, codeable, str } from '../flatten/extract';

// Both Organization and Location project here, keyed by their own FHIR id; source_resource discriminates.
export function projectFacility(r: Record<string, unknown>, prov: Provenance): Insertable<V2FacilitiesTable> {
  const idn = firstIdentifier(r);
  const type = codeable((r['type'] as unknown[] | undefined)?.[0]);
  return {
    id: String(r['id']),
    facility_code: idn.value,
    facility_name: str(r['name']),
    facility_type: type.text,
    source_resource: str(r['resourceType']),
    ...provColumns(prov),
  };
}
```

- [ ] **Step 5: Create `packages/db/src/relational/index.ts`:**
```ts
import type { Provenance } from '../provenance';
import type { ExternalSchema } from '../schema/external';
import { projectPatient } from './patient';
import { projectServiceRequest } from './service-request';
import { projectObservation } from './observation';
import { projectFacility } from './facility';

export * from './patient';
export * from './service-request';
export * from './observation';
export * from './facility';

export interface RelationalResult {
  table: keyof ExternalSchema;
  row: Record<string, unknown>;
}

export function projectResource(resource: unknown, prov: Provenance = {}): RelationalResult | null {
  if (typeof resource !== 'object' || resource === null) return null;
  const r = resource as Record<string, unknown>;
  switch (r['resourceType']) {
    case 'Patient': return { table: 'v2_patients', row: projectPatient(r, prov) };
    case 'ServiceRequest': return { table: 'v2_lab_requests', row: projectServiceRequest(r, prov) };
    case 'Observation': return { table: 'v2_lab_results', row: projectObservation(r, prov) };
    case 'Organization':
    case 'Location': return { table: 'v2_facilities', row: projectFacility(r, prov) };
    default: return null;
  }
}

export function v2TableForResourceType(resourceType: string): keyof ExternalSchema | null {
  switch (resourceType) {
    case 'Patient': return 'v2_patients';
    case 'ServiceRequest': return 'v2_lab_requests';
    case 'Observation': return 'v2_lab_results';
    case 'Organization':
    case 'Location': return 'v2_facilities';
    default: return null;
  }
}
```

- [ ] **Step 6: Run + typecheck.** `pnpm --filter @openldr/db exec vitest run src/relational/relational.test.ts` → PASS. `pnpm --filter @openldr/db exec tsc --noEmit` → PASS. `pnpm --filter @openldr/db exec vitest run` → all green (existing flatteners still pass — `codeable`'s extra `system` field is additive).

- [ ] **Step 7: Commit.**
```bash
git add packages/db/src/flatten/extract.ts packages/db/src/relational/
git commit -m "feat(db): relational v2-core mappers (Patient/ServiceRequest/Observation/Org+Location) (restructure R3a)"
```

---

## Task 3: Relational writer

**Files:** Modify `flat-writer.ts` (export helpers); Create `relational-writer.ts`, `relational-writer.test.ts`; Modify `packages/db/src/index.ts`.

- [ ] **Step 1: Export the batch helpers from `flat-writer.ts`** — add the `export` keyword to the three functions `insertBatchPg`, `mergeBatchMssql`, `insertBatchMysql` (no other change).

- [ ] **Step 2: Write the failing test** — `packages/db/src/relational-writer.test.ts` (uses the pg-mem external DB):

```ts
import { describe, expect, it } from 'vitest';
import { makeMigratedExternalDb } from './test-helpers-external';
import { createRelationalWriter } from './relational-writer';

describe('relational-writer', () => {
  it('writes/upserts a resource into its v2 table and deletes by id', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as never, 'postgres');

    expect(await w.write({ resourceType: 'Patient', id: 'p1', name: [{ family: 'A' }] })).toBe('written');
    expect(await db.selectFrom('v2_patients').selectAll().execute()).toHaveLength(1);
    // upsert (same id) does not duplicate
    await w.write({ resourceType: 'Patient', id: 'p1', name: [{ family: 'B' }] });
    const rows = await db.selectFrom('v2_patients').select(['id', 'surname']).execute();
    expect(rows).toEqual([{ id: 'p1', surname: 'B' }]);
    // non-projected type -> skipped, no throw
    expect(await w.write({ resourceType: 'Bundle', id: 'b1' })).toBe('skipped');
    // deleteById
    await w.deleteById('Patient', 'p1');
    expect(await db.selectFrom('v2_patients').selectAll().execute()).toHaveLength(0);
    await w.deleteById('Bundle', 'x'); // non-projected -> no throw
    await db.destroy();
  });

  it('writeMany groups by table and returns per-item results', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as never, 'postgres');
    const results = await w.writeMany([
      { resource: { resourceType: 'Patient', id: 'p1' } },
      { resource: { resourceType: 'Bundle', id: 'b1' } },
      { resource: { resourceType: 'Observation', id: 'o1', code: { coding: [{ code: 'x' }] } } },
    ]);
    expect(results).toEqual(['written', 'skipped', 'written']);
    expect(await db.selectFrom('v2_patients').selectAll().execute()).toHaveLength(1);
    expect(await db.selectFrom('v2_lab_results').selectAll().execute()).toHaveLength(1);
    await db.destroy();
  });
});
```

- [ ] **Step 3: Run — fails.** `pnpm --filter @openldr/db exec vitest run src/relational-writer.test.ts` → FAIL.

- [ ] **Step 4: Create `packages/db/src/relational-writer.ts`:**
```ts
import type { Kysely } from 'kysely';
import type { ExternalSchema } from './schema/external';
import type { Provenance } from './provenance';
import type { TargetEngine } from './engine';
import { insertBatchPg, mergeBatchMssql, insertBatchMysql } from './flat-writer';
import { projectResource, v2TableForResourceType } from './relational/index';

export type WriteResult = 'written' | 'skipped';
export interface RelationalWriteItem { resource: unknown; provenance?: Provenance; }

export interface RelationalWriter {
  write(resource: unknown, provenance?: Provenance): Promise<WriteResult>;
  writeMany(items: RelationalWriteItem[]): Promise<WriteResult[]>;
  deleteById(resourceType: string, id: string): Promise<void>;
}

export function createRelationalWriter(db: Kysely<ExternalSchema>, engine: TargetEngine = 'postgres'): RelationalWriter {
  const anyDb = db as unknown as Kysely<any>;
  async function upsert(table: string, rows: Record<string, unknown>[]): Promise<void> {
    if (rows.length === 0) return;
    if (engine === 'mssql') await mergeBatchMssql(anyDb, table, rows);
    else if (engine === 'mysql') await insertBatchMysql(anyDb, table, rows);
    else await insertBatchPg(anyDb, table, rows);
  }
  return {
    async write(resource, provenance = {}) {
      const p = projectResource(resource, provenance);
      if (!p) return 'skipped';
      await upsert(p.table, [p.row]);
      return 'written';
    },
    async writeMany(items) {
      const results: WriteResult[] = new Array(items.length).fill('skipped');
      const byTable = new Map<string, Record<string, unknown>[]>();
      items.forEach((it, idx) => {
        const p = projectResource(it.resource, it.provenance ?? {});
        if (!p) return;
        results[idx] = 'written';
        const list = byTable.get(p.table) ?? [];
        list.push(p.row);
        byTable.set(p.table, list);
      });
      for (const [table, rows] of byTable) await upsert(table, rows);
      return results;
    },
    async deleteById(resourceType, id) {
      const table = v2TableForResourceType(resourceType);
      if (!table) return;
      await anyDb.deleteFrom(table).where('id', '=', id).execute();
    },
  };
}
```

- [ ] **Step 5: Export from `packages/db/src/index.ts`** — add `export * from './relational-writer';` and `export * from './relational';` (near the flat-writer export).

- [ ] **Step 6: Run + typecheck.** `pnpm --filter @openldr/db exec vitest run src/relational-writer.test.ts` → PASS. `pnpm --filter @openldr/db exec vitest run` → all green (flat-writer tests unaffected by the added `export` keywords). `pnpm --filter @openldr/db exec tsc --noEmit` → PASS.

- [ ] **Step 7: Commit.**
```bash
git add packages/db/src/flat-writer.ts packages/db/src/relational-writer.ts packages/db/src/relational-writer.test.ts packages/db/src/index.ts
git commit -m "feat(db): relational writer (v2-core, engine-aware, reuses flat-writer batch upserts) (restructure R3a)"
```

---

## Task 4: Wire the relational writer into the projection worker

**Files:** Modify `projection/cycle.ts`, `projection/cycle.test.ts`, `bootstrap/src/db-context.ts`, `bootstrap/src/index.ts`.

- [ ] **Step 1: Update `projection/cycle.ts`.** Import the writer type and add it to `ProjectionDeps`, then call it alongside `flatWriter` in `applyProjection` and `reprojectAll`:
  - Add import: `import type { RelationalWriter } from '../relational-writer';`
  - In `ProjectionDeps`, add: `relationalWriter: RelationalWriter;`
  - In `applyProjection`, after the `flatWriter` calls:
```ts
    async function applyProjection(task, deps) {
      const canonical = await deps.fhirStore.get(task.resourceType, task.id);
      if (canonical) {
        await deps.flatWriter.write(canonical);
        await deps.relationalWriter.write(canonical);
      } else {
        await deps.flatWriter.deleteById(task.resourceType, task.id);
        await deps.relationalWriter.deleteById(task.resourceType, task.id);
      }
    }
```
  - In `reprojectAll`, change its deps type to also require `relationalWriter` (`Pick<ProjectionDeps, 'internalDb' | 'flatWriter' | 'relationalWriter'>`) and add, right after the `flatWriter.writeMany(...)` call in the paging loop:
```ts
      await deps.relationalWriter.writeMany(rows.map((r) => ({ resource: r.resource })));
```

- [ ] **Step 2: Update `projection/cycle.test.ts`.** Every place that builds projection deps (the `runProjectionCycle`/`createProjectionRunner`/`reprojectAll` calls) now needs a `relationalWriter`. At the top add `import { createRelationalWriter } from '../relational-writer';`, and in each test where an `externalDb`/`flatWriter` is created, also create `const relationalWriter = createRelationalWriter(externalDb as never, 'postgres');` and include `relationalWriter` in the deps object. Add an assertion to the projecting test that the v2 table is also populated, e.g. after the existing `patients` assertion:
```ts
    expect(await externalDb.selectFrom('v2_patients').selectAll().execute()).toHaveLength(1);
```
Read the current test file and thread `relationalWriter` through each deps literal precisely; keep all existing assertions.

- [ ] **Step 3: Wire `db-context.ts` + `index.ts`.** In `db-context.ts`, construct `const relationalWriter = createRelationalWriter(externalDb, engine);` (next to `flatWriter`) and expose it on `DbContext` (add `relationalWriter: RelationalWriter` to the interface + return). In `bootstrap/src/index.ts`, where `createProjectionRunner({ internalDb, fhirStore, flatWriter, logger, fetch })` is built, add `relationalWriter` (from the same construction site that builds `flatWriter`/`workflowFlatWriter`) to that deps object. Import `createRelationalWriter` from `@openldr/db`. READ both files and match the existing construction; keep changes minimal.

- [ ] **Step 4: Typecheck + tests.**
- `pnpm --filter @openldr/db exec vitest run src/projection/cycle.test.ts` → PASS (both projections asserted).
- `pnpm --filter @openldr/db exec vitest run` → all green.
- `pnpm --filter @openldr/db exec tsc --noEmit` → PASS.
- `pnpm --filter @openldr/bootstrap exec tsc --noEmit` → PASS.
- `pnpm --filter @openldr/bootstrap exec vitest run` → PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/db/src/projection/cycle.ts packages/db/src/projection/cycle.test.ts packages/bootstrap/src/db-context.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): project into v2-core tables alongside the thin schema (restructure R3a)"
```

---

## Task 5: Real-Postgres acceptance (v2-core phase)

**Files:** Modify `scripts/projection-live-acceptance.ts`.

- [ ] **Step 1: Extend the acceptance script.** Read `scripts/projection-live-acceptance.ts`. It builds `createProjectionRunner({ internalDb, fhirStore, flatWriter, … })` — add `relationalWriter: createRelationalWriter(externalDb, 'postgres')` to that deps object (import `createRelationalWriter` from `@openldr/db`). Then add a **Phase 5 — v2-core projection**: after the steady-state persist + drain of a Patient + ServiceRequest (`subject: Patient/…`) + Observation (`basedOn: ServiceRequest/…`) + Organization, assert:
  - `v2_patients` has the patient (correct `surname`/`sex`/`patient_guid`);
  - `v2_lab_requests` has the request with `patient_id` = the patient's FHIR id (soft ref) + denormalized `panel_code`/`panel_system`;
  - `v2_lab_results` has the observation with `request_id` = the ServiceRequest's FHIR id + `observation_code`;
  - `v2_facilities` has the organization with `source_resource='Organization'`;
  - after deleting the Patient + draining, its `v2_patients` row is gone.
Use unique run-tagged ids (as the existing phases do). Provide real, compilable code following the script's existing phase/assert style. `console.log('PASS: phase 5 — v2-core projection')` on success.

- [ ] **Step 2: Run it live.** Ensure dev Postgres is up (`:5433`). `pnpm projection:accept` → all phases (1–5) PASS, exit 0. Paste the full output. If a v2 assertion fails, debug the mapping/wiring (the unit tests already prove the mappers, so a live failure is most likely a wiring or run-tagging issue).

- [ ] **Step 3: Commit.**
```bash
git add scripts/projection-live-acceptance.ts
git commit -m "test(accept): v2-core projection phase — patients/lab_requests/lab_results/facilities (restructure R3a)"
```

---

## Task 6: Cross-package verification gate

**Files:** none.

- [ ] **Step 1: Per-package typecheck + tests** (never pipe turbo through `tail`):
```bash
pnpm --filter @openldr/db exec tsc --noEmit
pnpm --filter @openldr/db exec vitest run
pnpm --filter @openldr/ingest exec tsc --noEmit
pnpm --filter @openldr/ingest exec vitest run
pnpm --filter @openldr/bootstrap exec tsc --noEmit
pnpm --filter @openldr/bootstrap exec vitest run
pnpm --filter @openldr/server exec tsc --noEmit
pnpm --filter @openldr/server exec vitest run
```
Expected: ALL PASS. If a downstream package broke on the `DbContext`/`ProjectionDeps` additions, fix the caller to supply `relationalWriter` (do not remove the second projection).

- [ ] **Step 2: Final scoped turbo gate** (informational — per-package above is authoritative on Windows):
```bash
pnpm turbo run typecheck test --filter=@openldr/db --filter=@openldr/bootstrap --force
```
Expected: PASS (ignore Windows lock/EPERM flakes; trust the per-package results).

---

## Self-Review

**Spec coverage:** 4 v2-core tables (T1) · relational mappers + `projectResource` (T2) · relational writer reusing flat-writer batch upserts (T3) · additive wiring into `applyProjection`/`reprojectAll` + boot (T4) · real-PG acceptance phase (T5) · gate (T6). FHIR-id keyed / soft refs / denormalize-from-resource / engine-aware / additive — all covered. Deferred items (AMR, terminology `concept_id`, Specimen/DiagnosticReport, full columns, report cutover, live MSSQL/MySQL) correctly excluded. ✔

**Placeholder scan:** Every code step has complete code; every run step has the exact command + expected result. T5's acceptance phase is specified (not inlined) as "provide real compilable code following the script's existing style" — deliberate, since it must be written against the concrete current script; no placeholders in the shipped code. ✔

**Type consistency:** `V2PatientsTable`/`V2LabRequestsTable`/`V2LabResultsTable`/`V2FacilitiesTable` (T1) are the `Insertable<>` targets of the mappers (T2) and the `ExternalSchema` keys the writer/`projectResource` use (T3). `RelationalWriter` (T3) is the `ProjectionDeps.relationalWriter` type (T4). `v2TableForResourceType`/`projectResource` named distinctly from `flatten`'s `tableForResourceType`/`flattenResource` to avoid a barrel collision. `codeable` gains `system` additively (existing callers unaffected). ✔

**Risk notes for the executor:** (1) additive means BOTH projections run every cycle — the thin schema and reports are untouched; do not modify `flatWriter` behavior. (2) Soft refs = columns only, NO enforced FK constraints (out-of-order projection). (3) `flat-writer.ts` change is only adding `export` to 3 existing helpers — its behavior/tests must stay identical.
