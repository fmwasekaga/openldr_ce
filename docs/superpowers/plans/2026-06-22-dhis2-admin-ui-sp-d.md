# DHIS2 Admin UI — SP-D (Operations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operate DHIS2 mappings — per-mapping dry-run preview + manual push, push history, and live schedule management.

**Architecture:** Extend `dhis2-routes.ts` with a run route (wraps `dhis2.runMapping`), a pushes route (reads local audit), and schedule CRUD (reads/writes `createScheduleStore(ctx.internalDb)`); thread the `eventing` port through `buildApp` so schedule create/enable arm live via `reconcileSchedules`. Add a run dialog on the mappings list and two pages (`/dhis2/schedules`, `/dhis2/pushes`).

**Tech Stack:** Kysely (pg + pg-mem), Fastify + Vitest + zod, React + react-router + react-i18next + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-22-dhis2-admin-ui-sp-d-design.md`
**Builds on (on `main`):** SP-A–C2 (`registerDhis2Routes(app, ctx, dhis2, deps)`, `Dhis2RouteDeps {metadataCache, orgUnitStore, mappingStore}`, `Dhis2Mappings` list page, `recordAudit`, `Combobox`, `ConfirmDialog`, `dhis2.*` i18n, the `fakeDeps`/`fakeCtx`/`fakeDhis2`/`appWith` test harness).

---

## File Structure

- Modify `packages/db/src/dhis2-schedule-store.ts` (+ `dhis2-schedule-store.test.ts`) — `setEnabled`.
- Modify `apps/server/src/dhis2-routes.ts` (+ `dhis2-routes.test.ts`) — `eventing` param, `deps.scheduleStore`, run + pushes + schedules routes.
- Modify `apps/server/src/app.ts` — `buildApp(ctx, dhis2, eventing)` + wire `scheduleStore`/`eventing`.
- Modify `apps/server/src/index.ts` — pass `ingest.eventing` to `buildApp`.
- Modify `apps/web/src/api.ts` — run/pushes/schedules client + types.
- Modify `apps/web/src/pages/Dhis2Mappings.tsx` (+ test) — "Run" row action + run dialog.
- Create `apps/web/src/pages/Dhis2Schedules.tsx` (+ test).
- Create `apps/web/src/pages/Dhis2Pushes.tsx` (+ test).
- Modify `apps/web/src/App.tsx` — `/dhis2/schedules`, `/dhis2/pushes` routes.
- Modify `apps/web/src/pages/Dhis2.tsx` — "Manage →" link on Schedules count + "View all →" on pushes.
- Modify `apps/web/src/i18n/index.ts` — `dhis2.ops.*`.

---

## Task 1: `ScheduleStore.setEnabled`

**Files:**
- Modify: `packages/db/src/dhis2-schedule-store.ts`
- Test: `packages/db/src/dhis2-schedule-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/dhis2-schedule-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createScheduleStore } from './dhis2-schedule-store';

describe('schedule store', () => {
  it('creates, lists, toggles enabled, and removes', async () => {
    const db = await makeMigratedDb();
    const store = createScheduleStore(db);
    await store.create({ id: 's1', mappingId: 'm1', mode: 'aggregate', periodType: 'quarterly', eventDriven: false });
    expect((await store.list()).map((s) => s.id)).toEqual(['s1']);
    expect((await store.get('s1'))?.enabled).toBe(true);

    await store.setEnabled('s1', false);
    expect((await store.get('s1'))?.enabled).toBe(false);
    await store.setEnabled('s1', true);
    expect((await store.get('s1'))?.enabled).toBe(true);

    await store.remove('s1');
    expect(await store.list()).toEqual([]);
    await db.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/db test -- --run dhis2-schedule-store.test.ts`
Expected: FAIL — `setEnabled` is not a function.

- [ ] **Step 3: Implement**

In `packages/db/src/dhis2-schedule-store.ts`, add to the `ScheduleStore` interface (after `markRun`):

```ts
  setEnabled(id: string, enabled: boolean): Promise<void>;
```

and to the returned object (after `markRun`):

```ts
    async setEnabled(id, enabled) {
      await db.updateTable('dhis2_schedules').set({ enabled, updated_at: sql`now()` }).where('id', '=', id).execute();
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/db test -- --run dhis2-schedule-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/dhis2-schedule-store.ts packages/db/src/dhis2-schedule-store.test.ts
git commit -m "feat(db): ScheduleStore.setEnabled"
```

---

## Task 2: Thread `eventing` + `scheduleStore` into the routes

**Files:**
- Modify: `apps/server/src/dhis2-routes.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/index.ts`
- Test: `apps/server/src/dhis2-routes.test.ts`

This is wiring only (no new routes yet); it makes the `eventing` + `scheduleStore` available and keeps everything green.

- [ ] **Step 1: Update the test harness (failing compile)**

In `apps/server/src/dhis2-routes.test.ts`:
- Add `scheduleStore` to `fakeDeps` (before `...over`):

```ts
    scheduleStore: (() => {
      const rows: { id: string; mappingId: string; mode: string; periodType: string; eventDriven: boolean; enabled: boolean; lastRunAt: string | null; nextDueAt: string | null }[] = [];
      return {
        create: async (s: { id: string; mappingId: string; mode: string; periodType: string; eventDriven: boolean }) => { rows.push({ ...s, enabled: true, lastRunAt: null, nextDueAt: null }); },
        get: async (id: string) => rows.find((r) => r.id === id) ?? null,
        list: async () => rows.slice(),
        remove: async (id: string) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); },
        setEnabled: async (id: string, enabled: boolean) => { const r = rows.find((x) => x.id === id); if (r) r.enabled = enabled; },
        setNextDue: async () => {}, markRun: async () => {},
      };
    })(),
```

- Add a `fakeEventing` + a reconcile spy to `fakeDhis2` and thread eventing through `appWith`. Add to `fakeDhis2` (before `...over`):

```ts
    runMapping: async (args: { dryRun: boolean }) => ({ kind: 'aggregate', dryRun: args.dryRun, build: { payload: { dataValues: [{}, {}] }, skipped: [{ row: 3, reason: 'no orgUnit' }] }, result: args.dryRun ? undefined : { status: 'success', imported: 2, updated: 0, ignored: 0, deleted: 0, conflicts: [], raw: {} } }),
    reconcileSchedules: async () => { reconcileCalls.push(1); },
```

At the top of the test module (module scope, near the other helpers), add:

```ts
const reconcileCalls: number[] = [];
const fakeEventing = { publish: async () => {}, subscribe: async () => {}, drain: async () => {} } as never;
```

Change `appWith` to pass `fakeEventing` as the 5th arg of `registerDhis2Routes`:

```ts
  registerDhis2Routes(app, fakeCtx(ctxCfg, fhirStore), dhis2 as never, deps as never, fakeEventing);
```

(Update the standalone `registerDhis2Routes(...)` calls in existing PUT/DELETE tests to add `, fakeEventing` as the 5th arg too — search the test file for `registerDhis2Routes(app, ctxRef` and append `, fakeEventing`.)

Run `pnpm --filter @openldr/server test -- --run dhis2-routes.test.ts` — expected FAIL (registerDhis2Routes takes 4 args; `deps.scheduleStore`/eventing unused).

- [ ] **Step 2: Add the params + deps field**

In `apps/server/src/dhis2-routes.ts`:
- Add `ScheduleStore` to the `@openldr/db` type import and extend `Dhis2RouteDeps`:

```ts
export interface Dhis2RouteDeps {
  metadataCache: Dhis2MetadataCache;
  orgUnitStore: OrgUnitMapStore;
  mappingStore: MappingStore;
  scheduleStore: ScheduleStore;
}
```

- Add a local type alias for the eventing port derived from the already-imported `Dhis2Context` (avoids adding `@openldr/ports` as a server dep). Add near the top of the file:

```ts
type Eventing = Parameters<Dhis2Context['reconcileSchedules']>[0];
```

- Change the signature to add `eventing`:

```ts
export function registerDhis2Routes(app: FastifyInstance<any, any, any, any>, ctx: AppContext, dhis2: Dhis2Context | null, deps: Dhis2RouteDeps, eventing: Eventing | null = null): void {
```

- Add the arming helper near the top of the function body (after `const configured = ...`):

```ts
  async function armSchedules(): Promise<void> {
    if (dhis2 && eventing) { try { await dhis2.reconcileSchedules(eventing); } catch { /* arming is best-effort */ } }
  }
```

(`armSchedules` is referenced by Task 4's schedule routes. It is defined now to keep the wiring in one place; lint may flag it as unused until Task 4 — that's expected mid-task. If your lint fails the build on unused functions, add the schedules routes (Task 4) before running lint.)

- [ ] **Step 3: Wire `buildApp` + `index.ts`**

In `apps/server/src/app.ts`:
- Add `createScheduleStore` to the `@openldr/db` import:

```ts
import { createDhis2MetadataCache, createOrgUnitMapStore, createMappingStore, createScheduleStore } from '@openldr/db';
```

- `Dhis2Context` is already imported in `app.ts`. Change `buildApp`'s signature to derive the eventing type from it (no `@openldr/ports` dep needed):

```ts
export function buildApp(ctx: AppContext, dhis2: Dhis2Context | null = null, eventing: Parameters<Dhis2Context['reconcileSchedules']>[0] | null = null) {
```

and

```ts
  registerDhis2Routes(app, ctx, dhis2, {
    metadataCache: createDhis2MetadataCache(ctx.internalDb),
    orgUnitStore: createOrgUnitMapStore(ctx.internalDb),
    mappingStore: createMappingStore(ctx.internalDb),
    scheduleStore: createScheduleStore(ctx.internalDb),
  }, eventing);
```

In `apps/server/src/index.ts`, change `const app = buildApp(ctx, dhis2);` to:

```ts
  const app = buildApp(ctx, dhis2, ingest.eventing);
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @openldr/server test -- --run dhis2-routes.test.ts && pnpm --filter @openldr/server typecheck`
Expected: existing tests PASS (the harness now compiles); typecheck clean. (If lint complains about unused `armSchedules`, proceed to Task 4 which uses it, then run lint at the gate.)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/dhis2-routes.ts apps/server/src/app.ts apps/server/src/index.ts apps/server/src/dhis2-routes.test.ts
git commit -m "feat(dhis2): thread eventing + scheduleStore into routes (wiring)"
```

---

## Task 3: Run route (dry-run + push)

**Files:**
- Modify: `apps/server/src/dhis2-routes.ts`
- Test: `apps/server/src/dhis2-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/server/src/dhis2-routes.test.ts`:

```ts
describe('dhis2 run route', () => {
  it('dry-run returns counts + skipped, no result', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin']);
    const res = await app.inject({ method: 'POST', url: '/api/dhis2/mappings/m1/run', payload: { period: '2026Q1', dryRun: true } });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.kind).toBe('aggregate');
    expect(b.counts).toEqual({ values: 2, skipped: 1 });
    expect(b.skipped[0].reason).toBe('no orgUnit');
    expect(b.result).toBeNull();
  });

  it('push returns the PushResult', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin']);
    const b = (await app.inject({ method: 'POST', url: '/api/dhis2/mappings/m1/run', payload: { period: '2026Q1', dryRun: false } })).json();
    expect(b.result.status).toBe('success');
    expect(b.result.imported).toBe(2);
  });

  it('returns 409 when DHIS2 is not configured', async () => {
    const app = appWith(configuredCfg({ REPORTING_TARGET_ADAPTER: 'pg' }), null, ['lab_admin']);
    expect((await app.inject({ method: 'POST', url: '/api/dhis2/mappings/m1/run', payload: { period: '2026Q1', dryRun: true } })).statusCode).toBe(409);
  });

  it('400 on bad body', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin']);
    expect((await app.inject({ method: 'POST', url: '/api/dhis2/mappings/m1/run', payload: { dryRun: true } })).statusCode).toBe(400);
  });

  it('rejects non-admins with 403', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['viewer']);
    expect((await app.inject({ method: 'POST', url: '/api/dhis2/mappings/m1/run', payload: { period: '2026Q1', dryRun: true } })).statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server test -- --run dhis2-routes.test.ts`
Expected: FAIL — run route 404.

- [ ] **Step 3: Implement the run route**

In `apps/server/src/dhis2-routes.ts`, add the zod input near the other schemas:

```ts
const runInput = z.object({ period: z.string().min(1), dryRun: z.boolean() });
```

Add the route inside `registerDhis2Routes` (after the mappings routes):

```ts
  app.post('/api/dhis2/mappings/:id/run', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    if (!dhis2) { reply.code(409); return { error: 'DHIS2 target not configured' }; }
    const p = runInput.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const id = (req.params as { id: string }).id;
    try {
      const outcome = await dhis2.runMapping({
        mappingId: id, period: p.data.period, dryRun: p.data.dryRun, trigger: 'manual',
        runReport: (rid, params) => ctx.reporting.run(rid, params ?? {}).then((r) => ({ rows: r.rows })),
        runEventSource: (sid, w) => ctx.reporting.runEventSource(sid, w),
      });
      const payload = outcome.build.payload as { dataValues?: unknown[]; events?: unknown[] };
      const values = payload.dataValues?.length ?? payload.events?.length ?? 0;
      return { kind: outcome.kind, dryRun: outcome.dryRun, counts: { values, skipped: outcome.build.skipped.length }, skipped: outcome.build.skipped, result: outcome.result ?? null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/unknown mapping/i.test(msg)) { reply.code(400); return { error: msg }; }
      reply.code(502);
      return { error: redact(msg) };
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/server test -- --run dhis2-routes.test.ts && pnpm --filter @openldr/server typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/dhis2-routes.ts apps/server/src/dhis2-routes.test.ts
git commit -m "feat(dhis2): POST /mappings/:id/run (dry-run + push)"
```

---

## Task 4: Pushes + schedules routes

**Files:**
- Modify: `apps/server/src/dhis2-routes.ts`
- Test: `apps/server/src/dhis2-routes.test.ts`

Notes: `ctx.audit.list({ entityType, limit })` returns audit events. The schedules list joins mapping names from `deps.mappingStore.list()`. Schedule mode is derived from the mapping's `definition.kind`.

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/dhis2-routes.test.ts`, make `fakeCtx.audit.list` return events for the pushes test — update the `audit` fake in `fakeCtx` to:

```ts
    audit: { record: async (e: unknown) => { audit.push(e); }, list: async () => [{ id: 'p1', occurredAt: '2026-01-01T00:00:00Z', action: 'dhis2.push', entityType: 'dhis2-mapping', entityId: 'm1', actorType: 'system', actorName: 'system', metadata: { period: '2026Q1', status: 'success' } }] },
```

Append these tests:

```ts
describe('dhis2 pushes + schedules', () => {
  it('GET /pushes returns audit history', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin']);
    const b = (await app.inject({ method: 'GET', url: '/api/dhis2/pushes' })).json();
    expect(b[0].action).toBe('dhis2.push');
    expect(b[0].metadata.period).toBe('2026Q1');
  });

  it('GET /schedules joins mapping names', async () => {
    const deps = fakeDeps();
    await deps.mappingStore.upsert({ id: 'm1', name: 'My Mapping', definition: { kind: 'aggregate' } });
    await deps.scheduleStore.create({ id: 's1', mappingId: 'm1', mode: 'aggregate', periodType: 'quarterly', eventDriven: false });
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], deps);
    const b = (await app.inject({ method: 'GET', url: '/api/dhis2/schedules' })).json();
    expect(b[0]).toMatchObject({ id: 's1', mappingId: 'm1', mappingName: 'My Mapping', periodType: 'quarterly', enabled: true });
  });

  it('POST /schedules derives mode, arms, audits; 404 unknown mapping', async () => {
    const deps = fakeDeps();
    await deps.mappingStore.upsert({ id: 'm2', name: 'Trk', definition: { kind: 'tracker' } });
    const before = reconcileCalls.length;
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], deps);
    const res = await app.inject({ method: 'POST', url: '/api/dhis2/schedules', payload: { mappingId: 'm2', periodType: 'monthly', eventDriven: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe('tracker');
    expect(reconcileCalls.length).toBeGreaterThan(before); // armed
    expect((await deps.scheduleStore.list()).length).toBe(1);
    const bad = await app.inject({ method: 'POST', url: '/api/dhis2/schedules', payload: { mappingId: 'ghost', periodType: 'monthly', eventDriven: false } });
    expect(bad.statusCode).toBe(404);
  });

  it('POST /schedules/:id/enabled toggles + arms on enable; DELETE removes', async () => {
    const deps = fakeDeps();
    await deps.scheduleStore.create({ id: 's1', mappingId: 'm1', mode: 'aggregate', periodType: 'quarterly', eventDriven: false });
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], deps);
    expect((await app.inject({ method: 'POST', url: '/api/dhis2/schedules/s1/enabled', payload: { enabled: false } })).statusCode).toBe(200);
    expect((await deps.scheduleStore.get('s1'))?.enabled).toBe(false);
    expect((await app.inject({ method: 'DELETE', url: '/api/dhis2/schedules/s1' })).statusCode).toBe(204);
    expect(await deps.scheduleStore.list()).toEqual([]);
  });

  it('rejects non-admins with 403', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['data_analyst']);
    expect((await app.inject({ method: 'GET', url: '/api/dhis2/schedules' })).statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server test -- --run dhis2-routes.test.ts`
Expected: FAIL — pushes/schedules routes 404.

- [ ] **Step 3: Implement the routes**

In `apps/server/src/dhis2-routes.ts`, add the zod inputs near the others:

```ts
const scheduleCreateInput = z.object({ mappingId: z.string().min(1), periodType: z.enum(['monthly', 'quarterly', 'yearly']), eventDriven: z.boolean() });
const scheduleEnabledInput = z.object({ enabled: z.boolean() });
```

Add `randomUUID` import at the top: `import { randomUUID } from 'node:crypto';`

Add the routes inside `registerDhis2Routes` (after the run route):

```ts
  app.get('/api/dhis2/pushes', { preHandler: requireRole('lab_admin') }, async (req) => {
    const raw = Number((req.query as { limit?: string }).limit);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(1, raw), 100) : 20;
    return ctx.audit.list({ entityType: 'dhis2-mapping', limit });
  });

  app.get('/api/dhis2/schedules', { preHandler: requireRole('lab_admin') }, async () => {
    const [schedules, mappings] = await Promise.all([deps.scheduleStore.list(), deps.mappingStore.list()]);
    const nameById = new Map(mappings.map((m) => [m.id, m.name]));
    return schedules.map((s) => ({ ...s, mappingName: nameById.get(s.mappingId) ?? s.mappingId }));
  });

  app.post('/api/dhis2/schedules', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const p = scheduleCreateInput.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const mapping = await deps.mappingStore.get(p.data.mappingId);
    if (!mapping) { reply.code(404); return { error: 'unknown mapping' }; }
    const mode = (mapping.definition as { kind?: string }).kind === 'tracker' ? 'tracker' : 'aggregate';
    const id = `sched-${randomUUID()}`;
    await deps.scheduleStore.create({ id, mappingId: p.data.mappingId, mode, periodType: p.data.periodType, eventDriven: p.data.eventDriven });
    await armSchedules();
    await recordAudit(ctx, req, { action: 'dhis2.schedule.create', entityType: 'dhis2-schedule', entityId: id, before: null, after: { mappingId: p.data.mappingId, mode, periodType: p.data.periodType, eventDriven: p.data.eventDriven } });
    const created = await deps.scheduleStore.get(id);
    return created;
  });

  app.post('/api/dhis2/schedules/:id/enabled', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const p = scheduleEnabledInput.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const id = (req.params as { id: string }).id;
    await deps.scheduleStore.setEnabled(id, p.data.enabled);
    if (p.data.enabled) await armSchedules();
    await recordAudit(ctx, req, { action: 'dhis2.schedule.update', entityType: 'dhis2-schedule', entityId: id, before: null, after: null, metadata: { enabled: p.data.enabled } });
    return { ok: true };
  });

  app.delete('/api/dhis2/schedules/:id', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    await deps.scheduleStore.remove(id);
    await recordAudit(ctx, req, { action: 'dhis2.schedule.delete', entityType: 'dhis2-schedule', entityId: id, before: null, after: null });
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
git commit -m "feat(dhis2): pushes history + schedules CRUD routes (live arm)"
```

---

## Task 5: Web — operations API client

**Files:**
- Modify: `apps/web/src/api.ts`

- [ ] **Step 1: Add types + functions**

Append to `apps/web/src/api.ts` (after the SP-C blocks):

```ts
// ── DHIS2 operations (SP-D) ────────────────────────────────────────────────────
export interface Dhis2PushResultClient { status: string; imported: number; updated: number; ignored: number; deleted: number; conflicts: { object: string; value: string }[] }
export interface Dhis2RunResult {
  kind: 'aggregate' | 'tracker';
  dryRun: boolean;
  counts: { values: number; skipped: number };
  skipped: { row: number; reason: string }[];
  result: Dhis2PushResultClient | null;
}
export interface Dhis2Push { id: string; occurredAt: string; action: string; entityId: string; metadata?: Record<string, unknown> }
export interface Dhis2Schedule {
  id: string; mappingId: string; mappingName: string;
  mode: 'aggregate' | 'tracker'; periodType: 'monthly' | 'quarterly' | 'yearly';
  eventDriven: boolean; enabled: boolean; lastRunAt: string | null; nextDueAt: string | null;
}

export async function runDhis2Mapping(id: string, body: { period: string; dryRun: boolean }): Promise<Dhis2RunResult> {
  const r = await authFetch(`/api/dhis2/mappings/${encodeURIComponent(id)}/run`, jbody(body, 'POST'));
  if (!r.ok) { const b = (await r.json().catch(() => ({}))) as { error?: string }; throw new Error(b.error ?? `run failed: ${r.status}`); }
  return r.json();
}
export async function listDhis2Pushes(limit = 50): Promise<Dhis2Push[]> {
  const r = await authFetch(`/api/dhis2/pushes?limit=${limit}`);
  if (!r.ok) throw new Error(`pushes failed: ${r.status}`);
  return r.json();
}
export async function listDhis2Schedules(): Promise<Dhis2Schedule[]> {
  const r = await authFetch('/api/dhis2/schedules');
  if (!r.ok) throw new Error(`schedules failed: ${r.status}`);
  return r.json();
}
export async function createDhis2Schedule(body: { mappingId: string; periodType: string; eventDriven: boolean }): Promise<Dhis2Schedule> {
  const r = await authFetch('/api/dhis2/schedules', jbody(body, 'POST'));
  if (!r.ok) throw new Error(`create schedule failed: ${r.status}`);
  return r.json();
}
export async function setDhis2ScheduleEnabled(id: string, enabled: boolean): Promise<void> {
  const r = await authFetch(`/api/dhis2/schedules/${encodeURIComponent(id)}/enabled`, jbody({ enabled }, 'POST'));
  if (!r.ok) throw new Error(`toggle schedule failed: ${r.status}`);
}
export async function deleteDhis2Schedule(id: string): Promise<void> {
  const r = await authFetch(`/api/dhis2/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`delete schedule failed: ${r.status}`);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @openldr/web typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api.ts
git commit -m "feat(dhis2): web api for run/pushes/schedules"
```

---

## Task 6: Web — run dialog on the mappings list

**Files:**
- Modify: `apps/web/src/pages/Dhis2Mappings.tsx`
- Modify: `apps/web/src/i18n/index.ts`
- Test: `apps/web/src/pages/Dhis2Mappings.test.tsx`

- [ ] **Step 1: Add i18n keys**

In `apps/web/src/i18n/index.ts`, inside the `dhis2` object (after the `mappings` object, before the `dhis2` block's closing brace), add an `ops` block:

```ts
      ops: {
        run: 'Run',
        runTitle: 'Run {{name}}',
        period: 'Period',
        periodHint: 'monthly 202601 · quarterly 2026Q1 · yearly 2026',
        dryRun: 'Dry run',
        push: 'Push',
        close: 'Close',
        values: 'Values',
        skippedRows: 'Skipped rows',
        pushResult: 'Push result',
        imported: 'Imported', updated: 'Updated', ignored: 'Ignored', conflicts: 'Conflicts',
        notConfigured: 'DHIS2 is not configured — set it up in DHIS2 settings to run mappings.',
        schedules: 'Schedules', schedulesManage: 'Manage →',
        scheduleTitle: 'DHIS2 schedules',
        newSchedule: 'New schedule', mapping: 'Mapping', periodType: 'Period type', eventDriven: 'Event-driven',
        enabled: 'Enabled', lastRun: 'Last run', nextDue: 'Next due', create: 'Create', delete: 'Delete',
        deleteScheduleTitle: 'Delete schedule?', deleteScheduleDesc: 'This removes the schedule.',
        noSchedules: 'No schedules yet.', syncNote: 'Schedules run only when the server has DHIS2_SYNC_ENABLED.',
        pushesTitle: 'DHIS2 push history', viewAll: 'View all →',
        when: 'When', action: 'Action', status: 'Status', noPushes: 'No pushes yet.',
        errorToast: 'Failed: {{error}}',
      },
```

- [ ] **Step 2: Write the failing test**

Append a test to `apps/web/src/pages/Dhis2Mappings.test.tsx`. First add `runDhis2Mapping` to the `@openldr/api` mock list at the top of the file (the `vi.mock('@/api', ...)` return) — add `runDhis2Mapping: vi.fn()`. Then append:

```ts
import { runDhis2Mapping } from '@/api';

describe('DHIS2 mappings — run dialog', () => {
  it('dry-runs a mapping and shows counts', async () => {
    (listDhis2Mappings as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'm1', name: 'Agg One', kind: 'aggregate' }]);
    (runDhis2Mapping as ReturnType<typeof vi.fn>).mockResolvedValue({ kind: 'aggregate', dryRun: true, counts: { values: 5, skipped: 1 }, skipped: [{ row: 2, reason: 'no orgUnit' }], result: null });
    render(<MemoryRouter><Dhis2Mappings /></MemoryRouter>);
    await screen.findByText('Agg One');
    fireEvent.click(screen.getByTestId('run-m1'));
    fireEvent.change(await screen.findByTestId('run-period'), { target: { value: '2026Q1' } });
    fireEvent.click(screen.getByTestId('run-dry'));
    await waitFor(() => expect(runDhis2Mapping).toHaveBeenCalledWith('m1', { period: '2026Q1', dryRun: true }));
    expect(await screen.findByText('5')).toBeTruthy(); // values count
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @openldr/web test -- --run Dhis2Mappings.test.tsx`
Expected: FAIL — `run-m1` testid absent.

- [ ] **Step 4: Add the Run action + dialog to the page**

In `apps/web/src/pages/Dhis2Mappings.tsx`:
- Add imports: `import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';` (note: there is no `DialogHeader` in this repo's dialog primitive — only `DialogTitle`/`DialogContent`), `import { Input } from '@/components/ui/input';`, and extend the `@/api` import with `runDhis2Mapping, type Dhis2RunResult, type Dhis2MappingSummary`.
- Add state inside the component:

```ts
  const [running, setRunning] = useState<Dhis2MappingSummary | null>(null);
  const [period, setPeriod] = useState('');
  const [runResult, setRunResult] = useState<Dhis2RunResult | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [runBusy, setRunBusy] = useState(false);

  const doRun = useCallback(async (dryRun: boolean) => {
    if (!running) return;
    setRunBusy(true); setRunErr(null);
    try { setRunResult(await runDhis2Mapping(running.id, { period, dryRun })); }
    catch (e) { setRunErr(e instanceof Error ? e.message : String(e)); }
    finally { setRunBusy(false); }
  }, [running, period]);
```

- In the row actions cell (next to Edit/Delete), add a Run button:

```tsx
                    <Button variant="ghost" size="sm" onClick={() => { setRunning(m); setPeriod(''); setRunResult(null); setRunErr(null); }} data-testid={`run-${m.id}`}>{t('dhis2.ops.run')}</Button>
```

- Add the dialog at the end of the component's JSX (next to the ConfirmDialog):

```tsx
        <Dialog open={running !== null} onOpenChange={(o) => { if (!o) setRunning(null); }}>
          <DialogContent className="sm:max-w-lg">
            <DialogTitle className="mb-2">{t('dhis2.ops.runTitle', { name: running?.name ?? '' })}</DialogTitle>
            <div className="grid gap-3 text-sm">
              {runErr ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">{runErr}</div> : null}
              <label className="grid gap-1">
                <span className="text-muted-foreground">{t('dhis2.ops.period')}</span>
                <Input data-testid="run-period" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder={t('dhis2.ops.periodHint')} />
              </label>
              <div className="flex gap-2">
                <Button variant="outline" data-testid="run-dry" disabled={runBusy || !period} onClick={() => void doRun(true)}>{t('dhis2.ops.dryRun')}</Button>
                <Button data-testid="run-push" disabled={runBusy || !period} onClick={() => void doRun(false)}>{t('dhis2.ops.push')}</Button>
              </div>
              {runResult ? (
                <div className="rounded-md border border-border p-3" data-testid="run-result">
                  <div>{t('dhis2.ops.values')}: <span className="font-medium">{runResult.counts.values}</span> · {t('dhis2.ops.skippedRows')}: {runResult.counts.skipped}</div>
                  {runResult.skipped.length > 0 ? <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{runResult.skipped.slice(0, 10).map((s, i) => <li key={i}>row {s.row}: {s.reason}</li>)}</ul> : null}
                  {runResult.result ? (
                    <div className="mt-2">{t('dhis2.ops.pushResult')}: <span className="font-medium">{runResult.result.status}</span> — {t('dhis2.ops.imported')} {runResult.result.imported} · {t('dhis2.ops.updated')} {runResult.result.updated} · {t('dhis2.ops.ignored')} {runResult.result.ignored} · {t('dhis2.ops.conflicts')} {runResult.result.conflicts.length}</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
```

(`useCallback`/`useState` are already imported in this file; if not, add them.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @openldr/web test -- --run Dhis2Mappings.test.tsx && pnpm --filter @openldr/web typecheck`
Expected: PASS; typecheck clean. (If the shadcn `Dialog` primitive doesn't exist, confirm `apps/web/src/components/ui/dialog.tsx` is present — it is, per SP-A/earlier usage.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/Dhis2Mappings.tsx apps/web/src/pages/Dhis2Mappings.test.tsx apps/web/src/i18n/index.ts
git commit -m "feat(dhis2): run dialog (dry-run + push) on the mappings list"
```

---

## Task 7: Web — schedules page

**Files:**
- Create: `apps/web/src/pages/Dhis2Schedules.tsx`
- Test: `apps/web/src/pages/Dhis2Schedules.test.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/pages/Dhis2.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/Dhis2Schedules.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listDhis2Schedules: vi.fn(), listDhis2Mappings: vi.fn(), createDhis2Schedule: vi.fn(), setDhis2ScheduleEnabled: vi.fn(), deleteDhis2Schedule: vi.fn() };
});
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasRole: () => true }) }));

import { listDhis2Schedules, listDhis2Mappings, setDhis2ScheduleEnabled } from '@/api';
import { Dhis2Schedules } from './Dhis2Schedules';

beforeEach(() => {
  vi.clearAllMocks();
  (listDhis2Mappings as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'm1', name: 'Agg One', kind: 'aggregate' }]);
  (listDhis2Schedules as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 's1', mappingId: 'm1', mappingName: 'Agg One', mode: 'aggregate', periodType: 'quarterly', eventDriven: false, enabled: true, lastRunAt: null, nextDueAt: null },
  ]);
});

describe('DHIS2 schedules page', () => {
  it('lists schedules and toggles enabled', async () => {
    (setDhis2ScheduleEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<MemoryRouter><Dhis2Schedules /></MemoryRouter>);
    expect(await screen.findByText('Agg One')).toBeTruthy();
    fireEvent.click(screen.getByTestId('toggle-s1'));
    await waitFor(() => expect(setDhis2ScheduleEnabled).toHaveBeenCalledWith('s1', false));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/web test -- --run Dhis2Schedules.test.tsx`
Expected: FAIL — `./Dhis2Schedules` missing.

- [ ] **Step 3: Create the page**

Create `apps/web/src/pages/Dhis2Schedules.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listDhis2Schedules, listDhis2Mappings, createDhis2Schedule, setDhis2ScheduleEnabled, deleteDhis2Schedule, type Dhis2Schedule, type Dhis2MappingSummary } from '@/api';

export function Dhis2Schedules() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Dhis2Schedule[]>([]);
  const [mappings, setMappings] = useState<Dhis2MappingSummary[]>([]);
  const [pendingDelete, setPendingDelete] = useState<Dhis2Schedule | null>(null);
  const [newMapping, setNewMapping] = useState('');
  const [newPeriod, setNewPeriod] = useState<'monthly' | 'quarterly' | 'yearly'>('monthly');
  const [newEventDriven, setNewEventDriven] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const [s, m] = await Promise.all([listDhis2Schedules(), listDhis2Mappings()]); setRows(s); setMappings(m); }
    catch (e) { setToast(t('dhis2.ops.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 5000); return () => clearTimeout(id); }, [toast]);

  const onToggle = useCallback(async (s: Dhis2Schedule) => {
    try { await setDhis2ScheduleEnabled(s.id, !s.enabled); await load(); }
    catch (e) { setToast(t('dhis2.ops.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [load, t]);
  const onCreate = useCallback(async () => {
    if (!newMapping) return;
    try { await createDhis2Schedule({ mappingId: newMapping, periodType: newPeriod, eventDriven: newEventDriven }); setNewMapping(''); await load(); }
    catch (e) { setToast(t('dhis2.ops.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [newMapping, newPeriod, newEventDriven, load, t]);
  const doDelete = useCallback(async () => {
    if (!pendingDelete) return; const s = pendingDelete; setPendingDelete(null);
    try { await deleteDhis2Schedule(s.id); await load(); }
    catch (e) { setToast(t('dhis2.ops.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [pendingDelete, load, t]);

  const sel = 'h-9 rounded-md border border-input bg-background px-2 text-sm';
  return (
    <AppShell title="DHIS2 schedules">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" data-testid="dhis2-schedules-page">
        <p className="text-xs text-muted-foreground">{t('dhis2.ops.syncNote')}</p>
        {toast ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{toast}</div> : null}

        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">{t('dhis2.ops.mapping')}</span>
            <select data-testid="new-mapping" className={sel} value={newMapping} onChange={(e) => setNewMapping(e.target.value)}>
              <option value="">—</option>
              {mappings.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">{t('dhis2.ops.periodType')}</span>
            <select data-testid="new-period" className={sel} value={newPeriod} onChange={(e) => setNewPeriod(e.target.value as 'monthly' | 'quarterly' | 'yearly')}>
              <option value="monthly">monthly</option><option value="quarterly">quarterly</option><option value="yearly">yearly</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={newEventDriven} onChange={(e) => setNewEventDriven(e.target.checked)} />{t('dhis2.ops.eventDriven')}</label>
          <Button data-testid="create-schedule" disabled={!newMapping} onClick={() => void onCreate()}>{t('dhis2.ops.create')}</Button>
        </div>

        <Table>
          <TableHeader><TableRow>
            <TableHead>{t('dhis2.ops.mapping')}</TableHead><TableHead>{t('dhis2.ops.periodType')}</TableHead>
            <TableHead>{t('dhis2.ops.eventDriven')}</TableHead><TableHead>{t('dhis2.ops.enabled')}</TableHead>
            <TableHead>{t('dhis2.ops.nextDue')}</TableHead><TableHead className="w-40" />
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t('dhis2.ops.noSchedules')}</TableCell></TableRow>
            ) : rows.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.mappingName} <Badge variant="outline" className="ml-1 text-[10px]">{s.mode}</Badge></TableCell>
                <TableCell>{s.periodType}</TableCell>
                <TableCell>{s.eventDriven ? '✓' : '—'}</TableCell>
                <TableCell>{s.enabled ? <Badge className="border-transparent bg-emerald-500/15 text-emerald-700">on</Badge> : <Badge variant="outline">off</Badge>}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{s.nextDueAt ? new Date(s.nextDueAt).toLocaleString() : '—'}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" data-testid={`toggle-${s.id}`} onClick={() => void onToggle(s)}>{s.enabled ? 'Disable' : 'Enable'}</Button>
                    <Button variant="ghost" size="sm" className="text-destructive" data-testid={`del-${s.id}`} onClick={() => setPendingDelete(s)}>{t('dhis2.ops.delete')}</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <ConfirmDialog open={pendingDelete !== null} onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
          title={t('dhis2.ops.deleteScheduleTitle')} description={t('dhis2.ops.deleteScheduleDesc')}
          confirmLabel={t('dhis2.ops.delete')} destructive onConfirm={() => { void doDelete(); }} />
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @openldr/web test -- --run Dhis2Schedules.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the route + Settings link**

In `apps/web/src/App.tsx`, add the import + route (after the mappings routes):

```ts
import { Dhis2Schedules } from '@/pages/Dhis2Schedules';
```
```tsx
      <Route path="/dhis2/schedules" element={<RequireRole role="lab_admin"><Dhis2Schedules /></RequireRole>} />
```

In `apps/web/src/pages/Dhis2.tsx`, change the Schedules count line in the Overview card. Replace:

```tsx
                <div><span className="text-muted-foreground">{t('dhis2.schedules')}: </span>{status.counts.schedules}</div>
```

with:

```tsx
                <div>
                  <span className="text-muted-foreground">{t('dhis2.schedules')}: </span>{status.counts.schedules}
                  {' '}<Link to="/dhis2/schedules" className="text-primary hover:underline" data-testid="manage-schedules">{t('dhis2.ops.schedulesManage')}</Link>
                </div>
```

(`Link` is already imported in `Dhis2.tsx`. `t('dhis2.schedules')` is the SP-A flat label and remains valid — `dhis2.schedules` is a string, not an object, so no collision.)

- [ ] **Step 6: Typecheck + run web tests**

Run: `pnpm --filter @openldr/web typecheck && pnpm --filter @openldr/web test -- --run Dhis2Schedules.test.tsx Dhis2.test.tsx`
Expected: typecheck clean; tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/Dhis2Schedules.tsx apps/web/src/pages/Dhis2Schedules.test.tsx apps/web/src/App.tsx apps/web/src/pages/Dhis2.tsx
git commit -m "feat(dhis2): schedules page + route + Settings link"
```

---

## Task 8: Web — push history page

**Files:**
- Create: `apps/web/src/pages/Dhis2Pushes.tsx`
- Test: `apps/web/src/pages/Dhis2Pushes.test.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/pages/Dhis2.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/Dhis2Pushes.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listDhis2Pushes: vi.fn() };
});
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasRole: () => true }) }));

import { listDhis2Pushes } from '@/api';
import { Dhis2Pushes } from './Dhis2Pushes';

beforeEach(() => { vi.clearAllMocks(); });

describe('DHIS2 pushes page', () => {
  it('renders push history rows', async () => {
    (listDhis2Pushes as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'p1', occurredAt: '2026-01-01T00:00:00Z', action: 'dhis2.push', entityId: 'm1', metadata: { period: '2026Q1', status: 'success', imported: 5 } },
    ]);
    render(<MemoryRouter><Dhis2Pushes /></MemoryRouter>);
    expect(await screen.findByText('dhis2.push')).toBeTruthy();
    expect(screen.getByText('m1')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/web test -- --run Dhis2Pushes.test.tsx`
Expected: FAIL — `./Dhis2Pushes` missing.

- [ ] **Step 3: Create the page**

Create `apps/web/src/pages/Dhis2Pushes.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/shell/AppShell';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listDhis2Pushes, type Dhis2Push } from '@/api';

export function Dhis2Pushes() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Dhis2Push[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void (async () => { try { setRows(await listDhis2Pushes(100)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } })(); }, []);

  return (
    <AppShell title="DHIS2 push history">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" data-testid="dhis2-pushes-page">
        {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
        <Table>
          <TableHeader><TableRow>
            <TableHead>{t('dhis2.ops.when')}</TableHead><TableHead>{t('dhis2.ops.action')}</TableHead>
            <TableHead>{t('dhis2.ops.mapping')}</TableHead><TableHead>{t('dhis2.ops.period')}</TableHead>
            <TableHead>{t('dhis2.ops.status')}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">{t('dhis2.ops.noPushes')}</TableCell></TableRow>
            ) : rows.map((p) => {
              const md = (p.metadata ?? {}) as { period?: string; status?: string };
              return (
                <TableRow key={p.id}>
                  <TableCell className="text-xs text-muted-foreground">{new Date(p.occurredAt).toLocaleString()}</TableCell>
                  <TableCell>{p.action}</TableCell>
                  <TableCell>{p.entityId}</TableCell>
                  <TableCell>{md.period ?? '—'}</TableCell>
                  <TableCell>{md.status ?? '—'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @openldr/web test -- --run Dhis2Pushes.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the route + Settings link**

In `apps/web/src/App.tsx`, add the import + route:

```ts
import { Dhis2Pushes } from '@/pages/Dhis2Pushes';
```
```tsx
      <Route path="/dhis2/pushes" element={<RequireRole role="lab_admin"><Dhis2Pushes /></RequireRole>} />
```

In `apps/web/src/pages/Dhis2.tsx`, add a "View all →" link in the recent-pushes section of the Overview card. Find the `recentPushes` heading line:

```tsx
                <div className="mb-1 font-medium">{t('dhis2.recentPushes')}</div>
```

and replace it with:

```tsx
                <div className="mb-1 flex items-center gap-2 font-medium">{t('dhis2.recentPushes')}<Link to="/dhis2/pushes" className="text-xs font-normal text-primary hover:underline" data-testid="view-all-pushes">{t('dhis2.ops.viewAll')}</Link></div>
```

- [ ] **Step 6: Typecheck + run web tests**

Run: `pnpm --filter @openldr/web typecheck && pnpm --filter @openldr/web test -- --run Dhis2Pushes.test.tsx Dhis2.test.tsx`
Expected: typecheck clean; tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/Dhis2Pushes.tsx apps/web/src/pages/Dhis2Pushes.test.tsx apps/web/src/App.tsx apps/web/src/pages/Dhis2.tsx
git commit -m "feat(dhis2): push history page + route + Settings link"
```

---

## Task 9: Full gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full gate**

Run: `pnpm turbo typecheck lint test build && pnpm depcruise`
Expected: all green. (If `@openldr/web#test` fails once under full-parallel turbo, re-run — known transient; a direct `pnpm --filter @openldr/web test -- --run` confirms.)

- [ ] **Step 2: Fix any real failures minimally and re-run.** Do not proceed until green.

- [ ] **Step 3: Commit any gate fixups (if needed)**

```bash
git add -A
git commit -m "chore(dhis2): gate fixups for SP-D"
```

---

## Notes / Out of Scope

- Editable `source.params`; advanced retry/dead-letter UI; live DHIS2 acceptance (tests use injected fakes).
