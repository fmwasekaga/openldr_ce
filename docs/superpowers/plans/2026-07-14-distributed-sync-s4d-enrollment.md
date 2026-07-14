# Distributed Sync S4d — Enrollment Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A central admin runs one command/click to mint a lab's Keycloak confidential client + a `site_id` protocol-mapper + secret + a central `sync_sites` record, and receives `{clientId, clientSecret, siteId, centralUrl, oidcIssuer}` once — plus `list`/`rotate`/`revoke` — over CLI, a central HTTP endpoint, and a studio "Sites" page. Proven by a live-Keycloak smoke that a minted client's token satisfies central's `sitePrincipal`.

**Architecture:** New Keycloak client-management primitives on adapter-auth (`AuthPort.clients`, all via the existing realm-scoped `adminFetchRaw`); a `sync_sites` registry table + store on `AppContext`; a shared enrollment orchestrator (`enrollSite`/`listSites`/`rotateSite`/`revokeSite`) composing Keycloak + registry (the `danger*` pattern); CLI + user-authed central endpoints (under `/api/settings/sync/*` to dodge the machine-auth bypass) + a studio Sites admin page (mirrors the Users page). The `site_id` claim is a hardcoded-claim mapper (top-level, matching `sitePrincipal`). The secret is returned once, never persisted on central.

**Tech Stack:** TypeScript, Kysely, Fastify, commander (CLI), React+shadcn (studio), Vitest (+ `fetchFn` seam for adapter-auth), a real Keycloak for the smoke.

**Spec:** `docs/superpowers/specs/2026-07-14-distributed-sync-s4d-enrollment-design.md`

**Key substrate to read first (all exist):**
- `packages/adapter-auth/src/index.ts` — `createAuth`, `getAdminToken`, `adminFetchRaw`/`adminJson`/`adminVoid`, `KcError`, the `directory.create` **Location-UUID parse** (`loc.split('/').filter(Boolean).pop()`, `index.ts:175-177`), `cfg.issuerUrl`/`cfg.audience`, `adminBase = issuerUrl.replace('/realms/','/admin/realms/')`. The `directory` sub-port is the model for a `clients` sub-port. Tests use a `fetchFn` seam.
- `packages/ports/src/auth.ts` — `AuthPort` (+ `IdentityAdminNotConfiguredError`, `DirectoryPort`). Add a `clients` sub-port + `SyncClientPort` interface here.
- `apps/server/src/users-routes.ts` — route→`ctx.auth`→adminFetchRaw + `requireRole('lab_admin')` + `recordAudit` + `isNotConfigured`→503 (the endpoint model).
- `apps/server/src/sync-routes.ts` `sitePrincipal:9-33` (the top-level `site_id` claim the mapper must emit) + `apps/server/src/settings-routes.ts` (where the admin endpoints go).
- `infra/keycloak/openldr-realm.json` (+ `.json.template`) — the `openldr-admin` service-account `realm-management` roles (`:72-78`) + the web client's audience mapper (`:30-41`); `apps/server/src/keycloak-realm.test.ts` (asserts realm shape).
- `packages/bootstrap/src/index.ts` — `AppContext` (`auth`, the `create*Store(internal.db)` wiring, `close()`), `cfg` (`OIDC_ISSUER_URL`, `OIDC_AUDIENCE`, `KEYCLOAK_ADMIN_CLIENT_ID/SECRET`), and any public-base-URL config key; the `danger*` orchestration exports.
- `packages/db/src/migrations/internal/index.ts` (latest `050`; add `051`), `packages/db/src/schema/internal.ts`, `packages/db/src/migrations/internal/migrations.test.ts` (snapshot), an existing small store (e.g. `report-store.ts`) as the `createSyncSiteStore` model.
- `packages/cli/src/sync.ts` + `cli/src/index.ts` (`syncGroup`, `createAppContext`→`finally ctx.close()`, `emit`/`JsonOpt`); `apps/studio/src/pages/Users.tsx` (+ dialogs) + `apps/studio/src/api.ts` (`authFetch`) — the studio admin-page + api model.
- `docs/superpowers/specs/2026-07-14-distributed-sync-s4d-enrollment-design.md`.

**Global rules:** `pnpm exec`/`pnpm --filter`, never raw `node_modules/.bin/*`. NEVER a `Co-Authored-By` trailer. shadcn-only UI; en/fr/pt for new strings. Announce dev/Keycloak shortcuts up front.

---

## Task 0: Cut the branch
- [ ] `git checkout main && git checkout -b feat/sync-s4d-enrollment && git branch --show-current` → `feat/sync-s4d-enrollment`, clean tree.

---

## Task 1: Realm prerequisite — `manage-clients`/`view-clients` for `openldr-admin`

**Files:** Modify `infra/keycloak/openldr-realm.json` + `infra/keycloak/openldr-realm.json.template`; Modify `apps/server/src/keycloak-realm.test.ts`.

- [ ] **Step 1:** In BOTH realm files, find the `openldr-admin` client's service-account `realm-management` client-role list (currently `["manage-users","view-users","query-users","view-realm"]`, `openldr-realm.json:72-78`) and add `"manage-clients"` and `"view-clients"`. Match the JSON structure EXACTLY (the `scopeMappings`/`clientScopeMappings`/service-account-role representation the file uses — read the surrounding block; it may be under a `roles.client["realm-management"]` seed or a service-account role mapping — mirror how the existing 4 roles are expressed).
- [ ] **Step 2:** In `keycloak-realm.test.ts`, extend the assertion that checks the `openldr-admin` realm-management roles to require `manage-clients` + `view-clients` too. Run it.
- [ ] **Step 3:** `pnpm --filter @openldr/server exec vitest run src/keycloak-realm.test.ts` → PASS. Commit `feat(auth): grant openldr-admin manage-clients/view-clients for sync enrollment (sync S4d)`.

**Gotcha:** this is a real authority widening of the admin service account — the commit message + a comment near the roles should say why (sync client minting). If the two realm files structure roles differently (one templated), apply the SAME change to both.

---

## Task 2: adapter-auth `clients` sub-port (+ AuthPort)

**Files:** Modify `packages/ports/src/auth.ts` (add `SyncClientPort` + `clients` on `AuthPort`); Modify `packages/adapter-auth/src/index.ts` (implement); Modify `packages/adapter-auth/src/*.test.ts` (fetchFn-seam unit tests). Update any test/stub that constructs an `AuthPort` (it now needs `clients`).

- [ ] **Step 1: port interface (`packages/ports/src/auth.ts`)**
```ts
export interface SyncClientPort {
  findUuidByClientId(clientId: string): Promise<string | null>;
  createConfidentialClient(clientId: string): Promise<string>;   // returns the new client UUID
  addSiteIdMapper(uuid: string, siteId: string): Promise<void>;
  addAudienceMapper(uuid: string, audience: string): Promise<void>;
  getClientSecret(uuid: string): Promise<string>;
  regenerateClientSecret(uuid: string): Promise<string>;
  deleteClient(uuid: string): Promise<void>;
}
// add to AuthPort:
  clients: SyncClientPort;
```

- [ ] **Step 2: implement in adapter-auth** (in the object `createAuth` returns, alongside `directory`, reusing `adminFetchRaw`/`adminJson`/`adminVoid`/`KcError` + the Location parse):
```ts
    clients: {
      async findUuidByClientId(clientId) {
        const arr = await adminJson<{ id: string }[]>(`/clients?clientId=${encodeURIComponent(clientId)}`);
        return arr.length > 0 ? arr[0].id : null;
      },
      async createConfidentialClient(clientId) {
        const res = await adminFetchRaw('/clients', { method: 'POST', body: JSON.stringify({
          clientId, protocol: 'openid-connect', publicClient: false, serviceAccountsEnabled: true,
          standardFlowEnabled: false, implicitFlowEnabled: false, directAccessGrantsEnabled: false, enabled: true,
        }) });
        if (!res.ok) { const d = await res.text().catch(() => ''); throw new KcError(res.status, d.slice(0, 500)); }
        const loc = res.headers.get('Location');
        const uuid = loc ? (loc.split('/').filter(Boolean).pop() ?? '') : '';
        if (!uuid) throw new KcError(500, 'provider did not return a client id');
        return uuid;
      },
      async addSiteIdMapper(uuid, siteId) {
        await adminVoid(`/clients/${encodeURIComponent(uuid)}/protocol-mappers/models`, { method: 'POST', body: JSON.stringify({
          name: 'sync-site-id', protocol: 'openid-connect', protocolMapper: 'oidc-hardcoded-claim-mapper',
          config: { 'claim.name': 'site_id', 'claim.value': siteId, 'claim.value.type': 'String',
            'access.token.claim': 'true', 'id.token.claim': 'false', 'userinfo.token.claim': 'false' },
        }) });
      },
      async addAudienceMapper(uuid, audience) {
        await adminVoid(`/clients/${encodeURIComponent(uuid)}/protocol-mappers/models`, { method: 'POST', body: JSON.stringify({
          name: 'sync-audience', protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper',
          config: { 'included.client.audience': audience, 'access.token.claim': 'true', 'id.token.claim': 'false' },
        }) });
      },
      async getClientSecret(uuid) {
        const body = await adminJson<{ value?: string }>(`/clients/${encodeURIComponent(uuid)}/client-secret`);
        if (!body.value) throw new KcError(500, 'provider did not return a client secret');
        return body.value;
      },
      async regenerateClientSecret(uuid) {
        const body = await adminJson<{ value?: string }>(`/clients/${encodeURIComponent(uuid)}/client-secret`, { method: 'POST' });
        if (!body.value) throw new KcError(500, 'provider did not return a client secret');
        return body.value;
      },
      async deleteClient(uuid) {
        await adminVoid(`/clients/${encodeURIComponent(uuid)}`, { method: 'DELETE' });
      },
    },
```

- [ ] **Step 3: tests** (adapter-auth test, `fetchFn` seam — mirror the existing directory tests): assert `createConfidentialClient` POSTs `/clients` with the confidential+service-account body and returns the Location UUID; `addSiteIdMapper` POSTs the hardcoded-claim body (`claim.name=site_id`, `claim.value=<siteId>`, `access.token.claim=true`); `getClientSecret`/`regenerateClientSecret` GET/POST `/client-secret` → `.value`; `findUuidByClientId` GETs `/clients?clientId=` → `[0].id` (and `null` on empty); `deleteClient` DELETEs; each throws `KcError` on non-2xx and `IdentityAdminNotConfiguredError` when admin creds absent (adminFetchRaw already enforces this — one test).

- [ ] **Step 4:** update every `AuthPort` stub in the repo (tests that hand-roll a partial `AuthPort` — grep) to add a `clients` stub, so typecheck passes. `pnpm --filter @openldr/ports --filter @openldr/adapter-auth exec tsc --noEmit` + `pnpm --filter @openldr/adapter-auth exec vitest run`. Commit `feat(auth): Keycloak sync-client management primitives on AuthPort (sync S4d)`.

**Gotcha:** the `client-secret` GET vs POST — Keycloak's `GET /clients/{id}/client-secret` reads the current secret; `POST` regenerates. Use GET for `getClientSecret` (read the just-created client's secret) and POST for `regenerateClientSecret`. A freshly-created confidential client already has a secret, so GET after create returns it.

---

## Task 3: `sync_sites` registry — migration + store + AppContext

**Files:** Create `packages/db/src/migrations/internal/051_sync_sites.ts` + register; Modify `packages/db/src/schema/internal.ts`; Create `packages/db/src/sync-site-store.ts` + test; Modify `migrations.test.ts` snapshot; Modify `packages/bootstrap/src/index.ts` (wire `ctx.syncSites`).

- [ ] **Step 1: migration** (`051_sync_sites.ts`, register `'051_sync_sites'`):
```ts
import { type Kysely, sql } from 'kysely';
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createTable('sync_sites')
    .addColumn('site_id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text')
    .addColumn('client_id', 'text', (c) => c.notNull())
    .addColumn('enrolled_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('enrolled_by', 'text')
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('active'))
    .execute();
}
export async function down(db: Kysely<any>): Promise<void> { await db.schema.dropTable('sync_sites').execute(); }
```
Add the `sync_sites` table type to `InternalSchema` (bigint N/A here; `enrolled_at` = `Generated<Date>`, `status` string). Append `'051_sync_sites'` to the `migrations.test.ts` snapshot list.

- [ ] **Step 2: store (`packages/db/src/sync-site-store.ts`)** — model on `report-store.ts`:
```ts
export interface SyncSiteRow { siteId: string; name: string | null; clientId: string; enrolledAt: string; enrolledBy: string | null; status: 'active' | 'revoked' }
export interface SyncSiteStore {
  list(): Promise<SyncSiteRow[]>;
  get(siteId: string): Promise<SyncSiteRow | undefined>;
  insert(row: { siteId: string; name: string | null; clientId: string; enrolledBy: string | null }): Promise<void>;
  setStatus(siteId: string, status: 'active' | 'revoked'): Promise<void>;
}
export function createSyncSiteStore(db: Kysely<InternalSchema>): SyncSiteStore { /* map snake↔camel; enrolledAt via new Date(row.enrolled_at).toISOString() */ }
```
Export from `@openldr/db` barrel. NO secrets in this store.

- [ ] **Step 3: tests** — pg-mem: insert→get/list round-trip (camel↔snake, status default 'active'); `setStatus('revoked')`; list ordering. Migration test for `051` (column presence).
- [ ] **Step 4: wire `ctx.syncSites`** — add `syncSites: SyncSiteStore` to `AppContext` + construct `const syncSites = createSyncSiteStore(internal.db);` + return it. Update any partial-ctx stub.
- [ ] **Step 5:** typecheck (`@openldr/db` + `@openldr/bootstrap`) + tests + commit `feat(db): sync_sites registry table + store (sync S4d)`.

---

## Task 4: enrollment orchestrator (shared CLI + HTTP)

**Files:** Create `packages/bootstrap/src/enrollment.ts` + `enrollment.test.ts`; export from the `@openldr/bootstrap` barrel. Add typed errors (co-locate or in a small errors module).

- [ ] **Step 1: errors + types**
```ts
export class AlreadyEnrolledError extends Error { constructor(public siteId: string) { super(`site already enrolled: ${siteId}`); this.name = 'AlreadyEnrolledError'; } }
export class SiteNotFoundError extends Error { constructor(public siteId: string) { super(`site not found: ${siteId}`); this.name = 'SiteNotFoundError'; } }
export interface EnrollResult { clientId: string; clientSecret: string; siteId: string; centralUrl: string; oidcIssuer: string }
const SITE_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
```

- [ ] **Step 2: orchestrations** — take an injected deps bundle (so tests use a fake `auth.clients` + a real pg-mem `syncSites`), OR take `ctx` + read `ctx.auth.clients`/`ctx.syncSites`/`ctx.config`. Prefer `ctx`-based to match `danger*`, but make the pieces it reads injectable for the test. Signatures:
```ts
export async function enrollSite(ctx: AppContext, args: { siteId: string; name?: string | null; centralUrl: string; actor: string | null }): Promise<EnrollResult>;
export async function listSites(ctx: AppContext): Promise<SyncSiteRow[]>;
export async function rotateSite(ctx: AppContext, siteId: string): Promise<{ clientId: string; clientSecret: string }>;
export async function revokeSite(ctx: AppContext, siteId: string): Promise<void>;
```
- **enrollSite:** validate `SITE_ID_RE.test(siteId)` (throw on bad slug). `const existing = await ctx.syncSites.get(siteId)`. If existing && status==='active' → throw `AlreadyEnrolledError`. `const clientId = 'sync-' + siteId`. `let uuid = await ctx.auth.clients.findUuidByClientId(clientId)` — if null, `uuid = await createConfidentialClient(clientId)` then `addSiteIdMapper(uuid, siteId)` and (if `ctx.config.OIDC_AUDIENCE`) `addAudienceMapper(uuid, ctx.config.OIDC_AUDIENCE)`. (Reuse an existing client on a revoked→re-enroll; mappers may already exist — if the client already existed, skip re-adding mappers or tolerate a 409 from Keycloak; simplest: only add mappers on a freshly-created client.) `const clientSecret = await getClientSecret(uuid)`. If existing (revoked) → `setStatus(siteId,'active')`; else `insert({siteId, name: name ?? null, clientId, enrolledBy: actor})`. Return `{clientId, clientSecret, siteId, centralUrl, oidcIssuer: ctx.config.OIDC_ISSUER_URL}`. NEVER persist the secret.
- **rotateSite:** `uuid = findUuidByClientId('sync-'+siteId)`; null → `SiteNotFoundError`; `clientSecret = regenerateClientSecret(uuid)`; return `{clientId:'sync-'+siteId, clientSecret}`.
- **revokeSite:** `uuid = findUuidByClientId('sync-'+siteId)`; if uuid → `deleteClient(uuid)`; `if (await ctx.syncSites.get(siteId)) setStatus(siteId,'revoked')` (idempotent; also handle "registry row exists but client already gone").
- CONFIRM the config key for `ctx.config.OIDC_ISSUER_URL`/`OIDC_AUDIENCE` (read how bootstrap exposes `cfg` on ctx — it may be `ctx.config` or captured in closure; if `cfg` isn't on `AppContext`, thread the two values into the orchestrator via a small `syncEnrollConfig` on ctx or pass them as args). Report what you used.

- [ ] **Step 3: tests** (`enrollment.test.ts`) — a fake `ctx.auth.clients` (records calls, returns canned uuid/secret; `findUuidByClientId` returns null then a uuid) + a real pg-mem `syncSites` + stub config: enroll happy path (mints client + mapper, inserts row, returns secret, secret NOT in the row); enroll twice → `AlreadyEnrolledError`; enroll a bad slug → throws; revoke → deletes client + status revoked; re-enroll after revoke → active + new secret (reuses existing client uuid, skips duplicate mapper); rotate → new secret + no registry change; rotate/ revoke unknown site → `SiteNotFoundError`/idempotent; audience mapper added only when OIDC_AUDIENCE set.
- [ ] **Step 4:** typecheck + tests + commit `feat(bootstrap): sync enrollment orchestrator (enroll/list/rotate/revoke) (sync S4d)`.

---

## Task 5: CLI `openldr sync enroll|list|rotate|revoke`

**Files:** Modify `packages/cli/src/sync.ts` + `packages/cli/src/index.ts`; tests if the CLI harness supports it.

- [ ] Add handlers mirroring `runSyncStatus` (`createAppContext`→`finally ctx.close()`, `emit(json, data, text)`):
  - `runSyncEnroll(siteId, opts: { name?; centralUrl?; json })` → resolve centralUrl (opts.centralUrl ?? the config public-URL key ?? error "central URL required (--central-url)") → `enrollSite(ctx, {...})` → print the credentials block ONCE with a `⚠ store the client secret now — it will not be shown again` notice; `--json` emits `EnrollResult`. Map `AlreadyEnrolledError`→exit 1 "already enrolled (use `sync rotate`)", `IdentityAdminNotConfiguredError`→exit 1 "Keycloak admin not configured".
  - `runSyncList(opts)` → `listSites(ctx)` → table (siteId · name · clientId · status · enrolledAt); `--json`.
  - `runSyncRotate(siteId, opts)` → `rotateSite` → new secret once; `SiteNotFoundError`→exit 1.
  - `runSyncRevoke(siteId, opts)` → `revokeSite` → "revoked <siteId>".
- Register on `syncGroup` in `index.ts`: `sync.command('enroll <siteId>').option('--name <name>').option('--central-url <url>').option('--json',...).action(...)`; `sync.command('list')…`; `sync.command('rotate <siteId>')…`; `sync.command('revoke <siteId>')…`. Mirror the exact registration/`process.exitCode` pattern of the existing `sync status|now`.
- [ ] typecheck (`@openldr/cli`) + commit `feat(cli): openldr sync enroll|list|rotate|revoke (sync S4d)`.

**Gotcha:** the secret must be printed ONLY at enroll/rotate, once, with the warning. `sync list` never shows secrets. Redact errors (existing `redactError`).

---

## Task 6: central HTTP endpoints

**Files:** Modify `apps/server/src/settings-routes.ts` (or a new `sync-admin-routes.ts` registered in `app.ts`); test.

- [ ] Add (all `requireRole('lab_admin')` + audited + `IdentityAdminNotConfiguredError`→503 via the `isNotConfigured` duck-type from `users-routes.ts`), under `/api/settings/sync/*`:
```ts
app.post('/api/settings/sync/enroll', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
  const { siteId, name, centralUrl } = (req.body ?? {}) as { siteId?: string; name?: string; centralUrl?: string };
  if (!siteId) { reply.code(400); return { error: 'siteId required' }; }
  const url = centralUrl ?? <the config public-URL key> ?? '';
  if (!url) { reply.code(400); return { error: 'centralUrl required' }; }
  try {
    const r = await enrollSite(ctx, { siteId, name: name ?? null, centralUrl: url, actor: req.user?.id ?? null });
    await recordAudit(ctx, req, { action: 'settings.sync.enroll', entityType: 'sync_site', entityId: siteId, metadata: { clientId: r.clientId } }); // no secret
    return r; // secret in body, over HTTPS, once
  } catch (e) { /* AlreadyEnrolledError→409; IdentityAdminNotConfiguredError→503; else rethrow */ }
});
app.get('/api/settings/sync/sites', { preHandler: requireRole('lab_admin') }, async () => listSites(ctx));
app.post('/api/settings/sync/sites/:siteId/rotate', { preHandler: requireRole('lab_admin') }, async (req, reply) => { /* rotateSite; SiteNotFoundError→404; audit settings.sync.rotate */ });
app.post('/api/settings/sync/sites/:siteId/revoke', { preHandler: requireRole('lab_admin') }, async (req, reply) => { /* revokeSite; audit settings.sync.revoke; return {revoked:true} */ });
```
Resolve `<the config public-URL key>` (Task 4 identified it). Audits are secret-free.
- [ ] tests (`app.inject` + fake `ctx.auth.clients` + fake/real `ctx.syncSites`): enroll 200 + secret in body + audit; missing siteId→400; already-enrolled→409; unconfigured (auth.clients throws IdentityAdminNotConfiguredError)→503; `GET /sites` no secrets; rotate 200 + secret / 404; revoke 200; 401/403.
- [ ] typecheck (`@openldr/server`) + tests + commit `feat(server): central sync enrollment endpoints (enroll/sites/rotate/revoke) (sync S4d)`.

---

## Task 7: Studio "Sites" admin page

**Files:** Create `apps/studio/src/pages/Sites.tsx` (+ small dialogs) + route + nav; Modify `apps/studio/src/api.ts`; i18n en/fr/pt. Model on `apps/studio/src/pages/Users.tsx`.

- [ ] **api.ts:** `SyncSiteRow`, `EnrollResult` types (mirror server); `fetchSites()`, `enrollSite(body)`, `rotateSite(siteId)`, `revokeSite(siteId)` via `authFetch`.
- [ ] **Sites page:** admin-gated route + nav entry (mirror how Users is gated/registered). A table (siteId, name, clientId, status badge, enrolledAt) from `fetchSites`. An **Enroll** dialog (siteId + name [+ centralUrl if no server default]) → on success a **one-time secret-reveal dialog** (clientId/clientSecret/oidcIssuer/centralUrl with copy buttons + "won't be shown again" warning). Row actions: **Rotate** (confirm → reveal new secret once) + **Revoke** (confirm → status→revoked, toast). shadcn only; sonner toasts; loading/error states like Users.
- [ ] **i18n:** add `sites.*` keys (title, columns, enroll, rotate, revoke, secretRevealWarning, status.active/revoked, etc.) to en/fr/pt (real translations).
- [ ] typecheck (`@openldr/studio`) + any studio test + commit `feat(studio): central Sites enrollment admin page (sync S4d)`.

**Gotcha:** the secret is shown ONCE in the reveal dialog and never re-fetchable (GET /sites has no secret). shadcn primitives only; all three locales.

---

## Task 8: Live-Keycloak smoke, gate, whole-slice review, merge, push

- [ ] **Live-Keycloak smoke** (`scripts/sync-enroll-live-acceptance.ts` + `pnpm sync:enroll:accept`; FLAG that it needs a real Keycloak + admin creds — skip cleanly with a clear message when `KEYCLOAK_ADMIN_CLIENT_ID`/realm not configured, like other live-Keycloak tests). Against the dev Keycloak: build an `AppContext` (or a direct adapter-auth) with real admin creds → `enrollSite('site-smoke-1')` → use the returned clientId/secret to POST a `client_credentials` token request to `${OIDC_ISSUER_URL}/protocol/openid-connect/token` → decode the access token → **assert a top-level `site_id:'site-smoke-1'` claim** (+ `aud` if OIDC_AUDIENCE set) → run it through `auth.verifyToken` + the `sitePrincipal` extraction → assert ACCEPTED → `rotateSite` → assert the OLD secret's token request now fails + the NEW works → `revokeSite` → assert a fresh token request fails (client gone) → cleanup (delete the smoke client if not already). Print `✅ sync:enroll:accept PASSED`, exit 0. Paste output.
- [ ] **Gate:** `pnpm turbo run typecheck test --force --filter=@openldr/ports --filter=@openldr/adapter-auth --filter=@openldr/db --filter=@openldr/bootstrap --filter=@openldr/server --filter=@openldr/cli --filter=@openldr/studio` — PASS, no NEW failures (verify flaky pkgs in isolation; never pipe turbo through `tail` — on the Windows install-race, run each pkg's typecheck+vitest directly). Re-run the S1/S2/S3/S4c acceptance harnesses (`sync:accept`, `sync:pull:accept`, `sync:terminology:accept`) — shared adapter-auth/bootstrap/AppContext touched, must not regress.
- [ ] **Whole-slice review** (fresh reviewer over `git diff main..HEAD`): the realm grant is present in BOTH realm files + asserted; the `site_id` mapper is a top-level hardcoded-claim matching `sitePrincipal`; the secret is returned once + NEVER persisted on central (no `sync_sites` secret column, no GET returns it, audits secret-free); enroll idempotency (409 active / re-enroll revoked); revoke deletes the client; endpoints user-authed under `/api/settings/sync/*` (not machine-bypassed) + 503 when unconfigured; SITE_ID slug validation; no `Co-Authored-By`.
- [ ] **Merge:** `git checkout main && git merge --no-ff feat/sync-s4d-enrollment -m "Merge branch 'feat/sync-s4d-enrollment': distributed sync S4d — enrollment automation"`.
- [ ] **Push:** ask the user before `git push origin main`.
- [ ] **Update memory:** `distributed-sync-central-workstream.md` + `sync-s1-starting-point.md` — S4d DONE (central mints client+mapper+secret+site row; enroll/list/rotate/revoke via CLI+endpoint+Sites page; live-Keycloak-proven); **S4 fully complete**; new `origin/main` SHA (if pushed); NEXT = S5 store-and-forward bundles / S6 co-edit-conflict / S7 hardening.

---

## Self-review notes

- **Spec coverage:** realm prereq (§0)→T1; adapter-auth clients (§1)→T2; registry (§2)→T3; orchestrator+lifecycle (§3)→T4; CLI (§5)→T5; endpoints (§5)→T6; Sites page (§6)→T7; live smoke + gate/review/merge (§Testing/build order)→T8. All covered.
- **Ordering safety:** realm grant first (unblocks client creation); primitives before the orchestrator; registry before the orchestrator; orchestrator before CLI/endpoint/UI (all call it); everything before the live smoke.
- **Type consistency:** `SyncClientPort` (ports) implemented in adapter-auth + faked in orchestrator/endpoint tests; `EnrollResult`/`SyncSiteRow` shared across orchestrator → endpoints → studio api.ts (studio-mirrors-server). Typed errors map: CLI→exit, HTTP→409/404/503.
- **Security invariants (call out in review):** secret one-time + never stored (no column, no GET, secret-free audits); hardcoded-claim top-level `site_id` matches `sitePrincipal`; realm grant is the only authority widening + is asserted; endpoints off the machine-bypass path + admin-gated; slug validation on siteId (it becomes a clientId).
- **Deliberate shortcuts (flagged):** revoke doesn't kill live short-lived tokens; secret shown once; enroll endpoints 503 on non-central (no "I am central" flag); live smoke needs a real Keycloak (skips cleanly otherwise).
- **Plan-time unknowns to resolve during T4/T6:** the central public-URL config key for `centralUrl` (fallback: required `--central-url`/body field); whether `cfg` is reachable as `ctx.config` (else thread `OIDC_ISSUER_URL`/`OIDC_AUDIENCE`).
```
