# Terminology Service (Slice A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A headless FHIR terminology service — store CodeSystem/ValueSet/ConceptMap, run $lookup/$validate-code/$expand/$translate, and load real LOINC + WHONET-derived AMR terminology — exposed via CLI and a FHIR-style HTTP API.

**Architecture:** Canonical CodeSystem/ValueSet/ConceptMap live in `fhir_resources` (jsonb) via `FhirStore`; a denormalized `terminology_concepts` index + `concept_map_elements` table (internal Postgres) back fast operations. A new `@openldr/terminology` domain package holds the 4 operations (over a `ConceptSource` seam, unit-testable in-memory) + loaders. `@openldr/db` owns the schema + `TerminologyStore` (which implements `ConceptSource`). Bootstrap wires `ctx.terminology`; CLI + `apps/server` consume it.

**Tech Stack:** TypeScript ESM, zod (FHIR schemas), Kysely 0.27 (internal Postgres), `csv-parse` (LOINC), `node:sqlite` (WHONET), commander (CLI), Fastify (HTTP), vitest.

---

## Key facts (verified in the codebase / probes)

- FHIR resource pattern (`packages/fhir/src/resources/organization.ts`): `export const X = z.object({ resourceType: z.literal('X'), ... }).passthrough(); registerResource('X', X);` then add to `resources/index.ts`. Datatypes `Coding`, `CodeableConcept` exist in `datatypes/complex.ts`; primitives `fhirId` etc. in `datatypes/primitives.ts`.
- Internal migration pattern (`migrations/internal/006_users.ts`): `db.schema.createTable('t').ifNotExists().addColumn(...).execute()`; register in `migrations/internal/index.ts`; add the table interface to `schema/internal.ts` and to the `InternalSchema` aggregate (lines 81-88).
- Domain package pattern (`@openldr/audit`): deps `{ @openldr/core, @openldr/db, kysely }`; store `createXStore(db: Kysely<InternalSchema>)`.
- CLI module pattern (`packages/cli/src/audit.ts`): `export async function runX(opts): Promise<number>` using `createAppContext(loadConfig())`, `--json`, `finally ctx.close()`; registered in `packages/cli/src/index.ts`.
- HTTP route pattern (`apps/server/src/reports-routes.ts`): `registerReportRoutes(app, ctx)`; `.csv`-style specific routes registered before generic; error map 404/400/503/500. Registered in `apps/server/src/app.ts` before the SPA fallback.
- Bootstrap (`packages/bootstrap/src/index.ts`): `createAppContext` builds an internal db (`createInternalDb`) and exposes stores (`ctx.audit`, `ctx.users`, `ctx.reporting`); add `ctx.terminology` the same way.
- LOINC probe proven: streaming `csv-parse` + 1000-row batched inserts load 109,325 concepts in ~4.4 s; `(system, code)` index → ~2 ms lookups. WHONET `ASIARS-Net.sqlite` has `Antibiotics_ForwardLookup(WHONET_Code, ASIARS_Net_Code)` + `Antibiotics_ReverseLookup(ASIARS_Net_Code, WHONET_Code=name)` and `Organisms_*` likewise.

---

## Task 1: FHIR terminology resources (P2-TERM-1)

**Files:**
- Create: `packages/fhir/src/resources/code-system.ts`
- Create: `packages/fhir/src/resources/value-set.ts`
- Create: `packages/fhir/src/resources/concept-map.ts`
- Modify: `packages/fhir/src/resources/index.ts`
- Create: `packages/fhir/src/resources/terminology.test.ts`

- [ ] **Step 1: Write failing test** — `packages/fhir/src/resources/terminology.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateResource } from '../validate';

describe('terminology resources', () => {
  it('validates a CodeSystem', () => {
    const r = validateResource({ resourceType: 'CodeSystem', url: 'http://x/cs', status: 'active', content: 'complete', concept: [{ code: 'a', display: 'A' }] });
    expect(r.ok).toBe(true);
  });
  it('validates a ValueSet with compose + expansion', () => {
    const r = validateResource({ resourceType: 'ValueSet', url: 'http://x/vs', status: 'active', compose: { include: [{ system: 'http://x/cs', concept: [{ code: 'a' }] }] } });
    expect(r.ok).toBe(true);
  });
  it('validates a ConceptMap', () => {
    const r = validateResource({ resourceType: 'ConceptMap', url: 'http://x/cm', status: 'active', group: [{ source: 'http://x/cs', target: 'http://loinc.org', element: [{ code: 'a', target: [{ code: '1', equivalence: 'equivalent' }] }] }] });
    expect(r.ok).toBe(true);
  });
  it('rejects a CodeSystem missing status', () => {
    expect(validateResource({ resourceType: 'CodeSystem', url: 'http://x/cs', content: 'complete' }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @openldr/fhir test -- terminology`
Expected: FAIL (CodeSystem/ValueSet/ConceptMap not registered).

- [ ] **Step 3: Create `packages/fhir/src/resources/code-system.ts`**

```ts
import { z } from 'zod';
import { fhirId } from '../datatypes/primitives';
import { Meta } from '../datatypes/complex';
import { registerResource } from '../registry';

const ConceptProperty = z.object({ code: z.string(), valueString: z.string().optional(), valueCode: z.string().optional() }).passthrough();
const Concept = z.object({ code: z.string(), display: z.string().optional(), property: z.array(ConceptProperty).optional() }).passthrough();

export const CodeSystem = z
  .object({
    resourceType: z.literal('CodeSystem'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    url: z.string(),
    version: z.string().optional(),
    name: z.string().optional(),
    status: z.string(),
    content: z.enum(['not-present', 'example', 'fragment', 'complete', 'supplement']),
    concept: z.array(Concept).optional(),
  })
  .passthrough();
export type CodeSystem = z.infer<typeof CodeSystem>;

registerResource('CodeSystem', CodeSystem);
```

- [ ] **Step 4: Create `packages/fhir/src/resources/value-set.ts`**

```ts
import { z } from 'zod';
import { fhirId } from '../datatypes/primitives';
import { Meta } from '../datatypes/complex';
import { registerResource } from '../registry';

const Filter = z.object({ property: z.string(), op: z.string(), value: z.string() }).passthrough();
const IncludeConcept = z.object({ code: z.string(), display: z.string().optional() }).passthrough();
const ComposeRule = z.object({ system: z.string().optional(), concept: z.array(IncludeConcept).optional(), filter: z.array(Filter).optional() }).passthrough();
const Contains = z.object({ system: z.string().optional(), code: z.string().optional(), display: z.string().optional() }).passthrough();

export const ValueSet = z
  .object({
    resourceType: z.literal('ValueSet'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    url: z.string(),
    version: z.string().optional(),
    name: z.string().optional(),
    status: z.string(),
    compose: z.object({ include: z.array(ComposeRule), exclude: z.array(ComposeRule).optional() }).optional(),
    expansion: z.object({ total: z.number().optional(), offset: z.number().optional(), contains: z.array(Contains).optional() }).optional(),
  })
  .passthrough();
export type ValueSet = z.infer<typeof ValueSet>;

registerResource('ValueSet', ValueSet);
```

- [ ] **Step 5: Create `packages/fhir/src/resources/concept-map.ts`**

```ts
import { z } from 'zod';
import { fhirId } from '../datatypes/primitives';
import { Meta } from '../datatypes/complex';
import { registerResource } from '../registry';

const Target = z.object({ code: z.string(), display: z.string().optional(), equivalence: z.string().optional() }).passthrough();
const Element = z.object({ code: z.string(), display: z.string().optional(), target: z.array(Target).optional() }).passthrough();
const Group = z.object({ source: z.string().optional(), target: z.string().optional(), element: z.array(Element) }).passthrough();

export const ConceptMap = z
  .object({
    resourceType: z.literal('ConceptMap'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    url: z.string(),
    version: z.string().optional(),
    name: z.string().optional(),
    status: z.string(),
    sourceUri: z.string().optional(),
    targetUri: z.string().optional(),
    group: z.array(Group).optional(),
  })
  .passthrough();
export type ConceptMap = z.infer<typeof ConceptMap>;

registerResource('ConceptMap', ConceptMap);
```

- [ ] **Step 6: Register in `packages/fhir/src/resources/index.ts`** — append:

```ts
export * from './code-system';
export * from './value-set';
export * from './concept-map';
```

- [ ] **Step 7: Run, verify pass**

Run: `pnpm --filter @openldr/fhir test && pnpm --filter @openldr/fhir typecheck`
Expected: PASS. (If `Meta` is not exported from `datatypes/complex`, check the actual export name in that file and use it; `Meta` is used by `organization.ts` so it exists.)

- [ ] **Step 8: Commit**

```bash
git add packages/fhir/src/resources/code-system.ts packages/fhir/src/resources/value-set.ts packages/fhir/src/resources/concept-map.ts packages/fhir/src/resources/index.ts packages/fhir/src/resources/terminology.test.ts
git commit -m "feat(fhir): CodeSystem/ValueSet/ConceptMap resources (P2-TERM-1)"
```

---

## Task 2: Internal migration `007_terminology` + schema

**Files:**
- Create: `packages/db/src/migrations/internal/007_terminology.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/schema/internal.ts`
- Modify: `packages/db/src/migrations/migrations.test.ts`

- [ ] **Step 1: Create `packages/db/src/migrations/internal/007_terminology.ts`**

```ts
import { type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('terminology_concepts')
    .ifNotExists()
    .addColumn('system', 'text', (c) => c.notNull())
    .addColumn('code', 'text', (c) => c.notNull())
    .addColumn('display', 'text')
    .addColumn('status', 'text')
    .addColumn('properties', 'jsonb')
    .addPrimaryKeyConstraint('terminology_concepts_pk', ['system', 'code'])
    .execute();

  await db.schema
    .createTable('terminology_systems')
    .ifNotExists()
    .addColumn('url', 'text', (c) => c.primaryKey())
    .addColumn('version', 'text')
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('resource_id', 'text', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('concept_map_elements')
    .ifNotExists()
    .addColumn('map_url', 'text', (c) => c.notNull())
    .addColumn('source_system', 'text', (c) => c.notNull())
    .addColumn('source_code', 'text', (c) => c.notNull())
    .addColumn('target_system', 'text', (c) => c.notNull())
    .addColumn('target_code', 'text', (c) => c.notNull())
    .addColumn('equivalence', 'text')
    .execute();
  await db.schema
    .createIndex('concept_map_elements_lookup')
    .ifNotExists()
    .on('concept_map_elements')
    .columns(['map_url', 'source_system', 'source_code'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('concept_map_elements').ifExists().execute();
  await db.schema.dropTable('terminology_systems').ifExists().execute();
  await db.schema.dropTable('terminology_concepts').ifExists().execute();
}
```

- [ ] **Step 2: Register in `packages/db/src/migrations/internal/index.ts`** — add the import and entry:

```ts
import * as m007 from './007_terminology';
```
and add to the `internalMigrations` object (after `'006_users'`):
```ts
  '007_terminology': { up: m007.up, down: m007.down },
```

- [ ] **Step 3: Add table interfaces to `packages/db/src/schema/internal.ts`** — add before the `InternalSchema` interface:

```ts
export interface TerminologyConceptsTable {
  system: string;
  code: string;
  display: string | null;
  status: string | null;
  properties: JSONColumnType<Record<string, unknown>> | null;
}

export interface TerminologySystemsTable {
  url: string;
  version: string | null;
  kind: string;
  resource_id: string;
}

export interface ConceptMapElementsTable {
  map_url: string;
  source_system: string;
  source_code: string;
  target_system: string;
  target_code: string;
  equivalence: string | null;
}
```
and add to the `InternalSchema` interface body:
```ts
  terminology_concepts: TerminologyConceptsTable;
  terminology_systems: TerminologySystemsTable;
  concept_map_elements: ConceptMapElementsTable;
```

- [ ] **Step 4: Update `packages/db/src/migrations/migrations.test.ts`** — the internal-migrations test asserts the key list. Change the expected `Object.keys(internalMigrations)` array to include `'007_terminology'` at the end:

```ts
    expect(Object.keys(internalMigrations)).toEqual(['001_fhir_resources', '002_outbox', '003_ingest_batches', '004_plugins', '005_audit_events', '006_users', '007_terminology']);
```

- [ ] **Step 5: Run**

Run: `pnpm --filter @openldr/db test && pnpm --filter @openldr/db typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/migrations/internal/007_terminology.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts packages/db/src/migrations/migrations.test.ts
git commit -m "feat(db): 007_terminology internal migration + schema (P2-TERM-1)"
```

---

## Task 3: `TerminologyStore` (@openldr/db)

**Files:**
- Create: `packages/db/src/terminology-store.ts`
- Modify: `packages/db/src/index.ts`

The store is the only SQL surface; it is verified by typecheck + the live acceptance (Task 11), consistent with how `FhirStore`/`FlatWriter` SQL is handled (no live-DB unit test).

- [ ] **Step 1: Create `packages/db/src/terminology-store.ts`**

```ts
import { type Kysely, sql } from 'kysely';
import type { FhirResource } from '@openldr/fhir';
import type { InternalSchema } from './schema/internal';
import type { FhirStore } from './fhir-store';

export interface ConceptRecord {
  system: string;
  code: string;
  display: string | null;
  status: string | null;
  properties: Record<string, unknown> | null;
}

export interface ConceptQuery {
  system: string;
  codes?: string[];
  property?: { name: string; value: string };
  limit?: number;
  offset?: number;
}

export interface MapElement {
  mapUrl: string;
  sourceSystem: string;
  sourceCode: string;
  targetSystem: string;
  targetCode: string;
  equivalence: string | null;
}

export interface TranslateQuery {
  mapUrl?: string;
  system: string;
  code: string;
  targetSystem?: string;
}

export interface TerminologyStore {
  upsertConcepts(rows: ConceptRecord[]): Promise<void>;
  getConcept(system: string, code: string): Promise<ConceptRecord | null>;
  findConcepts(q: ConceptQuery): Promise<ConceptRecord[]>;
  countConcepts(q: Omit<ConceptQuery, 'limit' | 'offset'>): Promise<number>;
  saveSystem(url: string, version: string | null, kind: string, resourceId: string): Promise<void>;
  getResourceByUrl(url: string): Promise<FhirResource | null>;
  upsertMapElements(rows: MapElement[]): Promise<void>;
  translate(q: TranslateQuery): Promise<MapElement[]>;
}

export function createTerminologyStore(db: Kysely<InternalSchema>, fhirStore: FhirStore): TerminologyStore {
  function applyConceptFilter<T>(qb: T, q: ConceptQuery | Omit<ConceptQuery, 'limit' | 'offset'>): T {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let b = qb as any;
    b = b.where('system', '=', q.system);
    if (q.codes) b = b.where('code', 'in', q.codes);
    if (q.property) b = b.where(sql`properties->>${q.property.name}`, '=', q.property.value);
    return b as T;
  }

  return {
    async upsertConcepts(rows) {
      if (rows.length === 0) return;
      const values = rows.map((r) => ({
        system: r.system,
        code: r.code,
        display: r.display,
        status: r.status,
        properties: r.properties === null ? null : JSON.stringify(r.properties),
      }));
      await db
        .insertInto('terminology_concepts')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values(values as any)
        .onConflict((oc) =>
          oc.columns(['system', 'code']).doUpdateSet((eb) => ({
            display: eb.ref('excluded.display'),
            status: eb.ref('excluded.status'),
            properties: eb.ref('excluded.properties'),
          })),
        )
        .execute();
    },
    async getConcept(system, code) {
      const row = await db
        .selectFrom('terminology_concepts')
        .selectAll()
        .where('system', '=', system)
        .where('code', '=', code)
        .executeTakeFirst();
      return row ? ({ ...row, properties: (row.properties as Record<string, unknown> | null) }) : null;
    },
    async findConcepts(q) {
      let qb = db.selectFrom('terminology_concepts').selectAll();
      qb = applyConceptFilter(qb, q);
      qb = qb.orderBy('code').limit(q.limit ?? 100).offset(q.offset ?? 0);
      const rows = await qb.execute();
      return rows.map((r) => ({ ...r, properties: r.properties as Record<string, unknown> | null }));
    },
    async countConcepts(q) {
      let qb = db.selectFrom('terminology_concepts').select((eb) => eb.fn.countAll<number>().as('n'));
      qb = applyConceptFilter(qb, q);
      const row = await qb.executeTakeFirst();
      return Number(row?.n ?? 0);
    },
    async saveSystem(url, version, kind, resourceId) {
      await db
        .insertInto('terminology_systems')
        .values({ url, version, kind, resource_id: resourceId })
        .onConflict((oc) => oc.column('url').doUpdateSet({ version, kind, resource_id: resourceId }))
        .execute();
    },
    async getResourceByUrl(url) {
      const sys = await db.selectFrom('terminology_systems').select(['kind', 'resource_id']).where('url', '=', url).executeTakeFirst();
      if (!sys) return null;
      return fhirStore.get(sys.kind, sys.resource_id);
    },
    async upsertMapElements(rows) {
      if (rows.length === 0) return;
      await db
        .insertInto('concept_map_elements')
        .values(rows.map((r) => ({ map_url: r.mapUrl, source_system: r.sourceSystem, source_code: r.sourceCode, target_system: r.targetSystem, target_code: r.targetCode, equivalence: r.equivalence })))
        .execute();
    },
    async translate(q) {
      let qb = db.selectFrom('concept_map_elements').selectAll().where('source_system', '=', q.system).where('source_code', '=', q.code);
      if (q.mapUrl) qb = qb.where('map_url', '=', q.mapUrl);
      if (q.targetSystem) qb = qb.where('target_system', '=', q.targetSystem);
      const rows = await qb.execute();
      return rows.map((r) => ({ mapUrl: r.map_url, sourceSystem: r.source_system, sourceCode: r.source_code, targetSystem: r.target_system, targetCode: r.target_code, equivalence: r.equivalence }));
    },
  };
}
```

- [ ] **Step 2: Export from `packages/db/src/index.ts`** — append:

```ts
export * from './terminology-store';
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @openldr/db typecheck`
Expected: PASS. If the `excluded.*` refs or `sql\`properties->>...\`` upset Kysely's types, keep the `as any` casts shown (the store's SQL correctness is validated by the live acceptance in Task 11).

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/terminology-store.ts packages/db/src/index.ts
git commit -m "feat(db): TerminologyStore over the concept index (P2-TERM-1)"
```

---

## Task 4: `@openldr/terminology` scaffold + `ConceptSource` + lookup/validate-code (CodeSystem mode)

**Files:**
- Create: `packages/terminology/package.json`
- Create: `packages/terminology/tsconfig.json`
- Create: `packages/terminology/src/source.ts`
- Create: `packages/terminology/src/operations.ts`
- Create: `packages/terminology/src/index.ts`
- Create: `packages/terminology/src/operations.test.ts`
- (`pnpm-workspace.yaml` already globs `packages/*` — no change.)

- [ ] **Step 1: Create `packages/terminology/package.json`**

```json
{
  "name": "@openldr/terminology",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run", "lint": "echo \"no lint\"" },
  "dependencies": {
    "@openldr/core": "workspace:*",
    "@openldr/db": "workspace:*",
    "@openldr/fhir": "workspace:*",
    "csv-parse": "^5.6.0"
  },
  "devDependencies": { "@types/node": "^22.10.0", "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

- [ ] **Step 2: Create `packages/terminology/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `packages/terminology/src/source.ts`** — the seam the ops read (the `TerminologyStore` from @openldr/db satisfies it; an in-memory fake backs tests):

```ts
import type { ConceptRecord, ConceptQuery, MapElement, TranslateQuery } from '@openldr/db';
import type { ValueSet } from '@openldr/fhir';

export interface ConceptSource {
  getConcept(system: string, code: string): Promise<ConceptRecord | null>;
  findConcepts(q: ConceptQuery): Promise<ConceptRecord[]>;
  countConcepts(q: Omit<ConceptQuery, 'limit' | 'offset'>): Promise<number>;
  getResourceByUrl(url: string): Promise<unknown | null>;
  translate(q: TranslateQuery): Promise<MapElement[]>;
}

export function valueSetOf(resource: unknown): ValueSet | null {
  const r = resource as { resourceType?: string } | null;
  return r && r.resourceType === 'ValueSet' ? (r as ValueSet) : null;
}
```

- [ ] **Step 4: Write failing test** — `packages/terminology/src/operations.test.ts` (lookup + validate-code CodeSystem mode for now):

```ts
import { describe, it, expect } from 'vitest';
import { createOperations } from './operations';
import type { ConceptSource } from './source';
import type { ConceptRecord } from '@openldr/db';

function memSource(concepts: ConceptRecord[], resources: Record<string, unknown> = {}): ConceptSource {
  const has = (system: string, code: string) => concepts.find((c) => c.system === system && c.code === code) ?? null;
  return {
    async getConcept(s, c) { return has(s, c); },
    async findConcepts(q) {
      let rows = concepts.filter((c) => c.system === q.system);
      if (q.codes) rows = rows.filter((c) => q.codes!.includes(c.code));
      if (q.property) rows = rows.filter((c) => (c.properties as Record<string, unknown> | null)?.[q.property!.name] === q.property!.value);
      return rows.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 100));
    },
    async countConcepts(q) {
      let rows = concepts.filter((c) => c.system === q.system);
      if (q.codes) rows = rows.filter((c) => q.codes!.includes(c.code));
      return rows.length;
    },
    async getResourceByUrl(url) { return resources[url] ?? null; },
    async translate() { return []; },
  };
}

const loinc: ConceptRecord[] = [{ system: 'http://loinc.org', code: '2160-0', display: 'Creatinine', status: 'ACTIVE', properties: { CLASS: 'CHEM' } }];

describe('lookup', () => {
  const ops = createOperations(memSource(loinc));
  it('finds a concept', async () => {
    const r = await ops.lookup('http://loinc.org', '2160-0');
    expect(r.found).toBe(true);
    expect(r.display).toBe('Creatinine');
  });
  it('misses unknown', async () => {
    expect((await ops.lookup('http://loinc.org', 'nope')).found).toBe(false);
  });
});

describe('validateCode (CodeSystem)', () => {
  const ops = createOperations(memSource(loinc));
  it('true for an existing code', async () => {
    expect((await ops.validateCode({ system: 'http://loinc.org', code: '2160-0' })).result).toBe(true);
  });
  it('false for a missing code', async () => {
    expect((await ops.validateCode({ system: 'http://loinc.org', code: 'x' })).result).toBe(false);
  });
});
```

- [ ] **Step 5: Run, verify fail**

Run: `pnpm install` (so the new package resolves), then `pnpm --filter @openldr/terminology test`
Expected: FAIL (module './operations' missing).

- [ ] **Step 6: Create `packages/terminology/src/operations.ts`** (lookup + validateCode CodeSystem mode now; expand/translate added in later tasks):

```ts
import type { ConceptSource } from './source';

export interface LookupResult { found: boolean; system: string; code: string; display: string | null; properties: Record<string, unknown> | null }
export interface ValidateResult { result: boolean; message: string }

export interface Operations {
  lookup(system: string, code: string): Promise<LookupResult>;
  validateCode(input: { system: string; code: string } | { valueSetUrl: string; code: string; system?: string }): Promise<ValidateResult>;
}

export function createOperations(source: ConceptSource): Operations {
  return {
    async lookup(system, code) {
      const c = await source.getConcept(system, code);
      return c ? { found: true, system, code, display: c.display, properties: c.properties } : { found: false, system, code, display: null, properties: null };
    },
    async validateCode(input) {
      if ('system' in input && !('valueSetUrl' in input)) {
        const c = await source.getConcept(input.system, input.code);
        return c ? { result: true, message: `${input.code} is in ${input.system}` } : { result: false, message: `${input.code} not found in ${input.system}` };
      }
      // ValueSet mode implemented in the expand task.
      throw new Error('validateCode ValueSet mode not yet implemented');
    },
  };
}
```

- [ ] **Step 7: Create `packages/terminology/src/index.ts`**

```ts
export * from './source';
export * from './operations';
```

- [ ] **Step 8: Run, verify pass**

Run: `pnpm --filter @openldr/terminology test && pnpm --filter @openldr/terminology typecheck`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add packages/terminology pnpm-lock.yaml
git commit -m "feat(terminology): package + lookup/validate-code CodeSystem mode (P2-TERM-2)"
```

---

## Task 5: `expand` + validate-code ValueSet mode

**Files:**
- Modify: `packages/terminology/src/operations.ts`
- Modify: `packages/terminology/src/operations.test.ts`

- [ ] **Step 1: Append failing tests** to `operations.test.ts`:

```ts
import type { ValueSet } from '@openldr/fhir';

const abx: ConceptRecord[] = [
  { system: 'http://whonet.org/fhir/CodeSystem/antibiotic', code: 'AMP', display: 'Ampicillin', status: null, properties: null },
  { system: 'http://whonet.org/fhir/CodeSystem/antibiotic', code: 'CIP', display: 'Ciprofloxacin', status: null, properties: null },
  { system: 'http://whonet.org/fhir/CodeSystem/antibiotic', code: 'GEN', display: 'Gentamicin', status: null, properties: null },
];
const abxVs: ValueSet = { resourceType: 'ValueSet', url: 'http://whonet.org/fhir/ValueSet/antibiotics', status: 'active', compose: { include: [{ system: 'http://whonet.org/fhir/CodeSystem/antibiotic' }] } };

describe('expand', () => {
  const ops = createOperations(memSource(abx, { [abxVs.url]: abxVs }));
  it('expands a whole-system include, paginated', async () => {
    const vs = await ops.expand('http://whonet.org/fhir/ValueSet/antibiotics', { count: 2, offset: 0 });
    expect(vs.expansion?.total).toBe(3);
    expect(vs.expansion?.contains?.map((c) => c.code)).toEqual(['AMP', 'CIP']);
  });
  it('404s an unknown ValueSet', async () => {
    await expect(ops.expand('http://x/nope', {})).rejects.toThrow(/not found/i);
  });
});

describe('validateCode (ValueSet)', () => {
  const ops = createOperations(memSource(abx, { [abxVs.url]: abxVs }));
  it('true when the code is in the ValueSet', async () => {
    expect((await ops.validateCode({ valueSetUrl: abxVs.url, code: 'AMP' })).result).toBe(true);
  });
  it('false when not', async () => {
    expect((await ops.validateCode({ valueSetUrl: abxVs.url, code: 'XXX' })).result).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @openldr/terminology test -- operations`
Expected: FAIL (`expand` missing; validateCode ValueSet throws).

- [ ] **Step 3: Replace `packages/terminology/src/operations.ts`** with the version that adds `expand` + a shared compose resolver + ValueSet-mode validate:

```ts
import type { ConceptSource } from './source';
import { valueSetOf } from './source';
import type { ValueSet } from '@openldr/fhir';
import type { ConceptRecord } from '@openldr/db';

export interface LookupResult { found: boolean; system: string; code: string; display: string | null; properties: Record<string, unknown> | null }
export interface ValidateResult { result: boolean; message: string }
export interface ExpandOptions { count?: number; offset?: number; filter?: string }

export class TerminologyError extends Error {
  constructor(message: string, public readonly kind: 'not-found' | 'invalid') { super(message); this.name = 'TerminologyError'; }
}

export interface Operations {
  lookup(system: string, code: string): Promise<LookupResult>;
  validateCode(input: { system: string; code: string } | { valueSetUrl: string; code: string; system?: string }): Promise<ValidateResult>;
  expand(valueSetUrl: string, opts: ExpandOptions): Promise<ValueSet>;
}

// One include rule -> matching concepts (whole system, explicit list, or single property filter).
async function includeConcepts(source: ConceptSource, rule: { system?: string; concept?: { code: string }[]; filter?: { property: string; op: string; value: string }[] }, limit: number, offset: number): Promise<{ rows: ConceptRecord[]; total: number }> {
  if (!rule.system) throw new TerminologyError('compose.include without system is unsupported', 'invalid');
  if (rule.concept) {
    const codes = rule.concept.map((c) => c.code);
    const rows = await source.findConcepts({ system: rule.system, codes, limit, offset });
    const total = await source.countConcepts({ system: rule.system, codes });
    return { rows, total };
  }
  let property: { name: string; value: string } | undefined;
  if (rule.filter && rule.filter.length > 0) {
    const f = rule.filter[0];
    if (f.op !== '=' && f.op !== 'equals') throw new TerminologyError(`filter op '${f.op}' unsupported`, 'invalid');
    property = { name: f.property, value: f.value };
  }
  const rows = await source.findConcepts({ system: rule.system, property, limit, offset });
  const total = await source.countConcepts({ system: rule.system, property });
  return { rows, total };
}

export function createOperations(source: ConceptSource): Operations {
  async function loadValueSet(url: string): Promise<ValueSet> {
    const vs = valueSetOf(await source.getResourceByUrl(url));
    if (!vs) throw new TerminologyError(`ValueSet not found: ${url}`, 'not-found');
    return vs;
  }

  async function expand(url: string, opts: ExpandOptions): Promise<ValueSet> {
    const vs = await loadValueSet(url);
    const includes = vs.compose?.include ?? [];
    // Slice A supports a single include rule for pagination/count correctness.
    if (includes.length !== 1) throw new TerminologyError('Slice A supports exactly one compose.include', 'invalid');
    const count = opts.count ?? 100;
    const offset = opts.offset ?? 0;
    const { rows, total } = await includeConcepts(source, includes[0], count, offset);
    return { ...vs, expansion: { total, offset, contains: rows.map((r) => ({ system: r.system, code: r.code, display: r.display ?? undefined })) } };
  }

  return {
    async lookup(system, code) {
      const c = await source.getConcept(system, code);
      return c ? { found: true, system, code, display: c.display, properties: c.properties } : { found: false, system, code, display: null, properties: null };
    },
    expand,
    async validateCode(input) {
      if ('valueSetUrl' in input) {
        const vs = await loadValueSet(input.valueSetUrl);
        const rule = vs.compose?.include?.[0];
        if (!rule?.system) throw new TerminologyError('ValueSet has no resolvable include', 'invalid');
        const c = await source.getConcept(rule.system, input.code);
        const inExplicit = rule.concept ? rule.concept.some((x) => x.code === input.code) : true;
        const ok = !!c && inExplicit;
        return { result: ok, message: ok ? `${input.code} is in ${input.valueSetUrl}` : `${input.code} not in ${input.valueSetUrl}` };
      }
      const c = await source.getConcept(input.system, input.code);
      return c ? { result: true, message: `${input.code} is in ${input.system}` } : { result: false, message: `${input.code} not found in ${input.system}` };
    },
  };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @openldr/terminology test && pnpm --filter @openldr/terminology typecheck`
Expected: PASS (all operations tests).

- [ ] **Step 5: Commit**

```bash
git add packages/terminology/src/operations.ts packages/terminology/src/operations.test.ts
git commit -m "feat(terminology): expand (paginated) + validate-code ValueSet mode (P2-TERM-2)"
```

---

## Task 6: `translate`

**Files:**
- Modify: `packages/terminology/src/operations.ts`
- Modify: `packages/terminology/src/operations.test.ts`

- [ ] **Step 1: Append failing test** to `operations.test.ts`:

```ts
describe('translate', () => {
  const src = memSource(abx);
  // override translate for this test
  src.translate = async (q) => (q.code === 'AMP' ? [{ mapUrl: 'http://x/cm', sourceSystem: q.system, sourceCode: 'AMP', targetSystem: 'http://loinc.org', targetCode: '101477-8', equivalence: 'equivalent' }] : []);
  const ops = createOperations(src);
  it('returns mapped targets', async () => {
    const r = await ops.translate({ system: 'http://whonet.org/fhir/CodeSystem/antibiotic', code: 'AMP' });
    expect(r.result).toBe(true);
    expect(r.matches[0].targetCode).toBe('101477-8');
  });
  it('empty for unmapped', async () => {
    const r = await ops.translate({ system: 'http://whonet.org/fhir/CodeSystem/antibiotic', code: 'CIP' });
    expect(r.result).toBe(false);
    expect(r.matches).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @openldr/terminology test -- operations`
Expected: FAIL (`translate` missing on Operations).

- [ ] **Step 3: Add `translate` to `operations.ts`** — add to the `Operations` interface:

```ts
  translate(input: { mapUrl?: string; system: string; code: string; targetSystem?: string }): Promise<TranslateResult>;
```
add the result type + import near the top:
```ts
import type { MapElement } from '@openldr/db';
export interface TranslateResult { result: boolean; matches: MapElement[] }
```
and add the implementation to the returned object:
```ts
    async translate(input) {
      const matches = await source.translate(input);
      return { result: matches.length > 0, matches };
    },
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @openldr/terminology test && pnpm --filter @openldr/terminology typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/terminology/src/operations.ts packages/terminology/src/operations.test.ts
git commit -m "feat(terminology): translate operation (P2-TERM-2)"
```

---

## Task 7: LOINC + generic loaders

**Files:**
- Create: `packages/terminology/src/loaders/generic.ts`
- Create: `packages/terminology/src/loaders/loinc.ts`
- Create: `packages/terminology/src/loaders/index.ts`
- Create: `packages/terminology/src/loaders/loinc.test.ts`
- Modify: `packages/terminology/src/index.ts`

The loaders take a small `LoaderStore` subset (upsertConcepts/upsertMapElements/saveResource/saveSystem) so they're testable with a fake.

- [ ] **Step 1: Create `packages/terminology/src/loaders/generic.ts`** (the `LoaderStore` seam + generic FHIR-resource importer):

```ts
import { validateResource } from '@openldr/fhir';
import { OpenLdrError } from '@openldr/core';
import type { ConceptRecord, MapElement } from '@openldr/db';

export interface SavedRef { resourceType: string; id: string }

export interface LoaderStore {
  upsertConcepts(rows: ConceptRecord[]): Promise<void>;
  upsertMapElements(rows: MapElement[]): Promise<void>;
  saveResource(resource: unknown): Promise<SavedRef>;
  saveSystem(url: string, version: string | null, kind: string, resourceId: string): Promise<void>;
}

export interface LoadResult { system: string; conceptsLoaded: number; resourceUrl: string }

export async function importTerminologyResource(json: unknown, store: LoaderStore): Promise<LoadResult> {
  const v = validateResource(json);
  if (!v.ok) throw new OpenLdrError('invalid terminology resource');
  const res = v.resource as { resourceType: string; url?: string; concept?: { code: string; display?: string }[]; group?: { source?: string; target?: string; element: { code: string; target?: { code: string; equivalence?: string }[] }[] }[] };
  if (!res.url) throw new OpenLdrError('terminology resource requires a url');
  const ref = await store.saveResource(res);
  await store.saveSystem(res.url, null, res.resourceType, ref.id);
  let conceptsLoaded = 0;
  if (res.resourceType === 'CodeSystem' && res.concept) {
    const rows: ConceptRecord[] = res.concept.map((c) => ({ system: res.url!, code: c.code, display: c.display ?? null, status: null, properties: null }));
    await store.upsertConcepts(rows);
    conceptsLoaded = rows.length;
  }
  if (res.resourceType === 'ConceptMap' && res.group) {
    const els: MapElement[] = [];
    for (const g of res.group) for (const e of g.element) for (const t of e.target ?? []) {
      els.push({ mapUrl: res.url!, sourceSystem: g.source ?? '', sourceCode: e.code, targetSystem: g.target ?? '', targetCode: t.code, equivalence: t.equivalence ?? null });
    }
    await store.upsertMapElements(els);
  }
  return { system: res.url, conceptsLoaded, resourceUrl: res.url };
}
```

- [ ] **Step 2: Write failing test** — `packages/terminology/src/loaders/loinc.test.ts` (tests the row→concept mapping; no file/db):

```ts
import { describe, it, expect } from 'vitest';
import { loincRowToConcept } from './loinc';

describe('loincRowToConcept', () => {
  it('maps a LOINC CSV row to a concept', () => {
    const c = loincRowToConcept({ LOINC_NUM: '2160-0', LONG_COMMON_NAME: 'Creatinine [Mass/volume] in Serum or Plasma', STATUS: 'ACTIVE', COMPONENT: 'Creatinine', PROPERTY: 'MCnc', SYSTEM: 'Ser/Plas', SCALE_TYP: 'Qn', METHOD_TYP: '', CLASS: 'CHEM' });
    expect(c.system).toBe('http://loinc.org');
    expect(c.code).toBe('2160-0');
    expect(c.display).toBe('Creatinine [Mass/volume] in Serum or Plasma');
    expect(c.status).toBe('ACTIVE');
    expect(c.properties).toMatchObject({ COMPONENT: 'Creatinine', CLASS: 'CHEM' });
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `pnpm --filter @openldr/terminology test -- loinc`
Expected: FAIL (module missing).

- [ ] **Step 4: Create `packages/terminology/src/loaders/loinc.ts`**

```ts
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse';
import type { ConceptRecord } from '@openldr/db';
import { OpenLdrError } from '@openldr/core';
import type { LoaderStore, LoadResult } from './generic';

const LOINC_SYSTEM = 'http://loinc.org';

export function loincRowToConcept(row: Record<string, string>): ConceptRecord {
  return {
    system: LOINC_SYSTEM,
    code: row.LOINC_NUM,
    display: row.LONG_COMMON_NAME || null,
    status: row.STATUS || null,
    properties: { COMPONENT: row.COMPONENT, PROPERTY: row.PROPERTY, SYSTEM: row.SYSTEM, SCALE_TYP: row.SCALE_TYP, METHOD_TYP: row.METHOD_TYP, CLASS: row.CLASS },
  };
}

export async function loadLoinc(loincTableDir: string, opts: { acceptLicense: boolean }, store: LoaderStore): Promise<LoadResult> {
  if (!opts.acceptLicense) {
    throw new OpenLdrError('LOINC import requires accepting the LOINC license (--accept-license)');
  }
  const file = join(loincTableDir, 'Loinc.csv');
  const parser = createReadStream(file).pipe(parse({ columns: true, skip_empty_lines: true }));
  let batch: ConceptRecord[] = [];
  let count = 0;
  for await (const row of parser as AsyncIterable<Record<string, string>>) {
    batch.push(loincRowToConcept(row));
    count++;
    if (batch.length >= 1000) { await store.upsertConcepts(batch); batch = []; }
  }
  if (batch.length) await store.upsertConcepts(batch);

  const cs = { resourceType: 'CodeSystem' as const, url: LOINC_SYSTEM, name: 'LOINC', status: 'active', content: 'not-present' as const };
  const ref = await store.saveResource(cs);
  await store.saveSystem(LOINC_SYSTEM, null, 'CodeSystem', ref.id);
  return { system: LOINC_SYSTEM, conceptsLoaded: count, resourceUrl: LOINC_SYSTEM };
}
```

- [ ] **Step 5: Create `packages/terminology/src/loaders/index.ts`** (NOTE: `./whonet` is added in Task 8 — omit it here so this task stays green):

```ts
export * from './generic';
export * from './loinc';
```

- [ ] **Step 6: Export loaders from `packages/terminology/src/index.ts`** — append:

```ts
export * from './loaders/index';
```

- [ ] **Step 7: Run, verify pass**

Run: `pnpm --filter @openldr/terminology test && pnpm --filter @openldr/terminology typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/terminology/src/loaders/generic.ts packages/terminology/src/loaders/loinc.ts packages/terminology/src/loaders/index.ts packages/terminology/src/loaders/loinc.test.ts packages/terminology/src/index.ts
git commit -m "feat(terminology): LOINC + generic terminology loaders (P2-TERM-3)"
```

---

## Task 8: WHONET-AMR loader + ConceptMap fixture

**Files:**
- Create: `packages/terminology/src/loaders/whonet.ts`
- Create: `packages/terminology/src/loaders/whonet.test.ts`
- Create: `packages/terminology/fixtures/whonet-loinc-conceptmap.json`
- Modify: `packages/terminology/src/loaders/index.ts`

- [ ] **Step 1: Write failing test** — `packages/terminology/src/loaders/whonet.test.ts` (tests the pure join→concept mapping over in-memory rows; no sqlite):

```ts
import { describe, it, expect } from 'vitest';
import { joinForwardReverse } from './whonet';

describe('joinForwardReverse', () => {
  it('joins forward+reverse lookups into code/display pairs', () => {
    const forward = [{ WHONET_Code: 'AMP', ASIARS_Net_Code: 1 }, { WHONET_Code: 'CIP', ASIARS_Net_Code: 2 }];
    const reverse = [{ ASIARS_Net_Code: 1, WHONET_Code: 'Ampicillin' }, { ASIARS_Net_Code: 2, WHONET_Code: 'Ciprofloxacin' }];
    const pairs = joinForwardReverse(forward, reverse);
    expect(pairs.find((c) => c.code === 'AMP')?.display).toBe('Ampicillin');
    expect(pairs).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @openldr/terminology test -- whonet`
Expected: FAIL (module missing).

- [ ] **Step 3: Create `packages/terminology/src/loaders/whonet.ts`**

```ts
import { DatabaseSync } from 'node:sqlite';
import type { ConceptRecord } from '@openldr/db';
import { OpenLdrError } from '@openldr/core';
import type { LoaderStore, LoadResult } from './generic';

export const ANTIBIOTIC_SYSTEM = 'http://whonet.org/fhir/CodeSystem/antibiotic';
export const ORGANISM_SYSTEM = 'http://whonet.org/fhir/CodeSystem/organism';
export const ANTIBIOTIC_VS = 'http://whonet.org/fhir/ValueSet/antibiotics';
export const ORGANISM_VS = 'http://whonet.org/fhir/ValueSet/organisms';

interface Fwd { WHONET_Code: string; ASIARS_Net_Code: number }
interface Rev { ASIARS_Net_Code: number; WHONET_Code: string }

export function joinForwardReverse(forward: Fwd[], reverse: Rev[]): { code: string; display: string }[] {
  const nameByNum = new Map(reverse.map((r) => [r.ASIARS_Net_Code, r.WHONET_Code]));
  return forward
    .filter((f) => f.WHONET_Code && nameByNum.has(f.ASIARS_Net_Code))
    .map((f) => ({ code: f.WHONET_Code, display: nameByNum.get(f.ASIARS_Net_Code)! }));
}

function readPair(db: DatabaseSync, fwdTable: string, revTable: string): { code: string; display: string }[] {
  const forward = db.prepare(`SELECT WHONET_Code, ASIARS_Net_Code FROM "${fwdTable}"`).all() as unknown as Fwd[];
  const reverse = db.prepare(`SELECT ASIARS_Net_Code, WHONET_Code FROM "${revTable}"`).all() as unknown as Rev[];
  return joinForwardReverse(forward, reverse);
}

export async function loadWhonetAmr(sqlitePath: string, store: LoaderStore): Promise<LoadResult[]> {
  let db: DatabaseSync;
  try { db = new DatabaseSync(sqlitePath, { readOnly: true }); } catch (e) { throw new OpenLdrError(`cannot open WHONET sqlite: ${(e as Error).message}`); }
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
  for (const t of ['Antibiotics_ForwardLookup', 'Antibiotics_ReverseLookup', 'Organisms_ForwardLookup', 'Organisms_ReverseLookup']) {
    if (!tables.has(t)) { db.close(); throw new OpenLdrError(`WHONET sqlite missing expected table ${t}`); }
  }

  const results: LoadResult[] = [];
  for (const [system, vsUrl, name, fwd, rev] of [
    [ANTIBIOTIC_SYSTEM, ANTIBIOTIC_VS, 'WHONET Antibiotics', 'Antibiotics_ForwardLookup', 'Antibiotics_ReverseLookup'],
    [ORGANISM_SYSTEM, ORGANISM_VS, 'WHONET Organisms', 'Organisms_ForwardLookup', 'Organisms_ReverseLookup'],
  ] as const) {
    const pairs = readPair(db, fwd, rev);
    const rows: ConceptRecord[] = pairs.map((p) => ({ system, code: p.code, display: p.display, status: null, properties: null }));
    await store.upsertConcepts(rows);
    const csRef = await store.saveResource({ resourceType: 'CodeSystem', url: system, name, status: 'active', content: 'complete', concept: pairs.map((p) => ({ code: p.code, display: p.display })) });
    await store.saveSystem(system, null, 'CodeSystem', csRef.id);
    const vsRef = await store.saveResource({ resourceType: 'ValueSet', url: vsUrl, name: `${name} (all)`, status: 'active', compose: { include: [{ system }] } });
    await store.saveSystem(vsUrl, null, 'ValueSet', vsRef.id);
    results.push({ system, conceptsLoaded: rows.length, resourceUrl: system });
  }
  db.close();
  return results;
}
```

- [ ] **Step 4: Create the committed ConceptMap fixture** `packages/terminology/fixtures/whonet-loinc-conceptmap.json`:

```json
{
  "resourceType": "ConceptMap",
  "url": "http://openldr.org/fhir/ConceptMap/whonet-antibiotic-to-loinc",
  "name": "WHONET antibiotic to LOINC susceptibility",
  "status": "active",
  "group": [
    {
      "source": "http://whonet.org/fhir/CodeSystem/antibiotic",
      "target": "http://loinc.org",
      "element": [
        { "code": "AMP", "target": [{ "code": "101477-8", "equivalence": "relatedto" }] },
        { "code": "CIP", "target": [{ "code": "101500-7", "equivalence": "relatedto" }] },
        { "code": "GEN", "target": [{ "code": "101494-3", "equivalence": "relatedto" }] }
      ]
    }
  ]
}
```

- [ ] **Step 5: Restore the whonet export in `packages/terminology/src/loaders/index.ts`**:

```ts
export * from './generic';
export * from './loinc';
export * from './whonet';
```

- [ ] **Step 6: Run, verify pass**

Run: `pnpm --filter @openldr/terminology test && pnpm --filter @openldr/terminology typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/terminology/src/loaders/whonet.ts packages/terminology/src/loaders/whonet.test.ts packages/terminology/src/loaders/index.ts packages/terminology/fixtures/whonet-loinc-conceptmap.json
git commit -m "feat(terminology): WHONET-AMR loader + WHONET->LOINC ConceptMap (P2-TERM-4)"
```

---

## Task 9: Bootstrap `ctx.terminology` (in-process) + CLI commands

**Files:**
- Create: `packages/bootstrap/src/terminology-context.ts`
- Modify: `packages/bootstrap/src/index.ts`
- Modify: `packages/bootstrap/package.json`
- Create: `packages/cli/src/terminology.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/package.json`

- [ ] **Step 1: Add deps** — in `packages/bootstrap/package.json` and `packages/cli/package.json` `dependencies`, add `"@openldr/terminology": "workspace:*"`. Run `pnpm install`.

- [ ] **Step 2: Create `packages/bootstrap/src/terminology-context.ts`**

```ts
import { Kysely } from 'kysely';
import type { Config } from '@openldr/config';
import { createInternalDb, createFhirStore, createTerminologyStore, type InternalSchema } from '@openldr/db';
import { createOperations, type Operations, type LoaderStore, loadLoinc, loadWhonetAmr, importTerminologyResource, type LoadResult } from '@openldr/terminology';

export interface TerminologyContext {
  ops: Operations;
  loaders: {
    loinc(dir: string, acceptLicense: boolean): Promise<LoadResult>;
    amr(sqlitePath: string): Promise<LoadResult[]>;
    resource(json: unknown): Promise<LoadResult>;
  };
  close(): Promise<void>;
}

export async function createTerminologyContext(cfg: Config): Promise<TerminologyContext> {
  const internal = createInternalDb(cfg.INTERNAL_DATABASE_URL);
  const db = internal.db as unknown as Kysely<InternalSchema>;
  const fhirStore = createFhirStore(db);
  const store = createTerminologyStore(db, fhirStore);
  const loaderStore: LoaderStore = {
    upsertConcepts: (r) => store.upsertConcepts(r),
    upsertMapElements: (r) => store.upsertMapElements(r),
    saveResource: (res) => fhirStore.save(res as never),
    saveSystem: (url, version, kind, id) => store.saveSystem(url, version, kind, id),
  };
  const ops = createOperations({
    getConcept: (s, c) => store.getConcept(s, c),
    findConcepts: (q) => store.findConcepts(q),
    countConcepts: (q) => store.countConcepts(q),
    getResourceByUrl: (u) => store.getResourceByUrl(u),
    translate: (q) => store.translate(q),
  });
  return {
    ops,
    loaders: {
      loinc: (dir, acceptLicense) => loadLoinc(dir, { acceptLicense }, loaderStore),
      amr: (p) => loadWhonetAmr(p, loaderStore),
      resource: (json) => importTerminologyResource(json, loaderStore),
    },
    async close() { await internal.close(); },
  };
}
```

- [ ] **Step 3: Re-export from `packages/bootstrap/src/index.ts`** — append `export * from './terminology-context';`.

- [ ] **Step 4: Create `packages/cli/src/terminology.ts`**

```ts
import { readFileSync } from 'node:fs';
import { loadConfig } from '@openldr/config';
import { createTerminologyContext } from '@openldr/bootstrap';
import { errorMessage } from '@openldr/core';

function out(json: boolean, obj: unknown, human: string): void {
  process.stdout.write((json ? JSON.stringify(obj, null, 2) : human) + '\n');
}

export async function runTerminologyImport(kind: string, path: string, opts: { acceptLicense?: boolean; json: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    if (kind === 'loinc') { const r = await ctx.loaders.loinc(path, !!opts.acceptLicense); out(opts.json, r, `loaded ${r.conceptsLoaded} LOINC concepts`); }
    else if (kind === 'amr') { const r = await ctx.loaders.amr(path); out(opts.json, r, r.map((x) => `${x.system}: ${x.conceptsLoaded}`).join('\n')); }
    else if (kind === 'resource') { const r = await ctx.loaders.resource(JSON.parse(readFileSync(path, 'utf8'))); out(opts.json, r, `imported ${r.resourceUrl} (${r.conceptsLoaded} concepts)`); }
    else { process.stderr.write(`unknown import kind '${kind}' (loinc|amr|resource)\n`); return 1; }
    return 0;
  } catch (err) { process.stderr.write(`terminology import failed: ${errorMessage(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runTerminologyLookup(system: string, code: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try { const r = await ctx.ops.lookup(system, code); out(opts.json, r, r.found ? `${code}: ${r.display}` : `${code} not found`); return r.found ? 0 : 1; }
  finally { await ctx.close(); }
}

export async function runTerminologyValidate(opts: { system?: string; code: string; valueset?: string; json: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const r = opts.valueset ? await ctx.ops.validateCode({ valueSetUrl: opts.valueset, code: opts.code }) : await ctx.ops.validateCode({ system: opts.system!, code: opts.code });
    out(opts.json, r, `${r.result}: ${r.message}`); return r.result ? 0 : 1;
  } finally { await ctx.close(); }
}

export async function runTerminologyExpand(url: string, opts: { filter?: string; count?: string; offset?: string; json: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const vs = await ctx.ops.expand(url, { filter: opts.filter, count: opts.count ? Number(opts.count) : undefined, offset: opts.offset ? Number(opts.offset) : undefined });
    out(opts.json, vs, `${vs.expansion?.total ?? 0} total; ${(vs.expansion?.contains ?? []).map((c) => c.code).join(', ')}`); return 0;
  } catch (err) { process.stderr.write(`expand failed: ${errorMessage(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runTerminologyTranslate(url: string, opts: { system: string; code: string; json: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try { const r = await ctx.ops.translate({ mapUrl: url, system: opts.system, code: opts.code }); out(opts.json, r, r.matches.map((m) => `${m.targetSystem}|${m.targetCode}`).join('\n') || '(no matches)'); return r.result ? 0 : 1; }
  finally { await ctx.close(); }
}
```

- [ ] **Step 5: Register commands in `packages/cli/src/index.ts`** — add the import and a command group after the `target-store` group:

```ts
import { runTerminologyImport, runTerminologyLookup, runTerminologyValidate, runTerminologyExpand, runTerminologyTranslate } from './terminology';
```
```ts
const term = program.command('terminology').description('Terminology service (CodeSystem/ValueSet/ConceptMap)');
term.command('import <kind> <path>').description('import loinc|amr|resource').option('--accept-license', 'accept the LOINC license', false).option('--json', 'emit JSON', false)
  .action(async (kind: string, path: string, opts: { acceptLicense: boolean; json: boolean }) => { process.exitCode = await runTerminologyImport(kind, path, opts); });
term.command('lookup <system> <code>').option('--json', 'emit JSON', false)
  .action(async (system: string, code: string, opts: { json: boolean }) => { process.exitCode = await runTerminologyLookup(system, code, opts); });
term.command('validate-code').requiredOption('--code <code>').option('--system <system>').option('--valueset <url>').option('--json', 'emit JSON', false)
  .action(async (opts: { system?: string; code: string; valueset?: string; json: boolean }) => { process.exitCode = await runTerminologyValidate(opts); });
term.command('expand <valueSetUrl>').option('--filter <p=v>').option('--count <n>').option('--offset <n>').option('--json', 'emit JSON', false)
  .action(async (url: string, opts: { filter?: string; count?: string; offset?: string; json: boolean }) => { process.exitCode = await runTerminologyExpand(url, opts); });
term.command('translate <conceptMapUrl>').requiredOption('--system <system>').requiredOption('--code <code>').option('--json', 'emit JSON', false)
  .action(async (url: string, opts: { system: string; code: string; json: boolean }) => { process.exitCode = await runTerminologyTranslate(url, opts); });
```

- [ ] **Step 6: Typecheck + build:check + depcruise**

Run: `pnpm --filter @openldr/bootstrap typecheck && pnpm --filter @openldr/cli typecheck && pnpm --filter @openldr/cli build:check && pnpm depcruise`
Expected: PASS; `terminology` appears in `node dist/index.js --help`; depcruise clean (terminology is a domain package — no adapter imports).

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src/terminology-context.ts packages/bootstrap/src/index.ts packages/bootstrap/package.json packages/cli/src/terminology.ts packages/cli/src/index.ts packages/cli/package.json pnpm-lock.yaml
git commit -m "feat(bootstrap,cli): terminology context + CLI commands (P2-TERM-2/3/4, PRD §3)"
```

---

## Task 10: HTTP API (FHIR-style)

**Files:**
- Modify: `packages/bootstrap/src/index.ts` (expose `terminology` on `AppContext`)
- Create: `apps/server/src/terminology-routes.ts`
- Modify: `apps/server/src/app.ts`

- [ ] **Step 1: Expose terminology ops on `AppContext`** — read `packages/bootstrap/src/index.ts`, then: add `import { createTerminologyContext, type TerminologyContext } from './terminology-context';`; add `terminology: TerminologyContext;` to the `AppContext` interface; in `createAppContext` add `const terminology = await createTerminologyContext(cfg);`; include `terminology` in the returned object; add `terminology.close()` to the `Promise.allSettled([...])` in `close()`.

- [ ] **Step 2: Create `apps/server/src/terminology-routes.ts`**

```ts
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { TerminologyError } from '@openldr/terminology';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerTerminologyRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const ops = ctx.terminology.ops;

  app.get('/api/terminology/CodeSystem/$lookup', async (req, reply) => {
    const { system, code } = req.query as { system?: string; code?: string };
    if (!system || !code) { reply.code(400); return { error: 'system and code required' }; }
    const r = await ops.lookup(system, code);
    if (!r.found) { reply.code(404); return { error: `not found: ${system}|${code}` }; }
    return { resourceType: 'Parameters', parameter: [{ name: 'display', valueString: r.display }, { name: 'system', valueUri: system }, { name: 'code', valueCode: code }] };
  });

  app.get('/api/terminology/ValueSet/$validate-code', async (req, reply) => {
    const { url, system, code } = req.query as { url?: string; system?: string; code?: string };
    if (!code || (!url && !system)) { reply.code(400); return { error: 'code and (url or system) required' }; }
    try {
      const r = url ? await ops.validateCode({ valueSetUrl: url, code }) : await ops.validateCode({ system: system!, code });
      return { resourceType: 'Parameters', parameter: [{ name: 'result', valueBoolean: r.result }, { name: 'message', valueString: r.message }] };
    } catch (err) { return mapErr(err, reply); }
  });

  app.get('/api/terminology/ValueSet/$expand', async (req, reply) => {
    const { url, filter, count, offset } = req.query as { url?: string; filter?: string; count?: string; offset?: string };
    if (!url) { reply.code(400); return { error: 'url required' }; }
    try {
      return await ops.expand(url, { filter, count: count ? Number(count) : undefined, offset: offset ? Number(offset) : undefined });
    } catch (err) { return mapErr(err, reply); }
  });

  app.get('/api/terminology/ConceptMap/$translate', async (req, reply) => {
    const { url, system, code } = req.query as { url?: string; system?: string; code?: string };
    if (!system || !code) { reply.code(400); return { error: 'system and code required' }; }
    const r = await ops.translate({ mapUrl: url, system, code });
    return { resourceType: 'Parameters', parameter: [{ name: 'result', valueBoolean: r.result }, ...r.matches.map((m) => ({ name: 'match', valueCoding: { system: m.targetSystem, code: m.targetCode } }))] };
  });
}

function mapErr(err: unknown, reply: FastifyReply) {
  if (err instanceof TerminologyError) {
    reply.code(err.kind === 'not-found' ? 404 : 400);
    return { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: err.kind === 'not-found' ? 'not-found' : 'invalid', diagnostics: err.message }] };
  }
  const msg = err instanceof Error ? err.message : String(err);
  reply.code(/ECONNREFUSED|connect/i.test(msg) ? 503 : 500);
  return { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'exception', diagnostics: msg }] };
}
```

- [ ] **Step 3: Register in `apps/server/src/app.ts`** — add `import { registerTerminologyRoutes } from './terminology-routes';` and call `registerTerminologyRoutes(app, ctx);` right after `registerReportRoutes(app, ctx);` (before the static SPA block).

- [ ] **Step 4: Typecheck + build:check**

Run: `pnpm --filter @openldr/bootstrap typecheck && pnpm --filter @openldr/server typecheck && pnpm --filter @openldr/server build:check`
Expected: PASS (no "Dynamic require of" crash).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/terminology-routes.ts apps/server/src/app.ts packages/bootstrap/src/index.ts
git commit -m "feat(server): FHIR-style terminology HTTP endpoints (P2-TERM-2)"
```

---

## Task 11: Live acceptance (real LOINC + WHONET) + memory + finish

**Files:** none (verification + memory). Docker Postgres (dev stack) must be up.

- [ ] **Step 1: Migrate**

Run: `pnpm openldr db migrate`
Expected: `007_terminology` applies (3 tables).

- [ ] **Step 2: Load real LOINC (license gate)**

Run: `pnpm openldr terminology import loinc "D:/Projects/Repositories/corlix/fixtures/Loinc/2.82/LoincTable" --accept-license`
Expected: ~109,000 concepts in a few seconds. Without `--accept-license` it must error.

- [ ] **Step 3: Lookup**

Run: `pnpm openldr terminology lookup http://loinc.org 2160-0 --json`
Expected: `found: true`, display "Creatinine [Mass/volume] in Serum or Plasma".

- [ ] **Step 4: Load WHONET AMR + ConceptMap**

```bash
pnpm openldr terminology import amr "D:/Projects/Repositories/corlix/fixtures/WHONET/Codes/ASIARS-Net.sqlite"
pnpm openldr terminology import resource packages/terminology/fixtures/whonet-loinc-conceptmap.json
```
Expected: antibiotic + organism CodeSystems/ValueSets loaded; ConceptMap imported. (If `import amr` reports the WHONET codes differ, inspect via the next step; the fixture uses AMP/CIP/GEN — adjust if the fixture's codes differ.)

- [ ] **Step 5: Expand + validate-code + translate**

```bash
pnpm openldr terminology expand http://whonet.org/fhir/ValueSet/antibiotics --count 200 --json
pnpm openldr terminology validate-code --valueset http://whonet.org/fhir/ValueSet/antibiotics --code AMP --json
pnpm openldr terminology translate http://openldr.org/fhir/ConceptMap/whonet-antibiotic-to-loinc --system http://whonet.org/fhir/CodeSystem/antibiotic --code AMP --json
```
Expected: expand contains AMP/CIP/GEN with `expansion.total` > 0; validate-code AMP → true; translate AMP → LOINC `101477-8`. If AMP/CIP/GEN aren't exact WHONET codes in this fixture, adjust the ConceptMap fixture + the expand assertion to the real codes (verify via the expand output).

- [ ] **Step 6: HTTP API**

Build web + run the server from repo root (`pnpm --filter @openldr/web build && node apps/server/dist/index.js`), then:
```bash
curl "http://127.0.0.1:3000/api/terminology/CodeSystem/$lookup?system=http://loinc.org&code=2160-0"
curl "http://127.0.0.1:3000/api/terminology/ValueSet/$expand?url=http://whonet.org/fhir/ValueSet/antibiotics&count=5"
```
Expected: FHIR `Parameters` (lookup) and `ValueSet` (expand) JSON.

- [ ] **Step 7: Full gates**

Run: `pnpm typecheck && pnpm test && pnpm depcruise && pnpm build:check`
Expected: all PASS. `pnpm test` stays stack-free (ops/loaders unit tests use in-memory/fixture data; the store + live load are acceptance-only).

- [ ] **Step 8: Update build-plan memory** — record Phase-2 sub-project 2 (terminology Slice A) done, the LOINC/WHONET acceptance result, and carry-forwards (expand single-include limitation; UI/binding deferred to Slices B/C). File: `C:\Users\Fredrick\.claude\projects\D--Projects-Repositories-openldr-ce\memory\openldr-ce-build-plan.md`. Cross-link `[[terminology-data]]`.

- [ ] **Step 9: Finish the branch** — use superpowers:finishing-a-development-branch (merge to `main`).

---

## Self-review notes (author)

- **Spec coverage:** §4 resources → Task 1; §5 storage → Tasks 2-3; §6 ops → Tasks 4-6; §7 loaders → Tasks 7-8; §8 CLI → Task 9; §9 HTTP → Task 10; §10 acceptance → Task 11. P2-TERM-1 (T1-3), -2 (T4-6,9,10), -3 (T7), -4 (T8).
- **No placeholders:** every file has full content; run steps have expected results. The `./whonet` export ordering is explicit (T7 omits it, T8 restores).
- **Type/name consistency:** `ConceptRecord`/`MapElement`/`ConceptQuery`/`TranslateQuery` (db) reused by the terminology `ConceptSource`; `Operations` = `lookup`/`validateCode`/`expand`/`translate`; `LoaderStore`/`LoadResult`; systems `http://whonet.org/fhir/CodeSystem/antibiotic|organism`, ValueSets `.../ValueSet/antibiotics|organisms`; LOINC `http://loinc.org`. CLI `runTerminology*`. `TerminologyError`. Consistent across tasks.
- **Carry-forward (for the build-plan):** `$expand` supports exactly one `compose.include` in Slice A (multi-include union deferred); on-the-fly expansion only; the WHONET→LOINC ConceptMap codes (AMP/CIP/GEN → 101477-8/101500-7/101494-3) are verified against LOINC 2.82 + may need adjustment for other LOINC/WHONET versions.
```
