# SP1b — Interactive Browser Login (OIDC Authorization Code + PKCE) Design

**Date:** 2026-06-20
**Status:** Approved (brainstorming) — ready for implementation planning
**Branch:** `feat/p2-browser-login`
**Depends on:** SP1 (auth foundation — `verifyToken`, `req.user`, `authFetch`/`token.ts` seam, `AuthProvider`, dev-bypass), SP5 (the `openldr-web` realm login client), SP6 (composed Users; not required but coexists).

## Background

SP1 built the server-side auth foundation and a minimal web seam: `apps/web/src/auth/token.ts`
exposes `setAccessToken()` (currently never called), `authFetch` attaches the token when present,
and `AuthProvider` fetches `/api/me` on mount. There is **no interactive login** — the app only
works because `AUTH_DEV_BYPASS` injects a dev actor server-side. SP5 provisioned the `openldr-web`
public PKCE client + redirect URIs (5173/3000) and the seed `labadmin` user.

SP1b adds the real browser login: an OIDC Authorization Code + PKCE flow against the realm, wiring
the resulting access token into the existing `setAccessToken()` seam, so the app authenticates real
users while dev/e2e (under `AUTH_DEV_BYPASS`) keep working with no login.

Two decisions taken in brainstorming:
- **oidc-client-ts** (standard, provider-agnostic OIDC SPA library) — not keycloak-js, to preserve
  the provider decoupling. A future provider swap is config-only.
- **Include the EventSource fix** — once real tokens are required, the ontology build/rebuild SSE
  (`apps/web/src/api.ts:516`, `new EventSource(url)`) would 401 because `EventSource` cannot send an
  `Authorization` header. SP1b passes the token as a query param for those routes.

## Goal

Authenticate real users via an OIDC redirect login against the realm — token wired into the
existing seam, silent renew, sign-out, and the SSE token fix — without breaking the
`AUTH_DEV_BYPASS` dev/e2e path.

## Scope

In scope:

1. Server `/api/config` exposes the OIDC settings + `authEnforced`, and `/api/config` becomes
   publicly readable (the web needs it before it has a token). New config `OIDC_WEB_CLIENT_ID`.
2. Web OIDC client module (`auth/oidc.ts`) over `oidc-client-ts` `UserManager`, configured from
   `/api/config`; wires tokens into `setAccessToken()`.
3. `/auth/callback` route completing the code exchange.
4. `AuthProvider` rework: restore/require a session when enforced; stay anonymous under dev-bypass.
5. Token lifecycle (silent renew → `setAccessToken`; `401` → renew-or-relogin); sign-out UI.
6. EventSource fix: query-param token on the ontology build/rebuild SSE + server acceptance for
   those routes only.

Out of scope (non-goals):

- Server-side session/refresh-token storage (the SPA holds tokens via oidc-client-ts; the API is
  stateless bearer-verified).
- Role/claims changes (SP1 `syncFromClaims` already maps roles from the token).
- A bespoke login *page* UI — login is a redirect to Keycloak's hosted login (a minimal
  "signing in…" state covers the in-app moments).
- Migrating non-SSE requests to anything other than the existing `authFetch` header injection.

## Components

### a) Server `/api/config` — OIDC settings + public + `OIDC_WEB_CLIENT_ID`

- `packages/config/src/schema.ts`: add `OIDC_WEB_CLIENT_ID: z.string().min(1).default('openldr-web')`.
- `apps/server/src/app.ts` `/api/config` response gains:
  ```ts
  authEnforced: !ctx.cfg.AUTH_DEV_BYPASS,
  oidc: {
    issuerUrl: ctx.cfg.OIDC_ISSUER_URL,
    clientId: ctx.cfg.OIDC_WEB_CLIENT_ID,
    audience: ctx.cfg.OIDC_AUDIENCE ?? null,
  },
  ```
- `apps/server/src/auth-plugin.ts`: add `/api/config` to the public allow-list (alongside
  `/health` + static SPA) so the web can read it before authenticating. (Keep it returning the
  same shape; it leaks no secret — only the public client id + issuer URL.)

### b) Web OIDC client — `apps/web/src/auth/oidc.ts`

- Add dependency `oidc-client-ts`.
- `createOidc(cfg)` builds a `UserManager` from `/api/config`'s `oidc`:
  `authority = issuerUrl`, `client_id = clientId`, `redirect_uri = ${location.origin}/auth/callback`,
  `post_logout_redirect_uri = location.origin`, `response_type = 'code'`,
  `scope = 'openid profile email'`, `automaticSilentRenew = true`,
  `extraQueryParams = audience ? { audience } : undefined`, userStore = WebStorageStateStore
  (sessionStorage).
- Exposes: `signinRedirect()`, `handleCallback()` (returns the signed-in user), `signoutRedirect()`,
  `getStoredUser()`. On `events.addUserLoaded` and after `handleCallback`, call
  `setAccessToken(user.access_token)`; on `events.addUserUnloaded`/`addAccessTokenExpired`/sign-out,
  call `setAccessToken(null)`. This is the ONLY place that touches the token seam.
- The module is a thin, provider-agnostic wrapper — no Keycloak-specific calls.

### c) Callback route — `apps/web/src/auth/CallbackPage.tsx` + route `/auth/callback`

- Calls `handleCallback()`; on success → `navigate('/', { replace: true })`; on error → render a
  small error card with a "Try again" button that calls `signinRedirect()`.
- Registered in `App.tsx` as a route OUTSIDE the admin guards.

### d) AuthProvider rework — `apps/web/src/auth/AuthProvider.tsx`

On mount:
1. `fetchClientConfig()` (the public `/api/config`).
2. If `!authEnforced` (dev-bypass): skip OIDC entirely; `getMe()` (server injects dev actor) →
   set user. (Exactly today's behaviour — dev/e2e unchanged.)
3. If `authEnforced`:
   - If the current path is `/auth/callback`, render children (CallbackPage handles it); don't
     trigger a parallel redirect.
   - Else build the OIDC client; `getStoredUser()`. If a valid, non-expired user exists →
     `setAccessToken` + `getMe()` → set user. If none → `signinRedirect()` (and render a
     "signing in…" placeholder).
- Expose `signOut()` (calls `signoutRedirect()` + clears token). Keep `user`/`loading`/`hasRole`.
- A `401` from `getMe()` while enforced triggers a silent renew attempt, then re-login on failure.

### e) Sign-out UI — AppShell

- Add a sign-out affordance to the shell header (a user menu or a button showing the username),
  calling `useAuth().signOut()`. Hidden/no-op under dev-bypass (no real session to end).

### f) EventSource fix — `apps/web/src/api.ts` + `apps/server/src/auth-plugin.ts`

- Web: in `buildOntology`, append `&access_token=${encodeURIComponent(getAccessToken() ?? '')}` to
  the build/rebuild SSE URL (only when a token is present).
- Server: in the auth preHandler, for the ontology SSE GET routes
  (`/api/terminology/ontology/:id/build` and `/:id/rebuild`), if there is no `Authorization` header,
  accept a bearer token from the `access_token` query param and verify it the same way. Scope this
  to those two routes only (a small allow-list / path check) — every other route keeps requiring the
  header. The token is verified identically; no weakening of auth.

## Data flow (enforced login)

```
app load → GET /api/config (public) → { authEnforced:true, oidc:{issuer,clientId,audience} }
  → UserManager.getStoredUser() → none
  → signinRedirect()  → Keycloak hosted login (PKCE)
  → /auth/callback?code=… → handleCallback() → access/id/refresh tokens
  → setAccessToken(access_token) → navigate('/')
  → AuthProvider getMe() → /api/me resolves the real user → app renders
  → automaticSilentRenew refreshes the token in the background → setAccessToken(newToken)
  → sign-out → signoutRedirect() → Keycloak end-session → back to app (logged out)
```

## Error handling

- `/api/config` fetch failure → render a clear "cannot reach server" state (no redirect loop).
- Callback error (bad/expired code, state mismatch) → error card + "Try again".
- Silent-renew failure / `401` while enforced → one renew attempt, then `signinRedirect()`.
- Under dev-bypass, none of the OIDC paths run; failures degrade to the existing anonymous flow.
- The SSE token is verified server-side; an invalid query token gets the same 401 as a bad header.

## Testing

- **Server:** `/api/config` includes `authEnforced` + `oidc`; `/api/config` is reachable without a
  token (public allow-list); the ontology SSE routes accept a valid `access_token` query param and
  still 401 an invalid one (unit test against the preHandler with a fake verifyToken).
- **Web (mock-based):** `auth/oidc.ts` with a mocked `UserManager` (signin/callback/signout/getUser
  call-throughs + token→setAccessToken wiring); `AuthProvider` — enforced+no-session → calls
  `signinRedirect`; enforced+stored-user → sets token + loads `/api/me`; dev-bypass → anonymous
  `getMe` with no OIDC; on `/auth/callback` path → renders children without a parallel redirect;
  `CallbackPage` success/error; `signOut` calls `signoutRedirect`. Mock `oidc-client-ts` + `@/api`.
- **Live (now runnable on the laptop, against the SP5 realm):** `docker compose up -d keycloak` →
  app at the Vite dev server → redirected to Keycloak → sign in as `labadmin/labadmin` → `/api/me`
  resolves → token attached to API calls → sign-out → ontology build/rebuild SSE streams with the
  query token. (This is the real end-to-end validation; the automated suite stays mock-based.)

## Boundaries

- All OIDC/PKCE specifics live in `auth/oidc.ts` via standard `oidc-client-ts` config — provider-
  agnostic; a different provider is a config change.
- `token.ts` and `authFetch` are unchanged (the established seam); only `auth/oidc.ts` writes the
  token, and only `buildOntology` adds the SSE query param.
- The server only exposes settings, allow-lists `/api/config`, and accepts the SSE query token for
  two routes — no new session state.
- Dev-bypass remains the e2e/dev path; SP1b adds a parallel enforced path gated on `authEnforced`.

## Acceptance

- `pnpm turbo typecheck lint test build` + `pnpm depcruise` green (mock-based suite).
- With `AUTH_DEV_BYPASS` on (dev/e2e): no login, app works anonymously, existing Playwright e2e
  unchanged.
- With auth enforced + the realm up: the app redirects to Keycloak, signs in as `labadmin`,
  resolves `/api/me`, attaches the token to API calls, silently renews, signs out, and the ontology
  build/rebuild SSE streams with the token. (Live, run on the laptop.)
- `/api/config` is publicly readable and exposes only the public client id + issuer (no secret).
