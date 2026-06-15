# Terminology UI — SP3: Value Sets + Value Set Builder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a faithful corlix-style Value Set authoring layer to CE — `value_sets` + `valueset_expansions` tables, a full ported `expandCompose` expander, FHIR JSON import/export, REST + CLI, and the builder/list UI — and upgrade the FHIR `$expand`/`$validate-code` serve path to the full expander so authored multi-clause ValueSets serve correctly.

**Architecture:** `value_sets` (FHIR-shaped `compose` JSON) is the single source of truth; on save the store expands it (ported pure `expandCompose` over an `ExpandDeps` adapter), materializes `valueset_expansions`, and **projects** a FHIR `ValueSet` resource into the fhir store + `terminology_systems` so the read path serves it. `operations.ts` is upgraded to the same expander. UI ports corlix's `ValueSetBuilder`/`ValueSetPicker` and adds the value-set list + kebab Term/Value-set submenus to the existing publisher-rail page.

**Tech Stack:** TypeScript monorepo (pnpm/turbo), Kysely (Postgres), pg-mem (tests), Fastify, Zod, Vitest, React + Vite + Radix/shadcn, Playwright. Spec: `docs/superpowers/specs/2026-06-15-terminology-ui-sp3-design.md`.

**Conventions carried from SP1/SP2 (do not relitigate):**
- `db reset` is a no-op without `--force`; use `... db reset --force` for live reseeds.
- pg-mem: no `ILIKE` (use `sql\`lower(x)\` like`); jsonb columns must be inserted as `JSON.stringify(...)`; supports `db.transaction()` and `sql\`now()\``.
- `apps/server` has **no** `@openldr/db` dependency → routes use the duck-type `isAdminError` guard, never `instanceof`.
- Always use shadcn primitives in `apps/web` (never native `<select>`), and `redact()` on every error boundary.
- Run gates with `pnpm turbo typecheck lint test build` and `pnpm depcruise` from repo root.

---

## File Structure

**Create:**
- `packages/db/src/migrations/internal/014_value_sets.ts` — tables + seeds + projection of seed resources.
- `packages/db/src/migrations/internal/014_value_sets.test.ts` — migration + seed tests.
- `packages/terminology/src/expander.ts` — pure `expandCompose` + `ExpandDeps`.
- `packages/terminology/src/expander.test.ts` — expander unit tests.
- `packages/terminology/src/fhirValueSet.ts` — FHIR JSON `toInput`/`toResource`.
- `packages/terminology/src/fhirValueSet.test.ts` — round-trip tests.
- `apps/web/src/terminology/ValueSetBuilder.tsx` — builder (ported).
- `apps/web/src/terminology/ValueSetPicker.tsx` — typeahead (ported).

**Modify:**
- `packages/db/src/schema/internal.ts` — `value_sets`, `valueset_expansions` tables.
- `packages/db/src/migrations/internal/index.ts` — register `014`.
- `packages/db/src/terminology-admin-store.ts` — `valueSets` namespace, types, optional `projection` param, DB-backed `ExpandDeps`.
- `packages/db/src/terminology-admin-store.test.ts` — valueSets store tests (file exists from SP2; append).
- `packages/terminology/src/operations.ts` — use `expandCompose`.
- `packages/terminology/src/operations.test.ts` — updated expand/validate tests.
- `packages/terminology/src/index.ts` — export `expander` + `fhirValueSet`.
- `packages/bootstrap/src/terminology-context.ts` + `packages/bootstrap/src/index.ts` — wire `projection`.
- `apps/server/src/terminology-admin-routes.ts` — valuesets routes + zod.
- `packages/cli/src/terminology.ts` + `packages/cli/src/index.ts` — `valueset list` command.
- `apps/web/src/api.ts` — valueset client + types.
- `apps/web/src/terminology/publisherSections.ts` + `…/publisherSections.test.ts` — third `valueSets` arg.
- `apps/web/src/pages/Terminology.tsx` — load valueSets, segmented toggle, value-set list, kebab Term+Value-set submenus, builder Sheet.
- `e2e/tests/terminology.spec.ts` — value-set flow.

---

## Task 1: Migration 014 tables + schema types

**Files:**
- Create: `packages/db/src/migrations/internal/014_value_sets.ts`
- Create: `packages/db/src/migrations/internal/014_value_sets.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/schema/internal.ts`

- [ ] **Step 1: Write the migration (tables only; seeds come in Task 5)**

Create `packages/db/src/migrations/internal/014_value_sets.ts`:

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('value_sets')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('url', 'text', (c) => c.notNull())
    .addColumn('version', 'text')
    .addColumn('name', 'text')
    .addColumn('title', 'text')
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('draft'))
    .addColumn('experimental', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('description', 'text')
    .addColumn('compose', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('source_json', 'jsonb')
    .addColumn('immutable', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('category', 'text')
    .addColumn('publisher_id', 'text')
    .addColumn('expanded_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .createIndex('value_sets_url_key').ifNotExists().unique()
    .on('value_sets').column('url').execute();
  await db.schema
    .createIndex('value_sets_publisher').ifNotExists()
    .on('value_sets').column('publisher_id').execute();

  await db.schema
    .createTable('valueset_expansions')
    .ifNotExists()
    .addColumn('value_set_id', 'text', (c) => c.notNull().references('value_sets.id').onDelete('cascade'))
    .addColumn('system_url', 'text', (c) => c.notNull())
    .addColumn('code', 'text', (c) => c.notNull())
    .addColumn('display', 'text')
    .addColumn('inactive', 'boolean', (c) => c.notNull().defaultTo(false))
    .addPrimaryKeyConstraint('valueset_expansions_pk', ['value_set_id', 'system_url', 'code'])
    .execute();
  await db.schema
    .createIndex('valueset_expansions_vs').ifNotExists()
    .on('valueset_expansions').column('value_set_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('valueset_expansions').ifExists().execute();
  await db.schema.dropTable('value_sets').ifExists().execute();
}
```

- [ ] **Step 2: Register the migration**

In `packages/db/src/migrations/internal/index.ts`, add the import after `m013` and the record entry after `'013_term_mappings'`:

```ts
import * as m014 from './014_value_sets';
// ...
  '014_value_sets': { up: m014.up, down: m014.down },
```

- [ ] **Step 3: Add schema types**

In `packages/db/src/schema/internal.ts`, add the two table interfaces (match the existing style in that file — copy the boolean/jsonb idioms already present for `term_mappings`/`dashboards`). Add:

```ts
export interface ValueSetsTable {
  id: string;
  url: string;
  version: string | null;
  name: string | null;
  title: string | null;
  status: string;
  experimental: boolean;
  description: string | null;
  compose: unknown;            // jsonb (FHIR ValueSet.compose)
  source_json: unknown | null; // jsonb
  immutable: boolean;
  category: string | null;
  publisher_id: string | null;
  expanded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ValuesetExpansionsTable {
  value_set_id: string;
  system_url: string;
  code: string;
  display: string | null;
  inactive: boolean;
}
```

Then register both on `InternalSchema` (find the interface with `concept_map_elements: ConceptMapElementsTable;`) by adding:

```ts
  value_sets: ValueSetsTable;
  valueset_expansions: ValuesetExpansionsTable;
```

- [ ] **Step 4: Write the migration test**

Create `packages/db/src/migrations/internal/014_value_sets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('014_value_sets', () => {
  it('creates value_sets and valueset_expansions tables', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('value_sets').values({
      id: 'vs-test', url: 'urn:test:vs', status: 'draft', experimental: false,
      compose: JSON.stringify({ include: [] }), immutable: false,
    } as never).execute();
    const row = await db.selectFrom('value_sets').selectAll().where('id', '=', 'vs-test').executeTakeFirst();
    expect(row?.url).toBe('urn:test:vs');

    await db.insertInto('valueset_expansions').values({
      value_set_id: 'vs-test', system_url: 'urn:test:cs', code: 'A', display: 'Alpha', inactive: false,
    } as never).execute();
    const exp = await db.selectFrom('valueset_expansions').selectAll().where('value_set_id', '=', 'vs-test').execute();
    expect(exp).toHaveLength(1);
    await db.destroy();
  });
});
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @openldr/db test -- 014_value_sets`
Expected: PASS (2 inserts + reads succeed).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/migrations/internal/014_value_sets.ts packages/db/src/migrations/internal/014_value_sets.test.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts
git commit -m "feat(db): value_sets + valueset_expansions tables (migration 014) (P2-TERM)"
```

---

## Task 2: Ported `expandCompose` expander

**Files:**
- Create: `packages/terminology/src/expander.ts`
- Create: `packages/terminology/src/expander.test.ts`

This is an async port of corlix `apps/desktop/src/main/expander.ts`.

- [ ] **Step 1: Write failing tests**

Create `packages/terminology/src/expander.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { expandCompose, type ExpandDeps, type VsCompose } from './expander';

function makeDeps(opts?: { sets?: Record<string, VsCompose> }): ExpandDeps {
  const concepts: Record<string, { code: string; display: string; status: string; class?: string }[]> = {
    's1': [
      { code: 'A', display: 'Alpha', status: 'ACTIVE', class: 'X' },
      { code: 'B', display: 'Beta', status: 'ACTIVE', class: 'Y' },
      { code: 'C', display: 'Gamma', status: 'DRAFT', class: 'X' },
    ],
    's2': [{ code: 'Z', display: 'Zeta', status: 'ACTIVE' }],
  };
  const sets = opts?.sets ?? {};
  return {
    async listSystemConcepts(sys, activeOnly) {
      return (concepts[sys] ?? []).filter((c) => !activeOnly || c.status === 'ACTIVE')
        .map((c) => ({ system: sys, code: c.code, display: c.display }));
    },
    async filterConcepts(sys, filters, activeOnly) {
      return (concepts[sys] ?? []).filter((c) => {
        if (activeOnly && c.status !== 'ACTIVE') return false;
        return filters.every((f) => {
          const v = f.property === 'class' ? c.class : f.property === 'status' ? c.status : undefined;
          return v === f.value;
        });
      }).map((c) => ({ system: sys, code: c.code, display: c.display }));
    },
    async resolveDisplay(sys, code) {
      return (concepts[sys] ?? []).find((c) => c.code === code)?.display ?? null;
    },
    async resolveValueSetCompose(url) {
      return sets[url] ?? null;
    },
  };
}

describe('expandCompose', () => {
  it('expands enumerated concepts (display resolved when omitted)', async () => {
    const { codes } = await expandCompose({ include: [{ system: 's1', concept: [{ code: 'A' }, { code: 'B', display: 'Custom' }] }] }, makeDeps());
    expect(codes).toEqual([
      { system: 's1', code: 'A', display: 'Alpha' },
      { system: 's1', code: 'B', display: 'Custom' },
    ]);
  });

  it('expands a whole system (activeOnly drops DRAFT)', async () => {
    const { codes } = await expandCompose({ include: [{ system: 's1' }] }, makeDeps());
    expect(codes.map((c) => c.code)).toEqual(['A', 'B']);
  });

  it('applies a class filter', async () => {
    const { codes } = await expandCompose({ include: [{ system: 's1', filter: [{ property: 'class', op: '=', value: 'X' }] }] }, makeDeps());
    expect(codes.map((c) => c.code)).toEqual(['A']); // C is DRAFT, dropped by activeOnly
  });

  it('unions across includes and subtracts excludes', async () => {
    const { codes } = await expandCompose({
      include: [{ system: 's1' }, { system: 's2' }],
      exclude: [{ system: 's1', concept: [{ code: 'B' }] }],
    }, makeDeps());
    expect(codes.map((c) => `${c.system}|${c.code}`)).toEqual(['s1|A', 's2|Z']);
  });

  it('intersects dimensions within one clause (concept ∩ filter)', async () => {
    const { codes } = await expandCompose({
      include: [{ system: 's1', concept: [{ code: 'A' }, { code: 'B' }], filter: [{ property: 'class', op: '=', value: 'X' }] }],
    }, makeDeps());
    expect(codes.map((c) => c.code)).toEqual(['A']);
  });

  it('imports another value set and guards cycles', async () => {
    const deps = makeDeps({ sets: { 'urn:child': { include: [{ system: 's2' }] }, 'urn:loop': { include: [{ valueSet: ['urn:loop'] }] } } });
    const imported = await expandCompose({ include: [{ valueSet: ['urn:child'] }] }, deps, { seedUrls: ['urn:root'] });
    expect(imported.codes.map((c) => c.code)).toEqual(['Z']);
    const looped = await expandCompose({ include: [{ valueSet: ['urn:loop'] }] }, deps, { seedUrls: ['urn:loop'] });
    expect(looped.codes).toEqual([]);
  });

  it('dedups by (system, code)', async () => {
    const { codes, total } = await expandCompose({ include: [{ system: 's2' }, { system: 's2' }] }, makeDeps());
    expect(total).toBe(1);
    expect(codes).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @openldr/terminology test -- expander`
Expected: FAIL ("Cannot find module './expander'").

- [ ] **Step 3: Implement the expander**

Create `packages/terminology/src/expander.ts`:

```ts
// Async port of corlix apps/desktop/src/main/expander.ts. Pure: all I/O is via the
// injected ExpandDeps adapter, so this stays DB-agnostic (preserves DP-1).

export interface ExpandedConcept { system: string; code: string; display: string | null }

export interface VsFilter { property: string; op: string; value: string }
export interface VsInclude {
  system?: string;
  version?: string;
  concept?: { code: string; display?: string }[];
  filter?: VsFilter[];
  valueSet?: string[];
}
export interface VsCompose { include?: VsInclude[]; exclude?: VsInclude[] }

export interface ExpandDeps {
  listSystemConcepts(systemUrl: string, activeOnly: boolean): Promise<ExpandedConcept[]>;
  filterConcepts(systemUrl: string, filters: VsFilter[], activeOnly: boolean): Promise<ExpandedConcept[]>;
  resolveDisplay(systemUrl: string, code: string): Promise<string | null>;
  resolveValueSetCompose(url: string): Promise<VsCompose | null>;
}

export interface ExpandOptions { activeOnly?: boolean; seedUrls?: string[] }

const keyOf = (c: { system: string; code: string }): string => `${c.system}|${c.code}`;
const MAX_IMPORT_DEPTH = 16;

function dedup(codes: ExpandedConcept[]): ExpandedConcept[] {
  const seen = new Set<string>();
  const out: ExpandedConcept[] = [];
  for (const c of codes) {
    const k = keyOf(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

async function expandImport(url: string, deps: ExpandDeps, activeOnly: boolean, visited: Set<string>, depth: number): Promise<ExpandedConcept[]> {
  if (depth >= MAX_IMPORT_DEPTH || visited.has(url)) return [];
  const compose = await deps.resolveValueSetCompose(url);
  if (!compose) return [];
  const next = new Set(visited);
  next.add(url);
  return (await expandInner(compose, deps, activeOnly, next, depth + 1)).codes;
}

async function collectClause(clause: VsInclude, deps: ExpandDeps, activeOnly: boolean, visited: Set<string>, depth: number): Promise<ExpandedConcept[]> {
  const sets: ExpandedConcept[][] = [];

  if (clause.system) {
    const hasConcept = !!(clause.concept && clause.concept.length > 0);
    const hasFilter = !!(clause.filter && clause.filter.length > 0);
    if (hasConcept) {
      sets.push(await Promise.all(clause.concept!.map(async (c) => ({
        system: clause.system!, code: c.code,
        display: c.display ?? (await deps.resolveDisplay(clause.system!, c.code)),
      }))));
    }
    if (hasFilter) sets.push(await deps.filterConcepts(clause.system, clause.filter!, activeOnly));
    if (!hasConcept && !hasFilter) sets.push(await deps.listSystemConcepts(clause.system, activeOnly));
  }

  for (const url of clause.valueSet ?? []) {
    sets.push(await expandImport(url, deps, activeOnly, visited, depth));
  }

  if (sets.length === 0) return [];
  if (sets.length === 1) return dedup(sets[0]!);
  const [first, ...rest] = sets;
  const restKeys = rest.map((s) => new Set(s.map(keyOf)));
  return dedup(first!.filter((c) => restKeys.every((ks) => ks.has(keyOf(c)))));
}

async function expandInner(compose: VsCompose, deps: ExpandDeps, activeOnly: boolean, visited: Set<string>, depth: number): Promise<{ codes: ExpandedConcept[]; total: number }> {
  const included: ExpandedConcept[] = [];
  for (const inc of compose.include ?? []) included.push(...(await collectClause(inc, deps, activeOnly, visited, depth)));
  let codes = dedup(included);

  if (compose.exclude && compose.exclude.length > 0) {
    const excluded: ExpandedConcept[] = [];
    for (const exc of compose.exclude) excluded.push(...(await collectClause(exc, deps, activeOnly, visited, depth)));
    const exKeys = new Set(excluded.map(keyOf));
    codes = codes.filter((c) => !exKeys.has(keyOf(c)));
  }
  return { codes, total: codes.length };
}

/** Resolve a ValueSet.compose into a flat, deduped code list. */
export async function expandCompose(compose: VsCompose, deps: ExpandDeps, opts: ExpandOptions = {}): Promise<{ codes: ExpandedConcept[]; total: number }> {
  const activeOnly = opts.activeOnly !== false;
  const visited = new Set<string>(opts.seedUrls ?? []);
  return expandInner(compose, deps, activeOnly, visited, 0);
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @openldr/terminology test -- expander`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/terminology/src/expander.ts packages/terminology/src/expander.test.ts
git commit -m "feat(terminology): pure async expandCompose expander (ported from corlix) (P2-TERM)"
```

---

## Task 3: FHIR ValueSet JSON import/export

**Files:**
- Create: `packages/terminology/src/fhirValueSet.ts`
- Create: `packages/terminology/src/fhirValueSet.test.ts`

Port of corlix `apps/desktop/src/main/fhirValueSet.ts`, minus designations (deferred non-goal).

- [ ] **Step 1: Write failing tests**

Create `packages/terminology/src/fhirValueSet.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fhirValueSetToInput, valueSetToFhirResource } from './fhirValueSet';

describe('fhirValueSet', () => {
  it('maps a FHIR ValueSet resource to input', () => {
    const input = fhirValueSetToInput({
      resourceType: 'ValueSet', url: 'urn:test:vs', status: 'active', title: 'T',
      compose: { include: [{ system: 's1', concept: [{ code: 'A', display: 'Alpha' }] }] },
    });
    expect(input.url).toBe('urn:test:vs');
    expect(input.status).toBe('active');
    expect(input.compose.include?.[0]?.concept?.[0]?.code).toBe('A');
  });

  it('rejects a non-ValueSet resource', () => {
    expect(() => fhirValueSetToInput({ resourceType: 'CodeSystem' })).toThrow();
  });

  it('rejects a ValueSet without url', () => {
    expect(() => fhirValueSetToInput({ resourceType: 'ValueSet', status: 'active' })).toThrow();
  });

  it('builds compose from expansion.contains when compose is absent', () => {
    const input = fhirValueSetToInput({
      resourceType: 'ValueSet', url: 'urn:test:vs2', status: 'active',
      expansion: { contains: [{ system: 's1', code: 'A', display: 'Alpha' }, { system: 's1', code: 'B' }] },
    });
    expect(input.compose.include).toHaveLength(1);
    expect(input.compose.include?.[0]?.concept).toHaveLength(2);
  });

  it('emits a FHIR resource with an expansion block', () => {
    const res = valueSetToFhirResource(
      { id: 'vs-1', url: 'urn:test:vs', status: 'active', experimental: false, version: null, name: null, title: 'T', description: null, compose: { include: [{ system: 's1' }] } },
      [{ system: 's1', code: 'A', display: 'Alpha' }],
    );
    expect(res.resourceType).toBe('ValueSet');
    expect((res.expansion as { total: number }).total).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @openldr/terminology test -- fhirValueSet`
Expected: FAIL ("Cannot find module './fhirValueSet'").

- [ ] **Step 3: Implement**

Create `packages/terminology/src/fhirValueSet.ts`:

```ts
import type { ExpandedConcept, VsCompose, VsInclude } from './expander';

// Shape the store/UI use as the canonical authoring input.
export type ValueSetStatus = 'draft' | 'active' | 'retired';
export interface ValueSetInput {
  url: string;
  version: string | null;
  name: string | null;
  title: string | null;
  status: ValueSetStatus;
  experimental: boolean;
  description: string | null;
  compose: VsCompose;
  publisherId?: string | null;
  category?: string | null;
}
export interface ValueSetCore {
  id: string; url: string; status: ValueSetStatus; experimental: boolean;
  version: string | null; name: string | null; title: string | null;
  description: string | null; compose: VsCompose;
}

function isObj(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null; }
function str(v: unknown): string | undefined { return typeof v === 'string' ? v : undefined; }

const STATUS: ValueSetStatus[] = ['draft', 'active', 'retired'];
function mapStatus(v: unknown): ValueSetStatus {
  const s = str(v);
  return s && (STATUS as string[]).includes(s) ? (s as ValueSetStatus) : 'draft';
}

function mapClause(raw: unknown): VsInclude {
  const r = isObj(raw) ? raw : {};
  const out: VsInclude = {};
  if (str(r.system)) out.system = str(r.system);
  if (Array.isArray(r.concept)) {
    // Designations are intentionally dropped (deferred non-goal).
    const concept = r.concept.filter(isObj).map((c) => {
      const code = String(c.code ?? '');
      const display = str(c.display);
      return display ? { code, display } : { code };
    }).filter((c) => c.code !== '');
    if (concept.length) out.concept = concept;
  }
  if (Array.isArray(r.filter)) {
    const filter = r.filter.filter(isObj).map((f) => ({
      property: String(f.property ?? ''),
      op: String(f.op ?? '='),
      value: String(f.value ?? ''),
    })).filter((f) => f.property !== '' && f.value !== '');
    if (filter.length) out.filter = filter;
  }
  if (Array.isArray(r.valueSet)) {
    const urls = r.valueSet.map(str).filter((u): u is string => !!u);
    if (urls.length) out.valueSet = urls;
  }
  return out;
}

function composeFromExpansion(contains: unknown[]): VsCompose {
  const bySystem = new Map<string, { code: string; display?: string }[]>();
  for (const c of contains) {
    if (!isObj(c)) continue;
    const system = str(c.system); const code = str(c.code);
    if (!system || !code) continue;
    const arr = bySystem.get(system) ?? [];
    arr.push({ code, ...(str(c.display) ? { display: str(c.display) } : {}) });
    bySystem.set(system, arr);
  }
  return { include: [...bySystem.entries()].map(([system, concept]) => ({ system, concept })) };
}

/** Map an arbitrary FHIR R4 ValueSet resource (parsed JSON) to ValueSetInput. Throws on invalid input. */
export function fhirValueSetToInput(resource: unknown): ValueSetInput {
  if (!isObj(resource) || resource.resourceType !== 'ValueSet') {
    throw new Error('Not a FHIR ValueSet resource (resourceType must be "ValueSet")');
  }
  const url = str(resource.url);
  if (!url) throw new Error('FHIR ValueSet is missing a canonical "url"');

  let compose: VsCompose;
  if (isObj(resource.compose)) {
    const raw = resource.compose;
    const exclude = Array.isArray(raw.exclude) ? raw.exclude.filter(isObj).map(mapClause) : [];
    compose = {
      include: (Array.isArray(raw.include) ? raw.include : []).filter(isObj).map(mapClause),
      ...(exclude.length ? { exclude } : {}),
    };
  } else if (isObj(resource.expansion) && Array.isArray(resource.expansion.contains)) {
    compose = composeFromExpansion(resource.expansion.contains);
  } else {
    compose = { include: [] };
  }

  return {
    url,
    version: str(resource.version) ?? null,
    name: str(resource.name) ?? null,
    title: str(resource.title) ?? null,
    status: mapStatus(resource.status),
    experimental: resource.experimental === true,
    description: str(resource.description) ?? null,
    compose,
  };
}

/** Emit a ValueSet (+ optional cached expansion) as a FHIR R4 ValueSet resource. */
export function valueSetToFhirResource(vs: ValueSetCore, expansion?: ExpandedConcept[]): Record<string, unknown> {
  const out: Record<string, unknown> = {
    resourceType: 'ValueSet', id: vs.id, url: vs.url, status: vs.status,
    experimental: vs.experimental, compose: vs.compose,
  };
  if (vs.version) out.version = vs.version;
  if (vs.name) out.name = vs.name;
  if (vs.title) out.title = vs.title;
  if (vs.description) out.description = vs.description;
  if (expansion && expansion.length) {
    out.expansion = {
      total: expansion.length,
      contains: expansion.map((c) => ({ system: c.system, code: c.code, ...(c.display ? { display: c.display } : {}) })),
    };
  }
  return out;
}
```

- [ ] **Step 4: Export from the package index**

In `packages/terminology/src/index.ts`, add:

```ts
export * from './expander';
export * from './fhirValueSet';
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @openldr/terminology test -- fhirValueSet`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/terminology/src/fhirValueSet.ts packages/terminology/src/fhirValueSet.test.ts packages/terminology/src/index.ts
git commit -m "feat(terminology): FHIR ValueSet JSON import/export mappers (P2-TERM)"
```

---

## Task 4: Admin store `valueSets` namespace

**Files:**
- Modify: `packages/db/src/terminology-admin-store.ts`
- Modify: `packages/db/src/terminology-admin-store.test.ts`

- [ ] **Step 1: Decide the import direction (do this first)**

Read `packages/db/package.json` and `packages/terminology/package.json`. `@openldr/terminology` imports `@openldr/db` types (`operations.ts` imports `ConceptRecord`/`MapElement`). To use `expandCompose`/`fhirValueSet` from `@openldr/db` you must avoid a **dependency cycle**.

`expander.ts` and `fhirValueSet.ts` import **nothing** from `@openldr/db` (verify), so the clean options are:
- **Preferred:** add `@openldr/terminology` as a dependency of `@openldr/db` ONLY IF `depcruise`/build reports no cycle. (A cycle is likely since terminology→db already.)
- **If a cycle results (expected):** move `expander.ts` + `fhirValueSet.ts` physically into `@openldr/db` (e.g. `packages/db/src/value-set-expander.ts`, `packages/db/src/fhir-value-set.ts`) and have `@openldr/terminology` **re-export** them: in `packages/terminology/src/expander.ts` and `fhirValueSet.ts` replace the bodies with `export * from '@openldr/db';`-style re-exports of the moved symbols (or thin `export { ... } from '@openldr/db'`). Tasks 2/3 already created them in `@openldr/terminology`; if you choose this path, move the files now and update Task 2/3's import paths in the test files accordingly.

**Record the chosen path in this task's commit message.** The rest of this task imports the symbols as `from '@openldr/terminology'`; if you moved them to `@openldr/db`, import from the local relative path instead.

- [ ] **Step 2: Write failing tests (pg-mem, no projection)**

Append to `packages/db/src/terminology-admin-store.test.ts`. Reuse the file's existing migrated-db helper; if it has no `{ admin, db }` builder, add one at the top of this `describe`:
`const db = await makeMigratedDb(); const admin = createTerminologyAdminStore(db); return { admin, db };`

```ts
describe('valueSets namespace', () => {
  it('saves (insert), expands enumerated concepts, and lists with codeCount', async () => {
    const { admin, db } = await makeStore();
    await db.insertInto('terminology_concepts').values([
      { system: 's1', code: 'A', display: 'Alpha', status: 'ACTIVE', properties: null },
      { system: 's1', code: 'B', display: 'Beta', status: 'ACTIVE', properties: null },
    ] as never).execute();

    const saved = await admin.valueSets.save({
      url: 'urn:test:vs', version: null, name: null, title: 'My set', status: 'active',
      experimental: false, description: null, publisherId: 'pub-system',
      compose: { include: [{ system: 's1', concept: [{ code: 'A' }, { code: 'B' }] }] },
    });
    expect(saved.id).toMatch(/^vs-/);

    const list = await admin.valueSets.list('pub-system');
    expect(list).toHaveLength(1);
    expect(list[0]!.codeCount).toBe(2);
    expect(list[0]!.primarySystem).toBe('s1');
  });

  it('updates by url (no duplicate row) and rejects immutable edits', async () => {
    const { admin, db } = await makeStore();
    const a = await admin.valueSets.save({ url: 'urn:test:vs', version: null, name: null, title: 'v1', status: 'draft', experimental: false, description: null, compose: { include: [] } });
    const b = await admin.valueSets.save({ url: 'urn:test:vs', version: null, name: null, title: 'v2', status: 'draft', experimental: false, description: null, compose: { include: [] } });
    expect(b.id).toBe(a.id);
    expect((await admin.valueSets.list()).length).toBe(1);

    await db.updateTable('value_sets').set({ immutable: true }).where('id', '=', a.id).execute();
    await expect(admin.valueSets.save({ url: 'urn:test:vs', version: null, name: null, title: 'v3', status: 'draft', experimental: false, description: null, compose: { include: [] } }))
      .rejects.toMatchObject({ kind: 'conflict' });
  });

  it('duplicates into an editable copy', async () => {
    const { admin } = await makeStore();
    const a = await admin.valueSets.save({ url: 'urn:test:vs', version: null, name: null, title: 'orig', status: 'active', experimental: false, description: null, compose: { include: [] } });
    const dup = await admin.valueSets.duplicate(a.id);
    expect(dup.id).not.toBe(a.id);
    expect(dup.url).toBe('urn:test:vs-copy');
    expect(dup.immutable).toBe(false);
  });

  it('deletes (cascades the expansion cache)', async () => {
    const { admin, db } = await makeStore();
    await db.insertInto('terminology_concepts').values([{ system: 's1', code: 'A', display: 'Alpha', status: 'ACTIVE', properties: null }] as never).execute();
    const a = await admin.valueSets.save({ url: 'urn:test:vs', version: null, name: null, title: 't', status: 'active', experimental: false, description: null, compose: { include: [{ system: 's1', concept: [{ code: 'A' }] }] } });
    await admin.valueSets.delete(a.id);
    expect(await admin.valueSets.list()).toHaveLength(0);
    const exp = await db.selectFrom('valueset_expansions').selectAll().where('value_set_id', '=', a.id).execute();
    expect(exp).toHaveLength(0);
  });

  it('throws not-found on get/delete of a missing id', async () => {
    const { admin } = await makeStore();
    await expect(admin.valueSets.get('vs-nope')).rejects.toMatchObject({ kind: 'not-found' });
    await expect(admin.valueSets.delete('vs-nope')).rejects.toMatchObject({ kind: 'not-found' });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @openldr/db test -- terminology-admin-store`
Expected: FAIL (`admin.valueSets` is undefined).

- [ ] **Step 4: Add imports + types + interface**

Add to the top imports of `packages/db/src/terminology-admin-store.ts` (path per Step 1's decision):

```ts
import { expandCompose, valueSetToFhirResource, fhirValueSetToInput, type ExpandDeps, type VsCompose, type ExpandedConcept } from '@openldr/terminology';
```

Add types after the existing `Term`/`TermMapping` types:

```ts
export type { VsCompose, ExpandedConcept } from '@openldr/terminology';
export interface ValueSet {
  id: string; url: string; version: string | null; name: string | null; title: string | null;
  status: string; experimental: boolean; description: string | null; compose: VsCompose;
  immutable: boolean; category: string | null; publisherId: string | null;
}
export interface ValueSetSummary {
  id: string; url: string; name: string | null; title: string | null; version: string | null;
  status: string; immutable: boolean; publisherId: string | null; category: string | null;
  codeCount: number; primarySystem: string | null;
}
export interface ValueSetInput {
  url: string; version?: string | null; name?: string | null; title?: string | null;
  status: string; experimental?: boolean; description?: string | null; compose: VsCompose;
  publisherId?: string | null; category?: string | null;
}
export interface ValueSetProjection {
  saveValueSetResource(resource: Record<string, unknown>): Promise<string>;
  registerSystem(url: string, version: string | null, kind: string, resourceId: string): Promise<void>;
  deleteValueSetResource(url: string): Promise<void>;
}
```

Add to the `TerminologyAdminStore` interface:

```ts
  valueSets: {
    list(publisherId?: string): Promise<ValueSetSummary[]>;
    get(id: string): Promise<ValueSet>;
    getByUrl(url: string): Promise<ValueSetSummary | null>;
    save(input: ValueSetInput): Promise<ValueSet>;
    duplicate(id: string): Promise<ValueSet>;
    delete(id: string): Promise<void>;
    expand(id: string, activeOnly?: boolean): Promise<{ codes: ExpandedConcept[]; total: number }>;
    importFhir(resource: unknown): Promise<ValueSet>;
    exportFhir(id: string): Promise<Record<string, unknown>>;
  };
```

Change the factory signature:

```ts
export function createTerminologyAdminStore(db: Kysely<InternalSchema>, projection?: ValueSetProjection): TerminologyAdminStore {
```

- [ ] **Step 5: Implement helpers + namespace**

Inside `createTerminologyAdminStore`, before the final `return {`, add the row mapper, DB-backed deps, and helpers:

```ts
  const vsRow = (r: {
    id: string; url: string; version: string | null; name: string | null; title: string | null;
    status: string; experimental: boolean; description: string | null; compose: unknown;
    immutable: boolean; category: string | null; publisher_id: string | null;
  }): ValueSet => ({
    id: r.id, url: r.url, version: r.version, name: r.name, title: r.title, status: r.status,
    experimental: r.experimental, description: r.description,
    compose: (typeof r.compose === 'string' ? JSON.parse(r.compose) : (r.compose ?? { include: [] })) as VsCompose,
    immutable: r.immutable, category: r.category, publisherId: r.publisher_id,
  });

  const vsDeps: ExpandDeps = {
    async listSystemConcepts(systemUrl, activeOnly) {
      let qb = db.selectFrom('terminology_concepts').select(['system', 'code', 'display']).where('system', '=', systemUrl);
      if (activeOnly) qb = qb.where('status', '=', 'ACTIVE');
      const rows = await qb.orderBy('code').limit(10_000).execute();
      return rows.map((r) => ({ system: r.system, code: r.code, display: r.display }));
    },
    async filterConcepts(systemUrl, filters, activeOnly) {
      let qb = db.selectFrom('terminology_concepts').select(['system', 'code', 'display']).where('system', '=', systemUrl);
      if (activeOnly) qb = qb.where('status', '=', 'ACTIVE');
      for (const f of filters) {
        if (f.property === 'status') qb = qb.where('status', '=', f.value);
        else qb = qb.where(sql`properties->>${f.property}`, '=', f.value);
      }
      const rows = await qb.orderBy('code').limit(10_000).execute();
      return rows.map((r) => ({ system: r.system, code: r.code, display: r.display }));
    },
    async resolveDisplay(systemUrl, code) {
      const r = await db.selectFrom('terminology_concepts').select(['display']).where('system', '=', systemUrl).where('code', '=', code).executeTakeFirst();
      return r?.display ?? null;
    },
    async resolveValueSetCompose(url) {
      const r = await db.selectFrom('value_sets').select(['compose']).where('url', '=', url).executeTakeFirst();
      if (!r) return null;
      return (typeof r.compose === 'string' ? JSON.parse(r.compose) : r.compose) as VsCompose;
    },
  };

  function primarySystemOf(compose: VsCompose): string | null {
    return compose.include?.find((i) => i.system)?.system ?? null;
  }

  async function getValueSet(id: string): Promise<ValueSet> {
    const r = await db.selectFrom('value_sets').selectAll().where('id', '=', id).executeTakeFirst();
    if (!r) throw new TerminologyAdminError(`value set not found: ${id}`, 'not-found');
    return vsRow(r);
  }

  async function refreshCacheAndProject(vs: ValueSet): Promise<void> {
    const { codes } = await expandCompose(vs.compose, vsDeps, { seedUrls: [vs.url] });
    await db.deleteFrom('valueset_expansions').where('value_set_id', '=', vs.id).execute();
    if (codes.length) {
      await db.insertInto('valueset_expansions').values(codes.map((c) => ({
        value_set_id: vs.id, system_url: c.system, code: c.code, display: c.display, inactive: false,
      }))).execute();
    }
    await db.updateTable('value_sets').set({ expanded_at: sql`now()` }).where('id', '=', vs.id).execute();
    if (projection) {
      const resource = valueSetToFhirResource(
        { id: vs.id, url: vs.url, status: vs.status as never, experimental: vs.experimental, version: vs.version, name: vs.name, title: vs.title, description: vs.description, compose: vs.compose },
        codes,
      );
      const resourceId = await projection.saveValueSetResource(resource);
      await projection.registerSystem(vs.url, vs.version, 'ValueSet', resourceId);
    }
  }
```

Add the `valueSets` namespace to the returned object:

```ts
    valueSets: {
      async list(publisherId) {
        let qb = db.selectFrom('value_sets').selectAll();
        if (publisherId) qb = qb.where('publisher_id', '=', publisherId);
        const rows = await qb.orderBy('title').orderBy('url').execute();
        const counts = await db.selectFrom('valueset_expansions')
          .select((eb) => ['value_set_id', eb.fn.countAll<number>().as('n')])
          .groupBy('value_set_id').execute();
        const byId = new Map(counts.map((c) => [c.value_set_id, Number(c.n)]));
        return rows.map((r) => {
          const vs = vsRow(r);
          return {
            id: vs.id, url: vs.url, name: vs.name, title: vs.title, version: vs.version, status: vs.status,
            immutable: vs.immutable, publisherId: vs.publisherId, category: vs.category,
            codeCount: byId.get(vs.id) ?? 0, primarySystem: primarySystemOf(vs.compose),
          };
        });
      },
      get: getValueSet,
      async getByUrl(url) {
        const r = await db.selectFrom('value_sets').selectAll().where('url', '=', url).executeTakeFirst();
        if (!r) return null;
        const vs = vsRow(r);
        const c = await db.selectFrom('valueset_expansions').select((eb) => eb.fn.countAll<number>().as('n')).where('value_set_id', '=', vs.id).executeTakeFirst();
        return { id: vs.id, url: vs.url, name: vs.name, title: vs.title, version: vs.version, status: vs.status, immutable: vs.immutable, publisherId: vs.publisherId, category: vs.category, codeCount: Number(c?.n ?? 0), primarySystem: primarySystemOf(vs.compose) };
      },
      async save(input) {
        const url = input.url.trim();
        if (!url) throw new TerminologyAdminError('value set url required', 'conflict');
        const existing = await db.selectFrom('value_sets').select(['id', 'immutable']).where('url', '=', url).executeTakeFirst();
        if (existing?.immutable) throw new TerminologyAdminError('this value set is immutable — duplicate it to make changes', 'conflict');
        const id = existing?.id ?? newId('vs');
        const composeJson = JSON.stringify(input.compose ?? { include: [] });
        if (existing) {
          await db.updateTable('value_sets').set({
            version: input.version ?? null, name: input.name ?? null, title: input.title ?? null,
            status: input.status, experimental: input.experimental ?? false, description: input.description ?? null,
            compose: composeJson as never, category: input.category ?? null, publisher_id: input.publisherId ?? null,
            updated_at: sql`now()`,
          }).where('id', '=', id).execute();
        } else {
          await db.insertInto('value_sets').values({
            id, url, version: input.version ?? null, name: input.name ?? null, title: input.title ?? null,
            status: input.status, experimental: input.experimental ?? false, description: input.description ?? null,
            compose: composeJson as never, immutable: false, category: input.category ?? null, publisher_id: input.publisherId ?? null,
          } as never).execute();
        }
        const vs = await getValueSet(id);
        await refreshCacheAndProject(vs);
        return vs;
      },
      async duplicate(id) {
        const src = await getValueSet(id);
        let url = `${src.url}-copy`;
        let n = 2;
        while (await db.selectFrom('value_sets').select('id').where('url', '=', url).executeTakeFirst()) { url = `${src.url}-copy-${n++}`; }
        return this.save({
          url, version: src.version, name: src.name, title: src.title ? `${src.title} (copy)` : null,
          status: 'draft', experimental: src.experimental, description: src.description, compose: src.compose,
          publisherId: src.publisherId, category: src.category,
        });
      },
      async delete(id) {
        const r = await db.selectFrom('value_sets').select(['url']).where('id', '=', id).executeTakeFirst();
        if (!r) throw new TerminologyAdminError(`value set not found: ${id}`, 'not-found');
        await db.deleteFrom('valueset_expansions').where('value_set_id', '=', id).execute(); // explicit for pg-mem
        await db.deleteFrom('value_sets').where('id', '=', id).execute();
        if (projection) await projection.deleteValueSetResource(r.url);
      },
      async expand(id, activeOnly = true) {
        const vs = await getValueSet(id);
        const result = await expandCompose(vs.compose, vsDeps, { activeOnly, seedUrls: [vs.url] });
        await db.deleteFrom('valueset_expansions').where('value_set_id', '=', id).execute();
        if (result.codes.length) {
          await db.insertInto('valueset_expansions').values(result.codes.map((c) => ({
            value_set_id: id, system_url: c.system, code: c.code, display: c.display, inactive: false,
          }))).execute();
        }
        await db.updateTable('value_sets').set({ expanded_at: sql`now()` }).where('id', '=', id).execute();
        return result;
      },
      async importFhir(resource) {
        const input = fhirValueSetToInput(resource);
        const saved = await this.save(input);
        await db.updateTable('value_sets').set({ source_json: JSON.stringify(resource) as never }).where('id', '=', saved.id).execute();
        return saved;
      },
      async exportFhir(id) {
        const vs = await getValueSet(id);
        const rows = await db.selectFrom('valueset_expansions').select(['system_url', 'code', 'display']).where('value_set_id', '=', id).execute();
        const codes: ExpandedConcept[] = rows.map((r) => ({ system: r.system_url, code: r.code, display: r.display }));
        return valueSetToFhirResource({ id: vs.id, url: vs.url, status: vs.status as never, experimental: vs.experimental, version: vs.version, name: vs.name, title: vs.title, description: vs.description, compose: vs.compose }, codes);
      },
    },
```

> `this.save`/`this.get` inside arrow-bearing object literals: the namespace uses method shorthand (`async save()`), so `this` is the `valueSets` object — `this.save` works. `get: getValueSet` and the standalone `getValueSet`/`refreshCacheAndProject` helpers avoid `this` where convenient. Keep it consistent: if lint flags `this` usage, call the module-level `getValueSet(id)` helper instead of `this.get(id)` inside `duplicate`/`save`/`expand`/`importFhir`/`exportFhir`.

- [ ] **Step 6: Run tests to verify pass**

Run: `pnpm --filter @openldr/db test -- terminology-admin-store`
Expected: PASS (existing SP1/SP2 tests + 5 new valueSets tests).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/terminology-admin-store.ts packages/db/src/terminology-admin-store.test.ts packages/db/package.json packages/terminology
git commit -m "feat(db): valueSets admin-store namespace (expand+cache+projection) (P2-TERM)

Import-direction decision: <state which path was taken — terminology dep added, or expander/fhirValueSet moved into @openldr/db and re-exported>."
```

---

## Task 5: Migration 014 seeds (local code system + seed value sets)

**Files:**
- Modify: `packages/db/src/migrations/internal/014_value_sets.ts`
- Modify: `packages/db/src/migrations/internal/014_value_sets.test.ts`

The migration seeds a local code system + its concepts, the six seed ValueSets (compose + materialized expansion + projected FHIR resource + `terminology_systems` registration), all idempotent. The migration has the raw `db` (not the store), so it writes the projection rows directly using `valueSetToFhirResource`.

- [ ] **Step 1: Verify the `fhir_resources` shape**

Read `packages/db/src/migrations/internal/001_fhir_resources.ts`. Note the exact column names the table requires (the seed insert below assumes `id`, `resource_type`, `resource`). If they differ (e.g. `data` jsonb, `version_id`, NOT NULL timestamps), adjust the `fhir_resources` insert in Step 3 to match. This is the only place the migration touches that table.

- [ ] **Step 2: Write failing test**

Append to `packages/db/src/migrations/internal/014_value_sets.test.ts`:

```ts
describe('014_value_sets seeds', () => {
  it('seeds the local code system, concepts, and six value sets with expansions', async () => {
    const db = await makeMigratedDb();
    const sets = await db.selectFrom('value_sets').select(['url', 'status']).execute();
    const urls = sets.map((s) => s.url);
    expect(urls).toContain('urn:openldr:valueset:yes-no');
    expect(urls).toContain('urn:openldr:valueset:hiv-result');
    expect(sets).toHaveLength(6);

    const yn = await db.selectFrom('value_sets').select('id').where('url', '=', 'urn:openldr:valueset:yes-no').executeTakeFirstOrThrow();
    const exp = await db.selectFrom('valueset_expansions').select(['code']).where('value_set_id', '=', yn.id).orderBy('code').execute();
    expect(exp.map((e) => e.code)).toEqual(['N', 'Y']);

    const sys = await db.selectFrom('terminology_systems').select(['kind']).where('url', '=', 'urn:openldr:valueset:yes-no').executeTakeFirst();
    expect(sys?.kind).toBe('ValueSet');
    await db.destroy();
  });
});
```

- [ ] **Step 3: Add the seed block to the migration**

In `packages/db/src/migrations/internal/014_value_sets.ts`, add `import { valueSetToFhirResource } from '@openldr/terminology';` (or the local path if you moved it in Task 4 Step 1) at top, and at the end of `up()` add:

```ts
  // ── Seeds (idempotent) ──────────────────────────────────────────────────────
  const LOCAL_CS = 'urn:openldr:cs:local';
  const PUB = 'pub-system';

  await db.insertInto('coding_systems').values({
    id: 'cs-openldr-local', system_code: 'LOCAL', system_name: 'OpenLDR Local Codes',
    url: LOCAL_CS, system_version: null, description: 'Local enumerated codes for seed value sets',
    active: true, publisher_id: PUB, seeded: true,
  } as never).onConflict((oc) => oc.column('url').doNothing()).execute();

  const SEEDS: { slug: string; title: string; status: string; concepts: [string, string][] }[] = [
    { slug: 'yes-no', title: 'Yes / No', status: 'active', concepts: [['Y', 'Yes'], ['N', 'No']] },
    { slug: 'biological-sex', title: 'Biological Sex', status: 'active', concepts: [['M', 'Male'], ['F', 'Female'], ['O', 'Other'], ['U', 'Unknown']] },
    { slug: 'result-interpretation', title: 'Result Interpretation', status: 'active', concepts: [['POS', 'Positive'], ['NEG', 'Negative'], ['IND', 'Indeterminate']] },
    { slug: 'specimen-type', title: 'Specimen Type', status: 'draft', concepts: [['BLD', 'Blood'], ['UR', 'Urine'], ['CSF', 'CSF'], ['SPT', 'Sputum']] },
    { slug: 'malaria-species', title: 'Malaria Species', status: 'draft', concepts: [['PF', 'P. falciparum'], ['PV', 'P. vivax'], ['PM', 'P. malariae'], ['PO', 'P. ovale']] },
    { slug: 'hiv-result', title: 'HIV Result', status: 'draft', concepts: [['R', 'Reactive'], ['NR', 'Non-reactive'], ['IND', 'Indeterminate']] },
  ];

  const conceptKeys = new Set<string>();
  for (const s of SEEDS) for (const [code, display] of s.concepts) {
    if (conceptKeys.has(code)) continue;
    conceptKeys.add(code);
    await db.insertInto('terminology_concepts').values({ system: LOCAL_CS, code, display, status: 'ACTIVE', properties: null } as never)
      .onConflict((oc) => oc.columns(['system', 'code']).doNothing()).execute();
  }

  for (const s of SEEDS) {
    const url = `urn:openldr:valueset:${s.slug}`;
    const id = `vs-seed-${s.slug}`;
    const compose = { include: [{ system: LOCAL_CS, concept: s.concepts.map(([code, display]) => ({ code, display })) }] };
    await db.insertInto('value_sets').values({
      id, url, version: null, name: s.slug, title: s.title, status: s.status, experimental: false,
      description: null, compose: JSON.stringify(compose) as never, immutable: false, category: null, publisher_id: PUB,
      expanded_at: sql`now()`,
    } as never).onConflict((oc) => oc.column('url').doNothing()).execute();

    for (const [code, display] of s.concepts) {
      await db.insertInto('valueset_expansions').values({ value_set_id: id, system_url: LOCAL_CS, code, display, inactive: false } as never)
        .onConflict((oc) => oc.columns(['value_set_id', 'system_url', 'code']).doNothing()).execute();
    }

    const resource = valueSetToFhirResource(
      { id, url, status: s.status as never, experimental: false, version: null, name: s.slug, title: s.title, description: null, compose },
      s.concepts.map(([code, display]) => ({ system: LOCAL_CS, code, display })),
    );
    await db.insertInto('fhir_resources').values({
      id, resource_type: 'ValueSet', resource: JSON.stringify(resource),
    } as never).onConflict((oc) => oc.column('id').doNothing()).execute();
    await db.insertInto('terminology_systems').values({ url, version: null, kind: 'ValueSet', resource_id: id } as never)
      .onConflict((oc) => oc.column('url').doNothing()).execute();
  }
```

> Adjust the `fhir_resources` insert columns to match Step 1's findings if they differ.

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @openldr/db test -- 014_value_sets`
Expected: PASS (tables + seeds, six value sets, yes-no expands to N,Y, registered as ValueSet).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/internal/014_value_sets.ts packages/db/src/migrations/internal/014_value_sets.test.ts
git commit -m "feat(db): seed local code system + six editable seed value sets (014) (P2-TERM)"
```

---

## Task 6: Upgrade `operations.ts` to the full expander

**Files:**
- Modify: `packages/terminology/src/operations.ts`
- Modify: `packages/terminology/src/operations.test.ts`

- [ ] **Step 1: Update/extend the tests**

In `packages/terminology/src/operations.test.ts`, keep the existing single-include test passing and add a multi-clause case. If the file lacks a reusable `ConceptSource` stub builder, add a minimal `makeSource({ concepts, resources })` at the top implementing `getConcept`/`findConcepts` (honoring `system`/`codes`/`property`)/`countConcepts`/`getResourceByUrl`/`translate`, and route the existing single-include resource through it.

```ts
it('expands a multi-include ValueSet with an exclude', async () => {
  const source = makeSource({
    concepts: { 's1': [{ code: 'A', display: 'Alpha', status: 'ACTIVE' }, { code: 'B', display: 'Beta', status: 'ACTIVE' }], 's2': [{ code: 'Z', display: 'Zeta', status: 'ACTIVE' }] },
    resources: { 'urn:vs:multi': { resourceType: 'ValueSet', url: 'urn:vs:multi', status: 'active', compose: { include: [{ system: 's1' }, { system: 's2' }], exclude: [{ system: 's1', concept: [{ code: 'B' }] }] } } },
  });
  const ops = createOperations(source);
  const vs = await ops.expand('urn:vs:multi', {});
  expect(vs.expansion?.contains?.map((c) => c.code)).toEqual(['A', 'Z']);
});
```

- [ ] **Step 2: Run to verify the new test fails**

Run: `pnpm --filter @openldr/terminology test -- operations`
Expected: FAIL (current expand throws `'Slice A supports exactly one compose.include'`).

- [ ] **Step 3: Rewrite expand + validateCode to use `expandCompose`**

In `packages/terminology/src/operations.ts`, add `import { expandCompose, type ExpandDeps, type VsCompose } from './expander';`. Add a deps builder and replace the bodies of `expand` and the `valueSetUrl` branch of `validateCode`. Delete the now-unused `includeConcepts` helper.

```ts
function makeDeps(source: ConceptSource): ExpandDeps {
  return {
    async listSystemConcepts(system, activeOnly) {
      const rows = await source.findConcepts({ system, limit: 10_000, offset: 0 });
      return rows.filter((r) => !activeOnly || r.status === 'ACTIVE' || r.status == null)
        .map((r) => ({ system: r.system, code: r.code, display: r.display }));
    },
    async filterConcepts(system, filters, activeOnly) {
      const f = filters[0];
      if (!f || (f.op !== '=' && f.op !== 'equals')) throw new TerminologyError(`filter op '${f?.op}' unsupported`, 'invalid');
      const rows = await source.findConcepts({ system, property: { name: f.property, value: f.value }, limit: 10_000, offset: 0 });
      return rows.filter((r) => !activeOnly || r.status === 'ACTIVE' || r.status == null)
        .map((r) => ({ system: r.system, code: r.code, display: r.display }));
    },
    async resolveDisplay(system, code) {
      const c = await source.getConcept(system, code);
      return c?.display ?? null;
    },
    async resolveValueSetCompose(url) {
      const vs = valueSetOf(await source.getResourceByUrl(url));
      return (vs?.compose as VsCompose | undefined) ?? null;
    },
  };
}
```

```ts
  async function expand(url: string, opts: ExpandOptions): Promise<ValueSet> {
    const vs = await loadValueSet(url);
    const { codes, total } = await expandCompose((vs.compose ?? { include: [] }) as VsCompose, makeDeps(source), { seedUrls: [url] });
    const offset = opts.offset ?? 0;
    const count = opts.count ?? 100;
    const page = codes.slice(offset, offset + count);
    return { ...vs, expansion: { total, offset, contains: page.map((c) => ({ system: c.system, code: c.code, display: c.display ?? undefined })) } };
  }
```

```ts
      if ('valueSetUrl' in input) {
        const vs = await loadValueSet(input.valueSetUrl);
        const { codes } = await expandCompose((vs.compose ?? { include: [] }) as VsCompose, makeDeps(source), { seedUrls: [input.valueSetUrl] });
        const ok = codes.some((c) => c.code === input.code && (!input.system || c.system === input.system));
        return { result: ok, message: ok ? `${input.code} is in ${input.valueSetUrl}` : `${input.code} not in ${input.valueSetUrl}` };
      }
```

> Remove the `ConceptRecord` import if it becomes unused after deleting `includeConcepts` (lint will flag it). Keep `valueSetOf` imported from `./source`.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @openldr/terminology test -- operations`
Expected: PASS (single-include + multi-include + validate-code).

- [ ] **Step 5: Commit**

```bash
git add packages/terminology/src/operations.ts packages/terminology/src/operations.test.ts
git commit -m "feat(terminology): \$expand/\$validate-code use full expandCompose (multi-clause) (P2-TERM)"
```

---

## Task 7: Wire the projection in bootstrap

**Files:**
- Modify: `packages/bootstrap/src/terminology-context.ts`
- Modify: `packages/bootstrap/src/index.ts`

- [ ] **Step 1: Confirm `fhirStore.save` return type**

Read `packages/bootstrap/src/fhir-store.ts` and note what `save()` returns (resource, id, or void). The projection below normalizes to an id string; if `save` returns void, use the resource's own `id` (the admin store always sets `resource.id = vs.id`).

- [ ] **Step 2: Build the projection in `terminology-context.ts`**

In `packages/bootstrap/src/terminology-context.ts`, after `const store = createTerminologyStore(db, fhirStore);` and before `const admin = createTerminologyAdminStore(db);`, build a projection and pass it:

```ts
  const projection = {
    async saveValueSetResource(resource: Record<string, unknown>): Promise<string> {
      const saved = await fhirStore.save(resource as never);
      return (saved as { id?: string })?.id ?? String((resource as { id?: string }).id ?? '');
    },
    async registerSystem(url: string, version: string | null, kind: string, resourceId: string): Promise<void> {
      await store.saveSystem(url, version, kind, resourceId);
    },
    async deleteValueSetResource(url: string): Promise<void> {
      await db.deleteFrom('terminology_systems').where('url', '=', url).execute();
    },
  };
  const admin = createTerminologyAdminStore(db, projection);
```

(Remove the old `const admin = createTerminologyAdminStore(db);` line.)

- [ ] **Step 3: Mirror the wiring in `index.ts`**

In `packages/bootstrap/src/index.ts`, find `const termAdmin = createTerminologyAdminStore(internal.db as unknown as Kysely<InternalSchema>);` (~line 129) and the nearby `termFhirStore` + `termStore`. Build the same `projection` from `termFhirStore.save` + `termStore.saveSystem` + a `terminology_systems` delete on `internal.db` (cast as `Kysely<InternalSchema>` like the existing lines), and pass it as the second argument:

```ts
  const termProjection = {
    async saveValueSetResource(resource: Record<string, unknown>): Promise<string> {
      const saved = await termFhirStore.save(resource as never);
      return (saved as { id?: string })?.id ?? String((resource as { id?: string }).id ?? '');
    },
    async registerSystem(url: string, version: string | null, kind: string, resourceId: string): Promise<void> {
      await termStore.saveSystem(url, version, kind, resourceId);
    },
    async deleteValueSetResource(url: string): Promise<void> {
      await (internal.db as unknown as Kysely<InternalSchema>).deleteFrom('terminology_systems').where('url', '=', url).execute();
    },
  };
  const termAdmin = createTerminologyAdminStore(internal.db as unknown as Kysely<InternalSchema>, termProjection);
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @openldr/bootstrap typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/terminology-context.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): wire value-set projection into the admin store (P2-TERM)"
```

---

## Task 8: REST routes for value sets

**Files:**
- Modify: `apps/server/src/terminology-admin-routes.ts`

- [ ] **Step 1: Add the zod schema + routes**

In `apps/server/src/terminology-admin-routes.ts`, after the Term Mappings block (before the closing `}` of `registerTerminologyAdminRoutes`), add:

```ts
  // ── Value Sets ────────────────────────────────────────────────────────────
  const composeClause = z.object({
    system: z.string().optional(),
    version: z.string().optional(),
    concept: z.array(z.object({ code: z.string(), display: z.string().optional() })).optional(),
    filter: z.array(z.object({ property: z.string(), op: z.string(), value: z.string() })).optional(),
    valueSet: z.array(z.string()).optional(),
  });
  const valueSetInput = z.object({
    url: z.string().min(1),
    version: z.string().nullish(),
    name: z.string().nullish(),
    title: z.string().nullish(),
    status: z.enum(['draft', 'active', 'retired']),
    experimental: z.boolean().optional(),
    description: z.string().nullish(),
    compose: z.object({ include: z.array(composeClause).optional(), exclude: z.array(composeClause).optional() }),
    publisherId: z.string().nullish(),
    category: z.string().nullish(),
  });

  app.get('/api/terminology/valuesets', async (req) => {
    const { publisherId } = req.query as { publisherId?: string };
    return admin.valueSets.list(publisherId);
  });
  app.post('/api/terminology/valuesets', async (req, reply) => {
    const parsed = valueSetInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try { const saved = await admin.valueSets.save(parsed.data); reply.code(201); return saved; }
    catch (e) { return mapErr(e, reply); }
  });
  app.get('/api/terminology/valuesets/:id', async (req, reply) => {
    try { return await admin.valueSets.get((req.params as IdParam).id); }
    catch (e) { return mapErr(e, reply); }
  });
  app.put('/api/terminology/valuesets/:id', async (req, reply) => {
    const parsed = valueSetInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try { return await admin.valueSets.save(parsed.data); }
    catch (e) { return mapErr(e, reply); }
  });
  app.delete('/api/terminology/valuesets/:id', async (req, reply) => {
    try { await admin.valueSets.delete((req.params as IdParam).id); reply.code(204); return null; }
    catch (e) { return mapErr(e, reply); }
  });
  app.post('/api/terminology/valuesets/:id/duplicate', async (req, reply) => {
    try { const dup = await admin.valueSets.duplicate((req.params as IdParam).id); reply.code(201); return dup; }
    catch (e) { return mapErr(e, reply); }
  });
  app.get('/api/terminology/valuesets/:id/expand', async (req, reply) => {
    try {
      const { activeOnly } = req.query as { activeOnly?: string };
      return await admin.valueSets.expand((req.params as IdParam).id, activeOnly !== 'false');
    } catch (e) { return mapErr(e, reply); }
  });
  app.post('/api/terminology/valuesets/import', async (req, reply) => {
    try { const saved = await admin.valueSets.importFhir(req.body); reply.code(201); return saved; }
    catch (e) { return mapErr(e, reply); }
  });
  app.get('/api/terminology/valuesets/:id/export', async (req, reply) => {
    try {
      const resource = await admin.valueSets.exportFhir((req.params as IdParam).id);
      reply.header('content-type', 'application/fhir+json');
      reply.header('content-disposition', `attachment; filename="${(req.params as IdParam).id}.json"`);
      return resource;
    } catch (e) { return mapErr(e, reply); }
  });
```

> `importFhir` passes `req.body` straight through; `fhirValueSetToInput` validates it and throws a plain `Error` on bad input → `mapErr` returns 500. That's acceptable for now (malformed FHIR = parse error). Leave as-is.

- [ ] **Step 2: Typecheck + run server tests**

Run: `pnpm --filter @openldr/server typecheck` then `pnpm --filter @openldr/server test`
Expected: PASS (existing route tests green; new routes typecheck).

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/terminology-admin-routes.ts
git commit -m "feat(server): /api/terminology/valuesets CRUD + duplicate/expand/import/export (P2-TERM)"
```

---

## Task 9: CLI `valueset list`

**Files:**
- Modify: `packages/cli/src/terminology.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Add the runner**

In `packages/cli/src/terminology.ts`, append:

```ts
export async function runValueSetList(opts: { publisher?: string; json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const rows = await ctx.admin.valueSets.list(opts.publisher);
    if (opts.json) console.log(JSON.stringify(rows, null, 2));
    else for (const v of rows) console.log(`${v.url}\t${v.title ?? v.name ?? '—'}\t${v.status}\t${v.codeCount} codes`);
    return 0;
  } catch (err) { process.stderr.write(`terminology valueset list failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}
```

- [ ] **Step 2: Register the subcommand**

In `packages/cli/src/index.ts`, find where `terminology term list` is registered (calls `runTermList`) and add a sibling `terminology valueset list` subcommand wired to `runValueSetList`, mirroring the exact option style there (`--publisher`, `--json`). Match the existing command framework syntax in that file verbatim.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @openldr/cli typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/terminology.ts packages/cli/src/index.ts
git commit -m "feat(cli): terminology valueset list (P2-TERM)"
```

---

## Task 10: Web API client (valuesets)

**Files:**
- Modify: `apps/web/src/api.ts`

- [ ] **Step 1: Add types + client fns**

Read the top of `apps/web/src/api.ts` and the SP2 `searchTerms`/`saveTerm` fns to copy the **exact** request idiom (the fetch wrapper names, base path, headers, error handling). Then add (replace `apiGet`/`apiPost`/`apiDelete` with the real helper names):

```ts
export interface ValueSetComposeConcept { code: string; display?: string }
export interface ValueSetComposeClause {
  system?: string; version?: string;
  concept?: ValueSetComposeConcept[];
  filter?: { property: string; op: string; value: string }[];
  valueSet?: string[];
}
export interface ValueSetCompose { include?: ValueSetComposeClause[]; exclude?: ValueSetComposeClause[] }
export interface ValueSet {
  id: string; url: string; version: string | null; name: string | null; title: string | null;
  status: string; experimental: boolean; description: string | null; compose: ValueSetCompose;
  immutable: boolean; category: string | null; publisherId: string | null;
}
export interface ValueSetSummary {
  id: string; url: string; name: string | null; title: string | null; version: string | null;
  status: string; immutable: boolean; publisherId: string | null; category: string | null;
  codeCount: number; primarySystem: string | null;
}
export interface ValueSetInput {
  url: string; version?: string | null; name?: string | null; title?: string | null;
  status: string; experimental?: boolean; description?: string | null; compose: ValueSetCompose;
  publisherId?: string | null; category?: string | null;
}
export interface ExpandedCode { system: string; code: string; display: string | null }

export const listValueSets = (publisherId?: string): Promise<ValueSetSummary[]> =>
  apiGet(`/api/terminology/valuesets${publisherId ? `?publisherId=${encodeURIComponent(publisherId)}` : ''}`);
export const getValueSet = (id: string): Promise<ValueSet> => apiGet(`/api/terminology/valuesets/${id}`);
export const saveValueSet = (input: ValueSetInput): Promise<ValueSet> => apiPost('/api/terminology/valuesets', input);
export const deleteValueSet = (id: string): Promise<void> => apiDelete(`/api/terminology/valuesets/${id}`);
export const duplicateValueSet = (id: string): Promise<ValueSet> => apiPost(`/api/terminology/valuesets/${id}/duplicate`, {});
export const expandValueSet = (id: string, activeOnly = true): Promise<{ codes: ExpandedCode[]; total: number }> =>
  apiGet(`/api/terminology/valuesets/${id}/expand?activeOnly=${activeOnly}`);
export const importValueSet = (resource: unknown): Promise<ValueSet> => apiPost('/api/terminology/valuesets/import', resource);
export const valueSetExportUrl = (id: string): string => `/api/terminology/valuesets/${id}/export`;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @openldr/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api.ts
git commit -m "feat(web): value-set API client + types (P2-TERM)"
```

---

## Task 11: `publisherSections` third argument

**Files:**
- Modify: `apps/web/src/terminology/publisherSections.ts`
- Modify: `apps/web/src/terminology/publisherSections.test.ts`

- [ ] **Step 1: Update the test**

Read the existing `publisherSections.test.ts`. Update calls to pass a third `valueSets` arg and assert each section carries `.valueSets`. Add a case:

```ts
it('attaches value sets to their publisher section and keeps seeded publishers visible', () => {
  const publishers = [{ id: 'pub-system', name: 'System', role: 'local', icon: null, seeded: true, sortOrder: 0 }];
  const systems: never[] = [];
  const valueSets = [{ id: 'vs-1', url: 'urn:vs', name: null, title: 'YN', version: null, status: 'active', immutable: false, publisherId: 'pub-system', category: null, codeCount: 2, primarySystem: 'urn:cs' }];
  const sections = publisherSections(publishers as never, systems, valueSets as never);
  expect(sections).toHaveLength(1);
  expect(sections[0]!.valueSets).toHaveLength(1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @openldr/web test -- publisherSections`
Expected: FAIL (signature takes 2 args / sections lack `.valueSets`).

- [ ] **Step 3: Update the helper**

In `apps/web/src/terminology/publisherSections.ts`, add the `valueSets` param + field. **Preserve the existing publisher-visibility + sorting logic from SP1** — only add the new param and the `.valueSets` filter:

```ts
import type { Publisher, CodingSystem, ValueSetSummary } from '../api';

export interface PublisherSection {
  publisher: Publisher;
  systems: CodingSystem[];
  valueSets: ValueSetSummary[];
}

export function publisherSections(
  publishers: Publisher[], systems: CodingSystem[], valueSets: ValueSetSummary[] = [],
): PublisherSection[] {
  // (Keep SP1's "show ALL publishers, seeded always visible" + sort logic.)
  return publishers
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((publisher) => ({
      publisher,
      systems: systems.filter((s) => s.publisherId === publisher.id),
      valueSets: valueSets.filter((v) => v.publisherId === publisher.id),
    }));
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @openldr/web test -- publisherSections`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/terminology/publisherSections.ts apps/web/src/terminology/publisherSections.test.ts
git commit -m "feat(web): publisherSections carries value sets per publisher (P2-TERM)"
```

---

## Task 12: `ValueSetPicker` component

**Files:**
- Create: `apps/web/src/terminology/ValueSetPicker.tsx`

Port of corlix `ValueSetPicker.tsx` — typeahead over `listValueSets()`, English strings instead of `t()`.

- [ ] **Step 1: Implement**

Create `apps/web/src/terminology/ValueSetPicker.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { listValueSets, type ValueSetSummary } from '../api';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';

interface Props {
  onPick: (valueSet: ValueSetSummary) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

/** Typeahead over locally-curated ValueSets; loads once, filters client-side. */
export function ValueSetPicker({ onPick, placeholder, autoFocus, className }: Props): JSX.Element {
  const [all, setAll] = useState<ValueSetSummary[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void listValueSets()
      .then((rows) => { if (!cancelled) setAll(rows); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? all.filter((v) => [v.title, v.name, v.url].some((s) => s?.toLowerCase().includes(q))) : all;
    return pool.slice(0, 20);
  }, [all, query]);

  return (
    <div ref={containerRef} className={className ? `relative ${className}` : 'relative'}>
      <Input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder ?? 'Search value sets…'}
        aria-label={placeholder ?? 'Search value sets'}
        autoFocus={autoFocus}
        className="h-9 text-sm"
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          {loading ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">Loading…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">No value sets found.</div>
          ) : (
            results.map((vs) => (
              <button
                key={vs.id}
                type="button"
                onClick={() => { onPick(vs); setOpen(false); setQuery(''); }}
                className="flex w-full items-start gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-foreground">{vs.title ?? vs.name ?? vs.url}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{vs.url}</p>
                </div>
                <Badge variant="outline" className="shrink-0 text-[10px] uppercase tracking-wide">
                  {vs.codeCount} codes
                </Badge>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @openldr/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/terminology/ValueSetPicker.tsx
git commit -m "feat(web): ValueSetPicker typeahead (ported from corlix) (P2-TERM)"
```

---

## Task 13: `ValueSetBuilder` component

**Files:**
- Create: `apps/web/src/terminology/ValueSetBuilder.tsx`

Port of corlix `ValueSetBuilder.tsx`. Differences: `window.api.terminology.*` → `api.ts` fns; `t(...)` → English literals; preview via `expandValueSet(savedId)`; publishers from `listPublishers()`.

- [ ] **Step 1: Ensure the `Label` primitive exists**

Confirm `apps/web/src/components/ui/label.tsx` exists (added during SP1's advanced Variables work). If missing, create the standard shadcn `Label` primitive first.

- [ ] **Step 2: Implement**

Create `apps/web/src/terminology/ValueSetBuilder.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import {
  saveValueSet, expandValueSet, listPublishers,
  type ValueSet, type ValueSetInput, type ValueSetComposeClause,
  type ExpandedCode, type CodingSystem, type Publisher,
} from '../api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { ValueSetPicker } from './ValueSetPicker';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';

interface ValueSetBuilderProps {
  valueSet: ValueSet | null;
  systems: CodingSystem[];
  defaultPublisherId?: string;
  onSaved: (saved: ValueSet) => void;
  onCancel: () => void;
  onExport?: (id: string) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
}

const SENTINEL_NO_SYSTEM = '__none__';
type EditableClause = ValueSetComposeClause & { _key: string };

function emptyClause(): EditableClause {
  return { _key: crypto.randomUUID(), system: undefined, concept: [] };
}
function stripKey(inc: EditableClause): ValueSetComposeClause {
  const rest: Partial<EditableClause> = { ...inc };
  delete rest._key;
  return rest as ValueSetComposeClause;
}

export function ValueSetBuilder({
  valueSet, systems, defaultPublisherId, onSaved, onCancel, onExport, onDelete, onDuplicate,
}: ValueSetBuilderProps): JSX.Element {
  const readOnly = valueSet?.immutable ?? false;

  const [url, setUrl] = useState(valueSet?.url ?? '');
  const [title, setTitle] = useState(valueSet?.title ?? '');
  const [version, setVersion] = useState(valueSet?.version ?? '');
  const [status, setStatus] = useState<string>(valueSet?.status ?? 'draft');
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [publisherId, setPublisherId] = useState<string>(valueSet?.publisherId ?? defaultPublisherId ?? '');
  const [includes, setIncludes] = useState<EditableClause[]>(() =>
    valueSet?.compose.include?.length
      ? valueSet.compose.include.map((inc) => ({ ...inc, _key: crypto.randomUUID() }))
      : [emptyClause()],
  );
  const [excludes, setExcludes] = useState<EditableClause[]>(
    (valueSet?.compose.exclude ?? []).map((c) => ({ _key: crypto.randomUUID(), ...c })),
  );
  const [preview, setPreview] = useState<ExpandedCode[]>([]);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(valueSet?.id ?? null);
  const [error, setError] = useState<string | null>(null);

  const composeInput = useMemo<ValueSetInput>(() => ({
    url: url.trim(),
    title: title.trim() || null,
    version: version.trim() || null,
    status,
    publisherId: publisherId || undefined,
    compose: {
      include: includes.map(stripKey),
      ...(excludes.length ? { exclude: excludes.map(stripKey) } : {}),
    },
  }), [url, title, version, status, publisherId, includes, excludes]);

  const refreshPreview = useCallback(async (id: string) => {
    setPreviewBusy(true);
    try {
      const exp = await expandValueSet(id, true);
      setPreview(exp?.codes ?? []);
    } catch (e) { setError((e as Error).message); }
    finally { setPreviewBusy(false); }
  }, []);

  useEffect(() => { void listPublishers().then(setPublishers); }, []);
  useEffect(() => { if (valueSet?.id) void refreshPreview(valueSet.id); }, [valueSet?.id, refreshPreview]);

  const handleSave = async (): Promise<void> => {
    if (!composeInput.url) { setError('A canonical URL is required.'); return; }
    setError(null);
    try {
      const saved = await saveValueSet(composeInput);
      setSavedId(saved.id);
      onSaved(saved);
      await refreshPreview(saved.id);
    } catch (e) { setError((e as Error).message); }
  };

  // ── Include handlers ──────────────────────────────────────────────────────
  const updateInclude = (i: number, patch: Partial<ValueSetComposeClause>): void =>
    setIncludes((prev) => prev.map((inc, j) => (j === i ? { ...inc, ...patch } : inc)));
  const removeInclude = (i: number): void => setIncludes((prev) => prev.filter((_, j) => j !== i));
  const addConcept = (i: number): void =>
    setIncludes((prev) => prev.map((inc, j) => (j === i ? { ...inc, concept: [...(inc.concept ?? []), { code: '', display: '' }] } : inc)));
  const updateConcept = (i: number, k: number, field: 'code' | 'display', value: string): void =>
    setIncludes((prev) => prev.map((inc, j) => {
      if (j !== i) return inc;
      const concept = [...(inc.concept ?? [])];
      concept[k] = { ...concept[k]!, [field]: value };
      return { ...inc, concept };
    }));
  const removeConcept = (i: number, k: number): void =>
    setIncludes((prev) => prev.map((inc, j) => (j === i ? { ...inc, concept: (inc.concept ?? []).filter((_, x) => x !== k) } : inc)));
  const importValueSetClause = (vsUrl: string): void => {
    if (includes.some((i) => i.valueSet?.includes(vsUrl))) return;
    setIncludes((prev) => [...prev, { _key: crypto.randomUUID(), valueSet: [vsUrl] }]);
  };

  // ── Exclude handlers ──────────────────────────────────────────────────────
  const updateExclude = (i: number, patch: Partial<ValueSetComposeClause>): void =>
    setExcludes((prev) => prev.map((exc, j) => (j === i ? { ...exc, ...patch } : exc)));
  const removeExclude = (i: number): void => setExcludes((prev) => prev.filter((_, j) => j !== i));
  const addExcludeConcept = (i: number): void =>
    setExcludes((prev) => prev.map((exc, j) => (j === i ? { ...exc, concept: [...(exc.concept ?? []), { code: '', display: '' }] } : exc)));
  const updateExcludeConcept = (i: number, k: number, field: 'code' | 'display', value: string): void =>
    setExcludes((prev) => prev.map((exc, j) => {
      if (j !== i) return exc;
      const concept = [...(exc.concept ?? [])];
      concept[k] = { ...concept[k]!, [field]: value };
      return { ...exc, concept };
    }));
  const removeExcludeConcept = (i: number, k: number): void =>
    setExcludes((prev) => prev.map((exc, j) => (j === i ? { ...exc, concept: (exc.concept ?? []).filter((_, x) => x !== k) } : exc)));

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3">
      <div className="-mx-3 -mt-3 flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="min-w-0 truncate text-sm font-medium text-foreground">{title.trim() || 'New value set'}</h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!readOnly && (
              <DropdownMenuItem onClick={() => void handleSave()} disabled={!composeInput.url}>Save</DropdownMenuItem>
            )}
            {readOnly && valueSet && onDuplicate && (
              <DropdownMenuItem onClick={() => onDuplicate(valueSet.id)}>Duplicate</DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onCancel}>Cancel</DropdownMenuItem>
            {savedId && (
              <DropdownMenuItem disabled={previewBusy} onClick={() => void refreshPreview(savedId)}>Re-expand</DropdownMenuItem>
            )}
            {savedId && onExport && (
              <DropdownMenuItem onClick={() => onExport(savedId)}>Export</DropdownMenuItem>
            )}
            {savedId && onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(savedId)}>Delete</DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
      {readOnly && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">This value set is immutable (standard catalog). Duplicate it to make changes.</div>}

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Canonical URL</Label>
          <Input className="h-8 text-sm" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="urn:openldr:valueset:my-set" disabled={readOnly} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Title</Label>
          <Input className="h-8 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Version</Label>
          <Input className="h-8 text-sm" value={version} onChange={(e) => setVersion(e.target.value)} disabled={readOnly} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select value={status} onValueChange={setStatus} disabled={readOnly}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="retired">Retired</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Publisher</Label>
          <Select value={publisherId} onValueChange={setPublisherId} disabled={readOnly}>
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select a publisher" /></SelectTrigger>
            <SelectContent>
              {publishers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Compose — include clauses */}
      <div className="space-y-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Include</div>
        {includes.map((inc, i) => {
          if (inc.valueSet?.length) {
            return (
              <div key={inc._key} className="flex items-center gap-2 rounded-md border border-border p-2 text-xs">
                <span className="text-muted-foreground">↳</span>
                <span className="font-medium">Imports</span>
                <span className="flex-1 truncate font-mono text-primary">{inc.valueSet.join(', ')}</span>
                <button type="button" className="ml-auto px-1 text-muted-foreground hover:text-destructive" onClick={() => removeInclude(i)} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            );
          }
          return (
            <div key={inc._key} className="space-y-2 rounded-md border border-border p-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs">System</Label>
                <Select value={inc.system ?? SENTINEL_NO_SYSTEM} onValueChange={(v) => updateInclude(i, { system: v === SENTINEL_NO_SYSTEM ? undefined : v })}>
                  <SelectTrigger className="h-7 w-72 text-xs"><SelectValue placeholder="Pick a system" /></SelectTrigger>
                  <SelectContent>
                    {systems.map((s) => (
                      <SelectItem key={s.id} value={s.url ?? s.systemCode}>
                        <span className="font-mono text-xs">{s.systemCode}</span>
                        {s.url && <span className="ml-2 text-muted-foreground">{s.url}</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button type="button" className="ml-auto px-1 text-muted-foreground hover:text-destructive" onClick={() => removeInclude(i)} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
              <div className="space-y-1 pl-2">
                {(inc.concept ?? []).map((c, k) => (
                  <div key={k} className="flex items-center gap-1">
                    <Input className="h-7 w-28 text-xs" value={c.code} onChange={(e) => updateConcept(i, k, 'code', e.target.value)} placeholder="code" />
                    <Input className="h-7 flex-1 text-xs" value={c.display ?? ''} onChange={(e) => updateConcept(i, k, 'display', e.target.value)} placeholder="display (optional)" />
                    <button type="button" className="px-1 text-muted-foreground hover:text-destructive" onClick={() => removeConcept(i, k)} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
                <button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80" onClick={() => addConcept(i)}><Plus className="h-3 w-3" /> Add concept</button>
              </div>
            </div>
          );
        })}
        {!readOnly && (
          <div className="space-y-1">
            <Label className="text-xs">Import another value set</Label>
            <ValueSetPicker onPick={(vs) => importValueSetClause(vs.url)} placeholder="Search value sets to import…" />
          </div>
        )}
        {!readOnly && (
          <button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80" onClick={() => setIncludes((prev) => [...prev, emptyClause()])}><Plus className="h-3 w-3" /> Add include</button>
        )}
      </div>

      {/* Compose — exclude clauses */}
      <div className="space-y-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Exclude</div>
        {excludes.map((exc, i) => (
          <div key={exc._key} className="space-y-2 rounded-md border border-border p-2">
            <div className="flex items-center gap-2">
              <Label className="text-xs">System</Label>
              <Select value={exc.system ?? SENTINEL_NO_SYSTEM} onValueChange={(v) => updateExclude(i, { system: v === SENTINEL_NO_SYSTEM ? undefined : v })}>
                <SelectTrigger className="h-7 w-72 text-xs"><SelectValue placeholder="Pick a system" /></SelectTrigger>
                <SelectContent>
                  {systems.map((s) => (
                    <SelectItem key={s.id} value={s.url ?? s.systemCode}>
                      <span className="font-mono text-xs">{s.systemCode}</span>
                      {s.url && <span className="ml-2 text-muted-foreground">{s.url}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button type="button" className="ml-auto px-1 text-muted-foreground hover:text-destructive" onClick={() => removeExclude(i)} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            <div className="space-y-1 pl-2">
              {(exc.concept ?? []).map((c, k) => (
                <div key={k} className="flex items-center gap-1">
                  <Input className="h-7 w-28 text-xs" value={c.code} onChange={(e) => updateExcludeConcept(i, k, 'code', e.target.value)} placeholder="code" />
                  <Input className="h-7 flex-1 text-xs" value={c.display ?? ''} onChange={(e) => updateExcludeConcept(i, k, 'display', e.target.value)} placeholder="display (optional)" />
                  <button type="button" className="px-1 text-muted-foreground hover:text-destructive" onClick={() => removeExcludeConcept(i, k)} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              <button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80" onClick={() => addExcludeConcept(i)}><Plus className="h-3 w-3" /> Add concept</button>
            </div>
          </div>
        ))}
        {!readOnly && (
          <button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80" onClick={() => setExcludes((prev) => [...prev, emptyClause()])}><Plus className="h-3 w-3" /> Add exclude</button>
        )}
      </div>

      {/* Live expansion preview */}
      <div className="flex-1 rounded-md border border-dashed border-border p-2">
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Expansion ({preview.length})</div>
        {savedId == null ? (
          <p className="text-xs text-muted-foreground">Save to preview the expansion.</p>
        ) : preview.length === 0 ? (
          <p className="text-xs text-muted-foreground">Expansion is empty.</p>
        ) : (
          <ul className="space-y-0.5">
            {preview.map((c) => (
              <li key={`${c.system}|${c.code}`} className="flex items-baseline gap-2 text-xs">
                <span className="font-mono text-primary">{c.code}</span>
                <span className="text-foreground">{c.display ?? '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @openldr/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/terminology/ValueSetBuilder.tsx
git commit -m "feat(web): ValueSetBuilder (ported from corlix) (P2-TERM)"
```

---

## Task 14: Wire the Terminology page (toggle + list + kebab submenus + builder Sheet)

**Files:**
- Modify: `apps/web/src/pages/Terminology.tsx`

This is the integration task. Follow corlix `TerminologyPage.tsx` exactly.

- [ ] **Step 1: Imports + state**

Add imports: `useRef` to the React import; `Select, SelectContent, SelectItem, SelectTrigger, SelectValue` from `../components/ui/select`; `Sheet, SheetContent, SheetHeader, SheetTitle` from `../components/ui/sheet`; `ValueSetBuilder` from `../terminology/ValueSetBuilder`; from `../api`: `listValueSets, getValueSet, deleteValueSet, duplicateValueSet, importValueSet, valueSetExportUrl, type ValueSet, type ValueSetSummary`.

Add state:

```tsx
  const [valueSets, setValueSets] = useState<ValueSetSummary[]>([]);
  const [paneTab, setPaneTab] = useState<'systems' | 'valuesets'>('systems');
  const [vsSearch, setVsSearch] = useState('');
  const [vsSystem, setVsSystem] = useState('__all__');
  const [editingValueSet, setEditingValueSet] = useState<ValueSet | null>(null);
  const [valueSetEditorOpen, setValueSetEditorOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 2: Load value sets + pass to `publisherSections`**

```tsx
  const reload = (): Promise<void> =>
    Promise.all([listPublishers(), listCodingSystems(), listValueSets()])
      .then(([p, s, v]) => { setPublishers(p); setCodingSystems(s); setValueSets(v); })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
```

Update **both** `publisherSections(...)` call sites to `publisherSections(publishers, codingSystems, valueSets)`.

- [ ] **Step 3: Derived flags + reset on publisher change**

Add near the other derived values:

```tsx
  const bothKinds = !!activeSection && activeSection.systems.length > 0 && activeSection.valueSets.length > 0;
  const filteredValueSets = (activeSection?.valueSets ?? []).filter((vs) => {
    if (vsSystem !== '__all__' && vs.primarySystem !== vsSystem) return false;
    const q = vsSearch.trim().toLowerCase();
    if (!q) return true;
    return (vs.title ?? '').toLowerCase().includes(q) || vs.url.toLowerCase().includes(q) || (vs.name ?? '').toLowerCase().includes(q);
  });
  const vsSystemOptions = Array.from(new Set((activeSection?.valueSets ?? []).map((v) => v.primarySystem).filter((s): s is string => !!s)));
  const systemLabel = (url: string): string => codingSystems.find((s) => s.url === url)?.systemCode ?? url.split('/').pop() ?? url;
```

In the publisher-change `useEffect`, also reset: `setPaneTab('systems'); setVsSearch(''); setVsSystem('__all__');`.

Add handlers:

```tsx
  const openValueSet = async (id: string): Promise<void> => {
    try { setEditingValueSet(await getValueSet(id)); setValueSetEditorOpen(true); }
    catch (e) { setToast({ kind: 'error', text: e instanceof Error ? e.message : String(e) }); }
  };
  const handleValueSetDuplicate = async (id: string): Promise<void> => {
    try { const dup = await duplicateValueSet(id); await reload(); setEditingValueSet(dup); setValueSetEditorOpen(true); }
    catch (e) { setToast({ kind: 'error', text: e instanceof Error ? e.message : String(e) }); }
  };
  const handleValueSetDelete = (vs: ValueSetSummary): void => {
    setConfirm({
      title: 'Delete value set', confirmName: vs.title ?? vs.url, confirmLabel: 'Delete',
      summary: <span>Permanently delete &ldquo;{vs.title ?? vs.url}&rdquo;? This cannot be undone.</span>,
      onConfirm: async () => {
        try { await deleteValueSet(vs.id); setConfirm(null); await reload(); setToast({ kind: 'ok', text: 'Value set deleted.' }); }
        catch (e) { setConfirm(null); setToast({ kind: 'error', text: e instanceof Error ? e.message : String(e) }); }
      },
    });
  };
  const handleVsImportFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const json = JSON.parse(await file.text());
      const saved = await importValueSet(json);
      await reload();
      setToast({ kind: 'ok', text: `Imported value set "${saved.title ?? saved.url}".` });
    } catch (err) { setToast({ kind: 'error', text: err instanceof Error ? err.message : String(err) }); }
  };
```

> `setConfirm`'s `ConfirmState` (defined in this file) requires `onConfirm` to be a plain function; an `async () => {}` is fine. The `confirm`/`DangerConfirmDialog` rendering already exists — reuse it.

- [ ] **Step 4: Hidden file input**

Render once inside the root `<div className="ui-scope …">`: `<input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={(e) => void handleVsImportFile(e)} />`.

- [ ] **Step 5: Segmented toggle**

In the breadcrumb, after the system label and before `<div className="flex-1" />`:

```tsx
                  {bothKinds && !selectedSystemId && (
                    <div className="ml-3 inline-flex items-center gap-0.5 rounded-md border border-border p-0.5">
                      <button type="button" onClick={() => setPaneTab('systems')}
                        className={`rounded px-2 py-0.5 text-[11px] ${paneTab === 'systems' ? 'bg-[rgba(70,130,180,0.16)] text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>Code systems</button>
                      <button type="button" onClick={() => setPaneTab('valuesets')}
                        className={`rounded px-2 py-0.5 text-[11px] ${paneTab === 'valuesets' ? 'bg-[rgba(70,130,180,0.16)] text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>Value sets</button>
                    </div>
                  )}
```

- [ ] **Step 6: Kebab Term + Value set submenus**

In the breadcrumb `⋯` `<DropdownMenuContent>`, after the existing "Code system" `DropdownMenuSub`, add:

```tsx
                      {/* Term sub-menu — acts on the open code system */}
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>Term</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          {activeSection.publisher.role !== 'external' && (
                            <DropdownMenuItem disabled={!selectedSystem} onClick={() => { if (selectedSystem) { setEditingTerm(null); setTermDialogOpen(true); } }}>New</DropdownMenuItem>
                          )}
                          <DropdownMenuItem disabled={!selectedSystem} onClick={() => { if (selectedSystem) setSelectedSystemId(selectedSystem.id); }}>Import…</DropdownMenuItem>
                          <DropdownMenuItem disabled={!selectedSystem} asChild>
                            <a href={selectedSystem ? `/api/terminology/systems/${selectedSystem.id}/terms/template.csv` : '#'} download>Download template</a>
                          </DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>

                      {/* Value set sub-menu */}
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>Value set</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem onClick={() => { setEditingValueSet(null); setValueSetEditorOpen(true); }}>New</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>Import…</DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
```

> The Term submenu's "Import…" honestly cannot trigger `TermsTable`'s internal file dialog from the page without lifting state, so it drills into the system (where the real Import button lives) — corlix's Term submenu likewise acts on the open system. Do NOT render a control that looks like it imports but does nothing. "Download template" is a real `<a download>` and works as-is.

- [ ] **Step 7: Value-set list table**

After the code-systems table block (sibling to it), gated as shown:

```tsx
                {activeSection.valueSets.length > 0 && !selectedSystemId && (!bothKinds || paneTab === 'valuesets') && (
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                      <Select value={vsSystem} onValueChange={setVsSystem}>
                        <SelectTrigger className="h-8 w-56 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All systems</SelectItem>
                          {vsSystemOptions.map((u) => <SelectItem key={u} value={u}><span className="font-mono text-xs">{systemLabel(u)}</span></SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Input value={vsSearch} onChange={(e) => setVsSearch(e.target.value)} placeholder="Search value sets…" className="h-8 max-w-md text-sm" />
                    </div>
                    <div className="flex-1 overflow-auto">
                      <Table>
                        <TableHeader className="sticky top-0 z-10 bg-background">
                          <TableRow>
                            <TableHead className="text-xs uppercase tracking-wide">Title</TableHead>
                            <TableHead className="text-xs uppercase tracking-wide">URL</TableHead>
                            <TableHead className="w-32 text-xs uppercase tracking-wide">System</TableHead>
                            <TableHead className="w-24 text-xs uppercase tracking-wide">Source</TableHead>
                            <TableHead className="w-20 text-right text-xs uppercase tracking-wide">Codes</TableHead>
                            <TableHead className="w-24 text-xs uppercase tracking-wide">Status</TableHead>
                            <TableHead className="w-12" />
                          </TableRow>
                        </TableHeader>
                        <TableBody className="[&_tr:last-child]:border-b">
                          {filteredValueSets.length === 0 ? (
                            <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No value sets found.</TableCell></TableRow>
                          ) : filteredValueSets.map((vs) => (
                            <TableRow key={vs.id} className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]" onClick={() => void openValueSet(vs.id)}>
                              <TableCell className="text-foreground">{vs.title ?? vs.name ?? '—'}</TableCell>
                              <TableCell className="font-mono text-[11px] text-muted-foreground">{vs.url}</TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">{vs.primarySystem ? systemLabel(vs.primarySystem) : '—'}</TableCell>
                              <TableCell>{vs.category ? <Badge variant="secondary">{vs.category}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                              <TableCell className="text-right font-mono text-xs">{vs.codeCount}</TableCell>
                              <TableCell><Badge variant="outline" className="text-[10px] uppercase">{vs.status}</Badge></TableCell>
                              <TableCell onClick={(e) => e.stopPropagation()}>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => void openValueSet(vs.id)}>{vs.immutable ? 'View' : 'Edit'}</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => void handleValueSetDuplicate(vs.id)}>Duplicate</DropdownMenuItem>
                                    <DropdownMenuItem asChild><a href={valueSetExportUrl(vs.id)} download>Export</a></DropdownMenuItem>
                                    {!vs.immutable && (<><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleValueSetDelete(vs)}>Delete</DropdownMenuItem></>)}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
```

> The code-systems table is currently shown when `activeSection.systems.length > 0 && !selectedSystemId`. Add `&& (!bothKinds || paneTab === 'systems')` to its gate so the two panes don't stack when a publisher has both.

- [ ] **Step 8: Builder Sheet**

Near the other dialogs at the bottom of the component:

```tsx
        <Sheet open={valueSetEditorOpen} onOpenChange={(o) => { if (!o) { setValueSetEditorOpen(false); setEditingValueSet(null); } }}>
          <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl">
            <SheetHeader className="border-b border-border px-3 py-2">
              <SheetTitle className="text-sm">{editingValueSet?.title ?? editingValueSet?.url ?? 'New value set'}</SheetTitle>
            </SheetHeader>
            {valueSetEditorOpen && (
              <ValueSetBuilder
                key={editingValueSet?.id ?? 'new'}
                valueSet={editingValueSet}
                systems={codingSystems}
                defaultPublisherId={selectedPublisherId}
                onSaved={() => void reload()}
                onCancel={() => { setValueSetEditorOpen(false); setEditingValueSet(null); }}
                onExport={(id) => { window.location.href = valueSetExportUrl(id); }}
                onDelete={(id) => { const vs = valueSets.find((v) => v.id === id); if (vs) handleValueSetDelete(vs); }}
                onDuplicate={(id) => void handleValueSetDuplicate(id)}
              />
            )}
          </SheetContent>
        </Sheet>
```

- [ ] **Step 9: Typecheck + manual smoke**

Run: `pnpm --filter @openldr/web typecheck`
Expected: PASS. (Optional: `pnpm --filter @openldr/web dev`, open `/terminology`, select System, toggle to Value sets, see six seeds, open one → expansion shows.)

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/Terminology.tsx
git commit -m "feat(web): value-set list + toggle + Term/Value-set kebab submenus + builder Sheet (P2-TERM)"
```

---

## Task 15: e2e — value-set authoring flow

**Files:**
- Modify: `e2e/tests/terminology.spec.ts`

- [ ] **Step 1: Add the spec**

Append (builds on the SP2 create-system flow; `RUN` already declared at top of file):

```ts
test('terminology SP3: create system → add term → author a value set → preview expands', async ({ page }) => {
  const SYS_CODE = `VS${RUN}`;
  const SYS_URL = `http://e2e.test/vs/${RUN}`;
  const VS_URL = `urn:e2e:valueset:${RUN}`;

  await page.goto('/terminology');
  await page.getByRole('button', { name: 'System' }).first().click();

  await page.getByRole('button', { name: 'Actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Code system' }).click();
  await page.getByRole('menuitem', { name: 'New' }).first().click();
  await page.getByLabel('System code').fill(SYS_CODE);
  await page.getByLabel('System name').fill('E2E VS System');
  await page.getByLabel('Canonical URL').fill(SYS_URL);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText(SYS_CODE)).toBeVisible();

  await page.getByText(SYS_CODE).click();
  await page.getByRole('button', { name: 'New term' }).click();
  await page.locator('#termCode').fill('T1');
  await page.locator('#termDisplay').fill('Test term');
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Create' }).click();
  await expect(page.getByText('T1')).toBeVisible();

  await page.getByRole('button', { name: '← Code systems' }).click();
  await page.getByRole('button', { name: 'Actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Value set' }).click();
  await page.getByRole('menuitem', { name: 'New' }).first().click();

  await page.getByLabel('Canonical URL').fill(VS_URL);
  await page.getByLabel('Title').fill(`E2E VS ${RUN}`);
  await page.locator('[role="dialog"]').getByRole('combobox').filter({ hasText: 'Pick a system' }).first().click();
  await page.getByRole('option', { name: new RegExp(SYS_CODE) }).click();
  await page.getByRole('button', { name: 'Add concept' }).first().click();
  await page.locator('[role="dialog"] input[placeholder="code"]').first().fill('T1');
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Save' }).click();

  await expect(page.locator('[role="dialog"]').getByText('T1')).toBeVisible();
});
```

> The Radix Select `combobox`/`option` markup may not match `getByRole` cleanly — if so, open the trigger and click the item by visible text instead. If nested-Sheet focus traps make the in-sheet preview flaky in headless Chromium (as the SP2 mapping step was), degrade the final assertion to: close the sheet and assert the new value set appears in the list (`page.getByText(VS_URL)`). Prefer the preview assertion; degrade only if proven flaky, and leave a comment saying which path was kept and why.

- [ ] **Step 2: Run e2e**

Run: `pnpm e2e` (reseed Postgres first with `db reset --force` + WHONET ingest, per the e2e package README / SP2 acceptance).
Expected: PASS (existing specs + the new one).

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/terminology.spec.ts
git commit -m "test(e2e): value-set authoring + expansion preview flow (P2-TERM)"
```

---

## Task 16: Live-PG acceptance, gates, docs, memory

**Files:** (no new source) — verification + `pnpm docs:screenshots` + memory update.

- [ ] **Step 1: Reseed + migrate live Postgres**

Run (adapt to the repo's documented commands; same as SP2 acceptance):
```bash
pnpm --filter @openldr/cli exec node dist/index.js db reset --force
pnpm --filter @openldr/cli exec node dist/index.js db migrate
```
Expected: migration `014_value_sets` runs; six seed value sets present.

- [ ] **Step 2: Verify the serve path on a multi-clause authored set**

Author a value set via the API (e.g. two includes + an exclude over the local system) and:
```bash
curl -s "http://localhost:3000/fhir/ValueSet/\$expand?url=urn:openldr:valueset:yes-no" | jq '.expansion.total'
curl -s "http://localhost:3000/fhir/ValueSet/\$validate-code?url=urn:openldr:valueset:yes-no&code=Y" | jq
```
Expected: `$expand` total ≥ 2 for yes-no; `$validate-code` positive for `Y`, negative for a bogus code; an authored **multi-include** set also expands (the SP3 upgrade). Record commands + outputs in the commit message.

- [ ] **Step 3: Gates**

Run: `pnpm turbo typecheck lint test build` then `pnpm depcruise`
Expected: all green. Fix any cross-package drift, and **confirm `depcruise` reports no `@openldr/db` ↔ `@openldr/terminology` dependency cycle** (the Task 4 Step 1 decision must leave the graph acyclic).

- [ ] **Step 4: Regenerate docs screenshots**

Run: `pnpm docs:screenshots`
Expected: regenerated PNGs incl. the Terminology Value sets view. Review the diff.

- [ ] **Step 5: Update project memory**

Append an SP3 entry to `C:\Users\Fredrick\.claude\projects\D--Projects-Repositories-openldr-ce\memory\openldr-ce-build-plan.md`: SP3 merged; `value_sets`/`valueset_expansions` + migration 014; ported `expandCompose` + `operations.ts` upgrade (multi-clause `$expand`/`$validate-code`); the projection pattern; six seed value sets; the now-complete kebab (Publisher/Code system/Term/Value set); note the import-direction decision from Task 4. Note SP4 (ontology browser + hierarchy) remains.

- [ ] **Step 6: Commit + finish the branch**

```bash
git add -A
git commit -m "chore(terminology): SP3 live acceptance + docs screenshots + memory (P2-TERM)"
```
Then use **superpowers:finishing-a-development-branch** to merge SP3 to `main` (Option 1, local merge), per SP1/SP2.

---

## Self-Review

**Spec coverage:** §1 data model → T1+T5; §2 expander → T2; §2 operations upgrade → T6; §3 FHIR JSON → T3; §4 admin store → T4; §5 projection → T4 (param) + T7 (wiring) + T5 (seed projection); §6 REST → T8; §7 CLI → T9; §8 api client → T10; §9 UI (publisherSections/page/builder/picker) → T11–T14; §10 testing → spread across T1–T6 + T15 + T16; §11 non-goals → not built (correct). All covered.

**Type consistency:** `VsCompose`/`VsInclude`/`VsFilter`/`ExpandedConcept` defined in T2, reused in T3/T4/T6. `ValueSet`/`ValueSetSummary`/`ValueSetInput` defined in T4 (db) mirror the web copies in T10 (api.ts) — intentional duplication across the package boundary (apps/web doesn't import @openldr/db), matching the SP1/SP2 `Publisher`/`Term` pattern. `ValueSetComposeClause` (web) ↔ `VsInclude` (terminology) carry the same fields. `createTerminologyAdminStore(db, projection?)` signature change applied in T4 and consumed in T7 (both bootstrap callsites). `ValueSetProjection` shape identical in T4 (definition), T7 (both implementations).

**Risks flagged in-plan (not hidden):** (a) `@openldr/db`↔`@openldr/terminology` import direction — Task 4 Step 1 resolves it explicitly with a fallback (move expander into db, re-export), verified acyclic in T16 Step 3; (b) `fhir_resources` column names (T5 Step 1) and `fhirStore.save` return type (T7 Step 1) — verify-before-write steps; (c) Term-submenu "Import…" can't trigger `TermsTable`'s internal dialog without lifting state — plan chooses honest drill-in over a fake control; (d) e2e nested-Sheet flakiness — documented degrade path.
