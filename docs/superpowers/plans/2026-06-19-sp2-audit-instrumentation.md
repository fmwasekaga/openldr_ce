# SP2 — Audit Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record real (actor-attributed) audit events for every mutating HTTP route — Forms (backfill), Users, Dashboards, Ontology, and Terminology admin — via one shared best-effort helper.

**Architecture:** A single `apps/server/src/audit-helper.ts` exposes `actorFromRequest(req)` and `recordAudit(ctx, req, details)`. Each route handler calls `recordAudit` after a successful mutation. Recording is best-effort (try/catch logs and swallows) so audit never breaks the audited operation. Domain stores are untouched.

**Tech Stack:** TypeScript, Fastify, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-19-sp2-audit-instrumentation-design.md`

**Conventions:** pnpm + turbo. Per-package test: `pnpm --filter @openldr/server test`; target a file with `pnpm --filter @openldr/server test -- <name>`. Full gate: `pnpm turbo typecheck lint test build` then `pnpm depcruise`. Commit after each task. `entityType`/`action` mirror the existing `form.create` convention.

---

## File Structure

- `apps/server/src/audit-helper.ts` — `actorFromRequest`, `recordAudit` (create)
- `apps/server/src/audit-helper.test.ts` — helper unit tests (create)
- `apps/server/src/forms-routes.ts` — replace `System` closure with helper (modify)
- `apps/server/src/forms-routes.test.ts` — assert real actor (modify)
- `apps/server/src/users-routes.ts` — audit create/update/status (modify)
- `apps/server/src/users-routes.test.ts` — assert audit events (modify)
- `apps/server/src/dashboards-routes.ts` — audit create/update/delete (modify)
- `apps/server/src/dashboards-routes.test.ts` — assert audit events (modify)
- `apps/server/src/ontology-routes.ts` — audit distribution delete (modify)
- `apps/server/src/ontology-routes.test.ts` — assert audit event (create)
- `apps/server/src/terminology-admin-routes.ts` — audit all mutations (modify)
- `apps/server/src/terminology-admin-routes.test.ts` — assert audit events (create)

---

## Task 1: Shared audit helper

**Files:**
- Create: `apps/server/src/audit-helper.ts`
- Create: `apps/server/src/audit-helper.test.ts`

- [ ] **Step 1: Write the failing test** — create `apps/server/src/audit-helper.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { actorFromRequest, recordAudit } from './audit-helper';
import './auth-plugin'; // req.user augmentation

const reqWith = (user: unknown) => ({ user } as unknown as FastifyRequest);

function recordingCtx() {
  const events: unknown[] = [];
  const ctx = {
    audit: { record: async (e: unknown) => { events.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
  } as unknown as AppContext;
  return { ctx, events };
}

describe('actorFromRequest', () => {
  it('maps req.user to a user actor', () => {
    const a = actorFromRequest(reqWith({ id: 'u1', username: 'ada', displayName: 'Ada', roles: ['lab_admin'] }));
    expect(a).toEqual({ actorType: 'user', actorId: 'u1', actorName: 'ada' });
  });
  it('falls back to a system actor when no req.user', () => {
    const a = actorFromRequest(reqWith(undefined));
    expect(a).toEqual({ actorType: 'system', actorId: null, actorName: 'System' });
  });
});

describe('recordAudit', () => {
  it('records an event merging actor + details', async () => {
    const { ctx, events } = recordingCtx();
    await recordAudit(ctx, reqWith({ id: 'u1', username: 'ada', displayName: null, roles: [] }), {
      action: 'thing.create', entityType: 'thing', entityId: 't1', before: null, after: { x: 1 },
    });
    expect(events).toEqual([{ actorType: 'user', actorId: 'u1', actorName: 'ada', action: 'thing.create', entityType: 'thing', entityId: 't1', before: null, after: { x: 1 } }]);
  });
  it('never throws when the store rejects (best-effort)', async () => {
    const ctx = { audit: { record: async () => { throw new Error('db down'); } }, logger: { error() {}, warn() {}, info() {} } } as unknown as AppContext;
    await expect(recordAudit(ctx, reqWith({ id: 'u1', username: 'ada', displayName: null, roles: [] }), { action: 'x', entityType: 'y', entityId: 'z' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module missing)

Run: `pnpm --filter @openldr/server test -- audit-helper`
Expected: FAIL — cannot find `./audit-helper`.

- [ ] **Step 3: Implement** — create `apps/server/src/audit-helper.ts`:

```ts
import type { FastifyRequest } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';

type AuditInput = Parameters<AppContext['audit']['record']>[0];
type Actor = Pick<AuditInput, 'actorType' | 'actorId' | 'actorName'>;

export interface AuditDetails {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

export function actorFromRequest(req: FastifyRequest): Actor {
  if (req.user) return { actorType: 'user', actorId: req.user.id, actorName: req.user.username };
  return { actorType: 'system', actorId: null, actorName: 'System' };
}

/** Best-effort audit recorder — never throws into the caller (audit must not break the op). */
export async function recordAudit(ctx: AppContext, req: FastifyRequest, d: AuditDetails): Promise<void> {
  try {
    await ctx.audit.record({ ...actorFromRequest(req), ...d } as AuditInput);
  } catch (e) {
    ctx.logger.error({ action: d.action, error: e instanceof Error ? e.message : String(e) }, 'audit record failed');
  }
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @openldr/server test -- audit-helper`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @openldr/server typecheck` → EXIT 0
```bash
git add apps/server/src/audit-helper.ts apps/server/src/audit-helper.test.ts
git commit -m "feat(audit): shared request-actor audit helper"
```

---

## Task 2: Forms — backfill the real actor

**Files:**
- Modify: `apps/server/src/forms-routes.ts`
- Modify: `apps/server/src/forms-routes.test.ts`

- [ ] **Step 1: Update the test to assert the real actor**

In `apps/server/src/forms-routes.test.ts`, the fake ctx already has a recording `audit` (the file uses `ctx.audit`). Find where the test injects requests and add an `onRequest` actor hook + an assertion on the recorded actor. Read the file first; then:
1. Where it builds the app (`const app = Fastify();`), add immediately after, before `registerFormsRoutes`:
```ts
    app.addHook('onRequest', async (req) => {
      req.user = { id: 'u-forms', username: 'former', displayName: null, roles: ['lab_admin'] };
    });
```
Add `import './auth-plugin';` at the top if not present.
2. Find the existing assertion(s) that inspect recorded audit events (search the test for `audit` / the recorded-events array). Add an assertion that a recorded form event has `actorType: 'user'`, `actorId: 'u-forms'`, `actorName: 'former'` (NOT `'System'`). If the test does not currently capture recorded events, add capture: ensure the fake `audit.record` pushes to an array the test can read, then assert the first form event's actor fields.

> Read the actual fake-ctx + assertions in `forms-routes.test.ts` and adapt these two edits to its real shape. The intent: prove forms audit now records the request actor.

- [ ] **Step 2: Run it — expect FAIL** (actor is still `System`)

Run: `pnpm --filter @openldr/server test -- forms-routes`
Expected: FAIL on the new actor assertion.

- [ ] **Step 3: Replace the System closure with the shared helper**

In `apps/server/src/forms-routes.ts`:
1. Add import: `import { recordAudit } from './audit-helper';`
2. DELETE the local `async function audit(...) { ... }` closure (lines ~30–47).
3. Replace each `await audit(action, entityId, before, after, metadata?)` call with `recordAudit(ctx, req, { action, entityType: 'form', entityId, before, after, metadata })`. The 7 sites and their exact replacements:

```ts
// POST /api/forms (create), after `const f = await ctx.forms.create(...)`:
await recordAudit(ctx, req, { action: 'form.create', entityType: 'form', entityId: f.id, before: null, after: f });
```
```ts
// PUT /api/forms/:id (update):
await recordAudit(ctx, req, { action: 'form.update', entityType: 'form', entityId: id, before, after });
```
```ts
// POST /api/forms/:id/status:
await recordAudit(ctx, req, { action: status === 'published' ? 'form.publish' : 'form.status', entityType: 'form', entityId: id, before, after });
```
```ts
// POST /api/forms/:id/publish:
await recordAudit(ctx, req, { action: 'form.publish', entityType: 'form', entityId: id, before, after });
```
```ts
// POST /api/forms/:id/duplicate:
await recordAudit(ctx, req, { action: 'form.duplicate', entityType: 'form', entityId: copy.id, before: null, after: copy, metadata: { sourceFormId: id } });
```
```ts
// DELETE /api/forms/:id:
await recordAudit(ctx, req, { action: 'form.delete', entityType: 'form', entityId: id, before, after: null });
```
```ts
// POST /api/forms/:id/responses:
await recordAudit(ctx, req, { action: 'form.response.submit', entityType: 'form', entityId: f.id, before: null, after: response, metadata: { formId: f.id } });
```
4. In POST `/api/forms/:id/publish`, change the domain publish call's actor from `actorId: null` to `actorId: req.user?.id ?? null`:
```ts
    const after = await ctx.forms.publish(id, { versionLabel: p.data.versionLabel ?? null, actorId: req.user?.id ?? null });
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @openldr/server test -- forms-routes`
Expected: PASS (actor now `u-forms`).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @openldr/server typecheck` → EXIT 0
```bash
git add apps/server/src/forms-routes.ts apps/server/src/forms-routes.test.ts
git commit -m "feat(audit): forms records the real request actor"
```

---

## Task 3: Users — audit create/update/status

**Files:**
- Modify: `apps/server/src/users-routes.ts`
- Modify: `apps/server/src/users-routes.test.ts`

- [ ] **Step 1: Add a recording audit + logger to the fake ctx and a new assertion test**

In `apps/server/src/users-routes.test.ts`, modify `fakeCtx()` so the returned object also carries a recording audit + logger and exposes the events array. Inside `fakeCtx`, before the `return`, add:
```ts
    const auditEvents: unknown[] = [];
```
and add these keys to the returned object literal (alongside `users`):
```ts
      audit: { record: async (e: unknown) => { auditEvents.push(e); return e; } },
      logger: { error() {}, warn() {}, info() {} },
      __auditEvents: auditEvents,
```
Then add a new test in the `describe('users routes', ...)` block:
```ts
  it('records audit events for create/update/status with the real actor', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req) => {
      req.user = { id: 'admin1', username: 'admin', displayName: null, roles: ['lab_admin'] };
    });
    const ctx = fakeCtx();
    registerUsersRoutes(app, ctx);
    const events = () => (ctx as unknown as { __auditEvents: Array<{ action: string; actorId: string; entityType: string }> }).__auditEvents;

    const created = await app.inject({ method: 'POST', url: '/api/users', payload: { username: 'bob', roles: [] } });
    const id = created.json().id;
    await app.inject({ method: 'PUT', url: `/api/users/${id}`, payload: { displayName: 'Bob', roles: ['lab_technician'] } });
    await app.inject({ method: 'POST', url: `/api/users/${id}/status`, payload: { status: 'disabled' } });

    const actions = events().map((e) => e.action);
    expect(actions).toEqual(['user.create', 'user.update', 'user.status']);
    expect(events().every((e) => e.actorId === 'admin1' && e.entityType === 'user')).toBe(true);
  });
```
Add `import './auth-plugin';` at the top if not already present.

- [ ] **Step 2: Run it — expect FAIL** (no events recorded)

Run: `pnpm --filter @openldr/server test -- users-routes`
Expected: FAIL — `actions` is `[]`.

- [ ] **Step 3: Instrument the routes**

In `apps/server/src/users-routes.ts`:
1. Add import: `import { recordAudit } from './audit-helper';`
2. POST `/api/users` — after `const u = await ctx.users.create({...})` and before `reply.code(201)`:
```ts
      await recordAudit(ctx, req, { action: 'user.create', entityType: 'user', entityId: u.id, before: null, after: u });
```
3. PUT `/api/users/:id` — capture before, then after the update fetch the result and audit. Replace the body after the 404 check with:
```ts
    const before = await ctx.users.get(id);
    if (p.data.roles) await ctx.users.setRoles(id, p.data.roles);
    await ctx.users.update(id, { displayName: p.data.displayName ?? undefined, email: p.data.email ?? undefined });
    const after = await ctx.users.get(id);
    await recordAudit(ctx, req, { action: 'user.update', entityType: 'user', entityId: id, before, after });
    return after;
```
4. POST `/api/users/:id/status` — capture before, set status, audit:
```ts
    const before = await ctx.users.get(id);
    await ctx.users.setStatus(id, s);
    const after = await ctx.users.get(id);
    await recordAudit(ctx, req, { action: 'user.status', entityType: 'user', entityId: id, before, after, metadata: { status: s } });
    return after;
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @openldr/server test -- users-routes`
Expected: PASS (all users-routes tests, including the new audit test).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @openldr/server typecheck` → EXIT 0
```bash
git add apps/server/src/users-routes.ts apps/server/src/users-routes.test.ts
git commit -m "feat(audit): instrument Users create/update/status"
```

---

## Task 4: Dashboards — audit create/update/delete

**Files:**
- Modify: `apps/server/src/dashboards-routes.ts`
- Modify: `apps/server/src/dashboards-routes.test.ts`

- [ ] **Step 1: Add recording audit/logger to the fake ctx + a new test**

In `apps/server/src/dashboards-routes.test.ts`, modify `fakeCtx()` to add a recording audit + logger + events array. Inside `fakeCtx`, before `return`, add `const auditEvents: any[] = [];` and add to the returned object (alongside `dashboards`):
```ts
    audit: { record: async (e: any) => { auditEvents.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
    __auditEvents: auditEvents,
```
Add a new test in `describe('dashboard routes', ...)`:
```ts
  it('audits create/update/delete with the request actor', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = { id: 'admin1', username: 'admin', displayName: null, roles: ['lab_admin'] }; });
    const ctx = fakeCtx();
    registerDashboardRoutes(app, ctx);
    const d = { id: 'd1', name: 'M', layout: [], widgets: [], filters: [], refreshIntervalSec: 0, isDefault: false, ownerId: null };
    await app.inject({ method: 'POST', url: '/api/dashboards', payload: d });
    await app.inject({ method: 'PUT', url: '/api/dashboards/d1', payload: d });
    await app.inject({ method: 'DELETE', url: '/api/dashboards/d1' });
    const events = (ctx as any).__auditEvents as Array<{ action: string; entityType: string; actorId: string }>;
    expect(events.map((e) => e.action)).toEqual(['dashboard.create', 'dashboard.update', 'dashboard.delete']);
    expect(events.every((e) => e.entityType === 'dashboard' && e.actorId === 'admin1')).toBe(true);
  });
```
Add `import './auth-plugin';` at the top.

- [ ] **Step 2: Run it — expect FAIL** (no events)

Run: `pnpm --filter @openldr/server test -- dashboards-routes`
Expected: FAIL — events empty.

- [ ] **Step 3: Instrument the routes**

In `apps/server/src/dashboards-routes.ts`:
1. Add import: `import { recordAudit } from './audit-helper';`
2. POST `/api/dashboards` (create) — capture the result, audit, return:
```ts
  app.post('/api/dashboards', async (req, reply) => {
    try {
      const created = await ctx.dashboards.store.create(DashboardSchema.parse(req.body));
      await recordAudit(ctx, req, { action: 'dashboard.create', entityType: 'dashboard', entityId: created.id, before: null, after: created });
      return created;
    } catch (err) { return mapError(err, reply); }
  });
```
3. PUT `/api/dashboards/:id` (update) — capture before + after:
```ts
  app.put('/api/dashboards/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const before = await ctx.dashboards.store.get(id);
      const updated = await ctx.dashboards.store.update(id, DashboardSchema.parse(req.body));
      await recordAudit(ctx, req, { action: 'dashboard.update', entityType: 'dashboard', entityId: id, before, after: updated });
      return updated;
    } catch (err) { return mapError(err, reply); }
  });
```
4. DELETE `/api/dashboards/:id` — capture before, audit (the handler signature gains `reply` is not needed; keep as-is but add `req` is already present):
```ts
  app.delete('/api/dashboards/:id', async (req) => {
    const { id } = req.params as { id: string };
    const before = await ctx.dashboards.store.get(id);
    await ctx.dashboards.store.remove(id);
    await recordAudit(ctx, req, { action: 'dashboard.delete', entityType: 'dashboard', entityId: id, before, after: null });
    return { ok: true };
  });
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @openldr/server test -- dashboards-routes`
Expected: PASS (all dashboard-routes tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @openldr/server typecheck` → EXIT 0
```bash
git add apps/server/src/dashboards-routes.ts apps/server/src/dashboards-routes.test.ts
git commit -m "feat(audit): instrument Dashboards create/update/delete"
```

---

## Task 5: Ontology — audit distribution delete

**Files:**
- Modify: `apps/server/src/ontology-routes.ts`
- Create: `apps/server/src/ontology-routes.test.ts`

- [ ] **Step 1: Write the failing test** — create `apps/server/src/ontology-routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { registerOntologyRoutes } from './ontology-routes';
import './auth-plugin';

function fakeCtx() {
  const auditEvents: Array<{ action: string; entityType: string; entityId: string; actorId: string | null }> = [];
  const ctx = {
    terminology: {
      ontology: {
        listDistributions: async () => [],
        getDistribution: async (id: string) => ({ id, name: 'dist' }),
        unlink: async () => {},
      },
    },
    audit: { record: async (e: any) => { auditEvents.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
  } as unknown as AppContext;
  return { ctx, auditEvents };
}

describe('ontology routes audit', () => {
  it('audits a distribution delete with the request actor', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req) => { req.user = { id: 'admin1', username: 'admin', displayName: null, roles: ['lab_admin'] }; });
    const { ctx, auditEvents } = fakeCtx();
    registerOntologyRoutes(app, ctx);
    const res = await app.inject({ method: 'DELETE', url: '/api/terminology/ontology/distributions/dist1' });
    expect(res.statusCode).toBe(204);
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]).toMatchObject({ action: 'ontology_distribution.delete', entityType: 'ontology_distribution', entityId: 'dist1', actorId: 'admin1' });
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (no event)

Run: `pnpm --filter @openldr/server test -- ontology-routes`
Expected: FAIL — `auditEvents` empty.

- [ ] **Step 3: Instrument the delete**

In `apps/server/src/ontology-routes.ts`:
1. Add import: `import { recordAudit } from './audit-helper';`
2. In `app.delete('/api/terminology/ontology/distributions/:id', ...)`, capture before via `getDistribution`, then record after unlink succeeds:
```ts
  app.delete('/api/terminology/ontology/distributions/:id', async (req, reply) => {
    const id = (req.params as IdParam).id;
    try {
      const before = await ontology.getDistribution(id).catch(() => null);
      await ontology.unlink(id);
      await recordAudit(ctx, req, { action: 'ontology_distribution.delete', entityType: 'ontology_distribution', entityId: id, before, after: null });
      reply.code(204);
      return null;
    } catch (err) {
      reply.code(500);
      return { error: redact(err instanceof Error ? err.message : String(err)) };
    }
  });
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @openldr/server test -- ontology-routes`
Expected: PASS (1 test). Also run `pnpm --filter @openldr/server test -- app` to confirm the app-level ontology tests still pass (they use `audit: {} as never`, which `recordAudit` swallows).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @openldr/server typecheck` → EXIT 0
```bash
git add apps/server/src/ontology-routes.ts apps/server/src/ontology-routes.test.ts
git commit -m "feat(audit): instrument Ontology distribution delete"
```

---

## Task 6: Terminology admin — audit all mutations

**Files:**
- Modify: `apps/server/src/terminology-admin-routes.ts`
- Create: `apps/server/src/terminology-admin-routes.test.ts`

This route file has many mutations of five shapes. Apply the canonical pattern per shape, using the per-endpoint table for exact params. before-snapshots are only taken for value sets (the admin store exposes `valueSets.get(id)`); publishers/systems/terms/mappings record `after`/`metadata` only (the admin store has no single-entity get — best-effort, per spec).

**`entityType` / `action` / `entityId` table:**

| Route | action | entityType | entityId | before | after | metadata |
|---|---|---|---|---|---|---|
| POST publishers | `publisher.create` | `publisher` | `created.id` | null | `created` | — |
| PUT publishers/:id | `publisher.update` | `publisher` | `:id` | null | `updated` | — |
| DELETE publishers/:id | `publisher.delete` | `publisher` | `:id` | null | null | — |
| POST systems | `coding_system.create` | `coding_system` | `created.id` | null | `created` | — |
| PUT systems/:id | `coding_system.update` | `coding_system` | `:id` | null | `updated` | — |
| DELETE systems/:id | `coding_system.delete` | `coding_system` | `:id` | null | null | — |
| POST import/loinc | `coding_system.import` | `coding_system` | `'loinc'` | null | null | `{ source: 'loinc', result }` |
| POST systems/:id/terms | `term.create` | `term` | `created.code` | null | `created` | `{ system: url }` |
| PUT systems/:id/terms/:code | `term.update` | `term` | `code` | null | `updated` | `{ system: url }` |
| DELETE systems/:id/terms/:code | `term.delete` | `term` | `code` | null | null | `{ system: url }` |
| POST systems/:id/terms/import | `term.import` | `term` | `:id` | null | null | `{ result }` |
| POST terms/:system/:code/mappings | `term_mapping.create` | `term_mapping` | `created.id` | null | `created` | — |
| PUT mappings/:id | `term_mapping.update` | `term_mapping` | `:id` | null | `updated` | — |
| DELETE mappings/:id | `term_mapping.delete` | `term_mapping` | `:id` | null | null | — |
| POST valuesets | `value_set.create` | `value_set` | `saved.id` | null | `saved` | — |
| PUT valuesets/:id | `value_set.update` | `value_set` | `:id` | `before` | `saved` | — |
| DELETE valuesets/:id | `value_set.delete` | `value_set` | `:id` | `before` | null | — |
| POST valuesets/:id/duplicate | `value_set.duplicate` | `value_set` | `dup.id` | null | `dup` | `{ sourceId: :id }` |
| POST valuesets/import | `value_set.import` | `value_set` | `result.id ?? 'catalog'` | null | `result`/`saved` | — |

- [ ] **Step 1: Write the failing test** — create `apps/server/src/terminology-admin-routes.test.ts`. It builds a bare Fastify with a minimal recording fake `ctx.terminology.admin` covering the asserted routes:

```ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { registerTerminologyAdminRoutes } from './terminology-admin-routes';
import './auth-plugin';

function fakeCtx() {
  const auditEvents: Array<{ action: string; entityType: string; entityId: string; actorId: string | null }> = [];
  const admin = {
    publishers: {
      create: async (d: any) => ({ id: 'pub1', ...d }),
      update: async (id: string, d: any) => ({ id, ...d }),
      delete: async () => {},
    },
    codingSystems: {
      list: async () => [],
      create: async (d: any) => ({ id: 'sys1', ...d }),
      update: async (id: string, d: any) => ({ id, ...d }),
      delete: async () => {},
    },
    valueSets: {
      get: async (id: string) => ({ id, url: 'u' }),
      save: async (d: any) => ({ id: 'vs1', ...d }),
      delete: async () => {},
      duplicate: async (id: string) => ({ id: 'vs2', sourceId: id }),
    },
  };
  const ctx = {
    terminology: { admin },
    audit: { record: async (e: any) => { auditEvents.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
  } as unknown as AppContext;
  return { ctx, auditEvents };
}

function appWith(ctx: AppContext) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => { req.user = { id: 'admin1', username: 'admin', displayName: null, roles: ['lab_admin'] }; });
  registerTerminologyAdminRoutes(app, ctx);
  return app;
}

describe('terminology admin audit', () => {
  it('audits publisher create with the request actor', async () => {
    const { ctx, auditEvents } = fakeCtx();
    const app = appWith(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/terminology/publishers', payload: { name: 'P', role: 'local' } });
    expect(res.statusCode).toBe(201);
    expect(auditEvents[0]).toMatchObject({ action: 'publisher.create', entityType: 'publisher', entityId: 'pub1', actorId: 'admin1' });
  });

  it('audits coding system delete', async () => {
    const { ctx, auditEvents } = fakeCtx();
    const app = appWith(ctx);
    const res = await app.inject({ method: 'DELETE', url: '/api/terminology/systems/sys9' });
    expect(res.statusCode).toBe(204);
    expect(auditEvents[0]).toMatchObject({ action: 'coding_system.delete', entityType: 'coding_system', entityId: 'sys9' });
  });

  it('audits value set update with a before snapshot', async () => {
    const { ctx, auditEvents } = fakeCtx();
    const app = appWith(ctx);
    const res = await app.inject({ method: 'PUT', url: '/api/terminology/valuesets/vs1', payload: { url: 'u', status: 'active', compose: {} } });
    expect(res.statusCode).toBe(200);
    expect(auditEvents[0]).toMatchObject({ action: 'value_set.update', entityType: 'value_set', entityId: 'vs1' });
    expect(auditEvents[0]).toHaveProperty('before');
  });

  it('best-effort: a failing audit recorder does not break the route', async () => {
    const { ctx } = fakeCtx();
    (ctx as any).audit.record = async () => { throw new Error('db down'); };
    const app = appWith(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/terminology/publishers', payload: { name: 'P', role: 'local' } });
    expect(res.statusCode).toBe(201);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (no events)

Run: `pnpm --filter @openldr/server test -- terminology-admin-routes`
Expected: FAIL — `auditEvents` empty.

- [ ] **Step 3: Instrument the routes**

In `apps/server/src/terminology-admin-routes.ts`, add import `import { recordAudit } from './audit-helper';`. Then apply the canonical pattern per shape. **Canonical shapes (full code):**

*Create (inline → capture result):*
```ts
  app.post('/api/terminology/publishers', async (req, reply) => {
    const parsed = publisherInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    const created = await admin.publishers.create(parsed.data);
    await recordAudit(ctx, req, { action: 'publisher.create', entityType: 'publisher', entityId: created.id, before: null, after: created });
    reply.code(201);
    return created;
  });
```
*Update (in try):*
```ts
  app.put('/api/terminology/publishers/:id', async (req, reply) => {
    const parsed = publisherInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try {
      const updated = await admin.publishers.update((req.params as IdParam).id, parsed.data);
      await recordAudit(ctx, req, { action: 'publisher.update', entityType: 'publisher', entityId: (req.params as IdParam).id, before: null, after: updated });
      return updated;
    } catch (e) { return mapErr(e, reply); }
  });
```
*Delete (in try):*
```ts
  app.delete('/api/terminology/publishers/:id', async (req, reply) => {
    try {
      await admin.publishers.delete((req.params as IdParam).id);
      await recordAudit(ctx, req, { action: 'publisher.delete', entityType: 'publisher', entityId: (req.params as IdParam).id, before: null, after: null });
      reply.code(204); return null;
    } catch (e) { return mapErr(e, reply); }
  });
```
*Value-set update with before (uses `admin.valueSets.get`):*
```ts
  app.put('/api/terminology/valuesets/:id', async (req, reply) => {
    const parsed = valueSetInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try {
      const id = (req.params as IdParam).id;
      const before = await admin.valueSets.get(id).catch(() => null);
      const saved = await admin.valueSets.save(parsed.data);
      await recordAudit(ctx, req, { action: 'value_set.update', entityType: 'value_set', entityId: id, before, after: saved });
      return saved;
    } catch (e) { return mapErr(e, reply); }
  });
```
*Value-set delete with before:*
```ts
  app.delete('/api/terminology/valuesets/:id', async (req, reply) => {
    try {
      const id = (req.params as IdParam).id;
      const before = await admin.valueSets.get(id).catch(() => null);
      await admin.valueSets.delete(id);
      await recordAudit(ctx, req, { action: 'value_set.delete', entityType: 'value_set', entityId: id, before, after: null });
      reply.code(204); return null;
    } catch (e) { return mapErr(e, reply); }
  });
```
*Import (counts in metadata) — LOINC:*
```ts
    try {
      const result = await ctx.terminology.loaders.loinc(parsed.data.path, parsed.data.acceptLicense);
      await recordAudit(ctx, req, { action: 'coding_system.import', entityType: 'coding_system', entityId: 'loinc', before: null, after: null, metadata: { source: 'loinc', result } });
      return result;
    } catch (e) { return mapErr(e, reply); }
```

Apply the same shapes to every remaining row in the table:
- **coding systems** create/update/delete — identical to publishers with `entityType: 'coding_system'`, `action: 'coding_system.*'`, `entityId: created.id`/`:id`.
- **terms**: create → after `const created = await admin.terms.create({ system: url, ...parsed.data })`, record `{ action: 'term.create', entityType: 'term', entityId: created.code, before: null, after: created, metadata: { system: url } }`; update → capture `const updated = await admin.terms.update(url, code, {...})`, record `{ action: 'term.update', entityType: 'term', entityId: code, before: null, after: updated, metadata: { system: url } }`; delete → after `admin.terms.delete(url, code)`, record `{ action: 'term.delete', entityType: 'term', entityId: code, before: null, after: null, metadata: { system: url } }`.
- **terms import** (POST systems/:id/terms/import): record once after the import returns `result`: `{ action: 'term.import', entityType: 'term', entityId: (req.params as IdParam).id, before: null, after: null, metadata: { result } }` (capture the return value of `importTermRowsInBatches(...)` into `result`, audit, then return it).
- **mappings**: create → `const created = await admin.termMappings.create({...})`, record `{ action: 'term_mapping.create', entityType: 'term_mapping', entityId: created.id, before: null, after: created }`; update → `const updated = await admin.termMappings.update(id, {...})`, record `{ action: 'term_mapping.update', entityType: 'term_mapping', entityId: id, before: null, after: updated }`; delete → record `{ action: 'term_mapping.delete', entityType: 'term_mapping', entityId: id, before: null, after: null }`.
- **value sets create** (POST valuesets): `const saved = await admin.valueSets.save(parsed.data)`, record `{ action: 'value_set.create', entityType: 'value_set', entityId: saved.id, before: null, after: saved }`, then `reply.code(201); return saved;`.
- **value set duplicate**: `const dup = await admin.valueSets.duplicate(id)`, record `{ action: 'value_set.duplicate', entityType: 'value_set', entityId: dup.id, before: null, after: dup, metadata: { sourceId: id } }`, `reply.code(201); return dup;`.
- **value sets import** (POST valuesets/import): in both branches, capture the returned value (`result` for catalog, `saved` for single), record `{ action: 'value_set.import', entityType: 'value_set', entityId: (result?.id ?? 'catalog'), before: null, after: <returned>, }` — use a sensible entityId (`saved.id` for the single-resource branch, `'catalog'` for the catalog branch), then return as before.

Each `recordAudit` goes AFTER the successful store call and BEFORE the `reply.code(...)`/`return`. Do not audit the validation-failure (`400`) or `mapErr` (`404/409/500`) paths.

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @openldr/server test -- terminology-admin-routes`
Expected: PASS (4 tests). Then `pnpm --filter @openldr/server test -- app` to confirm app-level terminology tests still pass (audit swallowed via `{} as never`).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @openldr/server typecheck` → EXIT 0
```bash
git add apps/server/src/terminology-admin-routes.ts apps/server/src/terminology-admin-routes.test.ts
git commit -m "feat(audit): instrument Terminology admin mutations"
```

---

## Task 7: Full gate + final review

- [ ] **Step 1: Full gate**

Run: `pnpm turbo typecheck lint test build`
Expected: all tasks PASS.

- [ ] **Step 2: depcruise**

Run: `pnpm depcruise`
Expected: no violations.

- [ ] **Step 3: Commit any fixups** (skip if clean)

```bash
git add -A
git commit -m "chore(audit): SP2 full-gate fixups"
```

---

## Self-Review notes (coverage vs spec)

- Spec §a shared helper → Task 1. §b conventions → applied in Tasks 2–6 (entityType/action table in Task 6).
- §c per-file: Forms backfill + publish actorId → Task 2; Users → Task 3; Dashboards → Task 4; Ontology delete → Task 5; Terminology admin (~17 mutations) → Task 6.
- §Testing: recording-audit fakes + actor assertions in every task; best-effort (throwing recorder) tested in Tasks 1 and 6; Forms asserts real actor (Task 2). App-level terminology/ontology tests confirmed still green (audit swallowed).
- §Out of scope honored: no DHIS2 (no routes), no read-only routes, no ontology build/rebuild SSE.
- §Acceptance: full gate + depcruise → Task 7.
