# FHIR Storage + Flattening + Migrations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@openldr/db` — the persistence layer for CE's FHIR-canonical model: Kysely migrations for both databases, an internal canonical `FhirStore`, pure flatten transforms + external scalar flat tables, a `FlatWriter`, the DP-7 `persistResource` primitive, plus `createDbContext` wiring and `openldr db migrate|reset|seed`.

**Architecture:** Internal Postgres stores canonical FHIR as `jsonb` + provenance (`FhirStore`); pure `flatten<Resource>` transforms project resources into scalar rows that `FlatWriter` upserts into the external DB via `TargetStorePort`. `persistResource` saves internally (must succeed) then writes externally best-effort (failure → `degraded`, no crash). Migrations are static in-code Kysely modules (no dynamic import). `@openldr/fhir` stays pure; `@openldr/db` owns all DB I/O and never imports a concrete adapter.

**Tech Stack:** TypeScript (ESM, `moduleResolution: Bundler`), Kysely + pg, zod (via `@openldr/fhir`), Vitest, commander/tsup (CLI). Hand-written Kysely DB interface types.

**Reference:** `docs/superpowers/specs/2026-06-12-fhir-storage-flattening-design.md`

**Conventions:** All commits use `git -c commit.gpgsign=false commit` with **no** `Co-authored-by` trailer (P1-CONV-2). Local imports omit extensions (Bundler resolution). `import type` for type-only. DB-I/O glue (`FhirStore`, `FlatWriter`, migrations DDL) is verified by the Task 7 integration acceptance against the dev docker stack (run via `pnpm openldr`/tsx); pure logic (flatten transforms, `persistResource` with fakes, migration-map shape) is unit-tested.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/db/package.json`, `tsconfig.json` | new package |
| `packages/db/src/provenance.ts` | `Provenance` type |
| `packages/db/src/schema/internal.ts` | Kysely `InternalSchema` (fhir_resources) |
| `packages/db/src/schema/external.ts` | Kysely `ExternalSchema` (7 flat tables) |
| `packages/db/src/flatten/*.ts` | pure `flatten<Resource>` + `flattenResource` dispatch |
| `packages/db/src/migrations/internal/*` | internal migration + static map |
| `packages/db/src/migrations/external/*` | external migration + static map |
| `packages/db/src/migrator.ts` | `createMigrator` |
| `packages/db/src/internal-db.ts` | `createInternalDb` |
| `packages/db/src/fhir-store.ts` | `createFhirStore` (save/get) |
| `packages/db/src/flat-writer.ts` | `createFlatWriter` (write/upsert) |
| `packages/db/src/persist.ts` | `persistResource` (DP-7) |
| `packages/db/src/index.ts` | public surface |
| `packages/bootstrap/src/db-context.ts` | `createDbContext` |
| `packages/cli/src/db.ts` + `index.ts` | `db migrate|reset|seed` commands |

---

## Task 1: `@openldr/db` package + provenance + schema types + flatten transforms

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/src/provenance.ts`, `packages/db/src/schema/internal.ts`, `packages/db/src/schema/external.ts`, `packages/db/src/flatten/extract.ts`, `packages/db/src/flatten/patient.ts`, `packages/db/src/flatten/specimen.ts`, `packages/db/src/flatten/service-request.ts`, `packages/db/src/flatten/diagnostic-report.ts`, `packages/db/src/flatten/observation.ts`, `packages/db/src/flatten/organization.ts`, `packages/db/src/flatten/location.ts`, `packages/db/src/flatten/index.ts`, `packages/db/src/flatten/flatten.test.ts`

- [ ] **Step 1: Create `packages/db/package.json`**

```json
{
  "name": "@openldr/db",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "echo \"no lint\""
  },
  "dependencies": {
    "@openldr/core": "workspace:*",
    "@openldr/fhir": "workspace:*",
    "@openldr/ports": "workspace:*",
    "kysely": "^0.27.5",
    "pg": "^8.13.1"
  },
  "devDependencies": {
    "@types/pg": "^8.11.10",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `packages/db/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Create `packages/db/src/provenance.ts`**

```ts
export interface Provenance {
  sourceSystem?: string;
  pluginId?: string;
  pluginVersion?: string;
  batchId?: string;
}
```

- [ ] **Step 4: Create `packages/db/src/schema/internal.ts`**

```ts
import type { Generated, JSONColumnType } from 'kysely';
import type { FhirResource } from '@openldr/fhir';

export interface FhirResourcesTable {
  resource_type: string;
  id: string;
  version_id: string | null;
  resource: JSONColumnType<FhirResource>;
  source_system: string | null;
  plugin_id: string | null;
  plugin_version: string | null;
  batch_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InternalSchema {
  fhir_resources: FhirResourcesTable;
}
```

- [ ] **Step 5: Create `packages/db/src/schema/external.ts`**

```ts
import type { Generated } from 'kysely';

interface ProvenanceColumns {
  source_system: string | null;
  plugin_id: string | null;
  plugin_version: string | null;
  batch_id: string | null;
  created_at: Generated<Date>;
}

export interface PatientsTable extends ProvenanceColumns {
  id: string;
  identifier_system: string | null;
  identifier_value: string | null;
  family_name: string | null;
  given_name: string | null;
  gender: string | null;
  birth_date: string | null;
  managing_organization: string | null;
}

export interface SpecimensTable extends ProvenanceColumns {
  id: string;
  identifier_value: string | null;
  accession: string | null;
  status: string | null;
  type_code: string | null;
  type_text: string | null;
  subject_ref: string | null;
  parent_ref: string | null;
  received_time: string | null;
}

export interface ServiceRequestsTable extends ProvenanceColumns {
  id: string;
  identifier_value: string | null;
  status: string | null;
  intent: string | null;
  priority: string | null;
  code_code: string | null;
  code_text: string | null;
  subject_ref: string | null;
  authored_on: string | null;
}

export interface DiagnosticReportsTable extends ProvenanceColumns {
  id: string;
  identifier_value: string | null;
  status: string | null;
  code_code: string | null;
  code_text: string | null;
  subject_ref: string | null;
  effective_date_time: string | null;
  issued: string | null;
  conclusion: string | null;
}

export interface ObservationsTable extends ProvenanceColumns {
  id: string;
  identifier_value: string | null;
  status: string | null;
  code_code: string | null;
  code_text: string | null;
  subject_ref: string | null;
  specimen_ref: string | null;
  value_quantity: number | null;
  value_unit: string | null;
  value_code: string | null;
  value_text: string | null;
  interpretation_code: string | null;
  effective_date_time: string | null;
}

export interface OrganizationsTable extends ProvenanceColumns {
  id: string;
  identifier_value: string | null;
  name: string | null;
  type_text: string | null;
  part_of_ref: string | null;
}

export interface LocationsTable extends ProvenanceColumns {
  id: string;
  identifier_value: string | null;
  status: string | null;
  name: string | null;
  type_text: string | null;
  managing_organization: string | null;
  part_of_ref: string | null;
}

export interface ExternalSchema {
  patients: PatientsTable;
  specimens: SpecimensTable;
  service_requests: ServiceRequestsTable;
  diagnostic_reports: DiagnosticReportsTable;
  observations: ObservationsTable;
  organizations: OrganizationsTable;
  locations: LocationsTable;
}
```

- [ ] **Step 6: Create `packages/db/src/flatten/extract.ts`** (shared pure extraction helpers)

```ts
import type { Provenance } from '../provenance';

type Json = Record<string, unknown>;

export function provColumns(p: Provenance): {
  source_system: string | null;
  plugin_id: string | null;
  plugin_version: string | null;
  batch_id: string | null;
} {
  return {
    source_system: p.sourceSystem ?? null,
    plugin_id: p.pluginId ?? null,
    plugin_version: p.pluginVersion ?? null,
    batch_id: p.batchId ?? null,
  };
}

export function firstIdentifier(r: Json): { system: string | null; value: string | null } {
  const id = (r['identifier'] as Json[] | undefined)?.[0];
  return { system: (id?.['system'] as string) ?? null, value: (id?.['value'] as string) ?? null };
}

export function codeable(concept: unknown): { code: string | null; text: string | null } {
  const c = concept as Json | undefined;
  const coding = (c?.['coding'] as Json[] | undefined)?.[0];
  return {
    code: (coding?.['code'] as string) ?? null,
    text: (c?.['text'] as string) ?? (coding?.['display'] as string) ?? null,
  };
}

export function reference(ref: unknown): string | null {
  return ((ref as Json | undefined)?.['reference'] as string) ?? null;
}

export function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}
```

- [ ] **Step 7: Write the failing test `packages/db/src/flatten/flatten.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { flattenResource } from './index';

describe('flattenResource', () => {
  it('flattens a Patient to a scalar row', () => {
    const out = flattenResource(
      {
        resourceType: 'Patient',
        id: 'p1',
        identifier: [{ system: 'urn:mrn', value: '123' }],
        name: [{ family: 'Doe', given: ['Jane'] }],
        gender: 'female',
        birthDate: '1990-05-01',
        managingOrganization: { reference: 'Organization/o1' },
      },
      { sourceSystem: 'whonet' },
    );
    expect(out?.table).toBe('patients');
    expect(out?.row).toMatchObject({
      id: 'p1',
      identifier_system: 'urn:mrn',
      identifier_value: '123',
      family_name: 'Doe',
      given_name: 'Jane',
      gender: 'female',
      birth_date: '1990-05-01',
      managing_organization: 'Organization/o1',
      source_system: 'whonet',
      plugin_id: null,
    });
  });

  it('flattens an Observation including value + specimen ref', () => {
    const out = flattenResource({
      resourceType: 'Observation',
      id: 'o1',
      status: 'final',
      code: { coding: [{ code: 'CIP', display: 'Ciprofloxacin' }] },
      specimen: { reference: 'Specimen/iso1' },
      valueCodeableConcept: { text: 'Resistant' },
      interpretation: [{ coding: [{ code: 'R' }] }],
    });
    expect(out?.table).toBe('observations');
    expect(out?.row).toMatchObject({
      id: 'o1',
      status: 'final',
      code_code: 'CIP',
      code_text: 'Ciprofloxacin',
      specimen_ref: 'Specimen/iso1',
      value_text: 'Resistant',
      interpretation_code: 'R',
    });
  });

  it('returns null for a non-domain resource (Bundle)', () => {
    expect(flattenResource({ resourceType: 'Bundle', type: 'collection' })).toBeNull();
  });

  it('returns null for a non-object', () => {
    expect(flattenResource(null)).toBeNull();
  });
});
```

- [ ] **Step 8: Run it to verify failure**

Run: `pnpm install && pnpm --filter @openldr/db test flatten`
Expected: FAIL — cannot find module `./index`.

- [ ] **Step 9: Create the seven flatten modules.**

`packages/db/src/flatten/patient.ts`:
```ts
import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { PatientsTable } from '../schema/external';
import { provColumns, firstIdentifier, reference, str } from './extract';

export function flattenPatient(r: Record<string, unknown>, prov: Provenance): Insertable<PatientsTable> {
  const idn = firstIdentifier(r);
  const name = (r['name'] as Record<string, unknown>[] | undefined)?.[0];
  return {
    id: String(r['id']),
    identifier_system: idn.system,
    identifier_value: idn.value,
    family_name: str(name?.['family']),
    given_name: str((name?.['given'] as string[] | undefined)?.[0]),
    gender: str(r['gender']),
    birth_date: str(r['birthDate']),
    managing_organization: reference(r['managingOrganization']),
    ...provColumns(prov),
  };
}
```

`packages/db/src/flatten/specimen.ts`:
```ts
import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { SpecimensTable } from '../schema/external';
import { provColumns, firstIdentifier, codeable, reference, str } from './extract';

export function flattenSpecimen(r: Record<string, unknown>, prov: Provenance): Insertable<SpecimensTable> {
  const idn = firstIdentifier(r);
  const type = codeable(r['type']);
  const accession = (r['accessionIdentifier'] as Record<string, unknown> | undefined)?.['value'];
  const parent = (r['parent'] as Record<string, unknown>[] | undefined)?.[0];
  return {
    id: String(r['id']),
    identifier_value: idn.value,
    accession: str(accession),
    status: str(r['status']),
    type_code: type.code,
    type_text: type.text,
    subject_ref: reference(r['subject']),
    parent_ref: reference(parent),
    received_time: str(r['receivedTime']),
    ...provColumns(prov),
  };
}
```

`packages/db/src/flatten/service-request.ts`:
```ts
import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { ServiceRequestsTable } from '../schema/external';
import { provColumns, firstIdentifier, codeable, reference, str } from './extract';

export function flattenServiceRequest(r: Record<string, unknown>, prov: Provenance): Insertable<ServiceRequestsTable> {
  const idn = firstIdentifier(r);
  const code = codeable(r['code']);
  return {
    id: String(r['id']),
    identifier_value: idn.value,
    status: str(r['status']),
    intent: str(r['intent']),
    priority: str(r['priority']),
    code_code: code.code,
    code_text: code.text,
    subject_ref: reference(r['subject']),
    authored_on: str(r['authoredOn']),
    ...provColumns(prov),
  };
}
```

`packages/db/src/flatten/diagnostic-report.ts`:
```ts
import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { DiagnosticReportsTable } from '../schema/external';
import { provColumns, firstIdentifier, codeable, reference, str } from './extract';

export function flattenDiagnosticReport(r: Record<string, unknown>, prov: Provenance): Insertable<DiagnosticReportsTable> {
  const idn = firstIdentifier(r);
  const code = codeable(r['code']);
  return {
    id: String(r['id']),
    identifier_value: idn.value,
    status: str(r['status']),
    code_code: code.code,
    code_text: code.text,
    subject_ref: reference(r['subject']),
    effective_date_time: str(r['effectiveDateTime']),
    issued: str(r['issued']),
    conclusion: str(r['conclusion']),
    ...provColumns(prov),
  };
}
```

`packages/db/src/flatten/observation.ts`:
```ts
import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { ObservationsTable } from '../schema/external';
import { provColumns, firstIdentifier, codeable, reference, str, num } from './extract';

export function flattenObservation(r: Record<string, unknown>, prov: Provenance): Insertable<ObservationsTable> {
  const idn = firstIdentifier(r);
  const code = codeable(r['code']);
  const valueCc = codeable(r['valueCodeableConcept']);
  const quantity = r['valueQuantity'] as Record<string, unknown> | undefined;
  const interpretation = codeable((r['interpretation'] as unknown[] | undefined)?.[0]);
  return {
    id: String(r['id']),
    identifier_value: idn.value,
    status: str(r['status']),
    code_code: code.code,
    code_text: code.text,
    subject_ref: reference(r['subject']),
    specimen_ref: reference(r['specimen']),
    value_quantity: num(quantity?.['value']),
    value_unit: str(quantity?.['unit']),
    value_code: valueCc.code,
    value_text: valueCc.text ?? str(r['valueString']),
    interpretation_code: interpretation.code,
    effective_date_time: str(r['effectiveDateTime']),
    ...provColumns(prov),
  };
}
```

`packages/db/src/flatten/organization.ts`:
```ts
import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { OrganizationsTable } from '../schema/external';
import { provColumns, firstIdentifier, codeable, reference, str } from './extract';

export function flattenOrganization(r: Record<string, unknown>, prov: Provenance): Insertable<OrganizationsTable> {
  const idn = firstIdentifier(r);
  const type = codeable((r['type'] as unknown[] | undefined)?.[0]);
  return {
    id: String(r['id']),
    identifier_value: idn.value,
    name: str(r['name']),
    type_text: type.text,
    part_of_ref: reference(r['partOf']),
    ...provColumns(prov),
  };
}
```

`packages/db/src/flatten/location.ts`:
```ts
import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { LocationsTable } from '../schema/external';
import { provColumns, firstIdentifier, codeable, reference, str } from './extract';

export function flattenLocation(r: Record<string, unknown>, prov: Provenance): Insertable<LocationsTable> {
  const idn = firstIdentifier(r);
  const type = codeable((r['type'] as unknown[] | undefined)?.[0]);
  return {
    id: String(r['id']),
    identifier_value: idn.value,
    status: str(r['status']),
    name: str(r['name']),
    type_text: type.text,
    managing_organization: reference(r['managingOrganization']),
    part_of_ref: reference(r['partOf']),
    ...provColumns(prov),
  };
}
```

- [ ] **Step 10: Create `packages/db/src/flatten/index.ts`** (dispatch)

```ts
import type { Provenance } from '../provenance';
import type { ExternalSchema } from '../schema/external';
import { flattenPatient } from './patient';
import { flattenSpecimen } from './specimen';
import { flattenServiceRequest } from './service-request';
import { flattenDiagnosticReport } from './diagnostic-report';
import { flattenObservation } from './observation';
import { flattenOrganization } from './organization';
import { flattenLocation } from './location';

export * from './patient';
export * from './specimen';
export * from './service-request';
export * from './diagnostic-report';
export * from './observation';
export * from './organization';
export * from './location';

export interface FlatResult {
  table: keyof ExternalSchema;
  row: Record<string, unknown>;
}

export function flattenResource(resource: unknown, prov: Provenance = {}): FlatResult | null {
  if (typeof resource !== 'object' || resource === null) return null;
  const r = resource as Record<string, unknown>;
  switch (r['resourceType']) {
    case 'Patient':
      return { table: 'patients', row: flattenPatient(r, prov) };
    case 'Specimen':
      return { table: 'specimens', row: flattenSpecimen(r, prov) };
    case 'ServiceRequest':
      return { table: 'service_requests', row: flattenServiceRequest(r, prov) };
    case 'DiagnosticReport':
      return { table: 'diagnostic_reports', row: flattenDiagnosticReport(r, prov) };
    case 'Observation':
      return { table: 'observations', row: flattenObservation(r, prov) };
    case 'Organization':
      return { table: 'organizations', row: flattenOrganization(r, prov) };
    case 'Location':
      return { table: 'locations', row: flattenLocation(r, prov) };
    default:
      return null;
  }
}
```

- [ ] **Step 11: Run it to verify pass**

Run: `pnpm --filter @openldr/db test flatten`
Expected: PASS (4 tests).

- [ ] **Step 12: Typecheck**

Run: `pnpm --filter @openldr/db typecheck`
Expected: no errors.

- [ ] **Step 13: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(db): package scaffold, schema types, pure flatten transforms (P1-FHIR-3)"
```

---

## Task 2: Migrations + migrator

**Files:**
- Create: `packages/db/src/migrations/internal/001_fhir_resources.ts`, `packages/db/src/migrations/internal/index.ts`, `packages/db/src/migrations/external/001_flat_tables.ts`, `packages/db/src/migrations/external/index.ts`, `packages/db/src/migrator.ts`, `packages/db/src/migrations/migrations.test.ts`

- [ ] **Step 1: Create `packages/db/src/migrations/internal/001_fhir_resources.ts`**

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('fhir_resources')
    .ifNotExists()
    .addColumn('resource_type', 'text', (c) => c.notNull())
    .addColumn('id', 'text', (c) => c.notNull())
    .addColumn('version_id', 'text')
    .addColumn('resource', 'jsonb', (c) => c.notNull())
    .addColumn('source_system', 'text')
    .addColumn('plugin_id', 'text')
    .addColumn('plugin_version', 'text')
    .addColumn('batch_id', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('fhir_resources_pkey', ['resource_type', 'id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('fhir_resources').ifExists().execute();
}
```

- [ ] **Step 2: Create `packages/db/src/migrations/internal/index.ts`**

```ts
import type { Migration } from 'kysely';
import * as m001 from './001_fhir_resources';

export const internalMigrations: Record<string, Migration> = {
  '001_fhir_resources': { up: m001.up, down: m001.down },
};
```

- [ ] **Step 3: Create `packages/db/src/migrations/external/001_flat_tables.ts`**

```ts
import { type Kysely, type CreateTableBuilder, sql } from 'kysely';

function withCommon(b: CreateTableBuilder<string, never>): CreateTableBuilder<string, never> {
  return b
    .addColumn('source_system', 'text')
    .addColumn('plugin_id', 'text')
    .addColumn('plugin_version', 'text')
    .addColumn('batch_id', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`));
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await withCommon(
    db.schema
      .createTable('patients')
      .ifNotExists()
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('identifier_system', 'text')
      .addColumn('identifier_value', 'text')
      .addColumn('family_name', 'text')
      .addColumn('given_name', 'text')
      .addColumn('gender', 'text')
      .addColumn('birth_date', 'text')
      .addColumn('managing_organization', 'text'),
  ).execute();

  await withCommon(
    db.schema
      .createTable('specimens')
      .ifNotExists()
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('identifier_value', 'text')
      .addColumn('accession', 'text')
      .addColumn('status', 'text')
      .addColumn('type_code', 'text')
      .addColumn('type_text', 'text')
      .addColumn('subject_ref', 'text')
      .addColumn('parent_ref', 'text')
      .addColumn('received_time', 'text'),
  ).execute();

  await withCommon(
    db.schema
      .createTable('service_requests')
      .ifNotExists()
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('identifier_value', 'text')
      .addColumn('status', 'text')
      .addColumn('intent', 'text')
      .addColumn('priority', 'text')
      .addColumn('code_code', 'text')
      .addColumn('code_text', 'text')
      .addColumn('subject_ref', 'text')
      .addColumn('authored_on', 'text'),
  ).execute();

  await withCommon(
    db.schema
      .createTable('diagnostic_reports')
      .ifNotExists()
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('identifier_value', 'text')
      .addColumn('status', 'text')
      .addColumn('code_code', 'text')
      .addColumn('code_text', 'text')
      .addColumn('subject_ref', 'text')
      .addColumn('effective_date_time', 'text')
      .addColumn('issued', 'text')
      .addColumn('conclusion', 'text'),
  ).execute();

  await withCommon(
    db.schema
      .createTable('observations')
      .ifNotExists()
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('identifier_value', 'text')
      .addColumn('status', 'text')
      .addColumn('code_code', 'text')
      .addColumn('code_text', 'text')
      .addColumn('subject_ref', 'text')
      .addColumn('specimen_ref', 'text')
      .addColumn('value_quantity', 'double precision')
      .addColumn('value_unit', 'text')
      .addColumn('value_code', 'text')
      .addColumn('value_text', 'text')
      .addColumn('interpretation_code', 'text')
      .addColumn('effective_date_time', 'text'),
  ).execute();

  await withCommon(
    db.schema
      .createTable('organizations')
      .ifNotExists()
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('identifier_value', 'text')
      .addColumn('name', 'text')
      .addColumn('type_text', 'text')
      .addColumn('part_of_ref', 'text'),
  ).execute();

  await withCommon(
    db.schema
      .createTable('locations')
      .ifNotExists()
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('identifier_value', 'text')
      .addColumn('status', 'text')
      .addColumn('name', 'text')
      .addColumn('type_text', 'text')
      .addColumn('managing_organization', 'text')
      .addColumn('part_of_ref', 'text'),
  ).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['patients', 'specimens', 'service_requests', 'diagnostic_reports', 'observations', 'organizations', 'locations']) {
    await db.schema.dropTable(t).ifExists().execute();
  }
}
```

- [ ] **Step 4: Create `packages/db/src/migrations/external/index.ts`**

```ts
import type { Migration } from 'kysely';
import * as m001 from './001_flat_tables';

export const externalMigrations: Record<string, Migration> = {
  '001_flat_tables': { up: m001.up, down: m001.down },
};
```

- [ ] **Step 5: Create `packages/db/src/migrator.ts`**

```ts
import { Migrator, type Kysely, type Migration } from 'kysely';

export function createMigrator(db: Kysely<unknown>, migrations: Record<string, Migration>): Migrator {
  return new Migrator({
    db,
    provider: { getMigrations: async () => migrations },
  });
}

/** Migrate a database down to empty (used by `db reset`). */
export async function migrateAllDown(migrator: Migrator): Promise<void> {
  for (;;) {
    const { results, error } = await migrator.migrateDown();
    if (error) throw error;
    if (!results || results.length === 0) break;
  }
}
```

- [ ] **Step 6: Write the test `packages/db/src/migrations/migrations.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { internalMigrations } from './internal/index';
import { externalMigrations } from './external/index';

describe('migration maps', () => {
  it('internal has the fhir_resources migration with up/down', () => {
    expect(Object.keys(internalMigrations)).toEqual(['001_fhir_resources']);
    expect(typeof internalMigrations['001_fhir_resources'].up).toBe('function');
    expect(typeof internalMigrations['001_fhir_resources'].down).toBe('function');
  });
  it('external has the flat_tables migration with up/down', () => {
    expect(Object.keys(externalMigrations)).toEqual(['001_flat_tables']);
    expect(typeof externalMigrations['001_flat_tables'].up).toBe('function');
    expect(typeof externalMigrations['001_flat_tables'].down).toBe('function');
  });
});
```

- [ ] **Step 7: Run it to verify pass**

Run: `pnpm --filter @openldr/db test migrations`
Expected: PASS (2 tests).

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @openldr/db typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(db): static Kysely migrations for internal + external schemas"
```

---

## Task 3: internal-db + FhirStore

**Files:**
- Create: `packages/db/src/internal-db.ts`, `packages/db/src/fhir-store.ts`

> DB-I/O glue. Verified by the Task 7 integration acceptance (round-trips a resource through real Postgres). This task implements + typechecks; no unit test (would require a live DB).

- [ ] **Step 1: Create `packages/db/src/internal-db.ts`**

```ts
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { InternalSchema } from './schema/internal';

export interface InternalDb {
  db: Kysely<InternalSchema>;
  close(): Promise<void>;
}

export function createInternalDb(url: string, deps: { pool?: pg.Pool } = {}): InternalDb {
  const pool = deps.pool ?? new pg.Pool({ connectionString: url });
  const db = new Kysely<InternalSchema>({ dialect: new PostgresDialect({ pool }) });
  return { db, close: () => db.destroy() };
}
```

- [ ] **Step 2: Create `packages/db/src/fhir-store.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import type { FhirResource } from '@openldr/fhir';
import type { InternalSchema } from './schema/internal';
import type { Provenance } from './provenance';

export interface SavedRef {
  resourceType: string;
  id: string;
}

export interface FhirStore {
  save(resource: FhirResource, provenance?: Provenance): Promise<SavedRef>;
  get(resourceType: string, id: string): Promise<FhirResource | null>;
}

export function createFhirStore(db: Kysely<InternalSchema>): FhirStore {
  return {
    async save(resource, provenance = {}) {
      const resourceType = resource.resourceType;
      const id = (resource as { id?: string }).id ?? randomUUID();
      const full = { ...resource, id } as FhirResource;
      const versionId = ((resource as { meta?: { versionId?: string } }).meta?.versionId) ?? null;
      const values = {
        resource_type: resourceType,
        id,
        version_id: versionId,
        resource: JSON.stringify(full),
        source_system: provenance.sourceSystem ?? null,
        plugin_id: provenance.pluginId ?? null,
        plugin_version: provenance.pluginVersion ?? null,
        batch_id: provenance.batchId ?? null,
      };
      await db
        .insertInto('fhir_resources')
        .values(values)
        .onConflict((oc) =>
          oc.columns(['resource_type', 'id']).doUpdateSet({
            version_id: versionId,
            resource: JSON.stringify(full),
            source_system: provenance.sourceSystem ?? null,
            plugin_id: provenance.pluginId ?? null,
            plugin_version: provenance.pluginVersion ?? null,
            batch_id: provenance.batchId ?? null,
            updated_at: sql`now()`,
          }),
        )
        .execute();
      return { resourceType, id };
    },

    async get(resourceType, id) {
      const row = await db
        .selectFrom('fhir_resources')
        .select('resource')
        .where('resource_type', '=', resourceType)
        .where('id', '=', id)
        .executeTakeFirst();
      return row ? (row.resource as FhirResource) : null;
    },
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @openldr/db typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(db): internal-db connection + canonical FhirStore (save/get)"
```

---

## Task 4: FlatWriter + persistResource (DP-7)

**Files:**
- Create: `packages/db/src/flat-writer.ts`, `packages/db/src/persist.ts`, `packages/db/src/persist.test.ts`, `packages/db/src/index.ts`

- [ ] **Step 1: Create `packages/db/src/flat-writer.ts`**

```ts
import type { Kysely } from 'kysely';
import type { ExternalSchema } from './schema/external';
import type { Provenance } from './provenance';
import { flattenResource } from './flatten/index';

export type WriteResult = 'written' | 'skipped';

export interface FlatWriter {
  write(resource: unknown, provenance?: Provenance): Promise<WriteResult>;
}

export function createFlatWriter(db: Kysely<ExternalSchema>): FlatWriter {
  return {
    async write(resource, provenance = {}) {
      const flat = flattenResource(resource, provenance);
      if (!flat) return 'skipped';
      const { table, row } = flat;
      const updateRow = { ...row };
      delete (updateRow as Record<string, unknown>).id;
      // Dynamic table dispatch — cast to a loose Kysely so the runtime table name
      // (produced by flatten) is accepted; the whole chain is `any` from here.
      await (db as unknown as Kysely<any>)
        .insertInto(table)
        .values(row)
        .onConflict((oc) => oc.column('id').doUpdateSet(updateRow))
        .execute();
      return 'written';
    },
  };
}
```

- [ ] **Step 2: Write the failing test `packages/db/src/persist.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { persistResource } from './persist';
import type { FhirStore } from './fhir-store';
import type { FlatWriter } from './flat-writer';

const logger = { error: vi.fn(), info: vi.fn() } as never;

function fakeStore(): FhirStore {
  return {
    save: vi.fn(async (r) => ({ resourceType: (r as { resourceType: string }).resourceType, id: (r as { id?: string }).id ?? 'gen-id' })),
    get: vi.fn(),
  } as unknown as FhirStore;
}

const validPatient = { resourceType: 'Patient', id: 'p1', gender: 'male' };

describe('persistResource', () => {
  it('saves internally then writes externally → written', async () => {
    const fhirStore = fakeStore();
    const flatWriter: FlatWriter = { write: vi.fn(async () => 'written') };
    const out = await persistResource({ fhirStore, flatWriter, logger }, validPatient);
    expect(out).toEqual({ saved: true, flattened: 'written' });
    expect(fhirStore.save).toHaveBeenCalledOnce();
  });

  it('degrades (no throw) when the external write fails — DP-7', async () => {
    const fhirStore = fakeStore();
    const flatWriter: FlatWriter = { write: vi.fn(async () => { throw new Error('ECONNREFUSED at db:5432'); }) };
    const out = await persistResource({ fhirStore, flatWriter, logger }, validPatient);
    expect(out.saved).toBe(true);
    expect(out.flattened).toBe('degraded');
    expect(out.externalError).toContain('ECONNREFUSED');
    expect(fhirStore.save).toHaveBeenCalledOnce(); // canonical still saved
  });

  it('passes through a skipped (non-domain) flatten result', async () => {
    const fhirStore = fakeStore();
    const flatWriter: FlatWriter = { write: vi.fn(async () => 'skipped') };
    const out = await persistResource({ fhirStore, flatWriter, logger }, { resourceType: 'Bundle', type: 'collection' });
    expect(out.flattened).toBe('skipped');
  });

  it('throws on invalid FHIR before saving', async () => {
    const fhirStore = fakeStore();
    const flatWriter: FlatWriter = { write: vi.fn() };
    await expect(persistResource({ fhirStore, flatWriter, logger }, { resourceType: 'Observation', code: { text: 'x' } })).rejects.toThrow();
    expect(fhirStore.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it to verify failure**

Run: `pnpm --filter @openldr/db test persist`
Expected: FAIL — cannot find module `./persist`.

- [ ] **Step 4: Create `packages/db/src/persist.ts`**

```ts
import { type Logger, errorMessage, redact, OpenLdrError } from '@openldr/core';
import { validateResource } from '@openldr/fhir';
import type { FhirStore } from './fhir-store';
import type { FlatWriter } from './flat-writer';
import type { Provenance } from './provenance';

export interface PersistResult {
  saved: boolean;
  flattened: 'written' | 'skipped' | 'degraded';
  externalError?: string;
}

export interface PersistDeps {
  fhirStore: FhirStore;
  flatWriter: FlatWriter;
  logger: Logger;
}

export async function persistResource(
  deps: PersistDeps,
  resource: unknown,
  provenance: Provenance = {},
): Promise<PersistResult> {
  const validation = validateResource(resource);
  if (!validation.ok) {
    throw new OpenLdrError('cannot persist invalid FHIR resource');
  }
  const valid = validation.resource;

  // Canonical internal save is the source of truth — must succeed (throws on failure).
  const ref = await deps.fhirStore.save(valid, provenance);
  const withId = { ...valid, id: ref.id };

  // External flattened projection is best-effort (DP-7): a failure degrades only this stage.
  try {
    const flattened = await deps.flatWriter.write(withId, provenance);
    return { saved: true, flattened };
  } catch (err) {
    const externalError = redact(errorMessage(err));
    deps.logger.error({ externalError, resourceType: valid.resourceType, id: ref.id }, 'flatten write degraded');
    return { saved: true, flattened: 'degraded', externalError };
  }
}
```

- [ ] **Step 5: Run it to verify pass**

Run: `pnpm --filter @openldr/db test persist`
Expected: PASS (4 tests).

- [ ] **Step 6: Create `packages/db/src/index.ts`**

```ts
export * from './provenance';
export * from './schema/internal';
export * from './schema/external';
export * from './flatten/index';
export * from './migrations/internal/index';
export * from './migrations/external/index';
export * from './migrator';
export * from './internal-db';
export * from './fhir-store';
export * from './flat-writer';
export * from './persist';
```

- [ ] **Step 7: Full package test + typecheck**

Run: `pnpm --filter @openldr/db test && pnpm --filter @openldr/db typecheck`
Expected: all db tests pass (flatten, migrations, persist); typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(db): FlatWriter + persistResource DP-7 primitive + public surface"
```

---

## Task 5: `createDbContext` in `@openldr/bootstrap`

**Files:**
- Modify: `packages/bootstrap/package.json` (add `@openldr/db` dep)
- Create: `packages/bootstrap/src/db-context.ts`
- Modify: `packages/bootstrap/src/index.ts` (re-export db-context)

- [ ] **Step 1: Add the dependency in `packages/bootstrap/package.json`** — inside `"dependencies"`, add `"@openldr/db": "workspace:*",` (keep alphabetical with the other `@openldr/*` entries). Then run: `pnpm install`.

- [ ] **Step 2: Create `packages/bootstrap/src/db-context.ts`**

```ts
import { Kysely } from 'kysely';
import type { MigrationResultSet } from 'kysely';
import { createDbStore } from '@openldr/adapter-db-store';
import type { Config } from '@openldr/config';
import { createLogger, ConfigError } from '@openldr/core';
import type { TargetStorePort } from '@openldr/ports';
import {
  createInternalDb,
  createFhirStore,
  createFlatWriter,
  createMigrator,
  migrateAllDown,
  persistResource,
  internalMigrations,
  externalMigrations,
  type InternalSchema,
  type ExternalSchema,
  type FhirStore,
  type FlatWriter,
  type Provenance,
  type PersistResult,
} from '@openldr/db';

export interface DbContext {
  internalDb: Kysely<InternalSchema>;
  externalStore: TargetStorePort;
  fhirStore: FhirStore;
  flatWriter: FlatWriter;
  persist(resource: unknown, prov?: Provenance): Promise<PersistResult>;
  migrateAll(): Promise<{ internal: MigrationResultSet; external: MigrationResultSet }>;
  reset(opts?: { force?: boolean }): Promise<void>;
  close(): Promise<void>;
}

export async function createDbContext(cfg: Config): Promise<DbContext> {
  const logger = createLogger({ level: cfg.LOG_LEVEL });
  const internal = createInternalDb(cfg.INTERNAL_DATABASE_URL);
  const externalStore = createDbStore({ url: cfg.TARGET_DATABASE_URL });
  const externalDb = externalStore.db as unknown as Kysely<ExternalSchema>;

  const fhirStore = createFhirStore(internal.db);
  const flatWriter = createFlatWriter(externalDb);
  const internalMigrator = createMigrator(internal.db, internalMigrations);
  const externalMigrator = createMigrator(externalDb, externalMigrations);

  return {
    internalDb: internal.db,
    externalStore,
    fhirStore,
    flatWriter,
    persist: (resource, prov) => persistResource({ fhirStore, flatWriter, logger }, resource, prov),
    async migrateAll() {
      const internalRes = await internalMigrator.migrateToLatest();
      const externalRes = await externalMigrator.migrateToLatest();
      return { internal: internalRes, external: externalRes };
    },
    async reset(opts = {}) {
      if (cfg.NODE_ENV === 'production' && !opts.force) {
        throw new ConfigError('db reset refused in production without force');
      }
      await migrateAllDown(internalMigrator);
      await migrateAllDown(externalMigrator);
      await internalMigrator.migrateToLatest();
      await externalMigrator.migrateToLatest();
    },
    async close() {
      await Promise.allSettled([internal.close(), externalStore.close()]);
    },
  };
}
```

- [ ] **Step 3: Re-export from `packages/bootstrap/src/index.ts`** — append this line at the end of the file:

```ts
export * from './db-context';
```

- [ ] **Step 4: Typecheck + depcruise**

Run: `pnpm install && pnpm --filter @openldr/bootstrap typecheck && pnpm depcruise`
Expected: typecheck clean; depcruise reports no violations (bootstrap may import `@openldr/db` and the adapter; `@openldr/db` imports neither apps nor adapters).

- [ ] **Step 5: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(bootstrap): createDbContext wiring internal + external DBs (DP-1)"
```

---

## Task 6: `openldr db` CLI commands

**Files:**
- Create: `packages/cli/src/db.ts`
- Modify: `packages/cli/src/index.ts` (register the `db` command group)

- [ ] **Step 1: Create `packages/cli/src/db.ts`**

```ts
import { createDbContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';

interface JsonOpt {
  json: boolean;
}

function emit(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? JSON.stringify(payload, null, 2) + '\n' : human + '\n');
}

export async function runDbMigrate(opts: JsonOpt): Promise<number> {
  const ctx = await createDbContext(loadConfig());
  try {
    const res = await ctx.migrateAll();
    const internalNames = (res.internal.results ?? []).map((r) => r.migrationName);
    const externalNames = (res.external.results ?? []).map((r) => r.migrationName);
    if (res.internal.error || res.external.error) {
      emit(opts.json, { ok: false, internalNames, externalNames }, 'migration error');
      return 1;
    }
    emit(
      opts.json,
      { ok: true, internal: internalNames, external: externalNames },
      `migrated internal: [${internalNames.join(', ')}]  external: [${externalNames.join(', ')}]`,
    );
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runDbReset(opts: JsonOpt & { force: boolean }): Promise<number> {
  const ctx = await createDbContext(loadConfig());
  try {
    await ctx.reset({ force: opts.force });
    emit(opts.json, { ok: true }, 'database reset complete');
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runDbSeed(opts: JsonOpt): Promise<number> {
  const ctx = await createDbContext(loadConfig());
  try {
    const org = { resourceType: 'Organization', id: 'seed-org', name: 'Seed Central Lab' };
    const loc = {
      resourceType: 'Location',
      id: 'seed-loc',
      status: 'active',
      name: 'Seed Bench',
      managingOrganization: { reference: 'Organization/seed-org' },
    };
    const patient = {
      resourceType: 'Patient',
      id: 'seed-pat',
      gender: 'female',
      birthDate: '1990-01-01',
      managingOrganization: { reference: 'Organization/seed-org' },
    };
    const results: { id: string; flattened: string }[] = [];
    for (const r of [org, loc, patient]) {
      const out = await ctx.persist(r, { sourceSystem: 'seed' });
      results.push({ id: r.id, flattened: out.flattened });
    }
    emit(opts.json, { ok: true, results }, `seeded ${results.length} resources`);
    return 0;
  } finally {
    await ctx.close();
  }
}
```

- [ ] **Step 2: Register the commands in `packages/cli/src/index.ts`** — add the import near the other imports:

```ts
import { runDbMigrate, runDbReset, runDbSeed } from './db';
```

and add this command group immediately before the final `program.parseAsync(process.argv);` line:

```ts
const db = program.command('db').description('Database migrations and seeding');
db.command('migrate')
  .description('Run internal + external migrations to latest')
  .option('--json', 'emit JSON', false)
  .action(async (opts: { json: boolean }) => {
    try {
      process.exitCode = await runDbMigrate(opts);
    } catch (err) {
      process.stderr.write(`db migrate failed: ${errorMessage(err)}\n`);
      process.exitCode = 1;
    }
  });
db.command('reset')
  .description('Drop and re-run all migrations (refuses in production without --force)')
  .option('--json', 'emit JSON', false)
  .option('--force', 'allow in production', false)
  .action(async (opts: { json: boolean; force: boolean }) => {
    try {
      process.exitCode = await runDbReset(opts);
    } catch (err) {
      process.stderr.write(`db reset failed: ${errorMessage(err)}\n`);
      process.exitCode = 1;
    }
  });
db.command('seed')
  .description('Insert a small sample data set')
  .option('--json', 'emit JSON', false)
  .action(async (opts: { json: boolean }) => {
    try {
      process.exitCode = await runDbSeed(opts);
    } catch (err) {
      process.stderr.write(`db seed failed: ${errorMessage(err)}\n`);
      process.exitCode = 1;
    }
  });
```

(The existing `import { errorMessage } from '@openldr/core';` at the top of the file already covers the `errorMessage` use above — do not add a duplicate import.)

- [ ] **Step 3: Typecheck + build**

Run: `pnpm install && pnpm --filter @openldr/cli typecheck && pnpm --filter @openldr/cli build`
Expected: typecheck clean; `dist/index.js` produced.

- [ ] **Step 4: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(cli): openldr db migrate|reset|seed (P1-CLI-1, P1-CLI-2)"
```

---

## Task 7: Integration acceptance + final gate

> Requires the dev docker stack. Run the CLI via `pnpm openldr` (tsx) — not the built binary (the `dist` binary has a separate pre-existing `Dynamic require` defect tracked elsewhere).

- [ ] **Step 1: Ensure the stack is up**

Run: `docker compose up -d`
Then confirm postgres healthy: `docker compose ps`
Ensure a local `.env` exists (copy from `.env.example` if needed; on this machine it points at the override ports — postgres 5433).

- [ ] **Step 2: Migrate**

Run: `pnpm openldr db migrate --json`
Expected: JSON `"ok": true` with `internal: ["001_fhir_resources"]` and `external: ["001_flat_tables"]`; exit 0.
Verify tables exist (use the container; container-internal port is 5432):
Run: `docker compose exec -T postgres psql -U openldr -d openldr -c "\dt"` → shows `fhir_resources`.
Run: `docker compose exec -T postgres psql -U openldr -d openldr_target -c "\dt"` → shows `patients`, `observations`, etc.

- [ ] **Step 3: Seed (round-trip persist)**

Run: `pnpm openldr db seed --json`
Expected: `"ok": true`, three results each `flattened: "written"`; exit 0.
Verify canonical + flat rows:
Run: `docker compose exec -T postgres psql -U openldr -d openldr -c "select resource_type,id,source_system from fhir_resources order by id;"` → shows `Organization seed-org`, `Location seed-loc`, `Patient seed-pat` with `source_system=seed`.
Run: `docker compose exec -T postgres psql -U openldr -d openldr_target -c "select id,name,managing_organization from patients;"` → shows `seed-pat` with `managing_organization=Organization/seed-org`.

- [ ] **Step 4: DP-7 graceful degradation**

Re-seed with a broken external URL (internal is already migrated; the external write must degrade):
Run (bash): `TARGET_DATABASE_URL=postgres://openldr:openldr@localhost:5999/none pnpm openldr db seed --json`
(PowerShell: `$env:TARGET_DATABASE_URL='postgres://openldr:openldr@localhost:5999/none'; pnpm openldr db seed --json; Remove-Item Env:TARGET_DATABASE_URL`)
Expected: the command still completes; each result shows `flattened: "degraded"`; the canonical resources are still written to internal `fhir_resources` (re-query internal to confirm); no stack-trace crash.

- [ ] **Step 5: Reset**

Run: `pnpm openldr db reset --json`
Expected: `"ok": true`; exit 0. Re-query `\dt` in both DBs → tables exist (dropped and recreated).

- [ ] **Step 6: Final workspace gate**

Run: `pnpm install && pnpm -r typecheck && pnpm -r test && pnpm depcruise && pnpm -r build`
Expected: typecheck clean; all tests pass; `depcruise` no violations (confirms `@openldr/db` imports no `adapter-*` and `@openldr/fhir` remains pure); builds succeed.

- [ ] **Step 7: Commit any final lockfile/doc deltas**

Run: `git status --short` — if `pnpm-lock.yaml` changed, commit it:

```bash
git add -A
git -c commit.gpgsign=false commit -m "chore: finalize 2b dependency lockfile"
```

---

## Done criteria (maps to spec §11)

- [ ] `@openldr/db` created; `@openldr/fhir` unchanged/pure.
- [ ] Internal `fhir_resources` + `FhirStore.save/get` round-trips canonical FHIR (verified Step 3).
- [ ] Pure flatten transforms for the seven resources; external scalar flat tables, never jsonb.
- [ ] Provenance columns on `fhir_resources` and every flat table.
- [ ] `persistResource` internal-must-succeed / external-best-effort; external failure → `degraded`, no crash (verified Step 4).
- [ ] Static in-code Kysely migrator for both DBs; no dynamic import.
- [ ] `openldr db migrate|reset|seed [--json]` work via `createDbContext`.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm depcruise && pnpm -r build` all green.
