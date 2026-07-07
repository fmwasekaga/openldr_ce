# Query Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new `/query` Studio page — a SQL workbench with a `System → {Connectors, Datasets, Custom Queries}` explorer tree, a tabbed editor-over-results workspace, and durable parameterized **Custom Queries** saved via a REST API for reuse by other surfaces.

**Architecture:** New internal `custom_queries` table + Kysely store + shared Zod schema; new Fastify `query-routes` that reuse the existing `ctx.workflows.services.runConnectorSql` runner and the `validateSelectSql` read-only guard for introspection + execution; a new Studio page (Zustand store, explorer tree, tab workspace, CodeMirror query tab) reusing the existing `Sheet`, `data-table`, and report-builder `ParametersEditor` primitives.

**Tech Stack:** TypeScript, Fastify, Kysely (Postgres), Zod, React + react-router, Zustand, Tailwind v4 + shadcn, CodeMirror 6, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-07-query-page-design.md`

---

## Grounding facts (verified — do not re-derive)

- Read-only guard: `validateSelectSql(sql)` exported from `@openldr/dashboards` (`packages/dashboards/src/sql-runner.ts`) throws on non-SELECT/multi-statement.
- Connector SQL runner: `ctx.workflows.services.runConnectorSql({ connectorId, sql }): Promise<{ columns: {key,label}[]; rows: Record<string,unknown>[] }>` (built in `packages/bootstrap/src/index.ts:410`).
- Connector store: `ctx.connectors` (`ConnectorStore`) → `list()`, `get(id)` (`{ type, enabled, ... }`), `getDecryptedConfig(id, key)`.
- Datasets: `ctx.workflows.datasets` (`WorkflowDatasetStore`, `packages/workflows/src/dataset-store.ts`) over `workflow_datasets`.
- Migrations register in `packages/db/src/migrations/internal/index.ts`; last is `040_report_templates`. New = `041_custom_queries`.
- Internal table types live in `packages/db/src/schema/internal.ts` (`InternalSchema`).
- Store pattern: `packages/db/src/report-schedule-store.ts` (`createReportScheduleStore`).
- Param model to mirror: `ReportParamSchema` (`packages/report-builder/src/schema.ts:16`) — `{ id, label, type: 'daterange'|'select'|'text', required, optionsSql? }`.
- RBAC guard: `requireRole(...roles)` from `apps/server/src/rbac.ts`.
- Route registration: `apps/server/src/app.ts` `buildApp(ctx)` (~line 87).
- Studio routes: `apps/studio/src/App.tsx`; nav: `apps/studio/src/shell/AppShell.tsx` `NAV`.
- Sheet primitive: `apps/studio/src/components/ui/sheet.tsx`. Grid: `apps/studio/src/components/data-table`.
- Reusable param editor: `apps/studio/src/reports-builder/ParametersEditor.tsx`.

---

## File Structure

**Create:**
- `packages/db/src/migrations/internal/041_custom_queries.ts` — table migration.
- `packages/db/src/custom-query-store.ts` — Kysely store.
- `packages/db/src/custom-query-store.test.ts` — store tests.
- `packages/dashboards/src/custom-query.ts` — shared `CustomQueryParam`/`CustomQuery` Zod schema.
- `apps/server/src/query-routes.ts` — introspection + run + CRUD + datasets routes.
- `apps/server/src/query-routes.test.ts` — route tests.
- `apps/server/src/query-sql.ts` — server-side `{{param.*}}` substitution helper.
- `apps/server/src/query-sql.test.ts` — substitution tests.
- `apps/studio/src/query/QueryPage.tsx` — route shell.
- `apps/studio/src/query/store.ts` — Zustand page store (tabs/tree).
- `apps/studio/src/query/api.ts` — typed client.
- `apps/studio/src/query/tree/ExplorerTree.tsx` — the tree.
- `apps/studio/src/query/workspace/TabBar.tsx`, `TableTab.tsx`, `QueryTab.tsx`, `SqlEditor.tsx`, `ResultsGrid.tsx`.
- `apps/studio/src/query/params/RunParamsSheet.tsx`.
- Matching `*.test.tsx` for `store`, `ExplorerTree`, `QueryTab`, `RunParamsSheet`.

**Modify:**
- `packages/db/src/migrations/internal/index.ts` — register `041`.
- `packages/db/src/schema/internal.ts` — `CustomQueriesTable` + `custom_queries` on `InternalSchema`.
- `packages/db/src/index.ts` — export the store.
- `packages/dashboards/src/index.ts` — export the schema.
- `apps/server/src/app.ts` — register query routes.
- `apps/studio/src/App.tsx` — `/query` route.
- `apps/studio/src/shell/AppShell.tsx` — nav entry.
- `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts` — `nav.query` + `query.*` keys.

---

## SLICE 1 — Custom Query entity + CRUD API

### Task 1: `custom_queries` migration

**Files:**
- Create: `packages/db/src/migrations/internal/041_custom_queries.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Test: `packages/db/src/migrations/internal/migrations.test.ts` (existing round-trip test picks it up)

- [ ] **Step 1: Write the migration**

```ts
// packages/db/src/migrations/internal/041_custom_queries.ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('custom_queries').ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull().unique())
    .addColumn('connector_id', 'text', (c) => c.notNull())
    .addColumn('sql', 'text', (c) => c.notNull())
    .addColumn('params', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('custom_queries').ifExists().execute();
}
```

- [ ] **Step 2: Register it in the index**

In `packages/db/src/migrations/internal/index.ts`, add the import near the other `m0XX` imports and the map entry after `040_report_templates`:

```ts
import * as m041 from './041_custom_queries';
// ...in the migrations object, after the 040 line:
  '041_custom_queries': { up: m041.up, down: m041.down },
```

- [ ] **Step 3: Run the migration round-trip test**

Run: `pnpm --filter @openldr/db test -- migrations.test`
Expected: PASS (the generic up/down round-trip test now includes 041).

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/migrations/internal/041_custom_queries.ts packages/db/src/migrations/internal/index.ts
git commit -m "feat(db): custom_queries table migration"
```

### Task 2: Internal schema type

**Files:**
- Modify: `packages/db/src/schema/internal.ts`

- [ ] **Step 1: Add the table interface + register on InternalSchema**

Add near the other table interfaces (e.g. after `WorkflowDatasetsTable`):

```ts
export interface CustomQueriesTable {
  id: string;
  name: string;
  connector_id: string;
  sql: string;
  params: unknown; // JSON: CustomQueryParam[]
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}
```

Then add to the `InternalSchema` interface (next to `workflow_datasets: WorkflowDatasetsTable;`):

```ts
  custom_queries: CustomQueriesTable;
```

> Note: `Generated` is already imported in this file (used by other tables). If not, add `import type { Generated } from 'kysely';` at the top.

- [ ] **Step 2: Typecheck the db package**

Run: `pnpm --filter @openldr/db typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema/internal.ts
git commit -m "feat(db): CustomQueriesTable on InternalSchema"
```

### Task 3: Shared Custom Query schema

**Files:**
- Create: `packages/dashboards/src/custom-query.ts`
- Modify: `packages/dashboards/src/index.ts`

- [ ] **Step 1: Write the schema**

```ts
// packages/dashboards/src/custom-query.ts
import { z } from 'zod';

/** Parameter declaration for a Custom Query. Mirrors report-builder's ReportParam so a query
 *  authored on the Query page is described identically to report/dashboard params. */
export const CustomQueryParamSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  type: z.enum(['text', 'select', 'daterange']),
  required: z.boolean().default(false),
  optionsSql: z.string().optional(),
});
export type CustomQueryParam = z.infer<typeof CustomQueryParamSchema>;

/** Persisted, reusable live SQL query bound to a connector. */
export const CustomQuerySchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  connectorId: z.string().min(1),
  sql: z.string(),
  params: z.array(CustomQueryParamSchema).default([]),
});
export type CustomQuery = z.infer<typeof CustomQuerySchema>;

/** Body accepted on create/update (id/timestamps assigned server-side). */
export const CustomQueryInputSchema = CustomQuerySchema.omit({ id: true });
export type CustomQueryInput = z.infer<typeof CustomQueryInputSchema>;
```

- [ ] **Step 2: Export from the barrel**

In `packages/dashboards/src/index.ts` add:

```ts
export * from './custom-query';
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @openldr/dashboards typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboards/src/custom-query.ts packages/dashboards/src/index.ts
git commit -m "feat(dashboards): shared CustomQuery + param schema"
```

### Task 4: CustomQueryStore

**Files:**
- Create: `packages/db/src/custom-query-store.ts`
- Test: `packages/db/src/custom-query-store.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/custom-query-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestInternalDb } from './test-helpers'; // existing helper used by other store tests
import { createCustomQueryStore } from './custom-query-store';

describe('CustomQueryStore', () => {
  let db: Awaited<ReturnType<typeof createTestInternalDb>>;
  beforeEach(async () => { db = await createTestInternalDb(); });

  it('creates, gets, lists, updates and removes', async () => {
    const store = createCustomQueryStore(db);
    await store.create({ id: 'cq_1', name: 'AMR by facility', connectorId: 'c1',
      sql: 'select 1', params: [{ id: 'facility', label: 'Facility', type: 'select', required: false }] });
    const got = await store.get('cq_1');
    expect(got?.name).toBe('AMR by facility');
    expect(got?.params[0].id).toBe('facility');

    expect((await store.list()).length).toBe(1);
    expect((await store.getByName('AMR by facility'))?.id).toBe('cq_1');

    await store.update('cq_1', { name: 'Renamed', sql: 'select 2', params: [] });
    const upd = await store.get('cq_1');
    expect(upd?.name).toBe('Renamed');
    expect(upd?.sql).toBe('select 2');
    expect(upd?.params).toEqual([]);

    await store.remove('cq_1');
    expect(await store.get('cq_1')).toBeNull();
  });
});
```

> If `createTestInternalDb` does not exist under that name, use the exact helper the sibling `report-schedule-store.test.ts` imports — open that test and copy its DB-bootstrap import. Do not invent one.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/db test -- custom-query-store`
Expected: FAIL ("Cannot find module './custom-query-store'").

- [ ] **Step 3: Write the store**

```ts
// packages/db/src/custom-query-store.ts
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';
import type { CustomQuery, CustomQueryParam } from '@openldr/dashboards';

export interface NewCustomQuery {
  id: string; name: string; connectorId: string; sql: string; params: CustomQueryParam[];
}
export interface CustomQueryPatch {
  name?: string; connectorId?: string; sql?: string; params?: CustomQueryParam[];
}
export interface CustomQueryStore {
  create(q: NewCustomQuery): Promise<void>;
  get(id: string): Promise<CustomQuery | null>;
  getByName(name: string): Promise<CustomQuery | null>;
  list(): Promise<CustomQuery[]>;
  update(id: string, patch: CustomQueryPatch): Promise<void>;
  remove(id: string): Promise<void>;
}

const COLS = ['id', 'name', 'connector_id', 'sql', 'params'] as const;

function toQuery(r: { id: string; name: string; connector_id: string; sql: string; params: unknown }): CustomQuery {
  return {
    id: r.id, name: r.name, connectorId: r.connector_id, sql: r.sql,
    params: (r.params as CustomQueryParam[]) ?? [],
  };
}

export function createCustomQueryStore(db: Kysely<InternalSchema>): CustomQueryStore {
  return {
    async create(q) {
      await db.insertInto('custom_queries').values({
        id: q.id, name: q.name, connector_id: q.connectorId, sql: q.sql,
        params: JSON.stringify(q.params) as never,
      }).execute();
    },
    async get(id) {
      const r = await db.selectFrom('custom_queries').select(COLS).where('id', '=', id).executeTakeFirst();
      return r ? toQuery(r) : null;
    },
    async getByName(name) {
      const r = await db.selectFrom('custom_queries').select(COLS).where('name', '=', name).executeTakeFirst();
      return r ? toQuery(r) : null;
    },
    async list() {
      return (await db.selectFrom('custom_queries').select(COLS).orderBy('name', 'asc').execute()).map(toQuery);
    },
    async update(id, patch) {
      const set: Record<string, unknown> = { updated_at: sql`now()` };
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.connectorId !== undefined) set.connector_id = patch.connectorId;
      if (patch.sql !== undefined) set.sql = patch.sql;
      if (patch.params !== undefined) set.params = JSON.stringify(patch.params) as never;
      await db.updateTable('custom_queries').set(set).where('id', '=', id).execute();
    },
    async remove(id) { await db.deleteFrom('custom_queries').where('id', '=', id).execute(); },
  };
}
```

- [ ] **Step 4: Export from the barrel**

In `packages/db/src/index.ts` add:

```ts
export * from './custom-query-store';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @openldr/db test -- custom-query-store`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/custom-query-store.ts packages/db/src/custom-query-store.test.ts packages/db/src/index.ts
git commit -m "feat(db): CustomQueryStore"
```

### Task 5: Param substitution helper (server)

**Files:**
- Create: `apps/server/src/query-sql.ts`
- Test: `apps/server/src/query-sql.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/query-sql.test.ts
import { describe, it, expect } from 'vitest';
import { substituteParams } from './query-sql';
import type { CustomQueryParam } from '@openldr/dashboards';

const dateRange: CustomQueryParam = { id: 'dateRange', label: 'Date range', type: 'daterange', required: false };
const facility: CustomQueryParam = { id: 'facility', label: 'Facility', type: 'select', required: false };

describe('substituteParams', () => {
  it('expands daterange to from/to as quoted date literals', () => {
    const out = substituteParams(
      "select * from t where d between {{param.from}} and {{param.to}}",
      [dateRange], { dateRange: { from: '2026-01-01', to: '2026-06-30' } },
    );
    expect(out).toBe("select * from t where d between '2026-01-01' and '2026-06-30'");
  });

  it('quotes and escapes text/select values', () => {
    const out = substituteParams(
      "select * from t where f = {{param.facility}}", [facility], { facility: "O'Brien" },
    );
    expect(out).toBe("select * from t where f = 'O''Brien'");
  });

  it('rejects a daterange value that is not an ISO date', () => {
    expect(() => substituteParams(
      "{{param.from}}", [dateRange], { dateRange: { from: 'nope', to: '2026-01-01' } },
    )).toThrow(/invalid date/i);
  });

  it('throws when a required param has no value', () => {
    expect(() => substituteParams("{{param.facility}}",
      [{ ...facility, required: true }], {})).toThrow(/required/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/server test -- query-sql`
Expected: FAIL ("Cannot find module './query-sql'").

- [ ] **Step 3: Write the helper**

```ts
// apps/server/src/query-sql.ts
import type { CustomQueryParam } from '@openldr/dashboards';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function sqlString(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}
function assertDate(v: unknown): string {
  if (typeof v !== 'string' || !ISO_DATE.test(v)) throw new Error(`invalid date: ${String(v)}`);
  return v;
}

/** Replace {{param.x}} tokens in `sql` using declared params + supplied values.
 *  - daterange param `p` provides {{param.from}} and {{param.to}} (value: { from, to }).
 *  - text/select provide {{param.<id>}} as a quoted string literal.
 *  Read-only substitution only; caller has already run validateSelectSql. */
export function substituteParams(
  sql: string, params: CustomQueryParam[], values: Record<string, unknown>,
): string {
  const replacements = new Map<string, string>();
  for (const p of params) {
    const v = values[p.id];
    if (p.type === 'daterange') {
      const dr = (v ?? {}) as { from?: unknown; to?: unknown };
      if (p.required && (dr.from == null || dr.to == null)) throw new Error(`required parameter: ${p.id}`);
      if (dr.from != null) replacements.set('from', sqlString(assertDate(dr.from)));
      if (dr.to != null) replacements.set('to', sqlString(assertDate(dr.to)));
    } else {
      if (p.required && (v == null || v === '')) throw new Error(`required parameter: ${p.id}`);
      if (v != null) replacements.set(p.id, sqlString(String(v)));
    }
  }
  return sql.replace(/\{\{\s*param\.([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const r = replacements.get(key);
    if (r === undefined) throw new Error(`unbound parameter: ${key}`);
    return r;
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/server test -- query-sql`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/query-sql.ts apps/server/src/query-sql.test.ts
git commit -m "feat(server): {{param.*}} substitution helper for custom queries"
```

### Task 6: Custom Query CRUD routes

**Files:**
- Create: `apps/server/src/query-routes.ts`
- Test: `apps/server/src/query-routes.test.ts`

> The route file will grow across Tasks 6–9; each task adds a section and its tests. Build the deps object once here.

- [ ] **Step 1: Write the failing test (CRUD)**

```ts
// apps/server/src/query-routes.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerQueryRoutes, type QueryRouteDeps } from './query-routes';

// Minimal in-memory fakes.
function makeDeps(): QueryRouteDeps {
  const store = new Map<string, any>();
  return {
    customQueries: {
      async create(q) { store.set(q.id, { ...q }); },
      async get(id) { return store.get(id) ?? null; },
      async getByName(name) { return [...store.values()].find((q) => q.name === name) ?? null; },
      async list() { return [...store.values()]; },
      async update(id, patch) { store.set(id, { ...store.get(id), ...patch }); },
      async remove(id) { store.delete(id); },
    },
    connectors: {
      async list() { return [{ id: 'c1', name: 'PG', type: 'postgres', enabled: true } as any]; },
      async get(id) { return id === 'c1' ? ({ id, name: 'PG', type: 'postgres', enabled: true } as any) : null; },
    },
    datasets: { async list() { return []; }, async getByName() { return null; } },
    runConnectorSql: async ({ sql }) => ({ columns: [{ key: 'n', label: 'n' }], rows: [{ n: 1 }], sql } as any),
  };
}

async function build(deps = makeDeps()): Promise<FastifyInstance> {
  const app = Fastify();
  // Inject an authenticated actor with the analyst role.
  app.addHook('preHandler', async (req) => { (req as any).user = { sub: 'u1', roles: ['data_analyst'] }; });
  registerQueryRoutes(app, { logger: console } as any, deps);
  await app.ready();
  return app;
}

describe('custom-queries CRUD', () => {
  let app: FastifyInstance;
  beforeEach(async () => { app = await build(); });

  it('creates and lists a custom query', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/custom-queries',
      payload: { name: 'Q1', connectorId: 'c1', sql: 'select 1', params: [] } });
    expect(create.statusCode).toBe(200);
    const id = create.json().id;
    const list = await app.inject({ method: 'GET', url: '/api/custom-queries' });
    expect(list.json().map((q: any) => q.id)).toContain(id);
  });

  it('rejects a create with a duplicate name', async () => {
    await app.inject({ method: 'POST', url: '/api/custom-queries', payload: { name: 'Dup', connectorId: 'c1', sql: 'select 1', params: [] } });
    const dup = await app.inject({ method: 'POST', url: '/api/custom-queries', payload: { name: 'Dup', connectorId: 'c1', sql: 'select 1', params: [] } });
    expect(dup.statusCode).toBe(409);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/server test -- query-routes`
Expected: FAIL ("Cannot find module './query-routes'").

- [ ] **Step 3: Write the route file (deps + CRUD)**

```ts
// apps/server/src/query-routes.ts
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '@openldr/bootstrap';
import { CustomQueryInputSchema, validateSelectSql } from '@openldr/dashboards';
import type { CustomQueryStore } from '@openldr/db';
import { requireRole } from './rbac';
import { substituteParams } from './query-sql';

const AUTHOR_ROLES = ['lab_admin', 'lab_manager', 'data_analyst'];
const ROW_CAP = 1000;

export interface QueryRouteDeps {
  customQueries: CustomQueryStore;
  connectors: {
    list(): Promise<{ id: string; name: string; type: string | null; enabled: boolean }[]>;
    get(id: string): Promise<{ id: string; name: string; type: string | null; enabled: boolean } | null>;
  };
  datasets: {
    list(): Promise<{ id: string; name: string; rowCount: number; publishedTable?: string | null }[]>;
    getByName(name: string): Promise<{ name: string; columns: unknown; rows: unknown[]; publishedTable?: string | null } | null>;
  };
  runConnectorSql(input: { connectorId: string; sql: string }): Promise<{ columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }>;
}

export function registerQueryRoutes(app: FastifyInstance, ctx: AppContext, deps: QueryRouteDeps): void {
  const GUARD = { preHandler: requireRole(...AUTHOR_ROLES) };

  // ---- Custom Query CRUD ----
  app.get('/api/custom-queries', GUARD, async () => deps.customQueries.list());

  app.get('/api/custom-queries/:id', GUARD, async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = await deps.customQueries.get(id);
    if (!q) { reply.code(404); return { error: 'not found' }; }
    return q;
  });

  app.post('/api/custom-queries', GUARD, async (req, reply) => {
    const parsed = CustomQueryInputSchema.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    if (await deps.customQueries.getByName(parsed.data.name)) { reply.code(409); return { error: 'name already exists' }; }
    const id = `cq_${randomUUID().slice(0, 8)}`;
    await deps.customQueries.create({ id, ...parsed.data });
    return { id };
  });

  app.put('/api/custom-queries/:id', GUARD, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await deps.customQueries.get(id);
    if (!existing) { reply.code(404); return { error: 'not found' }; }
    const parsed = CustomQueryInputSchema.partial().safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    if (parsed.data.name && parsed.data.name !== existing.name) {
      const clash = await deps.customQueries.getByName(parsed.data.name);
      if (clash && clash.id !== id) { reply.code(409); return { error: 'name already exists' }; }
    }
    await deps.customQueries.update(id, parsed.data);
    return { ok: true };
  });

  app.delete('/api/custom-queries/:id', GUARD, async (req) => {
    const { id } = req.params as { id: string };
    await deps.customQueries.remove(id);
    return { ok: true };
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/server test -- query-routes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/query-routes.ts apps/server/src/query-routes.test.ts
git commit -m "feat(server): custom-queries CRUD routes"
```

---

## SLICE 2 — Execution + introspection + datasets

### Task 7: `/api/query/run` execution

**Files:**
- Modify: `apps/server/src/query-routes.ts`
- Test: `apps/server/src/query-routes.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `query-routes.test.ts`:

```ts
describe('POST /api/query/run', () => {
  it('runs a read-only select and returns columns/rows/rowCount/ms', async () => {
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/query/run',
      payload: { connectorId: 'c1', sql: 'select 1 as n' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.columns).toEqual([{ key: 'n', label: 'n' }]);
    expect(body.rowCount).toBe(1);
    expect(typeof body.ms).toBe('number');
  });

  it('rejects a non-select statement', async () => {
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/query/run',
      payload: { connectorId: 'c1', sql: 'delete from t' } });
    expect(res.statusCode).toBe(400);
  });

  it('substitutes declared params before running', async () => {
    const deps = makeDeps();
    let seen = '';
    deps.runConnectorSql = async ({ sql }) => { seen = sql; return { columns: [], rows: [] }; };
    const app = await build(deps);
    await app.inject({ method: 'POST', url: '/api/query/run', payload: {
      connectorId: 'c1', sql: 'select * from t where f = {{param.facility}}',
      params: [{ id: 'facility', label: 'Facility', type: 'select', required: false }],
      values: { facility: 'Ndola' },
    } });
    expect(seen).toContain("f = 'Ndola'");
  });

  it('rejects a connector that is missing or disabled', async () => {
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/query/run',
      payload: { connectorId: 'nope', sql: 'select 1' } });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/server test -- query-routes`
Expected: FAIL (404/route missing).

- [ ] **Step 3: Add the run route**

Add inside `registerQueryRoutes`, after the CRUD block. Add these imports at the top if not present: `substituteParams` (already imported), `validateSelectSql` (already imported), and a Zod body schema:

```ts
  const RunBody = z.object({
    connectorId: z.string().min(1),
    sql: z.string().min(1),
    params: z.array(z.any()).optional(),
    values: z.record(z.any()).optional(),
    limit: z.number().int().positive().max(ROW_CAP).optional(),
    offset: z.number().int().min(0).optional(),
  });

  async function runOnConnector(connectorId: string, rawSql: string) {
    const c = await deps.connectors.get(connectorId);
    if (!c || !c.enabled) return { notFound: true as const };
    validateSelectSql(rawSql);
    const started = Date.now();
    const { columns, rows } = await deps.runConnectorSql({ connectorId, sql: rawSql });
    const capped = rows.slice(0, ROW_CAP);
    return { columns, rows: capped, rowCount: capped.length, ms: Date.now() - started };
  }

  app.post('/api/query/run', GUARD, async (req, reply) => {
    const parsed = RunBody.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    let sql = parsed.data.sql;
    if (parsed.data.params?.length) {
      try { sql = substituteParams(sql, parsed.data.params as never, parsed.data.values ?? {}); }
      catch (e) { reply.code(400); return { error: (e as Error).message }; }
    }
    if (typeof parsed.data.limit === 'number') {
      sql = `select * from (${sql.replace(/;\s*$/, '')}) as _q limit ${parsed.data.limit} offset ${parsed.data.offset ?? 0}`;
    }
    try {
      const out = await runOnConnector(parsed.data.connectorId, sql);
      if ('notFound' in out) { reply.code(404); return { error: 'connector not found or disabled' }; }
      return out;
    } catch (e) { reply.code(400); return { error: (e as Error).message }; }
  });
```

> The `limit` wrapper runs `validateSelectSql` on the *inner* SQL first (via `runOnConnector`) — reorder so validation happens before wrapping: validate `parsed.data.sql` (post-substitution) explicitly before the limit wrap. Adjust: call `validateSelectSql(sql)` right after substitution, then wrap, then pass the wrapped SQL straight to `deps.runConnectorSql` (skip the re-validate inside `runOnConnector` for the wrapped path by adding a `preValidated` flag). Keep it simple: validate the user SQL, then wrap.

Concretely, replace the body with this validated-first version:

```ts
  app.post('/api/query/run', GUARD, async (req, reply) => {
    const parsed = RunBody.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    const c = await deps.connectors.get(parsed.data.connectorId);
    if (!c || !c.enabled) { reply.code(404); return { error: 'connector not found or disabled' }; }
    let sql = parsed.data.sql;
    try {
      if (parsed.data.params?.length) sql = substituteParams(sql, parsed.data.params as never, parsed.data.values ?? {});
      validateSelectSql(sql);
    } catch (e) { reply.code(400); return { error: (e as Error).message }; }
    if (typeof parsed.data.limit === 'number') {
      sql = `select * from (${sql.replace(/;\s*$/, '')}) as _q limit ${parsed.data.limit} offset ${parsed.data.offset ?? 0}`;
    }
    try {
      const started = Date.now();
      const { columns, rows } = await deps.runConnectorSql({ connectorId: parsed.data.connectorId, sql });
      const capped = rows.slice(0, ROW_CAP);
      return { columns, rows: capped, rowCount: capped.length, ms: Date.now() - started };
    } catch (e) { reply.code(400); return { error: (e as Error).message }; }
  });
```

(Delete the earlier `runOnConnector`/first draft; keep only this version.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/server test -- query-routes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/query-routes.ts apps/server/src/query-routes.test.ts
git commit -m "feat(server): /api/query/run read-only execution with params + row cap"
```

### Task 8: Introspection + param-options

**Files:**
- Modify: `apps/server/src/query-routes.ts`
- Test: `apps/server/src/query-routes.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe('introspection', () => {
  it('lists sql-typed connectors', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/query/connectors' });
    expect(res.json()).toEqual([{ id: 'c1', name: 'PG', type: 'postgres' }]);
  });

  it('lists tables for a connector schema via information_schema', async () => {
    const deps = makeDeps();
    deps.runConnectorSql = async ({ sql }) => {
      expect(sql.toLowerCase()).toContain('information_schema.tables');
      return { columns: [], rows: [{ table_name: 'products' }, { table_name: 'orders' }] };
    };
    const app = await build(deps);
    const res = await app.inject({ method: 'GET', url: '/api/query/connectors/c1/schemas/public/tables' });
    expect(res.json()).toEqual(['products', 'orders']);
  });

  it('returns distinct options for a select param', async () => {
    const deps = makeDeps();
    deps.runConnectorSql = async () => ({ columns: [], rows: [{ v: 'A' }, { v: 'B' }] });
    const app = await build(deps);
    const res = await app.inject({ method: 'POST', url: '/api/query/param-options',
      payload: { connectorId: 'c1', optionsSql: 'select distinct v from t' } });
    expect(res.json()).toEqual(['A', 'B']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/server test -- query-routes`
Expected: FAIL.

- [ ] **Step 3: Add introspection routes**

Add inside `registerQueryRoutes`. A shared list of SQL-database connector types:

```ts
  const SQL_TYPES = new Set(['postgres', 'mssql', 'mysql']);

  app.get('/api/query/connectors', GUARD, async () => {
    const all = await deps.connectors.list();
    return all.filter((c) => c.enabled && c.type && SQL_TYPES.has(c.type)).map((c) => ({ id: c.id, name: c.name, type: c.type }));
  });

  app.get('/api/query/connectors/:id/schemas', GUARD, async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = await deps.connectors.get(id);
    if (!c || !c.enabled) { reply.code(404); return { error: 'connector not found' }; }
    const { rows } = await deps.runConnectorSql({ connectorId: id,
      sql: "select schema_name from information_schema.schemata where schema_name not in ('pg_catalog','information_schema') order by 1" });
    return rows.map((r) => String(r.schema_name));
  });

  app.get('/api/query/connectors/:id/schemas/:schema/tables', GUARD, async (req, reply) => {
    const { id, schema } = req.params as { id: string; schema: string };
    const c = await deps.connectors.get(id);
    if (!c || !c.enabled) { reply.code(404); return { error: 'connector not found' }; }
    const safeSchema = schema.replace(/'/g, "''");
    const { rows } = await deps.runConnectorSql({ connectorId: id,
      sql: `select table_name from information_schema.tables where table_schema = '${safeSchema}' order by 1` });
    return rows.map((r) => String(r.table_name));
  });

  app.post('/api/query/param-options', GUARD, async (req, reply) => {
    const body = z.object({ connectorId: z.string().min(1), optionsSql: z.string().min(1) }).safeParse(req.body);
    if (!body.success) { reply.code(400); return { error: body.error.message }; }
    try { validateSelectSql(body.data.optionsSql); } catch (e) { reply.code(400); return { error: (e as Error).message }; }
    const c = await deps.connectors.get(body.data.connectorId);
    if (!c || !c.enabled) { reply.code(404); return { error: 'connector not found' }; }
    const { rows } = await deps.runConnectorSql({ connectorId: body.data.connectorId, sql: body.data.optionsSql });
    return rows.slice(0, ROW_CAP).map((r) => Object.values(r)[0]);
  });
```

> `information_schema.schemata`/`.tables` exist in Postgres, MySQL and MSSQL, so this introspection SQL is portable across the v1 SQL types.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/server test -- query-routes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/query-routes.ts apps/server/src/query-routes.test.ts
git commit -m "feat(server): connector introspection + param-options routes"
```

### Task 9: Datasets list/browse

**Files:**
- Modify: `apps/server/src/query-routes.ts`
- Test: `apps/server/src/query-routes.test.ts`

- [ ] **Step 1: Add failing test**

```ts
describe('datasets', () => {
  it('lists datasets', async () => {
    const deps = makeDeps();
    deps.datasets.list = async () => [{ id: 'd1', name: 'AMR Ndola', rowCount: 2, publishedTable: null }];
    const app = await build(deps);
    const res = await app.inject({ method: 'GET', url: '/api/query/datasets' });
    expect(res.json()).toEqual([{ id: 'd1', name: 'AMR Ndola', rowCount: 2 }]);
  });

  it('returns stored rows for an unpublished dataset', async () => {
    const deps = makeDeps();
    deps.datasets.getByName = async () => ({ name: 'AMR Ndola',
      columns: [{ key: 'org', label: 'org' }], rows: [{ org: 'E. coli' }], publishedTable: null });
    const app = await build(deps);
    const res = await app.inject({ method: 'GET', url: '/api/query/datasets/AMR%20Ndola' });
    expect(res.json().rows).toEqual([{ org: 'E. coli' }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/server test -- query-routes`
Expected: FAIL.

- [ ] **Step 3: Add dataset routes**

```ts
  app.get('/api/query/datasets', GUARD, async () => {
    const all = await deps.datasets.list();
    return all.map((d) => ({ id: d.id, name: d.name, rowCount: d.rowCount }));
  });

  app.get('/api/query/datasets/:name', GUARD, async (req, reply) => {
    const { name } = req.params as { name: string };
    const d = await deps.datasets.getByName(decodeURIComponent(name));
    if (!d) { reply.code(404); return { error: 'dataset not found' }; }
    if (d.publishedTable) {
      const { columns, rows } = await deps.runConnectorSql({ connectorId: '__internal__',
        sql: `select * from ${d.publishedTable} limit ${ROW_CAP}` });
      return { columns, rows, rowCount: rows.length };
    }
    return { columns: d.columns, rows: d.rows, rowCount: (d.rows as unknown[]).length };
  });
```

> Note: browsing a *published* dataset table needs an internal-DB SQL path. If `runConnectorSql` cannot target the internal DB via a `'__internal__'` pseudo-connector, wire a dedicated `deps.runInternalSql` in Task 10 instead. For v1, unpublished datasets (stored rows) are the primary path and fully covered here; published-table browsing can fall back to stored rows if `publishedTable` handling is deferred. Keep the stored-rows branch as the tested default.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/server test -- query-routes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/query-routes.ts apps/server/src/query-routes.test.ts
git commit -m "feat(server): dataset list + browse routes"
```

### Task 10: Wire routes into the app

**Files:**
- Modify: `apps/server/src/app.ts`

- [ ] **Step 1: Register the routes**

Add the import near the other route imports:

```ts
import { registerQueryRoutes } from './query-routes';
import { createCustomQueryStore } from '@openldr/db';
```

Add the registration next to `registerConnectorsRoutes(...)` (~line 87):

```ts
  registerQueryRoutes(app, ctx, {
    customQueries: createCustomQueryStore(ctx.internalDb),
    connectors: {
      list: () => ctx.connectors.list(),
      get: (id) => ctx.connectors.get(id),
    },
    datasets: {
      list: () => ctx.workflows.datasets.list(),
      getByName: (name) => ctx.workflows.datasets.getByName(name),
    },
    runConnectorSql: (input) => ctx.workflows.services.runConnectorSql(input),
  });
```

> Confirm the exact method names on `ctx.workflows.datasets` (open `packages/workflows/src/dataset-store.ts` — it exposes `list()` and a name lookup; use its real method name, e.g. `getByName` or `get`). If the dataset store's list items don't carry `id`/`rowCount`/`publishedTable` under those keys, map them in this adapter so the shape matches `QueryRouteDeps.datasets`.

- [ ] **Step 2: Typecheck + server tests**

Run: `pnpm --filter @openldr/server typecheck && pnpm --filter @openldr/server test -- query-routes`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/app.ts
git commit -m "feat(server): wire query routes into buildApp"
```

---

## SLICE 3 — Studio page shell, nav, tree

### Task 11: Typed API client

**Files:**
- Create: `apps/studio/src/query/api.ts`

- [ ] **Step 1: Write the client**

```ts
// apps/studio/src/query/api.ts
import type { CustomQuery, CustomQueryInput, CustomQueryParam } from '@openldr/dashboards';

export interface RunResult { columns: { key: string; label: string }[]; rows: Record<string, unknown>[]; rowCount: number; ms: number }
export interface ConnectorRef { id: string; name: string; type: string | null }
export interface DatasetRef { id: string; name: string; rowCount: number }

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json() as Promise<T>;
}

export const queryApi = {
  connectors: () => fetch('/api/query/connectors').then(j<ConnectorRef[]>),
  schemas: (id: string) => fetch(`/api/query/connectors/${id}/schemas`).then(j<string[]>),
  tables: (id: string, schema: string) => fetch(`/api/query/connectors/${id}/schemas/${schema}/tables`).then(j<string[]>),
  datasets: () => fetch('/api/query/datasets').then(j<DatasetRef[]>),
  datasetRows: (name: string) => fetch(`/api/query/datasets/${encodeURIComponent(name)}`).then(j<RunResult>),
  run: (body: { connectorId: string; sql: string; params?: CustomQueryParam[]; values?: Record<string, unknown>; limit?: number; offset?: number }) =>
    fetch('/api/query/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(j<RunResult>),
  paramOptions: (connectorId: string, optionsSql: string) =>
    fetch('/api/query/param-options', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ connectorId, optionsSql }) }).then(j<unknown[]>),
  list: () => fetch('/api/custom-queries').then(j<CustomQuery[]>),
  create: (input: CustomQueryInput) => fetch('/api/custom-queries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }).then(j<{ id: string }>),
  update: (id: string, input: Partial<CustomQueryInput>) => fetch(`/api/custom-queries/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }).then(j<{ ok: true }>),
  remove: (id: string) => fetch(`/api/custom-queries/${id}`, { method: 'DELETE' }).then(j<{ ok: true }>),
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @openldr/studio typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/src/query/api.ts
git commit -m "feat(studio): query API client"
```

### Task 12: Page store (Zustand)

**Files:**
- Create: `apps/studio/src/query/store.ts`
- Test: `apps/studio/src/query/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/studio/src/query/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useQueryStore } from './store';

describe('query store', () => {
  beforeEach(() => useQueryStore.setState({ tabs: [], activeId: null }));

  it('opens a table tab and activates it', () => {
    useQueryStore.getState().openTableTab({ connectorId: 'c1', schema: 'public', table: 'products' });
    const s = useQueryStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].kind).toBe('table');
    expect(s.activeId).toBe(s.tabs[0].id);
  });

  it('does not duplicate an already-open table tab', () => {
    const open = useQueryStore.getState().openTableTab;
    open({ connectorId: 'c1', schema: 'public', table: 'products' });
    open({ connectorId: 'c1', schema: 'public', table: 'products' });
    expect(useQueryStore.getState().tabs).toHaveLength(1);
  });

  it('opens a query tab and closes tabs, re-activating a neighbour', () => {
    const st = useQueryStore.getState();
    st.openQueryTab({ title: 'Query #1' });
    st.openQueryTab({ title: 'Query #2' });
    const [a, b] = useQueryStore.getState().tabs;
    useQueryStore.getState().closeTab(b.id);
    expect(useQueryStore.getState().tabs.map((t) => t.id)).toEqual([a.id]);
    expect(useQueryStore.getState().activeId).toBe(a.id);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/studio test -- query/store`
Expected: FAIL ("Cannot find module './store'").

- [ ] **Step 3: Write the store**

```ts
// apps/studio/src/query/store.ts
import { create } from 'zustand';
import type { CustomQueryParam } from '@openldr/dashboards';

let seq = 0;
const nextId = () => `t${++seq}`;

export interface TableTab { id: string; kind: 'table'; connectorId: string; schema: string; table: string; title: string }
export interface DatasetTab { id: string; kind: 'dataset'; name: string; title: string }
export interface QueryTab {
  id: string; kind: 'query'; title: string;
  customQueryId?: string; connectorId?: string; sql: string; params: CustomQueryParam[]; dirty: boolean;
}
export type Tab = TableTab | DatasetTab | QueryTab;

interface State {
  tabs: Tab[];
  activeId: string | null;
  openTableTab(t: { connectorId: string; schema: string; table: string }): void;
  openDatasetTab(d: { name: string }): void;
  openQueryTab(q: { title?: string; customQueryId?: string; connectorId?: string; sql?: string; params?: CustomQueryParam[] }): void;
  setActive(id: string): void;
  closeTab(id: string): void;
  patchQuery(id: string, patch: Partial<QueryTab>): void;
}

export const useQueryStore = create<State>((set, get) => ({
  tabs: [], activeId: null,
  openTableTab({ connectorId, schema, table }) {
    const existing = get().tabs.find((t) => t.kind === 'table' && t.connectorId === connectorId && t.schema === schema && t.table === table);
    if (existing) { set({ activeId: existing.id }); return; }
    const tab: TableTab = { id: nextId(), kind: 'table', connectorId, schema, table, title: table };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },
  openDatasetTab({ name }) {
    const existing = get().tabs.find((t) => t.kind === 'dataset' && t.name === name);
    if (existing) { set({ activeId: existing.id }); return; }
    const tab: DatasetTab = { id: nextId(), kind: 'dataset', name, title: name };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },
  openQueryTab(q) {
    if (q.customQueryId) {
      const existing = get().tabs.find((t) => t.kind === 'query' && t.customQueryId === q.customQueryId);
      if (existing) { set({ activeId: existing.id }); return; }
    }
    const n = get().tabs.filter((t) => t.kind === 'query').length + 1;
    const tab: QueryTab = { id: nextId(), kind: 'query', title: q.title ?? `Query #${n}`,
      customQueryId: q.customQueryId, connectorId: q.connectorId, sql: q.sql ?? '', params: q.params ?? [], dirty: false };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },
  setActive(id) { set({ activeId: id }); },
  closeTab(id) {
    const { tabs, activeId } = get();
    const idx = tabs.findIndex((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    let active = activeId;
    if (activeId === id) active = next[idx] ? next[idx].id : next[idx - 1]?.id ?? null;
    set({ tabs: next, activeId: active });
  },
  patchQuery(id, patch) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id && t.kind === 'query' ? { ...t, ...patch } : t)) }));
  },
}));
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/studio test -- query/store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/query/store.ts apps/studio/src/query/store.test.ts
git commit -m "feat(studio): query page tab store"
```

### Task 13: Nav entry, route, i18n

**Files:**
- Modify: `apps/studio/src/App.tsx`, `apps/studio/src/shell/AppShell.tsx`, `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`
- Create: `apps/studio/src/query/QueryPage.tsx` (stub for now, filled in Task 14+)

- [ ] **Step 1: Add i18n keys (all three locales)**

In `en.ts` add `nav.query: 'Query'` and a `query` block:

```ts
  query: {
    explorer: 'Explorer', connectors: 'Connectors', datasets: 'Datasets', customQueries: 'Custom Queries',
    newQuery: 'New query', run: 'Run', save: 'Save', parameters: 'Parameters',
    filterTables: 'Filter…', noConnectors: 'No database connectors', rows: 'rows',
    runParameters: 'Run parameters', runWithValues: 'Run with these values',
  },
```

Add `nav.query` and the same `query` block (translated) to `fr.ts` and `pt.ts`. Keys MUST match `en.ts` exactly (the `EnShape` parity check fails otherwise).

- [ ] **Step 2: Write the page stub**

```tsx
// apps/studio/src/query/QueryPage.tsx
import { AppShell } from '../shell/AppShell';
import { useTranslation } from 'react-i18next';

export function QueryPage(): JSX.Element {
  const { t } = useTranslation();
  return (
    <AppShell title={t('nav.query')}>
      <div className="flex h-full">
        <div className="w-60 border-r border-border" data-testid="query-explorer" />
        <div className="flex-1" data-testid="query-workspace" />
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 3: Add the route + nav entry**

In `App.tsx` import and add:

```tsx
import { QueryPage } from './query/QueryPage';
// inside <Routes>:
      <Route path="/query" element={<RequireRole roles={['lab_admin', 'lab_manager', 'data_analyst']}><QueryPage /></RequireRole>} />
```

In `AppShell.tsx`, import a lucide icon (`Database`) and add to `NAV` after the reports entry:

```ts
  { to: '/query', labelKey: 'nav.query', end: false, icon: Database, roles: ['lab_admin', 'lab_manager', 'data_analyst'] },
```

- [ ] **Step 4: Typecheck + i18n parity test**

Run: `pnpm --filter @openldr/studio typecheck && pnpm --filter @openldr/studio test -- i18n`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/App.tsx apps/studio/src/shell/AppShell.tsx apps/studio/src/i18n/*.ts apps/studio/src/query/QueryPage.tsx
git commit -m "feat(studio): /query route, nav entry, i18n keys"
```

### Task 14: ExplorerTree

**Files:**
- Create: `apps/studio/src/query/tree/ExplorerTree.tsx`
- Test: `apps/studio/src/query/tree/ExplorerTree.test.tsx`
- Modify: `apps/studio/src/query/QueryPage.tsx` (mount the tree)

- [ ] **Step 1: Write the failing test**

```tsx
// apps/studio/src/query/tree/ExplorerTree.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ExplorerTree } from './ExplorerTree';
import { queryApi } from '../api';

vi.mock('../api', () => ({ queryApi: {
  connectors: vi.fn(async () => [{ id: 'c1', name: 'PG', type: 'postgres' }]),
  schemas: vi.fn(async () => ['public']),
  tables: vi.fn(async () => ['products']),
  datasets: vi.fn(async () => [{ id: 'd1', name: 'AMR', rowCount: 2 }]),
  list: vi.fn(async () => [{ id: 'cq1', name: 'Q1', connectorId: 'c1', sql: '', params: [] }]),
} }));

describe('ExplorerTree', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the three system branches and lazy-loads a connector', async () => {
    render(<ExplorerTree />);
    await screen.findByText('Connectors');
    expect(screen.getByText('Datasets')).toBeInTheDocument();
    expect(screen.getByText('Custom Queries')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Connectors'));
    await screen.findByText('PG');
    fireEvent.click(screen.getByText('PG'));
    await waitFor(() => expect(queryApi.schemas).toHaveBeenCalledWith('c1'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/studio test -- ExplorerTree`
Expected: FAIL.

- [ ] **Step 3: Write the tree**

```tsx
// apps/studio/src/query/tree/ExplorerTree.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ChevronDown, Plug, Package, Zap, Table2 } from 'lucide-react';
import { queryApi, type ConnectorRef, type DatasetRef } from '../api';
import { useQueryStore } from '../store';
import type { CustomQuery } from '@openldr/dashboards';

function Row({ depth, open, onClick, icon, label, active }:
  { depth: number; open?: boolean; onClick(): void; icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <button onClick={onClick}
      className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-accent ${active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'}`}
      style={{ paddingLeft: 8 + depth * 14 }}>
      {open === undefined ? <span className="w-3.5" /> : open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      {icon}<span className="truncate">{label}</span>
    </button>
  );
}

export function ExplorerTree(): JSX.Element {
  const { t } = useTranslation();
  const openTableTab = useQueryStore((s) => s.openTableTab);
  const openDatasetTab = useQueryStore((s) => s.openDatasetTab);
  const openQueryTab = useQueryStore((s) => s.openQueryTab);

  const [openBranch, setOpenBranch] = useState<Record<string, boolean>>({});
  const [connectors, setConnectors] = useState<ConnectorRef[]>([]);
  const [datasets, setDatasets] = useState<DatasetRef[]>([]);
  const [queries, setQueries] = useState<CustomQuery[]>([]);
  const [schemas, setSchemas] = useState<Record<string, string[]>>({});
  const [tables, setTables] = useState<Record<string, string[]>>({});

  const toggle = (k: string) => setOpenBranch((o) => ({ ...o, [k]: !o[k] }));

  useEffect(() => { if (openBranch.connectors && connectors.length === 0) queryApi.connectors().then(setConnectors); }, [openBranch.connectors]);
  useEffect(() => { if (openBranch.datasets && datasets.length === 0) queryApi.datasets().then(setDatasets); }, [openBranch.datasets]);
  useEffect(() => { if (openBranch.queries && queries.length === 0) queryApi.list().then(setQueries); }, [openBranch.queries]);

  const loadSchemas = (id: string) => { toggle(`c:${id}`); if (!schemas[id]) queryApi.schemas(id).then((s) => setSchemas((m) => ({ ...m, [id]: s }))); };
  const loadTables = (id: string, schema: string) => {
    const key = `${id}/${schema}`; toggle(`s:${key}`);
    if (!tables[key]) queryApi.tables(id, schema).then((tb) => setTables((m) => ({ ...m, [key]: tb })));
  };

  return (
    <div className="flex h-full flex-col overflow-auto py-2 text-sm">
      <div className="px-3 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">System</div>

      <Row depth={0} open={!!openBranch.connectors} onClick={() => toggle('connectors')} icon={<Plug className="h-3.5 w-3.5" />} label={t('query.connectors')} />
      {openBranch.connectors && connectors.map((c) => (
        <div key={c.id}>
          <Row depth={1} open={!!openBranch[`c:${c.id}`]} onClick={() => loadSchemas(c.id)} icon={<span>🗄</span>} label={c.name} />
          {openBranch[`c:${c.id}`] && (schemas[c.id] ?? []).map((sc) => (
            <div key={sc}>
              <Row depth={2} open={!!openBranch[`s:${c.id}/${sc}`]} onClick={() => loadTables(c.id, sc)} icon={<Package className="h-3.5 w-3.5" />} label={sc} />
              {openBranch[`s:${c.id}/${sc}`] && (tables[`${c.id}/${sc}`] ?? []).map((tb) => (
                <Row key={tb} depth={3} onClick={() => openTableTab({ connectorId: c.id, schema: sc, table: tb })} icon={<Table2 className="h-3.5 w-3.5" />} label={tb} />
              ))}
            </div>
          ))}
        </div>
      ))}

      <Row depth={0} open={!!openBranch.datasets} onClick={() => toggle('datasets')} icon={<Package className="h-3.5 w-3.5" />} label={t('query.datasets')} />
      {openBranch.datasets && datasets.map((d) => (
        <Row key={d.id} depth={1} onClick={() => openDatasetTab({ name: d.name })} icon={<Table2 className="h-3.5 w-3.5" />} label={d.name} />
      ))}

      <Row depth={0} open={!!openBranch.queries} onClick={() => toggle('queries')} icon={<Zap className="h-3.5 w-3.5" />} label={t('query.customQueries')} />
      {openBranch.queries && queries.map((q) => (
        <Row key={q.id} depth={1} onClick={() => openQueryTab({ customQueryId: q.id, title: q.name, connectorId: q.connectorId, sql: q.sql, params: q.params })} icon={<Zap className="h-3.5 w-3.5" />} label={q.name} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Mount it in the page + run test**

In `QueryPage.tsx` replace the explorer placeholder div with `<ExplorerTree />` (import it).

Run: `pnpm --filter @openldr/studio test -- ExplorerTree`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/query/tree/ExplorerTree.tsx apps/studio/src/query/tree/ExplorerTree.test.tsx apps/studio/src/query/QueryPage.tsx
git commit -m "feat(studio): explorer tree (connectors/datasets/custom-queries)"
```

---

## SLICE 4 — Workspace: tabs + table browse

### Task 15: TabBar + workspace shell

**Files:**
- Create: `apps/studio/src/query/workspace/TabBar.tsx`
- Modify: `apps/studio/src/query/QueryPage.tsx`

- [ ] **Step 1: Write the TabBar**

```tsx
// apps/studio/src/query/workspace/TabBar.tsx
import { X, Plus, Table2, Zap, Package } from 'lucide-react';
import { useQueryStore, type Tab } from '../store';

function tabIcon(t: Tab) {
  if (t.kind === 'table') return <Table2 className="h-3.5 w-3.5" />;
  if (t.kind === 'dataset') return <Package className="h-3.5 w-3.5" />;
  return <Zap className="h-3.5 w-3.5" />;
}

export function TabBar(): JSX.Element {
  const { tabs, activeId, setActive, closeTab, openQueryTab } = useQueryStore();
  return (
    <div className="flex items-end gap-0.5 border-b border-border bg-muted/40 px-2">
      {tabs.map((t) => (
        <div key={t.id}
          className={`flex items-center gap-1.5 rounded-t border border-b-0 px-3 py-1.5 text-xs ${t.id === activeId ? 'border-border bg-background text-foreground' : 'border-transparent text-muted-foreground'}`}>
          <button className="flex items-center gap-1.5" onClick={() => setActive(t.id)}>{tabIcon(t)}{t.title}</button>
          <button aria-label={`close ${t.title}`} onClick={() => closeTab(t.id)}><X className="h-3 w-3 opacity-60 hover:opacity-100" /></button>
        </div>
      ))}
      <button aria-label="new query" className="px-2 py-1.5 text-muted-foreground hover:text-foreground" onClick={() => openQueryTab({})}>
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Wire the workspace to render the active tab**

Replace the workspace placeholder in `QueryPage.tsx`:

```tsx
import { TabBar } from './workspace/TabBar';
import { TableTab } from './workspace/TableTab';
import { QueryTab } from './workspace/QueryTab';
import { useQueryStore } from './store';
// ...
function Workspace(): JSX.Element {
  const { tabs, activeId } = useQueryStore();
  const active = tabs.find((t) => t.id === activeId);
  return (
    <div className="flex h-full flex-1 flex-col">
      <TabBar />
      <div className="min-h-0 flex-1">
        {!active && <div className="grid h-full place-items-center text-sm text-muted-foreground">Select a table or open a query</div>}
        {active?.kind === 'table' && <TableTab tab={active} />}
        {active?.kind === 'dataset' && <TableTab tab={active} />}
        {active?.kind === 'query' && <QueryTab tab={active} />}
      </div>
    </div>
  );
}
```

Mount `<Workspace />` where the workspace placeholder div was.

- [ ] **Step 3: Typecheck (TableTab/QueryTab created next)**

Run: `pnpm --filter @openldr/studio typecheck`
Expected: FAIL (TableTab/QueryTab not yet created) — proceed to Task 16/18 which create them, then re-run.

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/query/workspace/TabBar.tsx apps/studio/src/query/QueryPage.tsx
git commit -m "feat(studio): workspace tab bar + active-tab router"
```

### Task 16: TableTab (browse grid + pagination)

**Files:**
- Create: `apps/studio/src/query/workspace/TableTab.tsx`
- Create: `apps/studio/src/query/workspace/ResultsGrid.tsx`

- [ ] **Step 1: Write the ResultsGrid**

```tsx
// apps/studio/src/query/workspace/ResultsGrid.tsx
import type { RunResult } from '../api';

export function ResultsGrid({ result }: { result: RunResult | null }): JSX.Element {
  if (!result) return <div className="grid h-full place-items-center text-sm text-muted-foreground">No results</div>;
  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-xs font-mono">
        <thead className="sticky top-0 bg-muted">
          <tr>{result.columns.map((c) => (
            <th key={c.key} className="border-b border-border px-3 py-1.5 text-left font-medium text-muted-foreground">{c.label}</th>
          ))}</tr>
        </thead>
        <tbody>
          {result.rows.map((r, i) => (
            <tr key={i} className="border-b border-border/60">
              {result.columns.map((c) => <td key={c.key} className="px-3 py-1.5">{String(r[c.key] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Write the TableTab**

```tsx
// apps/studio/src/query/workspace/TableTab.tsx
import { useEffect, useState } from 'react';
import { Code2 } from 'lucide-react';
import { queryApi, type RunResult } from '../api';
import { useQueryStore, type TableTab as TableTabModel, type DatasetTab } from '../store';
import { ResultsGrid } from './ResultsGrid';

const PAGE = 50;

export function TableTab({ tab }: { tab: TableTabModel | DatasetTab }): JSX.Element {
  const openQueryTab = useQueryStore((s) => s.openQueryTab);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<RunResult | null>(null);

  useEffect(() => {
    let alive = true;
    if (tab.kind === 'dataset') {
      queryApi.datasetRows(tab.name).then((r) => { if (alive) setResult(r); });
    } else {
      const sql = `select * from "${tab.schema}"."${tab.table}"`;
      queryApi.run({ connectorId: tab.connectorId, sql, limit: PAGE, offset: page * PAGE }).then((r) => { if (alive) setResult(r); });
    }
    return () => { alive = false; };
  }, [tab, page]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-sm text-muted-foreground">{tab.title}</span>
        {tab.kind === 'table' && (
          <button className="ml-auto flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground"
            onClick={() => openQueryTab({ connectorId: tab.connectorId, sql: `select * from "${tab.schema}"."${tab.table}"` })}>
            <Code2 className="h-3.5 w-3.5" /> SQL
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1"><ResultsGrid result={result} /></div>
      {tab.kind === 'table' && (
        <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
          <span>page {page + 1}</span>
          <button className="ml-auto disabled:opacity-40" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹ Prev</button>
          <button disabled={(result?.rowCount ?? 0) < PAGE} onClick={() => setPage((p) => p + 1)}>Next ›</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + run studio tests**

Run: `pnpm --filter @openldr/studio typecheck && pnpm --filter @openldr/studio test -- query/store`
Expected: typecheck may still fail until QueryTab exists (Task 18). That's expected; continue.

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/query/workspace/TableTab.tsx apps/studio/src/query/workspace/ResultsGrid.tsx
git commit -m "feat(studio): table-browse tab with pagination + SQL-open"
```

---

## SLICE 5 — Query tab (editor + results + save)

### Task 17: SqlEditor (CodeMirror, Studio-themed)

**Files:**
- Create: `apps/studio/src/query/workspace/SqlEditor.tsx`

- [ ] **Step 1: Write the editor**

Model it on `apps/studio/src/dashboard/editor/SqlForm.tsx` (same CodeMirror deps) but themed via the Studio token bridge (no `oneDark`) and a controlled value:

```tsx
// apps/studio/src/query/workspace/SqlEditor.tsx
import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { sql as sqlLang } from '@codemirror/lang-sql';

export function SqlEditor({ value, onChange, onRun }: { value: string; onChange(v: string): void; onRun(): void }): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>();
  const onRunRef = useRef(onRun); onRunRef.current = onRun;

  useEffect(() => {
    if (!host.current || view.current) return;
    try {
      view.current = new EditorView({
        parent: host.current, doc: value,
        extensions: [
          basicSetup, sqlLang(),
          EditorView.theme({ '&': { height: '100%', fontSize: '13px' }, '.cm-content': { fontFamily: 'var(--mono)' } }),
          EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString()); }),
          EditorView.domEventHandlers({ keydown: (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onRunRef.current(); return true; }
            return false;
          } }),
        ],
      });
    } catch { /* jsdom */ }
    return () => { view.current?.destroy(); view.current = undefined; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div ref={host} className="min-h-0 flex-1 overflow-hidden" />
      <textarea aria-label="SQL" className="sr-only" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @openldr/studio typecheck` (still expects QueryTab; ok)

- [ ] **Step 3: Commit**

```bash
git add apps/studio/src/query/workspace/SqlEditor.tsx
git commit -m "feat(studio): themed CodeMirror SQL editor with Cmd+Enter run"
```

### Task 18: QueryTab (split + run + save)

**Files:**
- Create: `apps/studio/src/query/workspace/QueryTab.tsx`
- Test: `apps/studio/src/query/workspace/QueryTab.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/studio/src/query/workspace/QueryTab.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryTab } from './QueryTab';
import { queryApi } from '../api';
import type { QueryTab as QueryTabModel } from '../store';

vi.mock('../api', () => ({ queryApi: {
  connectors: vi.fn(async () => [{ id: 'c1', name: 'PG', type: 'postgres' }]),
  run: vi.fn(async () => ({ columns: [{ key: 'n', label: 'n' }], rows: [{ n: 1 }], rowCount: 1, ms: 3 })),
  paramOptions: vi.fn(async () => []),
} }));

const tab: QueryTabModel = { id: 't1', kind: 'query', title: 'Query #1', connectorId: 'c1', sql: 'select 1 as n', params: [], dirty: false };

describe('QueryTab', () => {
  beforeEach(() => vi.clearAllMocks());
  it('runs a query with no params and shows results', async () => {
    render(<QueryTab tab={tab} />);
    fireEvent.click(screen.getByRole('button', { name: /run/i }));
    await waitFor(() => expect(queryApi.run).toHaveBeenCalled());
    expect(await screen.findByText('1')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/studio test -- QueryTab`
Expected: FAIL.

- [ ] **Step 3: Write the QueryTab**

```tsx
// apps/studio/src/query/workspace/QueryTab.tsx
import { useEffect, useState } from 'react';
import { Play, Save, SlidersHorizontal } from 'lucide-react';
import { queryApi, type ConnectorRef, type RunResult } from '../api';
import { useQueryStore, type QueryTab as QueryTabModel } from '../store';
import { SqlEditor } from './SqlEditor';
import { ResultsGrid } from './ResultsGrid';
import { RunParamsSheet } from '../params/RunParamsSheet';

export function QueryTab({ tab }: { tab: QueryTabModel }): JSX.Element {
  const patchQuery = useQueryStore((s) => s.patchQuery);
  const [connectors, setConnectors] = useState<ConnectorRef[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editorFrac, setEditorFrac] = useState(0.5);

  useEffect(() => { queryApi.connectors().then(setConnectors); }, []);

  const execute = async (values: Record<string, unknown>) => {
    setError(null);
    try {
      const r = await queryApi.run({ connectorId: tab.connectorId ?? '', sql: tab.sql, params: tab.params, values });
      setResult(r);
    } catch (e) { setError((e as Error).message); }
  };

  const onRun = () => { if (tab.params.length > 0) setSheetOpen(true); else void execute({}); };

  const save = async () => {
    const input = { name: tab.title, connectorId: tab.connectorId ?? '', sql: tab.sql, params: tab.params };
    if (tab.customQueryId) await queryApi.update(tab.customQueryId, input);
    else { const { id } = await queryApi.create(input); patchQuery(tab.id, { customQueryId: id }); }
    patchQuery(tab.id, { dirty: false });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col" style={{ height: `${editorFrac * 100}%` }}>
        <div className="flex items-center gap-2 px-3 py-2">
          <button className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground" onClick={onRun}>
            <Play className="h-3.5 w-3.5" /> Run
          </button>
          <button className="flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs" onClick={save}>
            <Save className="h-3.5 w-3.5" /> Save
          </button>
          <button className="flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs" onClick={() => setSheetOpen(true)}>
            <SlidersHorizontal className="h-3.5 w-3.5" /> Parameters
          </button>
          <select className="ml-auto rounded border border-border bg-background px-2 py-1 text-xs" value={tab.connectorId ?? ''}
            onChange={(e) => patchQuery(tab.id, { connectorId: e.target.value, dirty: true })}>
            <option value="" disabled>connector…</option>
            {connectors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="min-h-0 flex-1 border-y border-border">
          <SqlEditor value={tab.sql} onChange={(v) => patchQuery(tab.id, { sql: v, dirty: true })} onRun={onRun} />
        </div>
      </div>
      <div className="h-1 cursor-row-resize bg-border" onMouseDown={(e) => {
        const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
        const move = (ev: MouseEvent) => setEditorFrac(Math.max(0.2, Math.min(0.8, (ev.clientY - box.top) / box.height)));
        const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
      }} />
      <div className="min-h-0 flex-1">
        {error ? <div className="p-3 text-xs text-destructive">{error}</div>
          : <>
              {result && <div className="px-3 py-1 text-xs text-muted-foreground">{result.rowCount} rows · {result.ms}ms</div>}
              <ResultsGrid result={result} />
            </>}
      </div>
      <RunParamsSheet open={sheetOpen} onClose={() => setSheetOpen(false)} params={tab.params}
        connectorId={tab.connectorId ?? ''} onRun={(values) => { setSheetOpen(false); void execute(values); }} />
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/studio test -- QueryTab`
Expected: PASS (RunParamsSheet stub created in Task 19 — if the import fails, create Task 19 first, then return here).

> Ordering note: create `RunParamsSheet` (Task 19) before running this test, since `QueryTab` imports it.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/query/workspace/QueryTab.tsx apps/studio/src/query/workspace/QueryTab.test.tsx
git commit -m "feat(studio): query tab — editor/results split, run, save"
```

---

## SLICE 6 — Parameters

### Task 19: RunParamsSheet

**Files:**
- Create: `apps/studio/src/query/params/RunParamsSheet.tsx`
- Test: `apps/studio/src/query/params/RunParamsSheet.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/studio/src/query/params/RunParamsSheet.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RunParamsSheet } from './RunParamsSheet';
import type { CustomQueryParam } from '@openldr/dashboards';

vi.mock('../api', () => ({ queryApi: { paramOptions: vi.fn(async () => ['Ndola', 'Lusaka']) } }));

const params: CustomQueryParam[] = [
  { id: 'dateRange', label: 'Date range', type: 'daterange', required: false },
  { id: 'facility', label: 'Facility', type: 'select', required: false, optionsSql: 'select distinct f from t' },
];

describe('RunParamsSheet', () => {
  it('renders a control per declared type and returns values on run', () => {
    const onRun = vi.fn();
    render(<RunParamsSheet open params={params} connectorId="c1" onClose={() => {}} onRun={onRun} />);
    fireEvent.change(screen.getByLabelText('dateRange-from'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('dateRange-to'), { target: { value: '2026-06-30' } });
    fireEvent.click(screen.getByRole('button', { name: /run with these values/i }));
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ dateRange: { from: '2026-01-01', to: '2026-06-30' } }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/studio test -- RunParamsSheet`
Expected: FAIL.

- [ ] **Step 3: Write the sheet**

```tsx
// apps/studio/src/query/params/RunParamsSheet.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { queryApi } from '../api';
import type { CustomQueryParam } from '@openldr/dashboards';

export function RunParamsSheet({ open, params, connectorId, onClose, onRun }: {
  open: boolean; params: CustomQueryParam[]; connectorId: string;
  onClose(): void; onRun(values: Record<string, unknown>): void;
}): JSX.Element {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [options, setOptions] = useState<Record<string, unknown[]>>({});

  useEffect(() => {
    if (!open) return;
    for (const p of params) {
      if (p.type === 'select' && p.optionsSql && connectorId && !options[p.id]) {
        queryApi.paramOptions(connectorId, p.optionsSql).then((o) => setOptions((m) => ({ ...m, [p.id]: o })));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, params, connectorId]);

  const set = (id: string, v: unknown) => setValues((s) => ({ ...s, [id]: v }));
  const setRange = (id: string, k: 'from' | 'to', v: string) =>
    setValues((s) => ({ ...s, [id]: { ...(s[id] as object ?? {}), [k]: v } }));

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="flex w-80 flex-col gap-4">
        <SheetHeader><SheetTitle>{t('query.runParameters')}</SheetTitle></SheetHeader>
        {params.map((p) => (
          <div key={p.id} className="space-y-1">
            <label className="text-xs text-muted-foreground">{p.label} · {p.type}</label>
            {p.type === 'daterange' && (
              <div className="flex gap-2">
                <input aria-label={`${p.id}-from`} type="date" className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                  onChange={(e) => setRange(p.id, 'from', e.target.value)} />
                <input aria-label={`${p.id}-to`} type="date" className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                  onChange={(e) => setRange(p.id, 'to', e.target.value)} />
              </div>
            )}
            {p.type === 'select' && (
              <select aria-label={p.id} className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                onChange={(e) => set(p.id, e.target.value)}>
                <option value="" />
                {(options[p.id] ?? []).map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
              </select>
            )}
            {p.type === 'text' && (
              <input aria-label={p.id} className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                onChange={(e) => set(p.id, e.target.value)} />
            )}
          </div>
        ))}
        <button className="mt-auto rounded bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={() => onRun(values)}>
          {t('query.runWithValues')}
        </button>
      </SheetContent>
    </Sheet>
  );
}
```

> Verify the `Sheet` subcomponent export names against `apps/studio/src/components/ui/sheet.tsx` (shadcn typically exports `Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle`). Use the actual exports there.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/studio test -- RunParamsSheet`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/query/params/RunParamsSheet.tsx apps/studio/src/query/params/RunParamsSheet.test.tsx
git commit -m "feat(studio): typed Run parameters sheet"
```

### Task 20: Wire ParametersEditor into the query tab

**Files:**
- Modify: `apps/studio/src/query/workspace/QueryTab.tsx`

- [ ] **Step 1: Reuse the report-builder ParametersEditor**

Import it and render it from the "Parameters" toolbar button (replace the `setSheetOpen(true)` on that button with an editor-open state). The `ParametersEditor` operates on `ReportParam[]`, whose shape is identical to `CustomQueryParam`; pass `tab.params` and persist on save:

```tsx
import { ParametersEditor } from '../../reports-builder/ParametersEditor';
// add state:
const [paramsOpen, setParamsOpen] = useState(false);
// change the Parameters button onClick to setParamsOpen(true)
// render near the sheet:
<ParametersEditor open={paramsOpen} parameters={tab.params as never} onClose={() => setParamsOpen(false)}
  onSave={(p) => { patchQuery(tab.id, { params: p as never, dirty: true }); setParamsOpen(false); }} />
```

> If `ParametersEditor` is not exported from a path importable by the query folder, add a named export to `apps/studio/src/reports-builder/ParametersEditor.tsx` (it already is a named export) and import it directly. Do not copy the component.

- [ ] **Step 2: Typecheck + run the query tests**

Run: `pnpm --filter @openldr/studio typecheck && pnpm --filter @openldr/studio test -- QueryTab`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/src/query/workspace/QueryTab.tsx
git commit -m "feat(studio): declare custom-query params via reused ParametersEditor"
```

---

## Final: Full gate + manual verification

### Task 21: Gate + drive the page

- [ ] **Step 1: Run the full monorepo gate**

Run: `pnpm turbo run typecheck test --force`
Expected: PASS. (Ignore the two known pre-existing flakes: studio `api.test.ts > "includes server error messages…"` and parallel-turbo package timeouts — verify those packages pass in isolation. Never pipe turbo through `tail`.)

- [ ] **Step 2: Drive the real page (per the `verify` skill / project run skill)**

Restart the API server (`apps/server` does NOT hot-reload), start Studio (vite hot-reloads), log in, and verify end-to-end against the dev `openldr_target` DB:
1. `/query` appears in the nav; the page loads with the System tree.
2. Expand **Connectors → <connector> → <schema> → <table>**; click a table → a browse tab paginates.
3. Click **`</> SQL`** on the table tab → a query tab opens seeded with `select * from …`; **Run** shows results.
4. Add a `daterange` + `select` param via **Parameters**; **Run** opens the sheet with a date-range picker + a live-populated dropdown; running substitutes values.
5. **Save** the query; confirm it appears under **Custom Queries** and reloads with its SQL + params.
6. Expand **Datasets**; open one; confirm stored rows render.

- [ ] **Step 3: Commit any fixes found during manual verification**

```bash
git add -A && git commit -m "fix(query): address issues found in end-to-end verification"
```

---

## Self-Review notes (author)

- **Spec coverage:** tree (T14) · table browse+paginate (T16) · query split/run/save (T17–18) · custom-query entity+API (T1–6) · introspection+run+row-cap+read-only (T7–8) · datasets (T9) · typed run sheet (T19) · params declared via reused editor (T20) · placement/nav/i18n/roles (T13). Workflow source node is intentionally out of scope (spec §9).
- **Known follow-through for the implementer (flagged inline, not placeholders):** confirm `createTestInternalDb` helper name (T4), `ctx.workflows.datasets` method/return shape (T10), and the shadcn `Sheet` subcomponent export names (T19) against the real files — each has an explicit instruction to use the actual symbol.
- **Type consistency:** `CustomQueryParam`/`CustomQuery` from `@openldr/dashboards` used uniformly across db store, server routes, studio store/components; `RunResult` shape identical in client + server; `substituteParams(sql, params, values)` signature stable across T5/T7.
