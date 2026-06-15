# Terminology Management UI — SP2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the drilled-into-a-code-system pane with a server-side-searched Terms table + a faithful Term dialog (Details + full Mappings tabs), a Term mapping dialog with draft-target-term creation, a term typeahead picker, and CSV import/template — all projecting into the existing flat read index + `$translate` map.

**Architecture:** Terms are `terminology_concepts` rows (extra fields in `properties` jsonb); a new `term_mappings` table is the authoring source of truth and projects into `concept_map_elements` (keeping `$translate` live) with draft-target-term auto-creation. Server-side `searchConcepts` powers the table + the mapping picker at LOINC scale. The 4 read ops + ingest stay untouched. Builds on the SP1 admin store / routes / page.

**Tech Stack:** Kysely (Postgres), Fastify, Zod, csv-parse, React + Vite + Radix/shadcn, Vitest, pg-mem, Playwright. Spec: `docs/superpowers/specs/2026-06-15-terminology-ui-sp2-design.md`.

**Conventions (from CLAUDE.md / memory):**
- Commits scoped to requirement IDs, **no `Co-authored-by` trailer**.
- DP-1: only `@openldr/bootstrap` imports adapters; this SP adds no adapter. `apps/server` does NOT depend on `@openldr/db` — use the existing duck-type `TerminologyAdminError` guard pattern in routes. Keep `pnpm depcruise` clean.
- jsonb columns: `JSON.stringify` a JS object/array before inserting (node-pg coerces a JS array to a PG array literal otherwise).
- shadcn-always in `apps/web`.
- Gates from repo root: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm depcruise`, `pnpm build:check`.

---

## File Structure

**packages/db:**
- Modify `src/schema/internal.ts` — add `TermMappingsTable` + register.
- Create `src/migrations/internal/013_term_mappings.ts` (+ register in `migrations/internal/index.ts`).
- Modify `src/terminology-store.ts` — add `searchConcepts` + `countConceptsSearch`.
- Modify `src/terminology-admin-store.ts` — add `terms` + `termMappings` namespaces + types.
- Tests alongside.

**packages/terminology:**
- Create `src/terms-csv.ts` — parse/template for the terms CSV (+ test). Export from index.

**apps/server:**
- Modify `src/terminology-admin-routes.ts` — terms + mappings routes.
- Modify `src/app.test.ts` — route tests.

**packages/cli:**
- Modify `src/terminology.ts` + `src/index.ts` — `terminology term list`.

**apps/web:**
- Create `src/components/ui/tooltip.tsx`, `src/components/ui/confirm-dialog.tsx`.
- Modify `src/api.ts` — terms + mappings types + client fns.
- Create `src/terminology/statusBadge.ts`, `TermPicker.tsx`, `TermsTable.tsx`, `TermDialog.tsx`, `TermMappingDialog.tsx` (+ tests).
- Modify `src/pages/Terminology.tsx` — replace the drilled placeholder with `<TermsTable>` + mount `TermDialog`.
- Modify `e2e/tests/terminology.spec.ts`.

---

## Task 1: Migration `013_term_mappings` + schema type

**Files:**
- Modify: `packages/db/src/schema/internal.ts`
- Create: `packages/db/src/migrations/internal/013_term_mappings.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Test: `packages/db/src/migrations/internal/013_term_mappings.test.ts`

- [ ] **Step 1: Add the table type.** In `packages/db/src/schema/internal.ts`, add after `CodingSystemsTable` (and register in `InternalSchema` after `coding_systems`):

```typescript
export interface TermMappingsTable {
  id: string;
  from_system: string;
  from_code: string;
  to_system: string;
  to_code: string;
  to_display: string | null;
  map_type: string;
  relationship: string | null;
  owner: string | null;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}
```
```typescript
  term_mappings: TermMappingsTable;
```

- [ ] **Step 2: Write the migration.** Create `packages/db/src/migrations/internal/013_term_mappings.ts`:

```typescript
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('term_mappings')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('from_system', 'text', (c) => c.notNull())
    .addColumn('from_code', 'text', (c) => c.notNull())
    .addColumn('to_system', 'text', (c) => c.notNull())
    .addColumn('to_code', 'text', (c) => c.notNull())
    .addColumn('to_display', 'text')
    .addColumn('map_type', 'text', (c) => c.notNull())
    .addColumn('relationship', 'text')
    .addColumn('owner', 'text')
    .addColumn('is_active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('term_mappings_from').ifNotExists().on('term_mappings').columns(['from_system', 'from_code']).execute();
  await db.schema.createIndex('term_mappings_to').ifNotExists().on('term_mappings').columns(['to_system', 'to_code']).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('term_mappings').ifExists().execute();
}
```

- [ ] **Step 3: Register.** In `packages/db/src/migrations/internal/index.ts` add `import * as m013 from './013_term_mappings';` and the map entry `'013_term_mappings': { up: m013.up, down: m013.down },` after `012`.

- [ ] **Step 4: Write the test.** Create `013_term_mappings.test.ts` using the SAME pg-mem migrated-db helper the `012_terminology_admin.test.ts` uses (import or replicate it). Insert one mapping row and select it back; assert the two indexes don't error. Also update `packages/db/src/migrations/migrations.test.ts` if it has a hardcoded key-count/list assertion (it does — add `'013_term_mappings'`).

```typescript
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './012_terminology_admin.test'; // or replicate the helper
describe('013_term_mappings', () => {
  it('creates term_mappings', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('term_mappings').values({ id: 'm1', from_system: 'http://a', from_code: 'x', to_system: 'http://b', to_code: 'y', map_type: 'SAME-AS' }).execute();
    expect(await db.selectFrom('term_mappings').selectAll().execute()).toHaveLength(1);
    await db.destroy();
  });
});
```

- [ ] **Step 5: Run** `pnpm --filter @openldr/db test -- 013_term_mappings` (+ the migrations test) → PASS. `pnpm --filter @openldr/db typecheck` → clean.

- [ ] **Step 6: Commit**
```bash
git add packages/db/src/schema/internal.ts packages/db/src/migrations/internal/013_term_mappings.ts packages/db/src/migrations/internal/index.ts packages/db/src/migrations/internal/013_term_mappings.test.ts packages/db/src/migrations/migrations.test.ts
git commit -m "feat(db): term_mappings table — migration 013 (P2-TERM)"
```

---

## Task 2: `searchConcepts` in the read store

**Files:**
- Modify: `packages/db/src/terminology-store.ts`
- Test: `packages/db/src/terminology-store.test.ts` (create if absent; the read store had no unit test in SP1 — add one using pg-mem migrated db)

- [ ] **Step 1: Write the failing test.** Create/extend `terminology-store.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createTerminologyStore } from './terminology-store';
import { createFhirStore } from './fhir-store';
import { makeMigratedDb } from './migrations/internal/012_terminology_admin.test';

describe('searchConcepts', () => {
  async function seeded() {
    const db = await makeMigratedDb();
    const store = createTerminologyStore(db as never, createFhirStore(db as never));
    await store.upsertConcepts([
      { system: 'http://x', code: 'AMP', display: 'Ampicillin', status: 'ACTIVE', properties: null },
      { system: 'http://x', code: 'CIP', display: 'Ciprofloxacin', status: 'DRAFT', properties: null },
      { system: 'http://x', code: 'GEN', display: 'Gentamicin', status: 'ACTIVE', properties: null },
    ]);
    return { db, store };
  }
  it('filters by text on code or display (case-insensitive)', async () => {
    const { store } = await seeded();
    const rows = await store.searchConcepts({ systemUrl: 'http://x', query: 'cipro', limit: 10, offset: 0 });
    expect(rows.map((r) => r.code)).toEqual(['CIP']);
  });
  it('filters by status and counts', async () => {
    const { store } = await seeded();
    const rows = await store.searchConcepts({ systemUrl: 'http://x', statuses: ['ACTIVE'], limit: 10, offset: 0 });
    expect(rows.map((r) => r.code).sort()).toEqual(['AMP', 'GEN']);
    expect(await store.countConceptsSearch({ systemUrl: 'http://x', statuses: ['ACTIVE'] })).toBe(2);
  });
});
```

- [ ] **Step 2: Run → FAIL** (`searchConcepts` not defined).

- [ ] **Step 3: Implement.** In `terminology-store.ts`, add to the `TerminologyStore` interface and the returned object:

```typescript
// interface additions:
  searchConcepts(q: { systemUrl: string; query?: string; statuses?: string[]; limit: number; offset: number }): Promise<ConceptRecord[]>;
  countConceptsSearch(q: { systemUrl: string; query?: string; statuses?: string[] }): Promise<number>;
```
```typescript
// implementation (add inside createTerminologyStore's returned object).
// Shared filter builder — note ILIKE for case-insensitive contains.
function applySearch<T>(qb: T, q: { systemUrl: string; query?: string; statuses?: string[] }): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let b = qb as any;
  b = b.where('system', '=', q.systemUrl);
  if (q.query && q.query.trim()) {
    const like = `%${q.query.trim()}%`;
    b = b.where((eb: any) => eb.or([eb('code', 'ilike', like), eb('display', 'ilike', like)]));
  }
  if (q.statuses && q.statuses.length) b = b.where('status', 'in', q.statuses);
  return b as T;
}
// methods:
    async searchConcepts(q) {
      let qb = db.selectFrom('terminology_concepts').selectAll();
      qb = applySearch(qb, q);
      const rows = await qb.orderBy('code').limit(q.limit).offset(q.offset).execute();
      return rows.map((r) => ({ ...r, properties: r.properties as Record<string, unknown> | null }));
    },
    async countConceptsSearch(q) {
      let qb = db.selectFrom('terminology_concepts').select((eb) => eb.fn.countAll<number>().as('n'));
      qb = applySearch(qb, q);
      const row = await qb.executeTakeFirst();
      return Number(row?.n ?? 0);
    },
```
NOTE: pg-mem supports `ilike` — confirm by running the test. If pg-mem rejects `ilike`, lower-case both sides with `sql` (`where(sql\`lower(code)\`, 'like', like.toLowerCase())`) and note it.

- [ ] **Step 4: Run → PASS.** `pnpm --filter @openldr/db test -- terminology-store`.

- [ ] **Step 5: Commit**
```bash
git add packages/db/src/terminology-store.ts packages/db/src/terminology-store.test.ts
git commit -m "feat(db): server-side searchConcepts (text + status + paging) (P2-TERM)"
```

---

## Task 3: Admin store `terms` namespace (CRUD + properties mapping + mappingCount)

**Files:**
- Modify: `packages/db/src/terminology-admin-store.ts`
- Test: `packages/db/src/terminology-admin-store.test.ts` (extend)

READ `terminology-admin-store.ts` first (the `TerminologyAdminStore` interface + `createTerminologyAdminStore` return object — you'll add a `terms` namespace alongside `publishers`/`codingSystems`). It receives `Kysely<InternalSchema>`. It needs the read store's search; rather than depend on it, the `terms` namespace queries `terminology_concepts` directly via the same `db`.

- [ ] **Step 1: Write the failing test.** Add to `terminology-admin-store.test.ts`:

```typescript
describe('terms', () => {
  it('creates a term with structured properties and reads them back', async () => {
    const { s } = await store();
    const t = await s.terms.create({ system: 'http://x', code: 'AMP', display: 'Ampicillin', status: 'ACTIVE', shortName: 'Amp', class: 'ABX', unit: null, replacedBy: null, metadata: { rxnorm: '1' } });
    expect(t.shortName).toBe('Amp');
    expect(t.class).toBe('ABX');
    const page = await s.terms.search('http://x', { limit: 10, offset: 0 });
    expect(page.total).toBe(1);
    expect(page.rows[0].metadata).toEqual({ rxnorm: '1' });
  });
  it('updates and deletes a term', async () => {
    const { s } = await store();
    await s.terms.create({ system: 'http://x', code: 'AMP', display: 'A', status: 'ACTIVE', shortName: null, class: null, unit: null, replacedBy: null, metadata: null });
    const u = await s.terms.update('http://x', 'AMP', { system: 'http://x', code: 'AMP', display: 'Ampicillin', status: 'DRAFT', shortName: null, class: null, unit: null, replacedBy: null, metadata: null });
    expect(u.display).toBe('Ampicillin');
    expect(u.status).toBe('DRAFT');
    await s.terms.delete('http://x', 'AMP');
    expect((await s.terms.search('http://x', { limit: 10, offset: 0 })).total).toBe(0);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** Add the `Term`/`TermInput` types + the `terms` namespace. Insert near the other exported types:

```typescript
export type TermStatus = 'ACTIVE' | 'DRAFT' | 'DEPRECATED' | 'DISABLED';
export interface Term {
  system: string; code: string; display: string | null; status: string;
  shortName: string | null; class: string | null; unit: string | null;
  replacedBy: string | null; metadata: Record<string, unknown> | null; mappingCount: number;
}
export interface TermInput {
  system: string; code: string; display: string; status: TermStatus;
  shortName?: string | null; class?: string | null; unit?: string | null;
  replacedBy?: string | null; metadata?: Record<string, unknown> | null;
}
```
Add to the `TerminologyAdminStore` interface:
```typescript
  terms: {
    search(systemUrl: string, q: { query?: string; statuses?: string[]; limit: number; offset: number }): Promise<{ rows: Term[]; total: number }>;
    create(input: TermInput): Promise<Term>;
    update(system: string, code: string, input: TermInput): Promise<Term>;
    delete(system: string, code: string): Promise<void>;
  };
```
Implementation inside `createTerminologyAdminStore` (helpers + namespace). The structured fields live in `properties`:
```typescript
  // properties jsonb <-> structured term fields
  function packProps(i: TermInput): Record<string, unknown> | null {
    const p: Record<string, unknown> = {};
    if (i.shortName) p.shortName = i.shortName;
    if (i.class) p.class = i.class;
    if (i.unit) p.unit = i.unit;
    if (i.replacedBy) p.replacedBy = i.replacedBy;
    if (i.metadata && Object.keys(i.metadata).length) p.meta = i.metadata;
    return Object.keys(p).length ? p : null;
  }
  function termRow(r: { system: string; code: string; display: string | null; status: string | null; properties: unknown }, mappingCount: number): Term {
    const p = (r.properties ?? {}) as Record<string, unknown>;
    return {
      system: r.system, code: r.code, display: r.display, status: r.status ?? 'ACTIVE',
      shortName: (p.shortName as string) ?? null, class: (p.class as string) ?? null,
      unit: (p.unit as string) ?? null, replacedBy: (p.replacedBy as string) ?? null,
      metadata: (p.meta as Record<string, unknown>) ?? null, mappingCount,
    };
  }
  async function mappingCountFor(system: string, code: string): Promise<number> {
    const r = await db.selectFrom('term_mappings').select((eb) => eb.fn.countAll<number>().as('n'))
      .where((eb) => eb.or([
        eb.and([eb('from_system', '=', system), eb('from_code', '=', code)]),
        eb.and([eb('to_system', '=', system), eb('to_code', '=', code)]),
      ])).executeTakeFirst();
    return Number(r?.n ?? 0);
  }
```
```typescript
    terms: {
      async search(systemUrl, q) {
        let base = db.selectFrom('terminology_concepts').where('system', '=', systemUrl);
        if (q.query && q.query.trim()) {
          const like = `%${q.query.trim()}%`;
          base = base.where((eb) => eb.or([eb('code', 'ilike', like), eb('display', 'ilike', like)]));
        }
        if (q.statuses && q.statuses.length) base = base.where('status', 'in', q.statuses);
        const rows = await base.selectAll().orderBy('code').limit(q.limit).offset(q.offset).execute();
        const totalRow = await base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
        const out = await Promise.all(rows.map(async (r) => termRow(r, await mappingCountFor(r.system, r.code))));
        return { rows: out, total: Number(totalRow?.n ?? 0) };
      },
      async create(input) {
        const props = packProps(input);
        await db.insertInto('terminology_concepts').values({
          system: input.system, code: input.code, display: input.display, status: input.status,
          properties: props === null ? null : (JSON.stringify(props) as never),
        }).onConflict((oc) => oc.columns(['system', 'code']).doUpdateSet((eb) => ({
          display: eb.ref('excluded.display'), status: eb.ref('excluded.status'), properties: eb.ref('excluded.properties'),
        }))).execute();
        const row = await db.selectFrom('terminology_concepts').selectAll().where('system', '=', input.system).where('code', '=', input.code).executeTakeFirstOrThrow();
        return termRow(row, await mappingCountFor(input.system, input.code));
      },
      async update(system, code, input) {
        const existing = await db.selectFrom('terminology_concepts').select(['code']).where('system', '=', system).where('code', '=', code).executeTakeFirst();
        if (!existing) throw new TerminologyAdminError(`term not found: ${system}|${code}`, 'not-found');
        const props = packProps(input);
        await db.updateTable('terminology_concepts').set({
          display: input.display, status: input.status, properties: props === null ? null : (JSON.stringify(props) as never),
        }).where('system', '=', system).where('code', '=', code).execute();
        const row = await db.selectFrom('terminology_concepts').selectAll().where('system', '=', system).where('code', '=', code).executeTakeFirstOrThrow();
        return termRow(row, await mappingCountFor(system, code));
      },
      async delete(system, code) {
        const existing = await db.selectFrom('terminology_concepts').select(['code']).where('system', '=', system).where('code', '=', code).executeTakeFirst();
        if (!existing) throw new TerminologyAdminError(`term not found: ${system}|${code}`, 'not-found');
        await db.deleteFrom('terminology_concepts').where('system', '=', system).where('code', '=', code).execute();
      },
    },
```
(`code` is immutable on update — `update` keys on system+code and doesn't change them; the UI disables the code field on edit.)

- [ ] **Step 4: Run → PASS.** `pnpm --filter @openldr/db test -- terminology-admin-store`.

- [ ] **Step 5: Commit**
```bash
git add packages/db/src/terminology-admin-store.ts packages/db/src/terminology-admin-store.test.ts
git commit -m "feat(db): admin store terms namespace — CRUD + properties mapping + mappingCount (P2-TERM)"
```

---

## Task 4: Terms CSV importer

**Files:**
- Create: `packages/terminology/src/terms-csv.ts`
- Modify: `packages/terminology/src/index.ts` (export)
- Modify: `packages/db/src/terminology-admin-store.ts` — add `terms.importRows`
- Test: `packages/terminology/src/terms-csv.test.ts` + extend the admin store test

- [ ] **Step 1: Write the CSV test.** Create `packages/terminology/src/terms-csv.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseTermsCsv, TERMS_CSV_TEMPLATE } from './terms-csv';

describe('parseTermsCsv', () => {
  it('parses code/display/shortName/class/unit/status into concept rows', () => {
    const csv = 'code,display,shortName,class,unit,status\nAMP,Ampicillin,Amp,ABX,,ACTIVE\nCIP,Ciprofloxacin,,ABX,mg,DRAFT\n';
    const rows = parseTermsCsv(csv, 'http://x');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ system: 'http://x', code: 'AMP', display: 'Ampicillin', status: 'ACTIVE' });
    expect(rows[0].properties).toMatchObject({ shortName: 'Amp', class: 'ABX' });
    expect(rows[1].properties).toMatchObject({ class: 'ABX', unit: 'mg' });
  });
  it('exposes a header-only template', () => {
    expect(TERMS_CSV_TEMPLATE.trim()).toBe('code,display,shortName,class,unit,status');
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `packages/terminology/src/terms-csv.ts` (use the `csv-parse/sync` already available to `@openldr/terminology`):

```typescript
import { parse } from 'csv-parse/sync';
import type { ConceptRecord } from '@openldr/db';

export const TERMS_CSV_TEMPLATE = 'code,display,shortName,class,unit,status\n';

/** Parse a terms CSV into ConceptRecord[] for one coding system (system url). */
export function parseTermsCsv(csv: string, systemUrl: string): ConceptRecord[] {
  const records = parse(csv, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  return records
    .filter((r) => (r.code ?? '').trim())
    .map((r) => {
      const props: Record<string, unknown> = {};
      if (r.shortName) props.shortName = r.shortName;
      if (r.class) props.class = r.class;
      if (r.unit) props.unit = r.unit;
      return {
        system: systemUrl,
        code: r.code.trim(),
        display: r.display?.trim() || null,
        status: (r.status?.trim() || 'ACTIVE'),
        properties: Object.keys(props).length ? props : null,
      };
    });
}
```
Export it from `packages/terminology/src/index.ts`: `export * from './terms-csv';`. Confirm `@openldr/terminology` already depends on `@openldr/db` (it does — for `ConceptRecord`) and on `csv-parse` (the LOINC loader uses it; if it's `csv-parse` not `csv-parse/sync`, adapt the import to whatever is installed).

- [ ] **Step 4: Add `terms.importRows` to the admin store.** Add to the `terms` namespace interface + impl:
```typescript
    importRows(rows: { system: string; code: string; display: string | null; status: string; properties: Record<string, unknown> | null }[]): Promise<{ imported: number }>;
```
```typescript
      async importRows(rows) {
        if (!rows.length) return { imported: 0 };
        await db.insertInto('terminology_concepts').values(rows.map((r) => ({
          system: r.system, code: r.code, display: r.display, status: r.status,
          properties: r.properties === null ? null : (JSON.stringify(r.properties) as never),
        }))).onConflict((oc) => oc.columns(['system', 'code']).doUpdateSet((eb) => ({
          display: eb.ref('excluded.display'), status: eb.ref('excluded.status'), properties: eb.ref('excluded.properties'),
        }))).execute();
        return { imported: rows.length };
      },
```
Add an admin-store test asserting `importRows` upserts (insert 2, re-import 1 with a changed display → still that row updated).

- [ ] **Step 5: Run** `pnpm --filter @openldr/terminology test -- terms-csv` + `pnpm --filter @openldr/db test -- terminology-admin-store` → PASS. typecheck clean.

- [ ] **Step 6: Commit**
```bash
git add packages/terminology/src/terms-csv.ts packages/terminology/src/terms-csv.test.ts packages/terminology/src/index.ts packages/db/src/terminology-admin-store.ts packages/db/src/terminology-admin-store.test.ts
git commit -m "feat(terminology): terms CSV parser + template + admin importRows (P2-TERM)"
```

---

## Task 5: Admin store `termMappings` namespace (projection + draft-term creation)

**Files:**
- Modify: `packages/db/src/terminology-admin-store.ts`
- Test: `packages/db/src/terminology-admin-store.test.ts` (extend)

- [ ] **Step 1: Write the failing test.**
```typescript
describe('termMappings', () => {
  it('creates a mapping, projects into concept_map_elements, and auto-creates a DRAFT target concept', async () => {
    const { db, s } = await store();
    await s.terms.create({ system: 'http://x', code: 'AMP', display: 'Ampicillin', status: 'ACTIVE', shortName: null, class: null, unit: null, replacedBy: null, metadata: null });
    const res = await s.termMappings.create({ fromSystem: 'http://x', fromCode: 'AMP', toSystem: 'http://loinc.org', toCode: '101477-8', toDisplay: 'Ampicillin susceptibility', mapType: 'SAME-AS', relationship: null, owner: null, isActive: true });
    expect(res.draftCreated).toBe(true);
    const proj = await db.selectFrom('concept_map_elements').selectAll().where('source_system', '=', 'http://x').where('source_code', '=', 'AMP').execute();
    expect(proj).toHaveLength(1);
    expect(proj[0].target_code).toBe('101477-8');
    const draft = await db.selectFrom('terminology_concepts').selectAll().where('system', '=', 'http://loinc.org').where('code', '=', '101477-8').executeTakeFirst();
    expect(draft?.status).toBe('DRAFT');
    expect(await s.termMappings.listOutgoing('http://x', 'AMP')).toHaveLength(1);
    expect(await s.termMappings.listReverse('http://loinc.org', '101477-8')).toHaveLength(1);
  });
  it('delete removes the mapping and its projection', async () => {
    const { db, s } = await store();
    const res = await s.termMappings.create({ fromSystem: 'http://x', fromCode: 'AMP', toSystem: 'http://y', toCode: 'Z', toDisplay: null, mapType: 'RELATED-TO', relationship: null, owner: null, isActive: true });
    await s.termMappings.delete(res.mapping.id);
    expect(await db.selectFrom('concept_map_elements').selectAll().where('source_code', '=', 'AMP').execute()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** Types + namespace. The synthetic local map url is a module const.
```typescript
export type MapType = 'SAME-AS' | 'NARROWER-THAN' | 'BROADER-THAN' | 'RELATED-TO' | 'UNMAPPED-FROM';
export interface TermMapping {
  id: string; fromSystem: string; fromCode: string; toSystem: string; toCode: string;
  toDisplay: string | null; mapType: MapType; relationship: string | null; owner: string | null; isActive: boolean;
}
export interface TermMappingInput {
  fromSystem: string; fromCode: string; toSystem: string; toCode: string; toDisplay: string | null;
  mapType: MapType; relationship?: string | null; owner?: string | null; isActive: boolean;
}
const LOCAL_MAP_URL = 'urn:openldr:terminology:local-map';
```
Interface additions:
```typescript
  termMappings: {
    listOutgoing(system: string, code: string): Promise<TermMapping[]>;
    listReverse(system: string, code: string): Promise<TermMapping[]>;
    create(input: TermMappingInput): Promise<{ mapping: TermMapping; draftCreated: boolean }>;
    update(id: string, input: TermMappingInput): Promise<TermMapping>;
    delete(id: string): Promise<void>;
  };
```
Implementation (transactional). Row mapper + namespace:
```typescript
  const tmRow = (r: { id: string; from_system: string; from_code: string; to_system: string; to_code: string; to_display: string | null; map_type: string; relationship: string | null; owner: string | null; is_active: boolean }): TermMapping => ({
    id: r.id, fromSystem: r.from_system, fromCode: r.from_code, toSystem: r.to_system, toCode: r.to_code,
    toDisplay: r.to_display, mapType: r.map_type as MapType, relationship: r.relationship, owner: r.owner, isActive: r.is_active,
  });
```
```typescript
    termMappings: {
      async listOutgoing(system, code) {
        const rows = await db.selectFrom('term_mappings').selectAll().where('from_system', '=', system).where('from_code', '=', code).orderBy('created_at').execute();
        return rows.map(tmRow);
      },
      async listReverse(system, code) {
        const rows = await db.selectFrom('term_mappings').selectAll().where('to_system', '=', system).where('to_code', '=', code).orderBy('created_at').execute();
        return rows.map(tmRow);
      },
      async create(input) {
        const id = newId('tm');
        let draftCreated = false;
        await db.transaction().execute(async (trx) => {
          await trx.insertInto('term_mappings').values({
            id, from_system: input.fromSystem, from_code: input.fromCode, to_system: input.toSystem, to_code: input.toCode,
            to_display: input.toDisplay, map_type: input.mapType, relationship: input.relationship ?? null, owner: input.owner ?? null, is_active: input.isActive,
          }).execute();
          await trx.deleteFrom('concept_map_elements')
            .where('map_url', '=', LOCAL_MAP_URL).where('source_system', '=', input.fromSystem).where('source_code', '=', input.fromCode)
            .where('target_system', '=', input.toSystem).where('target_code', '=', input.toCode).execute();
          await trx.insertInto('concept_map_elements').values({
            map_url: LOCAL_MAP_URL, source_system: input.fromSystem, source_code: input.fromCode,
            target_system: input.toSystem, target_code: input.toCode, equivalence: input.mapType,
          }).execute();
          const existing = await trx.selectFrom('terminology_concepts').select(['code']).where('system', '=', input.toSystem).where('code', '=', input.toCode).executeTakeFirst();
          if (!existing) {
            await trx.insertInto('terminology_concepts').values({ system: input.toSystem, code: input.toCode, display: input.toDisplay, status: 'DRAFT', properties: null }).execute();
            draftCreated = true;
          }
        });
        const row = await db.selectFrom('term_mappings').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
        return { mapping: tmRow(row), draftCreated };
      },
      async update(id, input) {
        const existing = await db.selectFrom('term_mappings').selectAll().where('id', '=', id).executeTakeFirst();
        if (!existing) throw new TerminologyAdminError(`mapping not found: ${id}`, 'not-found');
        await db.transaction().execute(async (trx) => {
          await trx.deleteFrom('concept_map_elements').where('map_url', '=', LOCAL_MAP_URL)
            .where('source_system', '=', existing.from_system).where('source_code', '=', existing.from_code)
            .where('target_system', '=', existing.to_system).where('target_code', '=', existing.to_code).execute();
          await trx.updateTable('term_mappings').set({
            to_system: input.toSystem, to_code: input.toCode, to_display: input.toDisplay, map_type: input.mapType,
            relationship: input.relationship ?? null, owner: input.owner ?? null, is_active: input.isActive, updated_at: sql`now()`,
          }).where('id', '=', id).execute();
          await trx.insertInto('concept_map_elements').values({
            map_url: LOCAL_MAP_URL, source_system: input.fromSystem, source_code: input.fromCode,
            target_system: input.toSystem, target_code: input.toCode, equivalence: input.mapType,
          }).execute();
        });
        const row = await db.selectFrom('term_mappings').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
        return tmRow(row);
      },
      async delete(id) {
        const existing = await db.selectFrom('term_mappings').selectAll().where('id', '=', id).executeTakeFirst();
        if (!existing) throw new TerminologyAdminError(`mapping not found: ${id}`, 'not-found');
        await db.transaction().execute(async (trx) => {
          await trx.deleteFrom('concept_map_elements').where('map_url', '=', LOCAL_MAP_URL)
            .where('source_system', '=', existing.from_system).where('source_code', '=', existing.from_code)
            .where('target_system', '=', existing.to_system).where('target_code', '=', existing.to_code).execute();
          await trx.deleteFrom('term_mappings').where('id', '=', id).execute();
        });
      },
    },
```
Add `import { sql } from 'kysely';` if not already imported (the store imports `Kysely`; add `sql`). NOTE: pg-mem transaction + `sql\`now()\`` — confirm by running the test; if pg-mem rejects `sql\`now()\`` in the update SET, drop the `updated_at` line from the update (the column keeps its prior value) and note it; don't weaken production behavior.

- [ ] **Step 4: Run → PASS.** `pnpm --filter @openldr/db test -- terminology-admin-store`.

- [ ] **Step 5: Commit**
```bash
git add packages/db/src/terminology-admin-store.ts packages/db/src/terminology-admin-store.test.ts
git commit -m "feat(db): term_mappings CRUD — concept_map_elements projection + draft-term creation (P2-TERM)"
```

---

## Task 6: HTTP routes (terms + mappings)

**Files:**
- Modify: `apps/server/src/terminology-admin-routes.ts`
- Modify: `apps/server/src/app.test.ts`

READ `terminology-admin-routes.ts` first (the SP1 routes + `mapErr`/`isAdminError` duck-type guard + the zod pattern + the `IdParam` alias). The handlers need the coding system's `url` to key concepts — fetch via `admin.codingSystems.list()` then `find(s => s.id === id)`.

- [ ] **Step 1: Write the failing test** in `app.test.ts` (extend the SP1 in-memory fake `terminology.admin` with `terms` + `termMappings` namespaces returning in-memory data; seed one system `sys1` with url `http://x` and one term `AMP`). Assert: `GET /api/terminology/systems/sys1/terms?q=amp` → 200 with `{rows,total}`; `POST /api/terminology/terms/http%3A%2F%2Fx/AMP/mappings` → 201.

- [ ] **Step 2: Run → FAIL (404).**

- [ ] **Step 3: Implement the routes.** Add to `registerTerminologyAdminRoutes` (the body uses the existing `admin`, `mapErr`, `IdParam`):
```typescript
  const termInput = z.object({
    code: z.string().min(1), display: z.string().min(1),
    status: z.enum(['ACTIVE', 'DRAFT', 'DEPRECATED', 'DISABLED']),
    shortName: z.string().nullish(), class: z.string().nullish(), unit: z.string().nullish(),
    replacedBy: z.string().nullish(), metadata: z.record(z.unknown()).nullish(),
  });
  async function systemUrl(id: string): Promise<string> {
    const sys = (await admin.codingSystems.list()).find((s) => s.id === id);
    if (!sys || !sys.url) throw new TerminologyAdminError(`coding system has no url: ${id}`, 'not-found');
    return sys.url;
  }
  app.get('/api/terminology/systems/:id/terms', async (req, reply) => {
    try {
      const url = await systemUrl((req.params as IdParam).id);
      const { q, status, limit, offset } = req.query as { q?: string; status?: string; limit?: string; offset?: string };
      return await admin.terms.search(url, { query: q, statuses: status ? [status] : undefined, limit: Number(limit ?? 50), offset: Number(offset ?? 0) });
    } catch (e) { return mapErr(e, reply); }
  });
  app.post('/api/terminology/systems/:id/terms', async (req, reply) => {
    const parsed = termInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try { const url = await systemUrl((req.params as IdParam).id); reply.code(201); return await admin.terms.create({ system: url, ...parsed.data }); }
    catch (e) { return mapErr(e, reply); }
  });
  app.put('/api/terminology/systems/:id/terms/:code', async (req, reply) => {
    const parsed = termInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try {
      const url = await systemUrl((req.params as IdParam).id);
      const code = decodeURIComponent((req.params as { code: string }).code);
      return await admin.terms.update(url, code, { system: url, ...parsed.data });
    } catch (e) { return mapErr(e, reply); }
  });
  app.delete('/api/terminology/systems/:id/terms/:code', async (req, reply) => {
    try {
      const url = await systemUrl((req.params as IdParam).id);
      await admin.terms.delete(url, decodeURIComponent((req.params as { code: string }).code));
      reply.code(204); return null;
    } catch (e) { return mapErr(e, reply); }
  });
  app.post('/api/terminology/systems/:id/terms/import', async (req, reply) => {
    try {
      const url = await systemUrl((req.params as IdParam).id);
      const rows = parseTermsCsv(String((req.body as { csv?: string }).csv ?? ''), url);
      return await admin.terms.importRows(rows);
    } catch (e) { return mapErr(e, reply); }
  });
  app.get('/api/terminology/systems/:id/terms/template.csv', async (_req, reply) => {
    reply.header('content-type', 'text/csv');
    return TERMS_CSV_TEMPLATE;
  });

  const mappingInput = z.object({
    toSystem: z.string().min(1), toCode: z.string().min(1), toDisplay: z.string().nullish(),
    mapType: z.enum(['SAME-AS', 'NARROWER-THAN', 'BROADER-THAN', 'RELATED-TO', 'UNMAPPED-FROM']),
    relationship: z.string().nullish(), owner: z.string().nullish(), isActive: z.boolean(),
  });
  app.get('/api/terminology/terms/:system/:code/mappings', async (req, reply) => {
    try {
      const system = decodeURIComponent((req.params as { system: string }).system);
      const code = decodeURIComponent((req.params as { code: string }).code);
      const [outgoing, reverse] = await Promise.all([admin.termMappings.listOutgoing(system, code), admin.termMappings.listReverse(system, code)]);
      return { outgoing, reverse };
    } catch (e) { return mapErr(e, reply); }
  });
  app.post('/api/terminology/terms/:system/:code/mappings', async (req, reply) => {
    const parsed = mappingInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try {
      const system = decodeURIComponent((req.params as { system: string }).system);
      const code = decodeURIComponent((req.params as { code: string }).code);
      reply.code(201);
      return await admin.termMappings.create({ fromSystem: system, fromCode: code, ...parsed.data });
    } catch (e) { return mapErr(e, reply); }
  });
  app.put('/api/terminology/mappings/:id', async (req, reply) => {
    const parsed = mappingInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    const from = req.body as { fromSystem?: string; fromCode?: string };
    if (!from.fromSystem || !from.fromCode) { reply.code(400); return { error: 'fromSystem and fromCode required' }; }
    try { return await admin.termMappings.update((req.params as IdParam).id, { fromSystem: from.fromSystem, fromCode: from.fromCode, ...parsed.data }); }
    catch (e) { return mapErr(e, reply); }
  });
  app.delete('/api/terminology/mappings/:id', async (req, reply) => {
    try { await admin.termMappings.delete((req.params as IdParam).id); reply.code(204); return null; }
    catch (e) { return mapErr(e, reply); }
  });
```
Add at the top: `import { parseTermsCsv, TERMS_CSV_TEMPLATE } from '@openldr/terminology';` (apps/server already depends on `@openldr/terminology`).

- [ ] **Step 4: Run → PASS.** `pnpm --filter @openldr/server test -- app` + typecheck.

- [ ] **Step 5: Commit**
```bash
git add apps/server/src/terminology-admin-routes.ts apps/server/src/app.test.ts
git commit -m "feat(server): terms + term-mappings REST routes (P2-TERM)"
```

---

## Task 7: CLI `terminology term list`

**Files:** Modify `packages/cli/src/terminology.ts` + `packages/cli/src/index.ts`.

- [ ] **Step 1: Add the runner** (mirror SP1's `runSystemList`):
```typescript
export async function runTermList(systemUrl: string, opts: { q?: string; json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const page = await ctx.admin.terms.search(systemUrl, { query: opts.q, limit: 100, offset: 0 });
    if (opts.json) console.log(JSON.stringify(page, null, 2));
    else for (const t of page.rows) console.log(`${t.code}\t${t.display ?? ''}\t${t.status}`);
    return 0;
  } finally { await ctx.close(); }
}
```
- [ ] **Step 2: Wire** `terminology term list <systemUrl> [--q <s>] [--json]` in `index.ts` (a `tterm = term.command('term')` group, mirror the SP1 `tsys` block).
- [ ] **Step 3: Verify** `pnpm --filter @openldr/cli typecheck` + `pnpm --filter @openldr/cli build:check`.
- [ ] **Step 4: Commit**
```bash
git add packages/cli/src/terminology.ts packages/cli/src/index.ts
git commit -m "feat(cli): terminology term list (P2-TERM)"
```

---

## Task 8: UI primitives — tooltip + plain ConfirmDialog + statusBadge

**Files:**
- Create: `apps/web/src/components/ui/tooltip.tsx`, `apps/web/src/components/ui/confirm-dialog.tsx`
- Create: `apps/web/src/terminology/statusBadge.ts`
- Test: `apps/web/src/terminology/statusBadge.test.ts` + a small render test

- [ ] **Step 1: Add `@radix-ui/react-tooltip`** if absent: `pnpm --filter @openldr/web add @radix-ui/react-tooltip`.
- [ ] **Step 2: Create `tooltip.tsx`** — standard shadcn Tooltip: export `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider` (Radix). Content `rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow`. Match `dialog.tsx` style. Token classes only.
- [ ] **Step 3: Create `confirm-dialog.tsx`** — a PLAIN confirm built on the SP1 `alert-dialog` primitive. Props `{ open, onOpenChange, title, description, confirmLabel, cancelLabel?, destructive?, onConfirm }`. `AlertDialogAction` gets the destructive token classes when `destructive`. (Corlix uses this for term/mapping delete; it is NOT the type-to-confirm DangerConfirmDialog.)
- [ ] **Step 4: Create `statusBadge.ts`:**
```typescript
export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'ACTIVE': return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
    case 'DRAFT': return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
    case 'DEPRECATED': return 'border-orange-500/40 bg-orange-500/10 text-orange-300';
    case 'DISABLED': return 'border-muted-foreground/30 bg-muted/40 text-muted-foreground';
    default: return '';
  }
}
```
- [ ] **Step 5: Tests** — `statusBadge.test.ts` (maps each status to the right class); a render smoke for `confirm-dialog` (enabled action fires onConfirm) + `tooltip` (open content shows). `pnpm --filter @openldr/web test` → pass; typecheck clean.
- [ ] **Step 6: Commit**
```bash
git add apps/web/src/components/ui/tooltip.tsx apps/web/src/components/ui/confirm-dialog.tsx apps/web/src/terminology/statusBadge.ts apps/web/src/terminology/statusBadge.test.ts apps/web/package.json
git commit -m "feat(web): tooltip + plain confirm-dialog + statusBadge helper (P2-TERM)"
```

---

## Task 9: API client — terms + mappings

**Files:** Modify `apps/web/src/api.ts`.

- [ ] **Step 1: Add types + client fns** (reuse the SP1 `jbody`/`okJson` helpers already in api.ts):
```typescript
export type TermStatus = 'ACTIVE' | 'DRAFT' | 'DEPRECATED' | 'DISABLED';
export type MapType = 'SAME-AS' | 'NARROWER-THAN' | 'BROADER-THAN' | 'RELATED-TO' | 'UNMAPPED-FROM';
export interface Term { system: string; code: string; display: string | null; status: string; shortName: string | null; class: string | null; unit: string | null; replacedBy: string | null; metadata: Record<string, unknown> | null; mappingCount: number }
export interface TermInput { code: string; display: string; status: TermStatus; shortName?: string | null; class?: string | null; unit?: string | null; replacedBy?: string | null; metadata?: Record<string, unknown> | null }
export interface TermMapping { id: string; fromSystem: string; fromCode: string; toSystem: string; toCode: string; toDisplay: string | null; mapType: MapType; relationship: string | null; owner: string | null; isActive: boolean }
export interface TermMappingInput { fromSystem: string; fromCode: string; toSystem: string; toCode: string; toDisplay: string | null; mapType: MapType; relationship?: string | null; owner?: string | null; isActive: boolean }

export const searchTerms = (systemId: string, p: { q?: string; status?: string; limit?: number; offset?: number }) => {
  const qs = new URLSearchParams();
  if (p.q) qs.set('q', p.q);
  if (p.status) qs.set('status', p.status);
  qs.set('limit', String(p.limit ?? 50)); qs.set('offset', String(p.offset ?? 0));
  return fetch(`/api/terminology/systems/${systemId}/terms?${qs}`).then((r) => okJson<{ rows: Term[]; total: number }>(r, 'search terms'));
};
export const createTerm = (systemId: string, i: TermInput) => fetch(`/api/terminology/systems/${systemId}/terms`, jbody(i, 'POST')).then((r) => okJson<Term>(r, 'create term'));
export const updateTerm = (systemId: string, code: string, i: TermInput) => fetch(`/api/terminology/systems/${systemId}/terms/${encodeURIComponent(code)}`, jbody(i, 'PUT')).then((r) => okJson<Term>(r, 'update term'));
export async function deleteTerm(systemId: string, code: string): Promise<void> {
  const r = await fetch(`/api/terminology/systems/${systemId}/terms/${encodeURIComponent(code)}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`delete term failed: ${r.status}`);
}
export const importTerms = (systemId: string, csv: string) => fetch(`/api/terminology/systems/${systemId}/terms/import`, jbody({ csv }, 'POST')).then((r) => okJson<{ imported: number }>(r, 'import terms'));
export const termsTemplateUrl = (systemId: string) => `/api/terminology/systems/${systemId}/terms/template.csv`;

export const listTermMappings = (system: string, code: string) =>
  fetch(`/api/terminology/terms/${encodeURIComponent(system)}/${encodeURIComponent(code)}/mappings`).then((r) => okJson<{ outgoing: TermMapping[]; reverse: TermMapping[] }>(r, 'list mappings'));
export const createTermMapping = (system: string, code: string, i: Omit<TermMappingInput, 'fromSystem' | 'fromCode'>) =>
  fetch(`/api/terminology/terms/${encodeURIComponent(system)}/${encodeURIComponent(code)}/mappings`, jbody(i, 'POST')).then((r) => okJson<{ mapping: TermMapping; draftCreated: boolean }>(r, 'create mapping'));
export const updateTermMapping = (id: string, i: TermMappingInput) => fetch(`/api/terminology/mappings/${id}`, jbody(i, 'PUT')).then((r) => okJson<TermMapping>(r, 'update mapping'));
export async function deleteTermMapping(id: string): Promise<void> {
  const r = await fetch(`/api/terminology/mappings/${id}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`delete mapping failed: ${r.status}`);
}
```
- [ ] **Step 2: Typecheck** `pnpm --filter @openldr/web typecheck` → clean.
- [ ] **Step 3: Commit**
```bash
git add apps/web/src/api.ts
git commit -m "feat(web): terms + mappings api client (P2-TERM)"
```

---

## Task 10: TermPicker (typeahead)

**Files:** Create `apps/web/src/terminology/TermPicker.tsx` + `.test.tsx`. Reference corlix `TermPicker.tsx` for behavior (a typeahead with a results dropdown). SP2 scopes the picker to ONE system id (the mapping dialog's chosen target system); cross-system search is a carry-forward.

- [ ] **Step 1: Failing test:**
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TermPicker } from './TermPicker';
import * as api from '../api';

describe('TermPicker', () => {
  beforeEach(() => vi.restoreAllMocks());
  it('searches and selects a term', async () => {
    vi.spyOn(api, 'searchTerms').mockResolvedValue({ rows: [{ system: 'http://x', code: 'AMP', display: 'Ampicillin', status: 'ACTIVE', shortName: null, class: null, unit: null, replacedBy: null, metadata: null, mappingCount: 0 }], total: 1 } as never);
    const onChange = vi.fn();
    render(<TermPicker value={null} onChange={onChange} systemId="sys1" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'amp' } });
    const opt = await screen.findByText(/Ampicillin/);
    fireEvent.click(opt);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ code: 'AMP', system: 'http://x' }));
  });
});
```
- [ ] **Step 2–4:** run-fail → implement (props `{ value: { system; code; display } | null; onChange; systemId; statuses? }`; debounced `searchTerms(systemId, {q, status})` → dropdown of `code — display`; click sets `onChange({system, code, display})`; show the current value as a chip with a clear button) → run-pass.
- [ ] **Step 5: Commit** `feat(web): TermPicker typeahead (P2-TERM)`.

---

## Task 11: TermsTable + wire into the page

**Files:**
- Create: `apps/web/src/terminology/TermsTable.tsx` + `.test.tsx`
- Modify: `apps/web/src/pages/Terminology.tsx` (replace the drilled placeholder — the `{selectedSystemId && (...)}` block, currently the back-button row + "Terms — coming in the next update." centered div — keep the back button, swap the centered placeholder for `<TermsTable>`; add `editingTerm`/`termDialogOpen`/`termsReloadKey` state for Task 12 to use).

READ the current `{selectedSystemId && (...)}` block in `Terminology.tsx` first.

- [ ] **Step 1: Failing test** for `TermsTable` (mock `searchTerms`): renders rows (Code/Name/Status), paginates, debounced search calls `searchTerms` with `q`.
- [ ] **Step 2–4:** implement `TermsTable`:
  - Props `{ systemId: string; reloadKey?: number; onOpenTerm: (term: Term | null) => void }`.
  - State: `q`, `status`, `page`, `pageSize=25`, `rows`, `total`, `loading`. `useEffect` on `[systemId, debouncedQ, status, page, reloadKey]` → `searchTerms`. Debounce q 200ms.
  - Toolbar: search `Input` + status `Select` (All/ACTIVE/DRAFT/DEPRECATED/DISABLED) + Import `Button` (hidden file input → read text → `importTerms` → bump local refetch) + Download-template (`<a href={termsTemplateUrl(systemId)}>`). A "New term" `Button` → `onOpenTerm(null)`.
  - `Table`: Code(mono/primary)/Name(+short 2nd line)/Class(`Badge` secondary or —)/Unit(mono/muted)/Status(`Badge` + `statusBadgeClass(status)`)/Mappings(right-aligned count or —)/row `⋯` (View → onOpenTerm(term), Delete → `confirm-dialog` → `deleteTerm` → refetch). Row click → `onOpenTerm(term)` (the row `⋯` cell stops propagation).
  - `TablePagination` server-side (`total`, page→offset, "{total} terms" leftSlot).
  - In `Terminology.tsx`: in the drilled block, keep the back-button row; render `<TermsTable systemId={selectedSystem!.id} reloadKey={termsReloadKey} onOpenTerm={(t) => { setEditingTerm(t); setTermDialogOpen(true); }} />`. Add the state `const [editingTerm, setEditingTerm] = useState<Term | null>(null); const [termDialogOpen, setTermDialogOpen] = useState(false); const [termsReloadKey, setTermsReloadKey] = useState(0);`. (TermDialog mounted in Task 12.)
- [ ] **Step 5: Run** web tests + typecheck → pass.
- [ ] **Step 6: Commit** `feat(web): TermsTable (server-side search/paginate/import) wired into the drilled pane (P2-TERM)`.

---

## Task 12: TermDialog (Details + Mappings tabs)

**Files:** Create `apps/web/src/terminology/TermDialog.tsx` + `.test.tsx`. Faithful port of corlix `TermDialog.tsx` (read it). Adaptations: HTTP api (`createTerm`/`updateTerm`/`deleteTerm`/`listTermMappings`/`deleteTermMapping`); English en.json labels; our `Sheet`/`Select`/`Input`/`Badge`/`DropdownMenu`/`confirm-dialog`; term keyed by `(system.url, code)` not id; `onSaved`/`onDeleted` bump the TermsTable `reloadKey`.

- [ ] **Step 1: Failing test:** create-mode save calls `createTerm`; the Mappings tab button is disabled when `term===null`; edit mode enables Mappings and calls `listTermMappings`.
- [ ] **Step 2–4:** implement per corlix structure:
  - Props `{ open, onOpenChange, system: CodingSystem, term: Term | null, onSaved, onDeleted }`.
  - Underline `TabButton`s (Details / Mappings; Mappings disabled unless editing; count `Badge` = outgoing+reverse length).
  - `⋯` actions menu pinned to the tab row, items switch per tab (Details: Save/Cancel/Delete-if-editing; Mappings: Add mapping/Cancel).
  - Details body: General (code [disabled when editing] / display / shortName / class / unit) + Lifecycle (status `Select`; replacedBy Input **disabled unless status==='DEPRECATED'**) + Metadata (`<textarea>`; on save parse JSON → must be a non-array object else error).
  - Save builds `TermInput`, calls `createTerm(system.id, input)` or `updateTerm(system.id, term.code, input)`; `onSaved`.
  - Mappings body: `listTermMappings(system.url!, term.code)`; merged outgoing+reverse table (direction/type/system/code+display; reverse rows read-only, no `⋯`); count summary; "draft created" notice (dismissable, set when a create returns draftCreated); "Add mapping" → `<TermMappingDialog>` (Task 13).
  - Delete via the plain `confirm-dialog`.
- [ ] **Step 5: Run** → pass.
- [ ] **Step 6: Wire into `Terminology.tsx`:** mount `{termDialogOpen && selectedSystem && <TermDialog open system={selectedSystem} term={editingTerm} onOpenChange={setTermDialogOpen} onSaved={() => { setTermDialogOpen(false); setTermsReloadKey((k) => k + 1); }} onDeleted={() => { setTermDialogOpen(false); setTermsReloadKey((k) => k + 1); }} />}`.
- [ ] **Step 7: Commit** `feat(web): TermDialog — Details + Mappings tabs (port of corlix) (P2-TERM)`.

---

## Task 13: TermMappingDialog

**Files:** Create `apps/web/src/terminology/TermMappingDialog.tsx` + `.test.tsx`. Faithful port of corlix `TermMappingDialog.tsx` (read it). Adaptations: HTTP api; our primitives; target always `(toSystem, toCode, toDisplay)`; the "Browse ontology" button **disabled** (SP4) wrapped in a `Tooltip`; no `toTermId`.

- [ ] **Step 1: Failing test:** manual-mode create calls `createTermMapping` with the target fields + mapType; switching search↔manual clears the target; on `draftCreated` the parent `onSaved` receives the flag.
- [ ] **Step 2–4:** implement per corlix:
  - Props `{ open, onOpenChange, fromTerm: { system: string; code: string; display: string | null; systemCode: string }, systems: CodingSystem[], mapping: TermMapping | null, onSaved: (m: TermMapping, draftCreated: boolean) => void }`.
  - General: mapType `Select` (the 5 values), relationship/owner Inputs. Target: toggle search↔manual. Search mode = a target system `Select` (active systems) + `<TermPicker systemId={targetSystem.id} statuses={['ACTIVE','DRAFT']}>`. Manual mode = system `Select` (active) + code Input + display Input + a DISABLED "Browse {systemCode}" `Button` in a `Tooltip` ("Available once an ontology index exists — a later update"). Status: is-active `Checkbox`.
  - Save: build `{ toSystem, toCode, toDisplay, mapType, relationship, owner, isActive }` (search mode fills from the picked term's system url/code/display; manual from the fields) → `createTermMapping(fromTerm.system, fromTerm.code, body)` (create) or `updateTermMapping(mapping.id, { fromSystem: fromTerm.system, fromCode: fromTerm.code, ...body })` (edit) → `onSaved(result.mapping, result.draftCreated ?? false)`.
- [ ] **Step 5: Run** → pass.
- [ ] **Step 6: Commit** `feat(web): TermMappingDialog (port of corlix; ontology picker deferred) (P2-TERM)`.

---

## Task 14: e2e

**Files:** Modify `e2e/tests/terminology.spec.ts`.

- [ ] **Step 1:** Add an e2e (against the seeded stack): create a code system with a url via the UI (System publisher → ⋯ → Code system → New, give it a url like `http://e2e.test/x`) → drill in → create a term via the New-term dialog (Details: code + display + ACTIVE) → assert the term row appears in the table → open it → add a manual mapping to a new code in another active system → assert the mapping count / the success. If the Radix tab + nested dialog interactions are too flaky headless, fall back to a solid subset (create the system + a term and assert it appears) and `test.fixme()` the mapping step with a comment. Do NOT leave a flaky test.
- [ ] **Step 2:** Run `pnpm e2e -- terminology` (kill stale :3000; ensure `db migrate` ran for migration 013). Confirm the full suite still passes.
- [ ] **Step 3: Commit** `feat(web): e2e — terms create + mapping (P2-TERM)`.

---

## Task 15: Live acceptance + gates + docs

- [ ] **Step 1: Migrate + seed.** Kill :3000; `pnpm openldr db reset` (runs migration 013); `pnpm openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm && pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite`.
- [ ] **Step 2: Manual live check.** Create a code system with a url, import a 3-row terms CSV via the UI, edit a term, add a mapping to a new code in another system → confirm the DRAFT target term appears under that system, and the `$translate` HTTP endpoint (`GET /api/terminology/ConceptMap/$translate?system=<fromUrl>&code=<fromCode>`) returns the authored mapping (projection works). Paste evidence.
- [ ] **Step 3: Gates.** `pnpm typecheck && pnpm lint && pnpm test && pnpm depcruise && pnpm build:check` → all green.
- [ ] **Step 4: e2e + screenshots.** `pnpm e2e` (full) green; `pnpm docs:screenshots`; review/commit changed PNGs.
- [ ] **Step 5: Commit** `test(P2-TERM): SP2 live acceptance — terms + mappings verified, screenshots (P2-TERM)`.

---

## Self-Review notes (for the executor)

- **Spec coverage:** migration (T1), search (T2), terms CRUD (T3), CSV (T4), mappings projection+draft (T5), routes (T6), CLI (T7), primitives (T8), api (T9), picker (T10), table+page (T11), TermDialog (T12), TermMappingDialog (T13), e2e (T14), acceptance (T15). All spec sections mapped.
- **Type consistency:** `Term`/`TermInput`/`TermMapping`/`TermMappingInput`/`MapType`/`TermStatus` are defined once in the admin store (T3/T5) and mirrored in api.ts (T9) — keep field names identical (`fromSystem`/`fromCode`/`toSystem`/`toCode`/`toDisplay`/`mapType`/`isActive`; `shortName`/`class`/`unit`/`replacedBy`/`metadata`). `LOCAL_MAP_URL` is the single projection map.
- **Open risks:** (1) pg-mem `ilike` + nested transactions + `sql\`now()\`` — verify in T2/T5; adapt per the notes without weakening production SQL. (2) app.test fake extension for terms/mappings (T6) — mirror SP1's in-memory fake. (3) Radix nested dialog (TermDialog → TermMappingDialog) + tab interactions in jsdom/headless (T12–T14) — keep component tests minimal and the e2e robust-with-fallback. (4) the mapping search mode picks a target system then a term (simpler than corlix's cross-system search) — noted divergence.
- **No `Co-authored-by` trailer** (P1-CONV-2).
