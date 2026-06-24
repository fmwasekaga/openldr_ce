# DHIS2 Sink Plugin — SP-5a: Connector API (`/api/connectors`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `lab_admin`-gated connector CRUD + live "test connection" API: `GET/POST /api/connectors`, `GET/PUT/DELETE /api/connectors/:id`, `POST /api/connectors/:id/test`, plus `GET /api/connectors/sink-plugins` (the picker source). Secrets are write-only (never returned); the test endpoint resolves the connector → loads its sink → runs `health_check` + `pull_metadata` live.

**Architecture:** A new `connectors-routes.ts` mirrors `marketplace-routes.ts`/`dhis2-routes.ts`: `registerConnectorsRoutes(app, ctx, deps)` takes an injected `ConnectorStore` (created in `app.ts` from `ctx.internalDb`, like the dhis2 stores). The store (SP-3) already masks secrets on read and fail-closes on the encryption key. The test endpoint reuses `createPluginTarget` (SP-4) — exported from `@openldr/bootstrap` here — to wrap the loaded sink and call it live, restricted to the connector's `allowedHost`.

**Tech Stack:** Fastify, zod (input validation), TypeScript, vitest (`app.inject`). Builds on SP-3 (`createConnectorStore`) + SP-4 (`createPluginTarget`, `ctx.plugins.loadSink`, `ctx.cfg.SECRETS_ENCRYPTION_KEY`).

---

## Context for the implementer (read first)

This is **SP-5a** (the API half of SP-5 §L5; the web UI is SP-5b). SP-1..SP-4 are merged: the connector store, the wasm sink, the connector-resolved target, and the egress path all exist. SP-5a only adds the HTTP surface — it wires nothing into the workflow/DHIS2 admin pages (that's SP-5b).

**Established facts (verified — don't re-derive):**
- `createConnectorStore(db)` → `create(input, key)/get(id)/list()/update(id,patch,key)/remove(id)/getDecryptedConfig(id,key)`; `get`/`list` return `ConnectorRecord` (`{id,name,pluginId,kind,allowedHost,enabled,createdAt,updatedAt}`) with **no secret config**; `create`/`update`(config)/`getDecryptedConfig` throw `ConfigError` if the key is unset (SP-3, `packages/db/src/connector-store.ts`).
- `createPluginTarget(sink, config, allowedHost): ReportingTargetPort` with `healthCheck()/pullMetadata()/pushAggregate/pushEvents` (SP-4, `packages/bootstrap/src/connector-target.ts`). **Not yet exported from `@openldr/bootstrap`** — Task 1 Step 1 exports it.
- `ctx.plugins.loadSink(id, version?) => Promise<WasmSink | undefined>`, `ctx.plugins.list() => PluginRow[]` (PluginRow has `manifest: Record<string,unknown>`, `enabled`, `id`, `version`), `ctx.cfg.SECRETS_ENCRYPTION_KEY: string | undefined`, `ctx.internalDb: Kysely<InternalSchema>` (AppContext, `packages/bootstrap/src/index.ts`).
- A sink plugin's manifest has `kind: 'sink'` (flat) or `payload.pluginKind === 'sink'` (artifact) — SP-1.
- Route patterns: `registerXRoutes(app, ctx, ...)`, `{ preHandler: requireRole('lab_admin') }` from `./rbac`, `redact` from `@openldr/core`, `reply.code(4xx)` + `{ error }` (see `apps/server/src/marketplace-routes.ts` + `dhis2-routes.ts`). `app.ts` `buildApp` registers each (line ~72) and builds dhis2 stores from `ctx.internalDb`.
- Route test harness: a `fakeCtx` object cast to `AppContext` + a Fastify `onRequest` hook injecting `req.user.roles`, then `app.inject(...)` (see `apps/server/src/marketplace-routes.test.ts:53-67`).

**Egress note:** the test endpoint's `pullMetadata`/`healthCheck` are live HTTP calls — they go through `createPluginTarget`, which pins `[connector.allowedHost]`, so they take the runner's worker-path egress (restricted to that host). This is intended (a connection test must hit the real server).

---

## File Structure

**Created:**
- `apps/server/src/connectors-routes.ts` — `registerConnectorsRoutes(app, ctx, deps)` + the 7 routes.
- `apps/server/src/connectors-routes.test.ts` — inject-based route tests (CRUD, masking, fail-closed, test endpoint, role gate).

**Modified:**
- `packages/bootstrap/src/index.ts` — export `createPluginTarget` (+ its types) from `./connector-target`.
- `apps/server/src/app.ts` — import + register `registerConnectorsRoutes(app, ctx, { connectors: createConnectorStore(ctx.internalDb) })`.

---

## Task 1: Connector routes + wiring + tests

**Files:** Create `apps/server/src/connectors-routes.ts` + `apps/server/src/connectors-routes.test.ts`; Modify `packages/bootstrap/src/index.ts` + `apps/server/src/app.ts`.

- [ ] **Step 1: Export `createPluginTarget` from `@openldr/bootstrap`**

In `packages/bootstrap/src/index.ts`, add (near the other re-exports — search for `export ... from './dhis2-context'` and add after it):

```ts
export { createPluginTarget } from './connector-target';
```

Verify: `pnpm -C packages/bootstrap typecheck` exits 0.

- [ ] **Step 2: Write the failing route tests**

Create `apps/server/src/connectors-routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import type { ConnectorRecord, ConnectorStore, NewConnector, ConnectorPatch } from '@openldr/db';
import { registerConnectorsRoutes } from './connectors-routes';

// In-memory ConnectorStore matching the real masking + fail-closed contract.
function fakeStore(): ConnectorStore {
  const rows = new Map<string, { rec: ConnectorRecord; config: Record<string, string> }>();
  const requireKey = (key: string | undefined) => { if (!key) throw new Error('SECRETS_ENCRYPTION_KEY is required'); };
  return {
    async create(input: NewConnector, key) {
      requireKey(key);
      rows.set(input.id, {
        rec: { id: input.id, name: input.name, pluginId: input.pluginId, kind: input.kind, allowedHost: input.allowedHost ?? null, enabled: true, createdAt: new Date(), updatedAt: new Date() },
        config: input.config,
      });
    },
    async get(id) { return rows.get(id)?.rec ?? null; },
    async list() { return [...rows.values()].map((r) => r.rec); },
    async update(id, patch: ConnectorPatch, key) {
      const row = rows.get(id); if (!row) return;
      if (patch.config !== undefined) { requireKey(key); row.config = patch.config; }
      if (patch.name !== undefined) row.rec.name = patch.name;
      if (patch.allowedHost !== undefined) row.rec.allowedHost = patch.allowedHost;
      if (patch.enabled !== undefined) row.rec.enabled = patch.enabled;
    },
    async remove(id) { rows.delete(id); },
    async getDecryptedConfig(id, key) { requireKey(key); const r = rows.get(id); if (!r) throw new Error(`connector ${id} not found`); return r.config; },
  };
}

function fakeSink(metadataCounts = { dataElements: 2, orgUnits: 1, categoryOptionCombos: 1, programs: 0, programStages: 0 }) {
  return {
    id: 'dhis2-sink', version: '0.1.0', entrypoints: ['health_check', 'pull_metadata', 'push_aggregate', 'push_tracker'],
    invoke: async (ep: string) => {
      if (ep === 'health_check') return { ok: true, version: '2.40' };
      if (ep === 'pull_metadata') return { dataElements: Array(metadataCounts.dataElements).fill({ id: 'd', name: 'd' }), orgUnits: Array(metadataCounts.orgUnits).fill({ id: 'o', name: 'o' }), categoryOptionCombos: Array(metadataCounts.categoryOptionCombos).fill({ id: 'c', name: 'c' }), programs: [], programStages: [] };
      return {};
    },
  };
}

function fakeCtx(over: Partial<{ key: string | undefined; loadSink: (id: string) => Promise<unknown>; pluginRows: unknown[] }> = {}): AppContext {
  return {
    cfg: { SECRETS_ENCRYPTION_KEY: 'key' in over ? over.key : 'a'.repeat(44) },
    plugins: {
      loadSink: over.loadSink ?? (async () => fakeSink()),
      list: async () => over.pluginRows ?? [
        { id: 'dhis2-sink', version: '0.1.0', enabled: true, manifest: { kind: 'sink' } },
        { id: 'whonet-sqlite', version: '0.1.0', enabled: true, manifest: { kind: 'source' } },
      ],
    },
  } as unknown as AppContext;
}

function appWith(store: ConnectorStore, ctx: AppContext = fakeCtx(), roles: string[] = ['lab_admin']) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => { req.user = { id: 'admin', username: 'admin', displayName: null, roles } as never; });
  registerConnectorsRoutes(app, ctx, { connectors: store });
  return app;
}

const newBody = { name: 'DHIS2 Demo', pluginId: 'dhis2-sink', config: { baseUrl: 'https://dhis2.example/dhis', username: 'admin', password: 'district' } };

describe('connectors routes', () => {
  it('creates, lists (no secrets), and gets', async () => {
    const store = fakeStore();
    const app = appWith(store);
    const created = await app.inject({ method: 'POST', url: '/api/connectors', payload: newBody });
    expect(created.statusCode).toBe(200);
    const rec = created.json();
    expect(rec).toMatchObject({ name: 'DHIS2 Demo', pluginId: 'dhis2-sink', kind: 'sink', allowedHost: 'dhis2.example', enabled: true });
    expect(JSON.stringify(rec)).not.toContain('district'); // no secret leaked
    expect(rec).not.toHaveProperty('config');

    const list = await app.inject({ method: 'GET', url: '/api/connectors' });
    expect(list.json()).toHaveLength(1);
    expect(JSON.stringify(list.json())).not.toContain('district');

    const got = await app.inject({ method: 'GET', url: `/api/connectors/${rec.id}` });
    expect(got.json().name).toBe('DHIS2 Demo');
  });

  it('fails create with 400 when the encryption key is unset', async () => {
    const app = appWith(fakeStore(), fakeCtx({ key: undefined }));
    const res = await app.inject({ method: 'POST', url: '/api/connectors', payload: newBody });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/SECRETS_ENCRYPTION_KEY/);
  });

  it('rejects an invalid body with 400', async () => {
    const res = await appWith(fakeStore()).inject({ method: 'POST', url: '/api/connectors', payload: { name: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('updates (enabled + name) and deletes', async () => {
    const store = fakeStore();
    const app = appWith(store);
    const id = (await app.inject({ method: 'POST', url: '/api/connectors', payload: newBody })).json().id;
    const upd = await app.inject({ method: 'PUT', url: `/api/connectors/${id}`, payload: { name: 'Renamed', enabled: false } });
    expect(upd.statusCode).toBe(200);
    expect(upd.json()).toMatchObject({ name: 'Renamed', enabled: false });
    const del = await app.inject({ method: 'DELETE', url: `/api/connectors/${id}` });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/connectors' })).json()).toHaveLength(0);
  });

  it('lists only sink plugins', async () => {
    const res = await appWith(fakeStore()).inject({ method: 'GET', url: '/api/connectors/sink-plugins' });
    expect(res.json()).toEqual([{ id: 'dhis2-sink', version: '0.1.0', enabled: true }]);
  });

  it('test endpoint runs health_check + pull_metadata and returns a metadata summary', async () => {
    const store = fakeStore();
    const app = appWith(store);
    const id = (await app.inject({ method: 'POST', url: '/api/connectors', payload: newBody })).json().id;
    const res = await app.inject({ method: 'POST', url: `/api/connectors/${id}/test` });
    expect(res.json()).toEqual({ ok: true, metadata: { dataElements: 2, orgUnits: 1, categoryOptionCombos: 1, programs: 0, programStages: 0 } });
  });

  it('test endpoint returns ok:false when the sink plugin is not installed', async () => {
    const store = fakeStore();
    const app = appWith(store, fakeCtx({ loadSink: async () => undefined }));
    const id = (await app.inject({ method: 'POST', url: '/api/connectors', payload: newBody })).json().id;
    const res = await app.inject({ method: 'POST', url: `/api/connectors/${id}/test` });
    expect(res.json()).toMatchObject({ ok: false });
    expect(res.json().error).toMatch(/not installed/);
  });

  it('404s an unknown connector', async () => {
    expect((await appWith(fakeStore()).inject({ method: 'GET', url: '/api/connectors/nope' })).statusCode).toBe(404);
  });

  it('403s a non-admin', async () => {
    const res = await appWith(fakeStore(), fakeCtx(), ['lab_technician']).inject({ method: 'GET', url: '/api/connectors' });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm -C apps/server test connectors-routes`
Expected: FAIL — cannot import `./connectors-routes`.

- [ ] **Step 4: Implement the routes**

Create `apps/server/src/connectors-routes.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '@openldr/bootstrap';
import { createPluginTarget } from '@openldr/bootstrap';
import type { ConnectorStore } from '@openldr/db';
import { redact } from '@openldr/core';
import { requireRole } from './rbac';

export interface ConnectorsRouteDeps {
  connectors: ConnectorStore;
}

const createInput = z.object({
  name: z.string().min(1),
  pluginId: z.string().min(1),
  config: z.record(z.string()),
  allowedHost: z.string().optional(),
});
const updateInput = z.object({
  name: z.string().min(1).optional(),
  config: z.record(z.string()).optional(),
  allowedHost: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

/** Derive the egress host to pin from the connection config's baseUrl (an explicit
 *  allowedHost wins). Returns null when neither yields a host (egress stays default-deny). */
function hostFor(config: Record<string, string> | undefined, explicit: string | null | undefined): string | null {
  if (explicit !== undefined) return explicit && explicit.length > 0 ? explicit : null;
  const base = config?.baseUrl;
  if (!base) return null;
  try {
    return new URL(base).hostname || null;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerConnectorsRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext, deps: ConnectorsRouteDeps): void {
  const { connectors } = deps;
  const key = (): string | undefined => ctx.cfg.SECRETS_ENCRYPTION_KEY;

  // Installed sink plugins, for the "pick a plugin" dropdown.
  app.get('/api/connectors/sink-plugins', { preHandler: requireRole('lab_admin') }, async () => {
    const rows = await ctx.plugins.list();
    return rows
      .filter((r) => {
        const m = r.manifest as { kind?: string; payload?: { pluginKind?: string } };
        return m.kind === 'sink' || m.payload?.pluginKind === 'sink';
      })
      .map((r) => ({ id: r.id, version: r.version, enabled: r.enabled }));
  });

  app.get('/api/connectors', { preHandler: requireRole('lab_admin') }, async () => connectors.list());

  app.get('/api/connectors/:id', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = await connectors.get(id);
    if (!c) { reply.code(404); return { error: 'connector not found' }; }
    return c;
  });

  app.post('/api/connectors', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const parsed = createInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: 'invalid connector input' }; }
    const { name, pluginId, config, allowedHost } = parsed.data;
    const id = randomUUID();
    try {
      await connectors.create({ id, name, pluginId, kind: 'sink', config, allowedHost: hostFor(config, allowedHost) }, key());
    } catch (e) {
      reply.code(400);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
    return connectors.get(id);
  });

  app.put('/api/connectors/:id', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: 'invalid connector patch' }; }
    if (!(await connectors.get(id))) { reply.code(404); return { error: 'connector not found' }; }
    const patch = parsed.data;
    // Re-derive the pinned host when the config (baseUrl) changes, unless explicitly given.
    const allowedHost = patch.config !== undefined ? hostFor(patch.config, patch.allowedHost) : patch.allowedHost;
    try {
      await connectors.update(id, { name: patch.name, config: patch.config, enabled: patch.enabled, allowedHost }, key());
    } catch (e) {
      reply.code(400);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
    return connectors.get(id);
  });

  app.delete('/api/connectors/:id', { preHandler: requireRole('lab_admin') }, async (req) => {
    const { id } = req.params as { id: string };
    await connectors.remove(id);
    return { ok: true };
  });

  // Live connection test: resolve → loadSink → health_check + pull_metadata (restricted to allowedHost).
  app.post('/api/connectors/:id/test', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const connector = await connectors.get(id);
    if (!connector) { reply.code(404); return { error: 'connector not found' }; }
    try {
      const config = await connectors.getDecryptedConfig(id, key());
      const sink = await ctx.plugins.loadSink(connector.pluginId);
      if (!sink) return { ok: false, error: `sink plugin '${connector.pluginId}' is not installed` };
      const target = createPluginTarget(sink, config, connector.allowedHost);
      const health = await target.healthCheck();
      if (health.status !== 'up') return { ok: false, error: health.detail ?? 'unreachable' };
      const md = await target.pullMetadata();
      return {
        ok: true,
        metadata: {
          dataElements: md.dataElements.length,
          orgUnits: md.orgUnits.length,
          categoryOptionCombos: md.categoryOptionCombos.length,
          programs: md.programs?.length ?? 0,
          programStages: md.programStages?.length ?? 0,
        },
      };
    } catch (e) {
      return { ok: false, error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm -C apps/server test connectors-routes`
Expected: PASS (10 tests). If `z.record(z.string())` typing complains, ensure `zod` is a dep of `apps/server` (it is used by other route files); otherwise import `z` the same way `marketplace-routes.ts` does.

- [ ] **Step 6: Register the routes in `app.ts`**

In `apps/server/src/app.ts`:
(a) Add imports (with the other route imports + the db import on line 19):
```ts
import { registerConnectorsRoutes } from './connectors-routes';
```
and add `createConnectorStore` to the existing `@openldr/db` import (line 19):
```ts
import { createDhis2MetadataCache, createOrgUnitMapStore, createMappingStore, createScheduleStore, createConnectorStore } from '@openldr/db';
```
(b) Register it in `buildApp` after `registerMarketplaceRoutes(app, ctx);` (line ~72):
```ts
  registerConnectorsRoutes(app, ctx, { connectors: createConnectorStore(ctx.internalDb) });
```

- [ ] **Step 7: Typecheck the server**

Run: `pnpm -C apps/server typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/connectors-routes.ts apps/server/src/connectors-routes.test.ts apps/server/src/app.ts packages/bootstrap/src/index.ts
git commit -m "$(cat <<'EOF'
feat(server): /api/connectors CRUD + live test endpoint (lab_admin)

GET/POST list+create, GET/PUT/DELETE :id, POST :id/test (resolve -> loadSink ->
health_check + pull_metadata, restricted to the connector's allowedHost), and
GET sink-plugins for the picker. Secrets are write-only: the store masks config on
read, the key fail-closes on create/update/decrypt. allowedHost is derived from the
config baseUrl. Exports createPluginTarget from @openldr/bootstrap for the test path.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Full gate

**Files:** none.

- [ ] **Step 1:** `pnpm typecheck && pnpm lint && pnpm test` → green (isolate `@openldr/web#test` if it flakes; never pipe turbo through `tail`).
- [ ] **Step 2:** `pnpm depcruise` → clean. (`apps/server` already depends on `@openldr/bootstrap`/`@openldr/db`/`@openldr/core`; the new `createPluginTarget` import adds no new package edge.)
- [ ] **Step 3:** Final commit if anything was adjusted.

---

## Self-Review

**Spec coverage (SP-5 §L5 API):**
- `GET/POST /api/connectors`, `GET/PUT/DELETE /api/connectors/:id`, `POST /api/connectors/:id/test`, all `lab_admin`-gated → Task 1 Step 4. ✓
- `list()` masks secrets (store-enforced; tests assert no `config`/plaintext in list/get/create responses) → Task 1. ✓
- Secrets write-only: `config` accepted on POST/PUT, never returned; PUT without `config` leaves the secret untouched (store contract) → Task 1. ✓
- Test endpoint = live `health_check` + `pull_metadata` → metadata summary → Task 1 Step 4. ✓
- `GET /api/connectors/sink-plugins` to populate the picker (SP-5b) → Task 1 Step 4. ✓

**Correctly deferred to SP-5b (UI):** the Settings ▸ Connectors page, the web `api.ts` client functions, the mapping-editor connector picker, the workflow `dhis2-push` node picker + Test button, i18n. SP-5a is server-only.

**Placeholder scan:** complete code for the routes + tests; exact edits for app.ts + bootstrap export. No TBD.

**Type consistency:** `ConnectorsRouteDeps.connectors: ConnectorStore` matches `createConnectorStore(ctx.internalDb)` in app.ts. `createPluginTarget(sink, config, allowedHost)` matches SP-4. The test endpoint's `health.status !== 'up'` matches `HealthResult`. `hostFor` returns `string | null` matching `NewConnector.allowedHost`/`ConnectorPatch.allowedHost`. Route input zod shapes match the store's `NewConnector`/`ConnectorPatch`.

---

## Notes for execution

- Branch `feat/dhis2-sink-sp5a` (merge to local `main`, not pushed).
- After SP-5a merges, update the `dhis2-sink-plugin-workstream` memory: SP-5a (connector API) done; next is **SP-5b** (the web UI: Settings ▸ Connectors page + `api.ts` client + mapping-editor/workflow-node connector pickers + i18n; also the deferred docs sweep for the removed `DHIS2_*` vars) then **SP-6** (live Docker DHIS2 e2e).
