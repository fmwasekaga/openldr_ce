# Terminology Management UI — SP1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the corlix-faithful Terminology page skeleton (publisher rail + main pane + code-systems table) and full CRUD for the first two entities — Publishers and Code Systems — backed by a new authoring layer that projects into the existing flat read index.

**Architecture:** New internal PG tables `publishers` + `coding_systems` (migration 012) whose `coding_systems.url` joins the existing flat `terminology_concepts.system`. A backfill seeds corlix's publisher set (System/HL7 FHIR/LOINC/SNOMED CT/ICD-10/ICD-11) and projects existing concept systems under them by longest-prefix URL match. The 4 FHIR read ops + ingest path are untouched. A new admin store → REST routes → bootstrap `ctx.terminology.admin` → lean CLI, plus an `apps/web` page faithfully ported from corlix's `TerminologyPage` (IPC→HTTP).

**Tech Stack:** Kysely (Postgres), Fastify, Zod, React + Vite + Radix/shadcn, Vitest, pg-mem, Playwright. Spec: `docs/superpowers/specs/2026-06-15-terminology-ui-sp1-design.md`.

**Conventions (from CLAUDE.md / memory):**
- Commits scoped to requirement IDs, **no `Co-authored-by` trailer**.
- DP-1: only `@openldr/bootstrap` imports concrete adapters; this SP adds no adapter (store in `packages/db`, routes in `apps/server`, UI in `apps/web`). Keep `pnpm depcruise` clean.
- shadcn-always in `apps/web` (create the primitive if missing).
- jsonb columns: a JS array/object inserted into jsonb must be `JSON.stringify`'d (node-pg coerces a JS array to a PG array literal otherwise → "invalid input syntax for type json").
- Run gates from repo root: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm depcruise`, `pnpm build:check`.

---

## File Structure

**packages/db** (new + modified):
- Modify `src/schema/internal.ts` — add `PublishersTable`, `CodingSystemsTable` + register in `InternalSchema`.
- Create `src/migrations/internal/012_terminology_admin.ts` — tables + indexes + seed + backfill.
- Modify `src/migrations/internal/index.ts` — register `012`.
- Create `src/resolve-publisher.ts` — pure longest-prefix resolver (port of corlix).
- Create `src/terminology-admin-store.ts` — Publishers + CodingSystems CRUD + deletionImpact.
- Modify `src/index.ts` — export the new store + types + resolver.
- Tests: `src/resolve-publisher.test.ts`, `src/terminology-admin-store.test.ts`, `src/migrations/internal/012_terminology_admin.test.ts`.

**packages/bootstrap** (modified):
- Modify `src/index.ts` — open the admin store, extend `AppContext.terminology` with `admin`.
- Modify `src/terminology-context.ts` — expose `admin` + bind loaders to assign publishers.

**apps/server** (new + modified):
- Create `src/terminology-admin-routes.ts` — REST CRUD + deletion-impact.
- Modify `src/app.ts` — register the routes.
- Modify `src/app.test.ts` — route tests.

**packages/cli** (modified):
- Modify `src/terminology.ts` — `publisher list|create`, `system list|create`.
- Modify `src/index.ts` — wire the subcommands (follow existing terminology command wiring).

**apps/web** (new + modified):
- Create `src/components/ui/checkbox.tsx`, `badge.tsx`, `alert-dialog.tsx`, `table-pagination.tsx`.
- Modify `src/components/ui/sheet.tsx` — add `SheetFooter`, `SheetDescription`.
- Modify `src/api.ts` — admin types + 10 client fns.
- Create `src/terminology/publisherSections.ts` (+ test).
- Create `src/terminology/PublisherDialog.tsx`, `CodingSystemDialog.tsx`, `DangerConfirmDialog.tsx` (+ tests).
- Create `src/pages/Terminology.tsx` (+ test).
- Modify `src/App.tsx` (route) and `src/shell/AppShell.tsx` (nav item).
- Create `e2e/tests/terminology.spec.ts`.

---

## Task 1: Schema types + migration tables (no backfill yet)

**Files:**
- Modify: `packages/db/src/schema/internal.ts`
- Create: `packages/db/src/migrations/internal/012_terminology_admin.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Test: `packages/db/src/migrations/internal/012_terminology_admin.test.ts`

- [ ] **Step 1: Add table types to the schema**

In `packages/db/src/schema/internal.ts`, add after `ConceptMapElementsTable` (around line 117):

```typescript
export interface PublishersTable {
  id: string;
  name: string;
  role: string; // 'local' | 'standard' | 'external'
  icon: string | null;
  match_prefixes: JSONColumnType<string[]>;
  seeded: Generated<boolean>;
  sort_order: Generated<number>;
}

export interface CodingSystemsTable {
  id: string;
  system_code: string;
  system_name: string;
  url: string | null;
  system_version: string | null;
  description: string | null;
  active: Generated<boolean>;
  publisher_id: string | null;
  seeded: Generated<boolean>;
}
```

Then register both in the `InternalSchema` interface (after `concept_map_elements`):

```typescript
  publishers: PublishersTable;
  coding_systems: CodingSystemsTable;
```

- [ ] **Step 2: Write the migration (tables + indexes only)**

Create `packages/db/src/migrations/internal/012_terminology_admin.ts`:

```typescript
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('publishers')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('role', 'text', (c) => c.notNull())
    .addColumn('icon', 'text')
    .addColumn('match_prefixes', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('seeded', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('sort_order', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();

  await db.schema
    .createTable('coding_systems')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('system_code', 'text', (c) => c.notNull())
    .addColumn('system_name', 'text', (c) => c.notNull())
    .addColumn('url', 'text')
    .addColumn('system_version', 'text')
    .addColumn('description', 'text')
    .addColumn('active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('publisher_id', 'text', (c) => c.references('publishers.id').onDelete('set null'))
    .addColumn('seeded', 'boolean', (c) => c.notNull().defaultTo(false))
    .execute();

  await db.schema
    .createIndex('coding_systems_url_uq')
    .ifNotExists()
    .unique()
    .on('coding_systems')
    .column('url')
    .where('url', 'is not', null)
    .execute();

  // Backfill is added in Task 3.
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('coding_systems').ifExists().execute();
  await db.schema.dropTable('publishers').ifExists().execute();
}
```

- [ ] **Step 3: Register the migration**

In `packages/db/src/migrations/internal/index.ts` add the import after `m011` and the map entry after `011_dashboards`:

```typescript
import * as m012 from './012_terminology_admin';
```
```typescript
  '012_terminology_admin': { up: m012.up, down: m012.down },
```

- [ ] **Step 4: Write the failing test**

Create `packages/db/src/migrations/internal/012_terminology_admin.test.ts`. Follow the pg-mem setup used by the existing dashboard/store tests (check `packages/db/src/dashboard-store.test.ts` for the exact `newDb`/`Migrator` pattern and reuse it verbatim). The test runs all internal migrations against pg-mem and asserts the two tables exist:

```typescript
import { describe, it, expect } from 'vitest';
import { Kysely } from 'kysely';
// import the same pg-mem + Migrator helpers the existing db tests use
import { makeMigratedDb } from './test-helpers'; // <- use whatever helper/inline setup the repo already has

describe('012_terminology_admin', () => {
  it('creates publishers and coding_systems', async () => {
    const db: Kysely<any> = await makeMigratedDb();
    await db.insertInto('publishers').values({ id: 'p1', name: 'X', role: 'local', match_prefixes: JSON.stringify([]) }).execute();
    await db.insertInto('coding_systems').values({ id: 'c1', system_code: 'X', system_name: 'X' }).execute();
    const pubs = await db.selectFrom('publishers').selectAll().execute();
    const sys = await db.selectFrom('coding_systems').selectAll().execute();
    expect(pubs).toHaveLength(1);
    expect(sys).toHaveLength(1);
    await db.destroy();
  });
});
```

> NOTE: if the repo has no shared `makeMigratedDb`, inline the same pg-mem + `Migrator` + `internalMigrations` setup that `dashboard-store.test.ts` uses. Do not invent a new harness.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @openldr/db test -- 012_terminology_admin`
Expected: PASS (both tables created, inserts succeed).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/internal.ts packages/db/src/migrations/internal/012_terminology_admin.ts packages/db/src/migrations/internal/index.ts packages/db/src/migrations/internal/012_terminology_admin.test.ts
git commit -m "feat(db): terminology authoring tables (publishers, coding_systems) — migration 012 (P2-TERM)"
```

---

## Task 2: `resolvePublisher` pure helper

**Files:**
- Create: `packages/db/src/resolve-publisher.ts`
- Test: `packages/db/src/resolve-publisher.test.ts`
- Modify: `packages/db/src/index.ts` (export)

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/resolve-publisher.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolvePublisher, type PublisherPrefixes } from './resolve-publisher';

const PUBS: PublisherPrefixes[] = [
  { id: 'sys', matchPrefixes: [] },
  { id: 'hl7', matchPrefixes: ['http://hl7.org/fhir/', 'http://terminology.hl7.org/'] },
  { id: 'loinc', matchPrefixes: ['http://loinc.org'] },
  { id: 'icd10', matchPrefixes: ['http://hl7.org/fhir/sid/icd-10'] },
];

describe('resolvePublisher', () => {
  it('matches by exact prefix', () => {
    expect(resolvePublisher('http://loinc.org', PUBS)?.id).toBe('loinc');
  });
  it('prefers the longest matching prefix', () => {
    // icd-10 prefix is longer than the bare hl7.org/fhir/ prefix
    expect(resolvePublisher('http://hl7.org/fhir/sid/icd-10', PUBS)?.id).toBe('icd10');
  });
  it('returns null when nothing matches', () => {
    expect(resolvePublisher('http://example.org/whonet', PUBS)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @openldr/db test -- resolve-publisher`
Expected: FAIL ("Cannot find module './resolve-publisher'").

- [ ] **Step 3: Implement**

Create `packages/db/src/resolve-publisher.ts` (port of corlix `apps/desktop/src/main/terminologyPublishers.ts`):

```typescript
export interface PublisherPrefixes {
  id: string;
  matchPrefixes: string[];
}

/**
 * Resolve the owning publisher for a canonical URL by LONGEST-prefix match, so a
 * more specific prefix (e.g. http://hl7.org/fhir/sid/icd-10) wins over a broader
 * one (http://hl7.org/fhir/). Returns null when nothing matches — the caller falls
 * back to the local publisher. (Ported from corlix terminologyPublishers.ts.)
 */
export function resolvePublisher<T extends PublisherPrefixes>(url: string, publishers: T[]): T | null {
  const u = url.trim();
  let best: T | null = null;
  let bestLen = -1;
  for (const p of publishers) {
    for (const prefix of p.matchPrefixes) {
      if (prefix.length > 0 && u.startsWith(prefix) && prefix.length > bestLen) {
        best = p;
        bestLen = prefix.length;
      }
    }
  }
  return best;
}
```

- [ ] **Step 4: Export it**

In `packages/db/src/index.ts` add: `export * from './resolve-publisher';`

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @openldr/db test -- resolve-publisher`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/resolve-publisher.ts packages/db/src/resolve-publisher.test.ts packages/db/src/index.ts
git commit -m "feat(db): resolvePublisher longest-prefix helper (P2-TERM)"
```

---

## Task 3: Migration backfill (seed publishers + project existing systems)

**Files:**
- Modify: `packages/db/src/migrations/internal/012_terminology_admin.ts`
- Test: `packages/db/src/migrations/internal/012_terminology_admin.test.ts`

- [ ] **Step 1: Write the failing test (extends Task 1's test file)**

Add to `012_terminology_admin.test.ts` tests for the pure seed/backfill helpers (the projection logic is extracted as pure functions so it's unit-testable without a DB round-trip):

```typescript
import { computeBackfill, SEED_PUBLISHERS, deriveSystemCode } from './012_terminology_admin';

describe('012 backfill projection', () => {
  it('seeds the six corlix publishers in order', () => {
    expect(SEED_PUBLISHERS.map((p) => p.name)).toEqual([
      'System', 'HL7 FHIR', 'LOINC', 'SNOMED CT', 'WHO · ICD-10', 'WHO · ICD-11',
    ]);
  });
  it('derives a system code from a URL', () => {
    expect(deriveSystemCode('http://loinc.org')).toBe('LOINC'); // host fallback (no path segment)
    expect(deriveSystemCode('http://example.org/whonet/organisms')).toBe('ORGANISMS');
  });
  it('projects a loinc system under LOINC and an unknown url under System', () => {
    const rows = computeBackfill(['http://loinc.org', 'http://example.org/whonet/organisms']);
    const byUrl = Object.fromEntries(rows.map((r) => [r.url, r]));
    expect(byUrl['http://loinc.org'].publisherName).toBe('LOINC');
    expect(byUrl['http://example.org/whonet/organisms'].publisherName).toBe('System');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @openldr/db test -- 012_terminology_admin`
Expected: FAIL (`computeBackfill`/`SEED_PUBLISHERS`/`deriveSystemCode` not exported).

- [ ] **Step 3: Implement the seed list + pure backfill + wire into `up`**

Edit `012_terminology_admin.ts`. Add near the top (after the `kysely` import):

```typescript
import { resolvePublisher } from '../../resolve-publisher';

export interface SeedPublisher {
  id: string;
  name: string;
  role: 'local' | 'standard' | 'external';
  matchPrefixes: string[];
  sortOrder: number;
}

// Mirrors corlix migrations/index.ts line 2252– (Your Lab → System).
export const SEED_PUBLISHERS: SeedPublisher[] = [
  { id: 'pub-system',     name: 'System',       role: 'local',    matchPrefixes: [], sortOrder: 0 },
  { id: 'pub-hl7-fhir',   name: 'HL7 FHIR',     role: 'standard', matchPrefixes: ['http://hl7.org/fhir/', 'http://terminology.hl7.org/'], sortOrder: 1 },
  { id: 'pub-loinc',      name: 'LOINC',        role: 'external', matchPrefixes: ['http://loinc.org'], sortOrder: 2 },
  { id: 'pub-snomed-ct',  name: 'SNOMED CT',    role: 'external', matchPrefixes: ['http://snomed.info/'], sortOrder: 3 },
  { id: 'pub-who-icd-10', name: 'WHO · ICD-10', role: 'external', matchPrefixes: ['http://hl7.org/fhir/sid/icd-10'], sortOrder: 4 },
  { id: 'pub-who-icd-11', name: 'WHO · ICD-11', role: 'external', matchPrefixes: ['http://id.who.int/icd/', 'http://hl7.org/fhir/sid/icd-11'], sortOrder: 5 },
];

const SYSTEM_PUBLISHER_ID = 'pub-system';

/** Derive a short system code from a canonical URL: last non-empty path segment
 * upper-cased; falls back to the host's first label; finally the whole url. */
export function deriveSystemCode(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean).pop();
    return (seg ?? u.hostname.split('.')[0] ?? url).toUpperCase();
  } catch {
    return url.toUpperCase();
  }
}

export interface BackfillRow {
  id: string;
  url: string;
  system_code: string;
  system_name: string;
  publisher_id: string;
  publisherName: string; // for tests only; not stored
}

export function computeBackfill(urls: string[]): BackfillRow[] {
  const pubs = SEED_PUBLISHERS.map((p) => ({ id: p.id, name: p.name, matchPrefixes: p.matchPrefixes }));
  return urls.map((url) => {
    const pub = resolvePublisher(url, pubs);
    const publisher = pub ?? { id: SYSTEM_PUBLISHER_ID, name: 'System' };
    const code = deriveSystemCode(url);
    return {
      id: `cs-${code}-${publisher.id}`,
      url,
      system_code: code,
      system_name: code,
      publisher_id: publisher.id,
      publisherName: publisher.name,
    };
  });
}
```

Then, at the end of `up()` (after the indexes), add the seed + backfill. Use raw `sql` inserts to avoid typing the untyped `Kysely<unknown>`:

```typescript
  // Seed publishers (idempotent on the text pk).
  for (const p of SEED_PUBLISHERS) {
    await sql`
      INSERT INTO publishers (id, name, role, icon, match_prefixes, seeded, sort_order)
      VALUES (${p.id}, ${p.name}, ${p.role}, NULL, ${JSON.stringify(p.matchPrefixes)}::jsonb, true, ${p.sortOrder})
      ON CONFLICT (id) DO NOTHING
    `.execute(db);
  }

  // Project every existing concept-system URL into a seeded coding_systems row.
  const urlRows = await sql<{ url: string }>`
    SELECT DISTINCT system AS url FROM terminology_concepts
    UNION
    SELECT DISTINCT url FROM terminology_systems
  `.execute(db);
  const urls = urlRows.rows.map((r) => r.url).filter((u): u is string => !!u);
  for (const row of computeBackfill(urls)) {
    await sql`
      INSERT INTO coding_systems (id, system_code, system_name, url, publisher_id, seeded)
      VALUES (${row.id}, ${row.system_code}, ${row.system_name}, ${row.url}, ${row.publisher_id}, true)
      ON CONFLICT (id) DO NOTHING
    `.execute(db);
  }
```

> ID note: backfilled ids use a deterministic `cs-<code>-<pub>` string (not a random uuid) so re-running migrate is idempotent and the unique `url` index protects against dupes. Publisher ids reuse corlix's stable `pub-*` ids. The `computeBackfill` import in the test pulls from the same module, so the projection rule is unit-tested directly.

> pg-mem note: the test for the *full* `up()` backfill against pg-mem may hit `UNION`/`jsonb` cast quirks. If pg-mem rejects the raw SQL, keep the DB-level assertion to the table-existence test (Task 1) and rely on the pure `computeBackfill`/`deriveSystemCode` unit tests here; verify the real backfill in live acceptance (Task 17). Do NOT weaken the live check.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @openldr/db test -- 012_terminology_admin`
Expected: PASS (seed order, code derivation, projection).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/internal/012_terminology_admin.ts packages/db/src/migrations/internal/012_terminology_admin.test.ts
git commit -m "feat(db): backfill seeds corlix publishers + projects existing systems by prefix (P2-TERM)"
```

---

## Task 4: Terminology admin store (Publishers + CodingSystems CRUD)

**Files:**
- Create: `packages/db/src/terminology-admin-store.ts`
- Test: `packages/db/src/terminology-admin-store.test.ts`
- Modify: `packages/db/src/index.ts` (export)

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/terminology-admin-store.test.ts` using the same pg-mem migrated-db setup as Task 1 (import/inline the same helper):

```typescript
import { describe, it, expect } from 'vitest';
import { Kysely } from 'kysely';
import { createTerminologyAdminStore, TerminologyAdminError } from './terminology-admin-store';
import type { InternalSchema } from './schema/internal';
import { makeMigratedDb } from './migrations/internal/012_terminology_admin.test'; // or shared helper

describe('terminology admin store', () => {
  async function store() {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    return { db, s: createTerminologyAdminStore(db) };
  }

  it('lists the seeded publishers ordered by sort_order', async () => {
    const { s } = await store();
    const pubs = await s.publishers.list();
    expect(pubs[0].name).toBe('System');
    expect(pubs.find((p) => p.name === 'LOINC')?.role).toBe('external');
  });

  it('creates, updates, and deletes a custom publisher', async () => {
    const { s } = await store();
    const p = await s.publishers.create({ name: 'My Lab', role: 'local', icon: '🧪' });
    expect(p.seeded).toBe(false);
    const u = await s.publishers.update(p.id, { name: 'My Lab 2', role: 'external', icon: null });
    expect(u.name).toBe('My Lab 2');
    await s.publishers.delete(p.id);
    expect((await s.publishers.list()).find((x) => x.id === p.id)).toBeUndefined();
  });

  it('refuses to delete a seeded publisher', async () => {
    const { s } = await store();
    const loinc = (await s.publishers.list()).find((p) => p.name === 'LOINC')!;
    await expect(s.publishers.delete(loinc.id)).rejects.toBeInstanceOf(TerminologyAdminError);
  });

  it('creates a code system and reports deletion impact', async () => {
    const { db, s } = await store();
    const sys = await s.codingSystems.create({ systemCode: 'X', systemName: 'X system', url: 'http://x.org', active: true, publisherId: null });
    await db.insertInto('terminology_concepts').values([
      { system: 'http://x.org', code: 'a', display: 'A', status: null, properties: null },
      { system: 'http://x.org', code: 'b', display: 'B', status: null, properties: null },
    ]).execute();
    const impact = await s.codingSystems.deletionImpact(sys.id);
    expect(impact.termCount).toBe(2);
  });
});
```

> If the migrated-db helper is inlined in Task 1's test rather than exported, extract it to a small shared `packages/db/src/migrations/internal/test-helpers.ts` and import it from both test files (DRY).

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @openldr/db test -- terminology-admin-store`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the store**

Create `packages/db/src/terminology-admin-store.ts`:

```typescript
import { type Kysely } from 'kysely';
import { sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export type PublisherRole = 'local' | 'standard' | 'external';

export interface Publisher {
  id: string;
  name: string;
  role: PublisherRole;
  icon: string | null;
  seeded: boolean;
  sortOrder: number;
}
export interface PublisherInput { name: string; role: PublisherRole; icon?: string | null }

export interface CodingSystem {
  id: string;
  systemCode: string;
  systemName: string;
  url: string | null;
  systemVersion: string | null;
  description: string | null;
  active: boolean;
  publisherId: string | null;
  seeded: boolean;
}
export interface CodingSystemInput {
  systemCode: string;
  systemName: string;
  url?: string | null;
  systemVersion?: string | null;
  description?: string | null;
  active: boolean;
  publisherId?: string | null;
}

export class TerminologyAdminError extends Error {
  constructor(message: string, public readonly kind: 'not-found' | 'conflict') {
    super(message);
    this.name = 'TerminologyAdminError';
  }
}

let counter = 0;
function newId(prefix: string): string {
  // A module counter (no Date.now/Math.random) is fine: the store runs per-process.
  counter += 1;
  return `${prefix}-${counter}-${process.pid}`;
}

export interface TerminologyAdminStore {
  publishers: {
    list(): Promise<Publisher[]>;
    create(input: PublisherInput): Promise<Publisher>;
    update(id: string, input: PublisherInput): Promise<Publisher>;
    delete(id: string): Promise<void>;
    deletionImpact(id: string): Promise<{ systemCount: number; termCount: number }>;
  };
  codingSystems: {
    list(publisherId?: string): Promise<CodingSystem[]>;
    create(input: CodingSystemInput): Promise<CodingSystem>;
    update(id: string, input: CodingSystemInput): Promise<CodingSystem>;
    delete(id: string): Promise<void>;
    deletionImpact(id: string): Promise<{ termCount: number; mappingCount: number }>;
    upsertByUrl(input: { url: string; systemCode: string; systemName: string; systemVersion?: string | null; publisherId: string | null }): Promise<void>;
  };
}

export function createTerminologyAdminStore(db: Kysely<InternalSchema>): TerminologyAdminStore {
  const pubRow = (r: { id: string; name: string; role: string; icon: string | null; seeded: boolean; sort_order: number }): Publisher => ({
    id: r.id, name: r.name, role: r.role as PublisherRole, icon: r.icon, seeded: r.seeded, sortOrder: r.sort_order,
  });
  const csRow = (r: { id: string; system_code: string; system_name: string; url: string | null; system_version: string | null; description: string | null; active: boolean; publisher_id: string | null; seeded: boolean }): CodingSystem => ({
    id: r.id, systemCode: r.system_code, systemName: r.system_name, url: r.url, systemVersion: r.system_version,
    description: r.description, active: r.active, publisherId: r.publisher_id, seeded: r.seeded,
  });

  return {
    publishers: {
      async list() {
        const rows = await db.selectFrom('publishers').selectAll().orderBy('sort_order').orderBy('name').execute();
        return rows.map(pubRow);
      },
      async create(input) {
        const id = newId('pub');
        await db.insertInto('publishers').values({
          id, name: input.name, role: input.role, icon: input.icon ?? null,
          // jsonb default []: a JS array MUST be stringified for jsonb (node-pg trap).
          match_prefixes: sql`'[]'::jsonb` as never, seeded: false, sort_order: 100,
        }).execute();
        return pubRow(await db.selectFrom('publishers').selectAll().where('id', '=', id).executeTakeFirstOrThrow());
      },
      async update(id, input) {
        const existing = await db.selectFrom('publishers').select(['seeded']).where('id', '=', id).executeTakeFirst();
        if (!existing) throw new TerminologyAdminError(`publisher not found: ${id}`, 'not-found');
        await db.updateTable('publishers').set({ name: input.name, role: input.role, icon: input.icon ?? null }).where('id', '=', id).execute();
        return pubRow(await db.selectFrom('publishers').selectAll().where('id', '=', id).executeTakeFirstOrThrow());
      },
      async delete(id) {
        const row = await db.selectFrom('publishers').select(['seeded']).where('id', '=', id).executeTakeFirst();
        if (!row) throw new TerminologyAdminError(`publisher not found: ${id}`, 'not-found');
        if (row.seeded) throw new TerminologyAdminError('cannot delete a seeded publisher', 'conflict');
        await db.deleteFrom('publishers').where('id', '=', id).execute();
      },
      async deletionImpact(id) {
        const systems = await db.selectFrom('coding_systems').select(['url']).where('publisher_id', '=', id).execute();
        const urls = systems.map((s) => s.url).filter((u): u is string => !!u);
        let termCount = 0;
        if (urls.length) {
          const r = await db.selectFrom('terminology_concepts').select((eb) => eb.fn.countAll<number>().as('n')).where('system', 'in', urls).executeTakeFirst();
          termCount = Number(r?.n ?? 0);
        }
        return { systemCount: systems.length, termCount };
      },
    },
    codingSystems: {
      async list(publisherId) {
        let qb = db.selectFrom('coding_systems').selectAll().orderBy('system_code');
        if (publisherId) qb = qb.where('publisher_id', '=', publisherId);
        return (await qb.execute()).map(csRow);
      },
      async create(input) {
        const id = newId('cs');
        try {
          await db.insertInto('coding_systems').values({
            id, system_code: input.systemCode, system_name: input.systemName, url: input.url ?? null,
            system_version: input.systemVersion ?? null, description: input.description ?? null,
            active: input.active, publisher_id: input.publisherId ?? null, seeded: false,
          }).execute();
        } catch {
          throw new TerminologyAdminError(`duplicate code system url: ${input.url}`, 'conflict');
        }
        return csRow(await db.selectFrom('coding_systems').selectAll().where('id', '=', id).executeTakeFirstOrThrow());
      },
      async update(id, input) {
        const existing = await db.selectFrom('coding_systems').select(['id']).where('id', '=', id).executeTakeFirst();
        if (!existing) throw new TerminologyAdminError(`coding system not found: ${id}`, 'not-found');
        // system_code is immutable on update (the UI disables it).
        await db.updateTable('coding_systems').set({
          system_name: input.systemName, url: input.url ?? null, system_version: input.systemVersion ?? null,
          description: input.description ?? null, active: input.active, publisher_id: input.publisherId ?? null,
        }).where('id', '=', id).execute();
        return csRow(await db.selectFrom('coding_systems').selectAll().where('id', '=', id).executeTakeFirstOrThrow());
      },
      async delete(id) {
        const row = await db.selectFrom('coding_systems').select(['seeded']).where('id', '=', id).executeTakeFirst();
        if (!row) throw new TerminologyAdminError(`coding system not found: ${id}`, 'not-found');
        if (row.seeded) throw new TerminologyAdminError('cannot delete a seeded code system', 'conflict');
        await db.deleteFrom('coding_systems').where('id', '=', id).execute();
      },
      async deletionImpact(id) {
        const sys = await db.selectFrom('coding_systems').select(['url']).where('id', '=', id).executeTakeFirst();
        if (!sys) throw new TerminologyAdminError(`coding system not found: ${id}`, 'not-found');
        const url = sys.url;
        if (!url) return { termCount: 0, mappingCount: 0 };
        const t = await db.selectFrom('terminology_concepts').select((eb) => eb.fn.countAll<number>().as('n')).where('system', '=', url).executeTakeFirst();
        const m = await db.selectFrom('concept_map_elements').select((eb) => eb.fn.countAll<number>().as('n'))
          .where((eb) => eb.or([eb('source_system', '=', url), eb('target_system', '=', url)])).executeTakeFirst();
        return { termCount: Number(t?.n ?? 0), mappingCount: Number(m?.n ?? 0) };
      },
      async upsertByUrl(input) {
        await db.insertInto('coding_systems').values({
          id: `cs-url-${input.systemCode}`, system_code: input.systemCode, system_name: input.systemName,
          url: input.url, system_version: input.systemVersion ?? null, active: true, publisher_id: input.publisherId, seeded: true,
        }).onConflict((oc) => oc.column('url').doUpdateSet({
          system_name: input.systemName, system_version: input.systemVersion ?? null, publisher_id: input.publisherId,
        })).execute();
      },
    },
  };
}
```

> Note: corlix allows renaming a *seeded* publisher; only `delete` is blocked for seeded. We mirror that — `update` is permissive; the UI disables the role Select for seeded publishers (not the store).

- [ ] **Step 4: Export from the package**

In `packages/db/src/index.ts` add: `export * from './terminology-admin-store';`

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @openldr/db test -- terminology-admin-store`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/terminology-admin-store.ts packages/db/src/terminology-admin-store.test.ts packages/db/src/index.ts
git commit -m "feat(db): terminology admin store — publishers + coding_systems CRUD + deletion impact (P2-TERM)"
```

---

## Task 5: Bootstrap wiring (`ctx.terminology.admin`)

**Files:**
- Modify: `packages/bootstrap/src/index.ts`
- Modify: `packages/bootstrap/src/terminology-context.ts`

- [ ] **Step 1: Extend the AppContext type + build the admin store**

In `packages/bootstrap/src/index.ts`:
- Add to the import from `@openldr/db`: `createTerminologyAdminStore, type TerminologyAdminStore`.
- Change the `terminology` field type (currently `terminology: { ops: Operations };`, ~line 52) to:

```typescript
  terminology: { ops: Operations; admin: TerminologyAdminStore };
```

- In `createAppContext`, where `termStore`/`terminology` are built (~lines 127–137), add the admin store on the same internal db and include it:

```typescript
  const termAdmin = createTerminologyAdminStore(internal.db as unknown as Kysely<InternalSchema>);
  const terminology = {
    ops: createOperations({
      getConcept: (s, c) => termStore.getConcept(s, c),
      findConcepts: (q) => termStore.findConcepts(q),
      countConcepts: (q) => termStore.countConcepts(q),
      getResourceByUrl: (u) => termStore.getResourceByUrl(u),
      translate: (q) => termStore.translate(q),
    }),
    admin: termAdmin,
  };
```

- [ ] **Step 2: Expose admin in the CLI terminology context**

In `packages/bootstrap/src/terminology-context.ts`:
- Import `createTerminologyAdminStore, type TerminologyAdminStore` from `@openldr/db`.
- Add `admin: TerminologyAdminStore;` to the `TerminologyContext` interface.
- In `createTerminologyContext`, after `const store = createTerminologyStore(db, fhirStore);`, add `const admin = createTerminologyAdminStore(db);` and include `admin` in the returned object.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @openldr/bootstrap typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/bootstrap/src/index.ts packages/bootstrap/src/terminology-context.ts
git commit -m "feat(bootstrap): expose ctx.terminology.admin (P2-TERM)"
```

---

## Task 6: REST admin routes

**Files:**
- Create: `apps/server/src/terminology-admin-routes.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/src/app.test.ts`

- [ ] **Step 1: Write the failing route test**

In `apps/server/src/app.test.ts`, follow the existing app-test harness (it builds the Fastify app with an `AppContext` — reuse the exact pattern already there). Add:

```typescript
it('lists seeded publishers and creates a custom publisher + system', async () => {
  const app = await buildTestApp(); // use the repo's existing helper
  const list = await app.inject({ method: 'GET', url: '/api/terminology/publishers' });
  expect(list.statusCode).toBe(200);
  expect(JSON.parse(list.body).some((p: { name: string }) => p.name === 'LOINC')).toBe(true);

  const created = await app.inject({ method: 'POST', url: '/api/terminology/publishers', payload: { name: 'My Lab', role: 'local' } });
  expect(created.statusCode).toBe(201);

  const sys = await app.inject({ method: 'POST', url: '/api/terminology/systems', payload: { systemCode: 'MYX', systemName: 'My X', active: true } });
  expect(sys.statusCode).toBe(201);
});
```

> If `app.test.ts` mocks `ctx.terminology` with only `ops`, extend that test context so `admin` is a real `createTerminologyAdminStore` over a pg-mem migrated db (preferred — gives real behavior). Match the established test-context wiring in the file.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @openldr/server test -- app`
Expected: FAIL (404 — routes not registered).

- [ ] **Step 3: Implement the routes**

Create `apps/server/src/terminology-admin-routes.ts`:

```typescript
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { TerminologyAdminError } from '@openldr/db';
import { z } from 'zod';

const publisherInput = z.object({
  name: z.string().min(1),
  role: z.enum(['local', 'standard', 'external']),
  icon: z.string().nullish(),
});
const systemInput = z.object({
  systemCode: z.string().min(1),
  systemName: z.string().min(1),
  url: z.string().nullish(),
  systemVersion: z.string().nullish(),
  description: z.string().nullish(),
  active: z.boolean(),
  publisherId: z.string().nullish(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerTerminologyAdminRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const admin = ctx.terminology.admin;

  app.get('/api/terminology/publishers', async () => admin.publishers.list());
  app.post('/api/terminology/publishers', async (req, reply) => {
    const parsed = publisherInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    reply.code(201);
    return admin.publishers.create(parsed.data);
  });
  app.put('/api/terminology/publishers/:id', async (req, reply) => {
    const parsed = publisherInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try { return await admin.publishers.update((req.params as { id: string }).id, parsed.data); }
    catch (e) { return mapErr(e, reply); }
  });
  app.delete('/api/terminology/publishers/:id', async (req, reply) => {
    try { await admin.publishers.delete((req.params as { id: string }).id); reply.code(204); return null; }
    catch (e) { return mapErr(e, reply); }
  });
  app.get('/api/terminology/publishers/:id/deletion-impact', async (req, reply) => {
    try { return await admin.publishers.deletionImpact((req.params as { id: string }).id); }
    catch (e) { return mapErr(e, reply); }
  });

  app.get('/api/terminology/systems', async (req) => {
    const { publisher } = req.query as { publisher?: string };
    return admin.codingSystems.list(publisher);
  });
  app.post('/api/terminology/systems', async (req, reply) => {
    const parsed = systemInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try { reply.code(201); return await admin.codingSystems.create(parsed.data); }
    catch (e) { return mapErr(e, reply); }
  });
  app.put('/api/terminology/systems/:id', async (req, reply) => {
    const parsed = systemInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try { return await admin.codingSystems.update((req.params as { id: string }).id, parsed.data); }
    catch (e) { return mapErr(e, reply); }
  });
  app.delete('/api/terminology/systems/:id', async (req, reply) => {
    try { await admin.codingSystems.delete((req.params as { id: string }).id); reply.code(204); return null; }
    catch (e) { return mapErr(e, reply); }
  });
  app.get('/api/terminology/systems/:id/deletion-impact', async (req, reply) => {
    try { return await admin.codingSystems.deletionImpact((req.params as { id: string }).id); }
    catch (e) { return mapErr(e, reply); }
  });
}

function mapErr(err: unknown, reply: FastifyReply) {
  if (err instanceof TerminologyAdminError) {
    reply.code(err.kind === 'not-found' ? 404 : 409);
    return { error: err.message };
  }
  const msg = err instanceof Error ? err.message : String(err);
  reply.code(/ECONNREFUSED|connect/i.test(msg) ? 503 : 500);
  return { error: msg };
}
```

> If `@openldr/core` exports `redactError` (P2-HARD), wrap `err.message`/`msg` with it for the secret-redaction convention. Confirm the import path before adding it; otherwise leave the plain message (these errors carry no secrets) and note it as a carry-forward.

- [ ] **Step 4: Register in app.ts**

In `apps/server/src/app.ts`, import and register beside the others:

```typescript
import { registerTerminologyAdminRoutes } from './terminology-admin-routes';
```
```typescript
  registerTerminologyAdminRoutes(app, ctx);
```
(Place right after `registerTerminologyRoutes(app, ctx);`.)

- [ ] **Step 5: Run the route test**

Run: `pnpm --filter @openldr/server test -- app`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/terminology-admin-routes.ts apps/server/src/app.ts apps/server/src/app.test.ts
git commit -m "feat(server): terminology admin REST routes (publishers, systems) (P2-TERM)"
```

---

## Task 7: CLI commands (`publisher`/`system` list + create)

**Files:**
- Modify: `packages/cli/src/terminology.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Add the command runners**

In `packages/cli/src/terminology.ts`, add (mirroring the existing `runTerminology*` functions: they build `await createTerminologyContext(loadConfig())`, do work, print, `await ctx.close()`, return an exit code — match the exact imports already in the file):

```typescript
export async function runPublisherList(opts: { json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const rows = await ctx.admin.publishers.list();
    if (opts.json) console.log(JSON.stringify(rows, null, 2));
    else for (const p of rows) console.log(`${p.id}\t${p.name}\t${p.role}${p.seeded ? '\t(seeded)' : ''}`);
    return 0;
  } finally { await ctx.close(); }
}

export async function runPublisherCreate(name: string, opts: { role?: 'local' | 'external'; icon?: string; json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const p = await ctx.admin.publishers.create({ name, role: opts.role ?? 'local', icon: opts.icon ?? null });
    console.log(opts.json ? JSON.stringify(p) : `created publisher ${p.id} (${p.name})`);
    return 0;
  } finally { await ctx.close(); }
}

export async function runSystemList(opts: { publisher?: string; json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const rows = await ctx.admin.codingSystems.list(opts.publisher);
    if (opts.json) console.log(JSON.stringify(rows, null, 2));
    else for (const s of rows) console.log(`${s.systemCode}\t${s.systemName}\t${s.url ?? '—'}`);
    return 0;
  } finally { await ctx.close(); }
}

export async function runSystemCreate(code: string, name: string, opts: { url?: string; version?: string; publisher?: string; json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const s = await ctx.admin.codingSystems.create({ systemCode: code, systemName: name, url: opts.url ?? null, systemVersion: opts.version ?? null, active: true, publisherId: opts.publisher ?? null });
    console.log(opts.json ? JSON.stringify(s) : `created code system ${s.id} (${s.systemCode})`);
    return 0;
  } finally { await ctx.close(); }
}
```

- [ ] **Step 2: Wire subcommands in the CLI dispatcher**

In `packages/cli/src/index.ts`, find the existing `terminology` command group (where `terminology import|lookup|validate-code|expand|translate` are wired) and add `publisher list|create` and `system list|create` subcommands with `--json`, `--role`, `--icon`, `--url`, `--version`, `--publisher` flags, calling the runners above. Match the existing arg-parsing style exactly (same option parser, same `process.exitCode = await runX()` pattern, same redaction at the error boundary).

- [ ] **Step 3: Live smoke (build:check covers crash-on-start)**

Run (against the running stack / seeded db):
```bash
pnpm openldr terminology publisher list
pnpm openldr terminology system list --json
```
Expected: prints the seeded publishers (System/HL7 FHIR/LOINC/…) and the backfilled systems.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/terminology.ts packages/cli/src/index.ts
git commit -m "feat(cli): terminology publisher/system list+create (P2-TERM)"
```

---

## Task 8: Loaders assign publishers on import

**Files:**
- Modify: `packages/bootstrap/src/terminology-context.ts`
- Test: `packages/db/src/terminology-admin-store.test.ts` (upsertByUrl) + `pnpm --filter @openldr/bootstrap typecheck`

- [ ] **Step 1: Test `upsertByUrl` idempotence**

Add to `terminology-admin-store.test.ts`:

```typescript
it('upserts a coding system by url (idempotent, updates name)', async () => {
  const { s } = await store();
  await s.codingSystems.upsertByUrl({ url: 'http://loinc.org', systemCode: 'LOINC', systemName: 'LOINC v1', publisherId: 'pub-loinc' });
  await s.codingSystems.upsertByUrl({ url: 'http://loinc.org', systemCode: 'LOINC', systemName: 'LOINC v2', publisherId: 'pub-loinc' });
  const rows = (await s.codingSystems.list()).filter((c) => c.url === 'http://loinc.org');
  expect(rows).toHaveLength(1);
  expect(rows[0].systemName).toBe('LOINC v2');
});
```

(The `upsertByUrl` method was already added to the store in Task 4. Run `pnpm --filter @openldr/db test -- terminology-admin-store` → PASS. If Task 4 was committed without it, add it now per the Task 4 code.)

- [ ] **Step 2: Share the seed list + a resolver helper from `packages/db`**

To keep the seed list DRY between the migration and the loaders, ensure `SEED_PUBLISHERS` + a convenience `resolveSeedPublisherId(url): string` are exported from `packages/db`. Add `packages/db/src/seed-publishers.ts`:

```typescript
import { resolvePublisher } from './resolve-publisher';

export interface SeedPublisher { id: string; name: string; role: 'local' | 'standard' | 'external'; matchPrefixes: string[]; sortOrder: number }

export const SEED_PUBLISHERS: SeedPublisher[] = [
  { id: 'pub-system',     name: 'System',       role: 'local',    matchPrefixes: [], sortOrder: 0 },
  { id: 'pub-hl7-fhir',   name: 'HL7 FHIR',     role: 'standard', matchPrefixes: ['http://hl7.org/fhir/', 'http://terminology.hl7.org/'], sortOrder: 1 },
  { id: 'pub-loinc',      name: 'LOINC',        role: 'external', matchPrefixes: ['http://loinc.org'], sortOrder: 2 },
  { id: 'pub-snomed-ct',  name: 'SNOMED CT',    role: 'external', matchPrefixes: ['http://snomed.info/'], sortOrder: 3 },
  { id: 'pub-who-icd-10', name: 'WHO · ICD-10', role: 'external', matchPrefixes: ['http://hl7.org/fhir/sid/icd-10'], sortOrder: 4 },
  { id: 'pub-who-icd-11', name: 'WHO · ICD-11', role: 'external', matchPrefixes: ['http://id.who.int/icd/', 'http://hl7.org/fhir/sid/icd-11'], sortOrder: 5 },
];

export function resolveSeedPublisherId(url: string): string {
  return resolvePublisher(url, SEED_PUBLISHERS.map((p) => ({ id: p.id, matchPrefixes: p.matchPrefixes })))?.id ?? 'pub-system';
}
```

Export it from `packages/db/src/index.ts` (`export * from './seed-publishers';`). Refactor Task 3's `012_terminology_admin.ts` to import `SEED_PUBLISHERS` from `../../seed-publishers` instead of redeclaring it (keep `deriveSystemCode`/`computeBackfill` local to the migration). Re-run the Task 3 test → still PASS.

- [ ] **Step 3: Call it from the loaders + `deriveSystemCode`**

In `packages/bootstrap/src/terminology-context.ts`, import `createTerminologyAdminStore`, `resolveSeedPublisherId`, and a small URL→code helper (reuse `deriveSystemCode` — export it from `packages/db` too, or inline). After each loader returns the system URL(s) it produced, best-effort upsert:

```typescript
async function projectSystem(url: string, name: string, version: string | null): Promise<void> {
  try {
    await admin.codingSystems.upsertByUrl({
      url, systemCode: deriveSystemCode(url), systemName: name || deriveSystemCode(url),
      systemVersion: version, publisherId: resolveSeedPublisherId(url),
    });
  } catch (e) {
    logger?.warn?.({ err: e, url }, 'coding_systems projection failed (non-fatal)');
  }
}
```

Wire `projectSystem` into the `loinc`/`amr`/`resource` loader wrappers using each loader's known URL(s) (LOINC → `http://loinc.org`; WHONET → the CodeSystem URLs it emits — read `loadWhonetAmr`'s result/URLs; resource import → the resource `url`). The loaders already build the LoaderStore; thread `admin` through `createTerminologyContext`.

> If the loaders don't currently surface the produced URLs, the smallest faithful change is: after a successful load, `projectSystem(KNOWN_URL, …)` for LOINC (constant) and for WHONET iterate the systems it registered via `store.saveSystem` (capture them). Keep it best-effort; never fail an import on projection.

- [ ] **Step 4: Test**

Run: `pnpm --filter @openldr/db test -- terminology-admin-store` and `pnpm --filter @openldr/bootstrap typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/seed-publishers.ts packages/db/src/index.ts packages/db/src/migrations/internal/012_terminology_admin.ts packages/db/src/terminology-admin-store.test.ts packages/bootstrap/src/terminology-context.ts
git commit -m "feat(terminology): loaders upsert coding_systems + assign publisher on import (P2-TERM)"
```

---

## Task 9: New shadcn UI primitives

**Files:**
- Create: `apps/web/src/components/ui/checkbox.tsx`, `badge.tsx`, `alert-dialog.tsx`, `table-pagination.tsx`
- Modify: `apps/web/src/components/ui/sheet.tsx` (add `SheetFooter`, `SheetDescription`)
- Test: `apps/web/src/components/ui/ui-primitives.test.tsx` (smoke renders)

- [ ] **Step 1: Add Radix deps if missing**

Check `apps/web/package.json` for `@radix-ui/react-checkbox` and `@radix-ui/react-alert-dialog`. If absent:
```bash
pnpm --filter @openldr/web add @radix-ui/react-checkbox @radix-ui/react-alert-dialog
```

- [ ] **Step 2: Create the primitives**

Generate the standard shadcn implementations, matching the style of the existing `apps/web/src/components/ui/select.tsx`/`dialog.tsx` (Radix primitives + `cn` + the project's token classes). Required exports:
- `checkbox.tsx`: `Checkbox` (Radix Checkbox with a `Check` icon indicator).
- `badge.tsx`: `Badge` ({ variant?: 'default' | 'secondary' | 'outline'; className?: string }) — cva-based, used for role/status badges.
- `alert-dialog.tsx`: `AlertDialog`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel` (Radix AlertDialog).
- `table-pagination.tsx`: `TablePagination` ({ page: number; pageSize: number; total: number; onPageChange: (p: number) => void; onPageSizeChange: (n: number) => void; leftSlot?: React.ReactNode }) — a `border-t` bar with Prev/Next `Button`s, a page-size `Select` (10/25/50/100), an "X–Y of N" label, and the `leftSlot` on the left.

In `sheet.tsx`, add (after `SheetTitle`):
```typescript
export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-auto flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}
export const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-xs text-muted-foreground', className)} {...props} />
));
SheetDescription.displayName = 'SheetDescription';
```

> CE's `SheetContent` is fixed to the right side, renders its own close button, and defaults to `w-96`. The ported dialogs pass `className="flex w-full flex-col gap-0 p-0 sm:max-w-md"` to override width/padding and do NOT pass a `side` prop. Keep the built-in close button.

- [ ] **Step 3: Smoke tests**

Create `ui-primitives.test.tsx` that renders each primitive once and asserts a basic role/text (`Badge` renders children; `TablePagination` shows the "of N" label and fires `onPageChange` on Next; `Checkbox` fires `onCheckedChange`; `AlertDialog` shows its title when open). Use the existing Radix jsdom polyfills in `setupTests.ts`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @openldr/web test -- ui-primitives`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/ apps/web/package.json
git commit -m "feat(web): add checkbox/badge/alert-dialog/table-pagination + sheet footer/description (P2-TERM)"
```

---

## Task 10: API client (admin types + 10 fns)

**Files:**
- Modify: `apps/web/src/api.ts`

- [ ] **Step 1: Add types + client functions**

Append to `apps/web/src/api.ts`:

```typescript
// ── Terminology admin types & client ─────────────────────────────────────────
export type PublisherRole = 'local' | 'standard' | 'external';
export interface Publisher { id: string; name: string; role: PublisherRole; icon: string | null; seeded: boolean; sortOrder: number }
export interface PublisherInput { name: string; role: PublisherRole; icon?: string | null }
export interface CodingSystem {
  id: string; systemCode: string; systemName: string; url: string | null;
  systemVersion: string | null; description: string | null; active: boolean;
  publisherId: string | null; seeded: boolean;
}
export interface CodingSystemInput {
  systemCode: string; systemName: string; url?: string | null; systemVersion?: string | null;
  description?: string | null; active: boolean; publisherId?: string | null;
}

const jbody = (body: unknown, method: string) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function okJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export const listPublishers = () => fetch('/api/terminology/publishers').then((r) => okJson<Publisher[]>(r, 'list publishers'));
export const createPublisher = (i: PublisherInput) => fetch('/api/terminology/publishers', jbody(i, 'POST')).then((r) => okJson<Publisher>(r, 'create publisher'));
export const updatePublisher = (id: string, i: PublisherInput) => fetch(`/api/terminology/publishers/${id}`, jbody(i, 'PUT')).then((r) => okJson<Publisher>(r, 'update publisher'));
export async function deletePublisher(id: string): Promise<void> {
  const r = await fetch(`/api/terminology/publishers/${id}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`delete publisher failed: ${r.status}`);
}
export const publisherDeletionImpact = (id: string) => fetch(`/api/terminology/publishers/${id}/deletion-impact`).then((r) => okJson<{ systemCount: number; termCount: number }>(r, 'impact'));

export const listCodingSystems = (publisher?: string) => fetch(`/api/terminology/systems${publisher ? `?publisher=${encodeURIComponent(publisher)}` : ''}`).then((r) => okJson<CodingSystem[]>(r, 'list systems'));
export const createCodingSystem = (i: CodingSystemInput) => fetch('/api/terminology/systems', jbody(i, 'POST')).then((r) => okJson<CodingSystem>(r, 'create system'));
export const updateCodingSystem = (id: string, i: CodingSystemInput) => fetch(`/api/terminology/systems/${id}`, jbody(i, 'PUT')).then((r) => okJson<CodingSystem>(r, 'update system'));
export async function deleteCodingSystem(id: string): Promise<void> {
  const r = await fetch(`/api/terminology/systems/${id}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`delete system failed: ${r.status}`);
}
export const systemDeletionImpact = (id: string) => fetch(`/api/terminology/systems/${id}/deletion-impact`).then((r) => okJson<{ termCount: number; mappingCount: number }>(r, 'impact'));
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @openldr/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api.ts
git commit -m "feat(web): terminology admin api client (P2-TERM)"
```

---

## Task 11: `publisherSections` helper

**Files:**
- Create: `apps/web/src/terminology/publisherSections.ts`
- Test: `apps/web/src/terminology/publisherSections.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { publisherSections } from './publisherSections';
import type { Publisher, CodingSystem } from '../api';

const pub = (id: string, name: string, seeded: boolean, sortOrder: number): Publisher => ({ id, name, role: 'standard', icon: null, seeded, sortOrder });
const sys = (id: string, pubId: string): CodingSystem => ({ id, systemCode: id, systemName: id, url: null, systemVersion: null, description: null, active: true, publisherId: pubId, seeded: true });

describe('publisherSections', () => {
  it('keeps publishers with systems or that are not seeded, sorted by sortOrder', () => {
    const pubs = [pub('a', 'A', true, 1), pub('b', 'B (empty seeded)', true, 0), pub('c', 'C (custom empty)', false, 2)];
    const sections = publisherSections(pubs, [sys('s1', 'a')]);
    expect(sections.map((s) => s.publisher.id)).toEqual(['a', 'c']); // b dropped (empty seeded); sorted by sortOrder
    expect(sections[0].systems).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @openldr/web test -- publisherSections`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement (port of corlix `lib/publisherSections.ts`, value sets dropped until SP3)**

```typescript
import type { Publisher, CodingSystem } from '../api';

export interface PublisherSection {
  publisher: Publisher;
  systems: CodingSystem[];
}

export function publisherSections(publishers: Publisher[], systems: CodingSystem[]): PublisherSection[] {
  return [...publishers]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((publisher) => ({ publisher, systems: systems.filter((s) => s.publisherId === publisher.id) }))
    .filter((s) => s.systems.length > 0 || !s.publisher.seeded);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @openldr/web test -- publisherSections`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/terminology/publisherSections.ts apps/web/src/terminology/publisherSections.test.ts
git commit -m "feat(web): publisherSections grouping helper (P2-TERM)"
```

---

## Task 12: PublisherDialog (faithful port)

**Files:**
- Create: `apps/web/src/terminology/PublisherDialog.tsx`
- Test: `apps/web/src/terminology/PublisherDialog.test.tsx`

**Source:** faithful copy of corlix `apps/desktop/src/renderer/components/PublisherDialog.tsx` (read it in full). Adaptations:
- `window.api.terminology.publishers.{create,update}` → `createPublisher`/`updatePublisher` from `../api`.
- `useTranslation()` t(...) strings → inline English literals (CE apps/web has no i18n; use corlix's exact English: "New publisher" / "Edit publisher" / dialog hint / "Name" / "Role" / "Local" / "External" / seeded-role hint / "Icon" / icon hint, and `common.save`/`common.create`/`common.saving` → "Save"/"Create"/"Saving…").
- `@corlix/shared-types` → CE `Publisher`/`PublisherInput` from `../api`.
- `Sheet`/`SheetContent`/`SheetHeader`/`SheetTitle`/`SheetDescription`/`SheetFooter` from `@/components/ui/sheet`; `SheetContent` has no `side` prop — pass `className="flex w-full flex-col gap-0 p-0 sm:max-w-md"`.
- `cleanIpcError(e)` → `String((e as Error).message ?? e)`.
- Same `Props` (`open`, `onOpenChange`, `publisher: Publisher | null`, `onSaved`), same `canSave`, seeded-disables-role, error banner.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PublisherDialog } from './PublisherDialog';
import * as api from '../api';

describe('PublisherDialog', () => {
  beforeEach(() => vi.restoreAllMocks());
  it('creates a publisher', async () => {
    const created = { id: 'p9', name: 'My Lab', role: 'local', icon: null, seeded: false, sortOrder: 100 };
    vi.spyOn(api, 'createPublisher').mockResolvedValue(created as never);
    const onSaved = vi.fn();
    render(<PublisherDialog open publisher={null} onOpenChange={() => {}} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My Lab' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `pnpm --filter @openldr/web test -- PublisherDialog` → FAIL (module not found).
- [ ] **Step 3: Implement** the port with the adaptations above.
- [ ] **Step 4: Run the test to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/terminology/PublisherDialog.tsx apps/web/src/terminology/PublisherDialog.test.tsx
git commit -m "feat(web): PublisherDialog sheet (port of corlix) (P2-TERM)"
```

---

## Task 13: CodingSystemDialog (faithful port)

**Files:**
- Create: `apps/web/src/terminology/CodingSystemDialog.tsx`
- Test: `apps/web/src/terminology/CodingSystemDialog.test.tsx`

**Source:** faithful copy of corlix `apps/desktop/src/renderer/components/CodingSystemDialog.tsx`. Adaptations: same conventions as Task 12, plus:
- Publisher picker loads via `listPublishers()` on `open` (instead of the IPC list).
- `systems.{create,update}` → `createCodingSystem`/`updateCodingSystem`.
- "active" uses the new `Checkbox`. `systemCode` upper-cases on change and is `disabled={editing}`.
- Same field set/grid (`grid-cols-[1fr_140px]` URL+Version), description `<textarea>`, inline English labels ("System code"/code hint/"System name"/"URL"/url hint/"Version"/"Description"/"Publisher"/publisher placeholder/"Active").
- Same `Props` (`open`, `onOpenChange`, `system: CodingSystem | null`, `defaultPublisherId?`, `onSaved`), `canSave = systemCode && systemName`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CodingSystemDialog } from './CodingSystemDialog';
import * as api from '../api';

describe('CodingSystemDialog', () => {
  beforeEach(() => vi.restoreAllMocks());
  it('creates a code system', async () => {
    vi.spyOn(api, 'listPublishers').mockResolvedValue([]);
    const created = { id: 'c9', systemCode: 'X', systemName: 'X sys', url: null, systemVersion: null, description: null, active: true, publisherId: null, seeded: false };
    vi.spyOn(api, 'createCodingSystem').mockResolvedValue(created as never);
    const onSaved = vi.fn();
    render(<CodingSystemDialog open system={null} onOpenChange={() => {}} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('System code'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('System name'), { target: { value: 'X sys' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
  });
});
```

- [ ] **Step 2–5:** run-fail → implement the port → run-pass → commit:

```bash
git add apps/web/src/terminology/CodingSystemDialog.tsx apps/web/src/terminology/CodingSystemDialog.test.tsx
git commit -m "feat(web): CodingSystemDialog sheet (port of corlix) (P2-TERM)"
```

---

## Task 14: DangerConfirmDialog (faithful port)

**Files:**
- Create: `apps/web/src/terminology/DangerConfirmDialog.tsx`
- Test: `apps/web/src/terminology/DangerConfirmDialog.test.tsx`

**Source:** corlix `apps/desktop/src/renderer/components/DangerConfirmDialog.tsx` (read it). Type-to-confirm: an `AlertDialog` (the new primitive) with a text `Input` the user must fill with the exact `confirmName` to enable the destructive `AlertDialogAction`, plus a `summary` ReactNode (the deletion impact). Props: `{ open: boolean; onOpenChange: (o: boolean) => void; title: string; confirmName: string; confirmLabel: string; summary: React.ReactNode; onConfirm: () => void }`. Auto-focus the input.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DangerConfirmDialog } from './DangerConfirmDialog';

it('enables the action only after the exact name is typed', () => {
  const onConfirm = vi.fn();
  render(<DangerConfirmDialog open onOpenChange={() => {}} title="Delete X" confirmName="LOINC" confirmLabel="Delete" summary={<span>2 terms</span>} onConfirm={onConfirm} />);
  const action = screen.getByRole('button', { name: 'Delete' });
  expect(action).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'LOINC' } });
  expect(action).not.toBeDisabled();
  fireEvent.click(action);
  expect(onConfirm).toHaveBeenCalled();
});
```

- [ ] **Step 2–5:** run-fail → implement → run-pass → commit:

```bash
git add apps/web/src/terminology/DangerConfirmDialog.tsx apps/web/src/terminology/DangerConfirmDialog.test.tsx
git commit -m "feat(web): DangerConfirmDialog (port of corlix) (P2-TERM)"
```

---

## Task 15: Terminology page (rail + main pane + table + wiring)

**Files:**
- Create: `apps/web/src/pages/Terminology.tsx`
- Test: `apps/web/src/pages/Terminology.test.tsx`

**Source:** faithful copy of corlix `apps/desktop/src/renderer/pages/TerminologyPage.tsx` lines 528–786 (rail + breadcrumb + `⋯` menu + code-systems table + pagination), with the SP1 subset of the kebab (Publisher + Code-system subs only; Term/Value-set subs omitted until SP2/SP3; Browse/Manage ontology items rendered **disabled**). Adaptations:
- `window.api.*` → the `../api` client (`listPublishers`, `listCodingSystems`, `deletePublisher`, `deleteCodingSystem`, `publisherDeletionImpact`, `systemDeletionImpact`).
- `useTranslation` → inline English (corlix en.json strings, verbatim): rail header "Publishers", empty "No publishers yet.", pick prompt "Select a publisher to browse…", "Code systems"/"Value sets", breadcrumb, table heads "Code"/"Name"/"URL", `⋯` aria-label "Actions", submenu labels "Publisher"/"Code system", items "New"/"Edit"/"Delete"/"Browse ontology"/"Ontology distribution…", empty-publisher hint "No code systems or value sets yet. Use the ⋯ menu to add one.", "{n} code systems".
- Wrap in `AppShell title="Terminology" fullBleed`; the inner root is `<div className="flex h-full flex-col">` (AppShell's fullBleed `<main>` is already `flex min-h-0 flex-1 flex-col`, so `h-full` fills it).
- State: `publishers`, `codingSystems`, `selectedPublisherId`, `selectedSystemId`, `paneTab` ('systems'), dialog/confirm/toast state, pagination (`systemPage`, `systemPageSize` default 25). `sections = publisherSections(publishers, codingSystems)`; `activeSection = sections.find(s => s.publisher.id === selectedPublisherId)`; `selectedSystem = codingSystems.find(s => s.id === selectedSystemId)`; `bothKinds = false` (no value sets in SP1 — the tab toggle stays inert); `soleSystemDrill` honored (a publisher with exactly one system and no value sets auto-drills).
- Row click sets `selectedSystemId` and drills to a **placeholder pane**: back button "← Code systems" + breadcrumb + a centered muted message "Terms — coming in the next update." (SP2 replaces this pane body with the real terms table). This establishes the breadcrumb/back nav now.
- Load on mount: `Promise.all([listPublishers(), listCodingSystems()])`; set `selectedPublisherId` to the first section's id when unset.
- Delete flows: call `publisherDeletionImpact`/`systemDeletionImpact`, open `DangerConfirmDialog` with `confirmName` = the entity's name/code + a `summary` rendering the impact counts; on confirm call `deletePublisher`/`deleteCodingSystem`, refresh lists, show a success toast (or error toast on failure).
- Mount `PublisherDialog`, `CodingSystemDialog`, `DangerConfirmDialog` at page root.
- Reuse `TablePagination`, `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`, `Badge` (role badges in the rail), `DropdownMenu`+`Sub*`, `Button` from `@/components/ui/*`. Steel-blue active/hover accents exactly as corlix (`bg-[rgba(70,130,180,0.12)] shadow-[inset_2px_0_0_#4682b4]` / `hover:bg-[rgba(70,130,180,0.08)]`).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Terminology } from './Terminology';
import * as api from '../api';

const pub = (id: string, name: string, seeded = true) => ({ id, name, role: 'external', icon: null, seeded, sortOrder: 1 });
const sys = (id: string, code: string, pubId: string) => ({ id, systemCode: code, systemName: code, url: `http://${code}.org`, systemVersion: null, description: null, active: true, publisherId: pubId, seeded: true });

describe('Terminology page', () => {
  beforeEach(() => {
    vi.spyOn(api, 'listPublishers').mockResolvedValue([pub('pub-loinc', 'LOINC'), pub('pub-snomed-ct', 'SNOMED CT')] as never);
    vi.spyOn(api, 'listCodingSystems').mockResolvedValue([sys('cs1', 'LOINC', 'pub-loinc')] as never);
  });
  it('renders the publisher rail and a code-system', async () => {
    render(<MemoryRouter><Terminology /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Publishers')).toBeInTheDocument());
    // "LOINC" appears both as a rail publisher and a system code, so tolerate multiple.
    expect(screen.getAllByText('LOINC').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — FAIL (module not found).
- [ ] **Step 3: Implement** the page per the source + adaptations.
- [ ] **Step 4: Run the test to verify it passes** — `pnpm --filter @openldr/web test -- Terminology` → PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/Terminology.tsx apps/web/src/pages/Terminology.test.tsx
git commit -m "feat(web): Terminology page — rail + code-systems table + sheets (port of corlix) (P2-TERM)"
```

---

## Task 16: Route + nav + e2e

**Files:**
- Modify: `apps/web/src/App.tsx`, `apps/web/src/shell/AppShell.tsx`
- Create: `e2e/tests/terminology.spec.ts`

- [ ] **Step 1: Add the route**

In `apps/web/src/App.tsx`: `import { Terminology } from './pages/Terminology';` and add `<Route path="/terminology" element={<Terminology />} />` after the `/reports/:id` route.

- [ ] **Step 2: Add the nav item**

In `apps/web/src/shell/AppShell.tsx`: add `Library` to the lucide import and insert into `NAV` after Reports:
```typescript
  { to: '/terminology', label: 'Terminology', end: false, icon: Library },
```

- [ ] **Step 3: Write the e2e spec**

Create `e2e/tests/terminology.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test('terminology page lists seeded publishers and creates a publisher', async ({ page }) => {
  await page.goto('/terminology');
  await expect(page.getByText('Publishers')).toBeVisible();
  // A seeded publisher from the backfill (LOINC if LOINC was loaded; otherwise System).
  await page.getByRole('button', { name: 'System' }).first().click();

  // Create a publisher via the ⋯ menu → Publisher → New.
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Publisher' }).hover();
  await page.getByRole('menuitem', { name: 'New' }).first().click();
  await page.getByLabel('Name').fill('E2E Lab');
  await page.getByRole('button', { name: /create/i }).click();
  await expect(page.getByRole('button', { name: 'E2E Lab' })).toBeVisible();
});
```

> Selector strings must match the inline English labels chosen in Task 15 (`aria-label="Actions"` on the `⋯` trigger; submenu "Publisher"; item "New"). If the Radix submenu hover is flaky headless, fall back to asserting the rail + a seeded publisher render, and drive create via a row-level path if one exists.

- [ ] **Step 4: Typecheck + run e2e**

Run: `pnpm --filter @openldr/web typecheck`, then with a seeded stack (server on :3000 killed first): `pnpm e2e -- terminology`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/shell/AppShell.tsx e2e/tests/terminology.spec.ts
git commit -m "feat(web): wire /terminology route + nav + e2e (P2-TERM)"
```

---

## Task 17: Live acceptance + gates + docs

**Files:** (no source; verification + screenshots)

- [ ] **Step 1: Migrate + seed + verify backfill**

```bash
# kill any server on :3000 first (it steals the ingest outbox event)
pnpm openldr db reset
pnpm openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm
pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite
pnpm openldr terminology publisher list
pnpm openldr terminology system list
```
Expected: `db reset` runs migration 012 (seeds the six publishers); `system list` shows the WHONET systems under **System** (and LOINC under **LOINC** if a licensed `Loinc.csv` was imported).

- [ ] **Step 2: Run the full gate suite from repo root**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm depcruise && pnpm build:check
```
Expected: all green. depcruise must stay clean (no adapter import outside bootstrap).

- [ ] **Step 3: Run e2e**

```bash
pnpm e2e
```
Expected: the existing 8 specs + the new terminology spec all pass.

- [ ] **Step 4: Regenerate docs screenshots (nav gained a Terminology item)**

```bash
pnpm docs:screenshots
```
Review the changed PNGs (the nav now shows Terminology); verify the dashboard/docs shots still look right.

- [ ] **Step 5: Visual check `/terminology`**

Start the built server, open `/terminology`, confirm: rail shows seeded publishers with role badges + steel-blue active accent; selecting a publisher shows its code-systems table; the `⋯` menu opens; New Publisher + New Code System sheets save; deleting a custom system shows the danger confirm with impact counts.

- [ ] **Step 6: Final commit (screenshots + any acceptance fixups)**

```bash
git add -A
git commit -m "test(P2-TERM): SP1 live acceptance — backfill + page verified, screenshots regenerated (P2-TERM)"
```

---

## Self-Review notes (for the executor)

- **Spec coverage:** data model (T1–T3), admin store (T4) + loader projection (T8), bootstrap (T5), routes (T6), CLI (T7), UI primitives (T9), api client (T10), grouping (T11), dialogs (T12–T14), page (T15), wiring+e2e (T16), acceptance (T17). Every spec section maps to a task.
- **Type consistency:** `Publisher`/`PublisherInput`/`CodingSystem`/`CodingSystemInput` are defined once in the store (Task 4) and mirrored field-for-field in the web api (Task 10) — keep `systemCode`/`systemName`/`systemVersion`/`publisherId`/`sortOrder`. `SEED_PUBLISHERS`/`resolvePublisher` are shared (Task 8 extracts `seed-publishers.ts`); the migration imports them rather than redeclaring.
- **Open risks to watch:** (1) pg-mem support for the migrated schema + `UNION`/`jsonb` in the backfill SQL — keep DB assertions to table-existence + pure-helper tests; verify the real backfill live (Task 17). (2) `app.test.ts` must supply a real `ctx.terminology.admin` (pg-mem) for route tests. (3) Radix submenu interaction in headless e2e (Task 16) — fall back to render-only assertions if flaky. (4) Loaders surfacing produced URLs (Task 8) — if not readily available, project the known constant URLs best-effort; never fail an import on projection.
- **No `Co-authored-by` trailer on any commit** (P1-CONV-2).
```
