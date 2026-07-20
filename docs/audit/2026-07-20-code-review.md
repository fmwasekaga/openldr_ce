# Code Review Findings - Settings Sync, Notifications, and Security

Review date: 2026-07-20
Scope: recent Settings -> Distributed Sync work, sync activity/notification-area UI, and a broad security pass over deployment defaults, RBAC, workflows, connectors, and audit surfaces.

No source fixes were made by this review. The goal is to give Claude and future reviewers a concrete punch list with evidence.

## Executive Summary

Claude has clearly put real care into the sync implementation: there are many defensive comments, targeted tests, cursor guards, error redaction, and explicit handling for gzip/compression edge cases. That said, I found several issues that should block production hardening. The most urgent are a live default `labadmin/labadmin` Keycloak admin, weak production credential fallbacks, an out-of-order sync delete that can remove newer canonical FHIR data, raw workflow database SQL execution without the same guards as dashboard SQL, and missing server-side RBAC on multiple admin-ish APIs.

## Findings

### CRITICAL-01 - Default `labadmin/labadmin` imports as a live lab admin

Files:

- `infra/keycloak/openldr-realm.json:60-69`
- `install/install.sh:243-248`
- `install/install.ps1:237-242`

The committed Keycloak realm imports a `labadmin` user with password `labadmin`, `temporary: false`, and the `lab_admin` realm role. The installers rotate only the `openldr-admin` service-account secret; I did not see them rotate or disable the seeded human admin.

Impact: anyone who can reach `/auth` can try the committed credentials and gain full admin access in installs that import this realm unchanged.

Recommendation: remove the seeded human admin from production imports, or generate a per-install initial admin password and force a password change. Add a production startup/import guard that refuses to run with the default admin credential present.

### HIGH-01 - Production compose/examples still contain weak default credentials and Keycloak `start-dev`

Files:

- `.env.prod.example:19-21`
- `.env.prod.example:47-52`
- `docker-compose.prod.yml:63-66`
- `docker-compose.prod.yml:79-83`
- `docker-compose.prod.yml:98-103`

Production examples and compose fallbacks include concrete weak values such as `openldr/openldr`, `admin/admin`, `minioadmin`, and `openldr-admin-dev-secret`. The production compose also starts Keycloak with `start-dev`.

Impact: manual or partially automated deployments can come up with known database, MinIO, Keycloak bootstrap, and service-account credentials.

Recommendation: remove secret fallbacks from production compose files, require explicit non-default env values before boot, and use Keycloak production `start`/optimized mode. Keep generated-secret installer paths as the easy path.

### HIGH-02 - Late older sync deletes can remove newer canonical FHIR rows

Files:

- `packages/db/src/fhir-store.ts:422-447`
- `packages/db/src/fhir-store-apply.test.ts:107-128`
- `packages/bootstrap/src/sync-bundle.ts:167-178`

`applyRemote()` protects remote upserts with a monotonic `WHERE fhir_resources.version < incomingVersion` guard, but the remote delete path unconditionally deletes the canonical row. If v5 upsert is already canonical and a late v3 delete arrives through live sync or an offline bundle, the v3 delete removes the v5 row.

Impact: out-of-order sync can silently remove newer clinical data from `fhir.fhir_resources`, while history/change logs make the older delete look handled.

Recommendation: make deletes monotonic too. For example, delete the canonical row only when the current version is `<=` the incoming delete version, or model tombstones in canonical state with a version. Add tests for newer-upsert-then-older-delete and newer-delete-then-older-upsert.

### HIGH-03 - Workflow database nodes bypass SELECT-only validation and row caps

Files:

- `packages/workflows/src/engine/node-handlers/connector-sql.ts:12-14`
- `packages/bootstrap/src/connector-sql-service.ts:28-45`
- `packages/bootstrap/src/connector-sql-service.test.ts:98-106`

The workflow database node templates SQL and sends it directly to `runConnectorSql()`. The runner executes raw SQL unchanged when `rowCap` is omitted, and the test explicitly preserves that path as the workflow-node path. This does not appear to share the safer dashboard query behavior around SELECT-only validation, read-only execution, or default row limits.

Impact: a workflow author can use stored database connector credentials to run DML/DDL or unbounded queries against connected databases.

Recommendation: enforce SELECT-only validation, default row caps, timeouts, and read-only transactions inside `createConnectorSqlRunner()` itself, not just in callers. If write-capable SQL is needed, make it a separate privileged node/action with explicit RBAC and audit semantics.

### HIGH-04 - Terminology and ontology mutation routes lack server-side RBAC

Files:

- `apps/server/src/terminology-admin-routes.ts:45-50`
- `apps/server/src/terminology-admin-routes.ts:83-88`
- `apps/server/src/terminology-admin-routes.ts:117-122`
- `apps/server/src/ontology-routes.ts:13-20`
- `apps/server/src/ontology-routes.ts:74-80`

Terminology admin routes and ontology build/delete routes register without `requireRole(...)`. The global auth hook means callers must be authenticated, but any authenticated role can reach these mutation/import/build endpoints.

Impact: low-privilege users can alter terminology configuration, trigger server-side LOINC import paths, delete ontology distributions, and start ontology builds.

Recommendation: apply server-side RBAC to every mutation/import/build route, probably `lab_admin` plus carefully chosen manager roles. Keep read-only terminology routes separately authorized. Add negative tests for `lab_technician`.

### MEDIUM-01 - Sync machine endpoints do not check active enrollment status

Files:

- `apps/server/src/sync-routes.ts:24-36`
- `packages/bootstrap/src/enrollment.ts:193-199`
- `packages/config/src/schema.ts:74`
- `.env.prod.example:43`

`sitePrincipal()` verifies the bearer token and extracts `site_id`, but it does not check `ctx.syncSites` for an active enrolled site. Revocation deletes the Keycloak client and marks the row revoked, but already-issued tokens can continue using `/api/sync/*` until expiry. Separately, `OIDC_AUDIENCE` is optional and commented out in the production example, so audience validation can be skipped entirely.

Impact: revoked or unknown site identities are not rejected at the sync route boundary if they still have a valid token with `site_id`.

Recommendation: after extracting `site_id`, require an active `sync_sites` row. Also require an audience for production sync deployments and/or validate the token client (`azp` or equivalent) against the enrolled site's client id. Add tests for unknown and revoked sites.

### MEDIUM-02 - Enabled sync permits cleartext HTTP for credentials and PHI-bearing traffic

Files:

- `packages/config/src/sync.ts:82-86`
- `packages/sync/src/token.ts:50-58`
- `packages/bootstrap/src/index.ts:795-798`
- `packages/bootstrap/src/index.ts:839-842`

The sync settings schema allows both `http://` and `https://` for `centralUrl` and `oidcIssuer`. The runtime then posts `client_secret` to the token endpoint and sends bearer-token-authenticated FHIR/reference payloads to central.

Impact: an operator typo or insecure LAN configuration can expose client credentials, bearer tokens, and clinical sync deltas over plaintext.

Recommendation: require HTTPS for enabled sync by default. Permit `http://localhost` only in development/test, or require an explicit insecure-transport override with loud UI/CLI warnings and audit logging.

### MEDIUM-03 - Studio sync settings save can wipe the pinned central public key

Files:

- `apps/studio/src/api.ts:352-372`
- `apps/studio/src/pages/settings/DistributedSync.tsx:141-151`
- `packages/bootstrap/src/sync-settings.ts:59-68`

The server-side sync config supports `centralPublicKey`, and `setSyncConfig()` always persists it. The Studio API type omits `centralPublicKey`, and the Settings -> Distributed Sync save payload therefore omits it. Zod defaults the missing value to `''`, so a normal UI save clears `sync.central_public_key`.

Impact: offline pull bundle imports can fail later because the lab's pinned central verify key was erased by an unrelated settings save.

Recommendation: either include and preserve `centralPublicKey` in the Studio view/input contract, or make the server preserve the existing key when the field is absent. Add a UI/API regression test.

### MEDIUM-04 - Dashboard API lacks server-side RBAC

Files:

- `apps/server/src/dashboards-routes.ts:19-23`
- `apps/server/src/dashboards-routes.ts:45-49`
- `apps/server/src/dashboards-routes.ts:52-58`
- `apps/server/src/dashboards-routes.ts:61-69`
- `apps/server/src/dashboards-routes.ts:73-84`
- `apps/server/src/dashboards-routes.ts:88-95`

The route comment explicitly notes that dashboard routes have no role gating. Reads, writes, deletes, and query execution are available to any authenticated user.

Impact: low-privilege users can modify shared operational dashboards and execute saved/vetted dashboard queries, including raw SQL widgets that already exist.

Recommendation: gate writes to `lab_admin`/`lab_manager`; gate reads/query execution to intended dashboard/report roles. Treat raw SQL authoring/execution as a narrower permission than ordinary dashboard viewing.

### MEDIUM-05 - User directory and audit log are readable by any authenticated user

Files:

- `apps/server/src/users-routes.ts:117-128`
- `apps/server/src/users-routes.ts:133-138`
- `apps/server/src/audit-routes.ts:6-20`
- `apps/server/src/audit-routes.ts:27-33`
- `apps/studio/src/App.tsx:40`

The UI hides `/users` behind `lab_admin`, but the API does not. `GET /api/users`, `GET /api/users/:id`, `GET /api/audit`, and `GET /api/audit/:id` have no route-level RBAC.

Impact: any authenticated user can enumerate users, roles, emails/profile fields, and audit metadata.

Recommendation: require `lab_admin` for user directory reads. Require `lab_admin` and/or `system_auditor` for audit reads. Keep self-profile data on `/api/me` or another self-scoped route.

### LOW-01 - Sync activity detail rows are mouse-only

File:

- `apps/studio/src/pages/settings/DistributedSync.tsx:378-382`

The recent sync activity table opens the detail sheet with `onClick` on a `TableRow`. The row is not focusable, has no keyboard handler, and has no button/control accessible name beyond a `title`.

Impact: keyboard and screen-reader users cannot open sync activity details.

Recommendation: put a real button in a cell, or make the row explicitly keyboard-operable with correct semantics. Add a test using Tab plus Enter/Space to open the sheet.

### LOW-02 - Collapsed user menu trigger has an unclear accessible name

File:

- `apps/studio/src/shell/AppShell.tsx:92-110`

When the sidebar is collapsed, the user menu trigger contains only the avatar initial. The tooltip text is not a reliable accessible name for the button.

Impact: screen-reader users may hear only an initial such as "L" or "O" rather than "Open user menu", making Settings/sign-out harder to discover.

Recommendation: add an `aria-label`, for example `Open user menu for {username}`, and cover collapsed sidebar behavior in `AppShell` tests.

## Positive Controls Observed

- Sync push clamps central `ackSeq` to the local safe frontier before advancing the lab cursor.
- Sync activity/error paths redact bearer-token shaped content before persisting user-visible errors.
- Sync settings keep client secrets write-only in the view contract.
- Sync divergence detail reads are audited, and list reads avoid selecting PHI bodies.
- Workflow/webhook secret exposure findings from the June audit have visible remediation tests around role gates, redaction, and secret sealing.

## Suggested Remediation Order

1. Remove/rotate the default `labadmin/labadmin` credential and production weak-secret fallbacks.
2. Fix the remote delete monotonicity bug in `applyRemote()`.
3. Add RBAC to terminology/ontology, dashboards, users, and audit API routes.
4. Harden workflow connector SQL execution at the shared runner boundary.
5. Add active enrollment and audience/client checks to `/api/sync/*`.
6. Require HTTPS for enabled sync, with only explicit development exceptions.
7. Preserve `centralPublicKey` through Studio sync settings saves.
8. Fix the two sync activity/app-shell accessibility issues.

## Verification Performed

This was a source review with targeted line inspection and parallel read-only subreviews. I did not run the full test suite or make implementation fixes.
