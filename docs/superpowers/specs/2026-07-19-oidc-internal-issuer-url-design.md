# OIDC internal back-channel for server-side identity-admin calls

**Date:** 2026-07-19
**Status:** Approved — ready for implementation plan
**Branch:** `claude/oidc-internal-issuer`

## Problem

Distributed-sync **site enrollment** fails in the production (Docker installer) topology. Two
independent defects, discovered by driving a real enrollment against a live installer stack:

1. **Bug #1 — config not wired.** The installer's generated `.env` never sets
   `KEYCLOAK_ADMIN_CLIENT_ID` / `KEYCLOAK_ADMIN_CLIENT_SECRET`. With both absent,
   `adapter-auth` sets `adminConfigured = false`
   (`packages/adapter-auth/src/index.ts:61`) and every identity-admin call throws
   `IdentityAdminNotConfiguredError`. The enroll route maps that to **HTTP 503**
   (`apps/server/src/settings-routes.ts:233`). Observed live:
   `POST /api/settings/sync/enroll → 503` in ~6 ms (never reaches Keycloak).

2. **Bug #2 — server-side Keycloak calls use the public issuer URL.** After Bug #1 is
   fixed, enrollment reaches Keycloak and fails with **HTTP 500**:
   `fetch failed: connect ECONNREFUSED 127.0.0.1:443`. In `adapter-auth`, both the
   token endpoint and the admin REST base are derived from the **public**
   `OIDC_ISSUER_URL`:

   ```ts
   const tokenEndpoint = `${cfg.issuerUrl}/protocol/openid-connect/token`;   // index.ts:59
   const adminBase     = cfg.issuerUrl.replace('/realms/', '/admin/realms/'); // index.ts:60
   ```

   In production `OIDC_ISSUER_URL = https://localhost/auth/realms/openldr`. From **inside
   the api container**, `localhost:443` is the api itself, not the gateway → connection
   refused. There is already an internal back-channel for JWKS
   (`OIDC_INTERNAL_JWKS_URL`, `packages/config/src/schema.ts:70`) precisely because the
   public issuer "may sit behind the gateway with a self-signed cert" — but that internal
   treatment was never extended to the token and admin endpoints.

### Why dev never caught it

In dev the api runs **on the host** (not containerized), so
`OIDC_ISSUER_URL = http://localhost:8180/realms/openldr` is reachable, and `.env.example`
sets the admin-client vars (`.env.example:24-25`). Enrollment (S4d) and identity-admin user
management (SP4) are the first features that make the api call Keycloak's **token/admin**
endpoints server-side, so the containerized topology never exercised this path until now.

### Blast radius

The same `adapter-auth` code path backs **all** identity-admin actions, so server-side
**user management** is broken in production for the same reason. This fix repairs both;
enrollment is the acceptance target.

## Decisions (agreed during brainstorming)

- **D1 — model:** add one new config var `OIDC_INTERNAL_ISSUER_URL` (an internal realm base
  URL, e.g. `http://keycloak:8080/auth/realms/openldr`). Derive the token + admin endpoints
  from it. Do **not** route the back-channel through the gateway (`/auth`) — that reintroduces
  the self-signed-TLS problem; go straight to the Keycloak container over plain http, exactly
  like `OIDC_INTERNAL_JWKS_URL` does.
- **D2 — admin secret:** wire the realm's existing pinned value
  (`openldr-admin-dev-secret`) now so enrollment works. Generating a random secret +
  realm-import substitution is a **separate hardening slice** (filed as a follow-up), not
  part of this change.

## Design

Five small, isolated edits. No compose or realm-JSON change (the api already reaches
`http://keycloak:8080` on the compose network — JWKS uses it today).

### A. `packages/adapter-auth/src/index.ts`

- Add `internalIssuerUrl?: string` to `AuthConfig` (documented like `internalJwksUrl`).
- Introduce a single resolved base for server-to-Keycloak calls:
  `const backChannelIssuer = cfg.internalIssuerUrl ?? cfg.issuerUrl;`
- Derive from `backChannelIssuer`:
  - `tokenEndpoint = ${backChannelIssuer}/protocol/openid-connect/token`
  - `adminBase = backChannelIssuer.replace('/realms/', '/admin/realms/')`
- The `/realms/` guard (`index.ts:82`) validates `backChannelIssuer` (the value actually used
  for admin), not the public issuer.
- **JWKS precedence (unchanged for existing deployments):**
  1. explicit `cfg.internalJwksUrl` if set (wins — back-compat), else
  2. derived `${backChannelIssuer}/protocol/openid-connect/certs` if `internalIssuerUrl` set,
     else
  3. OIDC discovery on the public `issuerUrl` (current default).
- **`verifyToken` is untouched:** it keeps `issuer: cfg.issuerUrl`
  (`index.ts:140`). Tokens carry the public `iss` (Keycloak emits the frontchannel URL via
  `KC_HOSTNAME`), so iss-claim validation must stay on the public issuer. This is the
  invariant that keeps login working.

### B. `packages/config/src/schema.ts`

- Add `OIDC_INTERNAL_ISSUER_URL: z.string().url().optional()` near `OIDC_INTERNAL_JWKS_URL`,
  with a comment: internal realm base for server-side token/admin/JWKS calls; the issuer
  **claim** is still validated against `OIDC_ISSUER_URL`.

### C. `packages/bootstrap/src/index.ts`

- At the `createAuth({...})` call (`index.ts:336`), pass
  `internalIssuerUrl: cfg.OIDC_INTERNAL_ISSUER_URL`.

### D. `install/install.sh`

- In the generated-`.env` heredoc, add three lines:
  - `KEYCLOAK_ADMIN_CLIENT_ID=openldr-admin`
  - `KEYCLOAK_ADMIN_CLIENT_SECRET=openldr-admin-dev-secret`
  - `OIDC_INTERNAL_ISSUER_URL=http://keycloak:8080/auth/realms/openldr`
- This subsumes the concurrent installer task's Bug #1 wiring. `install/install.ps1`
  (Windows installer) gets the same three lines for parity.

### E. No compose / realm change

The api already has network access to the Keycloak container. Nothing new to expose.

### Fallback / compatibility

- `OIDC_INTERNAL_ISSUER_URL` **unset** → `backChannelIssuer` falls back to the public
  `issuerUrl` → dev-on-host keeps working unchanged.
- Existing deployments that set `OIDC_INTERNAL_JWKS_URL` keep using it verbatim (JWKS
  precedence rule 1). Zero regression.

## Testing

### Unit — `packages/adapter-auth/src/index.test.ts`
- With `internalIssuerUrl` set: the admin-token request and an admin REST call fetch the
  **internal** base (assert on the URL passed to the injected `fetchFn`).
- With `internalIssuerUrl` unset: they fetch the **public** issuer (current behavior preserved).
- `verifyToken` still expects `issuer = issuerUrl` regardless of `internalIssuerUrl`.
- JWKS precedence: explicit `internalJwksUrl` > derived-from-`internalIssuerUrl` > discovery.

### Unit — `packages/config/src/schema.test.ts`
- `OIDC_INTERNAL_ISSUER_URL` parses when present and is `undefined` when absent (optional).

### Live acceptance (the real proof)
1. Rebuild the `openldr-api` image with these changes.
2. Redeploy the laptop production stack (`D:\Downloads\openldr`) with
   `OIDC_INTERNAL_ISSUER_URL` + the two admin-client vars in `.env`.
3. Mint a `labadmin` token and `POST /api/settings/sync/enroll` (siteId `verify-fix-01`,
   centralUrl `https://10.233.202.217`). Expect **HTTP 200** with
   `clientId / clientSecret / oidcIssuer / centralUrl / signingPrivateKey / centralPublicKey`.
4. Clean up: revoke the test site; the enroll harness reverts the temporary direct-grant
   toggle it uses to obtain the user token.

## Rollout

- Rebuild + push **only `openldr-api`** (studio / web / gateway are unchanged).
- Manual `scripts/build-and-push.sh` discipline: `--no-push` build first, single-arch
  **amd64**, immutable pin tag, `docker builder prune -af` then rebuild if buildx flakes.
- Update `docs/sync-live-test-phase1-lan.md` with the new required `.env` var if warranted.

## Follow-ups (separate slices — filed, not in this change)

1. **Admin-secret hardening:** installer generates a random `openldr-admin` secret and
   injects it into the realm import via `${ENV}` substitution (realm JSON + keycloak compose
   env + `.env`), with a dev-default fallback.
2. **User-management prod smoke test:** confirm this fix also repairs server-side user CRUD in
   the containerized topology (same code path; not part of this slice's acceptance).

## Out of scope

- lab→central TLS trust for the self-signed central cert (Phase-2 live-testing concern).
- The distributed-sync feature itself (unchanged).
