# DHIS2 Integration (Slice A, headless aggregate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push aggregate AMR surveillance data from CE to DHIS2 — a generic `ReportingTargetPort` + `adapter-dhis2` (Web API), a pure declarative mapping engine (report rows → DHIS2 `dataValueSets`), orgUnit/mapping tables, dry-run, audited push, and a `dhis2` CLI.

**Architecture:** `@openldr/ports` gets a DHIS2-agnostic `ReportingTargetPort`; `adapter-dhis2` implements it over `fetch` (only bootstrap imports it). `@openldr/dhis2` (domain, no adapters) holds the declarative `AggregateMapping` + pure `buildDataValueSet`/`validateMapping`. Mappings + facility→orgUnit map live in internal Postgres (migration `008_dhis2`). The push flow runs an existing report (`ctx.reporting.run`), maps the rows, and either previews (dry-run) or pushes via the port + audits the result (best-effort, DP-7).

**Tech Stack:** TypeScript ESM, zod (config), Kysely (internal PG), `fetch` (DHIS2 Web API), commander (CLI), Docker (`dhis2/core` + `postgis`), vitest.

---

## Key facts (verified in the codebase)

- Port pattern (`packages/ports/src/target-store.ts`): an interface + `export * from './<name>'` in `packages/ports/src/index.ts`.
- Adapter pattern (`packages/adapter-mssql-store/`): private pkg, `exports: ./src/index.ts`, deps `@openldr/core`+`@openldr/ports`(+driver); a `deps` seam (e.g. `deps.pool`/`deps.fetch`) makes health/calls unit-testable; `probe(fn)` from `@openldr/core` maps to `{status:'up'|'down',detail}`. Only bootstrap imports adapters (DP-1, depcruise).
- Internal migration pattern (`migrations/internal/006_users.ts` + `internal/index.ts` + `schema/internal.ts` `InternalSchema`). Latest is `007_terminology`; add `008_dhis2`.
- Domain pkg pattern (`@openldr/audit`/`@openldr/terminology`): deps `@openldr/core`+`@openldr/db`(+types); store `createXStore(db: Kysely<InternalSchema>)`.
- Reporting on `AppContext`: `ctx.reporting.run(id: string, rawParams: unknown): Promise<ReportResult>` where `ReportResult = { columns: {key,label,kind}[]; rows: Record<string,unknown>[]; chart; meta }`.
- Audit: `ctx.audit.record(e: AuditEventInput)` / `safeRecord(store, logger, e)`; `AuditEventInput = { actorType:'user'|'system'; actorId?; actorName; action; entityType; entityId; before?; after?; metadata? }`. `ctx.audit.list(filter)` for `status` (filter has `entityType`, `limit`).
- CLI: commander; per-feature `run*` modules in `packages/cli/src/*.ts`; registered in `packages/cli/src/index.ts`; `--json` everywhere; `build:check` must stay green (run the built artifact).
- Config: `ConfigSchema` is a `z.object({...}).superRefine(...)`; adapter enums + conditional required secrets (the MSSQL block is the template).

---

## Task 1: `ReportingTargetPort` in `@openldr/ports`

**Files:**
- Create: `packages/ports/src/reporting-target.ts`
- Modify: `packages/ports/src/index.ts`

- [ ] **Step 1: Create `packages/ports/src/reporting-target.ts`**

```ts
import type { HealthResult } from './health';

export interface TargetMetadata {
  dataElements: { id: string; name: string }[];
  orgUnits: { id: string; name: string }[];
  categoryOptionCombos: { id: string; name: string }[];
}

export interface PushResult {
  status: 'success' | 'warning' | 'error';
  imported: number;
  updated: number;
  ignored: number;
  deleted: number;
  conflicts: { object: string; value: string }[];
  raw: unknown;
}

// Generic external-reporting-target seam (DHIS2 now; GLASS/FHIR targets reuse it).
export interface ReportingTargetPort {
  healthCheck(): Promise<HealthResult>;
  pullMetadata(): Promise<TargetMetadata>;
  pushAggregate(payload: unknown): Promise<PushResult>;
}
```

- [ ] **Step 2: Export it** — append to `packages/ports/src/index.ts`:

```ts
export * from './reporting-target';
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @openldr/ports typecheck`
Expected: PASS. (`HealthResult` is exported from `./health` — confirm via the existing `target-store.ts` import.)

- [ ] **Step 4: Commit**

```bash
git add packages/ports/src/reporting-target.ts packages/ports/src/index.ts
git commit -m "feat(ports): ReportingTargetPort (P2-DHIS2-1)"
```

---

## Task 2: Internal migration `008_dhis2` + schema

**Files:**
- Create: `packages/db/src/migrations/internal/008_dhis2.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/schema/internal.ts`
- Modify: `packages/db/src/migrations/migrations.test.ts`

- [ ] **Step 1: Create `packages/db/src/migrations/internal/008_dhis2.ts`**

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('dhis2_orgunit_map')
    .ifNotExists()
    .addColumn('facility_id', 'text', (c) => c.primaryKey())
    .addColumn('orgunit_id', 'text', (c) => c.notNull())
    .addColumn('orgunit_name', 'text')
    .execute();

  await db.schema
    .createTable('dhis2_mappings')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('definition', 'jsonb', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('dhis2_mappings').ifExists().execute();
  await db.schema.dropTable('dhis2_orgunit_map').ifExists().execute();
}
```

- [ ] **Step 2: Register** in `packages/db/src/migrations/internal/index.ts` — add `import * as m008 from './008_dhis2';` and `'008_dhis2': { up: m008.up, down: m008.down },` after `'007_terminology'`.

- [ ] **Step 3: Schema** — in `packages/db/src/schema/internal.ts`, add before `InternalSchema`:

```ts
export interface Dhis2OrgUnitMapTable {
  facility_id: string;
  orgunit_id: string;
  orgunit_name: string | null;
}

export interface Dhis2MappingsTable {
  id: string;
  name: string;
  definition: JSONColumnType<Record<string, unknown>>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}
```
and add inside `InternalSchema`:
```ts
  dhis2_orgunit_map: Dhis2OrgUnitMapTable;
  dhis2_mappings: Dhis2MappingsTable;
```

- [ ] **Step 4: Update** `packages/db/src/migrations/migrations.test.ts` — change the internal keys assertion to append `'008_dhis2'`:

```ts
    expect(Object.keys(internalMigrations)).toEqual(['001_fhir_resources', '002_outbox', '003_ingest_batches', '004_plugins', '005_audit_events', '006_users', '007_terminology', '008_dhis2']);
```

- [ ] **Step 5: Run** `pnpm --filter @openldr/db test && pnpm --filter @openldr/db typecheck`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/migrations/internal/008_dhis2.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts packages/db/src/migrations/migrations.test.ts
git commit -m "feat(db): 008_dhis2 internal migration + schema (P2-DHIS2-3)"
```

---

## Task 3: OrgUnitMap + Mapping stores (`@openldr/db`)

**Files:**
- Create: `packages/db/src/dhis2-store.ts`
- Modify: `packages/db/src/index.ts`

Verified by typecheck + live acceptance (SQL surface; no live-DB unit test, like FhirStore/TerminologyStore).

- [ ] **Step 1: Create `packages/db/src/dhis2-store.ts`**

```ts
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export interface OrgUnitMapEntry { facilityId: string; orgUnitId: string; orgUnitName: string | null }
export interface Dhis2MappingRecord { id: string; name: string; definition: Record<string, unknown> }

export interface OrgUnitMapStore {
  upsert(entries: OrgUnitMapEntry[]): Promise<void>;
  list(): Promise<OrgUnitMapEntry[]>;
  getMap(): Promise<Map<string, string>>;
}

export interface MappingStore {
  upsert(m: Dhis2MappingRecord): Promise<void>;
  get(id: string): Promise<Dhis2MappingRecord | null>;
  list(): Promise<{ id: string; name: string }[]>;
}

export function createOrgUnitMapStore(db: Kysely<InternalSchema>): OrgUnitMapStore {
  return {
    async upsert(entries) {
      if (entries.length === 0) return;
      await db
        .insertInto('dhis2_orgunit_map')
        .values(entries.map((e) => ({ facility_id: e.facilityId, orgunit_id: e.orgUnitId, orgunit_name: e.orgUnitName })))
        .onConflict((oc) => oc.column('facility_id').doUpdateSet((eb) => ({ orgunit_id: eb.ref('excluded.orgunit_id'), orgunit_name: eb.ref('excluded.orgunit_name') })))
        .execute();
    },
    async list() {
      const rows = await db.selectFrom('dhis2_orgunit_map').selectAll().orderBy('facility_id').execute();
      return rows.map((r) => ({ facilityId: r.facility_id, orgUnitId: r.orgunit_id, orgUnitName: r.orgunit_name }));
    },
    async getMap() {
      const rows = await db.selectFrom('dhis2_orgunit_map').select(['facility_id', 'orgunit_id']).execute();
      return new Map(rows.map((r) => [r.facility_id, r.orgunit_id]));
    },
  };
}

export function createMappingStore(db: Kysely<InternalSchema>): MappingStore {
  return {
    async upsert(m) {
      await db
        .insertInto('dhis2_mappings')
        .values({ id: m.id, name: m.name, definition: JSON.stringify(m.definition) as unknown as Record<string, unknown> })
        .onConflict((oc) => oc.column('id').doUpdateSet((eb) => ({ name: eb.ref('excluded.name'), definition: eb.ref('excluded.definition'), updated_at: sql`now()` })))
        .execute();
    },
    async get(id) {
      const row = await db.selectFrom('dhis2_mappings').select(['id', 'name', 'definition']).where('id', '=', id).executeTakeFirst();
      return row ? { id: row.id, name: row.name, definition: row.definition as Record<string, unknown> } : null;
    },
    async list() {
      return db.selectFrom('dhis2_mappings').select(['id', 'name']).orderBy('id').execute();
    },
  };
}
```

- [ ] **Step 2: Export** — append to `packages/db/src/index.ts`:

```ts
export * from './dhis2-store';
```

- [ ] **Step 3: Typecheck** `pnpm --filter @openldr/db typecheck`. Expected: PASS (keep the `JSON.stringify(...) as unknown as ...` cast for the jsonb insert, mirroring other stores).

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/dhis2-store.ts packages/db/src/index.ts
git commit -m "feat(db): DHIS2 orgUnit-map + mapping stores (P2-DHIS2-3)"
```

---

## Task 4: `@openldr/dhis2` package + `buildDataValueSet` engine

**Files:**
- Create: `packages/dhis2/package.json`
- Create: `packages/dhis2/tsconfig.json`
- Create: `packages/dhis2/src/types.ts`
- Create: `packages/dhis2/src/mapping.ts`
- Create: `packages/dhis2/src/mapping.test.ts`
- Create: `packages/dhis2/src/index.ts`

- [ ] **Step 1: Create `packages/dhis2/package.json`**

```json
{
  "name": "@openldr/dhis2",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run", "lint": "echo \"no lint\"" },
  "dependencies": { "@openldr/core": "workspace:*", "@openldr/ports": "workspace:*" },
  "devDependencies": { "@types/node": "^22.10.0", "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

- [ ] **Step 2: Create `packages/dhis2/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `packages/dhis2/src/types.ts`**

```ts
export type MappingSource = { kind: 'report'; reportId: string; params?: Record<string, string> };

export interface ColumnMapping {
  column: string;
  dataElement: string;
  categoryOptionCombo?: string;
}

export interface AggregateMapping {
  id: string;
  name: string;
  source: MappingSource;
  orgUnitColumn: string;
  periodColumn?: string;
  columns: ColumnMapping[];
}

export interface DataValue {
  dataElement: string;
  categoryOptionCombo?: string;
  orgUnit: string;
  period: string;
  value: string;
}

export interface DataValueSet {
  dataValues: DataValue[];
}

export interface SkipRecord {
  row: number;
  reason: string;
}

export interface BuildOutput {
  payload: DataValueSet;
  skipped: SkipRecord[];
}
```

- [ ] **Step 4: Write failing test** — `packages/dhis2/src/mapping.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildDataValueSet, dispatchReportSource } from './mapping';
import type { AggregateMapping } from './types';

const mapping: AggregateMapping = {
  id: 'amr-to-dhis2',
  name: 'AMR to DHIS2',
  source: { kind: 'report', reportId: 'amr-resistance' },
  orgUnitColumn: 'facility',
  columns: [
    { column: 'tested', dataElement: 'DE_TESTED' },
    { column: 'r', dataElement: 'DE_RESISTANT', categoryOptionCombo: 'COC_DEFAULT' },
  ],
};
const orgMap = new Map([['fac-1', 'OU_AAA']]);

describe('buildDataValueSet', () => {
  it('maps rows to dataValues, resolving orgUnit + period', () => {
    const rows = [{ facility: 'fac-1', tested: 4, r: 2 }];
    const { payload, skipped } = buildDataValueSet(rows, mapping, orgMap, '2026Q1');
    expect(skipped).toEqual([]);
    expect(payload.dataValues).toEqual([
      { dataElement: 'DE_TESTED', orgUnit: 'OU_AAA', period: '2026Q1', value: '4' },
      { dataElement: 'DE_RESISTANT', categoryOptionCombo: 'COC_DEFAULT', orgUnit: 'OU_AAA', period: '2026Q1', value: '2' },
    ]);
  });
  it('skips rows whose facility has no orgUnit mapping', () => {
    const rows = [{ facility: 'unmapped', tested: 1, r: 0 }];
    const { payload, skipped } = buildDataValueSet(rows, mapping, orgMap, '2026Q1');
    expect(payload.dataValues).toEqual([]);
    expect(skipped[0].reason).toMatch(/orgUnit/i);
  });
  it('skips null/empty values but keeps others', () => {
    const rows = [{ facility: 'fac-1', tested: 4, r: null }];
    const { payload } = buildDataValueSet(rows, mapping, orgMap, '2026Q1');
    expect(payload.dataValues.map((d) => d.dataElement)).toEqual(['DE_TESTED']);
  });
  it('uses periodColumn when present', () => {
    const m = { ...mapping, periodColumn: 'month' };
    const rows = [{ facility: 'fac-1', tested: 1, r: 0, month: '202601' }];
    const { payload } = buildDataValueSet(rows, m, orgMap, 'IGNORED');
    expect(payload.dataValues[0].period).toBe('202601');
  });
});

describe('dispatchReportSource', () => {
  it('returns the report descriptor for a report source', () => {
    expect(dispatchReportSource(mapping.source)).toEqual({ reportId: 'amr-resistance', params: undefined });
  });
  it('throws on an unsupported source kind', () => {
    expect(() => dispatchReportSource({ kind: 'query' } as never)).toThrow(/unsupported/i);
  });
});
```

- [ ] **Step 5: Run, verify fail** — `pnpm install` then `pnpm --filter @openldr/dhis2 test`. Expected: FAIL (module missing).

- [ ] **Step 6: Create `packages/dhis2/src/mapping.ts`**

```ts
import { OpenLdrError } from '@openldr/core';
import type { AggregateMapping, BuildOutput, DataValue, MappingSource, SkipRecord } from './types';

export function dispatchReportSource(source: MappingSource): { reportId: string; params?: Record<string, string> } {
  if (source.kind !== 'report') {
    throw new OpenLdrError(`unsupported mapping source kind '${(source as { kind: string }).kind}' (Slice A supports 'report')`);
  }
  return { reportId: source.reportId, params: source.params };
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

export function buildDataValueSet(
  rows: Record<string, unknown>[],
  mapping: AggregateMapping,
  orgUnitMap: Map<string, string>,
  period: string,
): BuildOutput {
  const dataValues: DataValue[] = [];
  const skipped: SkipRecord[] = [];
  rows.forEach((row, i) => {
    const facility = row[mapping.orgUnitColumn];
    const orgUnit = typeof facility === 'string' ? orgUnitMap.get(facility) : undefined;
    if (!orgUnit) {
      skipped.push({ row: i, reason: `no orgUnit mapping for facility '${String(facility)}'` });
      return;
    }
    const rowPeriod = mapping.periodColumn && !isEmpty(row[mapping.periodColumn]) ? String(row[mapping.periodColumn]) : period;
    for (const col of mapping.columns) {
      const value = row[col.column];
      if (isEmpty(value)) continue;
      dataValues.push({
        dataElement: col.dataElement,
        ...(col.categoryOptionCombo ? { categoryOptionCombo: col.categoryOptionCombo } : {}),
        orgUnit,
        period: rowPeriod,
        value: String(value),
      });
    }
  });
  return { payload: { dataValues }, skipped };
}
```

- [ ] **Step 7: Create `packages/dhis2/src/index.ts`**

```ts
export * from './types';
export * from './mapping';
```

- [ ] **Step 8: Run, verify pass** — `pnpm --filter @openldr/dhis2 test && pnpm --filter @openldr/dhis2 typecheck`. Expected: PASS (6 tests).

- [ ] **Step 9: Commit**

```bash
git add packages/dhis2 pnpm-lock.yaml
git commit -m "feat(dhis2): package + buildDataValueSet aggregate mapping engine (P2-DHIS2-2)"
```

---

## Task 5: `validateMapping`

**Files:**
- Create: `packages/dhis2/src/validate.ts`
- Create: `packages/dhis2/src/validate.test.ts`
- Modify: `packages/dhis2/src/index.ts`

- [ ] **Step 1: Write failing test** — `packages/dhis2/src/validate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateMapping } from './validate';
import type { AggregateMapping } from './types';
import type { TargetMetadata } from '@openldr/ports';

const metadata: TargetMetadata = {
  dataElements: [{ id: 'DE_TESTED', name: 'Tested' }],
  orgUnits: [{ id: 'OU_AAA', name: 'Facility A' }],
  categoryOptionCombos: [{ id: 'COC_DEFAULT', name: 'default' }],
};
const base: AggregateMapping = {
  id: 'm', name: 'm', source: { kind: 'report', reportId: 'amr-resistance' }, orgUnitColumn: 'facility',
  columns: [{ column: 'tested', dataElement: 'DE_TESTED' }],
};

describe('validateMapping', () => {
  it('passes when all dataElements/cocs exist', () => {
    expect(validateMapping(base, metadata)).toEqual([]);
  });
  it('flags an unknown dataElement', () => {
    const m = { ...base, columns: [{ column: 'x', dataElement: 'DE_MISSING' }] };
    expect(validateMapping(m, metadata).some((p) => p.includes('DE_MISSING'))).toBe(true);
  });
  it('flags an unknown categoryOptionCombo', () => {
    const m = { ...base, columns: [{ column: 'tested', dataElement: 'DE_TESTED', categoryOptionCombo: 'COC_X' }] };
    expect(validateMapping(m, metadata).some((p) => p.includes('COC_X'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @openldr/dhis2 test -- validate`. Expected: FAIL (module missing).

- [ ] **Step 3: Create `packages/dhis2/src/validate.ts`**

```ts
import type { TargetMetadata } from '@openldr/ports';
import type { AggregateMapping } from './types';

export function validateMapping(mapping: AggregateMapping, metadata: TargetMetadata): string[] {
  const des = new Set(metadata.dataElements.map((d) => d.id));
  const cocs = new Set(metadata.categoryOptionCombos.map((c) => c.id));
  const problems: string[] = [];
  for (const col of mapping.columns) {
    if (!des.has(col.dataElement)) problems.push(`unknown dataElement '${col.dataElement}' (column '${col.column}')`);
    if (col.categoryOptionCombo && !cocs.has(col.categoryOptionCombo)) {
      problems.push(`unknown categoryOptionCombo '${col.categoryOptionCombo}' (column '${col.column}')`);
    }
  }
  return problems;
}
```

- [ ] **Step 4: Export** — append to `packages/dhis2/src/index.ts`: `export * from './validate';`

- [ ] **Step 5: Run, verify pass** — `pnpm --filter @openldr/dhis2 test && pnpm --filter @openldr/dhis2 typecheck`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/dhis2/src/validate.ts packages/dhis2/src/validate.test.ts packages/dhis2/src/index.ts
git commit -m "feat(dhis2): validateMapping against pulled metadata (P2-DHIS2-2)"
```

---

## Task 6: `adapter-dhis2`

**Files:**
- Create: `packages/adapter-dhis2/package.json`
- Create: `packages/adapter-dhis2/tsconfig.json`
- Create: `packages/adapter-dhis2/src/index.ts`
- Create: `packages/adapter-dhis2/src/index.test.ts`

- [ ] **Step 1: Create `packages/adapter-dhis2/package.json`**

```json
{
  "name": "@openldr/adapter-dhis2",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run", "lint": "echo \"no lint\"" },
  "dependencies": { "@openldr/core": "workspace:*", "@openldr/ports": "workspace:*" },
  "devDependencies": { "@types/node": "^22.10.0", "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

- [ ] **Step 2: Create `packages/adapter-dhis2/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Run** `pnpm install`. Expected: resolves the new package.

- [ ] **Step 4: Write failing test** — `packages/adapter-dhis2/src/index.test.ts` (stubbed `fetch`, no live DHIS2):

```ts
import { describe, it, expect, vi } from 'vitest';
import { createDhis2Target } from './index';

const cfg = { baseUrl: 'https://dhis2.example/dhis', username: 'admin', password: 'district' };

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

describe('createDhis2Target', () => {
  it('healthCheck up when system/info returns 200', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ version: '2.40.3' }));
    const t = createDhis2Target(cfg, { fetch: fetchMock as unknown as typeof fetch });
    expect((await t.healthCheck()).status).toBe('up');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/system/info'), expect.objectContaining({ headers: expect.any(Object) }));
  });
  it('healthCheck down when fetch throws', async () => {
    const t = createDhis2Target(cfg, { fetch: (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch });
    const r = await t.healthCheck();
    expect(r.status).toBe('down');
    expect(r.detail).toContain('ECONNREFUSED');
  });
  it('pushAggregate parses the DHIS2 import summary', async () => {
    const summary = { status: 'SUCCESS', importCount: { imported: 3, updated: 1, ignored: 0, deleted: 0 }, conflicts: [] };
    const fetchMock = vi.fn(async () => jsonResponse(summary));
    const t = createDhis2Target(cfg, { fetch: fetchMock as unknown as typeof fetch });
    const r = await t.pushAggregate({ dataValues: [] });
    expect(r).toMatchObject({ status: 'success', imported: 3, updated: 1, ignored: 0, deleted: 0 });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/dataValueSets'), expect.objectContaining({ method: 'POST' }));
  });
  it('pullMetadata maps dataElements/orgUnits/coc', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('dataElements')) return jsonResponse({ dataElements: [{ id: 'DE1', name: 'd' }] });
      if (url.includes('organisationUnits')) return jsonResponse({ organisationUnits: [{ id: 'OU1', name: 'o' }] });
      return jsonResponse({ categoryOptionCombos: [{ id: 'COC1', name: 'c' }] });
    });
    const t = createDhis2Target(cfg, { fetch: fetchMock as unknown as typeof fetch });
    const m = await t.pullMetadata();
    expect(m.dataElements[0].id).toBe('DE1');
    expect(m.orgUnits[0].id).toBe('OU1');
    expect(m.categoryOptionCombos[0].id).toBe('COC1');
  });
});
```

- [ ] **Step 5: Run, verify fail** — `pnpm --filter @openldr/adapter-dhis2 test`. Expected: FAIL (module missing).

- [ ] **Step 6: Create `packages/adapter-dhis2/src/index.ts`**

```ts
import { probe } from '@openldr/core';
import type { ReportingTargetPort, TargetMetadata, PushResult } from '@openldr/ports';

export interface Dhis2Config {
  baseUrl: string;
  username: string;
  password: string;
}

export interface Dhis2Deps {
  fetch?: typeof fetch;
}

export interface Dhis2Target extends ReportingTargetPort {
  close(): Promise<void>;
}

interface ImportSummary {
  status?: string;
  importCount?: { imported?: number; updated?: number; ignored?: number; deleted?: number };
  response?: { importCount?: { imported?: number; updated?: number; ignored?: number; deleted?: number }; conflicts?: { object?: string; value?: string }[] };
  conflicts?: { object?: string; value?: string }[];
}

export function createDhis2Target(cfg: Dhis2Config, deps: Dhis2Deps = {}): Dhis2Target {
  const doFetch = deps.fetch ?? fetch;
  const base = cfg.baseUrl.replace(/\/$/, '');
  const auth = 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
  const headers = { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' };

  async function getJson<T>(path: string): Promise<T> {
    const res = await doFetch(`${base}${path}`, { headers });
    if (!res.ok) throw new Error(`DHIS2 ${path} -> ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    async healthCheck() {
      return probe(async () => { await getJson('/api/system/info.json'); });
    },
    async pullMetadata(): Promise<TargetMetadata> {
      const de = await getJson<{ dataElements?: { id: string; name: string }[] }>('/api/dataElements.json?fields=id,name&paging=false');
      const ou = await getJson<{ organisationUnits?: { id: string; name: string }[] }>('/api/organisationUnits.json?fields=id,name&paging=false');
      const coc = await getJson<{ categoryOptionCombos?: { id: string; name: string }[] }>('/api/categoryOptionCombos.json?fields=id,name&paging=false');
      return {
        dataElements: de.dataElements ?? [],
        orgUnits: ou.organisationUnits ?? [],
        categoryOptionCombos: coc.categoryOptionCombos ?? [],
      };
    },
    async pushAggregate(payload): Promise<PushResult> {
      const res = await doFetch(`${base}/api/dataValueSets.json`, { method: 'POST', headers, body: JSON.stringify(payload) });
      const body = (await res.json()) as ImportSummary;
      const ic = body.importCount ?? body.response?.importCount ?? {};
      const rawStatus = (body.status ?? '').toUpperCase();
      const status = rawStatus === 'SUCCESS' || rawStatus === 'OK' ? 'success' : rawStatus === 'WARNING' ? 'warning' : res.ok ? 'success' : 'error';
      const conflicts = (body.conflicts ?? body.response?.conflicts ?? []).map((c) => ({ object: c.object ?? '', value: c.value ?? '' }));
      return {
        status,
        imported: ic.imported ?? 0,
        updated: ic.updated ?? 0,
        ignored: ic.ignored ?? 0,
        deleted: ic.deleted ?? 0,
        conflicts,
        raw: body,
      };
    },
    async close() { /* fetch-based; nothing to close */ },
  };
}
```

- [ ] **Step 7: Run, verify pass** — `pnpm --filter @openldr/adapter-dhis2 test && pnpm --filter @openldr/adapter-dhis2 typecheck`. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/adapter-dhis2 pnpm-lock.yaml
git commit -m "feat(adapter-dhis2): ReportingTargetPort over the DHIS2 Web API (P2-DHIS2-1/8)"
```

---

## Task 7: Config — `REPORTING_TARGET_ADAPTER` + `DHIS2_*`

**Files:**
- Modify: `packages/config/src/schema.ts`
- Modify: `packages/config/src/load.test.ts`

- [ ] **Step 1: Append failing tests** to `packages/config/src/load.test.ts` (reuse the existing `basePg` fixture defined earlier in the file):

```ts
describe('config reporting-target (dhis2)', () => {
  it('defaults REPORTING_TARGET_ADAPTER to none', () => {
    expect(loadConfig({ ...basePg } as never).REPORTING_TARGET_ADAPTER).toBe('none');
  });
  it('accepts a dhis2 config', () => {
    const cfg = loadConfig({ ...basePg, REPORTING_TARGET_ADAPTER: 'dhis2', DHIS2_BASE_URL: 'https://dhis2.example/dhis', DHIS2_USERNAME: 'admin', DHIS2_PASSWORD: 'district' } as never);
    expect(cfg.REPORTING_TARGET_ADAPTER).toBe('dhis2');
  });
  it('rejects dhis2 without connection fields', () => {
    expect(() => loadConfig({ ...basePg, REPORTING_TARGET_ADAPTER: 'dhis2' } as never)).toThrow(/DHIS2_BASE_URL/);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @openldr/config test`. Expected: FAIL.

- [ ] **Step 3: Edit `packages/config/src/schema.ts`**:
  (a) Inside the `z.object({...})`, after the `TARGET_STORE_ADAPTER` line, add:
```ts
    REPORTING_TARGET_ADAPTER: z.enum(['none', 'dhis2']).default('none'),
```
  (b) After the MSSQL fields block, add:
```ts
    // DHIS2 reporting target (required when REPORTING_TARGET_ADAPTER=dhis2).
    DHIS2_BASE_URL: z.string().url().optional(),
    DHIS2_USERNAME: z.string().min(1).optional(),
    DHIS2_PASSWORD: z.string().min(1).optional(),
```
  (c) Inside the existing `.superRefine((cfg, ctx) => { ... })`, add (after the MSSQL/pg block):
```ts
    if (cfg.REPORTING_TARGET_ADAPTER === 'dhis2') {
      for (const key of ['DHIS2_BASE_URL', 'DHIS2_USERNAME', 'DHIS2_PASSWORD'] as const) {
        if (!cfg[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required when REPORTING_TARGET_ADAPTER=dhis2` });
      }
    }
```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @openldr/config test && pnpm --filter @openldr/config typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/config/src/schema.ts packages/config/src/load.test.ts
git commit -m "feat(config): REPORTING_TARGET_ADAPTER + DHIS2_* (P2-DHIS2-1)"
```

---

## Task 8: Bootstrap — `ctx.dhis2`

**Files:**
- Create: `packages/bootstrap/src/dhis2-context.ts`
- Modify: `packages/bootstrap/src/index.ts`
- Modify: `packages/bootstrap/package.json`

- [ ] **Step 1: Add deps** — in `packages/bootstrap/package.json` `dependencies`, add `"@openldr/adapter-dhis2": "workspace:*"` and `"@openldr/dhis2": "workspace:*"`. Run `pnpm install`.

- [ ] **Step 2: Create `packages/bootstrap/src/dhis2-context.ts`**

```ts
import { Kysely } from 'kysely';
import type { Config } from '@openldr/config';
import { createLogger, OpenLdrError } from '@openldr/core';
import { createInternalDb, createOrgUnitMapStore, createMappingStore, type InternalSchema } from '@openldr/db';
import { createDhis2Target, type Dhis2Target } from '@openldr/adapter-dhis2';
import { buildDataValueSet, validateMapping, dispatchReportSource, type AggregateMapping, type BuildOutput } from '@openldr/dhis2';
import { createAuditStore, safeRecord } from '@openldr/audit';
import type { ReportingTargetPort, TargetMetadata, PushResult } from '@openldr/ports';

export interface PushOutcome { dryRun: boolean; build: BuildOutput; result?: PushResult }

export interface Dhis2Context {
  target: ReportingTargetPort;
  orgUnits: ReturnType<typeof createOrgUnitMapStore>;
  mappings: ReturnType<typeof createMappingStore>;
  pullMetadata(): Promise<TargetMetadata>;
  validate(mappingId: string): Promise<string[]>;
  push(args: { mappingId: string; period: string; dryRun: boolean; runReport: (reportId: string, params?: Record<string, string>) => Promise<{ rows: Record<string, unknown>[] }> }): Promise<PushOutcome>;
  recentPushes(limit?: number): Promise<unknown[]>;
  close(): Promise<void>;
}

export function selectReportingTarget(cfg: Config): Dhis2Target {
  if (cfg.REPORTING_TARGET_ADAPTER !== 'dhis2') {
    throw new OpenLdrError('REPORTING_TARGET_ADAPTER is not dhis2; set it + DHIS2_* to use DHIS2');
  }
  return createDhis2Target({ baseUrl: cfg.DHIS2_BASE_URL!, username: cfg.DHIS2_USERNAME!, password: cfg.DHIS2_PASSWORD! });
}

export async function createDhis2Context(cfg: Config): Promise<Dhis2Context> {
  const logger = createLogger({ level: cfg.LOG_LEVEL });
  const internal = createInternalDb(cfg.INTERNAL_DATABASE_URL);
  const db = internal.db as unknown as Kysely<InternalSchema>;
  const orgUnits = createOrgUnitMapStore(db);
  const mappings = createMappingStore(db);
  const audit = createAuditStore(db);
  const target = selectReportingTarget(cfg);

  async function loadMapping(id: string): Promise<AggregateMapping> {
    const rec = await mappings.get(id);
    if (!rec) throw new OpenLdrError(`unknown mapping: ${id}`);
    return rec.definition as unknown as AggregateMapping;
  }

  return {
    target,
    orgUnits,
    mappings,
    pullMetadata: () => target.pullMetadata(),
    async validate(mappingId) {
      const mapping = await loadMapping(mappingId);
      const metadata = await target.pullMetadata();
      return validateMapping(mapping, metadata);
    },
    async push({ mappingId, period, dryRun, runReport }) {
      const mapping = await loadMapping(mappingId);
      const src = dispatchReportSource(mapping.source);
      const { rows } = await runReport(src.reportId, src.params);
      const orgMap = await orgUnits.getMap();
      const build = buildDataValueSet(rows, mapping, orgMap, period);
      if (dryRun) return { dryRun: true, build };
      try {
        const result = await target.pushAggregate(build.payload);
        await safeRecord(audit, logger, { actorType: 'system', actorName: 'system', action: 'dhis2.push', entityType: 'dhis2-mapping', entityId: mappingId, metadata: { target: cfg.DHIS2_BASE_URL, period, dataValues: build.payload.dataValues.length, skipped: build.skipped.length, status: result.status, imported: result.imported, updated: result.updated, ignored: result.ignored, conflicts: result.conflicts.length } });
        return { dryRun: false, build, result };
      } catch (err) {
        await safeRecord(audit, logger, { actorType: 'system', actorName: 'system', action: 'dhis2.push.failed', entityType: 'dhis2-mapping', entityId: mappingId, metadata: { target: cfg.DHIS2_BASE_URL, period, error: err instanceof Error ? err.message : String(err) } });
        throw err;
      }
    },
    async recentPushes(limit = 20) {
      return audit.list({ entityType: 'dhis2-mapping', limit });
    },
    async close() {
      await Promise.allSettled([internal.close(), target.close()]);
    },
  };
}
```

- [ ] **Step 3: Re-export** — append to `packages/bootstrap/src/index.ts`: `export * from './dhis2-context';`

- [ ] **Step 4: Typecheck + depcruise** — `pnpm --filter @openldr/bootstrap typecheck && pnpm --filter @openldr/bootstrap test && pnpm depcruise`. Expected: PASS (bootstrap may import `adapter-dhis2`; no other package may; if depcruise can't resolve the new packages, add aliases to `tsconfig.depcruise.json` mirroring existing `@openldr/*` entries — report any change).

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/dhis2-context.ts packages/bootstrap/src/index.ts packages/bootstrap/package.json pnpm-lock.yaml
git commit -m "feat(bootstrap): DHIS2 context (push/validate/pull) seam (P2-DHIS2-1/2/6)"
```

---

## Task 9: CLI — `dhis2`

**Files:**
- Create: `packages/cli/src/dhis2.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/package.json`

- [ ] **Step 1: Add deps** — ensure `packages/cli/package.json` `dependencies` has `"@openldr/dhis2": "workspace:*"` (for the AggregateMapping type). Run `pnpm install` if added.

- [ ] **Step 2: Create `packages/cli/src/dhis2.ts`**

```ts
import { readFileSync } from 'node:fs';
import { loadConfig } from '@openldr/config';
import { createDhis2Context, createAppContext } from '@openldr/bootstrap';
import { errorMessage } from '@openldr/core';
import type { AggregateMapping } from '@openldr/dhis2';

function out(json: boolean, obj: unknown, human: string): void {
  process.stdout.write((json ? JSON.stringify(obj, null, 2) : human) + '\n');
}

export async function runDhis2MapImport(file: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createDhis2Context(loadConfig());
  try {
    const m = JSON.parse(readFileSync(file, 'utf8')) as AggregateMapping;
    await ctx.mappings.upsert({ id: m.id, name: m.name, definition: m as unknown as Record<string, unknown> });
    out(opts.json, { id: m.id }, `imported mapping ${m.id}`);
    return 0;
  } catch (err) { process.stderr.write(`map import failed: ${errorMessage(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runDhis2MapList(opts: { json: boolean }): Promise<number> {
  const ctx = await createDhis2Context(loadConfig());
  try { const rows = await ctx.mappings.list(); out(opts.json, rows, rows.map((r) => `${r.id}  ${r.name}`).join('\n') || '(none)'); return 0; }
  finally { await ctx.close(); }
}

export async function runDhis2OrgUnitImport(file: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createDhis2Context(loadConfig());
  try {
    const entries = JSON.parse(readFileSync(file, 'utf8')) as { facilityId: string; orgUnitId: string; orgUnitName?: string }[];
    await ctx.orgUnits.upsert(entries.map((e) => ({ facilityId: e.facilityId, orgUnitId: e.orgUnitId, orgUnitName: e.orgUnitName ?? null })));
    out(opts.json, { count: entries.length }, `imported ${entries.length} orgUnit mappings`);
    return 0;
  } catch (err) { process.stderr.write(`orgunit import failed: ${errorMessage(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runDhis2OrgUnitList(opts: { json: boolean }): Promise<number> {
  const ctx = await createDhis2Context(loadConfig());
  try { const rows = await ctx.orgUnits.list(); out(opts.json, rows, rows.map((r) => `${r.facilityId} -> ${r.orgUnitId}`).join('\n') || '(none)'); return 0; }
  finally { await ctx.close(); }
}

export async function runDhis2PullMetadata(opts: { json: boolean }): Promise<number> {
  const ctx = await createDhis2Context(loadConfig());
  try {
    const m = await ctx.pullMetadata();
    out(opts.json, { dataElements: m.dataElements.length, orgUnits: m.orgUnits.length, categoryOptionCombos: m.categoryOptionCombos.length }, `dataElements=${m.dataElements.length} orgUnits=${m.orgUnits.length} coc=${m.categoryOptionCombos.length}`);
    return 0;
  } catch (err) { process.stderr.write(`pull-metadata failed: ${errorMessage(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runDhis2Validate(mappingId: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createDhis2Context(loadConfig());
  try {
    const problems = await ctx.validate(mappingId);
    out(opts.json, { problems }, problems.length ? problems.join('\n') : 'OK');
    return problems.length ? 1 : 0;
  } catch (err) { process.stderr.write(`validate failed: ${errorMessage(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runDhis2Push(mappingId: string, opts: { period: string; dryRun: boolean; json: boolean }): Promise<number> {
  const cfg = loadConfig();
  const app = await createAppContext(cfg);
  const ctx = await createDhis2Context(cfg);
  try {
    const outcome = await ctx.push({
      mappingId,
      period: opts.period,
      dryRun: opts.dryRun,
      runReport: async (reportId, params) => { const r = await app.reporting.run(reportId, params ?? {}); return { rows: r.rows }; },
    });
    if (outcome.dryRun) out(opts.json, { dryRun: true, payload: outcome.build.payload, skipped: outcome.build.skipped }, `DRY RUN: ${outcome.build.payload.dataValues.length} dataValues, ${outcome.build.skipped.length} skipped (not sent)`);
    else out(opts.json, { result: outcome.result, skipped: outcome.build.skipped.length }, `pushed: status=${outcome.result?.status} imported=${outcome.result?.imported} updated=${outcome.result?.updated} ignored=${outcome.result?.ignored}`);
    return outcome.dryRun ? 0 : outcome.result?.status === 'error' ? 1 : 0;
  } catch (err) { process.stderr.write(`push failed: ${errorMessage(err)}\n`); return 1; }
  finally { await ctx.close(); await app.close(); }
}

export async function runDhis2Status(opts: { json: boolean }): Promise<number> {
  const ctx = await createDhis2Context(loadConfig());
  try {
    const rows = await ctx.recentPushes(20) as { occurredAt: string; action: string; entityId: string; metadata?: Record<string, unknown> }[];
    out(opts.json, rows, rows.map((r) => `${r.occurredAt}  ${r.action}  ${r.entityId}  ${JSON.stringify(r.metadata ?? {})}`).join('\n') || '(no pushes)');
    return 0;
  } finally { await ctx.close(); }
}
```

- [ ] **Step 3: Register in `packages/cli/src/index.ts`** — add the import + command group (after the `terminology` group):

```ts
import { runDhis2MapImport, runDhis2MapList, runDhis2OrgUnitImport, runDhis2OrgUnitList, runDhis2PullMetadata, runDhis2Validate, runDhis2Push, runDhis2Status } from './dhis2';
```
```ts
const dhis2 = program.command('dhis2').description('DHIS2 aggregate reporting target');
const dmap = dhis2.command('map').description('Manage DHIS2 aggregate mappings');
dmap.command('import <file>').option('--json', 'emit JSON', false).action(async (file: string, o: { json: boolean }) => { process.exitCode = await runDhis2MapImport(file, o); });
dmap.command('list').option('--json', 'emit JSON', false).action(async (o: { json: boolean }) => { process.exitCode = await runDhis2MapList(o); });
const dou = dhis2.command('orgunit').description('Manage facility -> DHIS2 orgUnit mappings');
dou.command('import <file>').option('--json', 'emit JSON', false).action(async (file: string, o: { json: boolean }) => { process.exitCode = await runDhis2OrgUnitImport(file, o); });
dou.command('list').option('--json', 'emit JSON', false).action(async (o: { json: boolean }) => { process.exitCode = await runDhis2OrgUnitList(o); });
dhis2.command('pull-metadata').option('--json', 'emit JSON', false).action(async (o: { json: boolean }) => { process.exitCode = await runDhis2PullMetadata(o); });
dhis2.command('validate <mappingId>').option('--json', 'emit JSON', false).action(async (id: string, o: { json: boolean }) => { process.exitCode = await runDhis2Validate(id, o); });
dhis2.command('push <mappingId>').requiredOption('--period <p>', 'DHIS2 period, e.g. 2026Q1').option('--dry-run', 'preview payload without sending', false).option('--json', 'emit JSON', false)
  .action(async (id: string, o: { period: string; dryRun: boolean; json: boolean }) => { process.exitCode = await runDhis2Push(id, o); });
dhis2.command('status').option('--json', 'emit JSON', false).action(async (o: { json: boolean }) => { process.exitCode = await runDhis2Status(o); });
```

- [ ] **Step 4: Typecheck + build:check** — `pnpm --filter @openldr/cli typecheck && pnpm --filter @openldr/cli build:check`. Expected: PASS; `dhis2` appears in `node dist/index.js --help`.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/dhis2.ts packages/cli/src/index.ts packages/cli/package.json pnpm-lock.yaml
git commit -m "feat(cli): dhis2 map|orgunit|pull-metadata|validate|push|status (P2-DHIS2, PRD §3)"
```

---

## Task 10: Dev infra — `dhis2` docker-compose profile + seed + `.env`

**Files:**
- Create: `scripts/dhis2.conf`
- Create: `scripts/dhis2-seed.mjs`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: Create `scripts/dhis2.conf`** (DHIS2 reads this; db points at the compose `dhis2-db` service):

```properties
connection.dialect = org.hibernate.dialect.PostgreSQLDialect
connection.driver_class = org.postgresql.Driver
connection.url = jdbc:postgresql://dhis2-db:5432/dhis2
connection.username = dhis
connection.password = dhis
encryption.password = OpenLdrLocalDhis2EncryptionKey0
server.base.url = http://localhost:8085
```

- [ ] **Step 2: Create `scripts/dhis2-seed.mjs`**

```js
// Downloads the DHIS2 Sierra Leone demo DB dump (once) to ./.dhis2-seed/dump.sql.gz,
// which the dhis2-db compose service loads on first init.
import { mkdirSync, existsSync, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const URL = 'https://databases.dhis2.org/sierra-leone/2.40.3/dhis2-db-sierra-leone.sql.gz';
const dir = '.dhis2-seed';
const out = `${dir}/dump.sql.gz`;
if (existsSync(out)) { console.log(`[dhis2] seed already present at ${out}`); process.exit(0); }
mkdirSync(dir, { recursive: true });
console.log(`[dhis2] downloading ${URL} ...`);
const res = await fetch(URL);
if (!res.ok || !res.body) { console.error(`[dhis2] download failed: ${res.status}`); process.exit(1); }
await pipeline(Readable.fromWeb(res.body), createWriteStream(out));
console.log(`[dhis2] seed written to ${out}`);
```

- [ ] **Step 3: Add the `dhis2` profile to `docker-compose.yml`** (append under `services:`, after the `mssql` service):

```yaml
  # Optional DHIS2 aggregate reporting target. Off by default; start with:
  #   pnpm dhis2:seed   (downloads the SL demo dump once)
  #   docker compose --profile dhis2 up -d
  dhis2-db:
    image: postgis/postgis:14-3.3
    profiles: ['dhis2']
    environment:
      POSTGRES_USER: dhis
      POSTGRES_PASSWORD: dhis
      POSTGRES_DB: dhis2
    volumes:
      - ./.dhis2-seed/dump.sql.gz:/docker-entrypoint-initdb.d/10-dhis2.sql.gz:ro
  dhis2-web:
    image: dhis2/core:2.40.3
    profiles: ['dhis2']
    depends_on: [dhis2-db]
    environment:
      DHIS2_HOME: /opt/dhis2
    volumes:
      - ./scripts/dhis2.conf:/opt/dhis2/dhis.conf:ro
    ports:
      - '8085:8080'
```

- [ ] **Step 4: Root `package.json`** — add to `scripts`: `"dhis2:seed": "node scripts/dhis2-seed.mjs"`.

- [ ] **Step 5: `.gitignore`** — append `.dhis2-seed/`.

- [ ] **Step 6: `.env.example`** — append:

```bash

# --- DHIS2 reporting target ---
# none (default) or dhis2. Start a local DHIS2: pnpm dhis2:seed && docker compose --profile dhis2 up -d
REPORTING_TARGET_ADAPTER=none
# DHIS2_BASE_URL=http://localhost:8085
# DHIS2_USERNAME=admin
# DHIS2_PASSWORD=district
```

- [ ] **Step 7: Validate compose** — `docker compose config --profile dhis2 --services | sort`. Expected: includes `dhis2-db` + `dhis2-web` (plus existing services). (The seed gzip need not exist for `config` to parse; if compose errors because the bind mount path is missing, run `mkdir -p .dhis2-seed && touch .dhis2-seed/dump.sql.gz` first or accept that validation runs after `pnpm dhis2:seed`.)

- [ ] **Step 8: Commit**

```bash
git add scripts/dhis2.conf scripts/dhis2-seed.mjs docker-compose.yml .env.example .gitignore package.json
git commit -m "chore: optional dhis2 docker-compose profile + SL seed script (P2-DHIS2)"
```

---

## Task 11: Live acceptance (Dockerized DHIS2) + memory + finish

**Files:** none (verification + memory). Internal Postgres (dev stack) + Docker must be up.

- [ ] **Step 1: Migrate + boot DHIS2**

```bash
pnpm openldr db migrate                       # applies 008_dhis2
pnpm dhis2:seed                               # downloads the SL demo dump (~85MB, once)
docker compose --profile dhis2 up -d          # postgis loads the dump (minutes), then dhis2-web boots (minutes)
```
Wait until `curl -s -u admin:district http://localhost:8085/api/system/info.json` returns JSON (first boot loads + upgrades the demo db — several minutes). Set `.env`: `REPORTING_TARGET_ADAPTER=dhis2`, `DHIS2_BASE_URL=http://localhost:8085`, `DHIS2_USERNAME=admin`, `DHIS2_PASSWORD=district`.

- [ ] **Step 2: Pull metadata**

Run: `pnpm openldr dhis2 pull-metadata --json`
Expected: non-zero dataElements/orgUnits/categoryOptionCombos counts (SL demo has hundreds).

- [ ] **Step 3: Import an orgUnit map + a mapping** — using REAL SL ids (from pull-metadata or `curl .../api/organisationUnits.json` + `.../api/dataElements.json`). Create `orgunit.json` mapping a CE facility id to a real SL orgUnit uid, and `mapping.json` (an `AggregateMapping` whose `source` is `{kind:'report', reportId:'amr-resistance'}`, with `orgUnitColumn` + `columns` mapping report columns to real SL dataElement uids). Then:
```bash
pnpm openldr dhis2 orgunit import orgunit.json
pnpm openldr dhis2 map import mapping.json
```
**NOTE (carry-forward):** `amr-resistance` groups by antibiotic, NOT facility — its rows do not carry a facility column, so a per-orgUnit push needs a source whose rows expose `orgUnitColumn`. For the demo, either (a) add a small purpose-built report/mapping whose rows include a facility column, or (b) accept that all rows map to a single configured orgUnit (set `orgUnitColumn` to a column you inject, or extend the demo). Document the exact mapping used. The acceptance focus is the engine + dry-run + a representative real push.

- [ ] **Step 4: Validate**

Run: `pnpm openldr dhis2 validate <mappingId> --json`
Expected: `problems: []`. If problems, fix the mapping's ids to real SL ones.

- [ ] **Step 5: Dry-run**

Run: `pnpm openldr dhis2 push <mappingId> --period 2026Q1 --dry-run --json`
Expected: a `dataValueSets` payload preview with `dataValues[]` (and any `skipped`), nothing sent.

- [ ] **Step 6: Real push + audit + idempotency**

```bash
pnpm openldr dhis2 push <mappingId> --period 2026Q1 --json
pnpm openldr dhis2 push <mappingId> --period 2026Q1 --json   # again
pnpm openldr dhis2 status --json
```
Expected: first push `imported`/`updated` > 0 (status success/warning); second push shows `updated` (not duplicate `imported`) — idempotent (P2-NFR-2); `status` lists the audited `dhis2.push` events.

- [ ] **Step 7: Full gates**

Run: `pnpm typecheck && pnpm test && pnpm depcruise && pnpm build:check`
Expected: all PASS. `pnpm test` stays stack-free (mapping/adapter unit tests use in-memory/stub data; the stores + live push are acceptance-only).

- [ ] **Step 8: Update build-plan memory** — record Phase-2 sub-project 3 (DHIS2 Slice A) done, the acceptance result, and carry-forwards (aggregate-only; tracker/scheduling → Slice B; UI → Slice C; report-source must expose an orgUnit column; DHIS2 boot is heavy). File: `C:\Users\Fredrick\.claude\projects\D--Projects-Repositories-openldr-ce\memory\openldr-ce-build-plan.md`.

- [ ] **Step 9: Finish the branch** — use superpowers:finishing-a-development-branch (merge to `main`).

---

## Self-review notes (author)

- **Spec coverage:** §3 port → T1; §4 adapter → T6; §5 mapping engine → T4-5; §6 storage → T2-3; §7 push/dry-run/audit → T8 (+T9 CLI); §8 CLI → T9; §9 config+infra → T7+T10; §10 acceptance → T11. P2-DHIS2-1 (T1/6/7/8), -2 (T4/5), -3 (T2/3), -6 (T8), -8 (T6), dry-run (T8/9).
- **No placeholders:** every file has full content; run steps have expected results. T11 step 3 flags the report-must-expose-orgUnit-column reality + how to handle it for the demo.
- **Type/name consistency:** `ReportingTargetPort`/`TargetMetadata`/`PushResult` (ports) used by adapter + dhis2 + bootstrap; `AggregateMapping`/`MappingSource`/`ColumnMapping`/`DataValueSet`/`BuildOutput`/`buildDataValueSet`/`dispatchReportSource`/`validateMapping` (`@openldr/dhis2`); `OrgUnitMapStore`/`MappingStore`/`createOrgUnitMapStore`/`createMappingStore` (`@openldr/db`); `createDhis2Target`/`Dhis2Config`/`Dhis2Deps` (adapter); `createDhis2Context`/`selectReportingTarget` (bootstrap); `runDhis2*` (CLI). Config `REPORTING_TARGET_ADAPTER` + `DHIS2_*`. Consistent across tasks.
- **Carry-forward (for build-plan):** report sources must expose an orgUnit column for per-facility pushes; tracker mode, scheduled/event-driven push, and the authoring UI are deferred to Slices B/C.
