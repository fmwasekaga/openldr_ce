# DHIS2 Admin UI — SP-B (OrgUnit Mapping) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/dhis2/orgunits` page to map OpenLDR facilities (FHIR Locations) → DHIS2 orgUnits, backed by a persisted metadata cache.

**Architecture:** New internal migration + JSONB single-row metadata cache store; `FhirStore.listByType` for facilities; `OrgUnitMapStore.remove`; three new `/api/dhis2/orgunit-mappings` routes (composed from `ctx.internalDb`/`ctx.fhirStore`, decoupled from the DHIS2 target); a searchable combobox primitive; the OrgUnits page.

**Tech Stack:** Kysely (pg + pg-mem tests), Fastify + Vitest, zod, React + react-i18next + shadcn/ui + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-21-dhis2-admin-ui-sp-b-design.md`
**Builds on:** SP-A (`apps/server/src/dhis2-routes.ts`, the `/dhis2` Settings page, `pullDhis2Metadata`, `dhis2.*` i18n, `getDhis2Status` pattern).

---

## File Structure

- Create `packages/db/src/migrations/internal/022_dhis2_metadata_cache.ts` — migration.
- Modify `packages/db/src/migrations/internal/index.ts` — register 022.
- Modify `packages/db/src/schema/internal.ts` — `Dhis2MetadataCacheTable` + registration.
- Create `packages/db/src/dhis2-metadata-cache.ts` (+ `.test.ts`) — cache store.
- Modify `packages/db/src/index.ts` — export the cache store.
- Modify `packages/db/src/fhir-store.ts` (+ create `fhir-store.test.ts`) — `listByType`.
- Modify `packages/db/src/dhis2-store.ts` (+ create `dhis2-store.test.ts`) — `OrgUnitMapStore.remove`.
- Modify `packages/bootstrap/src/dhis2-context.ts` — expose `metadataCache` on `Dhis2Context`.
- Modify `apps/server/src/dhis2-routes.ts` (+ `dhis2-routes.test.ts`) — `deps` param, persist-on-pull, 3 orgunit-mapping routes.
- Modify `apps/server/src/app.ts` — construct `deps` from `ctx.internalDb`, pass to `registerDhis2Routes`.
- Create `apps/web/src/components/ui/combobox.tsx` (+ `.test.tsx`) — searchable combobox.
- Modify `apps/web/src/api.ts` — orgunit-mapping client + types.
- Create `apps/web/src/pages/Dhis2OrgUnits.tsx` (+ `.test.tsx`).
- Modify `apps/web/src/App.tsx` — `/dhis2/orgunits` route.
- Modify `apps/web/src/pages/Dhis2.tsx` — "Manage →" link on the Overview card.
- Modify `apps/web/src/i18n/index.ts` — `dhis2.orgunits.*` keys.

All commands run from repo root. Tests: `pnpm --filter <pkg> test -- --run <file>`.

---

## Task 1: Metadata cache — migration, schema, store

**Files:**
- Create: `packages/db/src/migrations/internal/022_dhis2_metadata_cache.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/schema/internal.ts`
- Create: `packages/db/src/dhis2-metadata-cache.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/dhis2-metadata-cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/dhis2-metadata-cache.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createDhis2MetadataCache } from './dhis2-metadata-cache';

const sample = {
  dataElements: [{ id: 'de1', name: 'DE 1' }],
  orgUnits: [{ id: 'ou1', name: 'Clinic A' }, { id: 'ou2', name: 'Clinic B' }],
  categoryOptionCombos: [{ id: 'coc1', name: 'default' }],
  programs: [],
  programStages: [],
};

describe('dhis2-metadata-cache', () => {
  it('returns null before anything is saved', async () => {
    const db = await makeMigratedDb();
    const cache = createDhis2MetadataCache(db);
    expect(await cache.get()).toBeNull();
    await db.destroy();
  });

  it('round-trips the snapshot and keeps a single row across saves', async () => {
    const db = await makeMigratedDb();
    const cache = createDhis2MetadataCache(db);
    await cache.save(sample);
    const got = await cache.get();
    expect(got?.metadata.orgUnits).toHaveLength(2);
    expect(typeof got?.pulledAt).toBe('string');

    // Second save replaces the single row (no duplicate).
    await cache.save({ ...sample, orgUnits: [{ id: 'ou1', name: 'Clinic A' }] });
    const got2 = await cache.get();
    expect(got2?.metadata.orgUnits).toHaveLength(1);
    const count = await db.selectFrom('dhis2_metadata_cache').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(1);
    await db.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/db test -- --run dhis2-metadata-cache.test.ts`
Expected: FAIL — module/table missing.

- [ ] **Step 3: Create the migration**

Create `packages/db/src/migrations/internal/022_dhis2_metadata_cache.ts`:

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('dhis2_metadata_cache')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('metadata', 'jsonb', (c) => c.notNull())
    .addColumn('pulled_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('dhis2_metadata_cache').ifExists().execute();
}
```

- [ ] **Step 4: Register the migration**

In `packages/db/src/migrations/internal/index.ts`, add the import after the `m021` import:

```ts
import * as m022 from './022_dhis2_metadata_cache';
```

and add the entry after the `'021_user_profiles'` line in the `internalMigrations` object:

```ts
  '022_dhis2_metadata_cache': { up: m022.up, down: m022.down },
```

- [ ] **Step 5: Add the schema type**

In `packages/db/src/schema/internal.ts`, add this interface next to the other `Dhis2*Table` interfaces (after `Dhis2SchedulesTable`):

```ts
export interface Dhis2MetadataCacheTable {
  id: string;
  metadata: JSONColumnType<import('@openldr/ports').TargetMetadata>;
  pulled_at: Generated<Date>;
}
```

and register it in the `InternalSchema` interface after `dhis2_schedules: Dhis2SchedulesTable;`:

```ts
  dhis2_metadata_cache: Dhis2MetadataCacheTable;
```

(`JSONColumnType` and `Generated` are already imported in this file.)

- [ ] **Step 6: Create the store**

Create `packages/db/src/dhis2-metadata-cache.ts`:

```ts
import { type Kysely, sql } from 'kysely';
import type { TargetMetadata } from '@openldr/ports';
import type { InternalSchema } from './schema/internal';

const ROW_ID = 'latest';

export interface Dhis2MetadataCache {
  get(): Promise<{ metadata: TargetMetadata; pulledAt: string } | null>;
  save(metadata: TargetMetadata): Promise<void>;
}

export function createDhis2MetadataCache(db: Kysely<InternalSchema>): Dhis2MetadataCache {
  return {
    async get() {
      const row = await db
        .selectFrom('dhis2_metadata_cache')
        .select(['metadata', 'pulled_at'])
        .where('id', '=', ROW_ID)
        .executeTakeFirst();
      if (!row) return null;
      const pulledAt = row.pulled_at instanceof Date ? row.pulled_at.toISOString() : String(row.pulled_at);
      return { metadata: row.metadata as TargetMetadata, pulledAt };
    },
    async save(metadata) {
      await db
        .insertInto('dhis2_metadata_cache')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values({ id: ROW_ID, metadata: JSON.stringify(metadata) as any, pulled_at: sql`now()` as any })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            metadata: JSON.stringify(metadata) as any,
            pulled_at: sql`now()`,
          }),
        )
        .execute();
    },
  };
}
```

- [ ] **Step 7: Export the store**

In `packages/db/src/index.ts`, add after the other store exports (e.g. after `export * from './dhis2-store';` if present, otherwise next to `dhis2-schedule-store`):

```ts
export * from './dhis2-metadata-cache';
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @openldr/db test -- --run dhis2-metadata-cache.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/migrations/internal/022_dhis2_metadata_cache.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts packages/db/src/dhis2-metadata-cache.ts packages/db/src/dhis2-metadata-cache.test.ts packages/db/src/index.ts
git commit -m "feat(db): dhis2 metadata cache store + migration 022"
```

---

## Task 2: `FhirStore.listByType`

**Files:**
- Modify: `packages/db/src/fhir-store.ts`
- Test: `packages/db/src/fhir-store.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/fhir-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFhirStore } from './fhir-store';

describe('fhir-store listByType', () => {
  it('returns only resources of the requested type', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db);
    await store.save({ resourceType: 'Location', id: 'loc-1', name: 'Clinic A' } as never);
    await store.save({ resourceType: 'Location', id: 'loc-2', name: 'Clinic B' } as never);
    await store.save({ resourceType: 'Organization', id: 'org-1', name: 'MoH' } as never);

    const locations = await store.listByType('Location');
    expect(locations.map((r) => r.id).sort()).toEqual(['loc-1', 'loc-2']);
    expect(locations.every((r) => r.resource.resourceType === 'Location')).toBe(true);

    expect(await store.listByType('Organization')).toHaveLength(1);
    expect(await store.listByType('Patient')).toEqual([]);
    await db.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/db test -- --run fhir-store.test.ts`
Expected: FAIL — `listByType` is not a function.

- [ ] **Step 3: Add `listByType`**

In `packages/db/src/fhir-store.ts`, add to the `FhirStore` interface (after `get(...)`):

```ts
  listByType(resourceType: string, limit?: number): Promise<{ id: string; resource: FhirResource }[]>;
```

and add the implementation inside the returned object (after the `get` method):

```ts
    async listByType(resourceType, limit = 500) {
      const rows = await db
        .selectFrom('fhir_resources')
        .select(['id', 'resource'])
        .where('resource_type', '=', resourceType)
        .orderBy('updated_at', 'desc')
        .limit(limit)
        .execute();
      return rows.map((r) => ({ id: r.id, resource: r.resource as FhirResource }));
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/db test -- --run fhir-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/fhir-store.ts packages/db/src/fhir-store.test.ts
git commit -m "feat(db): FhirStore.listByType for listing resources by type"
```

---

## Task 3: `OrgUnitMapStore.remove`

**Files:**
- Modify: `packages/db/src/dhis2-store.ts`
- Test: `packages/db/src/dhis2-store.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/dhis2-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createOrgUnitMapStore } from './dhis2-store';

describe('orgUnit map store', () => {
  it('upserts then removes a mapping', async () => {
    const db = await makeMigratedDb();
    const store = createOrgUnitMapStore(db);
    await store.upsert([{ facilityId: 'f1', orgUnitId: 'ou1', orgUnitName: 'Clinic A' }]);
    expect(await store.list()).toHaveLength(1);

    await store.remove('f1');
    expect(await store.list()).toEqual([]);

    // Removing a non-existent facility is a no-op (no throw).
    await store.remove('nope');
    await db.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/db test -- --run dhis2-store.test.ts`
Expected: FAIL — `remove` is not a function.

- [ ] **Step 3: Add `remove`**

In `packages/db/src/dhis2-store.ts`, add to the `OrgUnitMapStore` interface (after `getMap()`):

```ts
  remove(facilityId: string): Promise<void>;
```

and add the implementation in `createOrgUnitMapStore`'s returned object (after `getMap`):

```ts
    async remove(facilityId) {
      await db.deleteFrom('dhis2_orgunit_map').where('facility_id', '=', facilityId).execute();
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/db test -- --run dhis2-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/dhis2-store.ts packages/db/src/dhis2-store.test.ts
git commit -m "feat(db): OrgUnitMapStore.remove"
```

---

## Task 4: Expose cache on Dhis2Context + extend route registrar (deps) + persist-on-pull

**Files:**
- Modify: `packages/bootstrap/src/dhis2-context.ts`
- Modify: `apps/server/src/dhis2-routes.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/src/dhis2-routes.test.ts`

Notes: `AppContext` exposes `ctx.internalDb: Kysely<InternalSchema>` and `ctx.fhirStore`. The route registrar currently is `registerDhis2Routes(app, ctx, dhis2)`; this task adds a 4th `deps` param so the DB-only stores are injectable in tests and decoupled from the DHIS2 target.

- [ ] **Step 1: Expose `metadataCache` on `Dhis2Context`**

In `packages/bootstrap/src/dhis2-context.ts`:
- Add to the imports from `@openldr/db` (the existing `createOrgUnitMapStore`/`createMappingStore`/`createScheduleStore` import block): `createDhis2MetadataCache`.
- Add to the `Dhis2Context` interface (after `schedules: ReturnType<typeof createScheduleStore>;`):

```ts
  metadataCache: ReturnType<typeof createDhis2MetadataCache>;
```

- In `createDhis2Context`, after `const schedules = createScheduleStore(db);` add:

```ts
  const metadataCache = createDhis2MetadataCache(db);
```

- In the returned object (after `schedules,`) add:

```ts
    metadataCache,
```

(`db` here is the internal Kysely db already used to build the other stores.)

- [ ] **Step 2: Update the route test harness + add the persist-on-pull assertion (failing)**

In `apps/server/src/dhis2-routes.test.ts`, update the `appWith` helper to pass a `deps` object, and add fakes. Replace the existing `appWith` function with:

```ts
function fakeDeps(over: Record<string, unknown> = {}) {
  const orgUnitRows: { facilityId: string; orgUnitId: string; orgUnitName: string | null }[] = [];
  let saved: unknown = null;
  return {
    metadataCache: {
      get: async () => (saved ? { metadata: saved, pulledAt: '2026-01-01T00:00:00.000Z' } : null),
      save: async (m: unknown) => { saved = m; },
    },
    orgUnitStore: {
      list: async () => orgUnitRows.slice(),
      upsert: async (entries: typeof orgUnitRows) => { for (const e of entries) { const i = orgUnitRows.findIndex((r) => r.facilityId === e.facilityId); if (i >= 0) orgUnitRows[i] = e; else orgUnitRows.push(e); } },
      remove: async (facilityId: string) => { const i = orgUnitRows.findIndex((r) => r.facilityId === facilityId); if (i >= 0) orgUnitRows.splice(i, 1); },
      getMap: async () => new Map(),
    },
    ...over,
  };
}

function fakeCtx(cfg: Record<string, unknown>, fhirStore: Record<string, unknown> = {}) {
  const audit: unknown[] = [];
  return {
    cfg,
    fhirStore: { listByType: async () => [], ...fhirStore },
    audit: { record: async (e: unknown) => { audit.push(e); }, list: async () => [] },
    logger: { error: () => {} },
    __audit: audit,
  } as unknown as AppContext;
}

function appWith(ctxCfg: Record<string, unknown>, dhis2: unknown, roles: string[] = ['lab_admin'], deps = fakeDeps(), fhirStore: Record<string, unknown> = {}) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'admin', username: 'admin', displayName: null, roles };
  });
  registerDhis2Routes(app, fakeCtx(ctxCfg, fhirStore), dhis2 as never, deps as never);
  return app;
}
```

Then add a persist-on-pull assertion inside the `describe('dhis2 metadata pull route', ...)` block:

```ts
  it('persists the snapshot to the cache and returns pulledAt', async () => {
    const deps = fakeDeps();
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], deps);
    const res = await app.inject({ method: 'POST', url: '/api/dhis2/metadata/pull' });
    expect(res.statusCode).toBe(200);
    expect(res.json().pulledAt).toBe('2026-01-01T00:00:00.000Z');
    expect(await deps.metadataCache.get()).not.toBeNull(); // save was called
  });
```

> Note: `appWith` calls earlier in the file that passed only `(cfg, dhis2)` or `(cfg, dhis2, roles)` keep working because `deps`/`fhirStore` have defaults. The `fakeCtx` now also supplies `audit` (used by the orgunit routes in Task 5).

- [ ] **Step 3: Run test to verify the new pull assertion fails**

Run: `pnpm --filter @openldr/server test -- --run dhis2-routes.test.ts`
Expected: FAIL — `registerDhis2Routes` takes 3 args / `pulledAt` undefined.

- [ ] **Step 4: Add the `deps` param + persist on pull**

In `apps/server/src/dhis2-routes.ts`:
- Add a `Deps` type and the 4th param. Replace the signature line:

```ts
export function registerDhis2Routes(app: FastifyInstance<any, any, any, any>, ctx: AppContext, dhis2: Dhis2Context | null): void {
```

with:

```ts
import type { Dhis2MetadataCache } from '@openldr/db';
import type { OrgUnitMapStore } from '@openldr/db';

export interface Dhis2RouteDeps {
  metadataCache: Dhis2MetadataCache;
  orgUnitStore: OrgUnitMapStore;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerDhis2Routes(app: FastifyInstance<any, any, any, any>, ctx: AppContext, dhis2: Dhis2Context | null, deps: Dhis2RouteDeps): void {
```

(Move the two `import type` lines to the top with the other imports; shown here for locality.)

- In the `POST /api/dhis2/metadata/pull` handler, after a successful `const md = await dhis2.pullMetadata();`, persist and return `pulledAt`. Replace the success `return { counts: {...} };` block with:

```ts
      const md = await dhis2.pullMetadata();
      await deps.metadataCache.save(md);
      const cached = await deps.metadataCache.get();
      return {
        pulledAt: cached?.pulledAt ?? null,
        counts: {
          dataElements: md.dataElements.length,
          orgUnits: md.orgUnits.length,
          categoryOptionCombos: md.categoryOptionCombos.length,
          programs: md.programs?.length ?? 0,
          programStages: md.programStages?.length ?? 0,
        },
      };
```

(Remove the old `const md = await dhis2.pullMetadata();` line that preceded the old return, so it isn't declared twice.)

- [ ] **Step 5: Wire deps in `buildApp`**

In `apps/server/src/app.ts`:
- Add to the `@openldr/db` imports (create the import if absent):

```ts
import { createDhis2MetadataCache, createOrgUnitMapStore } from '@openldr/db';
```

- Replace the `registerDhis2Routes(app, ctx, dhis2);` line with:

```ts
  registerDhis2Routes(app, ctx, dhis2, {
    metadataCache: createDhis2MetadataCache(ctx.internalDb),
    orgUnitStore: createOrgUnitMapStore(ctx.internalDb),
  });
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @openldr/server test -- --run dhis2-routes.test.ts && pnpm --filter @openldr/server typecheck`
Expected: PASS (existing dhis2 tests + new pull-persist test); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src/dhis2-context.ts apps/server/src/dhis2-routes.ts apps/server/src/dhis2-routes.test.ts apps/server/src/app.ts
git commit -m "feat(dhis2): metadata cache on context; pull persists snapshot; route deps param"
```

---

## Task 5: OrgUnit-mapping routes (GET / PUT / DELETE)

**Files:**
- Modify: `apps/server/src/dhis2-routes.ts`
- Test: `apps/server/src/dhis2-routes.test.ts`

Notes: facility name = `Location.name` (string) when present, else the id. Audit `before` = the prior mapping found in `orgUnitStore.list()`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/server/src/dhis2-routes.test.ts`:

```ts
describe('dhis2 orgunit-mappings routes', () => {
  const locations = { listByType: async () => [
    { id: 'loc-1', resource: { resourceType: 'Location', id: 'loc-1', name: 'Clinic A' } },
    { id: 'loc-2', resource: { resourceType: 'Location', id: 'loc-2' } }, // no name → falls back to id
  ] };

  it('GET composes facilities + mappings + cached orgUnits', async () => {
    const deps = fakeDeps();
    await deps.orgUnitStore.upsert([{ facilityId: 'loc-1', orgUnitId: 'ou1', orgUnitName: 'Clinic A OU' }]);
    await deps.metadataCache.save({ dataElements: [], orgUnits: [{ id: 'ou1', name: 'Clinic A OU' }], categoryOptionCombos: [], programs: [], programStages: [] } as never);
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], deps, locations);
    const body = (await app.inject({ method: 'GET', url: '/api/dhis2/orgunit-mappings' })).json();
    expect(body.facilities).toEqual([
      { facilityId: 'loc-1', facilityName: 'Clinic A', orgUnitId: 'ou1', orgUnitName: 'Clinic A OU' },
      { facilityId: 'loc-2', facilityName: 'loc-2', orgUnitId: null, orgUnitName: null },
    ]);
    expect(body.orgUnits).toEqual([{ id: 'ou1', name: 'Clinic A OU' }]);
    expect(body.metadataPulledAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('GET works (empty catalog) when DHIS2 unconfigured', async () => {
    const app = appWith(configuredCfg({ REPORTING_TARGET_ADAPTER: 'pg' }), null, ['lab_admin'], fakeDeps(), locations);
    const body = (await app.inject({ method: 'GET', url: '/api/dhis2/orgunit-mappings' })).json();
    expect(body.facilities).toHaveLength(2);
    expect(body.orgUnits).toEqual([]);
    expect(body.metadataPulledAt).toBeNull();
  });

  it('PUT upserts a mapping and records an audit event', async () => {
    const deps = fakeDeps();
    const ctxRef = fakeCtx(configuredCfg(), locations);
    const app = Fastify();
    app.addHook('onRequest', async (req) => { req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'] }; });
    registerDhis2Routes(app, ctxRef, fakeDhis2() as never, deps as never);
    const res = await app.inject({ method: 'PUT', url: '/api/dhis2/orgunit-mappings/loc-1', payload: { orgUnitId: 'ou9', orgUnitName: 'New OU' } });
    expect(res.statusCode).toBe(200);
    expect(await deps.orgUnitStore.list()).toEqual([{ facilityId: 'loc-1', orgUnitId: 'ou9', orgUnitName: 'New OU' }]);
    expect((ctxRef as any).__audit.some((e: any) => e.action === 'dhis2.orgunit.map' && e.entityId === 'loc-1')).toBe(true);
  });

  it('PUT rejects a bad body with 400', async () => {
    const app = appWith(configuredCfg(), fakeDhis2());
    const res = await app.inject({ method: 'PUT', url: '/api/dhis2/orgunit-mappings/loc-1', payload: { orgUnitName: 'x' } });
    expect(res.statusCode).toBe(400);
  });

  it('DELETE removes a mapping (204) and audits', async () => {
    const deps = fakeDeps();
    await deps.orgUnitStore.upsert([{ facilityId: 'loc-1', orgUnitId: 'ou1', orgUnitName: 'A' }]);
    const ctxRef = fakeCtx(configuredCfg(), locations);
    const app = Fastify();
    app.addHook('onRequest', async (req) => { req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'] }; });
    registerDhis2Routes(app, ctxRef, fakeDhis2() as never, deps as never);
    const res = await app.inject({ method: 'DELETE', url: '/api/dhis2/orgunit-mappings/loc-1' });
    expect(res.statusCode).toBe(204);
    expect(await deps.orgUnitStore.list()).toEqual([]);
    expect((ctxRef as any).__audit.some((e: any) => e.action === 'dhis2.orgunit.unmap')).toBe(true);
  });

  it('rejects non-admins with 403', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['data_analyst']);
    expect((await app.inject({ method: 'GET', url: '/api/dhis2/orgunit-mappings' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/dhis2/orgunit-mappings/loc-1', payload: { orgUnitId: 'x', orgUnitName: null } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: '/api/dhis2/orgunit-mappings/loc-1' })).statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server test -- --run dhis2-routes.test.ts`
Expected: FAIL — orgunit-mappings routes return 404.

- [ ] **Step 3: Implement the three routes + audit helper import**

In `apps/server/src/dhis2-routes.ts`:
- Add imports at the top: `import { z } from 'zod';` and `import { recordAudit } from './audit-helper';`.
- Add a zod schema near the top of the module (after imports):

```ts
const orgUnitMapInput = z.object({ orgUnitId: z.string().min(1), orgUnitName: z.string().nullable() });
```

- Add these three routes inside `registerDhis2Routes` (after the metadata-pull route):

```ts
  app.get('/api/dhis2/orgunit-mappings', { preHandler: requireRole('lab_admin') }, async () => {
    const [locations, mappings, cached] = await Promise.all([
      ctx.fhirStore.listByType('Location'),
      deps.orgUnitStore.list(),
      deps.metadataCache.get(),
    ]);
    const byFacility = new Map(mappings.map((m) => [m.facilityId, m]));
    const facilities = locations.map((l) => {
      const name = (l.resource as { name?: unknown }).name;
      const facilityName = typeof name === 'string' && name.length > 0 ? name : l.id;
      const m = byFacility.get(l.id);
      return { facilityId: l.id, facilityName, orgUnitId: m?.orgUnitId ?? null, orgUnitName: m?.orgUnitName ?? null };
    });
    return { facilities, orgUnits: cached?.metadata.orgUnits ?? [], metadataPulledAt: cached?.pulledAt ?? null };
  });

  app.put('/api/dhis2/orgunit-mappings/:facilityId', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const p = orgUnitMapInput.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const facilityId = (req.params as { facilityId: string }).facilityId;
    const before = (await deps.orgUnitStore.list()).find((m) => m.facilityId === facilityId) ?? null;
    const after = { facilityId, orgUnitId: p.data.orgUnitId, orgUnitName: p.data.orgUnitName };
    await deps.orgUnitStore.upsert([after]);
    await recordAudit(ctx, req, { action: 'dhis2.orgunit.map', entityType: 'dhis2-orgunit-map', entityId: facilityId, before, after, metadata: { orgUnitId: p.data.orgUnitId } });
    return after;
  });

  app.delete('/api/dhis2/orgunit-mappings/:facilityId', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const facilityId = (req.params as { facilityId: string }).facilityId;
    const before = (await deps.orgUnitStore.list()).find((m) => m.facilityId === facilityId) ?? null;
    await deps.orgUnitStore.remove(facilityId);
    await recordAudit(ctx, req, { action: 'dhis2.orgunit.unmap', entityType: 'dhis2-orgunit-map', entityId: facilityId, before, after: null });
    reply.code(204);
    return null;
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/server test -- --run dhis2-routes.test.ts && pnpm --filter @openldr/server typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/dhis2-routes.ts apps/server/src/dhis2-routes.test.ts
git commit -m "feat(dhis2): orgunit-mappings routes (GET/PUT/DELETE, audited)"
```

---

## Task 6: Web — searchable combobox primitive

**Files:**
- Create: `apps/web/src/components/ui/combobox.tsx`
- Test: `apps/web/src/components/ui/combobox.test.tsx`

Notes: built from existing `Popover` + `Input` (see `components/data-table/FilterPopover.tsx` for the Popover usage). No `cmdk`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/ui/combobox.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Combobox } from './combobox';

const options = [
  { value: 'ou1', label: 'Clinic Alpha' },
  { value: 'ou2', label: 'Clinic Beta' },
];

describe('Combobox', () => {
  it('filters by query and selects an option', async () => {
    const onChange = vi.fn();
    render(<Combobox options={options} value={null} onChange={onChange} placeholder="Pick" searchPlaceholder="Search" />);
    fireEvent.click(screen.getByRole('button', { name: /pick/i }));
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'beta' } });
    expect(screen.queryByText('Clinic Alpha')).toBeNull();
    fireEvent.click(screen.getByText('Clinic Beta'));
    expect(onChange).toHaveBeenCalledWith('ou2');
  });

  it('shows the selected label on the trigger', () => {
    render(<Combobox options={options} value="ou1" onChange={() => {}} placeholder="Pick" searchPlaceholder="Search" />);
    expect(screen.getByRole('button', { name: /clinic alpha/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/web test -- --run combobox.test.tsx`
Expected: FAIL — `./combobox` missing.

- [ ] **Step 3: Create the combobox**

Create `apps/web/src/components/ui/combobox.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/cn';

export interface ComboboxOption { value: string; label: string }

export function Combobox({
  options, value, onChange, placeholder, searchPlaceholder, disabled,
}: {
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.value === value) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" disabled={disabled} className="w-full justify-between font-normal" aria-label={selected ? selected.label : placeholder}>
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <div className="p-2"><Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchPlaceholder} /></div>
        <div className="max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="px-2 py-3 text-center text-sm text-muted-foreground">{searchPlaceholder}…</div>
          ) : filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => { onChange(o.value); setOpen(false); setQuery(''); }}
            >
              <span className="truncate">{o.label}</span>
              {o.value === value ? <Check className="ml-2 h-4 w-4 shrink-0" /> : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/web test -- --run combobox.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/combobox.tsx apps/web/src/components/ui/combobox.test.tsx
git commit -m "feat(web): searchable Combobox primitive (Popover + Input)"
```

---

## Task 7: Web — orgunit-mapping API client

**Files:**
- Modify: `apps/web/src/api.ts`

- [ ] **Step 1: Add types + client functions**

In `apps/web/src/api.ts`, append after the SP-A DHIS2 block:

```ts
export interface FacilityMapping {
  facilityId: string;
  facilityName: string;
  orgUnitId: string | null;
  orgUnitName: string | null;
}
export interface Dhis2OrgUnitMappings {
  facilities: FacilityMapping[];
  orgUnits: { id: string; name: string }[];
  metadataPulledAt: string | null;
}

export async function getOrgUnitMappings(): Promise<Dhis2OrgUnitMappings> {
  const r = await authFetch('/api/dhis2/orgunit-mappings');
  if (!r.ok) throw new Error(`orgunit mappings failed: ${r.status}`);
  return r.json();
}
export async function setOrgUnitMapping(facilityId: string, body: { orgUnitId: string; orgUnitName: string | null }): Promise<FacilityMapping> {
  const r = await authFetch(`/api/dhis2/orgunit-mappings/${encodeURIComponent(facilityId)}`, { ...json(body), method: 'PUT' });
  if (!r.ok) throw new Error(`set mapping failed: ${r.status}`);
  return r.json();
}
export async function clearOrgUnitMapping(facilityId: string): Promise<void> {
  const r = await authFetch(`/api/dhis2/orgunit-mappings/${encodeURIComponent(facilityId)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`clear mapping failed: ${r.status}`);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @openldr/web typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api.ts
git commit -m "feat(dhis2): web api client for orgunit mappings"
```

---

## Task 8: Web — OrgUnits page + route + Settings link + i18n

**Files:**
- Create: `apps/web/src/pages/Dhis2OrgUnits.tsx`
- Test: `apps/web/src/pages/Dhis2OrgUnits.test.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/pages/Dhis2.tsx`, `apps/web/src/i18n/index.ts`

- [ ] **Step 1: Add i18n keys**

In `apps/web/src/i18n/index.ts`, inside the `dhis2` block (after the existing keys, before the block's closing `},`), add:

```ts
      orgunits: {
        title: 'Facility → OrgUnit mappings',
        manage: 'Manage →',
        facility: 'Facility',
        orgUnit: 'DHIS2 OrgUnit',
        unmapped: 'Unmapped',
        pick: 'Pick an orgUnit…',
        search: 'Search orgUnits',
        clear: 'Clear',
        pulledAt: 'OrgUnit catalog pulled {{when}}',
        neverPulled: 'No orgUnit catalog yet — pull metadata from DHIS2 settings first.',
        noFacilities: 'No facilities yet.',
        mappedToast: 'Mapped {{facility}}',
        clearedToast: 'Cleared mapping for {{facility}}',
        errorToast: 'Failed: {{error}}',
      },
```

- [ ] **Step 2: Write the failing page test**

Create `apps/web/src/pages/Dhis2OrgUnits.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getOrgUnitMappings: vi.fn(), setOrgUnitMapping: vi.fn(), clearOrgUnitMapping: vi.fn() };
});
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasRole: () => true }),
}));

import { getOrgUnitMappings, setOrgUnitMapping, clearOrgUnitMapping } from '@/api';
import { Dhis2OrgUnits } from './Dhis2OrgUnits';

const mapped = {
  facilities: [
    { facilityId: 'loc-1', facilityName: 'Clinic A', orgUnitId: 'ou1', orgUnitName: 'OU One' },
    { facilityId: 'loc-2', facilityName: 'Clinic B', orgUnitId: null, orgUnitName: null },
  ],
  orgUnits: [{ id: 'ou1', name: 'OU One' }, { id: 'ou2', name: 'OU Two' }],
  metadataPulledAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => { vi.clearAllMocks(); });

describe('DHIS2 OrgUnits page', () => {
  it('lists facilities with current mapping + unmapped badge', async () => {
    (getOrgUnitMappings as ReturnType<typeof vi.fn>).mockResolvedValue(mapped);
    render(<MemoryRouter><Dhis2OrgUnits /></MemoryRouter>);
    expect(await screen.findByText('Clinic A')).toBeTruthy();
    expect(screen.getByText('OU One')).toBeTruthy();
    expect(screen.getByText(/unmapped/i)).toBeTruthy();
  });

  it('sets a mapping via the combobox', async () => {
    (getOrgUnitMappings as ReturnType<typeof vi.fn>).mockResolvedValue(mapped);
    (setOrgUnitMapping as ReturnType<typeof vi.fn>).mockResolvedValue({ facilityId: 'loc-2', orgUnitId: 'ou2', orgUnitName: 'OU Two' });
    render(<MemoryRouter><Dhis2OrgUnits /></MemoryRouter>);
    await screen.findByText('Clinic B');
    // Open the combobox in Clinic B's row (the unmapped picker) and choose OU Two.
    fireEvent.click(screen.getByTestId('orgunit-picker-loc-2'));
    fireEvent.click(await screen.findByText('OU Two'));
    await waitFor(() => expect(setOrgUnitMapping).toHaveBeenCalledWith('loc-2', { orgUnitId: 'ou2', orgUnitName: 'OU Two' }));
  });

  it('shows the empty-catalog state when never pulled', async () => {
    (getOrgUnitMappings as ReturnType<typeof vi.fn>).mockResolvedValue({ ...mapped, orgUnits: [], metadataPulledAt: null });
    render(<MemoryRouter><Dhis2OrgUnits /></MemoryRouter>);
    expect(await screen.findByText(/no orgunit catalog yet/i)).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @openldr/web test -- --run Dhis2OrgUnits.test.tsx`
Expected: FAIL — `./Dhis2OrgUnits` missing.

- [ ] **Step 4: Create the page**

Create `apps/web/src/pages/Dhis2OrgUnits.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getOrgUnitMappings, setOrgUnitMapping, clearOrgUnitMapping, type Dhis2OrgUnitMappings } from '@/api';

export function Dhis2OrgUnits() {
  const { t } = useTranslation();
  const [data, setData] = useState<Dhis2OrgUnitMappings | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try { setData(await getOrgUnitMappings()); }
    catch (e) { setToast({ kind: 'err', text: t('dhis2.orgunits.errorToast', { error: e instanceof Error ? e.message : String(e) }) }); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 5000); return () => clearTimeout(id); }, [toast]);

  const options = useMemo(() => (data?.orgUnits ?? []).map((o) => ({ value: o.id, label: o.name })), [data]);
  const catalogEmpty = (data?.orgUnits.length ?? 0) === 0;

  const onPick = useCallback(async (facilityId: string, orgUnitId: string) => {
    const ou = data?.orgUnits.find((o) => o.id === orgUnitId);
    try {
      await setOrgUnitMapping(facilityId, { orgUnitId, orgUnitName: ou?.name ?? null });
      setToast({ kind: 'ok', text: t('dhis2.orgunits.mappedToast', { facility: facilityId }) });
      await load();
    } catch (e) { setToast({ kind: 'err', text: t('dhis2.orgunits.errorToast', { error: e instanceof Error ? e.message : String(e) }) }); }
  }, [data, load, t]);

  const onClear = useCallback(async (facilityId: string) => {
    try { await clearOrgUnitMapping(facilityId); setToast({ kind: 'ok', text: t('dhis2.orgunits.clearedToast', { facility: facilityId }) }); await load(); }
    catch (e) { setToast({ kind: 'err', text: t('dhis2.orgunits.errorToast', { error: e instanceof Error ? e.message : String(e) }) }); }
  }, [load, t]);

  return (
    <AppShell title="DHIS2 OrgUnits">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" data-testid="dhis2-orgunits-page">
        <div className="text-sm text-muted-foreground">
          {data?.metadataPulledAt
            ? t('dhis2.orgunits.pulledAt', { when: new Date(data.metadataPulledAt).toLocaleString() })
            : t('dhis2.orgunits.neverPulled')}
        </div>
        {toast ? (
          <div className={toast.kind === 'ok'
            ? 'rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700'
            : 'rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive'}>{toast.text}</div>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('dhis2.orgunits.facility')}</TableHead>
              <TableHead>{t('dhis2.orgunits.orgUnit')}</TableHead>
              <TableHead className="w-72" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.facilities.length ?? 0) === 0 ? (
              <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">{t('dhis2.orgunits.noFacilities')}</TableCell></TableRow>
            ) : data!.facilities.map((f) => (
              <TableRow key={f.facilityId}>
                <TableCell>
                  <div className="font-medium">{f.facilityName}</div>
                  <div className="text-xs text-muted-foreground">{f.facilityId}</div>
                </TableCell>
                <TableCell>
                  {f.orgUnitId
                    ? <span>{f.orgUnitName ?? f.orgUnitId} <span className="text-xs text-muted-foreground">({f.orgUnitId})</span></span>
                    : <Badge variant="outline" className="text-muted-foreground">{t('dhis2.orgunits.unmapped')}</Badge>}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2" data-testid={`orgunit-row-${f.facilityId}`}>
                    <div className="flex-1" data-testid={`orgunit-picker-${f.facilityId}`}>
                      <Combobox
                        options={options}
                        value={f.orgUnitId}
                        onChange={(v) => void onPick(f.facilityId, v)}
                        placeholder={t('dhis2.orgunits.pick')}
                        searchPlaceholder={t('dhis2.orgunits.search')}
                        disabled={catalogEmpty}
                      />
                    </div>
                    {f.orgUnitId ? (
                      <Button variant="ghost" size="sm" onClick={() => void onClear(f.facilityId)}>{t('dhis2.orgunits.clear')}</Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </AppShell>
  );
}
```

> Note on the test's `orgunit-picker-loc-2` click: the picker `div` wraps the `Combobox` trigger button; clicking the testid container bubbles to the button and opens the popover. If the click does not open it in the test, target the button inside instead: `within(screen.getByTestId('orgunit-picker-loc-2')).getByRole('button')`.

- [ ] **Step 5: Add the route**

In `apps/web/src/App.tsx`, add the import near the `Dhis2` import:

```ts
import { Dhis2OrgUnits } from '@/pages/Dhis2OrgUnits';
```

and add the route after the `/dhis2` route:

```tsx
      <Route path="/dhis2/orgunits" element={<RequireRole role="lab_admin"><Dhis2OrgUnits /></RequireRole>} />
```

- [ ] **Step 6: Add the "Manage →" link on the Settings Overview card**

In `apps/web/src/pages/Dhis2.tsx`, add the import:

```ts
import { Link } from 'react-router-dom';
```

In the Overview card, change the OrgUnit mappings count line to a link. Replace:

```tsx
                <div><span className="text-muted-foreground">{t('dhis2.orgUnitMappings')}: </span>{status.counts.orgUnitMappings}</div>
```

with:

```tsx
                <div>
                  <span className="text-muted-foreground">{t('dhis2.orgUnitMappings')}: </span>{status.counts.orgUnitMappings}
                  {' '}<Link to="/dhis2/orgunits" className="text-primary hover:underline" data-testid="manage-orgunits">{t('dhis2.orgunits.manage')}</Link>
                </div>
```

- [ ] **Step 7: Run the page test + web typecheck**

Run: `pnpm --filter @openldr/web test -- --run Dhis2OrgUnits.test.tsx && pnpm --filter @openldr/web typecheck`
Expected: PASS (3 tests); typecheck clean. If the combobox-open click in test 2 fails, apply the `within(...).getByRole('button')` fallback from the note above.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/Dhis2OrgUnits.tsx apps/web/src/pages/Dhis2OrgUnits.test.tsx apps/web/src/App.tsx apps/web/src/pages/Dhis2.tsx apps/web/src/i18n/index.ts
git commit -m "feat(dhis2): OrgUnit mapping page + route + Settings link + i18n"
```

---

## Task 9: Full gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full gate**

Run: `pnpm turbo typecheck lint test build && pnpm depcruise`
Expected: all green.

- [ ] **Step 2: Fix any failures minimally and re-run.** Do not proceed until green.

- [ ] **Step 3: Commit any gate fixups (if needed)**

```bash
git add -A
git commit -m "chore(dhis2): gate fixups for SP-B"
```

---

## Notes / Out of Scope

- Mapping authoring (SP-C); operations/push/schedule (SP-D); orgUnit hierarchy/tree picker; editable connection config; live DHIS2 acceptance (tests use fakes).
