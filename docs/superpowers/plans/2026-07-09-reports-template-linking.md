# Linking Templates to Reports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the eight hardcoded reports and make `/reports` data-driven — each report is a **custom query** (data) + a **report-designer template** (layout) + a thin **report** record that links them and surfaces on the Reports page with the template's params as filters.

**Architecture:** A new `reports` table (mig 043) holds thin report records (`name, category, designId, primaryQueryId, summaryMetrics?, chart?, paramOptions?, status`). Data-driven reports become a **third source** inside the existing `ReportingApi` in `packages/bootstrap/src/index.ts` (alongside catalog + builder), resolved by id via `findSummary/run/renderPdf/options`. Run-history, scheduling, PDF (`/api/reports/:id.pdf`), tabular run (`/api/reports/:id`), and options (`/api/reports/:id/options`) all key off a report-id string, so they work unchanged. The eight built-ins are reproduced as seeded query+template+record, verified against the still-present catalog output, then the catalog code is deleted.

**Tech Stack:** TypeScript, Fastify, Kysely (Postgres `InternalSchema` + analytics `ExternalSchema`), Zod, Vitest, React + react-i18next (studio), pdfkit (`@openldr/report-designer` renderer), `runStoredQuery` (`{{param.x}}` substitution → `validateSelectSql` → connector SQL).

**Key mirror sources (read before starting):**
- Store/seed/route/CLI to mirror: `packages/report-designer/src/store.ts`, `.../seed.ts`, `apps/server/src/report-designs-routes.ts`, `packages/cli/src/report-design.ts`.
- Custom-query store + record type: `packages/db/src/custom-query-store.ts` (`CustomQuery`, `CustomQueryParam { id,label,type,required,optionsSql? }`).
- SQL substitution: `apps/server/src/query-sql.ts` (`{{param.<id>}}`; daterange → `{{param.from}}`+`{{param.to}}`), `apps/server/src/run-stored-query.ts` (`runStoredQuery`, `prepareSelect`).
- Reporting service to extend: `packages/bootstrap/src/index.ts` (`ReportingApi`, lines ~236–287; `renderReportDesignPdf`/`ResolvedTable` from `@openldr/report-designer`).
- Migration + schema pattern: `packages/db/src/migrations/internal/042_report_designs.ts`, `.../index.ts`, `packages/db/src/schema/internal.ts` (`ReportDesignsTable`, the `InternalSchema` table map lines ~527–543).
- Reporting types: `packages/reporting/src/types.ts` (`ReportSummary`, `ReportParamMeta`, `ReportMetricMeta`, `ChartHint`, `ReportResult`), `catalog.ts` (`reportSummaries()/getReport()`), `reports/amr-resistance.ts` (a representative report + its `ExternalSchema` columns).
- Studio: `apps/studio/src/pages/Reports.tsx` (`NewReportButton`, `isCustom`), `apps/studio/src/api.ts` (`fetchReports/fetchReport/fetchReportPdf/fetchReportOptions`, `authFetch`), `apps/studio/src/query/api.ts` (`queryApi.list`).

**Conventions (from memory):** work merges to local `main` `--no-ff` per slice, NOT pushed unless asked. All studio `fetch` MUST use `authFetch` (bare `fetch` 401s under Keycloak). i18n `EnShape` parity: add en→fr→pt or `src/i18n/parity.test.ts` fails. Gate with `pnpm turbo run typecheck test --force` (never pipe turbo through `tail`); ignore the two known flakes (`studio api.test.ts` dedupe + parallel-turbo timeouts — pass in isolation). Live dev: API `node dev.mjs` (restart after backend changes), vite studio hot-reloads, dev Postgres `docker compose up -d postgres`, `AUTH_DEV_BYPASS=true`.

**Slices:** S1 report store+API+CLI · S2 reporting third source · S3 New-report dialog + designer shortcut · S4 migrate 7 plain/CASE reports · S5 re-point consumers + delete catalog · S6 antibiogram (last) · (S7 metrics/chart editor — out of this plan).

---

## Slice S1 — `reports` record: schema, store, API, CLI

Introduces the persistence + management surface for report records. No `/reports` behavior change yet (S2 wires resolution).

### Task 1.1: Reporting-package `ReportDef` type + Zod schema

**Files:**
- Create: `packages/reporting/src/report-def.ts`
- Modify: `packages/reporting/src/index.ts` (add `export * from './report-def'`)
- Test: `packages/reporting/src/report-def.test.ts`

The Zod schema lives in `@openldr/reporting` (which already owns `ReportMetricMeta`/`ChartHint`) so both the API route and CLI validate against one source. The db store re-declares a structural type locally (custom-query-store precedent) to avoid a package cycle.

- [ ] **Step 1: Write the failing test**

```ts
// packages/reporting/src/report-def.test.ts
import { describe, it, expect } from 'vitest';
import { ReportDefSchema } from './report-def';

describe('ReportDefSchema', () => {
  it('parses a minimal report def and defaults status to draft', () => {
    const parsed = ReportDefSchema.parse({
      id: 'r-amr-resistance', name: 'AMR Resistance Rate', description: 'x',
      category: 'amr', designId: 'd1', primaryQueryId: 'q1',
    });
    expect(parsed.status).toBe('draft');
    expect(parsed.summaryMetrics).toBeUndefined();
    expect(parsed.paramOptions).toBeUndefined();
  });

  it('keeps summaryMetrics, chart, paramOptions and published status', () => {
    const parsed = ReportDefSchema.parse({
      id: 'r1', name: 'n', description: '', category: 'operational',
      designId: 'd1', primaryQueryId: 'q1', status: 'published',
      summaryMetrics: [{ id: 'm', label: 'M', type: 'count' }],
      chart: { type: 'bar', x: 'a', y: 'b' },
      paramOptions: { facility: 'q-facilities' },
    });
    expect(parsed.status).toBe('published');
    expect(parsed.paramOptions).toEqual({ facility: 'q-facilities' });
    expect(parsed.chart).toEqual({ type: 'bar', x: 'a', y: 'b' });
  });

  it('rejects an unknown category', () => {
    expect(() => ReportDefSchema.parse({
      id: 'r1', name: 'n', description: '', category: 'nope', designId: 'd', primaryQueryId: 'q',
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/reporting test report-def`
Expected: FAIL — `Cannot find module './report-def'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/reporting/src/report-def.ts
import { z } from 'zod';

// Mirror of ChartHint / ReportMetricMeta from ./types, expressed as Zod so the API + CLI validate input.
const ChartHintSchema = z.union([
  z.object({ type: z.literal('bar'), x: z.string(), y: z.string(), series: z.string().optional() }),
  z.object({ type: z.literal('line'), x: z.string(), y: z.string(), series: z.string().optional() }),
  z.object({ type: z.literal('pie'), label: z.string(), value: z.string() }),
  z.object({ type: z.literal('stat'), value: z.string(), label: z.string() }),
]);

const MetricSchema = z.object({
  id: z.string(), label: z.string(),
  type: z.enum(['count', 'sum', 'avg', 'pct']),
  column: z.string().optional(), match: z.string().optional(),
});

export const ReportDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  category: z.enum(['amr', 'operational', 'quality', 'regulatory']),
  designId: z.string().min(1),
  primaryQueryId: z.string().min(1),
  summaryMetrics: z.array(MetricSchema).optional(),
  chart: ChartHintSchema.optional(),
  paramOptions: z.record(z.string()).optional(),
  status: z.enum(['draft', 'published']).default('draft'),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type ReportDef = z.infer<typeof ReportDefSchema>;
```

Add to `packages/reporting/src/index.ts`:

```ts
export * from './report-def';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/reporting test report-def`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/reporting/src/report-def.ts packages/reporting/src/report-def.test.ts packages/reporting/src/index.ts
git commit -m "feat(reporting): ReportDef type + Zod schema for data-driven reports"
```

### Task 1.2: Migration 043 + `ReportsTable` schema type

**Files:**
- Create: `packages/db/src/migrations/internal/043_reports.ts`
- Create: `packages/db/src/migrations/internal/043_reports.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts` (import + register `043_reports`)
- Modify: `packages/db/src/schema/internal.ts` (add `ReportsTable` + `reports: ReportsTable` to `InternalSchema`)

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/migrations/internal/043_reports.test.ts
import { describe, it, expect } from 'vitest';
import { up, down } from './043_reports';

describe('043_reports migration', () => {
  it('exports up and down', () => {
    expect(typeof up).toBe('function');
    expect(typeof down).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/db test 043_reports`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the migration**

```ts
// packages/db/src/migrations/internal/043_reports.ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('reports')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('category', 'text', (c) => c.notNull())
    .addColumn('design_id', 'text', (c) => c.notNull())
    .addColumn('primary_query_id', 'text', (c) => c.notNull())
    .addColumn('summary_metrics', 'jsonb')
    .addColumn('chart', 'jsonb')
    .addColumn('param_options', 'jsonb')
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('draft'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('reports').ifExists().execute();
}
```

Register in `packages/db/src/migrations/internal/index.ts` (after the `042` import + map entry):

```ts
import * as m043 from './043_reports';
// ...in internalMigrations:
  '043_reports': { up: m043.up, down: m043.down },
```

Add to `packages/db/src/schema/internal.ts` — a new table interface near `ReportDesignsTable`, and the map entry:

```ts
export interface ReportsTable {
  id: string;
  name: string;
  description: string;
  category: string;
  design_id: string;
  primary_query_id: string;
  summary_metrics: unknown | null;
  chart: unknown | null;
  param_options: unknown | null;
  status: string;
  created_at: ColumnType<Date, string | undefined, string | undefined>;
  updated_at: ColumnType<Date, string | undefined, string | undefined>;
}
// ...in interface InternalSchema:
  reports: ReportsTable;
```

(`ColumnType` is already imported in `internal.ts`; if not, mirror the existing `ReportDesignsTable` timestamp columns exactly.)

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @openldr/db test 043_reports && pnpm --filter @openldr/db test migrations`
Expected: PASS. The `migrations.test.ts` roundtrip (up/down over all migrations) still passes with `043` registered.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/internal/043_reports.ts packages/db/src/migrations/internal/043_reports.test.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts
git commit -m "feat(db): migration 043 + ReportsTable for data-driven report records"
```

### Task 1.3: `createReportStore`

**Files:**
- Create: `packages/db/src/report-store.ts`
- Modify: `packages/db/src/index.ts` (export `createReportStore`, `ReportStore`, `ReportRecord`)
- Test: `packages/db/src/report-store.test.ts`

Mirror `custom-query-store.ts`: db re-declares a structural `ReportRecord` type (no dependency on `@openldr/reporting`), JSON columns stringified on write, parsed on read.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/report-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';
import { up } from './migrations/internal/043_reports';
import { createReportStore, type ReportRecord } from './report-store';

function memDb(): Kysely<InternalSchema> {
  const mem = newDb();
  return mem.adapters.createKysely() as unknown as Kysely<InternalSchema>;
}
const base: ReportRecord = {
  id: 'r1', name: 'AMR Resistance', description: '', category: 'amr',
  designId: 'd1', primaryQueryId: 'q1', summaryMetrics: null, chart: null,
  paramOptions: null, status: 'published',
};

describe('createReportStore', () => {
  let db: Kysely<InternalSchema>;
  beforeEach(async () => { db = memDb(); await up(db); });

  it('creates and reads a record with JSON round-tripped', async () => {
    const store = createReportStore(db);
    await store.create({ ...base, summaryMetrics: [{ id: 'm', label: 'M', type: 'count' }], paramOptions: { facility: 'q-fac' } });
    const got = await store.get('r1');
    expect(got?.name).toBe('AMR Resistance');
    expect(got?.summaryMetrics).toEqual([{ id: 'm', label: 'M', type: 'count' }]);
    expect(got?.paramOptions).toEqual({ facility: 'q-fac' });
  });

  it('create is idempotent on duplicate id', async () => {
    const store = createReportStore(db);
    await store.create(base);
    await store.create({ ...base, name: 'changed' });
    expect((await store.get('r1'))?.name).toBe('AMR Resistance');
  });

  it('lists, updates and removes', async () => {
    const store = createReportStore(db);
    await store.create(base);
    await store.update('r1', { ...base, name: 'renamed' });
    expect((await store.get('r1'))?.name).toBe('renamed');
    expect(await store.list()).toHaveLength(1);
    await store.remove('r1');
    expect(await store.get('r1')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/db test report-store`
Expected: FAIL — `Cannot find module './report-store'`.

- [ ] **Step 3: Write the store**

```ts
// packages/db/src/report-store.ts
import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';

// Structural mirror of @openldr/reporting ReportDef (db must not depend on reporting; custom-query-store precedent).
export interface ReportRecord {
  id: string;
  name: string;
  description: string;
  category: string;
  designId: string;
  primaryQueryId: string;
  summaryMetrics: unknown[] | null;
  chart: unknown | null;
  paramOptions: Record<string, string> | null;
  status: string;
}

function toRow(r: ReportRecord) {
  return {
    id: r.id, name: r.name, description: r.description, category: r.category,
    design_id: r.designId, primary_query_id: r.primaryQueryId,
    summary_metrics: r.summaryMetrics == null ? null : JSON.stringify(r.summaryMetrics),
    chart: r.chart == null ? null : JSON.stringify(r.chart),
    param_options: r.paramOptions == null ? null : JSON.stringify(r.paramOptions),
    status: r.status,
  };
}
function parse<T>(v: unknown): T | null { return v == null ? null : (typeof v === 'string' ? JSON.parse(v) : v) as T; }
function fromRow(r: Record<string, unknown>): ReportRecord {
  return {
    id: r.id as string, name: r.name as string, description: (r.description as string) ?? '',
    category: r.category as string, designId: r.design_id as string, primaryQueryId: r.primary_query_id as string,
    summaryMetrics: parse<unknown[]>(r.summary_metrics), chart: parse<unknown>(r.chart),
    paramOptions: parse<Record<string, string>>(r.param_options), status: r.status as string,
  };
}

export interface ReportStore {
  list(): Promise<ReportRecord[]>;
  get(id: string): Promise<ReportRecord | undefined>;
  create(r: ReportRecord): Promise<ReportRecord>;
  update(id: string, r: ReportRecord): Promise<ReportRecord>;
  remove(id: string): Promise<void>;
}

export function createReportStore(db: Kysely<InternalSchema>): ReportStore {
  const store: ReportStore = {
    async list() {
      const rows = await db.selectFrom('reports').selectAll().orderBy('name').execute();
      return rows.map((r) => fromRow(r as Record<string, unknown>));
    },
    async get(id) {
      const r = await db.selectFrom('reports').selectAll().where('id', '=', id).executeTakeFirst();
      return r ? fromRow(r as Record<string, unknown>) : undefined;
    },
    async create(r) {
      const inserted = await db.insertInto('reports').values(toRow(r) as never)
        .onConflict((oc) => oc.column('id').doNothing()).returningAll().executeTakeFirst();
      if (inserted) return fromRow(inserted as Record<string, unknown>);
      return (await store.get(r.id))!;
    },
    async update(id, r) {
      await db.updateTable('reports').set({ ...toRow({ ...r, id }) } as never).where('id', '=', id).execute();
      return (await store.get(id))!;
    },
    async remove(id) { await db.deleteFrom('reports').where('id', '=', id).execute(); },
  };
  return store;
}
```

Export from `packages/db/src/index.ts` (mirror how `createReportRunStore` is exported):

```ts
export { createReportStore, type ReportStore, type ReportRecord } from './report-store';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/db test report-store`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/report-store.ts packages/db/src/report-store.test.ts packages/db/src/index.ts
git commit -m "feat(db): createReportStore for data-driven report records"
```

### Task 1.4: Wire `ctx.reportDefs` into the app context

**Files:**
- Modify: `packages/bootstrap/src/index.ts` (import `createReportStore`; add `reportDefs: ReportStore` to `AppContext`; construct it near `reportDesignStore`)
- Modify: `apps/server/src/app.test.ts` (add `reportDefs: {} as never` to any hand-built mock ctx — mirror the `reportDesigns: {} as never` fix noted for mig 042)

- [ ] **Step 1: Write the failing test**

```ts
// packages/bootstrap/src/report-defs-ctx.test.ts  (new)
import { describe, it, expect } from 'vitest';
import { createAppContext } from './index';
import { loadConfig } from '@openldr/config';

describe('AppContext.reportDefs', () => {
  it('exposes a report-def store', async () => {
    const ctx = await createAppContext(loadConfig());
    try { expect(typeof ctx.reportDefs.list).toBe('function'); }
    finally { await ctx.close(); }
  });
});
```

> If the repo has no live Postgres in unit tests, instead assert the wiring by type only: add a `// @ts-expect-no-error` usage `const _s: ReportStore = ctx.reportDefs;` inside an existing bootstrap test that already builds a ctx. Prefer matching the existing `reportDesigns` test approach in this package.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/bootstrap test report-defs-ctx`
Expected: FAIL — `Property 'reportDefs' does not exist on type 'AppContext'`.

- [ ] **Step 3: Wire it**

In `packages/bootstrap/src/index.ts`:

```ts
// with the other @openldr/db imports:
import { /* …existing… */ createReportStore, type ReportStore } from '@openldr/db';

// in interface AppContext, next to `reportDesigns: ReportDesignStore;`:
  reportDefs: ReportStore;

// near `const reportDesignStore = createReportDesignStore(internal.db);`:
  const reportDefStore = createReportStore(internal.db);

// in the returned ctx object, next to `reportDesigns: reportDesignStore,`:
  reportDefs: reportDefStore,
```

Add `reportDefs: {} as never` wherever `apps/server/src/app.test.ts` (or other suites) hand-build a partial `AppContext` mock — search for `reportDesigns:` to find the sites.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @openldr/bootstrap test report-defs-ctx && pnpm --filter @openldr/server test app`
Expected: PASS. `tsc` clean (the AppContext field is now populated everywhere).

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/index.ts packages/bootstrap/src/report-defs-ctx.test.ts apps/server/src/app.test.ts
git commit -m "feat(bootstrap): expose ctx.reportDefs report-def store"
```

### Task 1.5: `/api/report-defs` CRUD route

**Files:**
- Create: `apps/server/src/report-defs-routes.ts`
- Modify: `apps/server/src/app.ts` (register `registerReportDefRoutes(app, ctx)` beside the existing `registerReportDesignRoutes(app, ctx, {…})` call, ~line 87 — note the new route needs NO extra deps arg)
- Test: `apps/server/src/report-defs-routes.test.ts`

Mirror `report-designs-routes.ts` exactly (GET open; POST/PUT/DELETE `requireRole('lab_admin','lab_manager')`; Zod 400; audit `report-def.*`). Distinct prefix `/api/report-defs` — `/api/reports/:id` already means "run this report".

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/report-defs-routes.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { registerReportDefRoutes } from './report-defs-routes';

function fakeCtx() {
  const rows = new Map<string, any>();
  return {
    reportDefs: {
      list: async () => [...rows.values()],
      get: async (id: string) => rows.get(id),
      create: async (r: any) => { rows.set(r.id, r); return r; },
      update: async (id: string, r: any) => { rows.set(id, r); return r; },
      remove: async (id: string) => { rows.delete(id); },
    },
    audit: { record: async () => {} },
  } as any;
}
async function app(ctx = fakeCtx()) {
  const f = Fastify();
  f.decorateRequest('user', null);
  f.addHook('onRequest', (req, _r, done) => { (req as any).user = { id: 'u', username: 'admin', roles: ['lab_admin'] }; done(); });
  registerReportDefRoutes(f as any, ctx);
  await f.ready();
  return f;
}

describe('report-defs routes', () => {
  let f: any;
  beforeEach(async () => { f = await app(); });

  it('POST creates then GET lists', async () => {
    const body = { id: 'r1', name: 'AMR', description: '', category: 'amr', designId: 'd1', primaryQueryId: 'q1' };
    const c = await f.inject({ method: 'POST', url: '/api/report-defs', payload: body });
    expect(c.statusCode).toBe(201);
    const l = await f.inject({ method: 'GET', url: '/api/report-defs' });
    expect(JSON.parse(l.body)).toHaveLength(1);
  });

  it('POST rejects an invalid body with 400', async () => {
    const c = await f.inject({ method: 'POST', url: '/api/report-defs', payload: { id: 'x' } });
    expect(c.statusCode).toBe(400);
  });

  it('DELETE 404s an unknown id', async () => {
    const c = await f.inject({ method: 'DELETE', url: '/api/report-defs/nope' });
    expect(c.statusCode).toBe(404);
  });
});
```

> Match the exact RBAC/user-injection + audit pattern that `report-designs-routes.test.ts` uses in this repo — copy its harness rather than the sketch above if they differ.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server test report-defs-routes`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the route** (mirror `report-designs-routes.ts`)

```ts
// apps/server/src/report-defs-routes.ts
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { ReportDefSchema } from '@openldr/reporting';
import { recordAudit } from './audit-helper';
import { requireRole } from './rbac';

export function registerReportDefRoutes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: FastifyInstance<any, any, any, any>, ctx: AppContext,
): void {
  const MANAGE = { preHandler: requireRole('lab_admin', 'lab_manager') };

  app.get('/api/report-defs', async () => ctx.reportDefs.list());

  app.get('/api/report-defs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await ctx.reportDefs.get(id);
    if (!r) { reply.code(404); return { error: 'not found' }; }
    return r;
  });

  app.post('/api/report-defs', MANAGE, async (req, reply) => {
    const p = ReportDefSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const created = await ctx.reportDefs.create(p.data as never);
    await recordAudit(ctx, req, { action: 'report-def.create', entityType: 'report-def', entityId: created.id, before: null, after: created });
    reply.code(201);
    return created;
  });

  app.put('/api/report-defs/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = ReportDefSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const before = await ctx.reportDefs.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }
    const after = await ctx.reportDefs.update(id, p.data as never);
    await recordAudit(ctx, req, { action: 'report-def.update', entityType: 'report-def', entityId: id, before, after });
    return after;
  });

  app.delete('/api/report-defs/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await ctx.reportDefs.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }
    await ctx.reportDefs.remove(id);
    await recordAudit(ctx, req, { action: 'report-def.delete', entityType: 'report-def', entityId: id, before, after: null });
    reply.code(204);
    return null;
  });
}
```

> `ReportDef` (Zod, camelCase) vs `ReportRecord` (store, camelCase) match field-for-field, so `p.data` is directly storable. If the store type ever diverges, map explicitly here.

Register beside the design routes (in the file that calls `registerReportDesignRoutes`):

```ts
import { registerReportDefRoutes } from './report-defs-routes';
// ...
registerReportDefRoutes(app, ctx);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/server test report-defs-routes`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/report-defs-routes.ts apps/server/src/report-defs-routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): /api/report-defs CRUD for report records"
```

### Task 1.6: `openldr report-def` CLI

**Files:**
- Create: `packages/cli/src/report-def.ts` (mirror `report-design.ts`: `listReportDefs`, `deleteReportDef`, `runList`, `runDelete` over `ctx.reportDefs`)
- Modify: the CLI command registration (search for how `report-design` subcommands are registered; add `report-def list --json` / `report-def delete <id> --force`)
- Test: `packages/cli/src/report-def.test.ts` (mirror `report-design.test.ts`: inject a fake store, assert JSON + table output + `--force` guard)

- [ ] **Step 1: Write the failing test** — copy `report-design.test.ts`, rename to `report-def`, and change the printed columns to `${d.id}\t${d.name}\t${d.category}\t${d.status}`.

- [ ] **Step 2:** Run `pnpm --filter @openldr/cli test report-def` → FAIL (module not found).

- [ ] **Step 3: Write the CLI** (mirror `report-design.ts`)

```ts
// packages/cli/src/report-def.ts
import { createAppContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import type { ReportStore } from '@openldr/db';

type Writer = (s: string) => void;
const stdout: Writer = (s) => process.stdout.write(s);

export async function listReportDefs(store: ReportStore, opts: { json: boolean }, write: Writer = stdout): Promise<void> {
  const defs = await store.list();
  if (opts.json) { write(JSON.stringify(defs, null, 2) + '\n'); return; }
  const lines = defs.map((d) => `${d.id}\t${d.name}\t${d.category}\t${d.status}`);
  write((lines.length ? lines.join('\n') : '(no reports)') + '\n');
}
export async function deleteReportDef(store: ReportStore, id: string, opts: { force: boolean }): Promise<void> {
  if (!opts.force) throw new Error('refusing to delete without --force');
  await store.remove(id);
}
export async function runList(opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try { await listReportDefs(ctx.reportDefs, opts); return 0; } finally { await ctx.close(); }
}
export async function runDelete(id: string, opts: { force: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try { await deleteReportDef(ctx.reportDefs, id, opts); process.stdout.write(`deleted ${id}\n`); return 0; } finally { await ctx.close(); }
}
```

Register the `report-def` subcommands exactly like `report-design` is registered.

- [ ] **Step 4:** Run `pnpm --filter @openldr/cli test report-def` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/report-def.ts packages/cli/src/report-def.test.ts packages/cli/src/<cli-entry>.ts
git commit -m "feat(cli): openldr report-def list/delete"
```

### Task 1.7: Slice gate + merge

- [ ] **Step 1:** Run `pnpm turbo run typecheck test --force` (ignore the two known flakes). Expected: green.
- [ ] **Step 2:** Merge to local `main`:

```bash
git checkout main && git merge --no-ff feat/reports-linking-s1 -m "S1: reports record store + API + CLI"
```

---

## Slice S2 — reporting service resolves data-driven reports (third source)

Wires `reports` records into `ReportingApi` so a manually-seeded record lists + runs + renders on `/reports`. No UI change needed (studio already targets `/api/reports/...`).

> **Architectural constraint (why Task 2.1 exists):** the custom-query run pipeline lives in `apps/server` (`run-stored-query.ts`, `query-sql.ts`), but `packages/bootstrap` needs it for the data-driven `run`/`renderPdf` — and a **package cannot import from an app**. The scheduler (in bootstrap) calls `ctx.reporting.renderPdf`, so the logic MUST live behind `ctx.reporting` in bootstrap, not in the server routes. Fix: move the pipeline into `@openldr/dashboards` (already a bootstrap dep; already owns `validateSelectSql` + `CustomQueryParam`). Connector execution is available in bootstrap via `ctx.workflows.services.runConnectorSql` (app.ts confirms it's "always wired in bootstrap").

### Task 2.1: Extract the custom-query run pipeline into `@openldr/dashboards` + a shared table resolver

**Files:**
- Create: `packages/dashboards/src/custom-query-run.ts` (move `substituteParams` from `apps/server/src/query-sql.ts` + `prepareSelect`/`runStoredQuery`/`RunStoredQueryDeps` from `apps/server/src/run-stored-query.ts`)
- Modify: `packages/dashboards/src/index.ts` (export the above)
- Modify: `apps/server/src/query-sql.ts` and `apps/server/src/run-stored-query.ts` → thin re-export shims (`export { … } from '@openldr/dashboards'`) so no other server file churns
- Modify: `packages/report-designer/src/render/index.ts` (or a new `resolve.ts` in the Node barrel) — add generic `resolveDesignTables(design, values, runQuery)` (injected `runQuery`, no db/dashboards coupling); export from the `.` barrel
- Modify: `apps/server/src/report-designs-routes.ts` (`POST /preview` uses the shared resolver)
- Test: `packages/dashboards/src/custom-query-run.test.ts`, `packages/report-designer/src/render/resolve.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/report-designer/src/render/resolve.test.ts
import { describe, it, expect } from 'vitest';
import { resolveDesignTables } from './resolve';

describe('resolveDesignTables', () => {
  it('resolves bound tables and turns a failing query into an error entry', async () => {
    const runQuery = async (queryId: string) => {
      if (queryId === 'q1') return { columns: [{ key: 'a', label: 'a' }], rows: [{ a: 1 }] };
      throw new Error(`custom query not found: ${queryId}`);
    };
    const design = { parameters: [], pages: [{ id: 'p', elements: [
      { id: 't1', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 1, h: 1 }, dataSource: { kind: 'custom-query', queryId: 'q1' } },
      { id: 't2', kind: 'table', name: 'T2', rect: { x: 0, y: 0, w: 1, h: 1 }, dataSource: { kind: 'custom-query', queryId: 'missing' } },
      { id: 'txt', kind: 'text', name: 'x', rect: { x: 0, y: 0, w: 1, h: 1 }, text: 'hi' },
    ] }] } as any;
    const resolved = await resolveDesignTables(design, {}, runQuery);
    expect(resolved.get('t1')).toEqual({ columns: [{ key: 'a', label: 'a' }], rows: [{ a: 1 }] });
    expect((resolved.get('t2') as any).error).toContain('missing');
    expect(resolved.has('txt')).toBe(false);
  });
});
```

```ts
// packages/dashboards/src/custom-query-run.test.ts  (smoke: the moved fns still work)
import { describe, it, expect } from 'vitest';
import { runStoredQuery } from './custom-query-run';
it('runs a stored query through substitute→validate→connector', async () => {
  const deps = {
    customQueries: { get: async () => ({ id: 'q', name: 'q', connectorId: 'c', sql: 'select 1 as a', params: [] }) },
    runConnectorSql: async () => ({ columns: [{ key: 'a', label: 'a' }], rows: [{ a: 1 }] }),
  };
  expect((await runStoredQuery(deps as any, 'q', {})).rows).toEqual([{ a: 1 }]);
});
```

- [ ] **Step 2:** Run `pnpm --filter @openldr/report-designer test resolve && pnpm --filter @openldr/dashboards test custom-query-run` → FAIL (modules not found).

- [ ] **Step 3: Implement.**
  1. Move `substituteParams` (from `query-sql.ts`), and `prepareSelect`/`runStoredQuery`/`RunStoredQueryDeps`/`ROW_CAP` (from `run-stored-query.ts`) verbatim into `packages/dashboards/src/custom-query-run.ts`. Imports become intra-package (`./custom-query`, `validateSelectSql`) — `CustomQueryStore`/`CustomQueryParam` come from `@openldr/db`/`@openldr/dashboards` as they do today. Export from the dashboards barrel.
  2. Replace `apps/server/src/query-sql.ts` and `apps/server/src/run-stored-query.ts` bodies with `export { substituteParams } from '@openldr/dashboards';` and `export { prepareSelect, runStoredQuery, type RunStoredQueryDeps } from '@openldr/dashboards';` respectively (keeps every existing server import path valid).
  3. Add the generic resolver in report-designer's Node barrel:

```ts
// packages/report-designer/src/render/resolve.ts
import type { ReportDesign } from '../schema';
import type { ResolvedTable } from './index';

export type RunQuery = (queryId: string, values: Record<string, unknown>) => Promise<{ columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }>;

/** Run every bound table's query with `values`; elId → rows|error (never throws per-table). */
export async function resolveDesignTables(
  design: ReportDesign, values: Record<string, unknown>, runQuery: RunQuery,
): Promise<Map<string, ResolvedTable>> {
  const resolved = new Map<string, ResolvedTable>();
  for (const page of design.pages) {
    for (const el of page.elements) {
      if (el.kind !== 'table' || !el.dataSource) continue;
      try {
        const { columns, rows } = await runQuery(el.dataSource.queryId, values);
        resolved.set(el.id, { columns, rows });
      } catch (e) {
        resolved.set(el.id, { error: (e as Error).message });
      }
    }
  }
  return resolved;
}
```

  Export `resolveDesignTables` + `RunQuery` from the report-designer `.` barrel (NOT `/pure` — it's Node-render-adjacent, but it's pure JS with no pdfkit import, so it may also live in `/pure`; keep it on the `.` barrel next to `renderReportDesignPdf` for locality). Refactor `report-designs-routes.ts` `POST /preview` to: build `values` from `design.parameters`, then `const resolved = await resolveDesignTables(design, values, (qid, v) => runStoredQuery(deps, qid, v));`.

- [ ] **Step 4:** Run `pnpm --filter @openldr/dashboards test && pnpm --filter @openldr/report-designer test && pnpm --filter @openldr/server test run-stored-query report-designs-routes query-routes` → PASS (moved fns + preview + query routes all green via shims).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/custom-query-run.ts packages/dashboards/src/custom-query-run.test.ts packages/dashboards/src/index.ts apps/server/src/query-sql.ts apps/server/src/run-stored-query.ts packages/report-designer/src/render/resolve.ts packages/report-designer/src/render/resolve.test.ts packages/report-designer/src/render/index.ts apps/server/src/report-designs-routes.ts
git commit -m "refactor: move custom-query run pipeline into @openldr/dashboards; shared resolveDesignTables"
```

### Task 2.2: `reportDefToSummary` + param→filter mapping

**Files:**
- Modify: `packages/bootstrap/src/index.ts` (add a local `reportDefToSummary(def, design)` helper near `templateToSummary`)
- Test: `packages/bootstrap/src/report-def-summary.test.ts`

Maps a report record + its linked design to a `ReportSummary`, deriving `parameters[]` from the design's `parameters[]`. A `select` param gets `optionsKey = key` only if `paramOptions[key]` exists.

- [ ] **Step 1: Write the failing test**

```ts
// packages/bootstrap/src/report-def-summary.test.ts
import { describe, it, expect } from 'vitest';
import { reportDefToSummary } from './index';

describe('reportDefToSummary', () => {
  it('derives filter params from the design and marks the source', () => {
    const def = { id: 'r1', name: 'AMR', description: 'd', category: 'amr', designId: 'd1',
      primaryQueryId: 'q1', summaryMetrics: [{ id: 'm', label: 'M', type: 'count' }],
      paramOptions: { facility: 'q-fac' }, status: 'published' } as any;
    const design = { id: 'd1', name: 'AMR', paper: 'A4', orientation: 'portrait', pages: [], parameters: [
      { key: 'dateRange', label: 'Date range', type: 'daterange' },
      { key: 'facility', label: 'Facility', type: 'select' },
      { key: 'note', label: 'Note', type: 'text', required: true },
    ] } as any;
    const s = reportDefToSummary(def, design);
    expect(s.source).toBe('design');
    expect(s.category).toBe('amr');
    expect(s.summaryMetrics).toEqual([{ id: 'm', label: 'M', type: 'count' }]);
    expect(s.parameters).toEqual([
      { id: 'dateRange', label: 'Date range', type: 'daterange', required: false },
      { id: 'facility', label: 'Facility', type: 'select', required: false, optionsKey: 'facility' },
      { id: 'note', label: 'Note', type: 'text', required: true },
    ]);
  });
});
```

- [ ] **Step 2:** Run `pnpm --filter @openldr/bootstrap test report-def-summary` → FAIL (`reportDefToSummary` not exported).

- [ ] **Step 3: Implement** — in `packages/bootstrap/src/index.ts`, and add `'design'` to the `ReportSummary.source` union in `packages/reporting/src/types.ts` (`source?: 'catalog' | 'builder' | 'design'`):

```ts
import type { ReportDesign } from '@openldr/report-designer/pure';
import type { ReportRecord } from '@openldr/db';
import type { ReportParamMeta, ReportMetricMeta } from '@openldr/reporting';

export function reportDefToSummary(def: ReportRecord, design: ReportDesign): ReportSummary {
  const parameters: ReportParamMeta[] = design.parameters.map((p) => {
    const type = (p.type ?? 'text') as ReportParamMeta['type'];
    const base: ReportParamMeta = { id: p.key, label: p.label, type, required: Boolean((p as { required?: boolean }).required) };
    if (type === 'select' && def.paramOptions?.[p.key]) base.optionsKey = p.key;
    return base;
  });
  return {
    id: def.id, name: def.name, description: def.description,
    category: def.category as ReportSummary['category'],
    parameters,
    summaryMetrics: (def.summaryMetrics ?? undefined) as ReportMetricMeta[] | undefined,
    source: 'design',
  };
}
```

- [ ] **Step 4:** Run `pnpm --filter @openldr/bootstrap test report-def-summary && pnpm --filter @openldr/reporting test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/index.ts packages/bootstrap/src/report-def-summary.test.ts packages/reporting/src/types.ts
git commit -m "feat(bootstrap): reportDefToSummary maps report record + design to a filter-bearing summary"
```

### Task 2.3: Extend `ReportingApi` — listAll / findSummary / run / renderPdf / options

**Files:**
- Modify: `packages/bootstrap/src/index.ts` (the `reporting` object, lines ~246–287)
- Test: `packages/bootstrap/src/reporting-data-driven.test.ts`

Each method gains a report-def branch. Values for the data-driven paths are the raw filter params (`{from,to,facility,…}`); the seeded queries use matching `{{param.*}}` ids. Because `reportDefStore` is constructed *after* the `reporting` object today, **move the `reportDefStore` construction above the `reporting` object** (it only needs `internal.db`).

- [ ] **Step 1: Write the failing test** (inject fake stores; assert each branch)

```ts
// packages/bootstrap/src/reporting-data-driven.test.ts
import { describe, it, expect } from 'vitest';
import { buildReportingForTest } from './index';  // small test seam — see Step 3

const design = { id: 'd1', name: 'AMR', paper: 'A4', orientation: 'portrait',
  parameters: [{ key: 'facility', label: 'Facility', type: 'select' }],
  pages: [{ id: 'p', elements: [{ id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 10, h: 10 },
    dataSource: { kind: 'custom-query', queryId: 'q1' } }] }] } as any;
const def = { id: 'r1', name: 'AMR', description: '', category: 'amr', designId: 'd1',
  primaryQueryId: 'q1', summaryMetrics: null, chart: { type: 'bar', x: 'a', y: 'b' },
  paramOptions: { facility: 'q-fac' }, status: 'published' } as any;

const deps = {
  reportDefs: { list: async () => [def], get: async (id: string) => id === 'r1' ? def : undefined },
  reportDesigns: { get: async (id: string) => id === 'd1' ? design : undefined },
  runStoredQuery: async (queryId: string) => queryId === 'q-fac'
    ? { columns: [{ key: 'v', label: 'v' }], rows: [{ v: 'Ndola' }, { v: 'Lusaka' }] }
    : { columns: [{ key: 'a', label: 'a' }], rows: [{ a: 1 }, { a: 2 }] },
  resolveDesignTables: async () => new Map([['t', { columns: [{ key: 'a', label: 'a' }], rows: [{ a: 1 }] }]]),
  renderReportDesignPdf: async () => Buffer.from('%PDF-1.4 fake'),
};

describe('reporting data-driven branch', () => {
  const reporting = buildReportingForTest(deps as any);

  it('listAll includes the published report record', async () => {
    expect((await reporting.listAll()).some((s) => s.id === 'r1' && s.source === 'design')).toBe(true);
  });
  it('findSummary resolves a report record', async () => {
    expect((await reporting.findSummary('r1'))?.name).toBe('AMR');
  });
  it('run executes the primary query and attaches the chart', async () => {
    const r = await reporting.run('r1', { facility: 'Ndola' });
    expect(r.rows).toHaveLength(2);
    expect(r.chart).toEqual({ type: 'bar', x: 'a', y: 'b' });
  });
  it('renderPdf resolves tables and returns a PDF buffer', async () => {
    expect((await reporting.renderPdf('r1', { facility: 'Ndola' })).toString()).toContain('%PDF');
  });
  it('options resolves select dropdowns from paramOptions queries', async () => {
    expect(await reporting.options('r1')).toEqual({ facility: ['Ndola', 'Lusaka'] });
  });
});
```

- [ ] **Step 2:** Run `pnpm --filter @openldr/bootstrap test reporting-data-driven` → FAIL (`buildReportingForTest` not exported).

- [ ] **Step 3: Implement.** Introduce a small factory `buildReportingForTest(deps)` that constructs the report-def branches given injected `reportDefs`, `reportDesigns`, `runStoredQuery`, `resolveDesignTables`, `renderReportDesignPdf`. In production the real `reporting` object calls the same branch functions before falling through to the catalog/template branches. Concretely, in `packages/bootstrap/src/index.ts`:

- Imports: `import { runStoredQuery, type RunStoredQueryDeps } from '@openldr/dashboards';` and `import { renderReportDesignPdf, resolveDesignTables } from '@openldr/report-designer';` and `import { createCustomQueryStore } from '@openldr/db';`.
- Move `const reportDefStore = createReportStore(internal.db);` and `const reportDesignStore = createReportDesignStore(internal.db);` **above** the `reporting` object.
- Build the run deps in bootstrap (connector runner comes from the workflow services, read at call time — mirrors `apps/server/src/app.ts`):

```ts
const reportRenderDeps: RunStoredQueryDeps = {
  customQueries: createCustomQueryStore(internal.db),
  runConnectorSql: (input) => {
    const run = workflowServices.runConnectorSql; // the same services object app.ts reads via ctx.workflows.services
    if (!run) throw new Error('connector SQL runner unavailable');
    return run(input);
  },
};
const runReportQuery = (queryId: string, values: Record<string, unknown>) => runStoredQuery(reportRenderDeps, queryId, values);
```

> Confirm the in-scope variable name for the workflow services (grep the assignment feeding `ctx.workflows.services` in `index.ts`) and reference it here. `runConnectorSql` is optional on the services type but always present in the server/bootstrap context.

- Add the branches (each returns early when the id is a report record):

```ts
const valuesOf = (rawParams: unknown) => (rawParams ?? {}) as Record<string, unknown>;

async function runDataDriven(id: string, rawParams: unknown): Promise<ReportResult> {
  const def = (await reportDefStore.get(id))!;
  const { columns, rows } = await runReportQuery(def.primaryQueryId, valuesOf(rawParams));
  const chart = (def.chart ?? { type: 'stat', value: String(rows.length), label: 'rows' }) as ReportResult['chart'];
  const cols = columns.map((c) => ({ key: c.key, label: c.label, kind: 'string' as const }));
  return { columns: cols, rows, chart, meta: { generatedAt: new Date().toISOString(), rowCount: rows.length } };
}
async function renderDataDriven(id: string, rawParams: unknown): Promise<Buffer> {
  const def = (await reportDefStore.get(id))!;
  const design = await reportDesignStore.get(def.designId);
  if (!design) throw new ReportNotFoundError(def.designId);
  const resolved = await resolveDesignTables(design, valuesOf(rawParams), runReportQuery);
  return renderReportDesignPdf(design, resolved);
}
async function optionsDataDriven(id: string): Promise<Record<string, string[]>> {
  const def = (await reportDefStore.get(id))!;
  const out: Record<string, string[]> = {};
  for (const [paramKey, queryId] of Object.entries(def.paramOptions ?? {})) {
    const { columns, rows } = await runReportQuery(queryId, {});
    const col = columns[0]?.key;
    out[paramKey] = col ? rows.map((r) => String(r[col])).filter((v) => v !== 'null' && v !== '') : [];
  }
  return out;
}
```

For `buildReportingForTest(deps)`, inject `reportDefs`/`reportDesigns` stores + `runStoredQuery`/`resolveDesignTables`/`renderReportDesignPdf` so the unit test drives the branches without a real DB/connector (the test in Step 1 passes fakes for exactly these).

Then thread them into the `reporting` object (report-def branch FIRST in each, since ids are disjoint):

```ts
async listAll() {
  const templates = (await reportTemplateStore.list()).filter(isPublished).map(templateToSummary);
  const defs = await reportDefStore.list();
  const defSummaries = await Promise.all(
    defs.filter((d) => d.status === 'published').map(async (d) => {
      const design = await reportDesignStore.get(d.designId);
      return design ? reportDefToSummary(d, design) : null;
    }),
  );
  return [...reportSummaries(), ...templates, ...defSummaries.filter(Boolean) as ReportSummary[]];
},
async findSummary(id) {
  const cat = reportSummaries().find((s) => s.id === id);
  if (cat) return cat;
  const def = await reportDefStore.get(id);
  if (def) { const design = await reportDesignStore.get(def.designId); if (design) return reportDefToSummary(def, design); }
  const t = await reportTemplateStore.get(id);
  return t && isPublished(t) ? templateToSummary(t) : undefined;
},
async run(id, rawParams) {
  if (await reportDefStore.get(id)) return runDataDriven(id, rawParams);
  if (await reportTemplateStore.get(id)) throw appError('RP0005', { message: `report is PDF-only: ${id}` });
  return runReport(id, rawParams);
},
async renderPdf(id, rawParams) {
  if (await reportDefStore.get(id)) return renderDataDriven(id, rawParams);
  const t = await reportTemplateStore.get(id);
  if (t && isPublished(t)) return renderReportTemplatePdf(t, (rawParams ?? {}) as Record<string, string>, runDashboardQuery);
  // …existing catalog branch unchanged…
},
async options(id) {
  if (await reportDefStore.get(id)) return optionsDataDriven(id);
  if (await reportTemplateStore.get(id)) return {};
  const def = getReport(id);
  if (!def) throw new ReportNotFoundError(id);
  return def.options ? def.options(reportingDb) : {};
},
```

Extract the five branch helpers + the `reporting` literal into `buildReportingForTest(deps)` so the unit test can inject fakes; the production call passes the real stores/functions. (Keep it in the same module; export the factory.)

- [ ] **Step 4:** Run `pnpm --filter @openldr/bootstrap test reporting-data-driven` → PASS (5 tests). Then `pnpm --filter @openldr/bootstrap test` → existing reporting/template tests still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/index.ts packages/bootstrap/src/reporting-data-driven.test.ts
git commit -m "feat(bootstrap): reporting service resolves data-driven reports (list/find/run/renderPdf/options)"
```

### Task 2.4: Manual live smoke + slice gate

- [ ] **Step 1:** Start dev stack (`docker compose up -d postgres`, `AUTH_DEV_BYPASS=true node dev.mjs`, vite studio). Seed one record by hand against an existing seeded design + a custom query (via `psql` or the CLI once S4 exists — for now insert a `reports` row referencing `rt-amr-summary` + any custom query id present).
- [ ] **Step 2:** `curl -s localhost:<api>/api/reports | jq '.[] | select(.source=="design")'` → the record appears with `parameters` derived from the design. `GET /api/reports/<id>` returns tabular rows; `GET /api/reports/<id>.pdf` returns a PDF; `GET /api/reports/<id>/options` returns the dropdowns.
- [ ] **Step 3:** Run `pnpm turbo run typecheck test --force` → green (ignore known flakes). Merge:

```bash
git checkout main && git merge --no-ff feat/reports-linking-s2 -m "S2: reporting service third source (data-driven reports)"
```

---

## Slice S3 — New-report dialog + designer shortcut

The `/reports` page already renders filters, both tabs, and the summary strip for any non-`builder` source (`isCustom = source === 'builder'` stays false for `'design'`). This slice only adds the **create** surface + a designer deep-link. It also adds a source badge to the library so data-driven reports are legible.

### Task 3.1: Studio `reportDefsApi` module

**Files:**
- Create: `apps/studio/src/reports/reportDefsApi.ts`
- Test: `apps/studio/src/reports/reportDefsApi.test.ts`

- [ ] **Step 1: Write the failing test** (mock `authFetch`; assert URL + method for list/create/remove — mirror an existing studio api test such as the report-designs api test).

```ts
// apps/studio/src/reports/reportDefsApi.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../auth/authFetch', () => ({ authFetch: vi.fn(async () => ({ ok: true, json: async () => [] })) }));
import { authFetch } from '../auth/authFetch';
import { listReportDefs, createReportDef, deleteReportDef } from './reportDefsApi';

describe('reportDefsApi', () => {
  beforeEach(() => vi.mocked(authFetch).mockClear());
  it('lists via GET /api/report-defs', async () => {
    await listReportDefs();
    expect(authFetch).toHaveBeenCalledWith('/api/report-defs');
  });
  it('creates via POST', async () => {
    await createReportDef({ id: 'r1' } as any);
    const [, init] = vi.mocked(authFetch).mock.calls[0];
    expect(init?.method).toBe('POST');
  });
  it('deletes via DELETE', async () => {
    await deleteReportDef('r1');
    const [url, init] = vi.mocked(authFetch).mock.calls[0];
    expect(url).toBe('/api/report-defs/r1');
    expect(init?.method).toBe('DELETE');
  });
});
```

> Match the real `authFetch` import path used across `apps/studio/src` (grep an existing `*Api.ts`). The sketch assumes `../auth/authFetch`.

- [ ] **Step 2:** Run `pnpm --filter @openldr/studio test reportDefsApi` → FAIL.

- [ ] **Step 3: Implement** (all calls use `authFetch`):

```ts
// apps/studio/src/reports/reportDefsApi.ts
import { authFetch } from '../auth/authFetch';

export interface ReportDefInput {
  id: string; name: string; description: string;
  category: 'amr' | 'operational' | 'quality' | 'regulatory';
  designId: string; primaryQueryId: string;
  summaryMetrics?: unknown[]; chart?: unknown; paramOptions?: Record<string, string>;
  status: 'draft' | 'published';
}
export interface ReportDefRecord extends ReportDefInput { createdAt?: string; updatedAt?: string; }

export async function listReportDefs(): Promise<ReportDefRecord[]> {
  const res = await authFetch('/api/report-defs');
  if (!res.ok) throw new Error(`report-defs ${res.status}`);
  return res.json();
}
export async function createReportDef(input: ReportDefInput): Promise<ReportDefRecord> {
  const res = await authFetch('/api/report-defs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  if (!res.ok) throw new Error(`create report-def ${res.status}`);
  return res.json();
}
export async function deleteReportDef(id: string): Promise<void> {
  const res = await authFetch(`/api/report-defs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error(`delete report-def ${res.status}`);
}
```

- [ ] **Step 4:** Run `pnpm --filter @openldr/studio test reportDefsApi` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports/reportDefsApi.ts apps/studio/src/reports/reportDefsApi.test.ts
git commit -m "feat(studio): reportDefsApi (authFetch) for report records"
```

### Task 3.2: New-report dialog (pick template → derived filters preview)

**Files:**
- Create: `apps/studio/src/reports/NewReportDialog.tsx`
- Modify: `apps/studio/src/pages/Reports.tsx` (`NewReportButton` opens `NewReportDialog` instead of `StarterGalleryDialog`)
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts` (add `reports.new.*` keys; keep `EnShape` parity)
- Test: `apps/studio/src/reports/NewReportDialog.test.tsx`

Fields: Name, Category (Select), Description, Template (Select over `fetchReportDesigns()` list), Primary query (Select over `queryApi.list()`, defaults to the chosen design's first bound table's `dataSource.queryId`), and a read-only "Filters this report will expose" list derived from the chosen design's `parameters`. On save → `createReportDef({ …, status: 'published' })` then navigate to `/reports` and refresh the list.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/studio/src/reports/NewReportDialog.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NewReportDialog } from './NewReportDialog';

vi.mock('./reportDefsApi', () => ({ createReportDef: vi.fn(async (x) => x) }));
vi.mock('../api', () => ({ fetchReportDesigns: vi.fn(async () => [
  { id: 'd1', name: 'AMR', parameters: [{ key: 'facility', label: 'Facility', type: 'select' }],
    pages: [{ id: 'p', elements: [{ id: 't', kind: 'table', dataSource: { kind: 'custom-query', queryId: 'q1' } }] }] },
]) }));
vi.mock('../query/api', () => ({ queryApi: { list: vi.fn(async () => [{ id: 'q1', name: 'AMR query' }]) } }));

describe('NewReportDialog', () => {
  it('previews the chosen template\'s filters', async () => {
    render(<NewReportDialog open onOpenChange={() => {}} onCreated={() => {}} />);
    // select template d1 (component auto-selects the first design on load)
    await waitFor(() => expect(screen.getByText('Facility')).toBeInTheDocument());
  });

  it('creates a published report on submit', async () => {
    const onCreated = vi.fn();
    const { createReportDef } = await import('./reportDefsApi');
    render(<NewReportDialog open onOpenChange={() => {}} onCreated={onCreated} />);
    await waitFor(() => screen.getByText('Facility'));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'AMR Resistance' } });
    fireEvent.click(screen.getByRole('button', { name: /create report/i }));
    await waitFor(() => expect(createReportDef).toHaveBeenCalledWith(expect.objectContaining({
      name: 'AMR Resistance', designId: 'd1', primaryQueryId: 'q1', status: 'published',
    })));
    expect(onCreated).toHaveBeenCalled();
  });
});
```

> Adjust selectors to the repo's shadcn Select testing pattern (grep an existing dialog test). Add `fetchReportDesigns` to `apps/studio/src/api.ts` if absent (mirror `fetchReports`, GET `/api/report-designs`).

- [ ] **Step 2:** Run `pnpm --filter @openldr/studio test NewReportDialog` → FAIL.

- [ ] **Step 3: Implement** `NewReportDialog.tsx` (shadcn Dialog/Select/Input/Button per [[use-shadcn-components]]; derive filter preview from the chosen design's `parameters`; default `primaryQueryId` to the design's first table `dataSource.queryId`). Swap `NewReportButton` in `Reports.tsx`:

```tsx
// in Reports.tsx NewReportButton
import { NewReportDialog } from '../reports/NewReportDialog';
// …
return (
  <>
    <Button size="sm" onClick={() => setOpen(true)}>{t('reports.new.button')}</Button>
    <NewReportDialog open={open} onOpenChange={setOpen} onCreated={() => fetchReports().then(setReports)} />
  </>
);
```

Pass an `onCreated` up so the library refetches (lift `setReports`/`fetchReports` or expose a refresh callback via props — keep the existing `NewReportButton` co-located in `Reports.tsx`, wiring `onCreated` to re-run the `fetchReports().then(setReports)` used on mount).

Add i18n keys to en/fr/pt: `reports.new.button` ("New report"), `reports.new.title`, `reports.new.subtitle`, `reports.new.name`, `reports.new.category`, `reports.new.description`, `reports.new.template`, `reports.new.primaryQuery`, `reports.new.filtersPreview`, `reports.new.create`, `reports.new.cancel`.

- [ ] **Step 4:** Run `pnpm --filter @openldr/studio test NewReportDialog && pnpm --filter @openldr/studio test i18n` (parity) → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports/NewReportDialog.tsx apps/studio/src/pages/Reports.tsx apps/studio/src/api.ts apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): New-report dialog links a template to a report"
```

### Task 3.3: Library source badge + designer "Edit template" deep-link

**Files:**
- Modify: `apps/studio/src/reports/ReportLibrary.tsx` (small source chip for `source === 'design'`)
- Modify: `apps/studio/src/reports/ReportActionsMenu.tsx` (add an "Edit template" item → `navigate('/report-designer/' + designId)`; needs `designId` on the summary — thread `selected`’s `designId` through, OR fetch it from `/api/report-defs/:id` on open)
- Modify: `apps/studio/src/report-designer/CanvasHeader.tsx` kebab (add "Publish as report" → opens `NewReportDialog` prefilled with the current design id)
- Test: extend `ReportActionsMenu.test.tsx` for the new item

> `ReportSummary` has no `designId`. Add an optional `designId?: string` to `ReportSummary` (reporting types) and set it in `reportDefToSummary` so the studio can deep-link without an extra round-trip. Update Task 2.2's mapping + test accordingly if implementing this item.

- [ ] **Step 1:** Write a failing test in `ReportActionsMenu.test.tsx` asserting an "Edit template" menu item appears and navigates to `/report-designer/<designId>` when `designId` is present.
- [ ] **Step 2:** Run `pnpm --filter @openldr/studio test ReportActionsMenu` → FAIL.
- [ ] **Step 3:** Add `designId?: string` to `ReportSummary` (`packages/reporting/src/types.ts`) + set it in `reportDefToSummary`; render the "Edit template" item (role-gated `lab_admin`/`lab_manager`) using [[ui-sidebar-collapse-icon]]-consistent icons; add the designer "Publish as report" kebab item.
- [ ] **Step 4:** Run `pnpm --filter @openldr/studio test ReportActionsMenu` → PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports/ReportLibrary.tsx apps/studio/src/reports/ReportActionsMenu.tsx apps/studio/src/reports/ReportActionsMenu.test.tsx apps/studio/src/report-designer/CanvasHeader.tsx packages/reporting/src/types.ts packages/bootstrap/src/index.ts
git commit -m "feat(studio): report source badge + template deep-link + publish-as-report shortcut"
```

### Task 3.4: Slice gate + merge

- [ ] Run `pnpm turbo run typecheck test --force` → green (ignore known flakes). Merge `--no-ff` to `main` as "S3: New-report dialog + designer shortcut".

---

## Slice S4 — migrate the 7 plain/CASE reports

Reproduce each built-in (except antibiogram) as a seeded custom query + template + report record. **Both paths coexist during S4**, so each migration's acceptance test is exact: *the data-driven output must equal the live catalog output* for the same params on the dev fixture.

### Task 4.1: Seed scaffolding — shared helpers + bootstrap wiring

**Files:**
- Create: `packages/reporting/src/seed/report-seeds.ts` (seed data: queries, designs, report records) + `packages/reporting/src/seed/simple-design.ts` (a `simpleTableDesign()` layout helper)
- Modify: `packages/bootstrap/src/index.ts` (seed on first run: insert seed custom queries, designs, and report records idempotently — mirror `seedReportDesigns`)
- Test: `packages/reporting/src/seed/simple-design.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/reporting/src/seed/simple-design.test.ts
import { describe, it, expect } from 'vitest';
import { simpleTableDesign } from './simple-design';

describe('simpleTableDesign', () => {
  it('builds a one-table A4 design bound to a query with a title, date and params', () => {
    const d = simpleTableDesign({
      id: 'rt-amr-resistance', name: 'AMR Resistance Rate', queryId: 'q-amr-resistance',
      columns: [{ key: 'antibiotic', label: 'Antibiotic' }, { key: 'percentR', label: '%R' }],
      parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange' }, { key: 'facility', label: 'Facility', type: 'select' }],
    });
    expect(d.pages[0].elements.some((e) => e.kind === 'table' && e.dataSource?.queryId === 'q-amr-resistance')).toBe(true);
    const table = d.pages[0].elements.find((e) => e.kind === 'table')!;
    expect(table.boundColumns).toEqual([{ key: 'antibiotic', label: 'Antibiotic' }, { key: 'percentR', label: '%R' }]);
    expect(d.parameters).toHaveLength(2);
  });
});
```

- [ ] **Step 2:** Run `pnpm --filter @openldr/reporting test simple-design` → FAIL.

- [ ] **Step 3: Implement** `simple-design.ts`:

```ts
// packages/reporting/src/seed/simple-design.ts
import type { ReportDesign } from '@openldr/report-designer/pure';

export interface SimpleDesignSpec {
  id: string; name: string; queryId: string;
  columns: { key: string; label: string }[];
  parameters: ReportDesign['parameters'];
  paper?: 'A4' | 'Letter'; orientation?: 'portrait' | 'landscape';
}

export function simpleTableDesign(spec: SimpleDesignSpec): ReportDesign {
  return {
    id: spec.id, name: spec.name, paper: spec.paper ?? 'A4', orientation: spec.orientation ?? 'portrait',
    parameters: spec.parameters,
    pages: [{ id: `${spec.id}-p1`, elements: [
      { id: `${spec.id}-title`, kind: 'text', name: 'Title', rect: { x: 48, y: 40, w: 600, h: 28 }, text: spec.name, style: { fontSize: 18, bold: true } },
      { id: `${spec.id}-date`, kind: 'datetime', name: 'Generated', rect: { x: 48, y: 74, w: 400, h: 18 }, text: 'Generated {{date}}' },
      { id: `${spec.id}-table`, kind: 'table', name: 'Data', rect: { x: 48, y: 120, w: 700, h: 560 },
        dataSource: { kind: 'custom-query', queryId: spec.queryId },
        boundColumns: spec.columns },
    ] }],
    pageNumbers: true,
  };
}
```

`report-seeds.ts` exports `SEED_QUERIES: NewCustomQuery[]`, `SEED_DESIGNS: ReportDesign[]`, `SEED_REPORT_DEFS: ReportRecord[]` (filled per report in 4.2–4.8). In bootstrap, add a `seedDataDrivenReports(ctx)` that idempotently `create`s each (skip if `get(id)` exists), called from the same first-run seed path as `seedReportDesigns`. **Remove the `seedReportDesigns` call for the three demo designs** (per decision D — see Task 5.4).

- [ ] **Step 4:** Run `pnpm --filter @openldr/reporting test simple-design` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/reporting/src/seed/simple-design.ts packages/reporting/src/seed/simple-design.test.ts packages/reporting/src/seed/report-seeds.ts packages/bootstrap/src/index.ts
git commit -m "feat(reporting): data-driven report seed scaffolding (simpleTableDesign + seed wiring)"
```

### Task 4.2: `amr-resistance` — worked example (query + design + record + parity)

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts` (append the three seed objects)
- Test: `packages/reporting/src/seed/amr-resistance-parity.test.ts` (parity against the live catalog run)

The catalog logic (see `reports/amr-resistance.ts`): from `observations` where `interpretation_code in ('S','I','R')`, group by `code_text` (antibiotic) × interpretation, optionally filtered by `effective_date_time` between `from`/`to` and by facility (patients whose `managing_organization = facility`, mapped to `subject_ref = 'Patient/'||id`). Output columns: `antibiotic, tested, r, i, s, percentR`.

- [ ] **Step 1: Write the failing parity test** (runs both paths against the dev-seeded analytics DB; skip if no PG)

```ts
// packages/reporting/src/seed/amr-resistance-parity.test.ts
import { describe, it, expect } from 'vitest';
// Harness: open an AppContext against the dev analytics DB, run BOTH the catalog and the
// data-driven path for the same params, assert equal rows. Mirror any existing reporting
// integration test in this repo (search for tests that call reporting.run against Postgres).
// If none exists / no PG in CI, mark it it.skip and rely on the live smoke in Task 4.9.
it.skip('amr-resistance data-driven output equals catalog output', async () => {
  // const ctx = await createAppContext(loadConfig());
  // const cat = await ctx.reporting.run('amr-resistance', { from: '2026-01-01', to: '2026-06-30' });
  // const dd  = await ctx.reporting.run('r-amr-resistance', { from: '2026-01-01', to: '2026-06-30' });
  // expect(dd.rows).toEqual(cat.rows);
  expect(true).toBe(true);
});
```

- [ ] **Step 2:** Run `pnpm --filter @openldr/reporting test amr-resistance-parity` → PASS (skipped) — placeholder until the live smoke.

- [ ] **Step 3: Add the seed objects** to `report-seeds.ts`:

```ts
// SEED_QUERIES += :
{
  id: 'q-amr-resistance', name: 'AMR resistance rate', connectorId: 'analytics',
  params: [
    { id: 'dateRange', label: 'Date range', type: 'daterange', required: false },
    { id: 'facility', label: 'Facility', type: 'select', required: false },
  ],
  sql: `
    select code_text as antibiotic,
      count(*) as tested,
      sum(case when interpretation_code = 'R' then 1 else 0 end) as r,
      sum(case when interpretation_code = 'I' then 1 else 0 end) as i,
      sum(case when interpretation_code = 'S' then 1 else 0 end) as s,
      round(100.0 * sum(case when interpretation_code = 'R' then 1 else 0 end) / nullif(count(*),0), 1) as "percentR"
    from observations o
    where interpretation_code in ('S','I','R')
      {{param.from}}  -- expands only if provided; see note
    group by code_text
    order by code_text`,
},
```

> **Param-in-WHERE note:** `substituteParams` replaces `{{param.from}}` with a quoted literal, not a clause. For optional range/facility filters, author the SQL so the token sits inside a comparison that is inert when unset. Two accepted patterns in this repo's custom queries: (a) require the params (simplest — the filter bar marks them required), or (b) use a coalesce guard, e.g. `and (o.effective_date_time >= {{param.from}} or {{param.from}} is null)` **won't** work because an unset token throws "unbound". Therefore: **declare each filter `required: false` but include its token only inside a fragment that the seed SQL always supplies a value for**, OR make the report's filters required. **Decision for the seeds: make `from`/`to` optional by splitting into two stored queries is overkill — instead require the date range** (set `required: true` on the daterange param and mark the filter required in the design param via `required: true`). Facility: model as an equality that is applied only when the value is non-empty by using `where (code_text is not null) and ({{param.facility}} = '' or o.subject_ref in (select 'Patient/'||id from patients where managing_organization = {{param.facility}}))` — pass `facility=''` by default from the seed's design param so the token always binds. Validate the exact behavior against `substituteParams` in Task 4.9 live smoke and adjust.

```ts
// SEED_DESIGNS += simpleTableDesign({
//   id: 'rt-amr-resistance', name: 'AMR Resistance Rate', queryId: 'q-amr-resistance',
//   columns: [ {key:'antibiotic',label:'Antibiotic'}, {key:'tested',label:'Tested'},
//     {key:'r',label:'R'}, {key:'i',label:'I'}, {key:'s',label:'S'}, {key:'percentR',label:'%R'} ],
//   parameters: [ {key:'dateRange',label:'Date range',type:'daterange',required:true},
//     {key:'facility',label:'Facility',type:'select'} ],
// })

// SEED_REPORT_DEFS += {
//   id: 'r-amr-resistance', name: 'AMR Resistance Rate',
//   description: 'Resistant/Intermediate/Susceptible counts and %R by antibiotic.',
//   category: 'amr', designId: 'rt-amr-resistance', primaryQueryId: 'q-amr-resistance',
//   summaryMetrics: [ {id:'antibiotics',label:'Antibiotics',type:'count'}, {id:'avgR',label:'Avg %R',type:'avg',column:'percentR'} ],
//   chart: { type: 'bar', x: 'antibiotic', y: 'percentR' },
//   paramOptions: { facility: 'q-facilities' }, status: 'published',
// }
```

Also add the shared `q-facilities` options query (one column of facility names) to `SEED_QUERIES` (used by every facility filter): `select distinct managing_organization as facility from patients where managing_organization is not null order by 1`.

> The `connectorId: 'analytics'` must match the seeded analytics connector id in this repo — confirm via the connectors seed (search for the default connector id used by `/query` against the analytics warehouse) and use that exact id in every seed query.

- [ ] **Step 4:** Run `pnpm --filter @openldr/reporting test` → PASS (parity skipped). `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts packages/reporting/src/seed/amr-resistance-parity.test.ts
git commit -m "feat(reporting): seed amr-resistance as query+template+report"
```

### Tasks 4.3–4.8: the remaining six reports

For **each** of `amr-facility-summary`, `amr-glass-ris`, `amr-first-isolate-summary`, `test-volume`, `turnaround-time`, `patient-demographics`, do exactly what Task 4.2 did, using that report's source file as the exact behavioral spec:

- [ ] **Step 1:** Read `packages/reporting/src/reports/<id>.ts`. Note its output `columns` (keys + labels), its `parameters`, its `summaryMetrics`, its `chart`, and the `ExternalSchema` tables/columns its `run()` reads.
- [ ] **Step 2:** Write a `{{param.*}}`-parameterized SELECT (Postgres, `analytics` connector) that reproduces those exact columns. Use CASE conditional aggregates for any JS pivot; a CTE + `row_number()`/`distinct on` for first-isolate/dedup logic; `date_part`/`percentile_cont` for TAT; `case … end` age bands for demographics. Keep result column keys identical to the catalog columns so `boundColumns`, `summaryMetrics.column`, and `chart.x/y` line up.
- [ ] **Step 3:** Append the query to `SEED_QUERIES`, a `simpleTableDesign(...)` to `SEED_DESIGNS` (Letter/landscape for wide ones like GLASS/facility-summary), and a record to `SEED_REPORT_DEFS` carrying the source report's `category`, `summaryMetrics`, `chart`, and `paramOptions` (facility → `q-facilities` where the source had a facility select).
- [ ] **Step 4:** Add `<id>-parity.test.ts` mirroring 4.2 (skipped-by-default equality assertion documenting the params to compare).
- [ ] **Step 5:** Run `pnpm --filter @openldr/reporting test` → PASS; commit `feat(reporting): seed <id> as query+template+report`.

Per-report column/param reference (from the source files; confirm each when you open it):

| id | key columns (must match) | params | chart | metrics |
|---|---|---|---|---|
| `amr-facility-summary` | facility, tested, r, percentR (+ per source) | daterange | bar facility→percentR | count facilities |
| `amr-glass-ris` | pathogen, antibiotic, r, i, s, tested (GLASS shape) | daterange | (per source) | (per source) |
| `amr-first-isolate-summary` | organism, isolates, … (first isolate per patient) | daterange | (per source) | count |
| `test-volume` | period/test, count | daterange | bar/line period→count | sum count |
| `turnaround-time` | analyte, median, p90 (hours) | daterange | (per source) | avg |
| `patient-demographics` | ageBand, sex, count | daterange | bar ageBand→count | count |

### Task 4.9: Live parity smoke + slice gate

- [ ] **Step 1:** Dev stack up; `openldr` seed runs on boot. For each migrated report, `curl GET /api/reports/<catalog-id>` and `GET /api/reports/r-<id>` with the same params and diff the JSON `rows` (jq). Fix SQL until they match. Verify `GET /api/reports/r-<id>.pdf` renders and `/options` returns facility values.
- [ ] **Step 2:** Un-skip the parity tests you can run against dev PG locally; leave `it.skip` for any that need fixtures CI lacks (documented).
- [ ] **Step 3:** `pnpm turbo run typecheck test --force` → green. Merge `--no-ff` as "S4: migrate 7 plain/CASE reports to data-driven".

---

## Slice S5 — re-point consumers, then delete the catalog (hard gate)

**Do not start until S4's live parity smoke passes for all 7.** This removes the code path other systems depend on.

### Task 5.1: Inventory + re-point report consumers

**Files:**
- Modify: whichever files call `ctx.reporting.run` / `getReport` / `reportCatalog` / `reportSummaries` / `runEventSource` / `eventSources` for the catalog reports.

- [ ] **Step 1:** `grep -rn "getReport\|reportCatalog\|reportSummaries\|dispatchReportSource\|runEventSource\|eventSources" packages apps --include=*.ts` (exclude tests). Enumerate every consumer.
- [ ] **Step 2:** For the **DHIS2 push path** (`dispatchReportSource`) and **event sources**: if they need a specific report's data, point them at the equivalent data-driven report id (`r-<id>`) via `ctx.reporting.run`, or preserve just the specific `EventSource` definitions they require in `@openldr/reporting` (event sources are a separate catalog from `ReportDefinition` — keep `eventSourceCatalog()` if still used). Write/adjust a test per consumer proving it still returns data after the switch.
- [ ] **Step 3:** Commit `refactor: re-point report consumers to data-driven / event-source path`.

### Task 5.2: Delete the `ReportDefinition` catalog

**Files:**
- Delete: `packages/reporting/src/reports/{amr-resistance,amr-facility-summary,amr-glass-ris,amr-first-isolate-summary,test-volume,turnaround-time,patient-demographics}.ts` (leave `amr-antibiogram.ts` until S6) + their tests.
- Modify: `packages/reporting/src/catalog.ts` (remove the deleted imports; `reportCatalog()`/`reportSummaries()`/`getReport()` shrink to just antibiogram for now — or, if S6 lands first, delete entirely).
- Modify: `packages/bootstrap/src/index.ts` (remove the catalog branches from `run`/`renderPdf`/`options`/`listAll`/`findSummary` once no catalog reports remain — after S6).

- [ ] **Step 1:** Delete the seven report files + tests.
- [ ] **Step 2:** Fix `catalog.ts` imports. Keep `getReport`/`reportCatalog` returning only `amrAntibiogram` for now.
- [ ] **Step 3:** Run `pnpm turbo run typecheck test --force`. Fix every reference the compiler flags (this is the safety net — TS makes the cutover mechanical).
- [ ] **Step 4:** Commit `feat(reporting): retire 7 hardcoded report definitions (data-driven cutover)`.

### Task 5.3: Remove the New-builder starter path if now unused

- [ ] **Step 1:** Confirm `StarterGalleryDialog` / `/reports/builder/new` are no longer the report-creation entry (S3 replaced the New button). If the builder workstream is otherwise retired, leave its code but ensure `/reports` no longer routes to it. (Do NOT delete `@openldr/report-builder` — the builder-template source in `ctx.reporting` is separate and out of scope.)
- [ ] **Step 2:** Commit if anything changed.

### Task 5.4: Drop the 3 demo designs (decision D)

- [ ] **Step 1:** In the seed path, stop seeding `rt-amr-summary` / `rt-monthly-caseload` / `rt-lab-tat` (remove from `SEED_DESIGNS` in `@openldr/report-designer` or skip them in the bootstrap seed call). Add a one-shot idempotent cleanup that deletes those three design ids **only if no report record references them** (guard against deleting a design a user linked). Log what was removed ([[fresh-install-defaults]] care).
- [ ] **Step 2:** Test the cleanup guard (skips deletion when a `reports` row references the id).
- [ ] **Step 3:** Commit `chore(report-designer): remove demo seed designs`.

### Task 5.5: Slice gate + merge

- [ ] `pnpm turbo run typecheck test --force` → green. Live smoke: fresh dev DB → boot seeds 7 data-driven reports (+ antibiogram still code until S6) → `/reports` lists them → each runs. Merge `--no-ff` as "S5: cutover — delete catalog, re-point consumers".

---

## Slice S6 — antibiogram (fixed panel), migrated last

Reproduce `amr-antibiogram` (see `reports/amr-antibiogram.ts`: first-isolate dedup → pathogen×antibiotic matrix, cell = `"{percentR}% ({tested})"`). Columns become a **fixed antibiotic panel** (CASE columns) instead of the data-dependent union.

### Task 6.1: Choose the antibiotic panel

- [ ] **Step 1:** From the dev analytics DB, list the antibiotics actually present: `select distinct code_text from observations where interpretation_code in ('S','I','R') order by 1`. Pick the standard WHONET panel intersection (document the chosen list as a constant `ANTIBIOGRAM_PANEL` in `report-seeds.ts`).
- [ ] **Step 2:** Commit the constant + a comment explaining the fidelity trade-off vs the old dynamic columns.

### Task 6.2: Antibiogram seed query (fixed-panel CASE matrix + first-isolate CTE)

**Files:** `packages/reporting/src/seed/report-seeds.ts`, `packages/reporting/src/seed/amr-antibiogram-parity.test.ts`

- [ ] **Step 1:** Write the parity test (skipped-by-default): assert the data-driven antibiogram rows match the catalog antibiogram **restricted to the panel columns** for a fixed date range.
- [ ] **Step 2:** Author the SQL: a CTE `first_isolate` selecting one isolate per patient (`distinct on (patient, organism) … order by effective_date_time`), then `group by pathogen` with, per panel antibiotic `A`, two aggregates folded into one text cell:

```sql
-- per antibiotic A in ANTIBIOGRAM_PANEL, generate a column:
case when count(*) filter (where antibiotic = 'A') = 0 then ''
     else round(100.0 * count(*) filter (where antibiotic = 'A' and interpretation_code='R')
               / nullif(count(*) filter (where antibiotic = 'A'),0)) || '% ('
          || count(*) filter (where antibiotic = 'A') || ')' end as "A"
```

(Generate the CASE columns for the panel; keep the first column `pathogen`.)
- [ ] **Step 3:** Add `simpleTableDesign` (Letter landscape) with `boundColumns` = `pathogen` + panel; add the report record (`category:'amr'`, `chart:{type:'stat',value:'',label:'pathogens'}` — or a count metric; the stat chart's `value` is derived at render from row count, so prefer `summaryMetrics:[{id:'pathogens',label:'Pathogens',type:'count'}]`).
- [ ] **Step 4:** `pnpm --filter @openldr/reporting test` → PASS.
- [ ] **Step 5:** Commit `feat(reporting): seed amr-antibiogram as fixed-panel query+template+report`.

### Task 6.3: Delete the antibiogram code + finish catalog removal

- [ ] **Step 1:** Live smoke: compare data-driven antibiogram to the catalog antibiogram on the panel columns; adjust SQL until faithful. **If the fixed panel is judged too lossy, STOP and invoke the documented fallback** — keep `amr-antibiogram.ts` as the lone catalog report and leave the catalog machinery minimal (do not delete the last catalog branch). Record the decision in the memory note.
- [ ] **Step 2 (full cutover path):** Delete `reports/amr-antibiogram.ts` + test, delete `catalog.ts` entirely (or reduce to nothing), and remove the now-dead catalog branches in `packages/bootstrap/src/index.ts` (`runReport`, `getReport`, `reportSummaries` imports; `list()` now returns `[]` or is removed; `run`/`renderPdf`/`options` lose their final catalog fallback). TS compiler flags every dangling reference.
- [ ] **Step 3:** `pnpm turbo run typecheck test --force` → green.
- [ ] **Step 4:** Commit `feat(reporting): retire antibiogram catalog report — reports fully data-driven`.

### Task 6.4: Final gate + merge + memory

- [ ] **Step 1:** Full live smoke: fresh dev DB → all 8 reports seeded as data-driven → each lists, filters, runs (PDF + Spreadsheet + strip), records run-history, schedules. Compare each report's numbers to a pre-cutover reference.
- [ ] **Step 2:** `pnpm turbo run typecheck test --force` + `turbo run build` (studio/server/web clean; `@openldr/cli#build` Windows esbuild/ssh2 flake is expected — ignore).
- [ ] **Step 3:** Merge `--no-ff` as "S6: antibiogram data-driven — reports fully data-driven".
- [ ] **Step 4:** Update the memory note `reports-page-custom-queries-templates.md` → DONE (record the antibiogram outcome: fixed panel vs fallback) and add a `reports-template-linking` topic note.

---

## Deferred (S7 — separate plan)

Metrics/chart **editor** in the New/Edit-report dialog (author-your-own on a user-created report). Until then, user-created reports have no summary strip/chart unless edited via CLI/API; the eight seeded reports carry theirs. Also deferred: non-Postgres connectors, report/template versioning, one-template-many-reports UX affordances.
