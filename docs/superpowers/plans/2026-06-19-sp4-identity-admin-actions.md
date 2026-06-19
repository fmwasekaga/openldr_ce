# SP4 — Identity-Provider Admin Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a `lab_admin` reset a user's password, trigger a provider password-reset email, and force sign-out — via provider-agnostic `AuthPort` methods implemented in the Keycloak `adapter-auth`, fully guarded and audited, with no Keycloak coupling in routes/stores/web.

**Architecture:** Extend `AuthPort` (provider-neutral) with `resetPassword`/`sendPasswordResetEmail`/`forceLogout`; implement them in `adapter-auth` using a cached `client_credentials` admin token + Keycloak admin REST (endpoints derived from `issuerUrl`). Routes call `ctx.auth.<op>(user.subject, ...)`, guard (role/subject/config/self), and audit on success (never the password). Web adds a `ResetPasswordDialog` + three row-action items to the SP3 Users page.

**Tech Stack:** TypeScript, Fastify, react-i18next, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-19-sp4-identity-admin-actions-design.md`

**Conventions:** pnpm + turbo. Per-package: `pnpm --filter <pkg> test`. Full gate: `pnpm turbo typecheck lint test build` then `pnpm depcruise`. Commit after each task.

**Verified facts:**
- `AuthPort` (`packages/ports/src/auth.ts`) currently has `healthCheck()` + `verifyToken(token)`; `TokenClaims = { sub: string; [k]: unknown }`.
- `adapter-auth` `createAuth(cfg, deps)` (`cfg: { issuerUrl, audience? }`, `deps: { fetchFn?, keySet? }`) returns an `AuthPort` object literal; `fetchFn` defaults to `fetch` and is injectable.
- `OIDC_ISSUER_URL` is the realm base (e.g. `https://kc/realms/openldr`); admin base = `issuerUrl.replace('/realms/', '/admin/realms/')`; token endpoint = `${issuerUrl}/protocol/openid-connect/token`.
- A local user's `subject` is the provider user id; `null` when never logged in.
- `bootstrap/src/index.ts:98`: `const auth = createAuth({ issuerUrl: cfg.OIDC_ISSUER_URL, audience: cfg.OIDC_AUDIENCE });`.
- `apps/server/src/users-routes.test.ts` `fakeCtx()` has `users`/`audit`/`logger` (no `auth`); routes already import `recordAudit` from `./audit-helper` and `requireRole` from `./rbac`; the file casts ctx `as unknown as AppContext`.
- apps/server does NOT directly depend on `@openldr/ports` — routes duck-type errors by `name` (cf. the existing `TerminologyAdminError` name-check). So SP4 routes detect the not-configured error by `err.name === 'IdentityAdminNotConfiguredError'`.
- `apps/web/src/components/ui/dialog.tsx` exports `Dialog`/`DialogTrigger`/`DialogContent`/`DialogTitle`/`DialogDescription` (NO `DialogHeader`/`DialogFooter`) — the ported dialog uses plain divs for header/footer.
- SP3 Users page row-action dropdown is in `pages/Users.tsx`; `useAuth()` gives `{ user: { id } | null }`; the inline toast + `ConfirmDialog` patterns already exist.

---

## File Structure

- `packages/ports/src/auth.ts` — extend `AuthPort` + `IdentityAdminNotConfiguredError` (modify)
- `packages/adapter-auth/src/index.ts` — admin token client + 3 methods + `KcError` (modify)
- `packages/adapter-auth/src/index.test.ts` — admin tests (modify)
- `packages/config/src/schema.ts` — `KEYCLOAK_ADMIN_CLIENT_ID/SECRET` (modify)
- `packages/config/src/schema.test.ts` — config test (modify)
- `packages/bootstrap/src/index.ts` — pass admin creds to `createAuth` (modify)
- `apps/server/src/users-routes.ts` — 3 routes (modify)
- `apps/server/src/users-routes.test.ts` — `auth` fake + route tests (modify)
- `apps/web/src/api.ts` — 3 client helpers (modify)
- `apps/web/src/users/ResetPasswordDialog.tsx` — ported dialog (create)
- `apps/web/src/users/ResetPasswordDialog.test.tsx` — dialog test (create)
- `apps/web/src/pages/Users.tsx` — 3 row-action items + dialog wiring (modify)
- `apps/web/src/pages/Users.test.tsx` — action tests (modify)
- `apps/web/src/i18n/index.ts` — new `users.*` keys (modify)

---

## Task 1: AuthPort admin methods + Keycloak adapter implementation

**Files:**
- Modify: `packages/ports/src/auth.ts`
- Modify: `packages/adapter-auth/src/index.ts`
- Modify: `packages/adapter-auth/src/index.test.ts`

- [ ] **Step 1: Extend the port**

In `packages/ports/src/auth.ts`, add three methods to `AuthPort` and export the error (keep `healthCheck`/`verifyToken`/`TokenClaims`):

```ts
export interface AuthPort {
  healthCheck(): Promise<HealthResult>;
  verifyToken(token: string): Promise<TokenClaims>;
  /** Set a user's password at the provider. `temporary` forces a change at next login. */
  resetPassword(userId: string, password: string, temporary: boolean): Promise<void>;
  /** Trigger the provider's password-reset email flow for the user. */
  sendPasswordResetEmail(userId: string): Promise<void>;
  /** Terminate all of the user's provider sessions. */
  forceLogout(userId: string): Promise<void>;
}

/** Thrown by AuthPort admin methods when the provider admin client is not configured. */
export class IdentityAdminNotConfiguredError extends Error {
  constructor() {
    super('identity provider admin client is not configured');
    this.name = 'IdentityAdminNotConfiguredError';
  }
}
```

- [ ] **Step 2: Write failing adapter tests**

Append to `packages/adapter-auth/src/index.test.ts` (reuse existing `describe`/`it`/`vi` imports; add a new describe block):

```ts
import { IdentityAdminNotConfiguredError } from '@openldr/ports';

function adminFetchMock() {
  const calls: Array<{ url: string; method: string; body?: string; headers: Headers }> = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const headers = new Headers(init?.headers);
    calls.push({ url: u, method: init?.method ?? 'GET', body: init?.body as string | undefined, headers });
    if (u.endsWith('/protocol/openid-connect/token')) {
      return new Response(JSON.stringify({ access_token: 'admin-tok', expires_in: 300 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

const adminCfg = { issuerUrl: 'https://kc/realms/openldr', adminClientId: 'svc', adminClientSecret: 'sek' };

describe('identity admin actions', () => {
  it('throws IdentityAdminNotConfiguredError (no network) when creds are absent', async () => {
    const { calls, fetchFn } = adminFetchMock();
    const auth = createAuth({ issuerUrl: 'https://kc/realms/openldr' }, { fetchFn });
    await expect(auth.resetPassword('u1', 'pw', true)).rejects.toBeInstanceOf(IdentityAdminNotConfiguredError);
    expect(calls).toHaveLength(0);
  });

  it('resetPassword fetches a client_credentials token then PUTs reset-password', async () => {
    const { calls, fetchFn } = adminFetchMock();
    const auth = createAuth(adminCfg, { fetchFn });
    await auth.resetPassword('u1', 'secretpw', true);
    const token = calls.find((c) => c.url.endsWith('/protocol/openid-connect/token'))!;
    expect(token.method).toBe('POST');
    expect(token.body).toContain('grant_type=client_credentials');
    const reset = calls.find((c) => c.url.includes('/admin/realms/openldr/users/u1/reset-password'))!;
    expect(reset.method).toBe('PUT');
    expect(reset.headers.get('authorization')).toBe('Bearer admin-tok');
    expect(JSON.parse(reset.body!)).toEqual({ type: 'password', value: 'secretpw', temporary: true });
  });

  it('caches the admin token across calls', async () => {
    const { calls, fetchFn } = adminFetchMock();
    const auth = createAuth(adminCfg, { fetchFn });
    await auth.resetPassword('u1', 'pw', true);
    await auth.forceLogout('u1');
    expect(calls.filter((c) => c.url.endsWith('/protocol/openid-connect/token'))).toHaveLength(1);
  });

  it('sendPasswordResetEmail PUTs execute-actions-email with UPDATE_PASSWORD', async () => {
    const { calls, fetchFn } = adminFetchMock();
    const auth = createAuth(adminCfg, { fetchFn });
    await auth.sendPasswordResetEmail('u1');
    const c = calls.find((x) => x.url.includes('/users/u1/execute-actions-email'))!;
    expect(c.method).toBe('PUT');
    expect(JSON.parse(c.body!)).toEqual(['UPDATE_PASSWORD']);
  });

  it('forceLogout POSTs logout', async () => {
    const { calls, fetchFn } = adminFetchMock();
    const auth = createAuth(adminCfg, { fetchFn });
    await auth.forceLogout('u1');
    const c = calls.find((x) => x.url.includes('/users/u1/logout'))!;
    expect(c.method).toBe('POST');
  });

  it('refreshes the token once on a 401 from an admin call', async () => {
    let adminCalls = 0;
    const tokenCalls: number[] = [];
    const fetchFn = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/protocol/openid-connect/token')) { tokenCalls.push(1); return new Response(JSON.stringify({ access_token: `t${tokenCalls.length}`, expires_in: 300 }), { status: 200, headers: { 'content-type': 'application/json' } }); }
      adminCalls++;
      return new Response(null, { status: adminCalls === 1 ? 401 : 204 });
    }) as unknown as typeof fetch;
    const auth = createAuth(adminCfg, { fetchFn });
    await auth.forceLogout('u1');
    expect(tokenCalls.length).toBe(2); // initial + refresh after 401
    expect(adminCalls).toBe(2);
  });

  it('throws on a non-2xx admin response', async () => {
    const fetchFn = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith('/protocol/openid-connect/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 300 }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response('boom', { status: 500 });
    }) as unknown as typeof fetch;
    const auth = createAuth(adminCfg, { fetchFn });
    await expect(auth.forceLogout('u1')).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `pnpm --filter @openldr/adapter-auth test`
Expected: FAIL (methods don't exist).

- [ ] **Step 4: Implement in adapter-auth**

In `packages/adapter-auth/src/index.ts`: import the error, extend `AuthConfig`, add a `KcError`, and add the admin client + three methods. Add the import:
```ts
import type { AuthPort, TokenClaims } from '@openldr/ports';
import { IdentityAdminNotConfiguredError } from '@openldr/ports';
```
Extend `AuthConfig`:
```ts
export interface AuthConfig {
  issuerUrl: string;
  audience?: string;
  adminClientId?: string;
  adminClientSecret?: string;
}
```
Add near the top of the file (module scope):
```ts
export class KcError extends Error {
  constructor(public status: number, public detail: string) {
    super(`identity provider responded ${status}`);
    this.name = 'KcError';
  }
}
```
Inside `createAuth`, after `getKeySet`, add the admin client:
```ts
  const tokenEndpoint = `${cfg.issuerUrl}/protocol/openid-connect/token`;
  const adminBase = cfg.issuerUrl.replace('/realms/', '/admin/realms/');
  const adminConfigured = Boolean(cfg.adminClientId && cfg.adminClientSecret);
  let adminToken: { token: string; expiresAt: number } | undefined;

  async function fetchAdminToken(): Promise<string> {
    const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.adminClientId!, client_secret: cfg.adminClientSecret! });
    const res = await fetchFn(tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    if (!res.ok) throw new KcError(res.status, 'admin token request failed');
    const body = (await res.json()) as { access_token: string; expires_in?: number };
    adminToken = { token: body.access_token, expiresAt: Date.now() + ((body.expires_in ?? 300) - 30) * 1000 };
    return body.access_token;
  }
  async function getAdminToken(): Promise<string> {
    if (adminToken && Date.now() < adminToken.expiresAt) return adminToken.token;
    return fetchAdminToken();
  }
  async function adminVoid(path: string, init: RequestInit): Promise<void> {
    if (!adminConfigured) throw new IdentityAdminNotConfiguredError();
    const doFetch = async (tok: string) => {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${tok}`);
      if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      return fetchFn(`${adminBase}${path}`, { ...init, headers });
    };
    let res = await doFetch(await getAdminToken());
    if (res.status === 401) { adminToken = undefined; res = await doFetch(await getAdminToken()); }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new KcError(res.status, detail.slice(0, 500));
    }
  }
```
Add the three methods to the returned object (after `verifyToken`):
```ts
    async resetPassword(userId: string, password: string, temporary: boolean): Promise<void> {
      await adminVoid(`/users/${encodeURIComponent(userId)}/reset-password`, { method: 'PUT', body: JSON.stringify({ type: 'password', value: password, temporary }) });
    },
    async sendPasswordResetEmail(userId: string): Promise<void> {
      await adminVoid(`/users/${encodeURIComponent(userId)}/execute-actions-email`, { method: 'PUT', body: JSON.stringify(['UPDATE_PASSWORD']) });
    },
    async forceLogout(userId: string): Promise<void> {
      await adminVoid(`/users/${encodeURIComponent(userId)}/logout`, { method: 'POST' });
    },
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm --filter @openldr/adapter-auth test`
Expected: PASS (existing verifyToken/healthCheck tests + 7 new admin tests).

- [ ] **Step 6: Typecheck both packages + commit**

Run: `pnpm --filter @openldr/ports typecheck` and `pnpm --filter @openldr/adapter-auth typecheck` → EXIT 0
```bash
git add packages/ports/src/auth.ts packages/adapter-auth/src/index.ts packages/adapter-auth/src/index.test.ts
git commit -m "feat(auth): AuthPort admin actions (reset/send-email/force-logout) + Keycloak adapter"
```

---

## Task 2: Config + bootstrap wiring

**Files:**
- Modify: `packages/config/src/schema.ts`
- Modify: `packages/config/src/schema.test.ts`
- Modify: `packages/bootstrap/src/index.ts`

- [ ] **Step 1: Failing config test**

In `packages/config/src/schema.test.ts`, add (reuse the existing `base`/`ConfigSchema` from the file — see the auth-config describe added in SP1):

```ts
  it('accepts optional Keycloak admin client credentials', () => {
    const cfg = ConfigSchema.parse({ ...base, KEYCLOAK_ADMIN_CLIENT_ID: 'svc', KEYCLOAK_ADMIN_CLIENT_SECRET: 'sek' });
    expect(cfg.KEYCLOAK_ADMIN_CLIENT_ID).toBe('svc');
    expect(cfg.KEYCLOAK_ADMIN_CLIENT_SECRET).toBe('sek');
  });
  it('leaves admin creds undefined when omitted', () => {
    const cfg = ConfigSchema.parse({ ...base });
    expect(cfg.KEYCLOAK_ADMIN_CLIENT_ID).toBeUndefined();
  });
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @openldr/config test`
Expected: FAIL (fields undefined on the type / parse drops unknown keys).

- [ ] **Step 3: Add the fields**

In `packages/config/src/schema.ts`, inside `z.object({ ... })` near the OIDC fields, add:
```ts
    KEYCLOAK_ADMIN_CLIENT_ID: z.string().min(1).optional(),
    KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().min(1).optional(),
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @openldr/config test`
Expected: PASS.

- [ ] **Step 5: Wire bootstrap**

In `packages/bootstrap/src/index.ts`, change the `createAuth` call:
```ts
  const auth = createAuth({
    issuerUrl: cfg.OIDC_ISSUER_URL,
    audience: cfg.OIDC_AUDIENCE,
    adminClientId: cfg.KEYCLOAK_ADMIN_CLIENT_ID,
    adminClientSecret: cfg.KEYCLOAK_ADMIN_CLIENT_SECRET,
  });
```

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @openldr/config typecheck` and `pnpm --filter @openldr/bootstrap typecheck` → EXIT 0
```bash
git add packages/config/src/schema.ts packages/config/src/schema.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(config): KEYCLOAK_ADMIN_CLIENT_ID/SECRET wired into createAuth"
```

---

## Task 3: Server routes (reset-password / send-reset-email / force-logout)

**Files:**
- Modify: `apps/server/src/users-routes.ts`
- Modify: `apps/server/src/users-routes.test.ts`

- [ ] **Step 1: Add a recording `auth` fake + failing route tests**

In `apps/server/src/users-routes.test.ts`, extend `fakeCtx()`'s returned object with an `auth` fake that records calls (add a module-scope-capturable array — mirror the existing `auditEvents`/`__auditEvents` pattern). Inside `fakeCtx`, before `return`, add:
```ts
    const authCalls: Array<{ op: string; args: unknown[] }> = [];
```
Add to the returned object literal (alongside `audit`/`logger`):
```ts
      auth: {
        verifyToken: async () => ({ sub: 's' }),
        resetPassword: async (...args: unknown[]) => { authCalls.push({ op: 'resetPassword', args }); },
        sendPasswordResetEmail: async (...args: unknown[]) => { authCalls.push({ op: 'sendPasswordResetEmail', args }); },
        forceLogout: async (...args: unknown[]) => { authCalls.push({ op: 'forceLogout', args }); },
      },
      __authCalls: authCalls,
```
First READ `fakeCtx()` in `users-routes.test.ts` to see how its in-memory `users` array + `create`/`get` work (the array is a closure). The fake's `create` sets `subject: null`. To exercise the happy path you need a user whose `subject` is non-null, so add a tiny seed helper to the fake `users` object: a `__setSubject(id, subject)` that finds the stored user and assigns `.subject` (the array is in scope). Expose it on the returned ctx like `__authCalls`. Then write these concrete tests (real assertions, adapt the dropdown/actor setup to the file's existing patterns):

```ts
  it('reset-password: 409 without a subject; 204 + audit (no password) with one', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req) => { req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'] }; });
    const ctx = fakeCtx();
    registerUsersRoutes(app, ctx);
    const id = (await app.inject({ method: 'POST', url: '/api/users', payload: { username: 'bob', roles: [] } })).json().id;

    const noSubj = await app.inject({ method: 'POST', url: `/api/users/${id}/reset-password`, payload: { password: 'pw', temporary: true } });
    expect(noSubj.statusCode).toBe(409);

    (ctx as unknown as { __setSubject: (id: string, s: string) => void }).__setSubject(id, 'kc-sub-1');
    const ok = await app.inject({ method: 'POST', url: `/api/users/${id}/reset-password`, payload: { password: 'pw', temporary: true } });
    expect(ok.statusCode).toBe(204);
    const authCalls = (ctx as unknown as { __authCalls: Array<{ op: string; args: unknown[] }> }).__authCalls;
    expect(authCalls).toContainEqual({ op: 'resetPassword', args: ['kc-sub-1', 'pw', true] });
    const events = (ctx as unknown as { __auditEvents: unknown[] }).__auditEvents;
    expect(events.some((e) => (e as { action: string }).action === 'user.reset_password')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('pw'); // password never audited
  });

  it('send-reset-email: 204 + audit when the user has a subject', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req) => { req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'] }; });
    const ctx = fakeCtx();
    registerUsersRoutes(app, ctx);
    const id = (await app.inject({ method: 'POST', url: '/api/users', payload: { username: 'bob' } })).json().id;
    (ctx as unknown as { __setSubject: (id: string, s: string) => void }).__setSubject(id, 'kc-sub-1');
    const res = await app.inject({ method: 'POST', url: `/api/users/${id}/send-reset-email` });
    expect(res.statusCode).toBe(204);
    const authCalls = (ctx as unknown as { __authCalls: Array<{ op: string }> }).__authCalls;
    expect(authCalls.some((c) => c.op === 'sendPasswordResetEmail')).toBe(true);
  });

  it('force-logout: 400 on self, 204 on another user with a subject', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req) => { req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'] }; });
    const ctx = fakeCtx();
    registerUsersRoutes(app, ctx);
    const self = await app.inject({ method: 'POST', url: `/api/users/admin/force-logout` });
    expect(self.statusCode).toBe(400);
    const id = (await app.inject({ method: 'POST', url: '/api/users', payload: { username: 'bob' } })).json().id;
    (ctx as unknown as { __setSubject: (id: string, s: string) => void }).__setSubject(id, 'kc-sub-1');
    const ok = await app.inject({ method: 'POST', url: `/api/users/${id}/force-logout` });
    expect(ok.statusCode).toBe(204);
  });

  it('reset-password: 503 when the provider admin client is not configured', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req) => { req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'] }; });
    const ctx = fakeCtx();
    (ctx as unknown as { auth: { resetPassword: () => Promise<void> } }).auth.resetPassword = async () => {
      const e = new Error('not configured'); e.name = 'IdentityAdminNotConfiguredError'; throw e;
    };
    registerUsersRoutes(app, ctx);
    const id = (await app.inject({ method: 'POST', url: '/api/users', payload: { username: 'bob' } })).json().id;
    (ctx as unknown as { __setSubject: (id: string, s: string) => void }).__setSubject(id, 'kc-sub-1');
    const res = await app.inject({ method: 'POST', url: `/api/users/${id}/reset-password`, payload: { password: 'pw' } });
    expect(res.statusCode).toBe(503);
  });

  it('admin routes require lab_admin (403 for a non-admin actor)', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req) => { req.user = { id: 'tech', username: 'tech', displayName: null, roles: ['lab_technician'] }; });
    registerUsersRoutes(app, fakeCtx());
    const res = await app.inject({ method: 'POST', url: `/api/users/whatever/reset-password`, payload: { password: 'pw' } });
    expect(res.statusCode).toBe(403);
  });
```

- [ ] **Step 2: Run — expect FAIL** (routes missing)

Run: `pnpm --filter @openldr/server test -- users-routes`
Expected: FAIL.

- [ ] **Step 3: Implement the routes**

In `apps/server/src/users-routes.ts`, add a small zod schema and three routes (the file already imports `requireRole`, `recordAudit`, `z`). Add:
```ts
const resetPasswordInput = z.object({ password: z.string().min(1), temporary: z.boolean().optional() });

function isNotConfigured(e: unknown): boolean {
  return e instanceof Error && e.name === 'IdentityAdminNotConfiguredError';
}
```
Then inside `registerUsersRoutes`, after the existing routes:
```ts
  app.post('/api/users/:id/reset-password', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const p = resetPasswordInput.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const id = (req.params as { id: string }).id;
    const u = await ctx.users.get(id);
    if (!u) { reply.code(404); return { error: 'not found' }; }
    if (!u.subject) { reply.code(409); return { error: 'user has no linked identity-provider account' }; }
    try {
      await ctx.auth.resetPassword(u.subject, p.data.password, p.data.temporary ?? true);
    } catch (e) {
      if (isNotConfigured(e)) { reply.code(503); return { error: 'identity provider admin client is not configured' }; }
      reply.code(502); return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
    await recordAudit(ctx, req, { action: 'user.reset_password', entityType: 'user', entityId: id, before: null, after: null, metadata: { temporary: p.data.temporary ?? true } });
    reply.code(204); return null;
  });

  app.post('/api/users/:id/send-reset-email', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const u = await ctx.users.get(id);
    if (!u) { reply.code(404); return { error: 'not found' }; }
    if (!u.subject) { reply.code(409); return { error: 'user has no linked identity-provider account' }; }
    try {
      await ctx.auth.sendPasswordResetEmail(u.subject);
    } catch (e) {
      if (isNotConfigured(e)) { reply.code(503); return { error: 'identity provider admin client is not configured' }; }
      reply.code(502); return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
    await recordAudit(ctx, req, { action: 'user.send_reset_email', entityType: 'user', entityId: id, before: null, after: null });
    reply.code(204); return null;
  });

  app.post('/api/users/:id/force-logout', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (req.user?.id === id) { reply.code(400); return { error: 'cannot force-logout your own account' }; }
    const u = await ctx.users.get(id);
    if (!u) { reply.code(404); return { error: 'not found' }; }
    if (!u.subject) { reply.code(409); return { error: 'user has no linked identity-provider account' }; }
    try {
      await ctx.auth.forceLogout(u.subject);
    } catch (e) {
      if (isNotConfigured(e)) { reply.code(503); return { error: 'identity provider admin client is not configured' }; }
      reply.code(502); return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
    await recordAudit(ctx, req, { action: 'user.force_logout', entityType: 'user', entityId: id, before: null, after: null });
    reply.code(204); return null;
  });
```
(`redact` is already imported in this file from `@openldr/core`.)

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @openldr/server test -- users-routes` then `pnpm --filter @openldr/server test`
Expected: PASS (new route tests + full server suite). The password must not appear in recorded audit events.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @openldr/server typecheck` → EXIT 0
```bash
git add apps/server/src/users-routes.ts apps/server/src/users-routes.test.ts
git commit -m "feat(server): admin reset-password/send-reset-email/force-logout routes (guarded + audited)"
```

---

## Task 4: Web — ResetPasswordDialog + row actions + i18n

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/i18n/index.ts`
- Create: `apps/web/src/users/ResetPasswordDialog.tsx`
- Create: `apps/web/src/users/ResetPasswordDialog.test.tsx`
- Modify: `apps/web/src/pages/Users.tsx`
- Modify: `apps/web/src/pages/Users.test.tsx`

- [ ] **Step 1: Add i18n keys**

In `apps/web/src/i18n/index.ts`, add to the `users` object:
```ts
    resetPassword: 'Reset password',
    sendResetEmail: 'Send reset email',
    forceSignOut: 'Force sign-out',
    noProviderAccount: 'no linked account',
    resetPasswordTitle: 'Reset password',
    resetPasswordDescription: 'Set a new password for {{username}}.',
    newPassword: 'New password',
    newPasswordPlaceholder: 'Enter a new password',
    confirmPassword: 'Confirm password',
    copyPassword: 'Copy password',
    resetPasswordHint: 'Share this temporary password securely; the user must change it at next sign-in.',
    resetPasswordButton: 'Reset password',
    passwordRequired: 'Password is required.',
    passwordMismatch: 'Passwords do not match.',
    resetPasswordSavedToast: 'Password reset for {{username}}',
    sendResetEmailToast: 'Reset email sent to {{username}}',
    forceSignOutTitle: 'Force sign-out of {{username}}?',
    forceSignOutDescription: 'All of their active sessions will be terminated.',
    forceSignOutToast: 'Signed out all sessions for {{username}}',
```

- [ ] **Step 2: Add api client helpers**

In `apps/web/src/api.ts`, near the other user helpers (after `setUserStatus`), add:
```ts
export const resetUserPassword = (id: string, password: string, temporary: boolean): Promise<void> =>
  authFetch(`/api/users/${id}/reset-password`, jbody({ password, temporary }, 'POST')).then((r) => { if (!r.ok) throw new Error(`reset password failed: ${r.status}`); });
export const sendUserResetEmail = (id: string): Promise<void> =>
  authFetch(`/api/users/${id}/send-reset-email`, { method: 'POST' }).then((r) => { if (!r.ok) throw new Error(`send reset email failed: ${r.status}`); });
export const forceUserLogout = (id: string): Promise<void> =>
  authFetch(`/api/users/${id}/force-logout`, { method: 'POST' }).then((r) => { if (!r.ok) throw new Error(`force logout failed: ${r.status}`); });
```
> Read how `jbody`/`authFetch` are defined in `api.ts` and match their exact signatures (SP1 added `authFetch`; `jbody(body, method)` builds a JSON request init). If `jbody` has a different signature, adapt these three calls to it.

- [ ] **Step 3: Write the failing dialog test** — create `apps/web/src/users/ResetPasswordDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, resetUserPassword: vi.fn() };
});
import { resetUserPassword } from '@/api';
import { ResetPasswordDialog } from './ResetPasswordDialog';

const user = { id: 'u1', subject: 's1', username: 'ada', displayName: 'Ada', email: null, roles: [], status: 'active' as const, lastLoginAt: null, createdAt: null };

beforeEach(() => vi.clearAllMocks());

describe('ResetPasswordDialog', () => {
  it('rejects mismatched passwords without calling the api', async () => {
    render(<ResetPasswordDialog open user={user} onOpenChange={() => {}} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'xyz' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
    await waitFor(() => expect(screen.getByText('Passwords do not match.')).toBeTruthy());
    expect(resetUserPassword).not.toHaveBeenCalled();
  });

  it('submits a matching password (temporary) and signals done', async () => {
    (resetUserPassword as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const onDone = vi.fn();
    render(<ResetPasswordDialog open user={user} onOpenChange={() => {}} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
    await waitFor(() => expect(resetUserPassword).toHaveBeenCalledWith('u1', 'abc', true));
    expect(onDone).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run — expect FAIL**

Run: `pnpm --filter @openldr/web test -- ResetPasswordDialog`
Expected: FAIL (module missing).

- [ ] **Step 5: Implement the dialog** — create `apps/web/src/users/ResetPasswordDialog.tsx` (OpenLDR's `dialog.tsx` has no `DialogHeader`/`DialogFooter`, so use plain divs):

```tsx
import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { resetUserPassword, type User } from '@/api';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User | null;
  onDone: (user: User) => void;
}

export function ResetPasswordDialog({ open, onOpenChange, user, onDone }: Props) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (open) { setPassword(''); setConfirm(''); setError(null); setCopied(false); } }, [open]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(password); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* admin can read the field */ }
  };

  const submit = async () => {
    if (password.length < 1) { setError(t('users.passwordRequired')); return; }
    if (password !== confirm) { setError(t('users.passwordMismatch')); return; }
    if (!user) return;
    setError(null); setSaving(true);
    try {
      await resetUserPassword(user.id, password, true);
      onDone(user);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <div className="space-y-1.5">
          <DialogTitle>{t('users.resetPasswordTitle')}</DialogTitle>
          <DialogDescription>{user ? t('users.resetPasswordDescription', { username: user.username }) : ''}</DialogDescription>
        </div>
        <div className="space-y-3 py-2">
          {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
          <div>
            <Label htmlFor="rp-new">{t('users.newPassword')}</Label>
            <div className="flex gap-2">
              <Input id="rp-new" type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" placeholder={t('users.newPasswordPlaceholder')} />
              <Button type="button" variant="outline" size="icon" onClick={() => void copy()} disabled={password.length === 0} aria-label={t('users.copyPassword')}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
          <div>
            <Label htmlFor="rp-confirm">{t('users.confirmPassword')}</Label>
            <Input id="rp-confirm" type="text" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          </div>
          <p className="text-[11px] text-muted-foreground">{t('users.resetPasswordHint')}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t('common.cancel')}</Button>
          <Button onClick={() => void submit()} disabled={saving}>{saving ? t('common.saving') : t('users.resetPasswordButton')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```
> If `@/components/ui/label` does not exist, check the actual Label path/import used elsewhere (e.g. in `UserDialog.tsx`) and match it.

- [ ] **Step 6: Run — expect PASS**

Run: `pnpm --filter @openldr/web test -- ResetPasswordDialog`
Expected: PASS (2 tests).

- [ ] **Step 7: Wire the three row actions into the Users page**

In `apps/web/src/pages/Users.tsx`:
1. Imports: add `resetUserPassword` is used in the dialog; here add `sendUserResetEmail, forceUserLogout` to the `@/api` import, and `import { ResetPasswordDialog } from '@/users/ResetPasswordDialog';`.
2. State: add `const [resetting, setResetting] = useState<User | null>(null);` and `const [pendingLogout, setPendingLogout] = useState<User | null>(null);`.
3. Handlers (place near `doToggle`):
```ts
  const doSendResetEmail = async (u: User) => {
    try { await sendUserResetEmail(u.id); setToast({ kind: 'ok', text: t('users.sendResetEmailToast', { username: u.username }) }); }
    catch (e) { setToast({ kind: 'err', text: t('users.errorToast', { error: e instanceof Error ? e.message : String(e) }) }); }
  };
  const doForceLogout = async () => {
    if (!pendingLogout) return;
    const u = pendingLogout; setPendingLogout(null);
    try { await forceUserLogout(u.id); setToast({ kind: 'ok', text: t('users.forceSignOutToast', { username: u.username }) }); }
    catch (e) { setToast({ kind: 'err', text: t('users.errorToast', { error: e instanceof Error ? e.message : String(e) }) }); }
  };
```
4. In the `__actions` column dropdown (after the Disable/Enable item), add three items. `const noAcct = !u.subject;`:
```tsx
                <DropdownMenuItem disabled={noAcct} onClick={() => { if (!noAcct) setResetting(u); }}>
                  {t('users.resetPassword')}{noAcct ? ` (${t('users.noProviderAccount')})` : ''}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={noAcct} onClick={() => { if (!noAcct) void doSendResetEmail(u); }}>
                  {t('users.sendResetEmail')}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={noAcct || isSelf} onClick={() => { if (!noAcct && !isSelf) setPendingLogout(u); }} className="text-destructive focus:text-destructive">
                  {t('users.forceSignOut')}{isSelf ? ` (${t('users.selfSuffix')})` : ''}
                </DropdownMenuItem>
```
   Compute `noAcct` inside the accessor alongside `isSelf`.
5. Near the other dialogs at the bottom, add:
```tsx
        <ResetPasswordDialog open={resetting !== null} onOpenChange={(o) => { if (!o) setResetting(null); }} user={resetting} onDone={(u) => setToast({ kind: 'ok', text: t('users.resetPasswordSavedToast', { username: u.username }) })} />
        <ConfirmDialog
          open={pendingLogout !== null}
          onOpenChange={(o) => { if (!o) setPendingLogout(null); }}
          title={t('users.forceSignOutTitle', { username: pendingLogout?.username ?? '' })}
          description={t('users.forceSignOutDescription')}
          confirmLabel={t('users.forceSignOut')}
          destructive
          onConfirm={() => { void doForceLogout(); }}
        />
```
   Add `setResetting`/`pendingLogout` to the `columns` useMemo deps if referenced inside the accessor (they are via the setters — setters are stable, but `isSelf`/`noAcct` use `me?.id`/`u.subject` which are fine; keep deps `[me?.id, t]`).

- [ ] **Step 8: Add Users page action tests**

In `apps/web/src/pages/Users.test.tsx`, mock the three new api fns in the existing `vi.mock('@/api', ...)` factory (add `resetUserPassword`/`sendUserResetEmail`/`forceUserLogout` as `vi.fn()`), and add a test: a user with `subject: null` has the three new menu items disabled (`aria-disabled='true'`); a user with a subject + send-reset-email click calls `sendUserResetEmail`. (Adapt dropdown-open selectors to the existing Radix pattern used in the file.)

- [ ] **Step 9: Run — expect PASS**

Run: `pnpm --filter @openldr/web test -- Users` and `pnpm --filter @openldr/web test -- ResetPasswordDialog`, then `pnpm --filter @openldr/web test`
Expected: PASS (full web suite green).

- [ ] **Step 10: Typecheck + commit**

Run: `pnpm --filter @openldr/web typecheck` → EXIT 0
```bash
git add apps/web/src/api.ts apps/web/src/i18n/index.ts apps/web/src/users/ResetPasswordDialog.tsx apps/web/src/users/ResetPasswordDialog.test.tsx apps/web/src/pages/Users.tsx apps/web/src/pages/Users.test.tsx
git commit -m "feat(web): reset-password dialog + send-reset-email/force-sign-out row actions"
```

---

## Task 5: Full gate + final review

- [ ] **Step 1: Full gate**

Run: `pnpm turbo typecheck lint test build`
Expected: all PASS.

- [ ] **Step 2: depcruise**

Run: `pnpm depcruise`
Expected: no violations.

- [ ] **Step 3: Commit any fixups** (skip if clean)

```bash
git add -A
git commit -m "chore(auth): SP4 full-gate fixups"
```

---

## Self-Review notes (coverage vs spec)

- Spec §a port methods + error → Task 1. §b adapter (token client + 3 ops, not-configured guard, KcError) → Task 1. §c config → Task 2. §d bootstrap → Task 2. §e routes (3, guards 400/404/409/503/502, audited without password) → Task 3. §f web (api + ResetPasswordDialog + 3 row actions + i18n) → Task 4.
- §Testing: adapter injected-fetch (token/cache/401-refresh/each op/not-configured/KcError) → Task 1; routes guards + audit-without-password → Task 3; web dialog + disabled-when-no-subject/self → Task 4. Live-KC acceptance deferred (documented).
- §Boundaries: provider REST only in adapter-auth; routes use `ctx.auth` + duck-type the not-configured error by name (no `@openldr/ports` dep added).
- §Acceptance: gate + depcruise → Task 5.
- Type consistency: `AuthPort.resetPassword(userId, password, temporary)` / `sendPasswordResetEmail(userId)` / `forceLogout(userId)` identical across port, adapter, fake, and route call sites; web helpers `resetUserPassword(id, password, temporary)` / `sendUserResetEmail(id)` / `forceUserLogout(id)`.
