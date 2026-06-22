# Reports Page — Corlix Parity SP-2 (Run History) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every report run and export in an internal `report_runs` table and surface them in a shared **Run History** drawer (opened from the report's 3-dot menu) where clicking a past run re-applies its parameters.

**Architecture:** A new internal-Postgres table + `ReportRunStore` (`packages/db`) exposed as `ctx.reportRuns`. Two routes: a `POST /api/reports/:id/runs` beacon (the browser reports each explicit action; the server stamps the authenticated user) and a `GET /api/reports/runs` list. The frontend logs four actions (preview/csv/pdf/xlsx), opens a `ReportHistoryDrawer` (shadcn `Sheet`), and — as part of this work — fixes the CSV export to use `authFetch`→blob so it works under real auth and is attributable.

**Tech Stack:** TypeScript, Kysely (+ pg-mem for tests), Fastify, Zod, React, react-i18next, shadcn/Radix, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-22-reports-page-sp2-run-history-design.md`

**Conventions (read before starting):**
- Internal migrations: `packages/db/src/migrations/internal/NNN_name.ts` with `up`/`down`, registered in `migrations/internal/index.ts`. Tables typed in `packages/db/src/schema/internal.ts` (use `Generated<Date>` for `created_at` with a `now()` default, `JSONColumnType<...>` for jsonb). Store modules are `packages/db/src/<name>-store.ts`, exported via `packages/db/src/index.ts` (`export * from './<name>-store'`).
- Store tests use `makeMigratedDb()` from `./migrations/internal/test-helpers` (applies all internal migrations to a pg-mem db).
- `req.user` is augmented on `FastifyRequest` (auth-plugin.ts): `{ id, username, displayName, roles, status } | undefined`. All `/api/*` routes are authenticated globally; `reports-routes.ts` adds no role gating (shared visibility).
- Web: shadcn primitives from `@/components/ui/*`; component tests use side-effect `import '@/i18n'`; scope a single web test with `npx vitest run <path>` from `apps/web`. Web `lint` is a no-op (typecheck is the static gate). i18n parity across en/fr/pt is enforced by `apps/web/src/i18n/parity.test.ts`.
- Gate after each task/batch: `pnpm -w turbo typecheck lint test build`; web suite may parallel-flake (Dhis2/Terminology) — re-run `pnpm --filter @openldr/web test` in isolation.

---

## Task 1: Internal table — `report_runs` (migration + schema type)

**Files:**
- Create: `packages/db/src/migrations/internal/025_report_runs.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/schema/internal.ts`
- Test: `packages/db/src/migrations/internal/025_report_runs.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/migrations/internal/025_report_runs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { internalMigrations } from './index';
import { makeMigratedDb } from './test-helpers';

describe('025_report_runs migration', () => {
  it('is registered in the internal migration set', () => {
    expect(internalMigrations['025_report_runs']).toBeDefined();
  });

  it('creates a writable report_runs table', async () => {
    const db = await makeMigratedDb();
    await db
      .insertInto('report_runs')
      .values({
        id: 'r1', report_id: 'amr-resistance', report_name: 'AMR Resistance Rate',
        format: 'preview', params: { from: '2026-01-01' }, row_count: 3,
        user_id: 'u1', user_name: 'ada',
      })
      .execute();
    const rows = await db.selectFrom('report_runs').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.report_id).toBe('amr-resistance');
    expect(rows[0]!.params).toEqual({ from: '2026-01-01' });
    await db.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/db test -- 025_report_runs.test.ts`
Expected: FAIL — migration not registered / table missing.

- [ ] **Step 3: Create the migration**

Create `packages/db/src/migrations/internal/025_report_runs.ts`:

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('report_runs')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('report_id', 'text', (c) => c.notNull())
    .addColumn('report_name', 'text', (c) => c.notNull())
    .addColumn('format', 'text', (c) => c.notNull())
    .addColumn('params', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('row_count', 'integer')
    .addColumn('user_id', 'text')
    .addColumn('user_name', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('report_runs_report_created_idx')
    .ifNotExists()
    .on('report_runs')
    .columns(['report_id', 'created_at desc'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('report_runs').ifExists().execute();
}
```

- [ ] **Step 4: Register the migration**

In `packages/db/src/migrations/internal/index.ts`: add the import after the `m024` import and the map entry after the `'024_plugin_registry'` entry.

Import line:
```ts
import * as m025 from './025_report_runs';
```
Map entry (inside `internalMigrations`):
```ts
  '025_report_runs': { up: m025.up, down: m025.down },
```

- [ ] **Step 5: Add the table type**

In `packages/db/src/schema/internal.ts`: add the interface (near the other table interfaces; place it after `UserProfilesTable`):

```ts
export interface ReportRunsTable {
  id: string;
  report_id: string;
  report_name: string;
  format: string;
  params: JSONColumnType<Record<string, unknown>>;
  row_count: number | null;
  user_id: string | null;
  user_name: string | null;
  created_at: Generated<Date>;
}
```

And add to the `InternalSchema` interface (after `user_profiles: UserProfilesTable;` or alongside the others):
```ts
  report_runs: ReportRunsTable;
```
(`Generated` and `JSONColumnType` are already imported at the top of internal.ts.)

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @openldr/db test -- 025_report_runs.test.ts`
Expected: PASS. Then `pnpm --filter @openldr/db typecheck` — clean.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/migrations/internal/025_report_runs.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts packages/db/src/migrations/internal/025_report_runs.test.ts
git commit -m "feat(db): report_runs internal table (migration 025 + schema type)"
```

---

## Task 2: `ReportRunStore`

**Files:**
- Create: `packages/db/src/report-run-store.ts`
- Modify: `packages/db/src/index.ts` (barrel export)
- Test: `packages/db/src/report-run-store.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/report-run-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createReportRunStore } from './report-run-store';

describe('report run store', () => {
  it('records runs and lists them newest-first with paging + total', async () => {
    const db = await makeMigratedDb();
    const store = createReportRunStore(db);

    for (let i = 0; i < 3; i++) {
      await store.record({
        reportId: 'amr-resistance', reportName: 'AMR Resistance Rate',
        format: 'preview', params: { n: String(i) }, rowCount: i,
        userId: 'u1', userName: 'ada',
      });
    }
    await store.record({
      reportId: 'test-volume', reportName: 'Test Volume',
      format: 'csv', params: {}, rowCount: 9, userId: 'u1', userName: 'ada',
    });

    const all = await store.list({ limit: 10, offset: 0 });
    expect(all.total).toBe(4);
    expect(all.runs).toHaveLength(4);
    // newest first: the last inserted (test-volume csv) comes first
    expect(all.runs[0]!.reportId).toBe('test-volume');

    const filtered = await store.list({ reportId: 'amr-resistance', limit: 10, offset: 0 });
    expect(filtered.total).toBe(3);
    expect(filtered.runs.every((r) => r.reportId === 'amr-resistance')).toBe(true);

    const page = await store.list({ reportId: 'amr-resistance', limit: 2, offset: 0 });
    expect(page.runs).toHaveLength(2);
    expect(page.total).toBe(3);

    expect(filtered.runs[0]!.params).toEqual({ n: '2' });
    await db.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/db test -- report-run-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `packages/db/src/report-run-store.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export type ReportRunFormat = 'preview' | 'csv' | 'pdf' | 'xlsx';

export interface ReportRunRecord {
  id: string;
  reportId: string;
  reportName: string;
  format: ReportRunFormat;
  params: Record<string, unknown>;
  rowCount: number | null;
  userId: string | null;
  userName: string | null;
  createdAt: Date;
}

export interface NewReportRun {
  reportId: string;
  reportName: string;
  format: ReportRunFormat;
  params: Record<string, unknown>;
  rowCount: number | null;
  userId: string | null;
  userName: string | null;
}

export interface ReportRunStore {
  record(run: NewReportRun): Promise<void>;
  list(opts: { reportId?: string; limit: number; offset: number }):
    Promise<{ runs: ReportRunRecord[]; total: number }>;
}

function toRecord(r: {
  id: string; report_id: string; report_name: string; format: string;
  params: Record<string, unknown>; row_count: number | null;
  user_id: string | null; user_name: string | null; created_at: Date;
}): ReportRunRecord {
  return {
    id: r.id, reportId: r.report_id, reportName: r.report_name,
    format: r.format as ReportRunFormat, params: r.params ?? {},
    rowCount: r.row_count, userId: r.user_id, userName: r.user_name,
    createdAt: r.created_at,
  };
}

export function createReportRunStore(db: Kysely<InternalSchema>): ReportRunStore {
  return {
    async record(run) {
      await db
        .insertInto('report_runs')
        .values({
          id: randomUUID(),
          report_id: run.reportId,
          report_name: run.reportName,
          format: run.format,
          params: run.params,
          row_count: run.rowCount,
          user_id: run.userId,
          user_name: run.userName,
        })
        .execute();
    },
    async list({ reportId, limit, offset }) {
      let q = db.selectFrom('report_runs');
      if (reportId) q = q.where('report_id', '=', reportId);
      const rows = await q
        .selectAll()
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset)
        .execute();

      let cq = db.selectFrom('report_runs').select((eb) => eb.fn.countAll<number>().as('total'));
      if (reportId) cq = cq.where('report_id', '=', reportId);
      const countRow = await cq.executeTakeFirst();

      return { runs: rows.map(toRecord), total: Number(countRow?.total ?? 0) };
    },
  };
}
```

> Note: pg-mem returns `created_at` in insertion order for equal timestamps, and `now()` resolves per-statement, so newest-first ordering on `created_at desc` is stable enough for the test (4 sequential inserts). The `eb.fn.countAll` pattern matches `amr-resistance.ts`.

- [ ] **Step 4: Barrel export**

In `packages/db/src/index.ts`, add (near the other `export * from './*-store'` lines):
```ts
export * from './report-run-store';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @openldr/db test -- report-run-store.test.ts`
Expected: PASS. Then `pnpm --filter @openldr/db typecheck` — clean.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/report-run-store.ts packages/db/src/report-run-store.test.ts packages/db/src/index.ts
git commit -m "feat(db): ReportRunStore (record + paginated list)"
```

---

## Task 3: Expose `ctx.reportRuns`

**Files:**
- Modify: `packages/bootstrap/src/index.ts`

- [ ] **Step 1: Add to AppContext + construct it**

In `packages/bootstrap/src/index.ts`:
- Add `createReportRunStore` (and the type if needed) to the existing `@openldr/db` import. Find the line importing from `@openldr/db` and add `createReportRunStore, type ReportRunStore` to it. (If db symbols are imported across multiple lines, add to whichever names-import is present.)
- In the `AppContext` interface, add (near `audit`/`users`):
```ts
  reportRuns: ReportRunStore;
```
- In `createAppContext`, after `const audit = createAuditStore(internal.db);` (or near the other store constructions), add:
```ts
  const reportRuns = createReportRunStore(internal.db);
```
- Add `reportRuns,` to the returned context object (the object literal that returns `{ logger, auth, ..., reporting, ... }`).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @openldr/bootstrap typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): expose ctx.reportRuns"
```

---

## Task 4: Routes — record beacon + history list

**Files:**
- Modify: `apps/server/src/reports-routes.ts`
- Test: `apps/server/src/reports-routes.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

The test file builds an app via a helper (read the existing file to match its `appWith`/stub style). ADD this describe block. It must stub `ctx.reportRuns` (record + list), `ctx.reporting.list()` to resolve the report name, and inject a `req.user` via an `onRequest` hook before `registerReportRoutes`.

```ts
describe('report run history routes', () => {
  function appWithRuns() {
    const recorded: unknown[] = [];
    const ctx = {
      reporting: {
        list: () => [{ id: 'amr-resistance', name: 'AMR Resistance Rate', description: '', category: 'amr', parameters: [] }],
        run: async () => ({ columns: [], rows: [], chart: { type: 'stat', value: '0', label: 'x' }, meta: { generatedAt: '', rowCount: 0 } }),
        renderPdf: async () => Buffer.from(''),
        options: async () => ({}),
      },
      reportRuns: {
        record: async (r: unknown) => { recorded.push(r); },
        list: async () => ({ runs: [{ id: 'r1', reportId: 'amr-resistance', reportName: 'AMR Resistance Rate', format: 'preview', params: {}, rowCount: 1, userName: 'ada', createdAt: new Date('2026-01-01') }], total: 1 }),
      },
    } as unknown as Parameters<typeof registerReportRoutes>[1];

    const app = Fastify();
    app.addHook('onRequest', async (req) => {
      (req as { user?: unknown }).user = { id: 'u1', username: 'ada', displayName: 'Ada', roles: [], status: 'active' };
    });
    registerReportRoutes(app, ctx);
    return { app, recorded };
  }

  it('POST /api/reports/:id/runs records with the stamped user + resolved name', async () => {
    const { app, recorded } = appWithRuns();
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/api/reports/amr-resistance/runs',
      payload: { format: 'preview', rowCount: 3, params: { from: '2026-01-01' } },
    });
    expect(res.statusCode).toBe(201);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      reportId: 'amr-resistance', reportName: 'AMR Resistance Rate',
      format: 'preview', rowCount: 3, userId: 'u1', userName: 'ada',
    });
    await app.close();
  });

  it('POST rejects an invalid format with 400', async () => {
    const { app } = appWithRuns();
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/reports/amr-resistance/runs', payload: { format: 'nope' } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('POST unknown report id → 404', async () => {
    const { app } = appWithRuns();
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/reports/does-not-exist/runs', payload: { format: 'preview' } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('GET /api/reports/runs returns { runs, total }', async () => {
    const { app } = appWithRuns();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/reports/runs?reportId=amr-resistance&limit=10' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 1 });
    expect(res.json().runs).toHaveLength(1);
    await app.close();
  });
});
```

(If the existing file's stub doesn't include `options`/`list`, ensure the new stub is self-contained as above. Import `Fastify` at the top if not already imported.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/server test -- reports-routes.test.ts`
Expected: FAIL — routes return 404 / record undefined.

- [ ] **Step 3: Implement the routes**

In `apps/server/src/reports-routes.ts`:
- Add `z` to the existing `zod` import: change `import { ZodError } from 'zod';` to `import { z, ZodError } from 'zod';`.
- Add a body schema near the top of the file (after imports):
```ts
const runBeaconBody = z.object({
  format: z.enum(['preview', 'csv', 'pdf', 'xlsx']),
  rowCount: z.number().int().nullable().optional(),
  params: z.record(z.string()).optional(),
});
```
- Inside `registerReportRoutes`, add these two routes BEFORE the bare `app.get('/api/reports/:id', ...)` route (so `runs`/`:id/runs` resolve correctly):

```ts
  app.get('/api/reports/runs', async (req) => {
    const q = req.query as { reportId?: string; limit?: string; offset?: string };
    const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 200);
    const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
    return ctx.reportRuns.list({ reportId: q.reportId, limit, offset });
  });

  app.post('/api/reports/:id/runs', async (req, reply) => {
    const { id } = req.params as { id: string };
    let body: z.infer<typeof runBeaconBody>;
    try {
      body = runBeaconBody.parse(req.body);
    } catch (err) {
      return mapError(err, reply);
    }
    const def = ctx.reporting.list().find((r) => r.id === id);
    if (!def) {
      reply.code(404);
      return { error: `report not found: ${id}` };
    }
    const user = req.user;
    await ctx.reportRuns.record({
      reportId: id,
      reportName: def.name,
      format: body.format,
      params: body.params ?? {},
      rowCount: body.rowCount ?? null,
      userId: user?.id ?? null,
      userName: user?.username ?? null,
    });
    reply.code(201);
    return { ok: true };
  });
```

> `mapError` already maps `ZodError` → 400. The 404 here is returned directly (the report list is the source of truth for valid ids). `req.user` is the auth-plugin-augmented actor.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/server test -- reports-routes.test.ts`
Expected: PASS. Then `pnpm --filter @openldr/server typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/reports-routes.ts apps/server/src/reports-routes.test.ts
git commit -m "feat(reports): run-history routes (POST beacon + GET list)"
```

---

## Task 5: Web API helpers

**Files:**
- Modify: `apps/web/src/api.ts`
- Test: `apps/web/src/api.runs.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/api.runs.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { logReportRun, fetchReportRuns } from './api';

afterEach(() => vi.restoreAllMocks());

describe('run history api', () => {
  it('logReportRun POSTs the beacon and resolves even on failure', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await logReportRun('amr-resistance', { format: 'preview', rowCount: 2, params: { from: '2026-01-01' } });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/reports/amr-resistance/runs',
      expect.objectContaining({ method: 'POST' }),
    );
    // never throws even if the server errors
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    await expect(logReportRun('amr-resistance', { format: 'csv' })).resolves.toBeUndefined();
  });

  it('fetchReportRuns builds the query and returns runs+total', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ runs: [], total: 0 }), { status: 200 })));
    await expect(fetchReportRuns({ reportId: 'amr-resistance', limit: 25 })).resolves.toEqual({ runs: [], total: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/web`): `npx vitest run src/api.runs.test.ts`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Implement**

In `apps/web/src/api.ts`, add the type + helpers (after the existing report helpers like `fetchReportPdf`):

```ts
export interface ReportRun {
  id: string;
  reportId: string;
  reportName: string;
  format: 'preview' | 'csv' | 'pdf' | 'xlsx';
  params: Record<string, string>;
  rowCount: number | null;
  userName: string | null;
  createdAt: string;
}

export async function logReportRun(
  id: string,
  body: { format: ReportRun['format']; rowCount?: number | null; params?: Record<string, string> },
): Promise<void> {
  try {
    await authFetch(`/api/reports/${encodeURIComponent(id)}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Fire-and-forget: logging must never block the user's action.
  }
}

export async function fetchReportRuns(
  opts: { reportId?: string; limit?: number; offset?: number } = {},
): Promise<{ runs: ReportRun[]; total: number }> {
  const qs = new URLSearchParams();
  if (opts.reportId) qs.set('reportId', opts.reportId);
  if (opts.limit != null) qs.set('limit', String(opts.limit));
  if (opts.offset != null) qs.set('offset', String(opts.offset));
  const q = qs.toString();
  const res = await authFetch(`/api/reports/runs${q ? `?${q}` : ''}`);
  if (!res.ok) throw new Error(`report runs failed: ${res.status}`);
  return res.json() as Promise<{ runs: ReportRun[]; total: number }>;
}

export async function downloadReportCsv(id: string, params: Record<string, string> = {}): Promise<void> {
  const qs = new URLSearchParams(params).toString();
  const res = await authFetch(`/api/reports/${encodeURIComponent(id)}.csv${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`report csv ${id} failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${id}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `apps/web`): `npx vitest run src/api.runs.test.ts`
Expected: PASS. Then `pnpm --filter @openldr/web typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/api.runs.test.ts
git commit -m "feat(web): run-history api helpers + authenticated CSV download"
```

---

## Task 6: i18n keys

**Files:**
- Modify: `apps/web/src/i18n/en.ts`, `fr.ts`, `pt.ts`

- [ ] **Step 1: Add `history` to the `reports` namespace in en.ts**

Inside the existing `reports: { ... }` object in `apps/web/src/i18n/en.ts`, add a nested `history` block:

```ts
    history: {
      title: 'Run History',
      empty: 'No runs recorded yet.',
      colFormat: 'Format',
      colRows: 'Rows',
      colUser: 'User',
      colWhen: 'When',
      loadError: 'Could not load run history.',
    },
```

- [ ] **Step 2: Mirror into fr.ts and pt.ts**

French (`fr.ts`, inside its `reports`):
```ts
    history: {
      title: 'Historique',
      empty: 'Aucune exécution enregistrée.',
      colFormat: 'Format',
      colRows: 'Lignes',
      colUser: 'Utilisateur',
      colWhen: 'Quand',
      loadError: 'Impossible de charger l’historique.',
    },
```

Portuguese (`pt.ts`, inside its `reports`):
```ts
    history: {
      title: 'Histórico',
      empty: 'Nenhuma execução registrada.',
      colFormat: 'Formato',
      colRows: 'Linhas',
      colUser: 'Usuário',
      colWhen: 'Quando',
      loadError: 'Não foi possível carregar o histórico.',
    },
```

Keep identical key order/nesting across all three (parity).

- [ ] **Step 3: Run parity**

Run: `pnpm --filter @openldr/web test -- parity.test.ts`
Expected: PASS. Then `pnpm --filter @openldr/web typecheck` — clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/i18n/en.ts apps/web/src/i18n/fr.ts apps/web/src/i18n/pt.ts
git commit -m "feat(web): i18n keys for run history (en/fr/pt)"
```

---

## Task 7: `ReportHistoryDrawer`

**Files:**
- Create: `apps/web/src/reports/ReportHistoryDrawer.tsx`
- Test: `apps/web/src/reports/ReportHistoryDrawer.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('../api', () => ({
  fetchReportRuns: vi.fn(async () => ({
    runs: [
      { id: 'r1', reportId: 'amr-resistance', reportName: 'AMR', format: 'preview', params: { from: '2026-01-01' }, rowCount: 3, userName: 'ada', createdAt: '2026-01-01T10:00:00Z' },
    ],
    total: 1,
  })),
}));

import { ReportHistoryDrawer } from './ReportHistoryDrawer';

describe('ReportHistoryDrawer', () => {
  it('loads runs and re-applies params on row click', async () => {
    const onApplyParams = vi.fn();
    render(
      <ReportHistoryDrawer open reportId="amr-resistance" onClose={() => {}} onApplyParams={onApplyParams} />,
    );
    const userCell = await screen.findByText('ada');
    expect(screen.getByText('preview')).toBeInTheDocument();
    fireEvent.click(userCell);
    await waitFor(() => expect(onApplyParams).toHaveBeenCalledWith({ from: '2026-01-01' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/web`): `npx vitest run src/reports/ReportHistoryDrawer.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/web/src/reports/ReportHistoryDrawer.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchReportRuns, type ReportRun } from '../api';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

interface Props {
  open: boolean;
  reportId: string;
  onClose: () => void;
  onApplyParams: (params: Record<string, string>) => void;
}

export function ReportHistoryDrawer({ open, reportId, onClose, onApplyParams }: Props) {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(undefined);
    fetchReportRuns({ reportId, limit: 50 })
      .then((res) => { if (active) { setRuns(res.runs); setLoading(false); } })
      .catch(() => { if (active) { setError(t('reports.history.loadError')); setLoading(false); } });
    return () => { active = false; };
  }, [open, reportId, t]);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-[520px] max-w-[90vw] p-0">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle>{t('reports.history.title')}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div>
          ) : error ? (
            <div className="p-4 text-sm text-destructive">{error}</div>
          ) : runs.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">{t('reports.history.empty')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('reports.history.colFormat')}</TableHead>
                  <TableHead>{t('reports.history.colRows')}</TableHead>
                  <TableHead>{t('reports.history.colUser')}</TableHead>
                  <TableHead>{t('reports.history.colWhen')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => { onApplyParams(r.params); onClose(); }}
                  >
                    <TableCell><Badge variant="secondary">{r.format}</Badge></TableCell>
                    <TableCell className="tabular-nums">{r.rowCount ?? '—'}</TableCell>
                    <TableCell>{r.userName ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

> Verify `SheetContent` accepts a `side` prop and that `Badge` accepts `variant="secondary"` — read `@/components/ui/sheet.tsx` and `@/components/ui/badge.tsx`. If `secondary` is not a defined badge variant, use `variant="default"` or omit `variant`. If `SheetContent` doesn't take `side`, follow its actual API (it wraps Radix Dialog; the repo's sheet may always render from the right).

- [ ] **Step 4: Run test to verify it passes**

Run (from `apps/web`): `npx vitest run src/reports/ReportHistoryDrawer.test.tsx`
Expected: PASS. If the Radix `Sheet`/Dialog content doesn't render its children in jsdom unless opened via a portal, the `open` prop already mounts it — the `findByText('ada')` should resolve. If portal content isn't found, confirm `SheetContent` renders into the document (Radix portals into `document.body`, which Testing Library queries). Then `pnpm --filter @openldr/web typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/reports/ReportHistoryDrawer.tsx apps/web/src/reports/ReportHistoryDrawer.test.tsx
git commit -m "feat(web): ReportHistoryDrawer (shared run history + re-apply params)"
```

---

## Task 8: Enable the History item in `ReportActionsMenu`

**Files:**
- Modify: `apps/web/src/reports/ReportActionsMenu.tsx`
- Modify: `apps/web/src/reports/ReportActionsMenu.test.tsx`

- [ ] **Step 1: Update the test**

Replace `apps/web/src/reports/ReportActionsMenu.test.tsx` with:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { ReportActionsMenu } from './ReportActionsMenu';

function openMenu() {
  const trigger = screen.getByRole('button', { name: /actions|more/i });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

describe('ReportActionsMenu', () => {
  it('fires onOpenHistory when Run History is clicked', async () => {
    const onOpenHistory = vi.fn();
    render(<ReportActionsMenu onOpenHistory={onOpenHistory} />);
    openMenu();
    fireEvent.click(await screen.findByText(/run history|historique|histórico/i));
    expect(onOpenHistory).toHaveBeenCalled();
  });

  it('keeps Schedules disabled (coming soon)', async () => {
    render(<ReportActionsMenu onOpenHistory={() => {}} />);
    openMenu();
    const schedules = await screen.findByText(/schedules|planifications|agendamentos/i);
    const item = schedules.closest('[role="menuitem"]');
    expect(item?.hasAttribute('data-disabled') || item?.getAttribute('aria-disabled') === 'true').toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/web`): `npx vitest run src/reports/ReportActionsMenu.test.tsx`
Expected: FAIL — `onOpenHistory` prop not supported / History still disabled.

- [ ] **Step 3: Update the component**

Replace `apps/web/src/reports/ReportActionsMenu.tsx` with:

```tsx
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

/**
 * SP-2: Run History is live. Schedules remains a placeholder (disabled) until SP-3.
 */
export function ReportActionsMenu({ onOpenHistory }: { onOpenHistory?: () => void }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('common.actions')}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={() => onOpenHistory?.()}>
          {t('reports.runHistory')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled title={t('reports.comingSoon')}>
          {t('reports.schedules')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

> `onSelect` (not `onClick`) is the Radix DropdownMenuItem activation handler; the test clicks the item text which triggers selection. If the repo's `DropdownMenuItem` only forwards `onClick`, use `onClick` instead — read `@/components/ui/dropdown-menu.tsx` to confirm which is wired.

- [ ] **Step 4: Run test to verify it passes**

Run (from `apps/web`): `npx vitest run src/reports/ReportActionsMenu.test.tsx`
Expected: PASS. Then `pnpm --filter @openldr/web typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/reports/ReportActionsMenu.tsx apps/web/src/reports/ReportActionsMenu.test.tsx
git commit -m "feat(web): enable Run History in ReportActionsMenu"
```

---

## Task 9: PDF download callback (`PdfCanvasViewer` + `ReportDocumentTab`)

**Files:**
- Modify: `apps/web/src/reports/PdfCanvasViewer.tsx`
- Modify: `apps/web/src/reports/ReportDocumentTab.tsx`
- Test: `apps/web/src/reports/PdfCanvasViewer.test.tsx` (extend)

- [ ] **Step 1: Add a failing test for the download callback**

Append to `apps/web/src/reports/PdfCanvasViewer.test.tsx` a test that clicks Download and asserts `onDownload` fires. Add inside the existing `describe`:

```tsx
  it('invokes onDownload when the download button is clicked', async () => {
    const onDownload = vi.fn();
    render(<PdfCanvasViewer blob={new Blob(['%PDF'])} fileName="r.pdf" onDownload={onDownload} />);
    const btn = await screen.findByText(/download|télécharger|baixar/i);
    btn.click();
    expect(onDownload).toHaveBeenCalled();
  });
```

(Ensure `vi` is imported in that test file.)

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/web`): `npx vitest run src/reports/PdfCanvasViewer.test.tsx`
Expected: FAIL — `onDownload` not a prop.

- [ ] **Step 3: Add the prop**

In `apps/web/src/reports/PdfCanvasViewer.tsx`:
- Extend the `Props` interface:
```ts
interface Props {
  blob: Blob;
  fileName: string;
  onDownload?: () => void;
}
```
- Destructure it: `export function PdfCanvasViewer({ blob, fileName, onDownload }: Props) {`
- In `handleDownload`, after `URL.revokeObjectURL(url);`, add:
```ts
    onDownload?.();
```
- Add `onDownload` to the `useCallback` dependency array for `handleDownload` (i.e. `[blob, fileName, onDownload]`).

In `apps/web/src/reports/ReportDocumentTab.tsx`:
- Extend `Props`:
```ts
interface Props {
  reportId: string;
  params: Record<string, string>;
  onDownload?: () => void;
}
```
- Destructure `onDownload` and pass it through:
```tsx
  return <PdfCanvasViewer blob={blob} fileName={`${reportId}.pdf`} onDownload={onDownload} />;
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `apps/web`): `npx vitest run src/reports/PdfCanvasViewer.test.tsx src/reports/ReportDocumentTab.test.tsx`
Expected: PASS. Then `pnpm --filter @openldr/web typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/reports/PdfCanvasViewer.tsx apps/web/src/reports/ReportDocumentTab.tsx apps/web/src/reports/PdfCanvasViewer.test.tsx
git commit -m "feat(web): onDownload callback for PDF viewer + document tab"
```

---

## Task 10: `ReportSpreadsheetTab` — authenticated CSV + export callback

**Files:**
- Modify: `apps/web/src/reports/ReportSpreadsheetTab.tsx`
- Modify: `apps/web/src/reports/ReportSpreadsheetTab.test.tsx`

- [ ] **Step 1: Update the test**

The CSV control changes from an `<a href>` link to a button. Replace the CSV assertion in `apps/web/src/reports/ReportSpreadsheetTab.test.tsx` and add an export-callback assertion. Replace the existing single test with:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';

const downloadReportCsv = vi.fn(async () => {});
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return { ...actual, downloadReportCsv };
});

import { ReportSpreadsheetTab } from './ReportSpreadsheetTab';
import type { ReportResult } from '../api';

const result: ReportResult = {
  columns: [
    { key: 'antibiotic', label: 'Antibiotic', kind: 'string' },
    { key: 'percentR', label: '%R', kind: 'percent' },
  ],
  rows: [{ antibiotic: 'AMP', percentR: 40 }, { antibiotic: 'CIP', percentR: 60 }],
  chart: { type: 'bar', x: 'antibiotic', y: 'percentR' },
  meta: { generatedAt: '2026-01-01', rowCount: 2 },
};

describe('ReportSpreadsheetTab', () => {
  it('renders rows with percent formatting', () => {
    render(<ReportSpreadsheetTab reportId="amr-resistance" result={result} params={{ from: '2026-01-01' }} />);
    expect(screen.getByText('AMP')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('downloads CSV via authenticated helper and fires onExport', async () => {
    const onExport = vi.fn();
    render(<ReportSpreadsheetTab reportId="amr-resistance" result={result} params={{ from: '2026-01-01' }} onExport={onExport} />);
    fireEvent.click(screen.getByRole('button', { name: /csv/i }));
    expect(downloadReportCsv).toHaveBeenCalledWith('amr-resistance', { from: '2026-01-01' });
    // onExport fires for csv with the row count (awaited microtask)
    await Promise.resolve();
    expect(onExport).toHaveBeenCalledWith('csv', 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/web`): `npx vitest run src/reports/ReportSpreadsheetTab.test.tsx`
Expected: FAIL — CSV is still an `<a>` link / `onExport` unsupported.

- [ ] **Step 3: Update the component**

In `apps/web/src/reports/ReportSpreadsheetTab.tsx`:
- Update the import from `../api` to include the new helper:
```ts
import { csvUrl, downloadReportCsv } from '../api';
```
(Keep `csvUrl` if still referenced elsewhere; if it becomes unused after this change, remove it from the import to satisfy typecheck.)
- Extend `Props`:
```ts
interface Props {
  reportId: string;
  result: ReportResult;
  params: Record<string, string>;
  onExport?: (format: 'csv' | 'xlsx', rowCount: number) => void;
}
```
- Destructure `onExport` in the function signature.
- Replace the CSV export control (the `<Button asChild>...<a href={csvUrl(...)}>` element) with a button that calls the authenticated download + the callback:
```tsx
      <Button
        variant="outline"
        size="sm"
        className="h-8 text-xs"
        onClick={() => {
          void downloadReportCsv(reportId, params);
          onExport?.('csv', result.rows.length);
        }}
      >
        {t('reports.exportCsv')}
      </Button>
```
- In the existing XLSX button's `onClick`, after the `exportXlsx(...)` call, add:
```tsx
          onExport?.('xlsx', result.rows.length);
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `apps/web`): `npx vitest run src/reports/ReportSpreadsheetTab.test.tsx`
Expected: PASS. Then `pnpm --filter @openldr/web typecheck` — clean (fix the `csvUrl` import if it is now unused).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/reports/ReportSpreadsheetTab.tsx apps/web/src/reports/ReportSpreadsheetTab.test.tsx
git commit -m "feat(web): authenticated CSV download + export logging hook in spreadsheet tab"
```

---

## Task 11: Wire the drawer + four log call-sites into `Reports.tsx`

**Files:**
- Modify: `apps/web/src/pages/Reports.tsx`
- Modify: `apps/web/src/pages/Reports.test.tsx`

- [ ] **Step 1: Update the page test**

Extend `apps/web/src/pages/Reports.test.tsx`: the existing `../api` mock must add `logReportRun`, `fetchReportRuns`, and `downloadReportCsv`; add an assertion that a preview run is logged. Update the mock object to include:

```ts
  logReportRun: vi.fn(async () => {}),
  fetchReportRuns: vi.fn(async () => ({ runs: [], total: 0 })),
  downloadReportCsv: vi.fn(async () => {}),
```

And add a test after the existing one:

```tsx
  it('logs a preview run after Run', async () => {
    const api = await import('../api');
    render(<MemoryRouter><Reports /></MemoryRouter>);
    fireEvent.click(await screen.findByText('AMR Resistance Rate'));
    fireEvent.click(await screen.findByRole('button', { name: /run|exécuter|executar/i }));
    await waitFor(() => expect(api.logReportRun).toHaveBeenCalledWith(
      'amr-resistance',
      expect.objectContaining({ format: 'preview' }),
    ));
  });
```

(Keep the existing "shows the document tab" test. Ensure `fetchReportPdf` remains mocked and `PdfCanvasViewer` is still mocked as in SP-1.)

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/web`): `npx vitest run src/pages/Reports.test.tsx`
Expected: FAIL — `logReportRun` not called (page doesn't log yet); possibly the new mock keys are unused.

- [ ] **Step 3: Wire the page**

In `apps/web/src/pages/Reports.tsx`:
- Extend the `../api` import to add `logReportRun`:
```ts
import {
  fetchReports, fetchReport, fetchReportOptions, logReportRun,
  type ReportSummary, type ReportResult,
} from '../api';
```
- Add the drawer import:
```ts
import { ReportHistoryDrawer } from '../reports/ReportHistoryDrawer';
```
- Add state near the other `useState`s:
```ts
  const [historyOpen, setHistoryOpen] = useState(false);
```
- In `handleRun`, after `setResult(res);` (and the existing `setRanParams(params); setRanAt(...)`), log the preview:
```ts
      logReportRun(selectedId, { format: 'preview', rowCount: res.meta.rowCount, params });
```
- Pass the history opener to the actions menu — change `<ReportActionsMenu />` to:
```tsx
                <ReportActionsMenu onOpenHistory={() => setHistoryOpen(true)} />
```
- Pass export/download logging into the two tabs — change the tab bodies:
```tsx
                    {activeTab === 'document' ? (
                      <ReportDocumentTab
                        reportId={selected.id}
                        params={ranParams}
                        onDownload={() => logReportRun(selected.id, { format: 'pdf', rowCount: result.meta.rowCount, params: ranParams })}
                      />
                    ) : (
                      <ReportSpreadsheetTab
                        reportId={selected.id}
                        result={result}
                        params={ranParams}
                        onExport={(format, rowCount) => logReportRun(selected.id, { format, rowCount, params: ranParams })}
                      />
                    )}
```
- Render the drawer just before the closing `</AppShell>` (after the outer content `div`), guarded by `selected`:
```tsx
        {selected && (
          <ReportHistoryDrawer
            open={historyOpen}
            reportId={selected.id}
            onClose={() => setHistoryOpen(false)}
            onApplyParams={(p) => { setParams(p); setHistoryOpen(false); }}
          />
        )}
```
Place it inside the top-level `<AppShell>` but outside the `flex h-full` split `div` (a sibling of that div), so the Sheet portal isn't constrained by the split layout.

- [ ] **Step 4: Run test to verify it passes**

Run (from `apps/web`): `npx vitest run src/pages/Reports.test.tsx`
Expected: PASS. Then `pnpm --filter @openldr/web typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/Reports.tsx apps/web/src/pages/Reports.test.tsx
git commit -m "feat(web): wire Run History drawer + log preview/csv/xlsx/pdf runs"
```

---

## Task 12: Full gate + memory update

- [ ] **Step 1: Run the full monorepo gate**

Run: `pnpm -w turbo typecheck lint test build`
Expected: all green. If `@openldr/web#test` flakes (known Dhis2/Terminology parallel flake), re-run in isolation: `pnpm --filter @openldr/web test`.

- [ ] **Step 2: Dependency-cruiser**

Run: `pnpm -w depcruise`
Expected: clean. The web `reports/ReportHistoryDrawer` must only import from `@/components/*`, `../api`, `react-i18next`.

- [ ] **Step 3: Update project memory**

Edit `C:\Users\Fredrick\.claude\projects\D--Projects-Repositories-openldr-ce\memory\reports-page-workstream.md`: mark **SP-2 (Run History) COMPLETE** (merged status to be set at merge time) — `report_runs` table (migration 025) + `ReportRunStore` (`ctx.reportRuns`) + `POST /api/reports/:id/runs` beacon + `GET /api/reports/runs` + `ReportHistoryDrawer` + four client log sites + authenticated CSV download (fixed the plain-anchor 401). Note SP-3 (Scheduling) still pending. Update the matching MEMORY.md line.

- [ ] **Step 4: Commit (if the gate required any fixes)**

```bash
git add -A
git commit -m "chore(reports): SP-2 gate green"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** what-gets-logged (4 formats) → Tasks 9/10/11 call sites + Task 4 beacon; CSV-auth fix → Tasks 5/10; data model → Task 1; store → Task 2; `ctx.reportRuns` → Task 3; routes → Task 4; api helpers → Task 5; drawer → Task 7; actions-menu enable → Task 8; re-apply params → Tasks 7/11; i18n → Task 6; testing → every task is TDD + Task 12 gate. SP-3 (schedules) correctly untouched (the Schedules item stays disabled).
- **Type consistency:** `ReportRun`/`ReportRunFormat` fields match between `packages/db/src/report-run-store.ts` (Task 2), the route payload (Task 4), and `apps/web/src/api.ts` (Task 5): `format` union `preview|csv|pdf|xlsx`, `params` object, `rowCount` nullable, `userName` nullable. `logReportRun(id, { format, rowCount?, params? })` signature is identical at every call site (Tasks 5, 9, 10, 11). `onExport(format, rowCount)` and `onDownload()` signatures match between producer (Tasks 9, 10) and consumer (Task 11).
- **Ordering:** the `GET /api/reports/runs` and `POST /api/reports/:id/runs` routes are registered before the bare `/api/reports/:id` route (Task 4), so `runs` is not captured as an `:id`.
- **Known adaptation points flagged inline:** `SheetContent side` prop + `Badge variant` (Task 7), `DropdownMenuItem onSelect` vs `onClick` (Task 8), and the possibly-now-unused `csvUrl` import (Task 10) — each task tells the implementer to verify against the actual component and adjust.
