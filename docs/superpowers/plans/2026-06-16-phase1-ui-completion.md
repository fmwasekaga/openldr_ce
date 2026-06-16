# Phase-1 UI Completion — Users, Audit, Forms (Slice A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the three parked Phase-1 SPA surfaces — **Users**, **Audit**, and **Forms** — by adding their REST routes + pages (engines already exist), plus a Forms persistence layer (Slice A: store + list + runtime capture). The full drag-drop Form **Builder** is Slice B (separate plan).

**Architecture:** Routes go through `ctx.users`/`ctx.audit`/`ctx.forms` (DP-1 — `apps/server` never imports `@openldr/db`; errors via `redact()`). Audit gets a tiny store extension (offset + count). Forms gets a new `form_definitions` table + `createFormStore` in `@openldr/forms` + `ctx.forms`. Pages reuse the shadcn primitives + table/pagination/sheet patterns from SP1–SP4. Spec: `docs/superpowers/specs/2026-06-16-phase1-ui-completion-design.md`.

**Tech Stack:** pnpm/turbo TS monorepo, Kysely (Postgres), pg-mem (tests), Fastify, Zod, Vitest, React + Vite + Radix/shadcn, Playwright.

**Conventions (carried from SP1–SP4 — do not relitigate):**
- pg-mem: jsonb via `JSON.stringify`; no `ILIKE` (use `` sql`lower(x)` `` `like`); `db.transaction()`/`` sql`now()` `` work.
- `apps/server` has **no** `@openldr/db` dep → routes use `ctx.*`; wrap errors in `redact()`.
- Always shadcn primitives in `apps/web` (`Table`/`TablePagination`/`Sheet`/`Dialog`/`Popover`/`DropdownMenu`/`Badge`/`Input`/`Select`); reuse the ones SP1–SP4 added.
- Gates from repo root: `pnpm turbo typecheck lint test build` + `pnpm depcruise`.
- corlix is the design source of truth (`apps/desktop/src/renderer/pages/{UsersPage,AuditLogPage,FormListPage}.tsx`, `components/UserDialog.tsx`, `components/FormRenderer.tsx`). Port layout/behavior faithfully; `window.api.*`→`api.ts` fns, `t()`→English literals. State any divergence in a comment.
- **Read-before-write:** the `@openldr/forms` engine signatures are not reproduced here — Tasks 7/9/11 say to read `packages/forms/src/index.ts` exports (form-schema types, `validateAnswers`, `visibility`, `response`, `toQuestionnaire`, `samples/forms`) and use them as-is.

---

## File Structure

**Create:** `apps/server/src/{users,audit,forms}-routes.ts`; `packages/db/src/migrations/internal/016_form_definitions.ts` (+ test); `packages/forms/src/store.ts` (+ test); `apps/web/src/pages/{Users,Audit,Forms,FormCapture}.tsx`; `apps/web/src/users/UserDialog.tsx`; `e2e/tests/{users,audit,forms}.spec.ts`; `packages/cli/src/{users,audit,forms}.ts`.

**Modify:** `packages/audit/src/store.ts` (+ test); `packages/db/src/schema/internal.ts`, `…/migrations/internal/index.ts`, `packages/db/src/index.ts`; `packages/forms/src/index.ts`, `packages/forms/package.json`; `packages/bootstrap/src/index.ts`; `apps/server/src/app.ts`; `apps/web/src/api.ts`, `apps/web/src/shell/AppShell.tsx`, `apps/web/src/App.tsx`; `packages/cli/src/index.ts`.

---

## Task 1: Audit store — offset + count

**Files:** `packages/audit/src/store.ts` (+ `store.test.ts`).

- [ ] **Step 1: Test first.** Add to `store.test.ts`: `record` 5 events (varied action/entityType), assert `list({ limit: 2, offset: 2 })` returns the right newest-first slice and `count({})` === 5, and a filtered `count({ action })` matches.

- [ ] **Step 2: Implement.** Add `offset?: number` to `AuditFilter`; in `list`, add `.offset(filter.offset ?? 0)` after `.limit(...)`. Add `count(filter)` reusing the same WHERE chain (extract a local `applyFilter(q, filter)` used by both `list` and `count`):
```ts
export interface AuditStore {
  record(e: AuditEventInput): Promise<AuditEvent>;
  list(filter?: AuditFilter): Promise<AuditEvent[]>;
  count(filter?: AuditFilter): Promise<number>;
  get(id: string): Promise<AuditEvent | undefined>;
}
// count(): apply the same where() chain, then:
//   const r = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
//   return Number(r?.n ?? 0);
```

- [ ] **Step 3:** `pnpm --filter @openldr/audit test` → PASS. Commit `feat(audit): list offset + count for pagination (P1-AUD)`.

---

## Task 2: Audit REST routes

**Files:** Create `apps/server/src/audit-routes.ts`; register in `apps/server/src/app.ts`.

- [ ] **Step 1:** Implement (mirror the `redact` pattern of `terminology-admin-routes.ts`):
```ts
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { redact } from '@openldr/core';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerAuditRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  app.get('/api/audit', async (req, reply) => {
    try {
      const q = req.query as Record<string, string>;
      const filter = {
        action: q.action || undefined, entityType: q.entityType || undefined, entityId: q.entityId || undefined,
        actorId: q.actorId || undefined, from: q.from || undefined, to: q.to || undefined,
        limit: q.limit ? Number(q.limit) : 50, offset: q.offset ? Number(q.offset) : 0,
      };
      const [events, total] = await Promise.all([ctx.audit.list(filter), ctx.audit.count(filter)]);
      return { events, total };
    } catch (e) { reply.code(500); return { error: redact(e instanceof Error ? e.message : String(e)) }; }
  });
  app.get('/api/audit/:id', async (req, reply) => {
    const ev = await ctx.audit.get((req.params as { id: string }).id);
    if (!ev) { reply.code(404); return { error: 'not found' }; }
    return ev;
  });
}
```

- [ ] **Step 2:** In `app.ts` import + call `registerAuditRoutes(app, ctx)` alongside the others.

- [ ] **Step 3:** Typecheck + a server contract test (seed via `ctx.audit.record`, GET `/api/audit` returns `{events,total}`, a filter narrows, `:id` 404 on a bad id). Commit `feat(server): audit REST routes (P1-AUD)`.

---

## Task 3: Audit page

**Files:** `apps/web/src/api.ts`; `apps/web/src/pages/Audit.tsx`; `apps/web/src/App.tsx`; `e2e/tests/audit.spec.ts`.

- [ ] **Step 1: api.ts** — types + client (reuse the existing `apiGet` helper):
```ts
export interface AuditEvent { id: string; occurredAt: string; actorType: 'user'|'system'; actorId: string|null; actorName: string; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown; metadata?: Record<string, unknown> }
export interface AuditQuery { action?: string; entityType?: string; entityId?: string; actorId?: string; from?: string; to?: string; limit?: number; offset?: number }
export const queryAudit = (q: AuditQuery): Promise<{ events: AuditEvent[]; total: number }> => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v != null && v !== '') p.set(k, String(v));
  return apiGet(`/api/audit?${p.toString()}`);
};
export const getAuditEvent = (id: string): Promise<AuditEvent> => apiGet(`/api/audit/${id}`);
```

- [ ] **Step 2: Audit.tsx** — port corlix `AuditLogPage`. AppShell page; filter `Popover` (action/entityType/entityId/actor/from/to, draft→Apply, chips, Reset); `Table` (Timestamp · Actor=actorName · Action badge[`tamper`/`delete`→destructive, else muted] · Entity type · Entity ID) + `TablePagination` (limit/offset, total); row-click → right `Sheet` detail showing the fields + pretty-printed Before/After/Metadata JSON with copy buttons. English literals; shadcn only.

- [ ] **Step 3: route** in `App.tsx`: `<Route path="/audit" element={<Audit />} />`.

- [ ] **Step 4: e2e** `audit.spec.ts`: the audited DB may have events from other flows — assert the page renders the table + that opening the filter popover and applying a filter issues an API call and updates rows (or shows the empty state). Keep resilient; don't depend on specific seeded events.

- [ ] **Step 5:** Typecheck + commit `feat(web): Audit log page (P1-AUD)`.

---

## Task 4: Users REST routes

**Files:** Create `apps/server/src/users-routes.ts`; register in `app.ts`. (May also add `UserStore.update`.)

- [ ] **Step 1:** Implement (zod; `ctx.users`):
```ts
import { z } from 'zod';
import { redact } from '@openldr/core';
const createInput = z.object({ username: z.string().min(1), displayName: z.string().nullish(), email: z.string().nullish(), roles: z.array(z.string()).optional() });
const updateInput = z.object({ displayName: z.string().nullish(), email: z.string().nullish(), roles: z.array(z.string()).optional() });

export function registerUsersRoutes(app, ctx) {
  app.get('/api/users', async () => ctx.users.list());
  app.get('/api/users/:id', async (req, reply) => { const u = await ctx.users.get((req.params as {id:string}).id); if (!u) { reply.code(404); return { error: 'not found' }; } return u; });
  app.post('/api/users', async (req, reply) => {
    const p = createInput.safeParse(req.body); if (!p.success) { reply.code(400); return { error: p.error.message }; }
    try { const u = await ctx.users.create({ username: p.data.username, displayName: p.data.displayName ?? undefined, email: p.data.email ?? undefined, roles: p.data.roles }); reply.code(201); return u; }
    catch (e) { reply.code(409); return { error: redact(e instanceof Error ? e.message : String(e)) }; }
  });
  app.put('/api/users/:id', async (req, reply) => {
    const p = updateInput.safeParse(req.body); if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const id = (req.params as {id:string}).id; if (!(await ctx.users.get(id))) { reply.code(404); return { error: 'not found' }; }
    if (p.data.roles) await ctx.users.setRoles(id, p.data.roles);
    await ctx.users.update(id, { displayName: p.data.displayName ?? undefined, email: p.data.email ?? undefined });
    return ctx.users.get(id);
  });
  app.post('/api/users/:id/status', async (req, reply) => {
    const s = (req.body as { status?: string }).status;
    if (s !== 'active' && s !== 'disabled') { reply.code(400); return { error: 'status must be active|disabled' }; }
    const id = (req.params as {id:string}).id; if (!(await ctx.users.get(id))) { reply.code(404); return { error: 'not found' }; }
    await ctx.users.setStatus(id, s); return ctx.users.get(id);
  });
}
```

- [ ] **Step 2: Add `UserStore.update`.** `UserStore` has no `update`. Add it to `packages/users/src/store.ts` (`update(id, { displayName?, email? })` → `UPDATE users SET display_name=?, email=?, updated_at=now()`, only setting provided fields) + a unit test. Add it to the `UserStore` interface.

- [ ] **Step 3:** Register in `app.ts`. Typecheck + contract test (create → list shows it → PUT roles/displayName → status disable → get reflects). Commit `feat(server): users REST routes + UserStore.update (P1-USER)`.

---

## Task 5: Users page + dialog

**Files:** `apps/web/src/api.ts`; `apps/web/src/pages/Users.tsx`; `apps/web/src/users/UserDialog.tsx`; `App.tsx`; `e2e/tests/users.spec.ts`.

- [ ] **Step 1: api.ts** — types + client:
```ts
export interface User { id: string; subject: string|null; username: string; displayName: string|null; email: string|null; roles: string[]; status: 'active'|'disabled'; lastLoginAt: string|null }
export interface CreateUserInput { username: string; displayName?: string|null; email?: string|null; roles?: string[] }
export const listUsers = (): Promise<User[]> => apiGet('/api/users');
export const createUser = (i: CreateUserInput): Promise<User> => apiPost('/api/users', i);
export const updateUser = (id: string, i: { displayName?: string|null; email?: string|null; roles?: string[] }): Promise<User> => apiPut(`/api/users/${id}`, i);
export const setUserStatus = (id: string, status: 'active'|'disabled'): Promise<User> => apiPost(`/api/users/${id}/status`, { status });
export const USER_ROLES = ['lab_admin','lab_manager','lab_technician','data_analyst','system_auditor'] as const;
```

- [ ] **Step 2: Users.tsx** — port corlix `UsersPage` (minus reset/logout/bulk-import; stated divergence). Toolbar: search (username/displayName) + "New user". `Table` (Username · Full name · Email · Roles pills sorted by `USER_ROLES` · Status badge[Active=emerald/Disabled=gray] · Last login · `⋯`[Edit / Enable|Disable]) + `TablePagination`; inline action-error banner (TermsTable pattern).

- [ ] **Step 3: UserDialog.tsx** — right `Sheet`. Create: username (required) + displayName + email + roles (chip multi-select from `USER_ROLES`, free-add allowed). Edit: username read-only + displayName/email/roles + status toggle. shadcn only.

- [ ] **Step 4: route** `<Route path="/users" element={<Users />} />`. **e2e** `users.spec.ts`: New user `E2E${RUN}` → row appears → `⋯` → Disable → status badge shows Disabled.

- [ ] **Step 5:** Typecheck + commit `feat(web): Users management page (P1-USER)`.

---

## Task 6: Migration 016 — form_definitions

**Files:** `packages/db/src/migrations/internal/016_form_definitions.ts` (+ test); `…/index.ts`; `schema/internal.ts`.

- [ ] **Step 1: Migration**:
```ts
import { type Kysely, sql } from 'kysely';
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('form_definitions').ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('version_label', 'text')
    .addColumn('fhir_resource_type', 'text')
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('draft'))
    .addColumn('active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('schema', 'jsonb', (c) => c.notNull())
    .addColumn('target_pages', 'jsonb')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('form_definitions_status').ifNotExists().on('form_definitions').column('status').execute();
}
export async function down(db: Kysely<unknown>): Promise<void> { await db.schema.dropTable('form_definitions').ifExists().execute(); }
```

- [ ] **Step 2: Register** `m016` in `…/index.ts`. **Schema type** in `schema/internal.ts`: `FormDefinitionsTable { id: string; name: string; version_label: string|null; fhir_resource_type: string|null; status: string; active: boolean; schema: unknown; target_pages: unknown|null; created_at: string; updated_at: string }` + register `form_definitions`.

- [ ] **Step 3: Test** (`makeMigratedDb`): insert + read back a row (schema via `JSON.stringify`). `pnpm --filter @openldr/db test -- 016_form_definitions` → PASS.

- [ ] **Step 4:** Commit `feat(db): form_definitions table (migration 016) (P1-FORM)`.

---

## Task 7: Form store

**Files:** `packages/forms/src/store.ts` (+ test); `packages/forms/src/index.ts`; `packages/forms/package.json`.

- [ ] **Step 1: Read the engine.** Open `packages/forms/src/index.ts` + `schema/form-schema.ts` for the exact `FormSchema`/`FormField` export names; use those types. Add `@openldr/db` to `packages/forms/package.json` dependencies (audit/users already do this — copy the version spec they use).

- [ ] **Step 2: Tests (pg-mem).** create → get (schema round-trips) → update → setStatus('published') → `list` has `fieldCount = schema.fields.length` → `listPublished()` returns only active+published → delete removes it.

- [ ] **Step 3: Implement** `createFormStore(db: Kysely<InternalSchema>)`:
```ts
import { randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import type { FormSchema } from './schema/form-schema'; // confirm the exact exported name

export interface FormDefinition { id: string; name: string; versionLabel: string|null; fhirResourceType: string|null; status: string; active: boolean; schema: FormSchema; targetPages: string[]|null; createdAt: string; updatedAt: string }
export interface FormSummary { id: string; name: string; versionLabel: string|null; status: string; active: boolean; fhirResourceType: string|null; fieldCount: number; updatedAt: string }
export interface FormInput { name: string; versionLabel?: string|null; fhirResourceType?: string|null; status?: string; active?: boolean; schema: FormSchema; targetPages?: string[]|null }

export function createFormStore(db: Kysely<InternalSchema>) {
  const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
  const row = (r: any): FormDefinition => ({ id: r.id, name: r.name, versionLabel: r.version_label, fhirResourceType: r.fhir_resource_type, status: r.status, active: r.active, schema: parse(r.schema), targetPages: r.target_pages ? parse(r.target_pages) : null, createdAt: r.created_at, updatedAt: r.updated_at });
  const summary = (r: any): FormSummary => { const s = parse(r.schema); return { id: r.id, name: r.name, versionLabel: r.version_label, status: r.status, active: r.active, fhirResourceType: r.fhir_resource_type, fieldCount: Array.isArray(s?.fields) ? s.fields.length : 0, updatedAt: r.updated_at }; };
  async function get(id: string): Promise<FormDefinition | null> {
    const r = await db.selectFrom('form_definitions').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? row(r) : null;
  }
  return {
    get,
    async list(): Promise<FormSummary[]> { return (await db.selectFrom('form_definitions').selectAll().orderBy('updated_at', 'desc').execute()).map(summary); },
    async listPublished(targetPage?: string): Promise<FormSummary[]> {
      const rows = await db.selectFrom('form_definitions').selectAll().where('status', '=', 'published').where('active', '=', true).orderBy('name').execute();
      if (!targetPage) return rows.map(summary);
      return rows.filter((r) => { const t = r.target_pages ? parse(r.target_pages) : null; return Array.isArray(t) && t.includes(targetPage); }).map(summary);
    },
    async create(input: FormInput): Promise<FormDefinition> {
      const id = `form-${randomUUID()}`;
      await db.insertInto('form_definitions').values({ id, name: input.name, version_label: input.versionLabel ?? null, fhir_resource_type: input.fhirResourceType ?? null, status: input.status ?? 'draft', active: input.active ?? true, schema: JSON.stringify(input.schema) as never, target_pages: input.targetPages ? (JSON.stringify(input.targetPages) as never) : null } as never).execute();
      return (await get(id))!;
    },
    async update(id: string, input: FormInput): Promise<FormDefinition> {
      await db.updateTable('form_definitions').set({ name: input.name, version_label: input.versionLabel ?? null, fhir_resource_type: input.fhirResourceType ?? null, schema: JSON.stringify(input.schema) as never, target_pages: input.targetPages ? (JSON.stringify(input.targetPages) as never) : null, updated_at: sql`now()` }).where('id', '=', id).execute();
      return (await get(id))!;
    },
    async setStatus(id: string, status: 'draft'|'published'|'archived'): Promise<FormDefinition> {
      await db.updateTable('form_definitions').set({ status, updated_at: sql`now()` }).where('id', '=', id).execute();
      return (await get(id))!;
    },
    async delete(id: string): Promise<void> { await db.deleteFrom('form_definitions').where('id', '=', id).execute(); },
  };
}
export type FormStore = ReturnType<typeof createFormStore>;
```
Export from `index.ts` (`export * from './store';`).

- [ ] **Step 4:** `pnpm --filter @openldr/forms test -- store` → PASS. Commit `feat(forms): form_definitions store (P1-FORM)`.

---

## Task 8: Bootstrap ctx.forms

**Files:** `packages/bootstrap/src/index.ts`.

- [ ] **Step 1:** Import `createFormStore, type FormStore` from `@openldr/forms`; add `forms: FormStore` to `AppContext`; `const forms = createFormStore(internal.db);` near `audit`/`users`; add `forms` to the returned object. (Check for a second wiring site like `terminology-context.ts` — forms is app-level, so `index.ts` is the place; add elsewhere only if a lighter context needs it for the CLI in Task 13.)

- [ ] **Step 2:** `pnpm --filter @openldr/bootstrap typecheck` → PASS. Commit `feat(bootstrap): wire ctx.forms (P1-FORM)`.

---

## Task 9: Forms REST routes

**Files:** Create `apps/server/src/forms-routes.ts`; register in `app.ts`.

- [ ] **Step 1: Verify the engine API.** Read `packages/forms/src/index.ts` for the exact `toQuestionnaire` / `validateAnswers` names + signatures + return shapes, and any response/bundle builder. Then implement:
```ts
import { z } from 'zod';
import { redact } from '@openldr/core';
import { toQuestionnaire, validateAnswers } from '@openldr/forms'; // adjust to the real exports

const formInput = z.object({ name: z.string().min(1), versionLabel: z.string().nullish(), fhirResourceType: z.string().nullish(), status: z.string().optional(), active: z.boolean().optional(), schema: z.object({}).passthrough(), targetPages: z.array(z.string()).nullish() });

export function registerFormsRoutes(app, ctx) {
  app.get('/api/forms', async () => ctx.forms.list());
  app.get('/api/forms/published', async (req) => ctx.forms.listPublished((req.query as Record<string,string>).targetPage || undefined));
  app.get('/api/forms/:id', async (req, reply) => { const f = await ctx.forms.get((req.params as {id:string}).id); if (!f) { reply.code(404); return { error: 'not found' }; } return f; });
  app.post('/api/forms', async (req, reply) => { const p = formInput.safeParse(req.body); if (!p.success) { reply.code(400); return { error: p.error.message }; } reply.code(201); return ctx.forms.create(p.data as never); });
  app.put('/api/forms/:id', async (req, reply) => { const p = formInput.safeParse(req.body); if (!p.success) { reply.code(400); return { error: p.error.message }; } const id=(req.params as {id:string}).id; if (!(await ctx.forms.get(id))) { reply.code(404); return { error: 'not found' }; } return ctx.forms.update(id, p.data as never); });
  app.post('/api/forms/:id/status', async (req, reply) => { const s=(req.body as {status?:string}).status; if (!['draft','published','archived'].includes(s ?? '')) { reply.code(400); return { error: 'bad status' }; } const id=(req.params as {id:string}).id; if (!(await ctx.forms.get(id))) { reply.code(404); return { error: 'not found' }; } return ctx.forms.setStatus(id, s as never); });
  app.delete('/api/forms/:id', async (req, reply) => { await ctx.forms.delete((req.params as {id:string}).id); reply.code(204); return null; });
  app.get('/api/forms/:id/questionnaire', async (req, reply) => { const f = await ctx.forms.get((req.params as {id:string}).id); if (!f) { reply.code(404); return { error: 'not found' }; } try { return toQuestionnaire(f.schema as never); } catch (e) { reply.code(500); return { error: redact(e instanceof Error ? e.message : String(e)) }; } });
  app.post('/api/forms/:id/responses', async (req, reply) => {
    const f = await ctx.forms.get((req.params as {id:string}).id); if (!f) { reply.code(404); return { error: 'not found' }; }
    const answers = (req.body as { answers?: unknown }).answers ?? {};
    try {
      const errors = validateAnswers(f.schema as never, answers as never); // adapt to the real return shape (object map vs array)
      const hasErrors = Array.isArray(errors) ? errors.length > 0 : errors && Object.keys(errors).length > 0;
      if (hasErrors) { reply.code(422); return { errors }; }
      // Build + return the FHIR QuestionnaireResponse/Bundle via the engine if a builder exists; else echo validated answers.
      return { ok: true, formId: f.id, answers };
    } catch (e) { reply.code(500); return { error: redact(e instanceof Error ? e.message : String(e)) }; }
  });
}
```
> Confirm `apps/server` may import `@openldr/forms` (it's the engine; no `@openldr/db` runtime coupling reaches the server). If lint/depcruise objects, expose `toQuestionnaire`/`validateAnswers` through `ctx` instead (add thin `ctx.forms.toQuestionnaire`/`validate` wrappers in bootstrap). Prefer the direct import if allowed.

- [ ] **Step 2:** Register in `app.ts`. Typecheck + contract test (create → list → status → questionnaire export shape → responses happy + 422 on a missing required answer). Commit `feat(server): forms REST routes (P1-FORM)`.

---

## Task 10: Forms list page

**Files:** `apps/web/src/api.ts`; `apps/web/src/pages/Forms.tsx`; `App.tsx`; `e2e/tests/forms.spec.ts`.

- [ ] **Step 1: api.ts** — types + client:
```ts
export interface FormSummary { id: string; name: string; versionLabel: string|null; status: string; active: boolean; fhirResourceType: string|null; fieldCount: number; updatedAt: string }
export interface FormDefinition extends FormSummary { schema: unknown; targetPages: string[]|null; createdAt: string }
export const listForms = (): Promise<FormSummary[]> => apiGet('/api/forms');
export const getForm = (id: string): Promise<FormDefinition> => apiGet(`/api/forms/${id}`);
export const createForm = (i: { name: string; schema: unknown; fhirResourceType?: string|null; versionLabel?: string|null }): Promise<FormDefinition> => apiPost('/api/forms', i);
export const setFormStatus = (id: string, status: 'draft'|'published'|'archived'): Promise<FormDefinition> => apiPost(`/api/forms/${id}/status`, { status });
export const deleteForm = (id: string): Promise<void> => apiDelete(`/api/forms/${id}`);
export const formQuestionnaireUrl = (id: string): string => `/api/forms/${id}/questionnaire`;
export const submitFormResponse = (id: string, answers: unknown): Promise<unknown> => apiPost(`/api/forms/${id}/responses`, { answers });
```

- [ ] **Step 2: Forms.tsx** — port corlix `FormListPage`. Toolbar: search + "Import form JSON" (file input → `JSON.parse` → require `name` + `fields` → `createForm`). **"New form" disabled** with tooltip "Form builder coming in a later sub-project" (Slice B; stated divergence). `Table` (Name · FHIR type badge · Fields count · Version · Status badge · Active · Updated · `⋯`[View/Run → `/forms/:id` · Publish · Archive · Export = `<a download href={formQuestionnaireUrl(id)}>` · Delete]). Row-click → `/forms/:id`.

- [ ] **Step 3: route** `<Route path="/forms" element={<Forms />} />`. **e2e** `forms.spec.ts` step 1: import a minimal form JSON matching the real `FormSchema` shape read in Task 7 (e.g. `{ name: 'E2E${RUN}', fields: [{ id:'q1', displayLabel:'Q1', fieldType:'text', required:false, enabled:true, order:0 }] }`) → row appears.

- [ ] **Step 4:** Typecheck + commit `feat(web): Forms list page (P1-FORM)`.

---

## Task 11: Forms runtime capture page

**Files:** `apps/web/src/pages/FormCapture.tsx`; `App.tsx`; extend `e2e/tests/forms.spec.ts`.

- [ ] **Step 1: Read the engine + schema** (`packages/forms/src/{schema/form-schema,validate-answers,visibility}.ts`) for the `FormField` shape, `validateAnswers` signature, and the visibility/enableWhen evaluator.

- [ ] **Step 2: FormCapture.tsx** — load `getForm(id)`; hold `answers` keyed by field id. Render each enabled+visible field with a shadcn widget by `fieldType`:
  - text/email/phone → `Input`; number → `Input type=number`; date/datetime → date input; boolean → `Checkbox`; select → `Select`; multiselect → checkbox group; group/repeatable → add/remove instance container.
  - Specialized types (organism/antibiogram/reference/facility/identifier/address/attachment) → plain `Input` + a "basic input (full widget in a later sub-project)" hint. *Stated Slice-A divergence.*
  - Re-evaluate the engine's visibility (enableWhen) on every change to hide unmet fields.
  - Submit → engine `validateAnswers` client-side; if clean, `submitFormResponse(id, answers)`; show server `errors` (422) or success inline; render field-level errors next to inputs.

- [ ] **Step 3: route** `<Route path="/forms/:id" element={<FormCapture />} />`. **e2e** step 2: open the imported form → fill `q1` → Submit → success.

- [ ] **Step 4:** Typecheck + commit `feat(web): Forms runtime capture page (P1-FORM)`.

---

## Task 12: Enable nav + routes

**Files:** `apps/web/src/shell/AppShell.tsx`; `apps/web/src/App.tsx`.

- [ ] **Step 1:** In `AppShell.tsx`, move `Forms`/`Users`/`Audit` out of the `SOON` array into `NAV` with `{ to: '/forms'|'/users'|'/audit', label, end:false, icon }` (keep icons `FileInput`/`Users`/`ShieldCheck`). Remove the now-empty `SOON` rendering block.

- [ ] **Step 2:** Confirm `App.tsx` has routes `/users`, `/audit`, `/forms`, `/forms/:id` (added in Tasks 3/5/10/11).

- [ ] **Step 3:** Typecheck + a web smoke test asserting the nav renders the three new links. Commit `feat(web): enable Forms/Users/Audit in the nav (P1-UI)`.

---

## Task 13: CLI read commands

**Files:** `packages/cli/src/{users,audit,forms}.ts`; `packages/cli/src/index.ts`.

- [ ] **Step 1:** Determine which context the CLI builds for non-terminology commands (read `packages/cli/src/index.ts` + existing command files). Reuse the smallest factory that exposes `users`/`audit`/`forms`. If only `createTerminologyContext` exists, either add `users`/`audit`/`forms` to that context or use `createAppContext` for these commands — prefer the smallest change.

- [ ] **Step 2:** Add `runUsersList(opts)`, `runAuditList(opts:{action?,entity?,from?,to?})`, `runFormsList(opts)` — each opens the context, calls `ctx.users.list()` / `ctx.audit.list(filter)` / `ctx.forms.list()`, prints tab-separated rows or `--json`, closes the context. Mirror `packages/cli/src/terminology.ts` style.

- [ ] **Step 3:** Register `users list`, `audit list`, `forms list` subcommands in `index.ts`. Typecheck + commit `feat(cli): users/audit/forms list commands (P1-UI)`.

---

## Task 14: Gates, docs, memory, finish

- [ ] **Step 1: Gates.** `pnpm turbo typecheck lint test build` + `pnpm depcruise` → all green. Confirm `@openldr/forms`→`@openldr/db` introduces **no cycle** (audit/users already depend on `@openldr/db`; mirror them).

- [ ] **Step 2: Live smoke (optional).** `db migrate`, start the server, verify `/api/users`, `/api/audit`, `/api/forms` respond and the three pages render.

- [ ] **Step 3: Docs.** `pnpm docs:screenshots` → regenerate (Users/Audit/Forms). Review the diff.

- [ ] **Step 4: Memory.** Append a P1-UI entry to `C:\Users\Fredrick\.claude\projects\D--Projects-Repositories-openldr-ce\memory\openldr-ce-build-plan.md`: Users + Audit pages done; Forms Slice A done (migration 016 + form store + ctx.forms + REST + list + runtime capture); **Forms Slice B = the full drag-drop Form Builder is the next sub-project**; DHIS2 mapping UI (P2-DHIS2-3/7) also remains.

- [ ] **Step 5: Finish.** `superpowers:finishing-a-development-branch` → merge to `main` locally (`--no-ff`), per SP1–SP4. Don't push unless asked.

---

## Self-Review

**Spec coverage:** Users (§1) → T4–T5; Audit (§2) → T1–T3; Forms Slice A (§3) → T6–T11; shell wiring (§4) → T12; CLI (§5) → T13; testing (§6) → spread + T14; non-goals (§7) not built. All covered.

**Type consistency:** `User`/`AuditEvent` mirror the store types in `api.ts` (cross-boundary duplication per SP1–SP4). `FormDefinition`/`FormSummary` defined in the `@openldr/forms` store (T7), re-declared web-side (T10). `ctx.forms: FormStore` added in T8, consumed by routes (T9) + CLI (T13). `AuditStore.count` added T1, used T2. `UserStore.update` added T4, used by the PUT route + Users page edit.

**Risks flagged in-plan (not hidden):** (a) `@openldr/forms` engine signatures (`toQuestionnaire`/`validateAnswers`/response builder + `FormSchema`/`FormField` shapes) — T7/T9/T11 read `packages/forms/src/index.ts` first and match exactly; (b) `@openldr/forms`→`@openldr/db` must stay acyclic — T7/T14 verify via depcruise; (c) `UserStore.update` doesn't exist — T4 adds it with a test; (d) whether `apps/server` may import `@openldr/forms` — T9 gives a `ctx`-wrapper fallback if depcruise objects; (e) which context the CLI uses — T13 reuses the smallest that exposes the stores; (f) the Form Builder is explicitly Slice B — "New form" is a disabled, tooltip-labeled placeholder, not a silent omission.
```
