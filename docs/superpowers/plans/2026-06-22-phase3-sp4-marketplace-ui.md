# Phase 3 SP-4 — Marketplace UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin Marketplace at `/settings/marketplace` — browse registry bundles, manage installed artifacts, install with capability consent, and run the lifecycle (enable/disable/rollback/remove) — over a new `/api/marketplace` HTTP API on the registry.

**Architecture:** Factor the plugin-runtime wiring into a shared `createPluginRegistry` helper (used by both ingest-context and app-context) so the server's `AppContext` exposes `ctx.plugins`. New `marketplace-routes.ts` over `ctx.plugins` + a `MARKETPLACE_REGISTRY_DIR` for available bundles. A `Marketplace.tsx` Settings sub-page (shadcn) with Available/Installed views + a consent dialog, wired via `api.ts`.

**Tech Stack:** TypeScript, Fastify, Kysely, zod, React + react-router + react-i18next + shadcn, Vitest, Turborepo/pnpm. Spec: `docs/superpowers/specs/2026-06-22-phase3-sp4-marketplace-ui-design.md`.

**Conventions:**
- Tests from root: `pnpm --filter @openldr/<pkg-or-app> test -- --run <path>`. Typecheck: `pnpm --filter <name> exec tsc -p tsconfig.json --noEmit`.
- Full gate (final task): `pnpm turbo typecheck lint test build && pnpm depcruise`.
- Server routes: `registerXRoutes(app, ctx)`, `app.get/post('/api/...', { preHandler: requireRole('lab_admin') }, handler)`; actor via `actorFromRequest(req)` / `req.user.{id,username}` (see `apps/server/src/audit-helper.ts`, `users-routes.ts`). Register in `apps/server/src/app.ts`.
- Web: typed `fetch` client fns in `apps/web/src/api.ts`; pages under `apps/web/src/pages`; shadcn primitives in `apps/web/src/components/ui`; component tests use `MemoryRouter` + `vi.mock('@/api')` + `vi.mock('@/auth/AuthProvider')` (see `Dhis2*.test.tsx`).
- `@openldr/web#test` can flake under full parallelism — re-run in isolation.
- Commit after every task.

---

## Slice 1 — Expose the registry on AppContext

### Task 1: `createPluginRegistry` helper + `MARKETPLACE_REGISTRY_DIR` config

**Files:**
- Create: `packages/bootstrap/src/plugin-registry.ts`
- Modify: `packages/bootstrap/src/ingest-context.ts`, `packages/config/src/schema.ts`

- [ ] **Step 1: Add the config flag** — in `packages/config/src/schema.ts`, next to `MARKETPLACE_DEV_ALLOW_UNSIGNED`:
```ts
    MARKETPLACE_REGISTRY_DIR: z.string().optional(),
```

- [ ] **Step 2: Create the shared helper** — `packages/bootstrap/src/plugin-registry.ts`:
```ts
import type { Kysely } from 'kysely';
import type { Logger } from '@openldr/core';
import type { BlobStoragePort } from '@openldr/ports';
import type { InternalSchema } from '@openldr/db';
import type { AuditStore } from '@openldr/audit';
import { safeRecord } from '@openldr/audit';
import { createPluginStore, createPluginRuntime, createExtismRunner, type PluginRuntime } from '@openldr/plugins';
import { createTrustStore } from '@openldr/marketplace';

const CE_VERSION = '0.1.0'; // artifact compatibility gate; matches package.json

/** Single source of truth for wiring the plugin/artifact registry — used by both the ingest worker and the server AppContext. */
export function createPluginRegistry(deps: {
  blob: BlobStoragePort;
  internalDb: Kysely<InternalSchema>;
  logger: Logger;
  audit: AuditStore;
  devAllowUnsigned: boolean;
}): PluginRuntime {
  return createPluginRuntime({
    blob: deps.blob,
    store: createPluginStore(deps.internalDb),
    runner: createExtismRunner(),
    logger: deps.logger,
    trustStore: createTrustStore(deps.internalDb),
    ceVersion: CE_VERSION,
    verifyConfig: { devAllowUnsigned: deps.devAllowUnsigned },
    recordInstall: (e) => safeRecord(deps.audit, deps.logger, e),
  });
}
```

- [ ] **Step 3: Use it in `ingest-context.ts`** — replace the inline `createPluginRuntime({...})` block with:
```ts
import { createPluginRegistry } from './plugin-registry';
// ...
  const plugins = createPluginRegistry({ blob, internalDb: internal.db, logger, audit, devAllowUnsigned: cfg.MARKETPLACE_DEV_ALLOW_UNSIGNED });
```
Remove the now-unused imports if they're no longer referenced elsewhere in the file (`createPluginStore`/`createExtismRunner`/`createTrustStore`/`createPluginRuntime` — check; `safeRecord` is still used elsewhere in the file, keep it).

- [ ] **Step 4: Typecheck + ingest tests** — `pnpm --filter @openldr/bootstrap exec tsc -p tsconfig.json --noEmit` (PASS), `pnpm --filter @openldr/bootstrap test -- --run` (PASS), `pnpm --filter @openldr/config test -- --run` (PASS).

- [ ] **Step 5: Commit**
```bash
git add packages/bootstrap/src/plugin-registry.ts packages/bootstrap/src/ingest-context.ts packages/config/src/schema.ts
git commit -m "refactor(bootstrap): createPluginRegistry helper + MARKETPLACE_REGISTRY_DIR config"
```

### Task 2: Expose `ctx.plugins` on AppContext

**Files:**
- Modify: `packages/bootstrap/src/index.ts`

- [ ] **Step 1: Add `plugins` to the `AppContext` interface**
```ts
  plugins: import('@openldr/plugins').PluginRuntime;
```
(Place it near `dashboards`/`cfg`. Or add a top-level `import { type PluginRuntime } from '@openldr/plugins';` and use `plugins: PluginRuntime;`.)

- [ ] **Step 2: Wire it in `createAppContext`** — after `audit`/`blob`/`internal` are created, add:
```ts
import { createPluginRegistry } from './plugin-registry';
// ...inside createAppContext, after `const audit = ...`:
  const plugins = createPluginRegistry({ blob, internalDb: internal.db, logger, audit, devAllowUnsigned: cfg.MARKETPLACE_DEV_ALLOW_UNSIGNED });
```
and include `plugins` in the returned object. (Confirm the local variable names for the blob/internal-db/logger/audit in `createAppContext` and match them; `internalDb` is exposed as `ctx.internalDb` so the local is likely `internal.db`.)

- [ ] **Step 3: Typecheck** — `pnpm --filter @openldr/bootstrap exec tsc -p tsconfig.json --noEmit` (PASS). Add/extend the bootstrap `index.test.ts` (or `dashboards.test.ts` sibling) with a smoke assertion that a built `AppContext` has a `plugins` object with `list`/`install`/`rollback`/`setEnabled`/`remove` functions (use the existing test's context-construction harness; if it requires live services, instead assert via a type-level check or skip per the existing test conventions).

- [ ] **Step 4: Commit**
```bash
git add packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): expose the plugin/artifact registry on AppContext"
```

---

## Slice 2 — `/api/marketplace` routes

### Task 3: `marketplace-routes.ts` + registration

**Files:**
- Create: `apps/server/src/marketplace-routes.ts`, `apps/server/src/marketplace-routes.test.ts`
- Modify: `apps/server/src/app.ts`

- [ ] **Step 1: Write the failing test** — `marketplace-routes.test.ts`. Build a Fastify app with a fake `AppContext` (`plugins` = an in-memory fake implementing `list`/`install`/`rollback`/`setEnabled`/`remove`; `cfg.MARKETPLACE_REGISTRY_DIR` pointed at a temp dir containing one packed bundle built via `@openldr/marketplace` `packBundle`). Mirror an existing server-route test (e.g. `dhis2-routes.test.ts`) for app construction + the auth/role stub. Assert:
  - `GET /api/marketplace/installed` returns the fake's list mapped shape, 403 without `lab_admin`.
  - `GET /api/marketplace/available` returns `{ configured: true, bundles: [{ ref, id, version, valid, capabilities, ... }] }`; `{ configured: false, bundles: [] }` when the cfg dir is unset.
  - `POST /api/marketplace/install { ref, acknowledgedCapabilities }` calls `plugins.install` with the bundle + an approval carrying the actor + acknowledged caps; rejects a `ref` containing `..` or a slash with 400.
  - `POST /:id/enable|disable`, `POST /:id/rollback {version}`, `DELETE /:id` call the right runtime methods.

(Follow the exact harness of `dhis2-routes.test.ts`; if that test injects a stub `requireRole`/user, reuse it so the role-gate + `req.user` actor work.)

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @openldr/server test -- --run src/marketplace-routes.test.ts`

- [ ] **Step 3: Implement** — `marketplace-routes.ts`:
```ts
import { readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { readBundle, verifyBundle, readGrant } from '@openldr/marketplace';
import { requireRole } from './auth'; // match the import the other routes use

function actor(req: FastifyRequest): { id?: string | null; name: string } {
  return { id: req.user?.id ?? null, name: req.user?.username ?? 'unknown' };
}

// A registry `ref` must be a single safe path segment (no traversal, no separators).
function safeRef(ref: unknown): string | null {
  if (typeof ref !== 'string' || ref.length === 0) return null;
  if (ref.includes('/') || ref.includes('\\') || ref.includes('..')) return null;
  if (basename(ref) !== ref) return null;
  return ref;
}

export function registerMarketplaceRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const registryDir = ctx.cfg.MARKETPLACE_REGISTRY_DIR;

  app.get('/api/marketplace/installed', { preHandler: requireRole('lab_admin') }, async () => {
    const rows = await ctx.plugins.list();
    return rows.map((r) => {
      const g = readGrant(r.manifest);
      const m = r.manifest as Record<string, unknown>;
      return {
        id: r.id, version: r.version, active: r.active, enabled: r.enabled, approvedBy: r.approvedBy,
        type: (m.type as string) ?? 'plugin',
        publisher: (m.publisher as unknown) ?? null,
        capabilities: g.legacy ? [] : g.capabilities,
        legacy: g.legacy,
      };
    });
  });

  app.get('/api/marketplace/available', { preHandler: requireRole('lab_admin') }, async () => {
    if (!registryDir) return { configured: false, bundles: [] };
    let entries: string[] = [];
    try { entries = (await readdir(registryDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); }
    catch { return { configured: true, bundles: [], error: 'registry directory not readable' }; }
    const bundles = [];
    for (const ref of entries) {
      try {
        const b = await readBundle(join(registryDir, ref));
        const v = verifyBundle(b);
        bundles.push({ ref, id: b.manifest.id, version: b.manifest.version, type: b.manifest.type, publisher: b.manifest.publisher ?? null, capabilities: b.manifest.capabilities, compatibility: b.manifest.compatibility, valid: v.valid });
      } catch { /* skip non-bundle dirs */ }
    }
    return { configured: true, bundles };
  });

  app.post('/api/marketplace/install', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    if (!registryDir) { reply.code(400); return { error: 'no marketplace registry configured' }; }
    const body = (req.body ?? {}) as { ref?: unknown; acknowledgedCapabilities?: unknown };
    const ref = safeRef(body.ref);
    if (!ref) { reply.code(400); return { error: 'invalid bundle ref' }; }
    try {
      const b = await readBundle(join(registryDir, ref));
      const a = actor(req);
      const installed = await ctx.plugins.install(b.wasm, b.raw, {
        publicKeyDer: b.publicKeyDer,
        actor: a,
        approval: { approvedBy: a.id ?? a.name, acknowledgedCapabilities: (body.acknowledgedCapabilities as never) ?? b.manifest.capabilities },
      });
      return { id: installed.id, version: installed.version };
    } catch (err) { reply.code(400); return { error: err instanceof Error ? err.message : String(err) }; }
  });

  app.post('/api/marketplace/:id/enable', { preHandler: requireRole('lab_admin') }, async (req) => {
    await ctx.plugins.setEnabled((req.params as { id: string }).id, true, { actor: actor(req) }); return { ok: true };
  });
  app.post('/api/marketplace/:id/disable', { preHandler: requireRole('lab_admin') }, async (req) => {
    await ctx.plugins.setEnabled((req.params as { id: string }).id, false, { actor: actor(req) }); return { ok: true };
  });
  app.post('/api/marketplace/:id/rollback', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const version = (req.body as { version?: string } | undefined)?.version;
    if (!version) { reply.code(400); return { error: 'version is required' }; }
    try { await ctx.plugins.rollback(id, version, { actor: actor(req) }); return { ok: true }; }
    catch (err) { reply.code(400); return { error: err instanceof Error ? err.message : String(err) }; }
  });
  app.delete('/api/marketplace/:id', { preHandler: requireRole('lab_admin') }, async (req) => {
    const { id } = req.params as { id: string };
    const version = (req.query as { version?: string } | undefined)?.version;
    await ctx.plugins.remove(id, version, { actor: actor(req) }); return { ok: true };
  });
}
```
NOTE: verify the exact `requireRole` import path + the `req.user` typing the other routes use (check `dhis2-routes.ts`/`users-routes.ts` imports) and match them; adjust the `actor`/`req.user` access to the real augmented Fastify request type.

- [ ] **Step 4: Register in `app.ts`** — import `registerMarketplaceRoutes` and call `registerMarketplaceRoutes(app, ctx);` alongside the other `register*Routes(app, ctx)` calls.

- [ ] **Step 5: Run tests + server typecheck** — `pnpm --filter @openldr/server test -- --run src/marketplace-routes.test.ts` (PASS), server typecheck (PASS).

- [ ] **Step 6: Commit**
```bash
git add apps/server/src/marketplace-routes.ts apps/server/src/marketplace-routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): /api/marketplace routes (browse/install-with-consent/lifecycle)"
```

---

## Slice 3 — Web UI

### Task 4: `api.ts` client functions

**Files:**
- Modify: `apps/web/src/api.ts`

- [ ] **Step 1: Add typed client fns + types** (follow the existing `api.ts` `fetch` idiom — same base, error handling, JSON):
```ts
export interface AvailableArtifact { ref: string; id: string; version: string; type: string; publisher: { id: string; name: string } | null; capabilities: unknown[]; compatibility: { ceVersion: string }; valid: boolean }
export interface InstalledArtifact { id: string; version: string; active: boolean; enabled: boolean; approvedBy: string | null; type: string; publisher: unknown; capabilities: unknown[]; legacy: boolean }

export async function listInstalledArtifacts(): Promise<InstalledArtifact[]> { /* GET /api/marketplace/installed */ }
export async function listAvailableArtifacts(): Promise<{ configured: boolean; bundles: AvailableArtifact[] }> { /* GET /api/marketplace/available */ }
export async function installArtifact(ref: string, acknowledgedCapabilities: unknown[]): Promise<{ id: string; version: string }> { /* POST /api/marketplace/install */ }
export async function setArtifactEnabled(id: string, enabled: boolean): Promise<void> { /* POST /api/marketplace/:id/(enable|disable) */ }
export async function rollbackArtifact(id: string, version: string): Promise<void> { /* POST /api/marketplace/:id/rollback */ }
export async function removeArtifact(id: string, version?: string): Promise<void> { /* DELETE /api/marketplace/:id[?version=] */ }
```
Implement each with the project's existing fetch helper (match how `getDhis2Status`/`saveDhis2Mapping` are written — same `apiFetch`/`fetchJson` wrapper, relative paths, `--`json bodies).

- [ ] **Step 2: Typecheck** — `pnpm --filter @openldr/web exec tsc -p tsconfig.json --noEmit` (PASS).

- [ ] **Step 3: Commit**
```bash
git add apps/web/src/api.ts
git commit -m "feat(web): marketplace api client functions"
```

### Task 5: i18n + Settings shell sub-nav + route

**Files:**
- Modify: `apps/web/src/i18n/index.ts`, `apps/web/src/pages/settings/SettingsShell.tsx`, `apps/web/src/App.tsx`

- [ ] **Step 1: Add i18n keys** (en) — add `settings.subNav.marketplace: 'Marketplace'` and a `settings.marketplace` block (title, tabs, columns, consent dialog labels, action labels, empty/unconfigured states, toasts). Concretely add under the existing `settings` object:
```ts
    subNav: { dhis2: 'DHIS2', marketplace: 'Marketplace' },
    marketplace: {
      heading: 'Marketplace', available: 'Available', installed: 'Installed',
      filterPlaceholder: 'Filter…', type: 'Type', publisher: 'Publisher', version: 'Version',
      install: 'Install', verified: 'Verified', firstUse: 'New publisher', invalid: 'Invalid signature',
      notConfigured: 'No marketplace registry configured (set MARKETPLACE_REGISTRY_DIR).',
      consentTitle: 'Review & approve: {{id}}', requestedCapabilities: 'Requested capabilities',
      approveInstall: 'Approve & install', cancel: 'Cancel',
      enable: 'Enable', disable: 'Disable', rollback: 'Roll back', remove: 'Remove',
      active: 'Active', enabledLabel: 'Enabled', approvedBy: 'Approved by',
      installPluginOnly: 'Only plugin artifacts can be installed for now.',
      removeTitle: 'Remove {{id}}?', removeDescription: 'This uninstalls the artifact from this deployment.',
      installedToast: 'Installed {{id}}', errorToast: 'Marketplace error: {{error}}',
    },
```

- [ ] **Step 2: Add the sub-nav entry** — in `SettingsShell.tsx` `SUB_NAV`, append:
```ts
  { labelKey: 'settings.subNav.marketplace', to: '/settings/marketplace', roles: ['lab_admin'] },
```

- [ ] **Step 3: Add the route** — in `App.tsx`, under the `/settings` layout route, add:
```tsx
        <Route path="marketplace" element={<RequireRole role="lab_admin"><Marketplace /></RequireRole>} />
```
and `import { Marketplace } from '@/pages/settings/Marketplace';` (the component lands in Task 6; this import will fail to compile until then — do Step 3 and Task 6 together, or stub the import). To keep this task's commit green, add a minimal placeholder `Marketplace.tsx` exporting `export function Marketplace() { return null; }` now and flesh it out in Task 6.

- [ ] **Step 4: Update the `SettingsShell` test** — assert the Marketplace sub-nav link renders for a `lab_admin` (extend the existing `SettingsShell.test.tsx`).

- [ ] **Step 5: Typecheck + tests** — web typecheck (PASS), `pnpm --filter @openldr/web test -- --run src/pages/settings/SettingsShell.test.tsx` (PASS).

- [ ] **Step 6: Commit**
```bash
git add apps/web/src/i18n/index.ts apps/web/src/pages/settings/SettingsShell.tsx apps/web/src/App.tsx apps/web/src/pages/settings/Marketplace.tsx apps/web/src/pages/settings/SettingsShell.test.tsx
git commit -m "feat(web): marketplace sub-nav entry + route + i18n (placeholder page)"
```

### Task 6: `Marketplace.tsx` — Available / Installed / consent / lifecycle

**Files:**
- Modify: `apps/web/src/pages/settings/Marketplace.tsx`
- Create: `apps/web/src/pages/settings/Marketplace.test.tsx`

- [ ] **Step 1: Write the failing test** — `Marketplace.test.tsx` (mock `@/api` + `@/auth/AuthProvider`, render in `MemoryRouter`):
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me', username: 'admin', roles: ['lab_admin'] }, hasRole: () => true }) }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual,
    listInstalledArtifacts: vi.fn(), listAvailableArtifacts: vi.fn(),
    installArtifact: vi.fn(), setArtifactEnabled: vi.fn(), rollbackArtifact: vi.fn(), removeArtifact: vi.fn() };
});
import * as api from '@/api';
import { Marketplace } from './Marketplace';

beforeEach(() => { vi.clearAllMocks(); });

it('lists available bundles and installs after consent', async () => {
  (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, bundles: [{ ref: 'whonet-narrow', id: 'whonet-sqlite', version: '1.0.0', type: 'plugin', publisher: { id: 'p', name: 'P' }, capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }], compatibility: { ceVersion: '*' }, valid: true }] });
  (api.listInstalledArtifacts as any).mockResolvedValue([]);
  (api.installArtifact as any).mockResolvedValue({ id: 'whonet-sqlite', version: '1.0.0' });
  render(<MemoryRouter><Marketplace /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId('install-whonet-narrow'));
  // consent dialog shows the requested capabilities
  expect(await screen.findByText(/Patient/)).toBeTruthy();
  fireEvent.click(screen.getByTestId('approve-install'));
  await waitFor(() => expect(api.installArtifact).toHaveBeenCalledWith('whonet-narrow', [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }]));
});

it('shows the unconfigured empty state', async () => {
  (api.listAvailableArtifacts as any).mockResolvedValue({ configured: false, bundles: [] });
  (api.listInstalledArtifacts as any).mockResolvedValue([]);
  render(<MemoryRouter><Marketplace /></MemoryRouter>);
  expect(await screen.findByText(/No marketplace registry configured/i)).toBeTruthy();
});

it('disables install for a non-plugin bundle', async () => {
  (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, bundles: [{ ref: 'form1', id: 'intake', version: '1.0.0', type: 'form-template', publisher: null, capabilities: [], compatibility: { ceVersion: '*' }, valid: true }] });
  (api.listInstalledArtifacts as any).mockResolvedValue([]);
  render(<MemoryRouter><Marketplace /></MemoryRouter>);
  expect((await screen.findByTestId('install-form1')).hasAttribute('disabled')).toBe(true);
});

it('enable/disable + remove call the api', async () => {
  (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, bundles: [] });
  (api.listInstalledArtifacts as any).mockResolvedValue([{ id: 'whonet-sqlite', version: '1.0.0', active: true, enabled: true, approvedBy: 'admin', type: 'plugin', publisher: null, capabilities: [], legacy: false }]);
  (api.setArtifactEnabled as any).mockResolvedValue(undefined);
  render(<MemoryRouter><Marketplace /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId('toggle-enabled-whonet-sqlite'));
  await waitFor(() => expect(api.setArtifactEnabled).toHaveBeenCalledWith('whonet-sqlite', false));
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @openldr/web test -- --run src/pages/settings/Marketplace.test.tsx`

- [ ] **Step 3: Implement `Marketplace.tsx`** — a content component (renders inside the Settings `<Outlet/>`, NO `AppShell` wrapper — like the DHIS2 sub-pages). Structure:
  - `useTranslation`; state for `available`, `installed`, `filter`, `typeFilter`, `consentBundle` (the bundle pending consent | null), `toast`.
  - `load()` calls `listAvailableArtifacts()` + `listInstalledArtifacts()`; `useEffect` on mount.
  - Root `<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4" data-testid="marketplace-page">` + `<h1 className="text-lg font-semibold">{t('settings.marketplace.heading')}</h1>`.
  - Filter row: an `Input` (text) + a shadcn `Select` (type: all/plugin/form/report).
  - **Available** `Card`: if `!configured` → the `notConfigured` empty state; else a `Table` of filtered bundles — columns id/version/type/publisher + a signature `Badge` (valid→verified, publisher present but…→firstUse, !valid→invalid) + an **Install** `Button` `data-testid={`install-${ref}`}` disabled when `!valid || type !== 'plugin'` (tooltip `installPluginOnly` for non-plugin) → `setConsentBundle(b)`.
  - **Consent `Dialog`** (open when `consentBundle`): title `consentTitle` with the id; show publisher + signature status, the **requested capabilities** rendered readably (map each capability to a human line), compatibility; buttons **Cancel** + **Approve & install** `data-testid="approve-install"` → `await installArtifact(consentBundle.ref, consentBundle.capabilities)` → toast + `setConsentBundle(null)` + `load()`.
  - **Installed** `Card`: a `Table` — id, active version, an enabled toggle `data-testid={`toggle-enabled-${id}`}` → `setArtifactEnabled(id, !enabled)`, a **rollback** control (only if >1 version known — for SP-4 a simple `Select` of versions from a per-id grouping of `installed`, or omit if single; keep minimal: a rollback `Button` that opens a small version picker), and a **Remove** `Button` → `ConfirmDialog` → `removeArtifact(id)`. A **detail** affordance (a row click or an "i" button) opening a `Dialog`/sheet with the manifest/capabilities/publisher/version history.
  - Errors → `toast` (the DHIS2-page toast pattern); each successful action calls `load()`.
  Use only existing shadcn primitives (`Card`, `Table*`, `Badge`, `Button`, `Input`, `Select*`, `Dialog*`, `ConfirmDialog`). Keep the file focused; if it grows past ~250 lines, split the consent dialog into a sibling component.

- [ ] **Step 4: Run, expect PASS** — `pnpm --filter @openldr/web test -- --run src/pages/settings/Marketplace.test.tsx`

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/pages/settings/Marketplace.tsx apps/web/src/pages/settings/Marketplace.test.tsx
git commit -m "feat(web): Marketplace page — available/installed/consent/lifecycle"
```

---

### Task 7: Full gate + verification

- [ ] **Step 1: Full gate** — `pnpm turbo typecheck lint test build && pnpm depcruise`. Expected green. depcruise: `apps/server`/`apps/web` may import marketplace/plugins (allowed); confirm no new cycle. Re-run `@openldr/web#test` in isolation if it flakes.
- [ ] **Step 2: Commit any fixes.**

(Live demo run by the user — spec §8: set `MARKETPLACE_REGISTRY_DIR`, publish a bundle, open Settings → Marketplace, install with consent, toggle/rollback/remove.)

---

## Self-Review

**Spec coverage:**
- §4.1 expose registry on AppContext (DRY helper) → Tasks 1, 2. ✓
- §4.2 `MARKETPLACE_REGISTRY_DIR` config → Task 1. ✓
- §4.3 marketplace routes (installed/available/install-consent/enable/disable/rollback/remove, role-gated, path-traversal guard, actor) → Task 3. ✓
- §5.1 api.ts client → Task 4. ✓
- §5.2 Marketplace page (available/installed/consent/detail/lifecycle, filters, empty state, non-plugin disabled) → Task 6. ✓
- §5.3 sub-nav + route + i18n → Task 5. ✓
- §6 testing → server route test (Task 3), web tests (Tasks 5, 6), bootstrap smoke (Task 2). ✓
- §7 verification → Task 7. ✓
- §9 out-of-scope (upload, federation, form/report install, publish-config UI, fr/pt) → none built; non-plugin install disabled in UI (Task 6) + API install is plugin-wired (SP-2). ✓
- §10 risks (DRY wiring via createPluginRegistry, path-traversal guard, fs-per-call, non-plugin handling, req.user actor) → Tasks 1, 3, 6. ✓

**Placeholder scan:** No TBD/TODO. Task 4's `api.ts` fns show the signatures + the endpoint each maps to, with an explicit "match the existing `apiFetch`/`fetchJson` wrapper" instruction (the repo has one established helper; re-pasting a guessed wrapper would be wrong — the implementer uses the real one). Task 6 Step 3 gives the full component structure + every `data-testid` the tests assert + the exact primitives; the tests in Step 1 pin the behavior precisely.

**Type/name consistency:** `createPluginRegistry(deps)` (Task 1) is consumed identically in ingest-context (Task 1) + app-context (Task 2); `AppContext.plugins: PluginRuntime` (Task 2) is used by the routes (Task 3); route shapes (`{ ref, id, version, type, publisher, capabilities, compatibility, valid }` available; `{ id, version, active, enabled, approvedBy, type, publisher, capabilities, legacy }` installed) match the `api.ts` types `AvailableArtifact`/`InstalledArtifact` (Task 4) and the `Marketplace.test.tsx` mocks (Task 6). Client fns `listInstalledArtifacts`/`listAvailableArtifacts`/`installArtifact`/`setArtifactEnabled`/`rollbackArtifact`/`removeArtifact` are named identically across Tasks 4 and 6. i18n keys (`settings.subNav.marketplace`, `settings.marketplace.*`) match between Task 5 and Task 6.
