# SP6 — Decoupled User Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Keycloak the identity source of truth (users + roles via `AuthPort.directory`) and keep only profile `extras` in OpenLDR (`user_profiles` keyed by the provider subject), with a composed Users API and a form-template-driven Users page — so swapping auth providers is just a new adapter.

**Architecture:** Add a provider-agnostic `AuthPort.directory` (list/get/create/update/setRoles) implemented in the Keycloak `adapter-auth` (admin REST, reusing the SP4 token client). Add a `user_profiles` store (migration + Kysely store) keyed by subject. `users-routes` composes directory identity + roles + local profile into a `UserSummary`; mutations write Keycloak then upsert the profile. When the admin client is unconfigured (dev/e2e), GET routes fall back to the local `users` mirror and mutations return 503. The web Users dialog is driven by the published `'users'` form (CORE keys → identity, others → extras) via the existing `FormRuntime`.

**Tech Stack:** TypeScript, Fastify, Kysely + pg-mem, React + react-i18next, Vitest/RTL.

**Spec:** `docs/superpowers/specs/2026-06-19-sp5-sp6-keycloak-realm-and-decoupled-users-design.md` (Phase B).

**Conventions:** pnpm + turbo. Per-package tests. Full gate: `pnpm turbo typecheck lint test build` then `pnpm depcruise`. Commit per task. Live-Keycloak validation is DEFERRED (mock-based suite is the gate); the operator can't run Docker now.

**Verified facts:**
- `AuthPort` (post-SP4): `healthCheck`, `verifyToken`, `resetPassword`, `sendPasswordResetEmail`, `forceLogout`; exports `IdentityAdminNotConfiguredError` (name-based). `TokenClaims = { sub: string; … }`.
- `adapter-auth` `createAuth(cfg,deps)` has: `adminConfigured`, `adminBase = issuerUrl.replace('/realms/','/admin/realms/')`, `getAdminToken()`, `adminVoid(path, init)` (throws `IdentityAdminNotConfiguredError` when unconfigured; 401-refresh-once), `KcError`. `deps.fetchFn` injectable. NO JSON-returning admin helper yet (add `adminJson`).
- `users-routes.ts` (post-SP4): local CRUD (`ctx.users.*`) + SP4 actions that currently look up `ctx.users.get(id)` then act on `u.subject` with a 409-no-subject guard. Imports `requireRole`, `recordAudit`, `redact`, `z`, `isNotConfigured`.
- Internal migrations run to `020`; index at `packages/db/src/migrations/internal/index.ts`; `InternalSchema` + `UsersTable` in `packages/db/src/schema/internal.ts`.
- `packages/users` `createUserStore(db)`; `AppContext.users` wired in `packages/bootstrap/src/index.ts:116`; `AppContext` interface at `:69`.
- Forms: `FormSchema` field has `fieldId`, optional `apiProperty`, `fhirPath`; `'users'` PAGE_TARGET CORE keys = `firstName,lastName,email,roles`. Web `FormRuntime({schema, onSubmit, initialAnswers})`, `RuntimeAnswers = Record<fieldId, unknown>`. `GET /api/forms/published?targetPage=users` exists (`ctx.forms.listPublished`).
- Web `api.ts` has `authFetch`, `jbody(body,method)`, `apiGet`, `okJson`; `User` type + SP3 Users page + SP4 `ResetPasswordDialog`/row actions + i18n bundle.

---

## File Structure

- `packages/ports/src/auth.ts` — `DirectoryUser`, `DirectoryPort`, `AuthPort.directory` (modify)
- `packages/adapter-auth/src/index.ts` — `adminJson` + `directory` impl (modify)
- `packages/adapter-auth/src/index.test.ts` — directory tests (modify)
- `packages/db/src/migrations/internal/021_user_profiles.ts` (+ register in `index.ts`) (create/modify)
- `packages/db/src/schema/internal.ts` — `UserProfilesTable` (modify)
- `packages/users/src/profiles.ts` — `createUserProfileStore` (create)
- `packages/users/src/profiles.test.ts` — store test (create)
- `packages/users/src/index.ts` — export profiles store (modify)
- `packages/bootstrap/src/index.ts` — `ctx.userProfiles` + `AppContext` (modify)
- `apps/server/src/users-routes.ts` — composed routes + fallback (modify)
- `apps/server/src/users-routes.test.ts` — composed-route tests (modify)
- `apps/web/src/api.ts` — `UserSummary` + composed client (modify)
- `apps/web/src/users/UserDialog.tsx` — form-template driven (modify)
- `apps/web/src/pages/Users.tsx` — consume `UserSummary` (modify)
- `apps/web/src/i18n/index.ts` — any new keys (modify)
- + the affected web tests (modify)

---

## Task 1: `AuthPort.directory` + Keycloak adapter implementation

**Files:**
- Modify: `packages/ports/src/auth.ts`
- Modify: `packages/adapter-auth/src/index.ts`
- Modify: `packages/adapter-auth/src/index.test.ts`

- [ ] **Step 1: Extend the port**

In `packages/ports/src/auth.ts`, add the directory types + `directory` on `AuthPort` (keep everything else):

```ts
export interface DirectoryUser {
  id: string;                 // provider subject id
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  enabled: boolean;
  roles: string[];            // realm roles, provider defaults filtered out
  createdAt: string | null;   // ISO
}
export interface DirectoryCreateInput {
  username: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  enabled?: boolean;
  roles?: string[];
  password?: string;
  temporaryPassword?: boolean;
}
export interface DirectoryUpdateInput {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  enabled?: boolean;
}
export interface DirectoryPort {
  list(opts?: { search?: string; max?: number }): Promise<DirectoryUser[]>;
  get(id: string): Promise<DirectoryUser | null>;
  create(input: DirectoryCreateInput): Promise<DirectoryUser>;
  update(id: string, patch: DirectoryUpdateInput): Promise<void>;
  setRoles(id: string, roles: string[]): Promise<void>;
}
// add to AuthPort:
//   directory: DirectoryPort;
```

- [ ] **Step 2: Write failing adapter tests**

Append to `packages/adapter-auth/src/index.test.ts` a `describe('directory', ...)` using an injected `fetchFn` that records calls and serves a token + JSON bodies. Cover:
- `list` GETs `/users?...briefRepresentation=false` and maps each to `DirectoryUser` (id/username/email/firstName/lastName/enabled/createdAt from `createdTimestamp`), merging realm roles from `/users/:id/role-mappings/realm` with provider defaults (`default-roles-*`, `offline_access`, `uma_authorization`) filtered out.
- `get` returns null on 404.
- `create` POSTs `/users`, reads the `Location` header for the new id, assigns roles via `/users/:id/role-mappings/realm`, and (when `password`) PUTs `/users/:id/reset-password`.
- `setRoles` resolves names → role objects via `/roles` then POSTs/DELETEs role-mappings to reach the target set.
- not-configured → every method throws `IdentityAdminNotConfiguredError` with no network call.

```ts
function dirMock() {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const kcUser = { id: 'u1', username: 'ada', email: 'a@x', firstName: 'Ada', lastName: 'L', enabled: true, createdTimestamp: 1700000000000 };
  const fetchFn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url); const method = init?.method ?? 'GET';
    calls.push({ url: u, method, body: init?.body as string | undefined });
    if (u.endsWith('/protocol/openid-connect/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 300 }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/users\/u1\/role-mappings\/realm$/.test(u) && method === 'GET') return new Response(JSON.stringify([{ id: 'r1', name: 'lab_admin' }, { id: 'rd', name: 'default-roles-openldr' }]), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/users\/u1$/.test(u) && method === 'GET') return new Response(JSON.stringify(kcUser), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/users(\?|$)/.test(u) && method === 'GET') return new Response(JSON.stringify([kcUser]), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/roles$/.test(u) && method === 'GET') return new Response(JSON.stringify([{ id: 'r1', name: 'lab_admin' }, { id: 'r2', name: 'lab_manager' }]), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/users$/.test(u) && method === 'POST') return new Response(null, { status: 201, headers: { Location: 'http://kc/admin/realms/openldr/users/new-id' } });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}
const dcfg = { issuerUrl: 'https://kc/realms/openldr', adminClientId: 'svc', adminClientSecret: 'sek' };

describe('directory', () => {
  it('list maps users + filters provider-default roles', async () => {
    const { fetchFn } = dirMock();
    const auth = createAuth(dcfg, { fetchFn });
    const users = await auth.directory.list();
    expect(users[0]).toMatchObject({ id: 'u1', username: 'ada', firstName: 'Ada', enabled: true });
    expect(users[0].roles).toEqual(['lab_admin']); // default-roles-* filtered out
    expect(users[0].createdAt).toContain('20'); // ISO
  });
  it('get returns null on 404', async () => {
    const fetchFn = vi.fn(async (url: string | URL) => String(url).endsWith('/protocol/openid-connect/token')
      ? new Response(JSON.stringify({ access_token: 't', expires_in: 300 }), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response(null, { status: 404 })) as unknown as typeof fetch;
    const auth = createAuth(dcfg, { fetchFn });
    expect(await auth.directory.get('missing')).toBeNull();
  });
  it('create posts the user, reads Location id, assigns roles', async () => {
    const { calls, fetchFn } = dirMock();
    const auth = createAuth(dcfg, { fetchFn });
    const created = await auth.directory.create({ username: 'bob', firstName: 'Bob', email: 'b@x', roles: ['lab_manager'], password: 'pw' });
    expect(created.id).toBe('new-id');
    expect(calls.some((c) => c.method === 'POST' && /\/users$/.test(c.url))).toBe(true);
    expect(calls.some((c) => /\/users\/new-id\/role-mappings\/realm$/.test(c.url) && c.method === 'POST')).toBe(true);
    expect(calls.some((c) => /\/users\/new-id\/reset-password$/.test(c.url))).toBe(true);
  });
  it('not configured → throws with no network', async () => {
    const { calls, fetchFn } = dirMock();
    const auth = createAuth({ issuerUrl: 'https://kc/realms/openldr' }, { fetchFn });
    await expect(auth.directory.list()).rejects.toBeInstanceOf((await import('@openldr/ports')).IdentityAdminNotConfiguredError);
    expect(calls).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `pnpm --filter @openldr/adapter-auth test -- directory`
Expected: FAIL (`directory` undefined).

- [ ] **Step 4: Implement the directory in the adapter**

In `packages/adapter-auth/src/index.ts`: add an `adminJson<T>` helper next to `adminVoid` (same not-configured guard + 401-refresh, but returns parsed JSON and supports a raw response for header reads), a default-role filter, and the `directory` object on the returned port. Insert after `adminVoid`:

```ts
  const PROVIDER_DEFAULT_ROLE = (name: string) => name.startsWith('default-roles') || name === 'offline_access' || name === 'uma_authorization';

  async function adminFetchRaw(path: string, init: RequestInit): Promise<Response> {
    if (!adminConfigured) throw new IdentityAdminNotConfiguredError();
    const doFetch = async (tok: string) => {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${tok}`);
      if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      return fetchFn(`${adminBase}${path}`, { ...init, headers });
    };
    let res = await doFetch(await getAdminToken());
    if (res.status === 401) { adminTokenPromise = undefined; res = await doFetch(await getAdminToken()); }
    return res;
  }
  async function adminJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await adminFetchRaw(path, init);
    if (!res.ok) { const d = await res.text().catch(() => ''); throw new KcError(res.status, d.slice(0, 500)); }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  interface KcUser { id: string; username: string; email?: string; firstName?: string; lastName?: string; enabled: boolean; createdTimestamp?: number }
  interface KcRole { id: string; name: string }
  const toDirectoryUser = (u: KcUser, roleNames: string[]): import('@openldr/ports').DirectoryUser => ({
    id: u.id, username: u.username, email: u.email ?? null, firstName: u.firstName ?? null, lastName: u.lastName ?? null,
    enabled: u.enabled, roles: roleNames.filter((n) => !PROVIDER_DEFAULT_ROLE(n)),
    createdAt: typeof u.createdTimestamp === 'number' ? new Date(u.createdTimestamp).toISOString() : null,
  });
  async function userRoleNames(id: string): Promise<string[]> {
    const roles = await adminJson<KcRole[]>(`/users/${encodeURIComponent(id)}/role-mappings/realm`);
    return roles.map((r) => r.name);
  }
```

Add the `directory` object to the returned port (after `forceLogout`):

```ts
    directory: {
      async list(opts = {}) {
        const params = new URLSearchParams({ first: '0', max: String(opts.max ?? 100), briefRepresentation: 'false' });
        if (opts.search) params.set('search', opts.search);
        const users = await adminJson<KcUser[]>(`/users?${params.toString()}`);
        return Promise.all(users.map(async (u) => toDirectoryUser(u, await userRoleNames(u.id))));
      },
      async get(id) {
        const res = await adminFetchRaw(`/users/${encodeURIComponent(id)}`, {});
        if (res.status === 404) return null;
        if (!res.ok) { const d = await res.text().catch(() => ''); throw new KcError(res.status, d.slice(0, 500)); }
        const u = (await res.json()) as KcUser;
        return toDirectoryUser(u, await userRoleNames(id));
      },
      async create(input) {
        const res = await adminFetchRaw(`/users`, { method: 'POST', body: JSON.stringify({ username: input.username, email: input.email ?? undefined, firstName: input.firstName ?? undefined, lastName: input.lastName ?? undefined, enabled: input.enabled ?? true }) });
        if (!res.ok) { const d = await res.text().catch(() => ''); throw new KcError(res.status, d.slice(0, 500)); }
        const loc = res.headers.get('Location');
        const id = loc ? loc.split('/').pop()! : '';
        if (!id) throw new KcError(500, 'provider did not return a user id');
        if (input.roles && input.roles.length > 0) await this.setRoles(id, input.roles);
        if (input.password) await adminVoid(`/users/${encodeURIComponent(id)}/reset-password`, { method: 'PUT', body: JSON.stringify({ type: 'password', value: input.password, temporary: input.temporaryPassword ?? true }) });
        return (await this.get(id))!;
      },
      async update(id, patch) {
        await adminVoid(`/users/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ email: patch.email ?? undefined, firstName: patch.firstName ?? undefined, lastName: patch.lastName ?? undefined, enabled: patch.enabled }) });
      },
      async setRoles(id, roles) {
        const all = await adminJson<KcRole[]>(`/roles`);
        const current = (await adminJson<KcRole[]>(`/users/${encodeURIComponent(id)}/role-mappings/realm`)).filter((r) => !PROVIDER_DEFAULT_ROLE(r.name));
        const want = new Set(roles);
        const toAdd = all.filter((r) => want.has(r.name) && !current.some((c) => c.name === r.name));
        const toRemove = current.filter((c) => !want.has(c.name));
        if (toAdd.length) await adminVoid(`/users/${encodeURIComponent(id)}/role-mappings/realm`, { method: 'POST', body: JSON.stringify(toAdd.map((r) => ({ id: r.id, name: r.name }))) });
        if (toRemove.length) await adminVoid(`/users/${encodeURIComponent(id)}/role-mappings/realm`, { method: 'DELETE', body: JSON.stringify(toRemove.map((r) => ({ id: r.id, name: r.name }))) });
      },
    },
```

> Note: `adminVoid` already throws `IdentityAdminNotConfiguredError` when unconfigured; `adminFetchRaw`/`adminJson` do the same guard, so every directory method short-circuits before any network call when creds are absent.

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm --filter @openldr/adapter-auth test` then `pnpm --filter @openldr/ports typecheck` and `pnpm --filter @openldr/adapter-auth typecheck`
Expected: PASS, EXIT 0.

- [ ] **Step 6: Commit**

```bash
git add packages/ports/src/auth.ts packages/adapter-auth/src/index.ts packages/adapter-auth/src/index.test.ts
git commit -m "feat(auth): AuthPort.directory (list/get/create/update/setRoles) on the Keycloak adapter"
```

---

## Task 2: `user_profiles` store + migration + bootstrap

**Files:**
- Create: `packages/db/src/migrations/internal/021_user_profiles.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/schema/internal.ts`
- Create: `packages/users/src/profiles.ts`
- Create: `packages/users/src/profiles.test.ts`
- Modify: `packages/users/src/index.ts`
- Modify: `packages/bootstrap/src/index.ts`

- [ ] **Step 1: Migration + schema**

Create `packages/db/src/migrations/internal/021_user_profiles.ts` (match the style of `006_users.ts`):
```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('user_profiles')
    .addColumn('user_id', 'text', (c) => c.primaryKey())
    .addColumn('form_schema_id', 'text')
    .addColumn('form_version', 'integer')
    .addColumn('extras', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('user_profiles').execute();
}
```
Register it in `packages/db/src/migrations/internal/index.ts`: add `import * as m021 from './021_user_profiles';` and the `'021_user_profiles': m021` entry in `internalMigrations` (match the existing pattern).
In `packages/db/src/schema/internal.ts`, add the table interface + register on `InternalSchema`:
```ts
export interface UserProfilesTable {
  user_id: string;
  form_schema_id: string | null;
  form_version: number | null;
  extras: unknown;
  updated_at: Date;
}
// in InternalSchema: user_profiles: UserProfilesTable;
```

- [ ] **Step 2: Failing store test** — create `packages/users/src/profiles.test.ts` (mirror the pg-mem harness in `packages/users/src/store.test.ts` — read it for `makeMigratedDb`):
```ts
import { describe, it, expect } from 'vitest';
import { createUserProfileStore } from './profiles';
// reuse the migrated-db helper pattern from store.test.ts (import internalMigrations + pg-mem)
// ... makeMigratedDb() as in store.test.ts ...

describe('user profile store', () => {
  it('upserts and reads extras keyed by user id', async () => {
    const db = await makeMigratedDb();
    const store = createUserProfileStore(db);
    await store.upsert('kc-1', { formSchemaId: 'f1', formVersion: 2, extras: { phone: { value: '123', fhirPath: null } } });
    const p = await store.get('kc-1');
    expect(p).toMatchObject({ userId: 'kc-1', formSchemaId: 'f1', formVersion: 2 });
    expect(p!.extras.phone.value).toBe('123');
    await store.upsert('kc-1', { extras: { phone: { value: '999', fhirPath: null } } });
    expect((await store.get('kc-1'))!.extras.phone.value).toBe('999');
    const map = await store.list(['kc-1', 'kc-2']);
    expect(map.get('kc-1')).toBeTruthy();
    expect(map.get('kc-2')).toBeUndefined();
  });
});
```
(Copy `makeMigratedDb` from `store.test.ts` verbatim into this file or a shared helper.)

- [ ] **Step 3: Run — expect FAIL.** `pnpm --filter @openldr/users test -- profiles`

- [ ] **Step 4: Implement** — create `packages/users/src/profiles.ts`:
```ts
import { type Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';

export type ProfileExtras = Record<string, { value: string; fhirPath: string | null }>;
export interface UserProfile { userId: string; formSchemaId: string | null; formVersion: number | null; extras: ProfileExtras }
export interface UserProfileStore {
  get(userId: string): Promise<UserProfile | undefined>;
  list(userIds: string[]): Promise<Map<string, UserProfile>>;
  upsert(userId: string, input: { formSchemaId?: string | null; formVersion?: number | null; extras?: ProfileExtras }): Promise<void>;
}
interface Row { user_id: string; form_schema_id: string | null; form_version: number | null; extras: unknown }
const toProfile = (r: Row): UserProfile => ({
  userId: r.user_id, formSchemaId: r.form_schema_id, formVersion: r.form_version,
  extras: (r.extras as ProfileExtras | null) ?? {},
});
export function createUserProfileStore(db: Kysely<InternalSchema>): UserProfileStore {
  return {
    async get(userId) {
      const r = await db.selectFrom('user_profiles').select(['user_id', 'form_schema_id', 'form_version', 'extras']).where('user_id', '=', userId).executeTakeFirst();
      return r ? toProfile(r as unknown as Row) : undefined;
    },
    async list(userIds) {
      const map = new Map<string, UserProfile>();
      if (userIds.length === 0) return map;
      const rows = await db.selectFrom('user_profiles').select(['user_id', 'form_schema_id', 'form_version', 'extras']).where('user_id', 'in', userIds).execute();
      for (const r of rows) map.set((r as unknown as Row).user_id, toProfile(r as unknown as Row));
      return map;
    },
    async upsert(userId, input) {
      await db.insertInto('user_profiles')
        .values({ user_id: userId, form_schema_id: input.formSchemaId ?? null, form_version: input.formVersion ?? null, extras: JSON.stringify(input.extras ?? {}) as never, updated_at: new Date() })
        .onConflict((oc) => oc.column('user_id').doUpdateSet({ form_schema_id: input.formSchemaId ?? null, form_version: input.formVersion ?? null, extras: JSON.stringify(input.extras ?? {}) as never, updated_at: new Date() }))
        .execute();
    },
  };
}
```
Export it from `packages/users/src/index.ts`: `export { createUserProfileStore, type UserProfile, type UserProfileStore, type ProfileExtras } from './profiles';`

- [ ] **Step 5: Run — expect PASS.** `pnpm --filter @openldr/users test`

- [ ] **Step 6: Wire bootstrap** — in `packages/bootstrap/src/index.ts`: import `createUserProfileStore, type UserProfileStore`; after `const users = createUserStore(internal.db);` add `const userProfiles = createUserProfileStore(internal.db);`; add `userProfiles` to the returned ctx; add `userProfiles: UserProfileStore;` to the `AppContext` interface.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm --filter @openldr/db --filter @openldr/users --filter @openldr/bootstrap typecheck` → EXIT 0
```bash
git add packages/db/src/migrations/internal/021_user_profiles.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts packages/users/src/profiles.ts packages/users/src/profiles.test.ts packages/users/src/index.ts packages/bootstrap/src/index.ts
git commit -m "feat(users): user_profiles store (extras keyed by subject) + migration + ctx wiring"
```

---

## Task 3: Compose users-routes on the directory + profiles (with unconfigured fallback)

**Files:**
- Modify: `apps/server/src/users-routes.ts`
- Modify: `apps/server/src/users-routes.test.ts`

- [ ] **Step 1: Write failing route tests**

In `users-routes.test.ts`, extend `fakeCtx()` with a fake `auth.directory` (in-memory map of `DirectoryUser`) + `userProfiles` (in-memory) and a `__directory`/`__profiles` accessor; keep the existing local `users` fake for the fallback path. Add tests asserting:
- `GET /api/users` composes `directory.list()` + each user's `userProfiles` extras into `UserSummary` (`{ id, username, email, firstName, lastName, enabled, roles, createdAt, extras, formSchemaId, formVersion }`).
- `POST /api/users` calls `directory.create` (identity) then `userProfiles.upsert` (extras + form ref); audit `user.create` (no password in events).
- `PUT /api/users/:id` calls `directory.update` + `directory.setRoles` + `userProfiles.upsert`; audit `user.update`.
- `POST /api/users/:id/status` calls `directory.update({ enabled })`; audit `user.status`.
- The SP4 routes now call `ctx.auth.<op>(id, …)` directly (no local lookup); force-logout self-guard still 400; 503 when the op throws `IdentityAdminNotConfiguredError`.
- **Fallback:** when `directory.list` throws `IdentityAdminNotConfiguredError`, `GET /api/users` returns the local `ctx.users.list()` mapped to `UserSummary` (firstName/lastName null, extras {}); `POST/PUT/status` return 503.
Write concrete `it(...)` blocks (real assertions) adapted to the fake shapes; mirror the existing test patterns in the file.

- [ ] **Step 2: Run — expect FAIL.** `pnpm --filter @openldr/server test -- users-routes`

- [ ] **Step 3: Rewrite the routes**

Replace `users-routes.ts` route bodies with the composed model. Add a `UserSummary` composition helper + a `toSummaryFromLocal` fallback mapper, and a guarded `directoryOrFallback`. Key shapes:
```ts
import { recordAudit } from './audit-helper';
// CORE identity keys handled by the directory; everything else is profile extras.
const createInput = z.object({
  username: z.string().min(1), email: z.string().nullish(),
  firstName: z.string().nullish(), lastName: z.string().nullish(),
  roles: z.array(z.string()).optional(), password: z.string().optional(),
  extras: z.record(z.object({ value: z.string(), fhirPath: z.string().nullable().optional() })).optional(),
  formSchemaId: z.string().nullish(), formVersion: z.number().nullish(),
});
const updateInput = createInput.partial();

function summary(d: { id: string; username: string; email: string | null; firstName: string | null; lastName: string | null; enabled: boolean; roles: string[]; createdAt: string | null }, profile?: { formSchemaId: string | null; formVersion: number | null; extras: Record<string, { value: string; fhirPath: string | null }> }) {
  const extras: Record<string, string> = {};
  if (profile) for (const [k, v] of Object.entries(profile.extras)) extras[k] = v.value;
  return { ...d, extras, formSchemaId: profile?.formSchemaId ?? null, formVersion: profile?.formVersion ?? null };
}
```
- `GET /api/users`: `try { const users = await ctx.auth.directory.list(); const profiles = await ctx.userProfiles.list(users.map(u=>u.id)); return users.map(u => summary(u, profiles.get(u.id))); } catch (e) { if (isNotConfigured(e)) { return (await ctx.users.list()).map(localToSummary); } throw e; }` where `localToSummary(u)` maps the local `users` row to a `UserSummary` (firstName/lastName null, roles=u.roles, enabled=u.status!=='disabled', extras {}, createdAt=u.createdAt).
- `GET /api/users/:id`: directory.get + userProfiles.get composed; 404 if null; fallback to `ctx.users.get(id)` localToSummary when not configured.
- `POST /api/users` (requireRole lab_admin): not-configured → 503; else `const d = await directory.create({ username, email, firstName, lastName, roles, password })`; `await ctx.userProfiles.upsert(d.id, { formSchemaId, formVersion, extras })`; audit `user.create` entityId d.id (NO password); 201 → `summary(d, await userProfiles.get(d.id))`.
- `PUT /api/users/:id`: 503 if unconfigured; `directory.update(id, {email,firstName,lastName})`; if roles → `directory.setRoles(id, roles)`; `userProfiles.upsert(id, {...})`; audit `user.update`; return composed.
- `POST /api/users/:id/status`: body `{ enabled: boolean }` (accept legacy `{status:'active'|'disabled'}` too → map to enabled); 503 if unconfigured; `directory.update(id, { enabled })`; audit `user.status` metadata `{ enabled }`; return composed.
- SP4 routes (`reset-password`/`send-reset-email`/`force-logout`): change to call `ctx.auth.<op>(id, …)` with `id` = the route param directly; DROP the `ctx.users.get`/`u.subject`/409 guard (the id IS the subject). Keep the force-logout self-guard + the 503/502 mapping + audit. Wrap not-configured → 503.
Errors: provider `KcError`/other → redacted 502; validation 400; not-found 404.

- [ ] **Step 4: Run — expect PASS.** `pnpm --filter @openldr/server test -- users-routes` then `pnpm --filter @openldr/server test`

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @openldr/server typecheck` → EXIT 0
```bash
git add apps/server/src/users-routes.ts apps/server/src/users-routes.test.ts
git commit -m "feat(server): compose Users on Keycloak directory + local profiles (local fallback when unconfigured)"
```

---

## Task 4: Web — UserSummary client + form-template-driven dialog + list

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/users/UserDialog.tsx`
- Modify: `apps/web/src/pages/Users.tsx`
- Modify: `apps/web/src/pages/Users.test.tsx`
- Modify: `apps/web/src/i18n/index.ts`

- [ ] **Step 1: API types + client + form-published client**

In `apps/web/src/api.ts`: replace the `User` type usage with `UserSummary` and add a published-forms client:
```ts
export interface UserSummary {
  id: string; username: string; email: string | null; firstName: string | null; lastName: string | null;
  enabled: boolean; roles: string[]; createdAt: string | null;
  extras: Record<string, string>; formSchemaId: string | null; formVersion: number | null;
}
export const listUsers = (): Promise<UserSummary[]> => apiGet('/api/users', 'list users');
export const createUser = (i: { username: string; email?: string|null; firstName?: string|null; lastName?: string|null; roles?: string[]; password?: string; extras?: Record<string,{value:string;fhirPath:string|null}>; formSchemaId?: string|null; formVersion?: number|null }): Promise<UserSummary> =>
  authFetch('/api/users', jbody(i, 'POST')).then((r) => okJson<UserSummary>(r, 'create user'));
export const updateUser = (id: string, i: Partial<Parameters<typeof createUser>[0]>): Promise<UserSummary> =>
  authFetch(`/api/users/${id}`, jbody(i, 'PUT')).then((r) => okJson<UserSummary>(r, 'update user'));
export const setUserStatus = (id: string, enabled: boolean): Promise<UserSummary> =>
  authFetch(`/api/users/${id}/status`, jbody({ enabled }, 'POST')).then((r) => okJson<UserSummary>(r, 'set user status'));
export const listPublishedForms = (targetPage: string): Promise<FormSummary[]> =>
  apiGet(`/api/forms/published?targetPage=${encodeURIComponent(targetPage)}`, 'list published forms');
```
(Keep SP4 `resetUserPassword`/`sendUserResetEmail`/`forceUserLogout` unchanged — they already take `id`.)

- [ ] **Step 2: Form-template-driven `UserDialog`**

Rewrite `apps/web/src/users/UserDialog.tsx` to (a) load the published `'users'` form (`listPublishedForms('users')` → `getForm(id)` for the schema, or use the summary if it carries the schema), (b) render it via `FormRuntime` with `initialAnswers` seeded from the editing user (CORE keys from identity, others from `extras`), and (c) on submit split answers by the field's `apiProperty`: CORE set `{ firstName, lastName, email, roles }` → the create/update identity payload; every other `apiProperty` → `extras[apiProperty] = { value: String(answer), fhirPath: field.fhirPath ?? null }`. Username + password (create only) are fixed fields above the form. Empty-state when no `'users'` form is published ("Create a Users form in the Form Builder"). Use corlix's `UserDialog.tsx` (`corlix/apps/desktop/src/renderer/components/UserDialog.tsx`) as the reference for the CORE/extras split + seed/extract logic, adapted to OpenLDR's `FormRuntime` (answers keyed by `fieldId`; map `fieldId`↔`apiProperty` via the schema fields). The implementer should write this concretely against the real `FormSchema`/`FormRuntime` types; keep it under one focused component.

- [ ] **Step 3: Users page consumes `UserSummary`**

In `apps/web/src/pages/Users.tsx`: update columns/getters to `UserSummary` — full name = `[firstName, lastName].filter(Boolean).join(' ')`; status badge from `enabled`; `createdAt` from the summary; roles unchanged. The status toggle calls `setUserStatus(id, !u.enabled)`. SP4 row actions now pass `u.id` (already the subject). The `noAcct`/`subject` guard from SP4 is removed (every directory user has an id); keep the self-guard on force-logout. Update `valueGetters`/`enumOptions` (`enabled` true/false) accordingly.

- [ ] **Step 4: i18n + tests**

Add any new keys (e.g. `users.firstName`, `users.lastName`, `users.noUsersForm`). Update `apps/web/src/pages/Users.test.tsx` + `UserDialog` tests to the `UserSummary` shape + the form-driven dialog (mock `listPublishedForms`/`getForm` to return a minimal `'users'` schema; assert CORE→payload and extras split; list renders first+last name). Adapt the existing tests' fixtures from `User` to `UserSummary`.

- [ ] **Step 5: Run web suite + typecheck**

Run: `pnpm --filter @openldr/web test` then `pnpm --filter @openldr/web typecheck`
Expected: PASS, EXIT 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/users/UserDialog.tsx apps/web/src/pages/Users.tsx apps/web/src/pages/Users.test.tsx apps/web/src/i18n/index.ts
git commit -m "feat(web): UserSummary client + form-template-driven UserDialog + list on the composed model"
```

---

## Task 5: Full gate + final review

- [ ] **Step 1: Full gate.** `pnpm turbo typecheck lint test build` → all PASS.
- [ ] **Step 2: depcruise.** `pnpm depcruise` → no violations.
- [ ] **Step 3: Append SP6 items to the deferred live-acceptance checklist** in `infra/keycloak/README.md` (the SP6 round-trip rows already exist as "(after SP6)"; mark them ready to run). Commit if changed.
- [ ] **Step 4: Commit any fixups** (skip if clean).

---

## Self-Review notes (coverage vs spec Phase B)

- B1 `AuthPort.directory` + adapter → Task 1. B2 `user_profiles` store + migration + bootstrap → Task 2. B3 composed routes + SP4-id-direct + unconfigured fallback → Task 3. B4 web UserSummary + form-driven dialog + list → Task 4.
- Key decisions honored: directory nested under `AuthPort.directory`; `users` table retained (used for the read fallback + audit actor); `firstName`/`lastName` replace `displayName` (web full-name composes them); graceful local-mirror read fallback / 503 mutations when unconfigured (Task 3); live-KC acceptance deferred (Task 5).
- Type consistency: `DirectoryUser`/`DirectoryPort` (Task 1) used by routes (Task 3) + web `UserSummary` (Task 4); `UserProfile`/`ProfileExtras` (Task 2) used by routes (Task 3); `setUserStatus(id, enabled)` aligns web↔route.
- ⚠️ Task 4's form-driven dialog is the highest-uncertainty piece (novel UI over `FormRuntime`); the implementer writes it concretely against the real types using corlix's `UserDialog` as the CORE/extras reference. Its true validation is the deferred live-Keycloak run.
