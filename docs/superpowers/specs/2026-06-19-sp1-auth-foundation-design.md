# SP1 — Auth Foundation (Design)

**Date:** 2026-06-19
**Status:** Approved (brainstorming) — ready for implementation planning
**Branch:** `feat/p2-auth-foundation`

## Background

The "Users Corlix parity + audit" workstream was decomposed after discovering that
the auth layer it depends on does not exist yet:

- `AuthPort.verifyToken` is unimplemented — `packages/adapter-auth/src/index.ts`
  throws `auth.verifyToken not implemented in the skeleton`. Only `healthCheck`
  (OIDC discovery reachability) works.
- No route uses authentication — `apps/server/src/app.ts` registers routes with no
  `preHandler`. Every `/api/*` route runs unauthenticated today.
- There is therefore no request actor context (Forms audit hardcodes
  `actorName: 'System'`) and no RBAC enforcement anywhere.
- Config has `OIDC_ISSUER_URL` but no Keycloak admin credentials.
- The web app has no auth provider (`apps/web/src/main.tsx` is just
  `BrowserRouter → App`) and every `fetch` in `apps/web/src/api.ts` is header-less.

The user chose the **full sequence (auth first)**. The workstream is split into:

- **SP1 — Auth foundation** (this spec)
- **SP1b — Interactive Keycloak browser login** (deferred; see non-goals)
- **SP2 — Audit actor wiring + Users audit**
- **SP3 — Users UI parity**
- **SP4 — Keycloak Admin API** (password/session actions, audited)

Each later sub-project gets its own spec → plan → implementation cycle.

OpenLDR CE is deliberately **decoupled from Keycloak**: the local user store owns no
passwords or sessions and provisions users just-in-time from verified OIDC token
claims (`UserStore.syncFromClaims`). SP1 preserves that decoupling — it verifies
tokens issued by Keycloak; it does not own credentials.

## Goal

Establish server-side authentication, a request actor, and an RBAC guard helper, plus
the minimal web wiring needed to consume them — without breaking local dev, Vitest, or
Playwright e2e (which currently assume open routes).

## Scope

In scope:

1. Implement `verifyToken` in `adapter-auth` (JWKS signature + claim validation).
2. A global Fastify auth `preHandler` that resolves a request actor (`req.user`).
3. An RBAC guard helper (`requireRole`), applied to the mutating Users routes.
4. A dev/test bypass mode that injects a configurable admin actor in non-production.
5. A `/api/me` endpoint returning the resolved actor.
6. Minimal web wiring: centralized `Authorization` header injection, an `AuthProvider`
   (current user + `hasRole`), and an admin-only route guard on `/users`.
7. Test-harness migration so existing route tests + e2e stay green under mandatory auth.

## Non-goals (deferred)

- Interactive Keycloak login: PKCE redirect, callback route, token refresh, login/logout
  UI → **SP1b**.
- Token refresh / silent renew.
- Broad RBAC across every route — SP1 establishes the helper and guards Users mutations;
  other routes adopt the pattern in their own sub-projects.
- Keycloak Admin API (reset/temporary password, force sign-out, send-reset-email) → **SP4**.
- A permission matrix — SP1 uses simple role membership (matches corlix).

## Components

### a) `adapter-auth.verifyToken` — `packages/adapter-auth/src/index.ts`

- Add the `jose` dependency.
- Lazily fetch OIDC discovery (`{issuerUrl}/.well-known/openid-configuration`) to obtain
  `jwks_uri`; build a `createRemoteJWKSet(jwks_uri)` (jose handles key caching + rotation).
- `verifyToken(token)`: `jwtVerify(token, jwks, { issuer, audience })`, which validates the
  RS256 signature and `iss` / `aud` / `exp` / `nbf`. Return the claims; assert a non-empty
  `sub`. On any failure throw a typed auth error with a safe message (full detail logged by
  the caller, not returned to the client).
- New optional config `OIDC_AUDIENCE` (string). When unset, the audience check is skipped.
- `healthCheck` is unchanged.

### b) Auth preHandler — new `apps/server/src/auth-plugin.ts`

- Registered globally in `buildApp` before route registration.
- Public allow-list (no auth required): `GET /health`, static SPA assets, and the SPA
  not-found fallback. All `/api/*` routes require a resolved actor.
- Flow for a protected request:
  1. Extract `Authorization: Bearer <token>`.
  2. If dev-bypass is active and no token is present → inject the configured dev actor.
  3. Otherwise `ctx.auth.verifyToken(token)` → claims → `ctx.users.syncFromClaims(claims)`.
  4. If the resolved user `status === 'disabled'` → `403`.
  5. Decorate the request: `req.user = { id, username, displayName, roles }`.
- Provide a typed accessor / Fastify type augmentation for `req.user`.

### c) RBAC helper — new `apps/server/src/rbac.ts`

- `requireRole(...roles)` returns a `preHandler` that responds `403` when
  `req.user.roles` does not intersect the required roles.
- Applied in SP1 to the mutating Users routes (`POST /api/users`, `PUT /api/users/:id`,
  `POST /api/users/:id/status`) as `requireRole('lab_admin')`, so SP3 inherits enforcement.

### d) Dev/test bypass

- Config `AUTH_DEV_BYPASS` (boolean). Defaults **on** in `development` and `test`;
  `superRefine` raises a config error if it is enabled while `NODE_ENV=production`.
- When active and a request carries no bearer token, the preHandler injects a configurable
  dev admin actor. The dev actor is synced into the `users` table on first use (create-if-
  missing) so it is a real row — giving SP2 a real `actorId` for audit.
- Dev-actor identity is configurable (subject / username / roles) with a sensible default
  (`dev-admin`, roles `['lab_admin']`).
- This keeps local dev, Vitest route tests, and the Playwright e2e dev server working
  without an IdP.

### e) `/api/me` endpoint

- New route returning the resolved `req.user` (id, username, displayName, roles, status).
- Powers the web auth context and the admin route guard.

### f) Web wiring — `apps/web/src`

- Centralize all API calls in `api.ts` through a single header-injecting helper (a token
  source that returns nothing until SP1b wires real tokens). Consolidate the existing
  scattered `fetch(...)` calls and the `apiGet` / `jbody` / `okJson` helpers so the
  `Authorization` header is attached in exactly one place.
- An `AuthProvider` (new `auth/` module) fetches `/api/me` and exposes `currentUser` and
  `hasRole(role)`.
- An admin-only route guard component wraps `/users` (and is reusable for future admin
  pages): non-admins are redirected to `/`, mirroring corlix's `UsersPage` behaviour.
- 401 handling surfaces a "sign-in required" state. It is inert under dev-bypass but ready
  for SP1b to drive the real login.

## Data flow

```
browser request
  → (SP1b will attach Authorization: Bearer <token>)
  → auth preHandler: verifyToken + syncFromClaims (or dev-bypass actor)
  → req.user (actor)
  → [requireRole guard on protected mutations]
  → route handler
  → (SP2 audit reads req.user for actorId/actorName)
```

## Error handling

- `401` — missing / malformed / expired token, or JWKS / discovery fetch failure. Client
  sees a safe redacted message; the full error is logged server-side.
- `403` — resolved user is `disabled`, or lacks a required role.
- Config error at startup — `AUTH_DEV_BYPASS` enabled under `NODE_ENV=production`.

## Testing

- **adapter-auth (unit):** sign tokens with a local key via `jose` and serve a local JWKS;
  cover success, wrong `iss`, wrong `aud`, expired `exp`, and malformed token.
- **preHandler / RBAC:** build the app with a fake `AuthPort` that injects claims; assert
  `401` (no token, bypass off), `403` (disabled user / wrong role), `200` (valid actor),
  and dev-bypass actor injection. `/api/me` returns the actor.
- **Web:** `AuthProvider` + guard tests (admin sees `/users`, non-admin redirected); the
  header helper attaches `Authorization` only when a token is present.
- **Migration (in scope):** every existing route test runs unauthenticated today. The
  shared test app builder must enable bypass / inject a test actor; sweep all
  `apps/server/src/*-routes.test.ts` and the `e2e/` specs so they stay green under
  mandatory auth.

## Boundaries

- Token verification lives in `adapter-auth` (the port implementation).
- Actor resolution and RBAC are small, focused modules in `apps/server`
  (`auth-plugin.ts`, `rbac.ts`) — not scattered into individual route files.
- Web auth is a single `auth/` module + provider with header injection centralized in
  `api.ts`; pages call `hasRole`/`currentUser` but contain no auth logic.

## Acceptance

- `pnpm turbo typecheck lint test build` and `pnpm depcruise` are green.
- A request with a valid Keycloak-issued token resolves `req.user` and reaches handlers;
  an invalid/expired token gets `401`; a disabled user gets `403`; a non-admin calling a
  Users mutation gets `403`.
- With `AUTH_DEV_BYPASS` on, all existing route tests and Playwright e2e pass unchanged.
- `AUTH_DEV_BYPASS=true` with `NODE_ENV=production` fails config validation at startup.
- `/api/me` returns the resolved actor; the web `/users` route is admin-guarded.
