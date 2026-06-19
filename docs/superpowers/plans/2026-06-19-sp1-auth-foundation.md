# SP1 — Auth Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side authentication (Keycloak-issued token verification), a request actor, and an RBAC guard on Users mutations, plus minimal web wiring — without breaking dev, Vitest, or Playwright e2e.

**Architecture:** `adapter-auth.verifyToken` validates JWTs against the realm JWKS (`jose`). A global Fastify `onRequest` hook in `buildApp` resolves `req.user` from the bearer token (via `syncFromClaims`) or, in non-production with `AUTH_DEV_BYPASS`, injects a dev admin actor. A `requireRole` preHandler guards mutating Users routes. The web app centralizes `Authorization` injection, reads `/api/me` into an `AuthProvider`, and admin-guards `/users`. Interactive Keycloak login (PKCE/redirect/refresh) is deferred to SP1b.

**Tech Stack:** TypeScript, Fastify, `jose`, Zod (config), React + react-router, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-19-sp1-auth-foundation-design.md`

**Conventions:** pnpm workspace + turbo. Per-package tests: `pnpm --filter <pkg> test`. Full gate: `pnpm turbo typecheck lint test build` then `pnpm depcruise`. Commit after each task.

---

## File Structure

**Server / packages:**
- `packages/adapter-auth/src/index.ts` — implement `verifyToken` (modify)
- `packages/adapter-auth/src/index.test.ts` — verifyToken tests (modify)
- `packages/adapter-auth/package.json` — add `jose` (modify)
- `packages/config/src/schema.ts` — `OIDC_AUDIENCE`, `AUTH_DEV_BYPASS`, dev-actor fields, prod guard (modify)
- `packages/config/src/schema.test.ts` — config tests (modify, if present; else create)
- `packages/bootstrap/src/index.ts` — pass `audience` to `createAuth` (modify)
- `apps/server/src/auth-plugin.ts` — `RequestActor`, `req.user` augmentation, `registerAuth` (create)
- `apps/server/src/auth-plugin.test.ts` — preHandler tests (create)
- `apps/server/src/rbac.ts` — `requireRole` (create)
- `apps/server/src/rbac.test.ts` — guard tests (create)
- `apps/server/src/app.ts` — register auth hook + `/api/me` (modify)
- `apps/server/src/app.test.ts` — enable bypass in fake ctx (modify)
- `apps/server/src/users-routes.ts` — `requireRole('lab_admin')` on mutations (modify)
- `apps/server/src/users-routes.test.ts` — inject test actor (modify)
- `e2e/playwright.config.ts` — `AUTH_DEV_BYPASS` in webServer env (modify)

**Web:**
- `apps/web/src/auth/token.ts` — access-token holder (create)
- `apps/web/src/auth/AuthProvider.tsx` — current user + `hasRole` (create)
- `apps/web/src/auth/AuthProvider.test.tsx` — provider test (create)
- `apps/web/src/auth/RequireRole.tsx` — admin route guard (create)
- `apps/web/src/auth/RequireRole.test.tsx` — guard test (create)
- `apps/web/src/api.ts` — `authFetch`, `getMe`, `CurrentUser` (modify)
- `apps/web/src/main.tsx` — wrap with `AuthProvider` (modify)
- `apps/web/src/App.tsx` — guard `/users` (modify)

---

## Task 1: adapter-auth — implement `verifyToken`

**Files:**
- Modify: `packages/adapter-auth/package.json`
- Modify: `packages/adapter-auth/src/index.ts`
- Modify: `packages/adapter-auth/src/index.test.ts`

- [ ] **Step 1: Add `jose` dependency**

Edit `packages/adapter-auth/package.json` `dependencies` to add `jose`:

```json
  "dependencies": {
    "@openldr/core": "workspace:*",
    "@openldr/ports": "workspace:*",
    "jose": "^5.9.6"
  },
```

Then install:

Run: `pnpm install`
Expected: lockfile updates, `jose` resolved.

- [ ] **Step 2: Write failing tests for `verifyToken`**

Append to `packages/adapter-auth/src/index.test.ts` (keep existing `healthCheck` tests; add the import line at the top if missing):

```ts
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT, type JWTVerifyGetKey } from 'jose';

async function localKeySet(): Promise<{ sign: (claims: Record<string, unknown>, opts?: { iss?: string; aud?: string; exp?: string; sub?: string | null }) => Promise<string>; keySet: JWTVerifyGetKey }> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  const keySet = createLocalJWKSet({ keys: [jwk] });
  const sign = async (claims: Record<string, unknown>, opts: { iss?: string; aud?: string; exp?: string; sub?: string | null } = {}) => {
    let b = new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuedAt();
    if (opts.sub !== null) b = b.setSubject(opts.sub ?? 'user-123');
    b = b.setIssuer(opts.iss ?? 'https://kc/realms/openldr');
    if (opts.aud) b = b.setAudience(opts.aud);
    b = b.setExpirationTime(opts.exp ?? '5m');
    return b.sign(privateKey);
  };
  return { sign, keySet };
}

describe('verifyToken', () => {
  const issuer = 'https://kc/realms/openldr';

  it('accepts a valid token and returns claims', async () => {
    const { sign, keySet } = await localKeySet();
    const auth = createAuth({ issuerUrl: issuer, audience: 'openldr-api' }, { keySet });
    const token = await sign({ preferred_username: 'ada' }, { aud: 'openldr-api' });
    const claims = await auth.verifyToken(token);
    expect(claims.sub).toBe('user-123');
    expect(claims.preferred_username).toBe('ada');
  });

  it('rejects a wrong issuer', async () => {
    const { sign, keySet } = await localKeySet();
    const auth = createAuth({ issuerUrl: issuer }, { keySet });
    const token = await sign({}, { iss: 'https://evil/realms/x' });
    await expect(auth.verifyToken(token)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const { sign, keySet } = await localKeySet();
    const auth = createAuth({ issuerUrl: issuer }, { keySet });
    const token = await sign({}, { exp: '-1m' });
    await expect(auth.verifyToken(token)).rejects.toThrow();
  });

  it('rejects a wrong audience', async () => {
    const { sign, keySet } = await localKeySet();
    const auth = createAuth({ issuerUrl: issuer, audience: 'openldr-api' }, { keySet });
    const token = await sign({}, { aud: 'someone-else' });
    await expect(auth.verifyToken(token)).rejects.toThrow();
  });

  it('rejects a token without a sub claim', async () => {
    const { sign, keySet } = await localKeySet();
    const auth = createAuth({ issuerUrl: issuer }, { keySet });
    const token = await sign({}, { sub: null });
    await expect(auth.verifyToken(token)).rejects.toThrow(/sub/);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @openldr/adapter-auth test`
Expected: FAIL — `verifyToken` still throws "not implemented in the skeleton" / no `keySet` support.

- [ ] **Step 4: Implement `verifyToken`**

Replace the contents of `packages/adapter-auth/src/index.ts` with:

```ts
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { probe } from '@openldr/core';
import type { AuthPort, TokenClaims } from '@openldr/ports';

export interface AuthConfig {
  issuerUrl: string;
  /** Expected token audience. When unset, the audience check is skipped. */
  audience?: string;
}

export interface AuthDeps {
  fetchFn?: typeof fetch;
  /** Test seam — supply a local JWKS so verification needs no network. */
  keySet?: JWTVerifyGetKey;
}

export function createAuth(cfg: AuthConfig, deps: AuthDeps = {}): AuthPort {
  const fetchFn = deps.fetchFn ?? fetch;
  const discoveryUrl = `${cfg.issuerUrl}/.well-known/openid-configuration`;
  let keySet: JWTVerifyGetKey | undefined = deps.keySet;

  async function getKeySet(): Promise<JWTVerifyGetKey> {
    if (keySet) return keySet;
    const res = await fetchFn(discoveryUrl);
    if (!res.ok) throw new Error(`OIDC discovery returned ${res.status}`);
    const doc = (await res.json()) as { jwks_uri?: string };
    if (!doc.jwks_uri) throw new Error('OIDC discovery missing jwks_uri');
    keySet = createRemoteJWKSet(new URL(doc.jwks_uri));
    return keySet;
  }

  return {
    async healthCheck() {
      return probe(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        try {
          const res = await fetchFn(discoveryUrl, { signal: controller.signal });
          if (!res.ok) throw new Error(`OIDC discovery returned ${res.status}`);
          return 'OIDC issuer reachable';
        } finally {
          clearTimeout(timer);
        }
      });
    },
    async verifyToken(token: string): Promise<TokenClaims> {
      const jwks = await getKeySet();
      const { payload } = await jwtVerify(token, jwks, {
        issuer: cfg.issuerUrl,
        audience: cfg.audience,
      });
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new Error('token missing sub claim');
      }
      return payload as TokenClaims;
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/adapter-auth test`
Expected: PASS (healthCheck + verifyToken suites).

- [ ] **Step 6: Commit**

```bash
git add packages/adapter-auth/package.json packages/adapter-auth/src/index.ts packages/adapter-auth/src/index.test.ts pnpm-lock.yaml
git commit -m "feat(auth): implement adapter-auth verifyToken via JWKS"
```

---

## Task 2: config — `OIDC_AUDIENCE`, `AUTH_DEV_BYPASS`, dev actor, prod guard

**Files:**
- Modify: `packages/config/src/schema.ts`
- Modify (or create): `packages/config/src/schema.test.ts`

- [ ] **Step 1: Write failing config tests**

Add to `packages/config/src/schema.test.ts` (use the existing parse helper if one exists; otherwise import the exported parser — adjust the import to match the file's existing style):

```ts
import { describe, it, expect } from 'vitest';
import { parseConfig } from './schema';

const base = {
  INTERNAL_DATABASE_URL: 'postgres://localhost/x',
  TARGET_DATABASE_URL: 'postgres://localhost/y',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY_ID: 'k',
  S3_SECRET_ACCESS_KEY: 's',
  S3_BUCKET: 'b',
  OIDC_ISSUER_URL: 'http://localhost:8080/realms/openldr',
};

describe('auth config', () => {
  it('defaults AUTH_DEV_BYPASS on in development', () => {
    const cfg = parseConfig({ ...base, NODE_ENV: 'development' });
    expect(cfg.AUTH_DEV_BYPASS).toBe(true);
  });

  it('defaults AUTH_DEV_BYPASS off in production', () => {
    const cfg = parseConfig({ ...base, NODE_ENV: 'production' });
    expect(cfg.AUTH_DEV_BYPASS).toBe(false);
  });

  it('rejects AUTH_DEV_BYPASS=true under production', () => {
    expect(() => parseConfig({ ...base, NODE_ENV: 'production', AUTH_DEV_BYPASS: 'true' })).toThrow(/AUTH_DEV_BYPASS/);
  });

  it('exposes dev actor defaults', () => {
    const cfg = parseConfig({ ...base, NODE_ENV: 'development' });
    expect(cfg.AUTH_DEV_USERNAME).toBe('dev-admin');
    expect(cfg.AUTH_DEV_ROLES).toBe('lab_admin');
  });
});
```

> If `parseConfig` is not the exported name, check the top of `schema.ts` for the existing exported parse function and use that name in both the test and Step 3's verification.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/config test`
Expected: FAIL — `AUTH_DEV_BYPASS` / `AUTH_DEV_USERNAME` undefined.

- [ ] **Step 3: Add the fields**

In `packages/config/src/schema.ts`, inside the `z.object({ ... })` (next to the other auth/OIDC fields around `OIDC_ISSUER_URL`), add:

```ts
    OIDC_AUDIENCE: z.string().min(1).optional(),

    // Non-production auth bypass: when on and a request carries no bearer token,
    // the server injects a dev admin actor. MUST be off in production (enforced below).
    AUTH_DEV_BYPASS: z
      .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === true || v === 'true' || v === '1')),
    AUTH_DEV_USERNAME: z.string().min(1).default('dev-admin'),
    AUTH_DEV_ROLES: z.string().default('lab_admin'),
```

In the existing `.superRefine((cfg, ctx) => { ... })`, add this check:

```ts
    if (cfg.NODE_ENV === 'production' && cfg.AUTH_DEV_BYPASS === true) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['AUTH_DEV_BYPASS'], message: 'AUTH_DEV_BYPASS must be off in production' });
    }
```

Immediately after the `.superRefine(...)` call (chain it onto the schema), append a transform that resolves the default from `NODE_ENV`:

```ts
  .transform((cfg) => ({
    ...cfg,
    AUTH_DEV_BYPASS: cfg.AUTH_DEV_BYPASS ?? cfg.NODE_ENV !== 'production',
  }));
```

> If the schema currently ends with `.superRefine(...);` assigned to a const, move the `;` to after the new `.transform(...)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/config test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/config/src/schema.ts packages/config/src/schema.test.ts
git commit -m "feat(config): add OIDC_AUDIENCE + AUTH_DEV_BYPASS with prod guard"
```

---

## Task 3: server — request actor + auth preHandler

**Files:**
- Create: `apps/server/src/auth-plugin.ts`
- Create: `apps/server/src/auth-plugin.test.ts`

- [ ] **Step 1: Write failing preHandler tests**

Create `apps/server/src/auth-plugin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { registerAuth } from './auth-plugin';

type Claims = { sub: string; [k: string]: unknown };

function ctx(opts: {
  bypass?: boolean;
  verify?: (t: string) => Promise<Claims>;
  user?: { id: string; username: string; displayName: string | null; roles: string[]; status: 'active' | 'disabled' };
}): AppContext {
  const u = opts.user ?? { id: 'u1', username: 'ada', displayName: 'Ada', roles: ['lab_manager'], status: 'active' as const };
  return {
    cfg: { AUTH_DEV_BYPASS: opts.bypass ?? false, AUTH_DEV_USERNAME: 'dev-admin', AUTH_DEV_ROLES: 'lab_admin' },
    logger: { warn() {}, error() {}, info() {} },
    auth: { verifyToken: opts.verify ?? (async () => { throw new Error('bad'); }) },
    users: {
      syncFromClaims: async () => u,
      getByUsername: async () => undefined,
      create: async () => ({ id: 'dev1', username: 'dev-admin', displayName: 'Dev Admin', roles: ['lab_admin'], status: 'active' }),
    },
  } as unknown as AppContext;
}

async function appWith(c: AppContext) {
  const app = Fastify();
  registerAuth(app, c);
  app.get('/api/probe', async (req) => ({ user: req.user ?? null }));
  app.get('/health', async () => ({ ok: true }));
  return app;
}

describe('registerAuth', () => {
  it('leaves /health public (no actor required)', async () => {
    const app = await appWith(ctx({ bypass: false }));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('401s an /api request with no token when bypass is off', async () => {
    const app = await appWith(ctx({ bypass: false }));
    const res = await app.inject({ method: 'GET', url: '/api/probe' });
    expect(res.statusCode).toBe(401);
  });

  it('injects a dev actor when bypass is on and no token', async () => {
    const app = await appWith(ctx({ bypass: true }));
    const res = await app.inject({ method: 'GET', url: '/api/probe' });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.roles).toContain('lab_admin');
  });

  it('resolves req.user from a valid token', async () => {
    const app = await appWith(ctx({ verify: async () => ({ sub: 's1' }) }));
    const res = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer good' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe('ada');
  });

  it('401s on an invalid token', async () => {
    const app = await appWith(ctx({ verify: async () => { throw new Error('bad'); } }));
    const res = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer bad' } });
    expect(res.statusCode).toBe(401);
  });

  it('403s a disabled user', async () => {
    const c = ctx({ verify: async () => ({ sub: 's1' }), user: { id: 'u2', username: 'x', displayName: null, roles: [], status: 'disabled' } });
    const app = await appWith(c);
    const res = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer good' } });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/server test -- auth-plugin`
Expected: FAIL — `./auth-plugin` does not exist.

- [ ] **Step 3: Implement the plugin**

Create `apps/server/src/auth-plugin.ts`:

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';

export interface RequestActor {
  id: string;
  username: string;
  displayName: string | null;
  roles: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: RequestActor;
  }
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  const t = h.slice('Bearer '.length).trim();
  return t.length > 0 ? t : null;
}

async function devActor(ctx: AppContext): Promise<RequestActor> {
  const username = ctx.cfg.AUTH_DEV_USERNAME ?? 'dev-admin';
  const roles = (ctx.cfg.AUTH_DEV_ROLES ?? 'lab_admin')
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  try {
    const existing = await ctx.users.getByUsername(username);
    const u = existing ?? (await ctx.users.create({ username, displayName: 'Dev Admin', roles }));
    return { id: u.id, username: u.username, displayName: u.displayName, roles: u.roles.length > 0 ? u.roles : roles };
  } catch {
    return { id: `dev:${username}`, username, displayName: 'Dev Admin', roles };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerAuth(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.raw.url ?? '';
    // Only /api/* is protected. /health and the static SPA stay public.
    if (!url.startsWith('/api')) return;

    const token = bearer(req);
    if (!token) {
      if (ctx.cfg.AUTH_DEV_BYPASS) {
        req.user = await devActor(ctx);
        return;
      }
      reply.code(401);
      return reply.send({ error: 'authentication required' });
    }

    let claims;
    try {
      claims = await ctx.auth.verifyToken(token);
    } catch (e) {
      ctx.logger.warn({ error: e instanceof Error ? e.message : String(e) }, 'token verification failed');
      reply.code(401);
      return reply.send({ error: 'invalid token' });
    }

    try {
      const u = await ctx.users.syncFromClaims(claims);
      if (u.status === 'disabled') {
        reply.code(403);
        return reply.send({ error: 'account disabled' });
      }
      req.user = { id: u.id, username: u.username, displayName: u.displayName, roles: u.roles };
    } catch (e) {
      ctx.logger.error({ error: e instanceof Error ? e.message : String(e) }, 'user sync failed');
      reply.code(401);
      return reply.send({ error: 'authentication failed' });
    }
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/server test -- auth-plugin`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/auth-plugin.ts apps/server/src/auth-plugin.test.ts
git commit -m "feat(server): request actor + auth preHandler"
```

---

## Task 4: server — `requireRole` RBAC guard

**Files:**
- Create: `apps/server/src/rbac.ts`
- Create: `apps/server/src/rbac.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/server/src/rbac.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { requireRole } from './rbac';
import './auth-plugin'; // pulls in the req.user type augmentation

function appWith(actorRoles: string[] | null) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (actorRoles) req.user = { id: 'a', username: 'a', displayName: null, roles: actorRoles };
  });
  app.post('/api/admin', { preHandler: requireRole('lab_admin') }, async () => ({ ok: true }));
  return app;
}

describe('requireRole', () => {
  it('allows a matching role', async () => {
    const res = await appWith(['lab_admin']).inject({ method: 'POST', url: '/api/admin' });
    expect(res.statusCode).toBe(200);
  });
  it('403s a non-matching role', async () => {
    const res = await appWith(['lab_technician']).inject({ method: 'POST', url: '/api/admin' });
    expect(res.statusCode).toBe(403);
  });
  it('401s when there is no actor', async () => {
    const res = await appWith(null).inject({ method: 'POST', url: '/api/admin' });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/server test -- rbac`
Expected: FAIL — `./rbac` does not exist.

- [ ] **Step 3: Implement**

Create `apps/server/src/rbac.ts`:

```ts
import type { FastifyReply, FastifyRequest } from 'fastify';

/** preHandler guard: requires the request actor to hold at least one of `roles`. */
export function requireRole(...roles: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) {
      reply.code(401);
      return reply.send({ error: 'authentication required' });
    }
    if (!req.user.roles.some((r) => roles.includes(r))) {
      reply.code(403);
      return reply.send({ error: 'insufficient role' });
    }
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/server test -- rbac`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/rbac.ts apps/server/src/rbac.test.ts
git commit -m "feat(server): requireRole RBAC guard"
```

---

## Task 5: server — wire auth into `buildApp`, add `/api/me`, guard Users mutations, fix tests

**Files:**
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/users-routes.ts`
- Modify: `apps/server/src/app.test.ts`
- Modify: `apps/server/src/users-routes.test.ts`

- [ ] **Step 1: Add `requireRole` to Users mutations**

In `apps/server/src/users-routes.ts`, add the import after the existing imports:

```ts
import { requireRole } from './rbac';
```

Change the three mutating route registrations to add a preHandler (GET routes stay open to any authenticated user):

```ts
  app.post('/api/users', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
```
```ts
  app.put('/api/users/:id', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
```
```ts
  app.post('/api/users/:id/status', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
```

- [ ] **Step 2: Inject a test actor in `users-routes.test.ts`**

In `apps/server/src/users-routes.test.ts`, add an `onRequest` hook right after each `const app = Fastify();` and before `registerUsersRoutes(app, ...)`. (There may be more than one test that builds an app — add it to every one.)

```ts
    app.addHook('onRequest', async (req) => {
      req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'] };
    });
```

Also add this import at the top so the `req.user` augmentation is in scope:

```ts
import './auth-plugin';
```

- [ ] **Step 3: Register auth + `/api/me` in `buildApp`**

In `apps/server/src/app.ts`, add imports:

```ts
import { registerAuth } from './auth-plugin';
```

Inside `buildApp`, after the `/health` route and before the other `register*` calls, add:

```ts
  registerAuth(app, ctx);

  app.get('/api/me', async (req, reply) => {
    if (!req.user) {
      reply.code(401);
      return { error: 'authentication required' };
    }
    return req.user;
  });
```

- [ ] **Step 4: Enable bypass in `app.test.ts` fake ctx**

In `apps/server/src/app.test.ts`, find `ctxWith(...)` (returns an object with `cfg: {} as never`) and change that line to:

```ts
    cfg: { AUTH_DEV_BYPASS: true } as never,
```

This makes the global hook inject a dev actor (static fallback, since the fake ctx has no real `users` store) so the existing `/api/*` route assertions keep passing.

- [ ] **Step 5: Run the server test suite**

Run: `pnpm --filter @openldr/server test`
Expected: PASS — all suites including `app`, `users-routes`, `auth-plugin`, `rbac`. If any `/api/*` test in `app.test.ts` now 401s, confirm Step 4 set `AUTH_DEV_BYPASS: true`.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/app.ts apps/server/src/users-routes.ts apps/server/src/app.test.ts apps/server/src/users-routes.test.ts
git commit -m "feat(server): wire auth hook + /api/me + admin-guard Users mutations"
```

---

## Task 6: bootstrap audience + e2e bypass env

**Files:**
- Modify: `packages/bootstrap/src/index.ts`
- Modify: `e2e/playwright.config.ts`

- [ ] **Step 1: Pass audience to `createAuth`**

In `packages/bootstrap/src/index.ts`, change the `createAuth` call:

```ts
  const auth = createAuth({ issuerUrl: cfg.OIDC_ISSUER_URL, audience: cfg.OIDC_AUDIENCE });
```

- [ ] **Step 2: Set `AUTH_DEV_BYPASS` for the e2e server**

In `e2e/playwright.config.ts`, add an `env` key to the `webServer` block so the built server runs with bypass on:

```ts
  webServer: {
    command: 'node apps/server/dist/index.js',
    cwd: repoRoot,
    url: `${BASE_URL}/health`,
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, AUTH_DEV_BYPASS: 'true' },
  },
```

- [ ] **Step 3: Typecheck bootstrap**

Run: `pnpm --filter @openldr/bootstrap typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/bootstrap/src/index.ts e2e/playwright.config.ts
git commit -m "feat(bootstrap): pass OIDC audience; enable AUTH_DEV_BYPASS for e2e"
```

---

## Task 7: web — centralize `Authorization` injection

**Files:**
- Create: `apps/web/src/auth/token.ts`
- Modify: `apps/web/src/api.ts`

- [ ] **Step 1: Create the token holder**

Create `apps/web/src/auth/token.ts`:

```ts
// In-memory access-token holder. SP1b's login flow will call setAccessToken().
// Until then it stays null and the server's AUTH_DEV_BYPASS provides the actor.
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
```

- [ ] **Step 2: Add `authFetch` and route calls through it**

At the top of `apps/web/src/api.ts`, add:

```ts
import { getAccessToken } from './auth/token';

/** fetch wrapper that attaches the bearer token when one is present. */
export function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
```

Then replace every bare `fetch(` call in `apps/web/src/api.ts` with `authFetch(` — including the bodies of `apiGet`, `jbody`/`json` helpers and the inline dashboard/report calls. (Search the file for `fetch(` and swap each one. The `csvUrl` helper returns a string URL, not a `fetch` call — leave it; header-authenticated downloads are an SP1b concern.)

- [ ] **Step 3: Verify the web build typechecks**

Run: `pnpm --filter @openldr/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/auth/token.ts apps/web/src/api.ts
git commit -m "feat(web): centralize Authorization header injection via authFetch"
```

---

## Task 8: web — `/api/me` client + `AuthProvider`

**Files:**
- Modify: `apps/web/src/api.ts`
- Create: `apps/web/src/auth/AuthProvider.tsx`
- Create: `apps/web/src/auth/AuthProvider.test.tsx`
- Modify: `apps/web/src/main.tsx`

- [ ] **Step 1: Add the `/api/me` client**

In `apps/web/src/api.ts`, add (near the other user exports around `listUsers`):

```ts
export interface CurrentUser {
  id: string;
  username: string;
  displayName: string | null;
  roles: string[];
}
export const getMe = (): Promise<CurrentUser> => apiGet('/api/me', 'get current user');
```

- [ ] **Step 2: Write a failing AuthProvider test**

Create `apps/web/src/auth/AuthProvider.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthProvider';

vi.mock('@/api', () => ({
  getMe: vi.fn(),
}));
import { getMe } from '@/api';

function Probe() {
  const { user, loading, hasRole } = useAuth();
  if (loading) return <div>loading</div>;
  return <div>{user ? `${user.username}:${hasRole('lab_admin')}` : 'anon'}</div>;
}

describe('AuthProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes the current user and hasRole', async () => {
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'u1', username: 'ada', displayName: 'Ada', roles: ['lab_admin'] });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('ada:true')).toBeTruthy());
  });

  it('falls back to anon when /api/me fails', async () => {
    (getMe as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('401'));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('anon')).toBeTruthy());
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @openldr/web test -- AuthProvider`
Expected: FAIL — `./AuthProvider` does not exist.

- [ ] **Step 4: Implement `AuthProvider`**

Create `apps/web/src/auth/AuthProvider.tsx`:

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getMe, type CurrentUser } from '@/api';

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  hasRole: (role: string) => boolean;
}

const AuthContext = createContext<AuthState>({ user: null, loading: true, hasRole: () => false });

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getMe()
      .then((u) => { if (active) setUser(u); })
      .catch(() => { if (active) setUser(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const hasRole = (role: string) => user?.roles.includes(role) ?? false;

  return <AuthContext.Provider value={{ user, loading, hasRole }}>{children}</AuthContext.Provider>;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @openldr/web test -- AuthProvider`
Expected: PASS (2 tests).

- [ ] **Step 6: Wrap the app**

In `apps/web/src/main.tsx`, wrap `<App />` with `<AuthProvider>` inside `<BrowserRouter>`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './tokens.css';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/auth/AuthProvider.tsx apps/web/src/auth/AuthProvider.test.tsx apps/web/src/main.tsx
git commit -m "feat(web): AuthProvider backed by /api/me"
```

---

## Task 9: web — admin route guard on `/users`

**Files:**
- Create: `apps/web/src/auth/RequireRole.tsx`
- Create: `apps/web/src/auth/RequireRole.test.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Write a failing guard test**

Create `apps/web/src/auth/RequireRole.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RequireRole } from './RequireRole';

vi.mock('./AuthProvider', () => ({
  useAuth: vi.fn(),
}));
import { useAuth } from './AuthProvider';

function renderAt(roles: string[] | null, loading = false) {
  (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
    user: roles ? { id: 'u', username: 'u', displayName: null, roles } : null,
    loading,
    hasRole: (r: string) => roles?.includes(r) ?? false,
  });
  return render(
    <MemoryRouter initialEntries={['/users']}>
      <Routes>
        <Route path="/" element={<div>home</div>} />
        <Route path="/users" element={<RequireRole role="lab_admin"><div>admin-page</div></RequireRole>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireRole', () => {
  it('renders children for an admin', () => {
    renderAt(['lab_admin']);
    expect(screen.getByText('admin-page')).toBeTruthy();
  });
  it('redirects a non-admin to home', () => {
    renderAt(['lab_technician']);
    expect(screen.getByText('home')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openldr/web test -- RequireRole`
Expected: FAIL — `./RequireRole` does not exist.

- [ ] **Step 3: Implement the guard**

Create `apps/web/src/auth/RequireRole.tsx`:

```tsx
import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';

export function RequireRole({ role, children }: { role: string; children: ReactNode }) {
  const { user, loading, hasRole } = useAuth();
  if (loading) return null;
  if (!user || !hasRole(role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @openldr/web test -- RequireRole`
Expected: PASS (2 tests).

- [ ] **Step 5: Guard the `/users` route**

In `apps/web/src/App.tsx`, add the import:

```tsx
import { RequireRole } from './auth/RequireRole';
```

Change the `/users` route:

```tsx
      <Route path="/users" element={<RequireRole role="lab_admin"><Users /></RequireRole>} />
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/auth/RequireRole.tsx apps/web/src/auth/RequireRole.test.tsx apps/web/src/App.tsx
git commit -m "feat(web): admin-only route guard on /users"
```

---

## Task 10: Full gate

- [ ] **Step 1: Run the full gate**

Run: `pnpm turbo typecheck lint test build`
Expected: all packages PASS.

- [ ] **Step 2: Run dependency-cruiser**

Run: `pnpm depcruise`
Expected: no new violations (web auth imports `@/api`; server modules import `@openldr/bootstrap` types only — same as existing routes).

- [ ] **Step 3: Commit any fixups**

```bash
git add -A
git commit -m "chore(auth): SP1 full-gate fixups"
```

> If the gate is clean with nothing to commit, skip this step.

---

## Self-Review notes (coverage vs spec)

- Spec §2a verifyToken → Task 1. §2 OIDC_AUDIENCE + dev bypass + prod guard → Task 2.
- §2b preHandler / actor → Task 3. §2c requireRole → Task 4. §2d dev bypass actor → Tasks 2+3.
- §2e /api/me → Task 5. §2f web wiring (header injection, AuthProvider, admin guard) → Tasks 7–9.
- §5 migration risk (existing tests green under mandatory auth) → Task 5 (app.test.ts bypass, users-routes.test.ts actor) + Task 6 (e2e env).
- §Acceptance (gate green; 401/403/200 paths; prod-bypass config error; /api/me; admin guard) → covered by per-task tests + Task 10.
- Non-goal confirmed out of scope: interactive Keycloak login (SP1b) — `token.ts` exposes `setAccessToken` as the seam, no login UI added.
