# Slice D — Connector Foundation + SQL Reference Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the plugin-coupled Connector model to support host/native (database) connectors, and prove it end-to-end with `postgres` and `microsoft-sql` workflow nodes.

**Architecture:** Additive migration makes `connectors.plugin_id` nullable and adds a `type` column. A new `runConnectorSql` host service (bootstrap) resolves+decrypts a connector, builds an ephemeral Kysely connection via the existing pg/mssql adapter factories (through a shared `createConnectorDb` helper), runs the SQL, and closes. One shared `connector-sql` handler backs both `postgres` and `microsoft-sql` nodes, which differ only by a typed connector picker (`optionsSource: 'connectors:<type>'`). The Connectors settings page becomes type-aware (plugin vs database, data-driven credential fields).

**Tech Stack:** TypeScript, Vitest, Kysely, `@openldr/db` (connector store + migrations), `@openldr/core` (AES-256-GCM), `adapter-db-store` (pg), `adapter-mssql-store` (tedious), `@openldr/workflows`, `@openldr/bootstrap`, React + shadcn + i18n (web).

---

## Key facts (verified in code)

- **Connector store** (`packages/db/src/connector-store.ts`): `NewConnector { id, name, pluginId, kind, config, allowedHost? }`, `ConnectorRecord { id, name, pluginId, kind, allowedHost, enabled, createdAt, updatedAt }`. `SAFE_COLUMNS` excludes ciphertext. `create` inserts `plugin_id`; `toRecord` maps columns; crypto via `seal`/`open`/`parseSecretKey` (`@openldr/core`). Tests use `makeMigratedDb()` from `./migrations/internal/test-helpers`.
- **Migration pattern** (`packages/db/src/migrations/internal/033_connectors.ts`): Kysely `db.schema`. Highest internal migration is `036`; **next is `037`**. `makeMigratedDb()` runs all migrations, so the store test exercises the new one.
- **Schema type** (`packages/db/src/schema/internal.ts`): `ConnectorsTable` (id, name, plugin_id, kind, config_encrypted, allowed_host, enabled, created_at, updated_at).
- **Adapter factories:** `createDbStore({ url: string })` → `{ db, close }` (pg); `createMssqlStore({ host, port, database, user, password, encrypt, trustServerCertificate })` → `{ db, close }` (tedious). Both expose `db: Kysely<TargetSchema>`. Raw query: `sql.raw(userSql).execute(db)` → `{ rows }`.
- **WorkflowServices** (`packages/workflows/src/engine/services.ts`): `SqlResult { columns: {key,label}[]; rows: Record<string,unknown>[] }`. Action dispatch via `ACTION_HANDLERS[node.data.action]`. Config UI auto-renders from `HOST_NODE_DESCRIPTORS` whose `id === action`. **Every descriptor config field MUST set `required: true|false`** (non-optional type — omission fails `tsc`).
- **Options resolver** (`apps/server/src/workflows-node-options.ts`): `resolveNodeOptions(source, deps, opts)`; `NodeOptionsDeps.connectors.list()` currently returns `{id,name,pluginId}`.
- **Connectors routes** (`apps/server/src/connectors-routes.ts`): `createInput` zod requires `pluginId`; create hardcodes `kind:'sink'` + derives host from `config.baseUrl`; `/:id/test` does DHIS2 `loadSink`+`pullMetadata`. `requireRole('lab_admin')` on all.
- **Connectors UI** (`apps/web/src/pages/settings/Connectors.tsx`): shadcn + i18n; `DraftState { id, name, pluginId, baseUrl, username, password, enabled }`; create payload `{ name, pluginId, config }`. "Add" disabled when no sink plugins. Test-result rendering assumes DHIS2 metadata.
- **bootstrap wiring** (`packages/bootstrap/src/index.ts`): `workflowServices` literal ≈ lines 328-382; `const connectorStore = createConnectorStore(internal.db)` ≈ line 402 (AFTER workflowServices). `cfg.SECRETS_ENCRYPTION_KEY` available.

## Test commands

- db: `pnpm -C packages/db exec vitest run <path>`
- workflows: `pnpm -C packages/workflows exec vitest run <path>`
- bootstrap: `pnpm -C packages/bootstrap exec vitest run <path>`
- server: `pnpm -C apps/server exec vitest run <path>`
- typecheck a package: `pnpm -C <pkg> exec tsc --noEmit`
- web tests (isolated): `pnpm -C apps/web test`

## File structure

- **Create:** `packages/db/src/migrations/internal/037_connectors_host_type.ts`; `packages/bootstrap/src/connector-db.ts` (+test); `packages/bootstrap/src/connector-sql-service.ts` (+test); `packages/workflows/src/engine/node-handlers/connector-sql.ts` (+test).
- **Modify:** `packages/db/src/schema/internal.ts`, `packages/db/src/connector-store.ts` (+`connector-store.test.ts`), `packages/workflows/src/engine/services.ts`, `packages/bootstrap/src/index.ts`, `packages/bootstrap/src/index.ts` exports (or package index) for `createConnectorDb`, `packages/workflows/src/engine/node-handlers/index.ts`, `packages/workflows/src/host-nodes.ts`, `apps/web/src/workflows/constants.ts`, `apps/server/src/workflows-node-options.ts` (+test), `apps/server/src/connectors-routes.ts` (+test), `apps/web/src/api.ts`, `apps/web/src/pages/settings/Connectors.tsx`, web i18n locale files.

---

## Task 1: Migration + schema type (nullable plugin_id + `type`)

**Files:** Create `packages/db/src/migrations/internal/037_connectors_host_type.ts`; Modify `packages/db/src/schema/internal.ts`.

- [ ] **Step 1: Write the migration.** Create `packages/db/src/migrations/internal/037_connectors_host_type.ts`:

```typescript
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('connectors').alterColumn('plugin_id', (c) => c.dropNotNull()).execute();
  await db.schema.alterTable('connectors').addColumn('type', 'text').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('connectors').dropColumn('type').execute();
  // Note: plugin_id NOT NULL is not restored (would fail if host-typed rows exist); acceptable for a down.
}
```

- [ ] **Step 2: Register the migration if needed.** Check how `036_dhis2_to_plugin_data.ts` is registered (look for an explicit migrations map/index in `packages/db/src/migrations/internal/`). If migrations are listed explicitly, add `037` the same way; if auto-discovered from the directory, no edit is needed.

- [ ] **Step 3: Update the schema type.** In `packages/db/src/schema/internal.ts`, change the `ConnectorsTable` interface: make `plugin_id` nullable and add `type`:

```typescript
  plugin_id: string | null;
  type: string | null;
```

(Leave the other columns as-is.)

- [ ] **Step 4: Typecheck the db package.**

Run: `pnpm -C packages/db exec tsc --noEmit`
Expected: errors in `connector-store.ts` (it doesn't handle the new nullable/column yet) — that's fixed in Task 2. If the ONLY errors are in `connector-store.ts`, proceed; otherwise fix the schema type.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/internal/037_connectors_host_type.ts packages/db/src/schema/internal.ts
git commit -m "feat(db): connectors migration — nullable plugin_id + type column"
```

---

## Task 2: Connector store — `type` + nullable plugin

**Files:** Modify `packages/db/src/connector-store.ts`; `packages/db/src/connector-store.test.ts`.

- [ ] **Step 1: Write the failing test.** Append to `packages/db/src/connector-store.test.ts`:

```typescript
describe('connector store — host connectors', () => {
  it('creates and round-trips a host (typed, plugin-less) connector', async () => {
    const db = await makeMigratedDb();
    const store = createConnectorStore(db);
    const dbCfg = { host: 'db.internal', port: '5432', database: 'lab', user: 'svc', password: 's3cr3t' };
    await store.create({ id: 'h1', name: 'Lab PG', type: 'postgres', kind: 'database', config: dbCfg }, key);

    const r = await store.get('h1');
    expect(r).toMatchObject({ name: 'Lab PG', type: 'postgres', kind: 'database', pluginId: null, allowedHost: null });
    expect(JSON.stringify(r)).not.toContain('s3cr3t');
    expect(await store.getDecryptedConfig('h1', key)).toEqual(dbCfg);
    await db.destroy();
  });

  it('keeps type null for a plugin connector', async () => {
    const db = await makeMigratedDb();
    const store = createConnectorStore(db);
    await store.create({ id: 'p1', name: 'D', pluginId: 'dhis2-sink', kind: 'sink', config: cfg }, key);
    expect((await store.get('p1'))?.type).toBeNull();
    await db.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/db exec vitest run src/connector-store.test.ts`
Expected: FAIL (type not on record; create rejects `type`).

- [ ] **Step 3: Update the store.** In `packages/db/src/connector-store.ts`:

Add `type` to the two interfaces and make plugin optional:

```typescript
export interface ConnectorRecord {
  id: string;
  name: string;
  pluginId: string | null;
  type: string | null;
  kind: string;
  allowedHost: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewConnector {
  id: string;
  name: string;
  pluginId?: string | null;
  type?: string | null;
  kind: string;
  config: Record<string, string>;
  allowedHost?: string | null;
}
```

Add `'type'` to `SAFE_COLUMNS`:

```typescript
const SAFE_COLUMNS = ['id', 'name', 'plugin_id', 'type', 'kind', 'allowed_host', 'enabled', 'created_at', 'updated_at'] as const;
```

Update `toRecord`'s param type + mapping:

```typescript
function toRecord(r: {
  id: string; name: string; plugin_id: string | null; type: string | null; kind: string;
  allowed_host: string | null; enabled: boolean; created_at: Date; updated_at: Date;
}): ConnectorRecord {
  return {
    id: r.id, name: r.name, pluginId: r.plugin_id, type: r.type, kind: r.kind,
    allowedHost: r.allowed_host, enabled: r.enabled, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
```

Update `create`'s insert values:

```typescript
      await db.insertInto('connectors').values({
        id: input.id, name: input.name, plugin_id: input.pluginId ?? null, type: input.type ?? null, kind: input.kind,
        config_encrypted: sealed, allowed_host: input.allowedHost ?? null,
      }).execute();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/db exec vitest run src/connector-store.test.ts`
Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Typecheck db.**

Run: `pnpm -C packages/db exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/connector-store.ts packages/db/src/connector-store.test.ts
git commit -m "feat(db): connector store supports host type + nullable plugin"
```

---

## Task 3: `createConnectorDb` helper (bootstrap)

A type → ephemeral Kysely connection with a `query`/`close` surface (hides Kysely, easy to mock). Used by the SQL runner and the route test.

**Files:** Create `packages/bootstrap/src/connector-db.ts` + `packages/bootstrap/src/connector-db.test.ts`; export it from the bootstrap package entry.

- [ ] **Step 1: Write the failing test.** Create `packages/bootstrap/src/connector-db.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createConnectorDb } from './connector-db';

describe('createConnectorDb', () => {
  it('builds a postgres connection object with query + close', () => {
    const conn = createConnectorDb('postgres', { host: 'h', port: '5432', database: 'd', user: 'u', password: 'p' });
    expect(typeof conn.query).toBe('function');
    expect(typeof conn.close).toBe('function');
  });

  it('builds a microsoft-sql connection object', () => {
    const conn = createConnectorDb('microsoft-sql', { host: 'h', port: '1433', database: 'd', user: 'u', password: 'p' });
    expect(typeof conn.query).toBe('function');
  });

  it('throws on an unsupported type', () => {
    expect(() => createConnectorDb('mongodb', {})).toThrow(/unsupported connector type/);
  });
});
```

> These construct pools lazily (no network until `query`), so they don't need a live DB. Do NOT call `.query()` here (that would connect).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/bootstrap exec vitest run src/connector-db.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper.** Create `packages/bootstrap/src/connector-db.ts`:

```typescript
import { sql } from 'kysely';
import { createDbStore } from '@openldr/adapter-db-store';
import { createMssqlStore } from '@openldr/adapter-mssql-store';

/** A connector-backed DB connection: run one raw query, then close. */
export interface ConnectorDb {
  query(rawSql: string): Promise<{ rows: Record<string, unknown>[] }>;
  close(): Promise<void>;
}

/** Build an ephemeral DB connection for a host connector by type + decrypted config.
 *  Caller MUST call close() (use try/finally). */
export function createConnectorDb(type: string, config: Record<string, string>): ConnectorDb {
  if (type === 'postgres') {
    const ssl = config.ssl === 'true';
    const url = `postgresql://${encodeURIComponent(config.user ?? '')}:${encodeURIComponent(config.password ?? '')}@${config.host ?? 'localhost'}:${config.port ?? '5432'}/${encodeURIComponent(config.database ?? '')}${ssl ? '?sslmode=require' : ''}`;
    const store = createDbStore({ url });
    return {
      async query(rawSql) { const r = await sql.raw(rawSql).execute(store.db); return { rows: r.rows as Record<string, unknown>[] }; },
      close: () => store.close(),
    };
  }
  if (type === 'microsoft-sql') {
    const store = createMssqlStore({
      host: config.host ?? 'localhost',
      port: Number(config.port ?? 1433),
      database: config.database ?? '',
      user: config.user ?? '',
      password: config.password ?? '',
      encrypt: config.encrypt !== 'false',
      trustServerCertificate: config.trustServerCertificate === 'true',
    });
    return {
      async query(rawSql) { const r = await sql.raw(rawSql).execute(store.db); return { rows: r.rows as Record<string, unknown>[] }; },
      close: () => store.close(),
    };
  }
  throw new Error(`unsupported connector type: ${type}`);
}
```

- [ ] **Step 4: Export from the bootstrap entry.** In `packages/bootstrap/src/index.ts` add an export so apps/server can import it:

```typescript
export { createConnectorDb, type ConnectorDb } from './connector-db';
```

(Place with the other re-exports near the top/bottom of the file, matching the existing `export { createPluginTarget }` style.)

- [ ] **Step 5: Verify `@openldr/adapter-db-store` and `@openldr/adapter-mssql-store` are dependencies of bootstrap.** Check `packages/bootstrap/package.json`; if either is missing from `dependencies`, add it as `"workspace:*"` and run `pnpm install`.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm -C packages/bootstrap exec vitest run src/connector-db.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src/connector-db.ts packages/bootstrap/src/connector-db.test.ts packages/bootstrap/src/index.ts packages/bootstrap/package.json
git commit -m "feat(bootstrap): createConnectorDb (pg/mssql ephemeral connection helper)"
```

---

## Task 4: `runConnectorSql` service + wiring

**Files:** Create `packages/bootstrap/src/connector-sql-service.ts` + test; Modify `packages/workflows/src/engine/services.ts`, `packages/bootstrap/src/index.ts`.

- [ ] **Step 1: Add the optional service method.** In `packages/workflows/src/engine/services.ts`, inside `WorkflowServices` (after `runConnectorSql`'s siblings, e.g. near `loadDataset`):

```typescript
  /** Run a raw SQL query against a host database connector → rows. Host-injected (database nodes). */
  runConnectorSql?(input: { connectorId: string; sql: string }): Promise<SqlResult>;
```

- [ ] **Step 2: Write the failing service test.** Create `packages/bootstrap/src/connector-sql-service.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createConnectorSqlRunner } from './connector-sql-service';

const connectorsFake = (rec: unknown) => ({
  get: vi.fn(async () => rec as never),
  getDecryptedConfig: vi.fn(async () => ({ host: 'h', port: '5432', database: 'd', user: 'u', password: 'p' })),
});

describe('createConnectorSqlRunner', () => {
  it('resolves + decrypts + queries + closes (rows → SqlResult)', async () => {
    let closed = false;
    const createDb = vi.fn(() => ({ query: async () => ({ rows: [{ a: 1, b: 'x' }] }), close: async () => { closed = true; } }));
    const run = createConnectorSqlRunner({ connectors: connectorsFake({ type: 'postgres', enabled: true }), secretsKey: 'k', createDb });
    const res = await run({ connectorId: 'h1', sql: 'select 1' });
    expect(res.rows).toEqual([{ a: 1, b: 'x' }]);
    expect(res.columns).toEqual([{ key: 'a', label: 'a' }, { key: 'b', label: 'b' }]);
    expect(createDb).toHaveBeenCalledWith('postgres', expect.objectContaining({ host: 'h' }));
    expect(closed).toBe(true);
  });

  it('closes the connection even when the query throws', async () => {
    let closed = false;
    const createDb = vi.fn(() => ({ query: async () => { throw new Error('boom'); }, close: async () => { closed = true; } }));
    const run = createConnectorSqlRunner({ connectors: connectorsFake({ type: 'postgres', enabled: true }), secretsKey: 'k', createDb });
    await expect(run({ connectorId: 'h1', sql: 'x' })).rejects.toThrow('boom');
    expect(closed).toBe(true);
  });

  it('throws for a missing/disabled connector', async () => {
    const run = createConnectorSqlRunner({ connectors: connectorsFake(null), secretsKey: 'k', createDb: vi.fn() });
    await expect(run({ connectorId: 'x', sql: 's' })).rejects.toThrow(/not found or disabled/);
  });

  it('throws when the connector has no host type', async () => {
    const run = createConnectorSqlRunner({ connectors: connectorsFake({ type: null, enabled: true }), secretsKey: 'k', createDb: vi.fn() });
    await expect(run({ connectorId: 'p1', sql: 's' })).rejects.toThrow(/not a database connector/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -C packages/bootstrap exec vitest run src/connector-sql-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the service.** Create `packages/bootstrap/src/connector-sql-service.ts`:

```typescript
import type { SqlResult } from '@openldr/workflows';
import { createConnectorDb, type ConnectorDb } from './connector-db';

export interface ConnectorSqlDeps {
  connectors: {
    get(id: string): Promise<{ type: string | null; enabled: boolean } | null>;
    getDecryptedConfig(id: string, key: string | undefined): Promise<Record<string, string>>;
  };
  secretsKey: string | undefined;
  /** Injectable for tests; defaults to the real createConnectorDb. */
  createDb?: (type: string, config: Record<string, string>) => ConnectorDb;
}

/** Build the runConnectorSql implementation: resolve a host connector, decrypt its config,
 *  open an ephemeral connection, run the raw SQL, and always close. */
export function createConnectorSqlRunner(deps: ConnectorSqlDeps) {
  const make = deps.createDb ?? createConnectorDb;
  return async ({ connectorId, sql }: { connectorId: string; sql: string }): Promise<SqlResult> => {
    const c = await deps.connectors.get(connectorId);
    if (!c || !c.enabled) throw new Error(`connector ${connectorId} not found or disabled`);
    if (!c.type) throw new Error(`connector ${connectorId} is not a database connector`);
    const config = await deps.connectors.getDecryptedConfig(connectorId, deps.secretsKey);
    const conn = make(c.type, config);
    try {
      const { rows } = await conn.query(sql);
      const columns = rows[0] ? Object.keys(rows[0]).map((k) => ({ key: k, label: k })) : [];
      return { columns, rows };
    } finally {
      await conn.close();
    }
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C packages/bootstrap exec vitest run src/connector-sql-service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Wire into workflowServices.** In `packages/bootstrap/src/index.ts`:
  1. Move `const connectorStore = createConnectorStore(internal.db);` to BEFORE the `const workflowServices: WorkflowServices = {` literal (it only needs `internal.db`). Remove the later duplicate declaration.
  2. Add the import: `import { createConnectorSqlRunner } from './connector-sql-service';`.
  3. Before the `workflowServices` literal: `const connectorSqlRunner = createConnectorSqlRunner({ connectors: connectorStore, secretsKey: cfg.SECRETS_ENCRYPTION_KEY });`.
  4. Inside the `workflowServices` literal, add: `runConnectorSql: (input) => connectorSqlRunner(input),`.

- [ ] **Step 7: Typecheck both packages.**

Run: `pnpm -C packages/workflows exec tsc --noEmit && pnpm -C packages/bootstrap exec tsc --noEmit`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/services.ts packages/bootstrap/src/connector-sql-service.ts packages/bootstrap/src/connector-sql-service.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): runConnectorSql workflow service"
```

---

## Task 5: `connector-sql` handler + `postgres`/`microsoft-sql` nodes

**Files:** Create `packages/workflows/src/engine/node-handlers/connector-sql.ts` + test; Modify `node-handlers/index.ts`, `host-nodes.ts`, `apps/web/src/workflows/constants.ts`.

- [ ] **Step 1: Write the failing test.** Create `packages/workflows/src/engine/node-handlers/connector-sql.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { connectorSqlHandler } from './connector-sql';
import { createContext } from '../execution-context';

function fakeCtx(rows: Record<string, unknown>[]) {
  const calls: Array<{ connectorId: string; sql: string }> = [];
  const services = {
    runConnectorSql: async (input: { connectorId: string; sql: string }) => { calls.push(input); return { columns: [], rows }; },
  } as unknown as import('../services').WorkflowServices;
  return { ctx: createContext(undefined, () => {}, [], undefined, services), calls };
}
const node = (cfg: Record<string, unknown>) => ({ id: 'pg1', type: 'action', data: { action: 'postgres', config: cfg } });

describe('connectorSqlHandler', () => {
  it('runs the connector SQL and maps rows to items', async () => {
    const { ctx, calls } = fakeCtx([{ id: 1 }, { id: 2 }]);
    const result = await connectorSqlHandler(node({ connectorId: 'c1', sql: 'select id from t' }), ctx, []);
    expect(calls).toEqual([{ connectorId: 'c1', sql: 'select id from t' }]);
    expect(result).toEqual([{ json: { id: 1 } }, { json: { id: 2 } }]);
  });

  it('resolves {{ }} templates in the SQL against upstream items', async () => {
    const { ctx, calls } = fakeCtx([]);
    await connectorSqlHandler(node({ connectorId: 'c1', sql: 'select * from t where b = {{ $json.batch }}' }), ctx, [{ json: { batch: 'B7' } }]);
    expect(calls[0].sql).toBe('select * from t where b = B7');
  });

  it('throws when the connector is missing', async () => {
    const { ctx } = fakeCtx([]);
    await expect(connectorSqlHandler(node({ connectorId: '', sql: 'select 1' }), ctx, [])).rejects.toThrow(/connector is required/);
  });

  it('throws when SQL is empty', async () => {
    const { ctx } = fakeCtx([]);
    await expect(connectorSqlHandler(node({ connectorId: 'c1', sql: '' }), ctx, [])).rejects.toThrow(/SQL query is required/);
  });

  it('throws when services are absent', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(connectorSqlHandler(node({ connectorId: 'c1', sql: 'select 1' }), ctx, [])).rejects.toThrow(/requires server services/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/connector-sql.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler.** Create `packages/workflows/src/engine/node-handlers/connector-sql.ts`:

```typescript
import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';
import { rowsToItems } from '../items';

/** Run a raw SQL query against a host database connector (postgres / microsoft-sql).
 *  The connector's type drives the dialect server-side, so this handler is dialect-agnostic. */
export const connectorSqlHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.runConnectorSql) throw new Error('Database node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const connectorId = (config.connectorId as string) ?? '';
  if (!connectorId) throw new Error('Database node: a connector is required');
  const sql = resolveTemplate(String(config.sql ?? ''), ctx, input);
  if (!sql.trim()) throw new Error('Database node: SQL query is required');
  const result = await ctx.services.runConnectorSql({ connectorId, sql });
  return rowsToItems(result.rows);
};
```

- [ ] **Step 4: Register for both node ids.** In `node-handlers/index.ts` add the import and two `ACTION_HANDLERS` entries:

```typescript
import { connectorSqlHandler } from './connector-sql';
```
```typescript
  'postgres': connectorSqlHandler,
  'microsoft-sql': connectorSqlHandler,
```

- [ ] **Step 5: Add descriptors.** In `host-nodes.ts`:

```typescript
  { id: 'postgres', source: 'host', label: 'Postgres', kind: 'transform', description: 'Run SQL on a Postgres connector.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'connectorId', label: 'Connector', type: 'select', required: true, optionsSource: 'connectors:postgres' }, { key: 'sql', label: 'SQL', type: 'text', required: true }] },
  { id: 'microsoft-sql', source: 'host', label: 'Microsoft SQL', kind: 'transform', description: 'Run SQL on a Microsoft SQL connector.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'connectorId', label: 'Connector', type: 'select', required: true, optionsSource: 'connectors:microsoft-sql' }, { key: 'sql', label: 'SQL', type: 'text', required: true }] },
```

- [ ] **Step 6: Palette + enable.** In `apps/web/src/workflows/constants.ts` replace the `postgres` and `microsoft-sql` entries (Databases category) with default config, and add both ids to `IMPLEMENTED_TEMPLATE_IDS` (new `// databases (slice D)` line):

```typescript
      node('postgres', 'action', 'Postgres', 'Database', 'Run SQL on Postgres', {
        data: { config: { connectorId: '', sql: '' } },
      }),
```
```typescript
      node('microsoft-sql', 'action', 'Microsoft SQL', 'Database', 'Run queries on MSSQL', {
        data: { config: { connectorId: '', sql: '' } },
      }),
```
```typescript
  // databases (slice D)
  'postgres', 'microsoft-sql',
```

- [ ] **Step 7: Run test + typecheck.**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/connector-sql.test.ts && pnpm -C packages/workflows exec tsc --noEmit`
Expected: tests PASS (5), tsc exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/connector-sql.ts packages/workflows/src/engine/node-handlers/connector-sql.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): postgres + microsoft-sql connector-sql nodes"
```

---

## Task 6: Typed `connectors:<type>` options resolver

**Files:** Modify `apps/server/src/workflows-node-options.ts`; its test file (find `workflows-node-options.test.ts`; if absent, create it).

- [ ] **Step 1: Write the failing test.** In `apps/server/src/workflows-node-options.test.ts` (create if missing) add:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveNodeOptions } from './workflows-node-options';

const deps = {
  connectors: { list: async () => [
    { id: 'a', name: 'PG One', pluginId: null, type: 'postgres' },
    { id: 'b', name: 'MSSQL', pluginId: null, type: 'microsoft-sql' },
    { id: 'c', name: 'DHIS2', pluginId: 'dhis2-sink', type: null },
  ] },
  datasets: { list: async () => [] },
  dhis2Mappings: async () => [],
  forms: { listPublished: async () => [] },
} as unknown as import('./workflows-node-options').NodeOptionsDeps;

describe('resolveNodeOptions connectors:<type>', () => {
  it('filters connectors by type', async () => {
    expect(await resolveNodeOptions('connectors:postgres', deps)).toEqual([{ value: 'a', label: 'PG One' }]);
  });
  it('bare connectors still lists all (no type filter, no pluginId)', async () => {
    const all = await resolveNodeOptions('connectors', deps);
    expect(all.map((o) => o.value)).toEqual(['a', 'b', 'c']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/server exec vitest run src/workflows-node-options.test.ts`
Expected: FAIL (`connectors:postgres` → `[]` default; and a type error on `type` not in deps).

- [ ] **Step 3: Implement.** In `workflows-node-options.ts`:
  - Extend `NodeOptionsDeps.connectors.list` return type to include `type`:
    ```typescript
    connectors: { list(): Promise<Array<{ id: string; name: string; pluginId: string | null; type: string | null }>> };
    ```
  - In `resolveNodeOptions`, before the `switch`, add the typed-connectors branch:
    ```typescript
    if (source.startsWith('connectors:')) {
      const type = source.slice('connectors:'.length);
      const all = await deps.connectors.list();
      return all.filter((c) => c.type === type).map((c) => ({ value: c.id, label: c.name }));
    }
    ```
  - In the existing `case 'connectors':`, the `pluginId` filter stays; it now reads a nullable `pluginId` — no change needed.

- [ ] **Step 4: Fix the route wiring types.** In `apps/server/src/workflows-routes.ts`, the `deps.connectors.list` signature (≈ line 137) must include `type` to match. Update the `deps?` param type and the call site that supplies it (it passes `connectorStore` whose `list()` now returns `type`). Run the server typecheck to find both spots.

- [ ] **Step 5: Run test + typecheck.**

Run: `pnpm -C apps/server exec vitest run src/workflows-node-options.test.ts && pnpm -C apps/server exec tsc --noEmit`
Expected: tests PASS, tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/workflows-node-options.ts apps/server/src/workflows-node-options.test.ts apps/server/src/workflows-routes.ts
git commit -m "feat(server): connectors:<type> options resolver for database nodes"
```

---

## Task 7: Connectors routes — host create + host test

**Files:** Modify `apps/server/src/connectors-routes.ts`; `apps/server/src/connectors-routes.test.ts` (follow existing patterns).

- [ ] **Step 1: Write failing tests.** In `apps/server/src/connectors-routes.test.ts` add cases (mirror the existing harness in that file for app/ctx setup):
  - creating with `type: 'postgres'` (no pluginId) persists `type` + `kind='database'` and returns the record;
  - creating with neither `pluginId` nor `type` → 400;
  - creating with both → 400.

(If the file has no harness yet, model the setup on another `apps/server/src/*-routes.test.ts`.)

- [ ] **Step 2: Run to verify fail.**

Run: `pnpm -C apps/server exec vitest run src/connectors-routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Generalize `createInput` + create handler.** In `connectors-routes.ts`:

```typescript
const createInput = z.object({
  name: z.string().min(1),
  pluginId: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  config: z.record(z.string()),
  allowedHost: z.string().optional(),
}).refine((v) => Boolean(v.pluginId) !== Boolean(v.type), { message: 'exactly one of pluginId or type is required' });
```

In the `POST /api/connectors` handler, after parsing, branch:

```typescript
    const { name, pluginId, type, config, allowedHost } = parsed.data;
    const id = randomUUID();
    if (type) {
      // Host (database) connector — no plugin, no egress pinning, no baseUrl.
      try {
        await connectors.create({ id, name, type, kind: 'database', config }, key());
      } catch (e) { reply.code(400); return { error: redact(e instanceof Error ? e.message : String(e)) }; }
      await recordAudit(ctx, req, { action: 'connector.create', entityType: 'connector', entityId: id, metadata: { name, type, configKeys: Object.keys(config) } });
      return connectors.get(id);
    }
    // Plugin connector — existing path (baseUrl validation + host derivation).
    if (config?.baseUrl !== undefined) {
      try { validateConnectorBaseUrl(config.baseUrl); }
      catch (e) { reply.code(400); return { error: redact(e instanceof Error ? e.message : 'invalid connector baseUrl') }; }
    }
    const pinnedHost = hostFor(config, allowedHost);
    try {
      await connectors.create({ id, name, pluginId: pluginId!, kind: 'sink', config, allowedHost: pinnedHost }, key());
    } catch (e) { reply.code(400); return { error: redact(e instanceof Error ? e.message : String(e)) }; }
    await recordAudit(ctx, req, { action: 'connector.create', entityType: 'connector', entityId: id, metadata: { name, pluginId, allowedHost: pinnedHost, configKeys: Object.keys(config) } });
    return connectors.get(id);
```

- [ ] **Step 4: Branch the test handler.** In `POST /api/connectors/:id/test`, after loading `connector`, branch on `connector.type`:

```typescript
    if (connector.type) {
      try {
        const config = await connectors.getDecryptedConfig(id, key());
        const conn = createConnectorDb(connector.type, config);
        try { await conn.query('select 1'); } finally { await conn.close(); }
        await auditTest('ok');
        return { ok: true };
      } catch (e) {
        await auditTest('failed', 'error');
        return { ok: false, error: redact(e instanceof Error ? e.message : String(e)) };
      }
    }
    // else: existing DHIS2 plugin health-check path (unchanged) below.
```

Add the import: `import { createConnectorDb } from '@openldr/bootstrap';`. (The `auditTest` metadata references `connector.pluginId`/`allowedHost` which are now nullable — that's fine for audit metadata.)

- [ ] **Step 5: Run tests + typecheck.**

Run: `pnpm -C apps/server exec vitest run src/connectors-routes.test.ts && pnpm -C apps/server exec tsc --noEmit`
Expected: PASS + exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/connectors-routes.ts apps/server/src/connectors-routes.test.ts
git commit -m "feat(server): connectors routes support host (database) connectors + SELECT 1 test"
```

---

## Task 8: Web API types + Connectors UI (type-aware)

**Files:** Modify `apps/web/src/api.ts`, `apps/web/src/pages/settings/Connectors.tsx`, web i18n locale files (e.g. `apps/web/src/i18n/locales/en*.json` — find the existing `settings.connectors.*` keys).

- [ ] **Step 1: Update API types.** In `apps/web/src/api.ts`:
  - `Connector` interface: `pluginId: string | null;` and add `type: string | null;`.
  - `ConnectorCreateInput`: make `pluginId?: string` and add `type?: string`.

- [ ] **Step 2: Add a host-type field schema + types.** At the top of `Connectors.tsx` add a data-driven schema (extensible — future types are one entry):

```typescript
type FieldKind = 'text' | 'number' | 'password' | 'boolean';
interface TypeField { key: string; labelKey: string; kind: FieldKind }
const HOST_TYPES: Array<{ value: string; label: string }> = [
  { value: 'postgres', label: 'Postgres' },
  { value: 'microsoft-sql', label: 'Microsoft SQL' },
];
const DB_FIELDS: TypeField[] = [
  { key: 'host', labelKey: 'settings.connectors.fieldHost', kind: 'text' },
  { key: 'port', labelKey: 'settings.connectors.fieldPort', kind: 'number' },
  { key: 'database', labelKey: 'settings.connectors.fieldDatabase', kind: 'text' },
  { key: 'user', labelKey: 'settings.connectors.fieldUser', kind: 'text' },
  { key: 'password', labelKey: 'settings.connectors.fieldPassword', kind: 'password' },
  { key: 'ssl', labelKey: 'settings.connectors.fieldSsl', kind: 'boolean' },
];
```

- [ ] **Step 3: Extend `DraftState`** with a connector category + type + a generic per-type config bag:

```typescript
interface DraftState {
  id: string | null;
  category: 'plugin' | 'database';
  name: string;
  pluginId: string;
  type: string;                       // host type when category==='database'
  baseUrl: string; username: string; password: string; // plugin (DHIS2) fields
  dbConfig: Record<string, string>;   // host fields (host/port/database/user/password/ssl)
  enabled: boolean;
}
```
`emptyDraft()` defaults `category:'plugin'`, `type:'postgres'`, `dbConfig:{}`.

- [ ] **Step 4: Render category-aware form.** In the dialog:
  - A category selector (shadcn `Select`): "Plugin" vs "Database".
  - If `category==='database'`: a host-type `Select` (HOST_TYPES) + render `DB_FIELDS` (text/number → `Input`, password → `Input type=password`, boolean → `Switch`) bound to `draft.dbConfig[field.key]`. On edit, secret/password placeholders mirror the existing "secretSet" behavior.
  - If `category==='plugin'`: the existing pluginId + baseUrl/username/password block.

- [ ] **Step 5: Branch the save payload.** In `onSave`:
  - `category==='database'`: build `config` from `dbConfig` (all-or-nothing for secrets on edit, mirroring the existing partial-secrets guard — treat blank `password` on edit as "keep"). Create: `await createConnector({ name, type: draft.type, config })`. Update: `await updateConnector(id, { name, enabled, ...(configFilled ? { config } : {}) })`.
  - `category==='plugin'`: existing path (`{ name, pluginId, config }`).

- [ ] **Step 6: List + test rendering.** Add a "Type" cell to the table showing `c.type ?? c.pluginId`. In `onTest`, render `res.ok` without assuming DHIS2 metadata: show a generic OK (the host test returns `{ ok: true }` with no metadata) — use a new `settings.connectors.testOkSimple` key when `res.metadata` is absent, else the existing DHIS2 message.

- [ ] **Step 7: Add i18n keys.** In the locale file(s) under `settings.connectors`, add: `fieldHost`, `fieldPort`, `fieldDatabase`, `fieldUser`, `fieldSsl`, `category`, `categoryPlugin`, `categoryDatabase`, `pickType`, `colType`, `testOkSimple` (e.g. "Connection OK"). Mirror across all locale files present (en/fr/pt per the i18n workstream).

- [ ] **Step 8: Enable "Add" for database connectors.** The "Add" button is currently `disabled={plugins.length === 0}`. Change to always enabled (database connectors don't need a sink plugin); inside the dialog, if `category==='plugin' && plugins.length===0` show the existing no-plugins notice.

- [ ] **Step 9: Write/extend a component test.** In `apps/web/src/pages/settings/Connectors.test.tsx` (create if absent; mirror an existing settings page test), assert: selecting category "Database" + type "Postgres" renders host/port/database/user/password/ssl fields, and saving calls `createConnector` with `{ name, type: 'postgres', config: {...} }` (mock `@/api`).

- [ ] **Step 10: Run web tests + typecheck.**

Run: `pnpm -C apps/web exec tsc --noEmit && pnpm -C apps/web exec vitest run src/pages/settings/Connectors.test.tsx`
Expected: tsc exit 0; the new test passes.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/pages/settings/Connectors.tsx apps/web/src/pages/settings/Connectors.test.tsx apps/web/src/i18n
git commit -m "feat(web): type-aware Connectors UI (plugin + database connectors)"
```

---

## Task 9: Full verification gate

- [ ] **Step 1: Typecheck all touched packages.**

Run: `pnpm -C packages/db exec tsc --noEmit && pnpm -C packages/workflows exec tsc --noEmit && pnpm -C packages/bootstrap exec tsc --noEmit && pnpm -C apps/server exec tsc --noEmit && pnpm -C apps/web exec tsc --noEmit`
Expected: all exit 0.

- [ ] **Step 2: Run package test suites.**

Run: `pnpm -C packages/db test && pnpm -C packages/workflows test && pnpm -C packages/bootstrap test && pnpm -C apps/server test`
Expected: all pass (db +2, workflows +5, bootstrap +7, server +typed-options/routes).

- [ ] **Step 3: Web tests (isolated).**

Run: `pnpm -C apps/web test`
Expected: pass (existing ~584 + the new Connectors test).

- [ ] **Step 4: Final commit (if any gate fixups).**

```bash
git add -A
git commit -m "test(workflows): slice D connector foundation — gate green"
```

> **Post-merge reminder:** after fast-forward merging to `main`, run `pnpm install` in the main checkout (bootstrap may have gained adapter deps) before the gate. Live pg/mssql `SELECT 1` through a seeded connector is an accept-script concern (deferred), not part of this unit gate.

---

## Self-Review (completed during planning)

- **Spec coverage:** model generalization (Task 1-2), connection service (Task 3-4), nodes (Task 5), typed options (Task 6), routes host create+test (Task 7), UI (Task 8), gate (Task 9). All spec sections mapped. ✔
- **Placeholder scan:** backend tasks have complete code; the UI task (inherently bespoke, existing component) is a detailed step-spec with the concrete field schema, payload branches, and a named test — no "TBD". Migration registration + connectors-routes test harness reference existing patterns the implementer must locate (flagged explicitly). ✔
- **Type consistency:** `ConnectorRecord`/`NewConnector` gain `type` + nullable `pluginId` (Task 2) used by store/options/routes/service; `runConnectorSql` signature identical in services.ts, the runner, and the handler; `createConnectorDb(type,config)→{query,close}` consistent across helper/runner/route; `optionsSource: 'connectors:<type>'` matches the resolver prefix. ✔
- **Scope:** db + workflows + bootstrap + server + web; one additive migration; no destructive changes to the DHIS2 path (only branching). ✔
- **Deferred (per spec):** mysql/mongo/redis/email/ftp; pooling; live DB e2e (accept script).
