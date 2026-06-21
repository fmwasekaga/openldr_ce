# DHIS2 Admin UI — SP-C1 (Aggregate Mapping Authoring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** List DHIS2 mappings and author/edit aggregate mappings (source report → dataElements) with cache-backed pickers, report-column discovery, and inline validation.

**Architecture:** Extend `MappingStore` (remove + list-with-kind); extend the SP-B `Dhis2RouteDeps` with `mappingStore`; add mappings CRUD + validate + report-columns + metadata routes (decoupled from the DHIS2 target); a mappings list page and an aggregate editor page reusing SP-B's `Combobox`.

**Tech Stack:** Kysely (pg + pg-mem), Fastify + Vitest + zod, React + react-router + react-i18next + shadcn/ui + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-21-dhis2-admin-ui-sp-c1-design.md`
**Builds on:** SP-A/SP-B (`apps/server/src/dhis2-routes.ts` with `registerDhis2Routes(app, ctx, dhis2, deps)`, `Dhis2RouteDeps {metadataCache, orgUnitStore}`, the metadata cache, `Combobox`, `dhis2.*` i18n, the SP-B test harness `fakeDeps`/`fakeCtx`/`appWith` in `dhis2-routes.test.ts`).

---

## File Structure

- Modify `packages/db/src/dhis2-store.ts` (+ `dhis2-store.test.ts`) — `MappingStore.remove`, `list()` returns `kind`.
- Modify `apps/server/src/dhis2-routes.ts` (+ `dhis2-routes.test.ts`) — `deps.mappingStore`, mappings CRUD + validate + report-columns + metadata routes.
- Modify `apps/server/src/app.ts` — build `mappingStore` into `deps`.
- Modify `apps/server/package.json` — add `@openldr/dhis2` dep (for `validateMapping`).
- Modify `apps/web/src/api.ts` — mappings client + types.
- Create `apps/web/src/pages/Dhis2Mappings.tsx` (+ `.test.tsx`) — list page.
- Create `apps/web/src/pages/Dhis2MappingEditor.tsx` (+ `.test.tsx`) — aggregate editor.
- Modify `apps/web/src/App.tsx` — `/dhis2/mappings`, `/dhis2/mappings/new`, `/dhis2/mappings/:id` routes.
- Modify `apps/web/src/pages/Dhis2.tsx` — "Manage →" link on the Mappings count.
- Modify `apps/web/src/i18n/index.ts` — `dhis2.mappings.*` keys.

---

## Task 1: `MappingStore.remove` + `list()` with `kind`

**Files:**
- Modify: `packages/db/src/dhis2-store.ts`
- Test: `packages/db/src/dhis2-store.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/db/src/dhis2-store.test.ts`:

```ts
import { createMappingStore } from './dhis2-store';

describe('mapping store', () => {
  it('upserts, lists with kind, gets, and removes', async () => {
    const db = await makeMigratedDb();
    const store = createMappingStore(db);
    await store.upsert({ id: 'm1', name: 'Agg One', definition: { kind: 'aggregate', id: 'm1', name: 'Agg One' } });
    await store.upsert({ id: 'm2', name: 'Trk', definition: { kind: 'tracker', id: 'm2', name: 'Trk' } });

    const list = await store.list();
    expect(list).toEqual(expect.arrayContaining([
      { id: 'm1', name: 'Agg One', kind: 'aggregate' },
      { id: 'm2', name: 'Trk', kind: 'tracker' },
    ]));

    expect((await store.get('m1'))?.definition).toMatchObject({ kind: 'aggregate' });

    await store.remove('m1');
    expect((await store.list()).map((r) => r.id)).toEqual(['m2']);
    await store.remove('nope'); // no-op, no throw
    await db.destroy();
  });
});
```

(The file already imports `makeMigratedDb` and `createOrgUnitMapStore` from SP-B; add the `createMappingStore` import at the top if not present.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/db test -- --run dhis2-store.test.ts`
Expected: FAIL — `remove` not a function / `list` lacks `kind`.

- [ ] **Step 3: Implement**

In `packages/db/src/dhis2-store.ts`, update the `MappingStore` interface:

```ts
export interface MappingStore {
  upsert(m: Dhis2MappingRecord): Promise<void>;
  get(id: string): Promise<Dhis2MappingRecord | null>;
  list(): Promise<{ id: string; name: string; kind: string | null }[]>;
  remove(id: string): Promise<void>;
}
```

In `createMappingStore`, replace the `list` method and add `remove`:

```ts
    async list() {
      return db
        .selectFrom('dhis2_mappings')
        .select(['id', 'name'])
        .select(sql<string | null>`definition->>'kind'`.as('kind'))
        .orderBy('id')
        .execute();
    },
    async remove(id) {
      await db.deleteFrom('dhis2_mappings').where('id', '=', id).execute();
    },
```

(`sql` is already imported in this file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/db test -- --run dhis2-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/dhis2-store.ts packages/db/src/dhis2-store.test.ts
git commit -m "feat(db): MappingStore.remove + list() returns kind"
```

---

## Task 2: Route deps (`mappingStore`) + mappings CRUD + metadata routes

**Files:**
- Modify: `apps/server/src/dhis2-routes.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/src/dhis2-routes.test.ts`

- [ ] **Step 1: Extend the test harness + add failing CRUD/metadata tests**

In `apps/server/src/dhis2-routes.test.ts`, add a `mappingStore` + `reporting` to the fakes. In `fakeDeps`, add before the `...over` spread:

```ts
    mappingStore: (() => {
      const rows: { id: string; name: string; definition: Record<string, unknown> }[] = [];
      return {
        list: async () => rows.map((r) => ({ id: r.id, name: r.name, kind: (r.definition.kind as string | undefined) ?? null })),
        get: async (id: string) => rows.find((r) => r.id === id) ?? null,
        upsert: async (m: { id: string; name: string; definition: Record<string, unknown> }) => { const i = rows.findIndex((r) => r.id === m.id); if (i >= 0) rows[i] = m; else rows.push(m); },
        remove: async (id: string) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); },
      };
    })(),
```

In `fakeCtx`, add a `reporting` fake (after `fhirStore`):

```ts
    reporting: {
      run: async (id: string) => {
        if (id === 'missing') { const e = new Error('not found'); e.name = 'ReportNotFoundError'; throw e; }
        if (id === 'boom') throw new Error('kaboom');
        return { columns: [{ key: 'month', label: 'Month', kind: 'string' }, { key: 'count', label: 'Count', kind: 'number' }], rows: [], chart: { type: 'bar' }, meta: { generatedAt: 'x', rowCount: 0 } };
      },
      list: () => [{ id: 'test-volume', name: 'Test Volume', description: '' }],
    },
```

Then append these tests:

```ts
describe('dhis2 mappings CRUD + metadata', () => {
  const agg = { kind: 'aggregate', id: 'm1', name: 'Agg', source: { kind: 'report', reportId: 'test-volume' }, orgUnitColumn: 'month', columns: [{ column: 'count', dataElement: 'de1' }] };

  it('GET /mappings lists with kind', async () => {
    const deps = fakeDeps();
    await deps.mappingStore.upsert({ id: 'm1', name: 'Agg', definition: agg });
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], deps);
    const body = (await app.inject({ method: 'GET', url: '/api/dhis2/mappings' })).json();
    expect(body).toEqual([{ id: 'm1', name: 'Agg', kind: 'aggregate' }]);
  });

  it('GET /mappings/:id returns the record or 404', async () => {
    const deps = fakeDeps();
    await deps.mappingStore.upsert({ id: 'm1', name: 'Agg', definition: agg });
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], deps);
    expect((await app.inject({ method: 'GET', url: '/api/dhis2/mappings/m1' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/dhis2/mappings/ghost' })).statusCode).toBe(404);
  });

  it('PUT /mappings/:id upserts + audits; 400 on bad body', async () => {
    const deps = fakeDeps();
    const ctxRef = fakeCtx(configuredCfg());
    const app = Fastify();
    app.addHook('onRequest', async (req) => { req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'] }; });
    registerDhis2Routes(app, ctxRef, fakeDhis2() as never, deps as never);
    const ok = await app.inject({ method: 'PUT', url: '/api/dhis2/mappings/m1', payload: { name: 'Agg', definition: agg } });
    expect(ok.statusCode).toBe(200);
    expect((await deps.mappingStore.get('m1'))?.name).toBe('Agg');
    expect((ctxRef as any).__audit.some((e: any) => e.action === 'dhis2.mapping.save')).toBe(true);
    const bad = await app.inject({ method: 'PUT', url: '/api/dhis2/mappings/m1', payload: { name: 'x', definition: { id: 'm1' } } });
    expect(bad.statusCode).toBe(400);
  });

  it('DELETE /mappings/:id removes + audits (204)', async () => {
    const deps = fakeDeps();
    await deps.mappingStore.upsert({ id: 'm1', name: 'Agg', definition: agg });
    const ctxRef = fakeCtx(configuredCfg());
    const app = Fastify();
    app.addHook('onRequest', async (req) => { req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'] }; });
    registerDhis2Routes(app, ctxRef, fakeDhis2() as never, deps as never);
    expect((await app.inject({ method: 'DELETE', url: '/api/dhis2/mappings/m1' })).statusCode).toBe(204);
    expect(await deps.mappingStore.get('m1')).toBeNull();
    expect((ctxRef as any).__audit.some((e: any) => e.action === 'dhis2.mapping.delete')).toBe(true);
  });

  it('GET /metadata returns the cache or null', async () => {
    const deps = fakeDeps();
    const empty = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], deps);
    expect((await empty.inject({ method: 'GET', url: '/api/dhis2/metadata' })).json()).toBeNull();
    await deps.metadataCache.save({ dataElements: [{ id: 'de1', name: 'DE' }], orgUnits: [], categoryOptionCombos: [{ id: 'coc1', name: 'COC' }], programs: [], programStages: [] } as never);
    const body = (await empty.inject({ method: 'GET', url: '/api/dhis2/metadata' })).json();
    expect(body.dataElements).toEqual([{ id: 'de1', name: 'DE' }]);
    expect(body.pulledAt).toBeTruthy();
  });

  it('rejects non-admins with 403', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['data_analyst']);
    expect((await app.inject({ method: 'GET', url: '/api/dhis2/mappings' })).statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server test -- --run dhis2-routes.test.ts`
Expected: FAIL — routes 404 / `deps.mappingStore` undefined.

- [ ] **Step 3: Add `mappingStore` to deps + the CRUD/metadata routes**

In `apps/server/src/dhis2-routes.ts`:
- Add to the `@openldr/db` type imports: `MappingStore`. Add `import { z } from 'zod';` and `import { recordAudit } from './audit-helper';` if not already present (SP-B added both — verify).
- Extend `Dhis2RouteDeps`:

```ts
export interface Dhis2RouteDeps {
  metadataCache: Dhis2MetadataCache;
  orgUnitStore: OrgUnitMapStore;
  mappingStore: MappingStore;
}
```

- Add the aggregate zod schema near the top (after the existing `orgUnitMapInput`):

```ts
const aggregateColumn = z.object({ column: z.string().min(1), dataElement: z.string().min(1), categoryOptionCombo: z.string().optional() });
const aggregateDefinition = z.object({
  kind: z.literal('aggregate').optional(),
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.object({ kind: z.literal('report'), reportId: z.string().min(1), params: z.record(z.string()).optional() }),
  orgUnitColumn: z.string().min(1),
  periodColumn: z.string().optional(),
  columns: z.array(aggregateColumn),
});
const mappingPutInput = z.object({ name: z.string().min(1), definition: aggregateDefinition });
```

- Add these routes inside `registerDhis2Routes` (after the orgunit-mappings routes):

```ts
  app.get('/api/dhis2/mappings', { preHandler: requireRole('lab_admin') }, async () => deps.mappingStore.list());

  app.get('/api/dhis2/mappings/:id', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const m = await deps.mappingStore.get(id);
    if (!m) { reply.code(404); return { error: 'not found' }; }
    return m;
  });

  app.put('/api/dhis2/mappings/:id', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const p = mappingPutInput.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const id = (req.params as { id: string }).id;
    const before = await deps.mappingStore.get(id);
    const record = { id, name: p.data.name, definition: p.data.definition as Record<string, unknown> };
    await deps.mappingStore.upsert(record);
    await recordAudit(ctx, req, { action: 'dhis2.mapping.save', entityType: 'dhis2-mapping', entityId: id, before, after: record });
    return record;
  });

  app.delete('/api/dhis2/mappings/:id', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const before = await deps.mappingStore.get(id);
    await deps.mappingStore.remove(id);
    await recordAudit(ctx, req, { action: 'dhis2.mapping.delete', entityType: 'dhis2-mapping', entityId: id, before, after: null });
    reply.code(204);
    return null;
  });

  app.get('/api/dhis2/metadata', { preHandler: requireRole('lab_admin') }, async () => {
    const cached = await deps.metadataCache.get();
    if (!cached) return null;
    const m = cached.metadata;
    return {
      dataElements: m.dataElements,
      categoryOptionCombos: m.categoryOptionCombos,
      orgUnits: m.orgUnits,
      programs: m.programs ?? [],
      programStages: m.programStages ?? [],
      pulledAt: cached.pulledAt,
    };
  });
```

- [ ] **Step 4: Wire `mappingStore` in `buildApp`**

In `apps/server/src/app.ts`, update the `@openldr/db` import to add `createMappingStore`:

```ts
import { createDhis2MetadataCache, createOrgUnitMapStore, createMappingStore } from '@openldr/db';
```

and add `mappingStore` to the deps object passed to `registerDhis2Routes`:

```ts
  registerDhis2Routes(app, ctx, dhis2, {
    metadataCache: createDhis2MetadataCache(ctx.internalDb),
    orgUnitStore: createOrgUnitMapStore(ctx.internalDb),
    mappingStore: createMappingStore(ctx.internalDb),
  });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @openldr/server test -- --run dhis2-routes.test.ts && pnpm --filter @openldr/server typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/dhis2-routes.ts apps/server/src/app.ts apps/server/src/dhis2-routes.test.ts
git commit -m "feat(dhis2): mappings CRUD + metadata routes; mappingStore dep"
```

---

## Task 3: validate + report-columns routes

**Files:**
- Modify: `apps/server/src/dhis2-routes.ts`
- Modify: `apps/server/package.json`
- Test: `apps/server/src/dhis2-routes.test.ts`

- [ ] **Step 1: Add `@openldr/dhis2` as a server dependency**

In `apps/server/package.json`, add to `dependencies` (alphabetical, next to `@openldr/db`):

```json
    "@openldr/dhis2": "workspace:*",
```

Then run: `pnpm install` (relinks the workspace; updates `pnpm-lock.yaml`).

- [ ] **Step 2: Write the failing tests**

Append to `apps/server/src/dhis2-routes.test.ts`:

```ts
describe('dhis2 validate + report-columns', () => {
  const agg = { kind: 'aggregate', id: 'm1', name: 'Agg', source: { kind: 'report', reportId: 'test-volume' }, orgUnitColumn: 'month', columns: [{ column: 'count', dataElement: 'de1' }] };

  it('validate returns problems from the cached metadata', async () => {
    const deps = fakeDeps();
    await deps.metadataCache.save({ dataElements: [{ id: 'de1', name: 'DE' }], orgUnits: [], categoryOptionCombos: [], programs: [], programStages: [] } as never);
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], deps);
    const okBody = (await app.inject({ method: 'POST', url: '/api/dhis2/mappings/validate', payload: agg })).json();
    expect(okBody.problems).toEqual([]); // de1 is known
    const bad = { ...agg, columns: [{ column: 'count', dataElement: 'NOPE' }] };
    const badBody = (await app.inject({ method: 'POST', url: '/api/dhis2/mappings/validate', payload: bad })).json();
    expect(badBody.problems.length).toBe(1);
  });

  it('validate warns when no metadata is cached', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], fakeDeps());
    const body = (await app.inject({ method: 'POST', url: '/api/dhis2/mappings/validate', payload: agg })).json();
    expect(body.problems[0]).toMatch(/pull metadata/i);
  });

  it('report-columns returns columns / 400 / 404 / 502', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin']);
    expect((await app.inject({ method: 'GET', url: '/api/dhis2/report-columns' })).statusCode).toBe(400);
    const ok = (await app.inject({ method: 'GET', url: '/api/dhis2/report-columns?reportId=test-volume' })).json();
    expect(ok.columns).toEqual([{ key: 'month', label: 'Month' }, { key: 'count', label: 'Count' }]);
    expect((await app.inject({ method: 'GET', url: '/api/dhis2/report-columns?reportId=missing' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/dhis2/report-columns?reportId=boom' })).statusCode).toBe(502);
  });

  it('validate rejects non-admins with 403', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['viewer']);
    expect((await app.inject({ method: 'POST', url: '/api/dhis2/mappings/validate', payload: agg })).statusCode).toBe(403);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @openldr/server test -- --run dhis2-routes.test.ts`
Expected: FAIL — validate/report-columns 404.

- [ ] **Step 4: Implement the two routes**

In `apps/server/src/dhis2-routes.ts`:
- Add import: `import { validateMapping, type AggregateMapping } from '@openldr/dhis2';`
- Add a not-found detector near `hostOf` (or reuse a name check inline). Add these routes inside `registerDhis2Routes` (after the metadata route):

```ts
  app.post('/api/dhis2/mappings/validate', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const p = aggregateDefinition.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const cached = await deps.metadataCache.get();
    if (!cached) return { problems: ['no DHIS2 metadata cached — pull metadata from DHIS2 settings first'] };
    return { problems: validateMapping(p.data as AggregateMapping, cached.metadata) };
  });

  app.get('/api/dhis2/report-columns', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const reportId = (req.query as { reportId?: string }).reportId;
    if (!reportId) { reply.code(400); return { error: 'reportId is required' }; }
    try {
      const result = await ctx.reporting.run(reportId, {});
      return { columns: result.columns.map((c) => ({ key: c.key, label: c.label })) };
    } catch (e) {
      if (e instanceof Error && e.name === 'ReportNotFoundError') { reply.code(404); return { error: 'unknown report' }; }
      reply.code(502);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @openldr/server test -- --run dhis2-routes.test.ts && pnpm --filter @openldr/server typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/dhis2-routes.ts apps/server/package.json pnpm-lock.yaml apps/server/src/dhis2-routes.test.ts
git commit -m "feat(dhis2): mapping validate + report-columns routes"
```

---

## Task 4: Web — mappings API client

**Files:**
- Modify: `apps/web/src/api.ts`

- [ ] **Step 1: Add types + client functions**

In `apps/web/src/api.ts`, append after the SP-B orgunit-mapping block:

```ts
// ── DHIS2 aggregate mappings (SP-C1) ───────────────────────────────────────────
export interface Dhis2MappingSummary { id: string; name: string; kind: string | null }
export interface AggregateColumnMapping { column: string; dataElement: string; categoryOptionCombo?: string }
export interface AggregateMappingDef {
  kind?: 'aggregate';
  id: string;
  name: string;
  source: { kind: 'report'; reportId: string; params?: Record<string, string> };
  orgUnitColumn: string;
  periodColumn?: string;
  columns: AggregateColumnMapping[];
}
export interface Dhis2MappingRecord { id: string; name: string; definition: AggregateMappingDef | Record<string, unknown> }
export interface ReportColumn2 { key: string; label: string }
export interface Dhis2MetadataLists {
  dataElements: { id: string; name: string }[];
  categoryOptionCombos: { id: string; name: string }[];
  orgUnits: { id: string; name: string }[];
  programs: { id: string; name: string }[];
  programStages: { id: string; name: string }[];
  pulledAt: string;
}

export async function listDhis2Mappings(): Promise<Dhis2MappingSummary[]> {
  const r = await authFetch('/api/dhis2/mappings');
  if (!r.ok) throw new Error(`mappings list failed: ${r.status}`);
  return r.json();
}
export async function getDhis2Mapping(id: string): Promise<Dhis2MappingRecord> {
  const r = await authFetch(`/api/dhis2/mappings/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(`get mapping failed: ${r.status}`);
  return r.json();
}
export async function saveDhis2Mapping(id: string, body: { name: string; definition: AggregateMappingDef }): Promise<Dhis2MappingRecord> {
  const r = await authFetch(`/api/dhis2/mappings/${encodeURIComponent(id)}`, jbody(body, 'PUT'));
  if (!r.ok) throw new Error(`save mapping failed: ${r.status}`);
  return r.json();
}
export async function deleteDhis2Mapping(id: string): Promise<void> {
  const r = await authFetch(`/api/dhis2/mappings/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`delete mapping failed: ${r.status}`);
}
export async function validateDhis2Mapping(def: AggregateMappingDef): Promise<string[]> {
  const r = await authFetch('/api/dhis2/mappings/validate', jbody(def, 'POST'));
  if (!r.ok) throw new Error(`validate failed: ${r.status}`);
  return (await r.json()).problems as string[];
}
export async function getReportColumns(reportId: string): Promise<ReportColumn2[]> {
  const r = await authFetch(`/api/dhis2/report-columns?reportId=${encodeURIComponent(reportId)}`);
  if (!r.ok) { const b = (await r.json().catch(() => ({}))) as { error?: string }; throw new Error(b.error ?? `report columns failed: ${r.status}`); }
  return (await r.json()).columns as ReportColumn2[];
}
export async function getDhis2Metadata(): Promise<Dhis2MetadataLists | null> {
  const r = await authFetch('/api/dhis2/metadata');
  if (!r.ok) throw new Error(`metadata failed: ${r.status}`);
  return r.json();
}
```

(`jbody(body, method)` already exists in this file.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @openldr/web typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api.ts
git commit -m "feat(dhis2): web api client for mappings/validate/report-columns/metadata"
```

---

## Task 5: Web — mappings list page + route + Settings link + i18n

**Files:**
- Create: `apps/web/src/pages/Dhis2Mappings.tsx`
- Test: `apps/web/src/pages/Dhis2Mappings.test.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/pages/Dhis2.tsx`, `apps/web/src/i18n/index.ts`

- [ ] **Step 1: Add i18n keys (and resolve the SP-A key collision atomically)**

First, **rename the existing flat label** `mappings: 'Mappings',` (in the `dhis2` block, the line near `orgUnitMappings`/`schedules`) to `mappingsCount: 'Mappings',` — the new `mappings` object below would otherwise be a duplicate object key. Do this rename and add the object in the same edit so the file is never in a duplicate-key state.

Then, inside the `dhis2` block (after the `orgunits` block), add:

```ts
      mappings: {
        title: 'DHIS2 mappings',
        manage: 'Manage →',
        newMapping: 'New mapping',
        name: 'Name',
        kind: 'Kind',
        edit: 'Edit',
        delete: 'Delete',
        deleteTitle: 'Delete mapping {{name}}?',
        deleteDescription: 'This removes the mapping. It cannot be undone.',
        none: 'No mappings yet.',
        deletedToast: 'Deleted {{name}}',
        errorToast: 'Failed: {{error}}',
        editor: {
          newTitle: 'New aggregate mapping',
          editTitle: 'Edit aggregate mapping',
          mappingName: 'Mapping name',
          sourceReport: 'Source report',
          pickReport: 'Pick a report…',
          orgUnitColumn: 'OrgUnit column',
          periodColumn: 'Period column (optional)',
          pickColumn: 'Pick a column…',
          columns: 'Column → dataElement',
          reportColumn: 'Report column',
          dataElement: 'DataElement',
          coc: 'Category option combo (optional)',
          addColumn: 'Add column',
          remove: 'Remove',
          validate: 'Validate',
          noProblems: 'No problems.',
          save: 'Save',
          cancel: 'Cancel',
          savedToast: 'Saved {{name}}',
          trackerNotice: 'This is a tracker mapping. Tracker editing comes in a later sub-project (SP-C2).',
          noMetadata: 'No DHIS2 metadata cached — pull metadata from DHIS2 settings to enable dataElement pickers.',
          notFound: 'Mapping not found.',
        },
      },
```

- [ ] **Step 2: Write the failing list test**

Create `apps/web/src/pages/Dhis2Mappings.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listDhis2Mappings: vi.fn(), deleteDhis2Mapping: vi.fn() };
});
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasRole: () => true }),
}));

import { listDhis2Mappings, deleteDhis2Mapping } from '@/api';
import { Dhis2Mappings } from './Dhis2Mappings';

beforeEach(() => { vi.clearAllMocks(); });

describe('DHIS2 mappings list', () => {
  it('lists mappings with kind badges', async () => {
    (listDhis2Mappings as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'm1', name: 'Agg One', kind: 'aggregate' },
      { id: 'm2', name: 'Trk', kind: 'tracker' },
    ]);
    render(<MemoryRouter><Dhis2Mappings /></MemoryRouter>);
    expect(await screen.findByText('Agg One')).toBeTruthy();
    expect(screen.getByText('tracker')).toBeTruthy();
  });

  it('deletes a mapping behind a confirm', async () => {
    (listDhis2Mappings as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'm1', name: 'Agg One', kind: 'aggregate' }]);
    (deleteDhis2Mapping as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<MemoryRouter><Dhis2Mappings /></MemoryRouter>);
    await screen.findByText('Agg One');
    fireEvent.click(screen.getByTestId('delete-m1'));
    const confirm = await screen.findByRole('button', { name: /^delete$/i });
    fireEvent.click(confirm);
    await waitFor(() => expect(deleteDhis2Mapping).toHaveBeenCalledWith('m1'));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @openldr/web test -- --run Dhis2Mappings.test.tsx`
Expected: FAIL — `./Dhis2Mappings` missing.

- [ ] **Step 4: Create the list page**

Create `apps/web/src/pages/Dhis2Mappings.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listDhis2Mappings, deleteDhis2Mapping, type Dhis2MappingSummary } from '@/api';

export function Dhis2Mappings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Dhis2MappingSummary[]>([]);
  const [pendingDelete, setPendingDelete] = useState<Dhis2MappingSummary | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try { setRows(await listDhis2Mappings()); }
    catch (e) { setToast({ kind: 'err', text: t('dhis2.mappings.errorToast', { error: e instanceof Error ? e.message : String(e) }) }); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 5000); return () => clearTimeout(id); }, [toast]);

  const doDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const m = pendingDelete; setPendingDelete(null);
    try { await deleteDhis2Mapping(m.id); setToast({ kind: 'ok', text: t('dhis2.mappings.deletedToast', { name: m.name }) }); await load(); }
    catch (e) { setToast({ kind: 'err', text: t('dhis2.mappings.errorToast', { error: e instanceof Error ? e.message : String(e) }) }); }
  }, [pendingDelete, load, t]);

  return (
    <AppShell title="DHIS2 mappings">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" data-testid="dhis2-mappings-page">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">{t('dhis2.mappings.title')}</div>
          <Button onClick={() => navigate('/dhis2/mappings/new')} data-testid="new-mapping">{t('dhis2.mappings.newMapping')}</Button>
        </div>
        {toast ? (
          <div className={toast.kind === 'ok'
            ? 'rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700'
            : 'rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive'}>{toast.text}</div>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('dhis2.mappings.name')}</TableHead>
              <TableHead className="w-32">{t('dhis2.mappings.kind')}</TableHead>
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">{t('dhis2.mappings.none')}</TableCell></TableRow>
            ) : rows.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-medium">{m.name}</TableCell>
                <TableCell><Badge variant="outline">{m.kind ?? 'aggregate'}</Badge></TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Link to={`/dhis2/mappings/${m.id}`} className="text-primary hover:underline" data-testid={`edit-${m.id}`}>{t('dhis2.mappings.edit')}</Link>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setPendingDelete(m)} data-testid={`delete-${m.id}`}>{t('dhis2.mappings.delete')}</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
          title={t('dhis2.mappings.deleteTitle', { name: pendingDelete?.name ?? '' })}
          description={t('dhis2.mappings.deleteDescription')}
          confirmLabel={t('dhis2.mappings.delete')}
          destructive
          onConfirm={() => { void doDelete(); }}
        />
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 5: Run the list test to verify it passes**

Run: `pnpm --filter @openldr/web test -- --run Dhis2Mappings.test.tsx`
Expected: PASS (2 tests). (Check `ConfirmDialog`'s confirm button renders with the accessible name "Delete"; it uses `confirmLabel`.)

- [ ] **Step 6: Add the route + Settings link**

In `apps/web/src/App.tsx`, add the import near the other Dhis2 imports:

```ts
import { Dhis2Mappings } from '@/pages/Dhis2Mappings';
```

and the route after the `/dhis2/orgunits` route:

```tsx
      <Route path="/dhis2/mappings" element={<RequireRole role="lab_admin"><Dhis2Mappings /></RequireRole>} />
```

In `apps/web/src/pages/Dhis2.tsx`, change the Mappings count line in the Overview card. Replace:

```tsx
                <div><span className="text-muted-foreground">{t('dhis2.mappings')}: </span>{status.counts.mappings}</div>
```

with (uses `mappingsCount`, the label renamed in Step 1, plus the new `mappings.manage` link key):

```tsx
                <div>
                  <span className="text-muted-foreground">{t('dhis2.mappingsCount')}: </span>{status.counts.mappings}
                  {' '}<Link to="/dhis2/mappings" className="text-primary hover:underline" data-testid="manage-mappings">{t('dhis2.mappings.manage')}</Link>
                </div>
```

(`Link` is already imported in `Dhis2.tsx` from SP-B.)

- [ ] **Step 7: Typecheck + run web tests**

Run: `pnpm --filter @openldr/web typecheck && pnpm --filter @openldr/web test -- --run Dhis2Mappings.test.tsx Dhis2.test.tsx`
Expected: typecheck clean; tests PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/Dhis2Mappings.tsx apps/web/src/pages/Dhis2Mappings.test.tsx apps/web/src/App.tsx apps/web/src/pages/Dhis2.tsx apps/web/src/i18n/index.ts
git commit -m "feat(dhis2): mappings list page + route + Settings link + i18n"
```

---

## Task 6: Web — aggregate mapping editor

**Files:**
- Create: `apps/web/src/pages/Dhis2MappingEditor.tsx`
- Test: `apps/web/src/pages/Dhis2MappingEditor.test.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Write the failing editor test**

Create `apps/web/src/pages/Dhis2MappingEditor.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import '@/i18n';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    fetchReports: vi.fn(),
    getDhis2Metadata: vi.fn(),
    getReportColumns: vi.fn(),
    getDhis2Mapping: vi.fn(),
    saveDhis2Mapping: vi.fn(),
    validateDhis2Mapping: vi.fn(),
  };
});
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasRole: () => true }),
}));

import { fetchReports, getDhis2Metadata, getReportColumns, saveDhis2Mapping, getDhis2Mapping } from '@/api';
import { Dhis2MappingEditor } from './Dhis2MappingEditor';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dhis2/mappings/new" element={<Dhis2MappingEditor />} />
        <Route path="/dhis2/mappings/:id" element={<Dhis2MappingEditor />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (fetchReports as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'test-volume', name: 'Test Volume', description: '' }]);
  (getDhis2Metadata as ReturnType<typeof vi.fn>).mockResolvedValue({
    dataElements: [{ id: 'de1', name: 'DE One' }], categoryOptionCombos: [{ id: 'coc1', name: 'COC One' }],
    orgUnits: [], programs: [], programStages: [], pulledAt: '2026-01-01T00:00:00.000Z',
  });
  (getReportColumns as ReturnType<typeof vi.fn>).mockResolvedValue([{ key: 'month', label: 'Month' }, { key: 'count', label: 'Count' }]);
});

describe('DHIS2 aggregate mapping editor', () => {
  it('builds and saves a new aggregate mapping', async () => {
    (saveDhis2Mapping as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'mapping-x', name: 'My Map', definition: {} });
    renderAt('/dhis2/mappings/new');
    // name
    fireEvent.change(await screen.findByTestId('mapping-name'), { target: { value: 'My Map' } });
    // pick source report → triggers getReportColumns
    fireEvent.change(screen.getByTestId('report-select'), { target: { value: 'test-volume' } });
    await waitFor(() => expect(getReportColumns).toHaveBeenCalledWith('test-volume'));
    // orgUnit column
    fireEvent.change(screen.getByTestId('orgunit-column-select'), { target: { value: 'month' } });
    // add a column-mapping row, set report column + dataElement
    fireEvent.click(screen.getByTestId('add-column'));
    fireEvent.change(screen.getByTestId('column-key-0'), { target: { value: 'count' } });
    fireEvent.change(screen.getByTestId('column-de-0'), { target: { value: 'de1' } });
    // save
    fireEvent.click(screen.getByTestId('save-mapping'));
    await waitFor(() => expect(saveDhis2Mapping).toHaveBeenCalled());
    const [, body] = (saveDhis2Mapping as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body.name).toBe('My Map');
    expect(body.definition.source.reportId).toBe('test-volume');
    expect(body.definition.orgUnitColumn).toBe('month');
    expect(body.definition.columns).toEqual([{ column: 'count', dataElement: 'de1' }]);
  });

  it('shows a read-only notice for tracker mappings', async () => {
    (getDhis2Mapping as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'm2', name: 'Trk', definition: { kind: 'tracker', id: 'm2', name: 'Trk' } });
    renderAt('/dhis2/mappings/m2');
    expect(await screen.findByText(/tracker editing comes in/i)).toBeTruthy();
  });
});
```

> Editor controls use plain native `<select>`/`<input>` with `data-testid`s (not the shadcn `Combobox`) so the dynamic column table stays simple and fully testable with `fireEvent.change`. The shadcn `Combobox` is fine for SP-B's single picker, but a table of N dependent pickers is clearer and more testable as native selects here. Use shadcn `Input` for text fields and native `<select>` for the option pickers.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/web test -- --run Dhis2MappingEditor.test.tsx`
Expected: FAIL — `./Dhis2MappingEditor` missing.

- [ ] **Step 3: Create the editor**

Create `apps/web/src/pages/Dhis2MappingEditor.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/shell/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  fetchReports, getDhis2Metadata, getReportColumns, getDhis2Mapping, saveDhis2Mapping, validateDhis2Mapping,
  type ReportSummary, type Dhis2MetadataLists, type ReportColumn2, type AggregateMappingDef, type AggregateColumnMapping,
} from '@/api';

type Row = { column: string; dataElement: string; categoryOptionCombo: string };

export function Dhis2MappingEditor() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams();
  const isNew = id === undefined;

  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [meta, setMeta] = useState<Dhis2MetadataLists | null>(null);
  const [columns, setColumns] = useState<ReportColumn2[]>([]);
  const [tracker, setTracker] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const [mappingId, setMappingId] = useState<string>('');
  const [name, setName] = useState('');
  const [reportId, setReportId] = useState('');
  const [orgUnitColumn, setOrgUnitColumn] = useState('');
  const [periodColumn, setPeriodColumn] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initial load: reports + cached metadata + (edit) the mapping.
  useEffect(() => {
    void (async () => {
      const [reps, m] = await Promise.all([fetchReports(), getDhis2Metadata()]);
      setReports(reps); setMeta(m);
      if (isNew) { setMappingId(`mapping-${crypto.randomUUID()}`); return; }
      try {
        const rec = await getDhis2Mapping(id!);
        const def = rec.definition as Partial<AggregateMappingDef> & { kind?: string };
        if (def.kind === 'tracker') { setTracker(true); return; }
        setMappingId(rec.id);
        setName(rec.name);
        setReportId(def.source?.reportId ?? '');
        setOrgUnitColumn(def.orgUnitColumn ?? '');
        setPeriodColumn(def.periodColumn ?? '');
        setRows((def.columns ?? []).map((c) => ({ column: c.column, dataElement: c.dataElement, categoryOptionCombo: c.categoryOptionCombo ?? '' })));
        if (def.source?.reportId) setColumns(await getReportColumns(def.source.reportId).catch(() => []));
      } catch { setNotFound(true); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const onReport = useCallback(async (rid: string) => {
    setReportId(rid); setProblems(null);
    if (!rid) { setColumns([]); return; }
    try { setColumns(await getReportColumns(rid)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setColumns([]); }
  }, []);

  const def = useCallback((): AggregateMappingDef => ({
    kind: 'aggregate',
    id: mappingId,
    name,
    source: { kind: 'report', reportId },
    orgUnitColumn,
    ...(periodColumn ? { periodColumn } : {}),
    columns: rows
      .filter((r) => r.column && r.dataElement)
      .map((r): AggregateColumnMapping => ({ column: r.column, dataElement: r.dataElement, ...(r.categoryOptionCombo ? { categoryOptionCombo: r.categoryOptionCombo } : {}) })),
  }), [mappingId, name, reportId, orgUnitColumn, periodColumn, rows]);

  const onValidate = useCallback(async () => {
    try { setProblems(await validateDhis2Mapping(def())); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [def]);

  const onSave = useCallback(async () => {
    try { await saveDhis2Mapping(mappingId, { name, definition: def() }); navigate('/dhis2/mappings'); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [mappingId, name, def, navigate]);

  if (tracker) {
    return <AppShell title="DHIS2 mapping"><div className="p-6 text-sm text-muted-foreground">{t('dhis2.mappings.editor.trackerNotice')}</div></AppShell>;
  }
  if (notFound) {
    return <AppShell title="DHIS2 mapping"><div className="p-6 text-sm text-muted-foreground">{t('dhis2.mappings.editor.notFound')}</div></AppShell>;
  }

  const metaEmpty = (meta?.dataElements.length ?? 0) === 0;

  return (
    <AppShell title={isNew ? t('dhis2.mappings.editor.newTitle') : t('dhis2.mappings.editor.editTitle')}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4" data-testid="dhis2-mapping-editor">
        {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
        {metaEmpty ? <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">{t('dhis2.mappings.editor.noMetadata')}</div> : null}

        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">{t('dhis2.mappings.editor.mappingName')}</span>
          <Input data-testid="mapping-name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">{t('dhis2.mappings.editor.sourceReport')}</span>
          <select data-testid="report-select" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={reportId} onChange={(e) => void onReport(e.target.value)}>
            <option value="">{t('dhis2.mappings.editor.pickReport')}</option>
            {reports.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">{t('dhis2.mappings.editor.orgUnitColumn')}</span>
            <select data-testid="orgunit-column-select" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={orgUnitColumn} onChange={(e) => setOrgUnitColumn(e.target.value)}>
              <option value="">{t('dhis2.mappings.editor.pickColumn')}</option>
              {columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">{t('dhis2.mappings.editor.periodColumn')}</span>
            <select data-testid="period-column-select" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={periodColumn} onChange={(e) => setPeriodColumn(e.target.value)}>
              <option value="">{t('dhis2.mappings.editor.pickColumn')}</option>
              {columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t('dhis2.mappings.editor.columns')}</span>
            <Button variant="outline" size="sm" data-testid="add-column" onClick={() => setRows((r) => [...r, { column: '', dataElement: '', categoryOptionCombo: '' }])}>{t('dhis2.mappings.editor.addColumn')}</Button>
          </div>
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2" data-testid={`column-row-${i}`}>
              <select data-testid={`column-key-${i}`} className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={row.column} onChange={(e) => setRows((r) => r.map((x, j) => j === i ? { ...x, column: e.target.value } : x))}>
                <option value="">{t('dhis2.mappings.editor.reportColumn')}</option>
                {columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <select data-testid={`column-de-${i}`} className="h-9 rounded-md border border-input bg-background px-2 text-sm" disabled={metaEmpty} value={row.dataElement} onChange={(e) => setRows((r) => r.map((x, j) => j === i ? { ...x, dataElement: e.target.value } : x))}>
                <option value="">{t('dhis2.mappings.editor.dataElement')}</option>
                {(meta?.dataElements ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <select data-testid={`column-coc-${i}`} className="h-9 rounded-md border border-input bg-background px-2 text-sm" disabled={metaEmpty} value={row.categoryOptionCombo} onChange={(e) => setRows((r) => r.map((x, j) => j === i ? { ...x, categoryOptionCombo: e.target.value } : x))}>
                <option value="">{t('dhis2.mappings.editor.coc')}</option>
                {(meta?.categoryOptionCombos ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <Button variant="ghost" size="sm" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>{t('dhis2.mappings.editor.remove')}</Button>
            </div>
          ))}
        </div>

        {problems !== null ? (
          <div className="rounded-md border border-border px-3 py-2 text-sm" data-testid="validate-problems">
            {problems.length === 0 ? t('dhis2.mappings.editor.noProblems') : <ul className="list-disc pl-5 text-destructive">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button variant="outline" data-testid="validate-mapping" onClick={() => void onValidate()}>{t('dhis2.mappings.editor.validate')}</Button>
          <Button data-testid="save-mapping" onClick={() => void onSave()}>{t('dhis2.mappings.editor.save')}</Button>
          <Button variant="ghost" onClick={() => navigate('/dhis2/mappings')}>{t('dhis2.mappings.editor.cancel')}</Button>
        </div>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 4: Run the editor test to verify it passes**

Run: `pnpm --filter @openldr/web test -- --run Dhis2MappingEditor.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the editor routes**

In `apps/web/src/App.tsx`, add the import near the other Dhis2 imports:

```ts
import { Dhis2MappingEditor } from '@/pages/Dhis2MappingEditor';
```

and the routes after the `/dhis2/mappings` route:

```tsx
      <Route path="/dhis2/mappings/new" element={<RequireRole role="lab_admin"><Dhis2MappingEditor /></RequireRole>} />
      <Route path="/dhis2/mappings/:id" element={<RequireRole role="lab_admin"><Dhis2MappingEditor /></RequireRole>} />
```

- [ ] **Step 6: Typecheck + run web tests**

Run: `pnpm --filter @openldr/web typecheck && pnpm --filter @openldr/web test -- --run Dhis2MappingEditor.test.tsx`
Expected: typecheck clean; tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/Dhis2MappingEditor.tsx apps/web/src/pages/Dhis2MappingEditor.test.tsx apps/web/src/App.tsx
git commit -m "feat(dhis2): aggregate mapping editor page + routes"
```

---

## Task 7: Full gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full gate**

Run: `pnpm turbo typecheck lint test build && pnpm depcruise`
Expected: all green. (If `@openldr/web#test` fails once under full-parallel turbo, re-run — SP-B observed transient contention; a direct `pnpm --filter @openldr/web test -- --run` confirms.)

- [ ] **Step 2: Fix any real failures minimally and re-run.** Do not proceed until green.

- [ ] **Step 3: Commit any gate fixups (if needed)**

```bash
git add -A
git commit -m "chore(dhis2): gate fixups for SP-C1"
```

---

## Notes / Out of Scope

- Tracker editor (SP-C2); dry-run/push/schedule (SP-D); editable `source.params`; mapping duplication/versioning; live DHIS2 acceptance (tests use fakes).
