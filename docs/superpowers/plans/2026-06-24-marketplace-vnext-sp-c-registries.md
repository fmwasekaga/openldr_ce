# SP-C — User-Managed Marketplace Registries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single boot-time env registry with a **DB-backed table of N registries**, managed in-app (Settings ▸ Marketplace ▸ Registries), with **no restart** — Browse aggregates across all enabled registries, each card tagged with its source registry. Modeled on the Connectors feature. Security is unchanged (signatures + TOFU + capability consent at install).

**Architecture:** A `registries` table (`{ id, name, kind: 'local'|'http', location, enabled, created_at, updated_at }`) + `createRegistryStore` (CRUD, no secrets). Marketplace routes resolve `RegistrySource` instances **per request** from the enabled rows (no module-level `source`). `/available` aggregates `source.list()` across registries; each bundle's `ref` (and each `versions[].ref`) is rewritten to a **composite** `${registryId}::${bundleRef}` so the registry is encoded in the existing `ref` — detail/install split it to resolve the right registry, leaving the web's ref-based flow + tests unchanged. Env `MARKETPLACE_REGISTRY_URL/DIR` seed a default row on first boot (when the table is empty). Publish staging stays env-based (`MARKETPLACE_REGISTRY_DIR`) — unaffected.

**Tech Stack:** Kysely + pg (migration/store), Fastify (routes), React + shadcn (Table/Dialog/Select/Switch/ConfirmDialog), react-i18next (en/fr/pt), Vitest + pg-mem.

## Recon (verified — file:line)
- Migrations: `packages/db/src/migrations/internal/` — latest is `033_connectors.ts` (registered in `index.ts`). New: `034_marketplace_registries.ts`.
- Schema: `packages/db/src/schema/internal.ts` — `ConnectorsTable` interface + `connectors:` on `InternalSchema` (add `RegistriesTable` + `registries:` after it).
- Store template: `packages/db/src/connector-store.ts` (`createConnectorStore`); export via `packages/db/src/index.ts` (`export * from './connector-store';`).
- Routes: `apps/server/src/marketplace-routes.ts` — module-level `source` (lines 28-31); used in `/available` (68), `/available/:ref` (86,90), `/install` (107,115), `/refresh` (137); publish (145-215) uses `stagingDir` from env (LEAVE AS-IS). All endpoints `requireRole('lab_admin')`. `ctx.internalDb` is available (AppContext).
- `registerMarketplaceRoutes(app, ctx, fetchImpl)` is called in `apps/server/src/app.ts`.
- Registry sources: `packages/marketplace/src/registry-source.ts` — `new LocalRegistrySource(dir)` / `new HttpRegistrySource(baseUrl, fetchImpl)`; `RegistryListing` has `ref/id/version/.../versions`.
- Bootstrap: `packages/bootstrap/src/index.ts` `createAppContext` builds stores (~155+); good place to seed default registry from env when the table is empty.
- Web: `apps/web/src/api.ts` `listAvailableArtifacts` → `{ configured, source, host, bundles }`; `AvailableArtifact` (~910). `Marketplace.tsx` (source/host indicator + tabs) + `marketplace/MarketplaceTabs.tsx` (Browse/Installed tabs). i18n `settings.marketplace.*` (en/fr/pt).
- Connectors UI is the CRUD-page template: `apps/web/src/pages/settings/Connectors.tsx`.

---

### Task 1: `registries` migration + schema + store (TDD)

**Files:** Create `packages/db/src/migrations/internal/034_marketplace_registries.ts`, `packages/db/src/registry-store.ts`, `packages/db/src/registry-store.test.ts`; Modify `packages/db/src/migrations/internal/index.ts`, `packages/db/src/schema/internal.ts`, `packages/db/src/index.ts`.

- [ ] **Step 1: Migration** — create `034_marketplace_registries.ts`:
```typescript
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('registries')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull().unique())
    .addColumn('kind', 'text', (c) => c.notNull())            // 'local' | 'http'
    .addColumn('location', 'text', (c) => c.notNull())        // dir path or base URL
    .addColumn('enabled', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('registries').ifExists().execute();
}
```
Register it in `migrations/internal/index.ts` (mirror how `033_connectors` is imported + added to the migrations map/array — READ the file and follow its exact pattern, key `'034_marketplace_registries'`).

- [ ] **Step 2: Schema** — in `schema/internal.ts`, after `ConnectorsTable`, add:
```typescript
export interface RegistriesTable {
  id: string;
  name: string;
  kind: string;                 // 'local' | 'http'
  location: string;
  enabled: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}
```
And add `registries: RegistriesTable;` to the `InternalSchema` interface (after `connectors:`). (Use the same `Generated` import the file already uses.)

- [ ] **Step 3: Failing store test** — `registry-store.test.ts` (mirror `connector-store.test.ts`'s pg-mem setup):
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import { Kysely } from 'kysely';
import { createRegistryStore } from './registry-store';
import type { InternalSchema } from './schema/internal';

function makeDb(): Kysely<InternalSchema> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<InternalSchema>;
  return db;
}
async function migrate(db: Kysely<InternalSchema>) {
  await db.schema.createTable('registries')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull().unique())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('location', 'text', (c) => c.notNull())
    .addColumn('enabled', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (c) => c.defaultTo(new Date().toISOString()))
    .addColumn('updated_at', 'timestamptz', (c) => c.defaultTo(new Date().toISOString()))
    .execute();
}

describe('createRegistryStore', () => {
  let db: Kysely<InternalSchema>;
  beforeEach(async () => { db = makeDb(); await migrate(db); });

  it('creates, lists, updates, removes', async () => {
    const store = createRegistryStore(db);
    await store.create({ id: 'r1', name: 'Public', kind: 'http', location: 'https://example.org/reg' });
    await store.create({ id: 'r2', name: 'Local dir', kind: 'local', location: '/srv/bundles', enabled: false });
    const all = await store.list();
    expect(all.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
    expect((await store.get('r1'))!.kind).toBe('http');
    await store.update('r1', { enabled: false, name: 'Public (off)' });
    expect((await store.get('r1'))!.enabled).toBe(false);
    expect((await store.get('r1'))!.name).toBe('Public (off)');
    await store.remove('r2');
    expect(await store.get('r2')).toBeNull();
  });
});
```
Run `pnpm -C packages/db test registry-store` → FAIL (no module). (Check pg-mem `timestamptz`/`now()` handling — mirror exactly what `connector-store.test.ts` does for timestamp columns; if pg-mem rejects `defaultTo(sql\`now()\`)`, the test's `migrate()` above uses a literal default to sidestep that.)

- [ ] **Step 4: Implement `registry-store.ts`** (mirror connector-store.ts, no encryption):
```typescript
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export interface RegistryRecord {
  id: string; name: string; kind: string; location: string;
  enabled: boolean; createdAt: Date; updatedAt: Date;
}
export interface NewRegistry { id: string; name: string; kind: string; location: string; enabled?: boolean }
export interface RegistryPatch { name?: string; kind?: string; location?: string; enabled?: boolean }

export interface RegistryStore {
  create(input: NewRegistry): Promise<void>;
  get(id: string): Promise<RegistryRecord | null>;
  list(): Promise<RegistryRecord[]>;
  update(id: string, patch: RegistryPatch): Promise<void>;
  remove(id: string): Promise<void>;
}

function toRecord(r: { id: string; name: string; kind: string; location: string; enabled: boolean; created_at: Date; updated_at: Date }): RegistryRecord {
  return { id: r.id, name: r.name, kind: r.kind, location: r.location, enabled: r.enabled, createdAt: r.created_at, updatedAt: r.updated_at };
}

export function createRegistryStore(db: Kysely<InternalSchema>): RegistryStore {
  const cols = ['id', 'name', 'kind', 'location', 'enabled', 'created_at', 'updated_at'] as const;
  return {
    async create(input) {
      await db.insertInto('registries').values({
        id: input.id, name: input.name, kind: input.kind, location: input.location,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      }).execute();
    },
    async get(id) {
      const r = await db.selectFrom('registries').select(cols).where('id', '=', id).executeTakeFirst();
      return r ? toRecord(r) : null;
    },
    async list() {
      return (await db.selectFrom('registries').select(cols).orderBy('name').execute()).map(toRecord);
    },
    async update(id, patch) {
      const set: Record<string, unknown> = { updated_at: sql`now()` };
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.kind !== undefined) set.kind = patch.kind;
      if (patch.location !== undefined) set.location = patch.location;
      if (patch.enabled !== undefined) set.enabled = patch.enabled;
      await db.updateTable('registries').set(set).where('id', '=', id).execute();
    },
    async remove(id) { await db.deleteFrom('registries').where('id', '=', id).execute(); },
  };
}
```
Export from `packages/db/src/index.ts`: `export * from './registry-store';`.

- [ ] **Step 5: Run + typecheck** — `pnpm -C packages/db test registry-store` PASS; `pnpm -C packages/db typecheck` PASS.

- [ ] **Step 6: Commit**
```bash
git add packages/db/src/migrations/internal/034_marketplace_registries.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts packages/db/src/registry-store.ts packages/db/src/registry-store.test.ts packages/db/src/index.ts
git commit -m "feat(db): registries table + createRegistryStore (migration 034) (SP-C)"
```

---

### Task 2: Seed a default registry from env on first boot

**Files:** `packages/bootstrap/src/index.ts`.

- [ ] **Step 1: Add the idempotent seed** in `createAppContext`, after the internal db + stores are created (near where other stores like `createConnectorStore`/`createMarketplaceInstallStore` are instantiated). READ the area first; add:
```typescript
// Seed a default marketplace registry from the legacy env vars the first time (table empty),
// so existing deployments keep working without manual setup. No-op once a row exists.
const registries = createRegistryStore(internal.db as unknown as Kysely<InternalSchema>);
if ((await registries.list()).length === 0) {
  if (cfg.MARKETPLACE_REGISTRY_URL) {
    await registries.create({ id: 'env-http', name: 'Default registry', kind: 'http', location: cfg.MARKETPLACE_REGISTRY_URL });
  } else if (cfg.MARKETPLACE_REGISTRY_DIR) {
    await registries.create({ id: 'env-local', name: 'Local registry', kind: 'local', location: cfg.MARKETPLACE_REGISTRY_DIR });
  }
}
```
Import `createRegistryStore` from `@openldr/db` (add to the existing `@openldr/db` import). Use the same `internal.db as unknown as Kysely<InternalSchema>` cast the file already uses for other stores (grep the file for an existing cast and match it).

- [ ] **Step 2: typecheck** — `pnpm -C packages/bootstrap typecheck` PASS.

- [ ] **Step 3: Commit**
```bash
git add packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): seed a default marketplace registry from env when the table is empty (SP-C)"
```

---

### Task 3: Marketplace routes — DB registries, per-request resolution, aggregation, CRUD

**Files:** `apps/server/src/marketplace-routes.ts`; Test: `apps/server/src/marketplace-routes.test.ts` (extend).

Composite ref scheme: `COMPOSITE = ${registryId}::${bundleRef}`. Helpers `packRef(registryId, ref)` / `unpackRef(composite) → { registryId, ref } | null`. `safeRef` already permits `:` (it rejects only `/`,`\`,`..`). The aggregated `/available` rewrites each bundle's `ref` and every `versions[].ref` to composite + adds `registryId` + `registryName`. `/available/:ref` and `/install` unpack to find the registry.

- [ ] **Step 1: Read the current file** (the `source` setup + all endpoints). Then refactor:

Replace the module-level `const source = …` with a registry store + a per-request resolver:
```typescript
import { createRegistryStore, type RegistryRecord } from '@openldr/db';
// inside registerMarketplaceRoutes, after destructuring ctx:
const registries = createRegistryStore(ctx.internalDb);

function sourceFor(reg: RegistryRecord): RegistrySource {
  return reg.kind === 'http' ? new HttpRegistrySource(reg.location, fetchImpl) : new LocalRegistrySource(reg.location);
}
async function enabledRegistries(): Promise<RegistryRecord[]> {
  return (await registries.list()).filter((r) => r.enabled);
}
const SEP = '::';
const packRef = (registryId: string, ref: string) => `${registryId}${SEP}${ref}`;
function unpackRef(composite: string): { registryId: string; ref: string } | null {
  const i = composite.indexOf(SEP);
  if (i <= 0) return null;
  return { registryId: composite.slice(0, i), ref: composite.slice(i + SEP.length) };
}
```

- [ ] **Step 2: `/available` aggregates across enabled registries**, tagging each bundle:
```typescript
app.get('/api/marketplace/available', { preHandler: requireRole('lab_admin') }, async () => {
  const regs = await enabledRegistries();
  if (regs.length === 0) return { configured: false, bundles: [], source: null, host: null };
  const bundles: unknown[] = [];
  let firstError: string | undefined;
  for (const reg of regs) {
    try {
      const listing = await sourceFor(reg).list();
      for (const l of listing) {
        bundles.push({
          ref: packRef(reg.id, l.ref), id: l.id, version: l.version, type: l.type,
          publisher: l.publisher, description: l.description, license: l.license,
          summary: l.summary, signatureFingerprint: l.signatureFingerprint, valid: l.valid,
          registryId: reg.id, registryName: reg.name,
          versions: (l.versions ?? []).map((v) => ({ version: v.version, ref: packRef(reg.id, v.ref) })),
        });
      }
    } catch (e) { firstError = firstError ?? (e instanceof Error ? e.message : 'registry unreachable'); }
  }
  return { configured: true, source: regs.length === 1 ? regs[0].kind : 'multi', host: regs.length === 1 ? regs[0].name : `${regs.length} registries`, bundles, ...(firstError ? { error: firstError } : {}) };
});
```

- [ ] **Step 3: `/available/:ref` + `/install` unpack the composite ref**:

`/available/:ref`: `const parsed = unpackRef(decodeURIComponent((req.params as {ref:string}).ref));` → 400 if `!parsed`; resolve `const reg = (await registries.get(parsed.registryId)); if (!reg) 404`; `safeRef(parsed.ref)`; `const b = await sourceFor(reg).getBundle(ref)`; return as today but echo the **composite** `ref` (so the detail's install uses it).
`/install`: body `{ ref, acknowledgedCapabilities }` where `ref` is composite → `unpackRef` → resolve reg → `sourceFor(reg).getBundle(innerRef)` → install as today.

- [ ] **Step 4: `/refresh` refreshes all enabled** registries:
```typescript
app.post('/api/marketplace/refresh', { preHandler: requireRole('lab_admin') }, async () => {
  for (const reg of await enabledRegistries()) sourceFor(reg).refresh();
  return { ok: true };
});
```
(Note: `HttpRegistrySource.refresh()` clears that instance's cache; since instances are per-request, refresh is effectively a no-op across requests — acceptable. If a persistent cache is added later, refresh would target it.)

- [ ] **Step 5: Registries CRUD** (lab_admin), added to this file:
```typescript
const regInput = z.object({ name: z.string().min(1), kind: z.enum(['local', 'http']), location: z.string().min(1), enabled: z.boolean().optional() });
const regPatch = z.object({ name: z.string().min(1).optional(), kind: z.enum(['local', 'http']).optional(), location: z.string().min(1).optional(), enabled: z.boolean().optional() });

app.get('/api/marketplace/registries', { preHandler: requireRole('lab_admin') }, async () => registries.list());
app.post('/api/marketplace/registries', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
  const p = regInput.safeParse(req.body); if (!p.success) { reply.code(400); return { error: 'invalid registry' }; }
  const id = randomUUID();
  await registries.create({ id, ...p.data });
  return registries.get(id);
});
app.put('/api/marketplace/registries/:id', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const p = regPatch.safeParse(req.body); if (!p.success) { reply.code(400); return { error: 'invalid patch' }; }
  if (!(await registries.get(id))) { reply.code(404); return { error: 'registry not found' }; }
  await registries.update(id, p.data); return registries.get(id);
});
app.delete('/api/marketplace/registries/:id', { preHandler: requireRole('lab_admin') }, async (req) => {
  await registries.remove((req.params as { id: string }).id); return { ok: true };
});
```
Add imports: `import { randomUUID } from 'node:crypto';` and `import { z } from 'zod';` (if not already imported — check the file).

- [ ] **Step 6: Extend `marketplace-routes.test.ts`** — add registries CRUD coverage + that `/available` aggregates + tags `registryId`/`registryName` + composite ref round-trips through `/available/:ref`. READ the existing test's harness (how it builds `ctx`/registers routes + stubs the registry/source); add: create two registries via the CRUD route, assert `/available` returns bundles tagged with registryId and composite refs, and `/available/:compositeRef` resolves. If the test harness uses a real/stubbed source, adapt minimally — keep existing assertions green. (If the harness can't easily stub a filesystem registry, assert the CRUD + the empty-registries `configured:false` path + composite pack/unpack via a small unit test of `unpackRef`.)

- [ ] **Step 7: typecheck + test** — `pnpm turbo run typecheck --filter=@openldr/server` PASS; `pnpm -C apps/server test marketplace-routes` PASS.

- [ ] **Step 8: Commit**
```bash
git add apps/server/src/marketplace-routes.ts apps/server/src/marketplace-routes.test.ts
git commit -m "feat(marketplace): DB-backed registries — per-request multi-source aggregation + CRUD + composite refs (SP-C)"
```

---

### Task 4: Web — registries client + Registries UI + Browse source tag + i18n

**Files:** `apps/web/src/api.ts`, `apps/web/src/pages/settings/marketplace/util.ts`, `apps/web/src/pages/settings/marketplace/MarketplaceTabs.tsx`, a new `apps/web/src/pages/settings/marketplace/RegistriesTab.tsx` (+ test), `apps/web/src/i18n/{en,fr,pt}.ts`.

- [ ] **Step 1: api.ts** — add the registries client + the `registryName` display field:
```typescript
export interface MarketplaceRegistry { id: string; name: string; kind: 'local' | 'http'; location: string; enabled: boolean; createdAt: string; updatedAt: string }
export interface RegistryInput { name: string; kind: 'local' | 'http'; location: string; enabled?: boolean }
export const listRegistries = (): Promise<MarketplaceRegistry[]> => apiGet('/api/marketplace/registries', 'list registries');
export const createRegistry = (i: RegistryInput): Promise<MarketplaceRegistry> => authFetch('/api/marketplace/registries', jbody(i, 'POST')).then((r) => okJson<MarketplaceRegistry>(r, 'create registry'));
export const updateRegistry = (id: string, i: Partial<RegistryInput>): Promise<MarketplaceRegistry> => authFetch(`/api/marketplace/registries/${encodeURIComponent(id)}`, jbody(i, 'PUT')).then((r) => okJson<MarketplaceRegistry>(r, 'update registry'));
export async function deleteRegistry(id: string): Promise<void> { const r = await authFetch(`/api/marketplace/registries/${encodeURIComponent(id)}`, { method: 'DELETE' }); if (!r.ok && r.status !== 204) throw new Error(`delete registry failed: ${r.status}`); }
```
Add `registryName?: string;` to `AvailableArtifact` (the `ref`/`versions` are composite, opaque to the web — no other change). The version-switcher already passes `ref` opaquely; install already passes `ref` opaquely → both keep working with composite refs.

- [ ] **Step 2: util.ts** — add `registryName?: string;` to `CardEntry`; in `availableToEntry` add `registryName: b.registryName,`.

- [ ] **Step 3: RegistriesTab.tsx (TDD)** — a CRUD section modeled on `Connectors.tsx` (Table of name/kind/location/enabled + add/edit dialog with name, kind `Select` (local|http), location `Input` + enabled `Switch` + remove `ConfirmDialog`). Write `RegistriesTab.test.tsx` first (lists, create, toggle enabled, delete — mirror `Connectors.test.tsx`'s mock pattern), then implement. Use the `settings.marketplace.registr*` i18n keys (Step 5). Props: it self-loads via `listRegistries` and mutates via the client fns + a `onChanged` callback to let Browse refresh.

- [ ] **Step 4: MarketplaceTabs.tsx** — add a third tab "Registries" rendering `<RegistriesTab onChanged={onRefresh} />` (reuse the existing `onRefresh` to re-list Browse after a registry change). Tag Browse cards with their source registry: where a card renders, show `entry.registryName` (a small muted label/badge) when present. (READ the card component; add the label minimally.)

- [ ] **Step 5: i18n (en/fr/pt)** — add under `settings.marketplace`:
  - en: `registriesTab: 'Registries'`, `addRegistry: 'Add registry'`, `editRegistry: 'Edit registry'`, `registryName: 'Name'`, `registryKind: 'Type'`, `registryLocation: 'Location (URL or directory)'`, `registryEnabled: 'Enabled'`, `kindLocal: 'Local directory'`, `kindHttp: 'Remote (HTTP)'`, `removeRegistryTitle: 'Remove {{name}}?'`, `removeRegistryDescription: 'Stops listing bundles from this registry. Installed plugins are unaffected.'`, `registrySource: 'From {{name}}'`, `noRegistries: 'No registries configured. Add one to browse bundles.'`
  - fr/pt: translate equivalently (parity required — typecheck enforces it). Use natural FR/PT.

- [ ] **Step 6: typecheck + tests** — `pnpm -C apps/web typecheck` PASS; `pnpm -C apps/web test RegistriesTab Marketplace PackageDetail` PASS (existing marketplace tests still green — the composite refs are opaque to them).

- [ ] **Step 7: Commit**
```bash
git add apps/web/src/api.ts apps/web/src/pages/settings/marketplace apps/web/src/i18n
git commit -m "feat(web): Marketplace Registries management tab + source-tagged Browse cards (SP-C)"
```

---

### Task 5: Full gate + finish

- [ ] **Step 1: Gate** — `pnpm turbo run typecheck lint test build --force --continue && pnpm depcruise` (use `--force` per the turbo-cache lesson). Confirm all typecheck/lint/build pass fresh; re-run any failing `#test` suites isolated (known parallel-flake class: web/plugins/marketplace/audit). depcruise clean.
- [ ] **Step 2: Finish** — merge `feat/marketplace-vnext-sp-c-registries` → local `main` (ff), NOT pushed, remove branch; re-run the gate on main.
- [ ] **Step 3: Memory** — umbrella note: SP-C done (DB-backed multi-registry, in-app CRUD, no restart, aggregated Browse, env-seeded default). Next: SP-A1 → SP-A2.

---

## Self-Review

**Spec coverage (SP-C):** DB-backed `registries` table + store — Task 1; CRUD at `/api/marketplace/registries` lab_admin — Task 3.5; per-request resolution + no restart — Task 3.1-3.4; aggregate across enabled, tagged by source — Task 3.2 + Task 4.4; env → seed default — Task 2; security unchanged (signatures/TOFU/consent at install untouched — install still verifies the bundle) — confirmed (Task 3.3 reuses the existing install path). ✅
**Placeholder scan:** complete code for migration/store/routes/client; the UI tasks (3.6, 4.3, 4.4) carry explicit "READ + mirror Connectors/the card component" notes because they reuse existing patterns/files — concrete, not placeholders. fr/pt translations to be written by the implementer (parity gate enforces).
**Type consistency:** `RegistryRecord`/`RegistryStore` (Task 1) → `registries` store used in Tasks 2+3; `MarketplaceRegistry`/`RegistryInput` (web, Task 4) match the route shapes (Task 3.5); composite `ref` is a plain string everywhere (`packRef`/`unpackRef` in Task 3), opaque to the web. `registryName` added on `AvailableArtifact` (Task 4.1) + `CardEntry` (4.2) + emitted by `/available` (3.2).
**Scope note:** publish staging stays env-based (`MARKETPLACE_REGISTRY_DIR`) — out of scope for SP-C, unaffected. HTTP `refresh()` is per-request-instance (effectively no-op across requests) — acceptable; noted.
