# Phase 3 SP-4 — Marketplace UI (Design)

**Date:** 2026-06-22
**Status:** Approved for planning
**Phase 3 context:** Final marketplace sub-project. SP-0 built the corlix-style `/settings` shell (reserving `settings.subNav.marketplace`), SP-1 the signed artifact model, SP-2 the registry lifecycle + consent + runtime enforcement + `market` CLI, SP-3 the `artifact` authoring CLI. SP-4 makes it **operator-facing**: a Marketplace UI in the Settings shell, over a new HTTP API on the registry.

## 1. Goal

An admin-facing Marketplace at `/settings/marketplace`: browse available bundles, manage installed artifacts, install with an explicit capability-consent step, and run the full lifecycle (enable/disable/rollback/remove). Backend HTTP API + web UI. Admin-gated (`lab_admin`). Realizes **P3-UI-1..4**.

## 2. Resolved decisions

- **Bundle source:** a local registry directory (`MARKETPLACE_REGISTRY_DIR`, the `artifact publish --to` target); the API lists/verifies/installs from it. Browser upload deferred.
- **Scope:** full P3-UI — Available + Installed views, artifact detail, consent install, enable/disable/rollback/remove; basic text/type filter (YAGNI on heavy search).
- **i18n:** en only (fr/pt deferred to the overall sweep).
- **Styling:** shadcn (project rule), Card/Table like the DHIS2 Settings pages; corlix's GitHub-PR publish-config model is NOT adopted (local-first).

## 3. Current state (what SP-4 builds on / changes)

- **SP-0 Settings shell** `apps/web/src/pages/settings/SettingsShell.tsx`: role-gated `SUB_NAV`; currently only DHIS2. SP-4 adds a `marketplace` entry + route.
- **SP-2 registry** `packages/plugins` `PluginRuntime`: `list()`/`install(wasm, raw, opts)`/`rollback(id, version, opts?)`/`setEnabled(id, enabled, opts?)`/`remove(id, version?, opts?)`; `load`. `PluginRow` has `enabled`/`active`/`approvedBy`/`manifest` (the full artifact manifest).
- **SP-1/SP-3 marketplace** `packages/marketplace`: `readBundle`/`verifyBundle` (over a bundle dir), `readGrant`, capability/manifest types.
- **AppContext gap:** `packages/bootstrap/src/index.ts` `createAppContext` exposes `fhirStore`/`audit`/`reporting`/`dashboards`/`cfg` but **NOT the plugin runtime** (that lives in `createIngestContext`). SP-4 adds the registry to `AppContext`.
- **Server routes:** `apps/server/src/*-routes.ts` follow `registerXRoutes(app, ctx)` with `app.get/post('/api/...', { preHandler: requireRole('lab_admin') }, handler)`; registered in `apps/server/src/app.ts`.
- **Web:** `apps/web/src/api.ts` holds typed `fetch` client functions; pages under `apps/web/src/pages`; shadcn primitives in `apps/web/src/components/ui` (incl. `ConfirmDialog`, `Dialog`, `Table`, `Badge`, `Button`, `Input`, `Select`).
- No DB migration needed (installed = `plugins` table; available = filesystem).

## 4. Backend

### 4.1 Expose the registry on `AppContext`
Add to `AppContext` a `plugins: PluginRuntime` (the registry) wired in `createAppContext` with the same deps the ingest context uses: `blob` (already created in `createAppContext`), `createPluginStore(internal.db)`, `createExtismRunner()`, `logger`, `createTrustStore(internal.db)`, `ceVersion: '0.1.0'`, `verifyConfig: { devAllowUnsigned: cfg.MARKETPLACE_DEV_ALLOW_UNSIGNED }`, `recordInstall: (e) => safeRecord(audit, logger, e)`. (Factor the shared wiring so ingest-context and app-context don't drift — a small `createPluginRegistry(deps)` helper in bootstrap, or app-context calls the same constructor. Keep it DRY.)

### 4.2 Config
Add `MARKETPLACE_REGISTRY_DIR: z.string().optional()` to `ConfigSchema` (a server-local directory of published bundles; when unset, the Available list is empty with a clear "no registry configured" message — not an error).

### 4.3 `apps/server/src/marketplace-routes.ts` — `registerMarketplaceRoutes(app, ctx)`
All `requireRole('lab_admin')`:
- `GET /api/marketplace/installed` → `ctx.plugins.list()` mapped to `{ id, version, active, enabled, approvedBy, type, publisher, capabilities }` (publisher/capabilities/type read from each row's `manifest` via `readGrant`/the manifest fields).
- `GET /api/marketplace/available` → if no `MARKETPLACE_REGISTRY_DIR`, `{ configured: false, bundles: [] }`; else enumerate immediate subdirectories, `readBundle`+`verifyBundle` each (skip non-bundle dirs), return `{ configured: true, bundles: [{ ref(dirname), id, version, type, publisher, capabilities, compatibility, valid }] }`.
- `POST /api/marketplace/install` `{ ref, acknowledgedCapabilities }` → resolve `<MARKETPLACE_REGISTRY_DIR>/<ref>` (reject path traversal: `ref` must be a single safe path segment), `readBundle`, then `ctx.plugins.install(bundle.wasm, bundle.raw, { publicKeyDer: bundle.publicKeyDer, actor: { id: req.user.id, name: req.user.username }, approval: { approvedBy: req.user.id, acknowledgedCapabilities } })`. Returns the installed id@version. Errors (bad signature, key-mismatch, incompatible, consent-mismatch) surface as 400 with the message.
- `POST /api/marketplace/:id/enable` / `:id/disable` → `ctx.plugins.setEnabled(id, true|false, { actor })`.
- `POST /api/marketplace/:id/rollback` `{ version }` → `ctx.plugins.rollback(id, version, { actor })`.
- `DELETE /api/marketplace/:id` (optional `?version=`) → `ctx.plugins.remove(id, version, { actor })`.
The actor comes from the authenticated request (the same `req.user` mechanism the other admin routes use; mirror `users-routes.ts`/`dhis2-routes.ts`). Register in `app.ts`.

## 5. Web UI

### 5.1 `api.ts` client
`listInstalledArtifacts()`, `listAvailableArtifacts()`, `installArtifact(ref, acknowledgedCapabilities)`, `setArtifactEnabled(id, enabled)`, `rollbackArtifact(id, version)`, `removeArtifact(id, version?)` — typed over the routes above, relative `/api/marketplace/*` paths.

### 5.2 `apps/web/src/pages/settings/Marketplace.tsx` (rendered in the Settings `<Outlet/>`)
- In-content `<h1>` (consistent with the DHIS2 sub-pages), a text filter + a type filter (`Select`: all/plugin/form/report).
- **Two sections** (tabs or stacked Cards): **Available** and **Installed**.
- **Available** (P3-UI-1/2/3): a `Table` of registry bundles — id, version, type, publisher + a signature `Badge` (verified ✓ / first-use / invalid ✗), an **Install** button (disabled when `valid=false`) → opens the **consent dialog**. A "no registry configured" empty state when `configured=false`.
- **Consent dialog** (P3-SEC-3): publisher + trust/signature status, the **requested capabilities** rendered readably (emit-fhir resourceTypes, net-egress hosts, data-scope), compatibility range, and **“Approve & install”** → `installArtifact(ref, capabilities)` (acknowledged = the displayed requested set). Cancel/close without installing.
- **Installed** (P3-UI-4): a `Table` — id, active version, enabled state, approvedBy; actions: **enable/disable** (toggle), **rollback** (a `Select`/dialog of that id's installed versions → `rollbackArtifact`), **remove** (`ConfirmDialog`). A **detail** sheet/dialog (P3-UI-2) showing the full manifest, capabilities, version history, signature/publisher status.
- All actions refresh the lists; errors shown as inline toasts (the DHIS2-page toast pattern).

### 5.3 Settings shell + routing
- Add `{ labelKey: 'settings.subNav.marketplace', to: '/settings/marketplace', roles: ['lab_admin'] }` to `SettingsShell` `SUB_NAV`.
- Add the nested route `/settings/marketplace` → `<RequireRole role="lab_admin"><Marketplace/></RequireRole>` in `App.tsx` (under the existing `/settings` layout route).
- Add `settings.subNav.marketplace` + `settings.marketplace.*` i18n keys (en).

## 6. Testing

- **Server** `marketplace-routes.test.ts`: each route returns the right shape + is `lab_admin`-gated; `available` lists+verifies registry bundles and handles the unconfigured case; `install` passes the consent through to the runtime and rejects path traversal; lifecycle routes call the runtime. Use the existing server-route test harness (a built `AppContext` with an in-memory/fake plugin runtime + a temp registry dir).
- **Web** `Marketplace.test.tsx`: available/installed render from mocked `api.ts`; the consent dialog surfaces capabilities and `installArtifact` is called with the acknowledged set; install disabled for invalid bundles; enable/disable/rollback/remove call the right client fns; the unconfigured empty state renders. Plus a `SettingsShell` test update asserting the Marketplace sub-nav entry for an admin. Follow the DHIS2/Users component-test patterns (`MemoryRouter`, mocked `@/api` + `@/auth/AuthProvider`).
- AppContext wiring covered by a bootstrap typecheck + a smoke test that `ctx.plugins` is present.

## 7. Verification

Full gate: `pnpm turbo typecheck lint test build && pnpm depcruise` — all green. Live demo (§8). Optionally extend `marketplace:accept` or add a short e2e driving the UI (deferred; the unit/integration layer is the gate).

## 8. Live demo (run by the user)

Set `MARKETPLACE_REGISTRY_DIR` (e.g. to `../openldr-ce-marketplace/bundles`), `pnpm make:marketplace-bundle` (or `artifact publish --to $MARKETPLACE_REGISTRY_DIR`), start the app, open **Settings → Marketplace**: the whonet bundle appears under **Available** with its capabilities + verified badge; **Install** → consent dialog → **Approve & install** → it moves to **Installed**; toggle **disable/enable**, **rollback** between the narrow/wide versions, **remove**. The clickable capstone.

## 9. Out of scope

Browser upload of bundles, federation/central-catalog UI (SP-6), form/report **install** (their lifecycle isn't wired — Available may list them but Install is plugin-only for now; the UI disables install for non-plugin types with a tooltip), a publish-config UI (local-first uses `MARKETPLACE_REGISTRY_DIR`), fr/pt i18n.

## 10. Risks / notes

- **AppContext now wires a plugin runtime** (blob + store + runner + trust). Keep the wiring DRY with `createIngestContext` (shared `createPluginRegistry` helper) so the two don't diverge on verifyConfig/ceVersion/audit. Both must stay consistent or install behavior differs between CLI/worker and the UI.
- **Path-traversal:** `install { ref }` must reject anything but a single safe segment under `MARKETPLACE_REGISTRY_DIR` (no `..`, no absolute paths).
- **`available` reads the filesystem on each call** — fine for a small local registry; no caching needed (YAGNI).
- **Non-plugin bundles:** `available` may surface form/report bundles (signable via SP-3) but they can't be installed yet — the UI disables Install for non-plugin types with an explanatory tooltip rather than failing at the API.
- **Actor on routes:** reuse the existing authenticated-request actor (`req.user`) exactly as `users-routes.ts`/`dhis2-routes.ts` do; don't invent a new mechanism.
