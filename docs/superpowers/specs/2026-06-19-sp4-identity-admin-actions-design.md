# SP4 — Identity-Provider Admin Actions (password reset / send-reset-email / force sign-out)

**Date:** 2026-06-19
**Status:** Approved (brainstorming) — ready for implementation planning
**Branch:** `feat/p2-keycloak-admin`
**Depends on:** SP1 (auth foundation — `AuthPort`, `req.user`, `requireRole`), SP2 (audit helper), SP3 (Users page row-action menu + i18n).

## Background

The auth-owned Users actions deferred from SP3 — set/reset password, send a password-reset
email, and force sign-out (terminate all sessions) — require talking to the identity provider's
admin API. corlix does this via a service-account `client_credentials` token against the
Keycloak Admin REST API (`corlix/apps/api/src/services/keycloak-admin.ts`).

OpenLDR is deliberately **decoupled from any single auth product** (the `AUTH_ADAPTER` config
enum already anticipates multiple adapters; `@openldr/ports` defines the provider-agnostic
`AuthPort`, implemented by `packages/adapter-auth` for Keycloak). To keep that decoupling, SP4
adds the admin actions as **provider-agnostic operations on `AuthPort`**, implemented in the
Keycloak adapter. Route handlers call `ctx.auth.<op>(...)` and never reference Keycloak; a future
provider is a new adapter behind the same port.

A local user's `subject` IS the provider's user id (set by `syncFromClaims` on first login).
Admin actions therefore target `user.subject`. Users with `subject = null` (never logged in /
local-only) have no provider account, so the actions are unavailable for them.

User decisions taken during brainstorming:
- **All three actions** (reset password / send reset email / force sign-out).
- **Approach B, done via the port:** extend `AuthPort` (not a Keycloak-named package), implement
  in `adapter-auth` — for provider-swappability.
- Service-account `client_credentials` for admin auth (matches corlix; no stored human creds).
- **Live-Keycloak acceptance deferred** (no IdP to validate against yet) — tests use an injected
  fake; live acceptance is a documented follow-up.

## Goal

Let a `lab_admin` reset a user's password (temporary), trigger a provider password-reset email,
and force-terminate a user's sessions — through provider-agnostic `AuthPort` methods implemented
for Keycloak, fully guarded and audited, without coupling routes or stores to Keycloak.

## Scope

In scope:

1. Extend `AuthPort` with `resetPassword`, `sendPasswordResetEmail`, `forceLogout` (+ a typed
   `IdentityAdminNotConfiguredError`).
2. Implement them in `adapter-auth` (Keycloak): cached `client_credentials` admin token + admin
   REST calls; endpoints derived from `issuerUrl`; injectable `fetchFn`; typed errors.
3. Config: `KEYCLOAK_ADMIN_CLIENT_ID` + `KEYCLOAK_ADMIN_CLIENT_SECRET` (both optional); passed
   into `createAuth`. When absent, the admin methods throw `IdentityAdminNotConfiguredError`.
4. Three server routes on `users-routes.ts` (`requireRole('lab_admin')`, audited, target
   `user.subject`), with guards.
5. Web: a ported `ResetPasswordDialog` + three row-action menu items on the Users page, guarded
   and toasted, i18n'd.
6. Tests: adapter (injected fetch), routes (fake `AuthPort`), web (mocked api). Live-Keycloak
   acceptance documented as deferred.

Out of scope (deferred / non-goals):

- Live-Keycloak end-to-end acceptance (no IdP available yet) — documented follow-up.
- Provider-side user CRUD / role management (OpenLDR keeps user CRUD local + roles via JIT claims).
- A session-listing UI (only force-logout; no sessions table).
- SP1b interactive browser login (separate carryover).
- Migrating other auth concerns; this is strictly the three admin actions.

## Components

### a) Port — `packages/ports/src/auth.ts`

Extend `AuthPort` (keep `healthCheck` + `verifyToken` unchanged):

```ts
export interface AuthPort {
  healthCheck(): Promise<HealthResult>;
  verifyToken(token: string): Promise<TokenClaims>;
  /** Set a user's password. `temporary` forces a change at next login. */
  resetPassword(userId: string, password: string, temporary: boolean): Promise<void>;
  /** Trigger the provider's password-reset email flow for the user. */
  sendPasswordResetEmail(userId: string): Promise<void>;
  /** Terminate all of the user's provider sessions. */
  forceLogout(userId: string): Promise<void>;
}

export class IdentityAdminNotConfiguredError extends Error {
  constructor() {
    super('identity provider admin client is not configured');
    this.name = 'IdentityAdminNotConfiguredError';
  }
}
```

`userId` is the provider subject id (a local user's `subject`). The port names are
provider-neutral — no Keycloak terms.

### b) Adapter — `packages/adapter-auth/src/index.ts` (Keycloak)

- `AuthConfig` gains optional `adminClientId?: string` and `adminClientSecret?: string`.
- Derive `tokenEndpoint = ${issuerUrl}/protocol/openid-connect/token` and
  `adminBase = issuerUrl.replace('/realms/', '/admin/realms/')`.
- A cached service-account token (`grant_type=client_credentials`) with a 30s clock-skew margin
  and a single refresh-on-401 (port corlix's `getAdminToken`/`kcFetch`/`kcVoid`).
- `resetPassword(id, password, temporary)` → `PUT /users/{id}/reset-password`
  `{ type: 'password', value: password, temporary }`.
- `sendPasswordResetEmail(id)` → `PUT /users/{id}/execute-actions-email` body `["UPDATE_PASSWORD"]`.
- `forceLogout(id)` → `POST /users/{id}/logout`.
- If `adminClientId`/`adminClientSecret` are not both set, all three throw
  `IdentityAdminNotConfiguredError` (before any network call).
- A typed `KcError { status, detail }` for non-2xx provider responses (detail truncated/redacted).
- `deps.fetchFn` is reused for the admin calls (already injectable for tests). `verifyToken`
  unchanged.

### c) Config — `packages/config/src/schema.ts`

```ts
KEYCLOAK_ADMIN_CLIENT_ID: z.string().min(1).optional(),
KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().min(1).optional(),
```

No prod-guard (it's an integration credential, not a bypass). Secrets are covered by the
existing redaction at log/CLI boundaries.

### d) Bootstrap — `packages/bootstrap/src/index.ts`

Pass the admin creds into `createAuth`:
`createAuth({ issuerUrl: cfg.OIDC_ISSUER_URL, audience: cfg.OIDC_AUDIENCE, adminClientId: cfg.KEYCLOAK_ADMIN_CLIENT_ID, adminClientSecret: cfg.KEYCLOAK_ADMIN_CLIENT_SECRET })`.
No new `ctx` field — `ctx.auth` already carries the capability.

### e) Server routes — `apps/server/src/users-routes.ts`

Three new routes, each `{ preHandler: requireRole('lab_admin') }`, audited via the SP2
`recordAudit` helper, all resolving the local user then acting on `user.subject`:

- `POST /api/users/:id/reset-password` body `{ password: string, temporary?: boolean }` →
  `ctx.auth.resetPassword(subject, password, temporary ?? true)`; audit `user.reset_password`,
  `metadata: { temporary }` — **never the password**; `204`.
- `POST /api/users/:id/send-reset-email` → `ctx.auth.sendPasswordResetEmail(subject)`; audit
  `user.send_reset_email`; `204`.
- `POST /api/users/:id/force-logout` → self-guard (`req.user?.id === id` → `400`);
  `ctx.auth.forceLogout(subject)`; audit `user.force_logout`; `204`.

Shared guard order per route: validate body (`400`) → load local user, `404` if missing →
`409` if `user.subject` is null (no linked provider account) → call `ctx.auth.<op>` → on
`IdentityAdminNotConfiguredError` `503`, on `KcError`/other → redacted `502` (or `500`) →
audit only on success → respond `204`.

### f) Web — `apps/web`

- `api.ts`: `resetUserPassword(id, password, temporary)`, `sendUserResetEmail(id)`,
  `forceUserLogout(id)` (all POST via `authFetch`).
- `users/ResetPasswordDialog.tsx`: ported from corlix onto OpenLDR's `Dialog` primitive — a
  password + confirm field, copy-to-clipboard, a "temporary password" hint; i18n'd.
- `pages/Users.tsx`: add three items to the row-action dropdown — **Reset password** (opens the
  dialog), **Send reset email**, **Force sign-out** (behind `ConfirmDialog`). Each is **disabled
  when `!user.subject`** (hint: no linked account); Force sign-out is also disabled for the
  current user. Success/failure surface via the existing inline toast. New i18n keys under
  `users.*` (+ reuse `common.*`).

## Data flow

```
UI row action → POST /api/users/:id/{reset-password|send-reset-email|force-logout}
  → requireRole('lab_admin')
  → load local user (404) → check subject (409) → [force-logout: self-guard 400]
  → ctx.auth.<op>(user.subject, ...)   // AuthPort — Keycloak adapter does client_credentials + admin REST
  → on success: recordAudit (no password) → 204 → toast
  → IdentityAdminNotConfiguredError → 503 ; provider KcError → redacted 502
```

## Error handling

- `400` invalid body / self force-logout; `404` no local user; `409` user has no `subject`;
  `503` admin client not configured; `502`/`500` provider error (redacted detail; e.g. Keycloak
  `failed_to_send_email` when the realm has no SMTP — surfaced as a clear message).
- The password is never logged, never audited, never echoed in a response.
- Audit is recorded only after the provider call succeeds.

## Testing

- **Adapter** (`adapter-auth` test, injected `fetchFn`): admin-token fetch + cache reuse +
  refresh-on-401; each op issues the exact method/path/body; `IdentityAdminNotConfiguredError`
  when creds absent (no network call); `KcError` on non-2xx.
- **Routes** (fake `ctx.auth` recording calls + an admin actor): `404`/`409`/`503`/`400` guards;
  success `204`; audit event emitted with the right action/entityType and **without** the
  password; the validation/guard paths record nothing.
- **Web**: `ResetPasswordDialog` (mismatch + required validation, submit calls the api); the three
  menu items are disabled when `subject` is null and Force sign-out disabled for self; mocked api.
- **Deferred (documented):** live-Keycloak acceptance — run the three actions against a real realm
  (incl. SMTP for send-email) once an IdP is available.

## Boundaries

- Provider REST + token management live ONLY in `adapter-auth`.
- Routes depend on `AuthPort` (`ctx.auth`) + do guard/audit; no Keycloak terms in routes or stores.
- A future provider is a new adapter implementing `AuthPort` — routes, web, and config-shape
  (subject id) are unchanged.

## Acceptance

- `pnpm turbo typecheck lint test build` and `pnpm depcruise` green.
- `AuthPort` exposes the three admin methods; the Keycloak adapter implements them and throws
  `IdentityAdminNotConfiguredError` when creds are absent.
- The three routes are admin-guarded, target `user.subject`, audit on success without the
  password, and return the documented status codes for each guard.
- The Users page exposes the three actions with subject/self guards; the password never appears
  in logs or audit.
