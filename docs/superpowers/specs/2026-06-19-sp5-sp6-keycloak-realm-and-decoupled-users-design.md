# SP5 + SP6 — Keycloak Realm Provisioning + Decoupled User Model (Design)

**Date:** 2026-06-19
**Status:** Approved (brainstorming) — ready for implementation planning
**Branch:** `feat/p2-users-decoupled`
**Depends on:** SP1 (auth foundation), SP2 (audit), SP3 (Users UI + data-table + i18n + form-builder), SP4 (identity-admin actions on `AuthPort`).

## Background

OpenLDR is decoupled from any single auth product. The target user model (the corlix model,
verified from `corlix/apps/api/src/services/{keycloak-admin,user-profiles}.ts` +
`routes/users.ts`) is:

- **Keycloak owns identity** — username, password, email, first/last name, enabled, and roles.
  Read/written via the Keycloak Admin REST API (`listUsers`/`getUser`/`createUser`/`updateUser`/
  `setEnabled` + realm role-mappings). Sessions/password are SP4.
- **OpenLDR's internal DB owns additional profile info** — a `user_profiles` table keyed by the
  Keycloak user id (the OIDC `subject`), holding `form_schema_id` / `form_version` / `extras`
  (JSON `{ fieldKey: { value, fhirPath } }`).
- **The Users page is form-template driven** — a published form for the `'users'` target page
  defines the fields. CORE keys (`firstName`/`lastName`/`email`/`roles`) map to Keycloak identity;
  the rest are `extras` stored locally. (The form-builder ALREADY defines this `'users'`
  `PAGE_TARGET` with `requiredKeys: ['firstName','lastName','email','roles']`.)
- **Swapping auth providers = re-pointing the user id.** Profile extras stay in OpenLDR; only the
  `subject`/admin-client implementation changes.

Two gaps block this today:

1. **Keycloak is unprovisioned.** `docker-compose.yml` runs `keycloak:26.0` in `start-dev` with only
   the bootstrap `admin/admin` account on the default `master` realm; `.env.example` points at
   `…/realms/master`. There is no app realm, no clients, no app roles, no service account, no test
   users — so neither login (SP1b) nor the SP4 admin actions can run against it.
2. **OpenLDR's Users is a local mirror, not Keycloak-sourced.** `packages/users` stores
   username/displayName/email/roles/status locally; the list shows only users created locally or
   JIT-synced on login, and "create user" makes a local row with no Keycloak account. There is no
   `user_profiles`/extras concept and the dialog uses fixed fields, not the `'users'` form.

This spec covers BOTH phases in one document (per decision), implemented in sequence.

## Goal

Provision a self-contained Keycloak realm the stack actually uses, then re-architect Users so
Keycloak is the identity source of truth and OpenLDR stores only profile extras keyed by the
provider id — with a form-template-driven Users page — so the system is genuinely auth-provider
agnostic.

## Architecture (target)

```
Keycloak realm "openldr"  ── identity SoT ──────────────────────────────┐
  users (username/email/first/last/enabled) + realm roles + password/sessions
        ▲ admin REST (service-account client_credentials)               │
        │                                                                │
OpenLDR server  ── AuthPort.directory (provider-agnostic) ──────────────┘
  composes: Keycloak identity + roles  +  local user_profiles(extras) keyed by subject
        │
OpenLDR internal DB
  user_profiles(user_id = subject PK, form_schema_id, form_version, extras jsonb, updated_at)
  users(...) — retained as the audit-actor link (JIT-synced on login); NOT the directory source
        │
Web Users page  ── form-template driven (published 'users' form via FormRuntime)
  CORE fields (firstName/lastName/email/roles) → Keycloak ; other fields → extras
```

## Phase A — SP5: Keycloak realm provisioning

### A1. Realm export — `infra/keycloak/openldr-realm.json` (committed)

A `--import-realm` JSON defining realm `openldr`:
- **App realm roles:** `lab_admin`, `lab_manager`, `lab_technician`, `data_analyst`, `system_auditor`
  (matches `USER_ROLES`).
- **Login client** `openldr-web` — public client, standard flow + PKCE, redirect URIs
  `http://localhost:5173/*` and `http://localhost:3000/*`, web origins `+`. Used by SP1b.
- **API audience** (optional): an `openldr-api` client/audience so `OIDC_AUDIENCE` can be set.
- **Service-account admin client** `openldr-admin` — confidential, `serviceAccountsEnabled`, granted
  the `realm-management` client roles `manage-users` + `view-users` + `query-users` (and
  `view-realm` for roles). This is the SP4 / SP6 admin client.
- **A seed admin user** (`labadmin`) with a known dev password + the `lab_admin` role, for local
  login/testing.

### A2. Compose — `docker-compose.yml`

- Change the keycloak service to import the realm: mount `./infra/keycloak/openldr-realm.json` and
  run `start-dev --import-realm` (keep `KC_BOOTSTRAP_ADMIN_*` for the master console).
- Keep the override's `8180` host port.

### A3. Config / env — `.env.example`

- `OIDC_ISSUER_URL=http://localhost:8180/realms/openldr`
- `OIDC_AUDIENCE=openldr-api` (matches the realm; optional)
- `KEYCLOAK_ADMIN_CLIENT_ID=openldr-admin`
- `KEYCLOAK_ADMIN_CLIENT_SECRET=<dev secret matching the realm export>`

### A4. Docs — a short `infra/keycloak/README.md`

How to bring it up, the seed credentials, how to regenerate the export, and the security note that
the committed secret is a **dev-only** value to be overridden in real deployments.

SP5 deliverable: `docker compose up` yields a working `openldr` realm; the app verifies tokens
against it and the SP4 admin client authenticates. (Automated tests stay mock-based; bringing the
container up is a manual/CI step — see Testing.)

## Phase B — SP6: Decoupled user model

### B1. Identity directory on `AuthPort` — `packages/ports` + `packages/adapter-auth`

Add a provider-agnostic directory capability to `AuthPort` (keep it cohesive under a nested
`directory` namespace so the top-level port doesn't bloat):

```ts
export interface DirectoryUser {
  id: string;            // provider subject id
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  enabled: boolean;
  roles: string[];       // app roles only
  createdAt: string | null;
}
export interface DirectoryPort {
  list(opts?: { search?: string; max?: number }): Promise<DirectoryUser[]>;
  get(id: string): Promise<DirectoryUser | null>;
  create(input: { username: string; email?: string; firstName?: string; lastName?: string; enabled?: boolean; roles?: string[]; password?: string; temporaryPassword?: boolean }): Promise<DirectoryUser>;
  update(id: string, patch: { email?: string; firstName?: string; lastName?: string; enabled?: boolean }): Promise<void>;
  setRoles(id: string, roles: string[]): Promise<void>;
}
// AuthPort gains:  directory: DirectoryPort
```

Implemented in `adapter-auth` against the Keycloak Admin REST API (reuse the SP4 cached
`client_credentials` token + `adminVoid`/admin-fetch). Role read/write filters to the app roles
(`USER_ROLES`); `create` posts the user then assigns role-mappings + (optional) initial password.
When admin creds are absent, directory methods throw `IdentityAdminNotConfiguredError` (as SP4).

### B2. `user_profiles` store — `packages/users` + internal migration

- New internal migration `0NN_user_profiles`: `user_profiles(user_id text primary key,
  form_schema_id text null, form_version int null, extras jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now())`. `user_id` = the Keycloak subject.
- `createUserProfileStore(db)` with `get(userId)`, `list(userIds[])`, `upsert(userId, { formSchemaId, formVersion, extras })`. `extras` shape: `Record<string,{ value: string; fhirPath: string | null }>` (matches corlix).
- The existing `users` table/store is **retained** but repurposed: it remains the audit-actor link
  populated by `syncFromClaims` on login (so `req.user.id`/audit keeps working). The Users
  directory is NOT sourced from it anymore. Its `roles`/`status` columns become a best-effort cache
  (authoritative roles/enabled live in Keycloak). No destructive migration of `users`.

### B3. Server routes — `apps/server/src/users-routes.ts`

Re-front the Users API on the composed model (all admin-guarded + audited):
- `GET /api/users` → `ctx.auth.directory.list()` → for each, merge roles + `userProfiles.list(ids)`
  → a `UserSummary` `{ id, username, email, firstName, lastName, enabled, roles, createdAt, extras,
  formSchemaId, formVersion }`.
- `GET /api/users/:id` → `directory.get` + `userProfiles.get` composed.
- `POST /api/users` → `directory.create` (identity) **then** `userProfiles.upsert` (extras + form
  ref); audit `user.create`.
- `PUT /api/users/:id` → `directory.update` + `directory.setRoles` + `userProfiles.upsert`; audit
  `user.update`.
- `POST /api/users/:id/status` → `directory.update({ enabled })`; audit `user.status`.
- SP4 routes (`reset-password`/`send-reset-email`/`force-logout`) now target `:id` = the directory
  id directly (no local-subject lookup needed). The `409 no-subject` guard is dropped (the id IS the
  subject). Self-guard + audit unchanged.
- Errors: `IdentityAdminNotConfiguredError` → 503; provider error → redacted 502; validation 400;
  not-found 404.

### B4. Web Users page — `apps/web`

- The dialog becomes **form-template driven**: load the published `'users'` form via
  `listPublished({ targetPage: 'users' })` and render it with the existing `FormRuntime`. Map CORE
  apiProperties (`firstName`/`lastName`/`email`/`roles`) to the directory create/update payload; map
  the remaining fields to `extras`. (Mirror corlix's `CORE`/`mapFormValuesToApi`/`mapApiToFormValues`
  split.) An empty-state when no `'users'` form is published ("create one in the Form Builder").
- The Users **list/columns** consume the new `UserSummary` (full name from first+last; roles from
  Keycloak; status = enabled). The SP3 data-table, role labels, confirm/toast, SP4 row actions, and
  self-guards are retained; the `createdAt` column reads the directory value.
- `api.ts` client types update to `UserSummary`; helpers for create/update/setStatus post the
  composed payload.

## Key decisions (flagged for review)

1. **Directory lives under `AuthPort.directory`** (nested), not a separate top-level port — keeps the
   provider boundary in one place while not bloating the flat `AuthPort` surface. (Alternative: a
   sibling `IdentityDirectoryPort` — cleaner SRP but two ports for one provider.)
2. **`users` table retained as the audit-actor link**, not retired — avoids reworking SP1
   `syncFromClaims` + SP2 audit-actor resolution. The directory is Keycloak-sourced; `users.roles`/
   `status` become non-authoritative cache.
3. **Identity model shifts `displayName` → `firstName`/`lastName`** (Keycloak-native, matches the
   `'users'` PAGE_TARGET CORE keys). The web full-name column composes them.
4. **Live-Keycloak acceptance** of the composed flows + SP1b/SP4 is run manually against the new
   realm (documented), not in the automated mock-based suite.
5. **Graceful degradation when the admin client is unconfigured** (dev-bypass without Keycloak, the
   current e2e/local mode): the directory **GET** routes (`list`/`get`) fall back to the local
   `users` mirror (read-only, the SP1 JIT-synced rows + empty `extras`) so dev, Vitest, and the
   existing Playwright e2e keep working without a running Keycloak. **Mutations** (create/update/
   status + SP4 actions) return `503` when unconfigured (they genuinely cannot proceed without the
   provider). This keeps the SP3 Users page functional in dev while making Keycloak authoritative
   wherever it is configured.

## Data flow (create user)

```
Users dialog (published 'users' form) → POST /api/users { username, firstName, lastName, email, roles, password?, extras }
  → requireRole(lab_admin)
  → ctx.auth.directory.create(identity)  // Keycloak admin REST
  → ctx.userProfiles.upsert(newId, { formSchemaId, formVersion, extras })
  → recordAudit('user.create', entityId=newId)  // never the password
  → composed UserSummary → 201
```

## Error handling

- Admin client not configured → `503` on every directory/admin route (clear message).
- Keycloak/provider errors → redacted `502`; validation `400`; not-found `404`.
- Password never logged/audited/echoed (carried over from SP4).
- Profile upsert failure after a successful Keycloak create is surfaced (the identity exists; the
  route returns the identity + an error note) — documented; not silently swallowed.

## Testing

- **SP5:** the realm JSON is validated by a small test that parses it and asserts the required
  clients/roles/service-account are present (structural check, no running container). Bringing the
  container up + a smoke login is a documented manual/CI step.
- **SP6 adapter:** `directory.*` against injected `fetchFn` — list/get/create/update/setRoles issue
  the right admin REST calls; role filtering to app roles; not-configured throws.
- **SP6 routes:** fake `ctx.auth.directory` + `ctx.userProfiles`; assert composition (identity +
  roles + extras), create writes both identity and profile, audit emitted (no password), guards.
- **SP6 web:** the form-driven dialog (CORE→payload, others→extras) and the list rendering a
  `UserSummary`; mocked api.
- **Deferred (documented):** end-to-end against the live realm — login (SP1b), create/list/role
  changes round-tripping to Keycloak, SP4 actions, send-reset-email (needs realm SMTP).

## Migration / back-compat

- No destructive change to the `users` table. `user_profiles` is additive.
- `.env.example` flips the issuer to the `openldr` realm; existing local dev that pointed at
  `master` must re-point (documented in the Keycloak README).
- The web `User` shape becomes `UserSummary` (first/last instead of `displayName`); update the SP3
  columns + tests accordingly.

## Boundaries

- All Keycloak REST stays in `adapter-auth` behind `AuthPort.directory`.
- The composition (identity + roles + profile) lives in `users-routes`; `user_profiles` is a thin
  store; the web consumes `UserSummary` only.
- Swapping providers = a new `AuthPort` adapter; `user_profiles` (keyed by subject) is untouched.

## Acceptance

- `docker compose up` provisions the `openldr` realm (roles, login client, admin service account,
  seed admin); the app verifies tokens against it and the admin client authenticates.
- `pnpm turbo typecheck lint test build` + `pnpm depcruise` green (mock-based suite).
- Users list/get/create/update/status compose Keycloak identity + roles + local extras; the dialog
  is driven by the published `'users'` form (CORE→Keycloak, extras→local).
- SP4 admin actions target the directory id directly.
- Password never logged/audited; admin-not-configured → 503 everywhere.
- A documented manual live-Keycloak acceptance checklist exists for the deferred end-to-end runs.
