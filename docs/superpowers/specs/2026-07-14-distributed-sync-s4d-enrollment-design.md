# Distributed Sync — S4d: Enrollment Automation (central-side)

**Date:** 2026-07-14
**Slice:** S4d (final S4 sub-slice) — "central mints a lab's sync client"
**Branch:** `feat/sync-s4d-enrollment` (to cut)
**Parent architecture:** `docs/superpowers/specs/2026-07-02-distributed-sync-architecture-design.md` (north-star, `6fc9bb75`)
**Predecessors:** S1 push (`c5131a31`), S2 pull config (`fd7fee91`), S3 terminology pull (`84304da7`), S4a-c reconcile+UI (`98c7b0e9`) — all pushed.

## Context & the shortcut this closes

Central validates a lab's machine token in `sitePrincipal` (`apps/server/src/sync-routes.ts:9-33`) by reading a top-level `site_id` claim from `ctx.auth.verifyToken(token)`. S1 flagged that the Keycloak confidential client per lab + its `site_id` protocol-mapper are created MANUALLY. S4a-c made the lab side operable (the operator pastes `clientId`/`clientSecret`/`oidcIssuer`/`siteId` into the Sync card). S4d automates the CENTRAL side: a central admin mints the client + mapper + secret + a site record with one command / click, and hands the lab its credentials.

The architecture spec (§6 line 68): "an admin registers a lab at central (creates the Keycloak client + a site record, mints credentials), and hands the lab its client credentials + central URL." §1 line 22: "Central knows every site." Neither the site record nor the minting exists yet.

**Key substrate facts (from the S4d inventory):**
- adapter-auth (`packages/adapter-auth/src/index.ts`) already has `getAdminToken` (cached client-credentials), `adminFetchRaw(path, init)` (bearer + 401-retry, realm-scoped: `adminBase = issuerUrl.replace('/realms/','/admin/realms/')`, defaults JSON content-type), `adminJson`/`adminVoid`, `IdentityAdminNotConfiguredError`, and the create-user pattern that **parses the new resource UUID from the `Location` header** (`index.ts:172-187`). It has NO client-management methods — `AuthPort` (`packages/ports/src/auth.ts:42-52`) is user-only.
- **No Keycloak client-creation exists anywhere programmatically** — S4d builds it from scratch on `adminFetchRaw`.
- **`sitePrincipal` reads a TOP-LEVEL `site_id` string claim** (`sync-routes.ts:27`) → the mapper must be a **hardcoded-claim mapper** in the access token.
- **`verifyToken` validates issuer always; audience only when `OIDC_AUDIENCE` (`cfg.audience`) is set** (`index.ts:137-148`). If central sets `OIDC_AUDIENCE`, the minted client must also emit that `aud` (an audience mapper, mirroring the web client in `infra/keycloak/openldr-realm.json:30-41`).
- **CRITICAL realm gap:** `openldr-admin`'s service account has only `manage-users/view-users/query-users/view-realm` (`infra/keycloak/openldr-realm.json:72-78`). Creating clients + reading secrets needs **`manage-clients` + `view-clients`** — must be added to the realm export + `.template` + asserted in `apps/server/src/keycloak-realm.test.ts`.
- No site table; latest migration `050` → new `051`. `ctx.auth` is the adapter-auth instance on `AppContext`; the CLI/route call `ctx.auth`. Precedent for route→ctx.auth→adminFetchRaw + audit + `isNotConfigured`→503: `apps/server/src/users-routes.ts`. Precedent for a shared CLI+HTTP orchestration: the `danger*` orchestrations. Precedent for the studio admin page: `apps/studio/src/pages/Users.tsx`.
- Enrollment runs where the Keycloak admin creds point at the sync realm — i.e. **at central**. A non-central instance without those creds gets `IdentityAdminNotConfiguredError` → 503. There is no explicit "I am central" flag and none is added.

## Scope (decided: full — CLI + endpoint + studio Sites page, full lifecycle)

**In:** enroll / list / rotate / revoke, exposed via CLI **and** central HTTP endpoints **and** a studio "Sites" admin page. A `sync_sites` registry. The realm-role prerequisite.

**Out (later / not this slice):** lab-self-registration (enrollment stays central-admin-initiated); automatic credential delivery to the lab (the admin hands them over out-of-band — the lab pastes into its Sync card); rotating/revoking via the lab side; multi-realm/federation; an "I am central" role.

## Design

### 0. Realm prerequisite
Add `"manage-clients"` and `"view-clients"` to the `openldr-admin` client's `realm-management` service-account role list in `infra/keycloak/openldr-realm.json` AND `infra/keycloak/openldr-realm.json.template`. Extend `apps/server/src/keycloak-realm.test.ts` to assert both are present. (Deliberate authority widening — documented.)

### 1. adapter-auth client primitives (`AuthPort` + adapter-auth)
Add a `clients` sub-port to `AuthPort` (mirrors the `directory` sub-port shape), implemented in adapter-auth via `adminFetchRaw`:
```ts
interface SyncClientPort {
  findUuidByClientId(clientId: string): Promise<string | null>;        // GET /clients?clientId=…  → [0].id
  createConfidentialClient(clientId: string): Promise<string>;          // POST /clients → uuid from Location
  addSiteIdMapper(uuid: string, siteId: string): Promise<void>;         // POST /clients/{uuid}/protocol-mappers/models (hardcoded-claim)
  addAudienceMapper(uuid: string, audience: string): Promise<void>;     // only used when OIDC_AUDIENCE set
  getClientSecret(uuid: string): Promise<string>;                       // GET /clients/{uuid}/client-secret → .value
  regenerateClientSecret(uuid: string): Promise<string>;               // POST /clients/{uuid}/client-secret → .value
  deleteClient(uuid: string): Promise<void>;                            // DELETE /clients/{uuid}
}
// on AuthPort: clients: SyncClientPort
```
- `createConfidentialClient` body: `{ clientId, protocol:'openid-connect', publicClient:false, serviceAccountsEnabled:true, standardFlowEnabled:false, implicitFlowEnabled:false, directAccessGrantsEnabled:false, enabled:true }`. Parse the created UUID from the `Location` header exactly as `directory.create` does (`index.ts:175-177`).
- `addSiteIdMapper`: `POST /clients/{uuid}/protocol-mappers/models` `{ name:'sync-site-id', protocol:'openid-connect', protocolMapper:'oidc-hardcoded-claim-mapper', config:{ 'claim.name':'site_id', 'claim.value':siteId, 'claim.value.type':'String', 'access.token.claim':'true', 'id.token.claim':'false', 'userinfo.token.claim':'false' } }`.
- `addAudienceMapper`: `protocolMapper:'oidc-audience-mapper'`, `config:{ 'included.client.audience':audience, 'access.token.claim':'true' }`.
- All idempotency/existence handling (e.g. a mapper already exists on re-run) lives in the orchestrator, not here — these are thin REST wrappers. Unit-tested via the existing `fetchFn` test seam (assert method/path/body per call).

### 2. Site registry
- **Migration `051_sync_sites`** (register in `migrations/internal/index.ts`; add to `InternalSchema`):
```
sync_sites(
  site_id     text primary key,
  name        text,
  client_id   text not null,
  enrolled_at timestamptz not null default now(),
  enrolled_by text,
  status      text not null default 'active'   -- 'active' | 'revoked'
)
```
- **`createSyncSiteStore(db)`** (`packages/db/src/sync-site-store.ts`): `list()`, `get(siteId)`, `insert(row)`, `setStatus(siteId, status)` — NO secrets ever stored. Wire on `AppContext` (`ctx.syncSites`), mirroring the many `create*Store(internal.db)` calls in bootstrap. Also update the migration snapshot test (`migrations.test.ts`) with `051`.

### 3. Enrollment orchestrator (shared CLI + HTTP)
`packages/bootstrap/src/enrollment.ts` — pure orchestrations over `ctx.auth.clients` + `ctx.syncSites` + config (the `danger*` pattern; injectable for tests):
```ts
interface EnrollResult { clientId: string; clientSecret: string; siteId: string; centralUrl: string; oidcIssuer: string }
enrollSite(ctx, { siteId, name, centralUrl, actor }): Promise<EnrollResult>;
listSites(ctx): Promise<SyncSiteRow[]>;               // registry rows, no secrets
rotateSite(ctx, siteId): Promise<{ clientId: string; clientSecret: string }>;
revokeSite(ctx, siteId): Promise<void>;
```
Semantics:
- **enrollSite**: reject if `syncSites.get(siteId)` exists with status `active` (`AlreadyEnrolledError`). Derive `clientId = 'sync-' + siteId` (validate `siteId` is a safe slug — `[a-z0-9-]+`). Mint: `createConfidentialClient(clientId)` → `addSiteIdMapper(uuid, siteId)` → (if `cfg.OIDC_AUDIENCE`) `addAudienceMapper(uuid, cfg.OIDC_AUDIENCE)` → `getClientSecret(uuid)`. Insert the `sync_sites` row (status active, enrolled_by=actor). If a re-enroll of a previously-`revoked` site, re-mint (the client may or may not still exist — `findUuidByClientId` first; reuse if present, else create) and flip status back to active. Return `{clientId, clientSecret, siteId, centralUrl, oidcIssuer: cfg.OIDC_ISSUER_URL}`. **The secret is returned, never persisted on central.**
- **listSites**: `syncSites.list()`.
- **rotateSite**: `findUuidByClientId('sync-'+siteId)` (404 → `SiteNotFoundError`); `regenerateClientSecret(uuid)`; return `{clientId, clientSecret}`. No registry change.
- **revokeSite**: `findUuidByClientId(...)` → if present `deleteClient(uuid)`; `syncSites.setStatus(siteId, 'revoked')`. Idempotent (already-revoked / client-already-gone → still marks revoked). Existing short-lived tokens expire naturally (documented; no token revocation list).
- `centralUrl`: from a central public-base-URL config key if one exists (resolve at plan time — e.g. `PUBLIC_URL`/`BASE_URL`), else REQUIRED as an explicit `centralUrl` arg (CLI `--central-url`, endpoint body field). `oidcIssuer` = `cfg.OIDC_ISSUER_URL`.
Typed errors (`AlreadyEnrolledError`/`SiteNotFoundError`/`IdentityAdminNotConfiguredError`) so CLI→exit-code and HTTP→status map cleanly.

### 4. CLI (`openldr sync enroll|list|rotate|revoke`)
In `packages/cli/src/sync.ts` (+ register on `syncGroup` in `cli/src/index.ts`), same `createAppContext(loadConfig())`→`finally ctx.close()` shape as `runSyncStatus`:
- `sync enroll <siteId> [--name <label>] [--central-url <url>] [--json]` → `enrollSite` → print the credentials block **once** (with a "store the secret now — it will not be shown again" notice); `--json` emits the `EnrollResult`.
- `sync list [--json]` → table of sites (siteId, name, clientId, status, enrolledAt).
- `sync rotate <siteId> [--json]` → new secret once.
- `sync revoke <siteId> [--json]` → confirmation.
Map errors to exit codes (already-enrolled → 1 with a clear message; not-found → 1; not-configured → 1 "Keycloak admin not configured").

### 5. HTTP endpoints (central admin, user-authed)
In `apps/server/src/settings-routes.ts` (or a new `sync-admin-routes.ts` registered alongside), all `requireRole('lab_admin')` + audited + `IdentityAdminNotConfiguredError`→503 (mirror `users-routes.ts`), under **`/api/settings/sync/*`** (NOT `/api/sync/*` — the machine-auth bypass skips that):
- `POST /api/settings/sync/enroll` `{ siteId, name?, centralUrl? }` → 200 `EnrollResult` (secret in the response body, over HTTPS, once — never returned by any GET); `AlreadyEnrolledError`→409.
- `GET /api/settings/sync/sites` → `SyncSiteRow[]` (no secrets).
- `POST /api/settings/sync/sites/:siteId/rotate` → `{clientId, clientSecret}` once; not-found→404.
- `POST /api/settings/sync/sites/:siteId/revoke` → `{revoked:true}`.
Audit actions `settings.sync.enroll` / `.rotate` / `.revoke` with `entityId=siteId`, metadata secret-free.

### 6. Studio "Sites" admin page
A new central-admin page mirroring `apps/studio/src/pages/Users.tsx` (admin-gated route + nav entry):
- **List** table: site id, name, client id, status badge (active/revoked), enrolled at. Loads `GET /api/settings/sync/sites`.
- **Enroll** dialog: inputs siteId (+ name, centralUrl if no config default) → `POST .../enroll` → **one-time secret reveal**: a dialog showing `clientId` / `clientSecret` / `oidcIssuer` / `centralUrl` with copy buttons and a "this secret won't be shown again" warning; dismiss = gone. (Same one-time-reveal convention as the write-only secret in the Sync card.)
- **Rotate** (row action): confirm → `POST .../rotate` → one-time new-secret reveal.
- **Revoke** (row action): confirm dialog → `POST .../revoke` → row goes `revoked`.
- shadcn primitives only; `authFetch`-backed api.ts helpers; en/fr/pt strings. Studio api mirror updated with the `EnrollResult`/`SyncSiteRow` types.

## Testing

- **Unit:** adapter-auth `clients.*` via `fetchFn` seam (create → Location-UUID parse; mapper body shape; secret GET/POST → `.value`; delete; find-by-clientId query); the orchestrator (`enrollSite` happy path + `AlreadyEnrolledError` + revoked-then-re-enroll; `rotateSite`; `revokeSite` idempotent) with a fake `ctx.auth.clients` + real pg-mem `sync_sites`; the migration `051`; the endpoints (auth 401/403, 503-when-unconfigured, one-time secret only in enroll/rotate response, 409 already-enrolled, audit fired); the CLI; the studio Sites page component (list render, enroll dialog → reveal, rotate/revoke actions).
- **Live-Keycloak smoke (deliberate, flagged — needs the dev Keycloak, not AUTH_DEV_BYPASS):** against a real Keycloak realm with admin creds: `openldr sync enroll site-smoke-1` → use the returned `clientId`/`clientSecret` to fetch a client-credentials token from central's realm → decode it → **assert a top-level `site_id: 'site-smoke-1'` claim** (and the `aud` if `OIDC_AUDIENCE` set) → feed it through `ctx.auth.verifyToken` + the `sitePrincipal` logic → assert it's ACCEPTED (this is the real proof the minted client satisfies central's push/pull auth) → `sync rotate` (old secret rejected, new accepted) → `sync revoke` (client gone; new token fetch fails). Script `scripts/sync-enroll-live-acceptance.ts` + `pnpm sync:enroll:accept` (guarded to skip cleanly when no Keycloak is configured, like other live-Keycloak tests).

## Deliberate shortcuts / deferrals

- Central stores only the non-secret site row; the secret is shown once (CLI stdout / one-time UI reveal) and never retrievable — lost secret ⇒ `rotate`.
- Revoke deletes the client but does not revoke already-issued short-lived tokens (they expire); no token-revocation list.
- No lab-self-registration; no auto-delivery of credentials to the lab (out-of-band hand-off + paste into the Sync card).
- Enrollment endpoints exist on any instance but 503 without sync-realm admin creds (no "I am central" flag).
- `OIDC_AUDIENCE` audience mapper only added when central configures an audience.

## Build order (implementation plan will detail)

1. Realm prereq (`manage-clients`/`view-clients` + realm test).
2. adapter-auth `clients` sub-port (+ `AuthPort` + unit tests via fetchFn).
3. Migration `051_sync_sites` + `createSyncSiteStore` + `InternalSchema` + snapshot test + AppContext wiring.
4. Enrollment orchestrator (`enrollment.ts`) + typed errors + unit tests.
5. CLI `sync enroll|list|rotate|revoke`.
6. HTTP `/api/settings/sync/{enroll,sites,sites/:id/rotate,sites/:id/revoke}` + audit + tests.
7. Studio Sites page + api.ts + i18n.
8. Live-Keycloak smoke (`pnpm sync:enroll:accept`) + gate (incl. S1-S4c regressions) + whole-slice review + merge + (push on user go).

## Relates to

[[distributed-sync-central-workstream]] (parent; completes the S4 sub-slices), S4a-c (the lab side that consumes the minted credentials), [[auth-users-audit-workstream]] (adapter-auth admin + Keycloak realm + the Users admin-page pattern), [[cli-operator-parity]] (`openldr sync enroll…` CLI parity), [[mssql-production-container-test]]/[[github-org-migration]] (the real-Keycloak validation convention), [[use-shadcn-components]]/[[i18n-workstream]] (Sites page conventions).
