# Slice E — MySQL / MongoDB / Redis Connectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the database connector family — add `mysql` (reusing the Slice D SQL path), and `mongodb` + `redis` as new non-SQL node families — on top of the existing generalized Connector model.

**Architecture:** MySQL adds a dialect branch to `createConnectorDb` and a node that reuses the existing `connector-sql` handler + `runConnectorSql` service. MongoDB and Redis each add a connection helper, an injectable-factory service runner (mirroring `createConnectorSqlRunner`), an optional `WorkflowServices` method, and a node handler. The connector model/migration is unchanged (new `type` string values). The connector `/test` route gains a per-type health probe; the Connectors UI gains per-type field schemas.

**Tech Stack:** TypeScript, Vitest, Kysely `MysqlDialect`, `mysql2`, `mongodb`, `ioredis`, `@openldr/bootstrap`, `@openldr/workflows`, React + shadcn + i18n.

---

## Key facts (verified from Slice D)

- **`connector-db.ts`** (`packages/bootstrap/src/`) already has: `validatePort(raw, fallback)`, `buildPgUrl(config)`, `wrap(store: { db: Kysely<TargetSchema>; close() }): ConnectorDb`, and `createConnectorDb(type, config)` with `postgres` + `microsoft-sql` branches that `return wrap(store)`, else `throw new Error('unsupported connector type: ' + type)`. `ConnectorDb = { query(rawSql)→{rows}, close() }`. Imports `sql` from kysely, `createDbStore` (`@openldr/adapter-db-store`), `createMssqlStore` (`@openldr/adapter-mssql-store`), `Kysely`, `TargetSchema`.
- **`connector-sql-service.ts`**: `createConnectorSqlRunner({ connectors, secretsKey, createDb? })` resolves `connectors.get(id)` (throw if missing/disabled, throw if `!type`), `getDecryptedConfig`, `make(type, config)`, `query`, columns from row[0] keys, `close()` in finally. This is the pattern to mirror for mongo/redis.
- **`runConnectorSql`** is dialect-agnostic (reads the connector's `type`), so **MySQL needs no service change** — only a `createConnectorDb` branch.
- **WorkflowServices** (`packages/workflows/src/engine/services.ts`): optional `runConnectorSql?`. Add `runConnectorMongo?`/`runConnectorRedis?` the same way. `SqlResult`, `WorkflowItem`, `rowsToItems` available.
- **Handler dispatch**: `ACTION_HANDLERS[node.data.action]`; descriptors in `host-nodes.ts` (every config field has `required`); `IMPLEMENTED_TEMPLATE_IDS` + palette defaults in `apps/web/src/workflows/constants.ts`.
- **Options resolver**: `connectors:<type>` filter already generic — **no change** for the new types.
- **bootstrap wiring** (`packages/bootstrap/src/index.ts`): `connectorStore` is declared before `workflowServices`; `connectorSqlRunner` constructed there; `runConnectorSql:` member in the literal. Add mongo/redis runners + members alongside.
- **Connectors UI** (`apps/web/src/pages/settings/Connectors.tsx`): `HOST_TYPES` array + a field schema (Slice D used a single `DB_FIELDS`); `createConnector({name, type, config})`. **Cross-package tsc gate**: optional WorkflowServices additions + new bootstrap code → run `tsc` for `packages/workflows`, `packages/bootstrap`, `apps/server`, `apps/web`.

## Library API notes (confirm against installed versions in Task 1)

- **mysql2** + Kysely: `import { createPool } from 'mysql2'`; `new MysqlDialect({ pool: createPool({ host, port, user, password, database, ssl? }) })`. (Kysely's `MysqlDialect` accepts the callback-style `mysql2` pool, NOT `mysql2/promise`.)
- **mongodb**: `import { MongoClient } from 'mongodb'`; `const client = new MongoClient(uri); await client.connect(); const db = client.db(name); await db.collection(c).find(q).toArray();`. Close: `await client.close()`.
- **ioredis**: `import Redis from 'ioredis'` (default export is the class); `const client = new Redis({ host, port, password, db, lazyConnect: true, maxRetriesPerRequest: 1 });`. `await client.get/set/del(...)`; `await client.quit()`.

> **Implementer note:** Task 1 verifies each import shape empirically; adjust imports to the installed version and make `tsc` pass.

## Test commands

- bootstrap: `pnpm -C packages/bootstrap exec vitest run <path>` ; tsc `pnpm -C packages/bootstrap exec tsc --noEmit`
- workflows: `pnpm -C packages/workflows exec vitest run <path>` ; tsc likewise
- server / web: `pnpm -C apps/server ...` / `pnpm -C apps/web ...`

## File structure

- **Modify:** `packages/bootstrap/package.json` (deps); `packages/bootstrap/src/connector-db.ts` (mysql branch); `packages/bootstrap/src/index.ts` (wire mongo/redis runners + testConnector); `packages/workflows/src/engine/services.ts` (+2 optional methods); `packages/workflows/src/engine/node-handlers/index.ts` (register mysql/mongo/redis); `packages/workflows/src/host-nodes.ts` (+3 descriptors); `apps/web/src/workflows/constants.ts` (+3 ids/palette); `apps/server/src/connectors-routes.ts` (per-type test); `apps/web/src/pages/settings/Connectors.tsx` + i18n.
- **Create:** `packages/bootstrap/src/connector-mongo.ts` (+test), `connector-redis.ts` (+test), `connector-mongo-service.ts` (+test), `connector-redis-service.ts` (+test), `packages/bootstrap/src/connector-test.ts` (+test, the per-type probe); `packages/workflows/src/engine/node-handlers/mongo.ts` (+test), `redis.ts` (+test).

---

## Task 1: Add drivers

- [ ] **Step 1:** In `packages/bootstrap/package.json` `dependencies` add `"mysql2": "^3.11.0"`, `"mongodb": "^6.10.0"`, `"ioredis": "^5.4.1"`. (All three ship their own types — no @types needed.)
- [ ] **Step 2:** `pnpm install` (from worktree root).
- [ ] **Step 3:** Confirm import shapes: `pnpm -C packages/bootstrap exec node --input-type=module -e "import { createPool } from 'mysql2'; import { MysqlDialect } from 'kysely'; import { MongoClient } from 'mongodb'; import Redis from 'ioredis'; console.log('mysql2', typeof createPool, 'MysqlDialect', typeof MysqlDialect); console.log('mongo', typeof MongoClient); console.log('ioredis', typeof Redis);"` → all `function`. If `ioredis` default differs, note the actual shape.
- [ ] **Step 4:** `pnpm -C packages/bootstrap exec tsc --noEmit && pnpm -C packages/bootstrap test` → green (baseline 137).
- [ ] **Step 5:** Commit:
```bash
git add packages/bootstrap/package.json pnpm-lock.yaml
git commit -m "build(bootstrap): add mysql2/mongodb/ioredis drivers for db connectors"
```

---

## Task 2: MySQL — `createConnectorDb` branch + `mysql` node

**Files:** `packages/bootstrap/src/connector-db.ts` (+ `connector-db.test.ts`), `packages/workflows/src/engine/node-handlers/index.ts`, `packages/workflows/src/host-nodes.ts`, `apps/web/src/workflows/constants.ts`.

- [ ] **Step 1: Test** — append to `packages/bootstrap/src/connector-db.test.ts`:
```typescript
describe('createConnectorDb — mysql', () => {
  it('builds a mysql connection object with query + close', () => {
    const conn = createConnectorDb('mysql', { host: 'h', port: '3306', database: 'd', user: 'u', password: 'p' });
    expect(typeof conn.query).toBe('function');
    expect(typeof conn.close).toBe('function');
  });
  it('rejects an invalid mysql port', () => {
    expect(() => createConnectorDb('mysql', { host: 'h', port: 'abc', database: 'd', user: 'u', password: 'p' })).toThrow(/invalid connector port/);
  });
});
```
- [ ] **Step 2:** Run → FAIL (mysql unsupported).
- [ ] **Step 3:** In `connector-db.ts` add imports at top: `import { MysqlDialect, Kysely as KyselyCtor } from 'kysely';` — actually `Kysely` is already imported as a type; add a VALUE import: change/add `import { sql, MysqlDialect, Kysely } from 'kysely';` (keep the existing `sql` import; ensure `Kysely` is a value import, and `import { createPool } from 'mysql2';`). Add a `mysql` branch before the final `throw`:
```typescript
  if (type === 'mysql') {
    const port = validatePort(config.port, 3306);
    const host = config.host ?? 'localhost';
    if (!/^[A-Za-z0-9.\-]+$/.test(host) && !/^\[?[0-9A-Fa-f:]+\]?$/.test(host)) {
      throw new Error(`invalid connector host: ${host}`);
    }
    const pool = createPool({
      host, port, user: config.user ?? '', password: config.password ?? '', database: config.database ?? '',
      ...(config.ssl === 'true' ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    const db = new Kysely<TargetSchema>({ dialect: new MysqlDialect({ pool }) });
    return wrap({ db, close: () => db.destroy() });
  }
```
(`wrap` expects `{ db: Kysely<TargetSchema>; close() }` — `db.destroy()` tears down the pool.)
- [ ] **Step 4:** Run the mysql test → PASS. `pnpm -C packages/bootstrap exec tsc --noEmit` → 0.
- [ ] **Step 5: Node wiring.** In `packages/workflows/src/engine/node-handlers/index.ts` register `'mysql': connectorSqlHandler` (the import already exists). In `host-nodes.ts` add:
```typescript
  { id: 'mysql', source: 'host', label: 'MySQL', kind: 'transform', description: 'Run SQL on a MySQL connector.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'connectorId', label: 'Connector', type: 'select', required: true, optionsSource: 'connectors:mysql' }, { key: 'sql', label: 'SQL', type: 'text', required: true }] },
```
In `constants.ts` replace the `mysql` palette entry with `data: { config: { connectorId: '', sql: '' } }` and add `'mysql'` to the `// databases (slice D)` line in `IMPLEMENTED_TEMPLATE_IDS` (making it `'postgres', 'microsoft-sql', 'mysql',`).
- [ ] **Step 6:** `pnpm -C packages/workflows exec tsc --noEmit` → 0; `pnpm -C packages/workflows test` → green (the existing connector-sql test covers the handler).
- [ ] **Step 7: Commit:**
```bash
git add packages/bootstrap/src/connector-db.ts packages/bootstrap/src/connector-db.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): mysql connector + node (reuses connector-sql)"
```

---

## Task 3: MongoDB — connection helper + service

**Files:** Create `packages/bootstrap/src/connector-mongo.ts` (+test), `connector-mongo-service.ts` (+test); Modify `packages/workflows/src/engine/services.ts`, `packages/bootstrap/src/index.ts`.

- [ ] **Step 1:** Add the optional method to `WorkflowServices` (`services.ts`):
```typescript
  /** Run a MongoDB operation against a host connector. Host-injected. */
  runConnectorMongo?(input: { connectorId: string; operation: string; collection: string; query: unknown }): Promise<{ rows: Record<string, unknown>[]; meta?: Record<string, unknown> }>;
```
- [ ] **Step 2: connection helper test** — `packages/bootstrap/src/connector-mongo.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { buildMongoUri } from './connector-mongo';

describe('buildMongoUri', () => {
  it('assembles a uri with encoded credentials', () => {
    const uri = buildMongoUri({ host: 'h', port: '27017', database: 'lab', user: 'u', password: 'p@ss' });
    expect(uri).toBe('mongodb://u:p%40ss@h:27017/lab');
  });
  it('adds authSource when set and brackets IPv6', () => {
    const uri = buildMongoUri({ host: '::1', port: '27017', database: 'd', user: 'u', password: 'p', authSource: 'admin' });
    expect(uri).toBe('mongodb://u:p@[::1]:27017/d?authSource=admin');
  });
  it('omits credentials when user is blank', () => {
    expect(buildMongoUri({ host: 'h', port: '27017', database: 'd' })).toBe('mongodb://h:27017/d');
  });
});
```
- [ ] **Step 3:** Run → FAIL. **Write `connector-mongo.ts`:**
```typescript
import { MongoClient, type Db } from 'mongodb';

export interface MongoConn { db: Db; close(): Promise<void> }

function validatePort(raw: string | undefined, fallback: number): number {
  const port = Number(raw ?? fallback);
  if (!Number.isFinite(port) || port < 1 || port > 65535) throw new Error(`invalid connector port: ${raw}`);
  return port;
}

/** Build a mongodb:// URI from discrete config (encoded creds, IPv6 brackets, optional authSource). */
export function buildMongoUri(config: Record<string, string>): string {
  const host = config.host ?? 'localhost';
  if (!/^[A-Za-z0-9.\-]+$/.test(host) && !/^\[?[0-9A-Fa-f:]+\]?$/.test(host)) throw new Error(`invalid connector host: ${host}`);
  const hostPart = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const port = validatePort(config.port, 27017);
  const db = encodeURIComponent(config.database ?? '');
  const auth = config.user ? `${encodeURIComponent(config.user)}:${encodeURIComponent(config.password ?? '')}@` : '';
  const qs = config.authSource ? `?authSource=${encodeURIComponent(config.authSource)}` : '';
  return `mongodb://${auth}${hostPart}:${port}/${db}${qs}`;
}

/** Connect to a mongo connector; caller MUST close(). */
export async function createConnectorMongo(config: Record<string, string>): Promise<MongoConn> {
  const client = new MongoClient(buildMongoUri(config));
  await client.connect();
  return { db: client.db(config.database || undefined), close: () => client.close() };
}
```
- [ ] **Step 4:** Run the uri test → PASS.
- [ ] **Step 5: service test** — `packages/bootstrap/src/connector-mongo-service.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { createConnectorMongoRunner } from './connector-mongo-service';

const connectorsFake = (rec: unknown) => ({
  get: vi.fn(async () => rec as never),
  getDecryptedConfig: vi.fn(async () => ({ host: 'h', port: '27017', database: 'd' })),
});
function fakeMongo(docs: Record<string, unknown>[]) {
  let closed = false;
  const conn = {
    db: { collection: () => ({
      find: () => ({ toArray: async () => docs }),
      aggregate: () => ({ toArray: async () => docs }),
      insertMany: async (d: unknown[]) => ({ insertedCount: d.length }),
    }) },
    close: async () => { closed = true; },
  };
  return { connect: async () => conn as never, isClosed: () => closed };
}

describe('createConnectorMongoRunner', () => {
  it('find returns serialized rows and closes', async () => {
    const m = fakeMongo([{ _id: 'x', a: 1 }]);
    const run = createConnectorMongoRunner({ connectors: connectorsFake({ type: 'mongodb', enabled: true }), secretsKey: 'k', connect: m.connect });
    const res = await run({ connectorId: 'm1', operation: 'find', collection: 'c', query: {} });
    expect(res.rows).toEqual([{ _id: 'x', a: 1 }]);
    expect(m.isClosed()).toBe(true);
  });
  it('insertMany returns meta.insertedCount', async () => {
    const m = fakeMongo([]);
    const run = createConnectorMongoRunner({ connectors: connectorsFake({ type: 'mongodb', enabled: true }), secretsKey: 'k', connect: m.connect });
    const res = await run({ connectorId: 'm1', operation: 'insertMany', collection: 'c', query: [{ a: 1 }, { a: 2 }] });
    expect(res.meta).toEqual({ insertedCount: 2 });
  });
  it('throws for wrong type', async () => {
    const run = createConnectorMongoRunner({ connectors: connectorsFake({ type: 'postgres', enabled: true }), secretsKey: 'k', connect: vi.fn() as never });
    await expect(run({ connectorId: 'x', operation: 'find', collection: 'c', query: {} })).rejects.toThrow(/not a mongodb connector/);
  });
});
```
- [ ] **Step 6:** Run → FAIL. **Write `connector-mongo-service.ts`:**
```typescript
import { createConnectorMongo, type MongoConn } from './connector-mongo';

export interface ConnectorMongoDeps {
  connectors: { get(id: string): Promise<{ type: string | null; enabled: boolean } | null>; getDecryptedConfig(id: string, key: string | undefined): Promise<Record<string, string>> };
  secretsKey: string | undefined;
  connect?: (config: Record<string, string>) => Promise<MongoConn>;
}

/** Serialize a mongo doc to plain JSON (ObjectId/Date → string) via JSON round-trip. */
function toPlain(doc: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
}

export function createConnectorMongoRunner(deps: ConnectorMongoDeps) {
  const connect = deps.connect ?? createConnectorMongo;
  return async ({ connectorId, operation, collection, query }: { connectorId: string; operation: string; collection: string; query: unknown }) => {
    const c = await deps.connectors.get(connectorId);
    if (!c || !c.enabled) throw new Error(`connector ${connectorId} not found or disabled`);
    if (c.type !== 'mongodb') throw new Error(`connector ${connectorId} is not a mongodb connector`);
    const config = await deps.connectors.getDecryptedConfig(connectorId, deps.secretsKey);
    const conn = await connect(config);
    try {
      const coll = conn.db.collection(collection);
      if (operation === 'insertMany') {
        const docs = Array.isArray(query) ? query : [query];
        const r = await coll.insertMany(docs as Record<string, unknown>[]);
        return { rows: [], meta: { insertedCount: r.insertedCount } };
      }
      if (operation === 'aggregate') {
        const docs = await coll.aggregate(Array.isArray(query) ? (query as Record<string, unknown>[]) : []).toArray();
        return { rows: docs.map(toPlain) };
      }
      // find (default)
      const docs = await coll.find((query ?? {}) as Record<string, unknown>).toArray();
      return { rows: docs.map(toPlain) };
    } finally {
      await conn.close();
    }
  };
}
```
- [ ] **Step 7:** Run → PASS (3).
- [ ] **Step 8: Wire into bootstrap.** In `packages/bootstrap/src/index.ts`: `import { createConnectorMongoRunner } from './connector-mongo-service';`; before the `workflowServices` literal add `const connectorMongoRunner = createConnectorMongoRunner({ connectors: connectorStore, secretsKey: cfg.SECRETS_ENCRYPTION_KEY });`; in the literal add `runConnectorMongo: (input) => connectorMongoRunner(input),`.
- [ ] **Step 9:** `pnpm -C packages/bootstrap exec tsc --noEmit && pnpm -C packages/workflows exec tsc --noEmit` → 0.
- [ ] **Step 10: Commit:**
```bash
git add packages/bootstrap/src/connector-mongo.ts packages/bootstrap/src/connector-mongo.test.ts packages/bootstrap/src/connector-mongo-service.ts packages/bootstrap/src/connector-mongo-service.test.ts packages/workflows/src/engine/services.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): mongodb connector helper + runConnectorMongo service"
```

---

## Task 4: MongoDB node handler

**Files:** Create `packages/workflows/src/engine/node-handlers/mongo.ts` (+test); Modify `node-handlers/index.ts`, `host-nodes.ts`, `constants.ts`.

- [ ] **Step 1: Test** — `mongo.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { mongoHandler } from './mongo';
import { createContext } from '../execution-context';

function fakeCtx(rows: Record<string, unknown>[], meta?: Record<string, unknown>) {
  const calls: unknown[] = [];
  const services = { runConnectorMongo: async (i: unknown) => { calls.push(i); return { rows, meta }; } } as unknown as import('../services').WorkflowServices;
  return { ctx: createContext(undefined, () => {}, [], undefined, services), calls };
}
const node = (cfg: Record<string, unknown>) => ({ id: 'mg1', type: 'action', data: { action: 'mongodb', config: cfg } });

describe('mongoHandler', () => {
  it('find: passes parsed query + maps docs to items', async () => {
    const { ctx, calls } = fakeCtx([{ a: 1 }, { a: 2 }]);
    const result = await mongoHandler(node({ connectorId: 'c1', operation: 'find', collection: 'obs', query: '{"a":1}' }), ctx, []);
    expect(calls[0]).toEqual({ connectorId: 'c1', operation: 'find', collection: 'obs', query: { a: 1 } });
    expect(result).toEqual([{ json: { a: 1 } }, { json: { a: 2 } }]);
  });
  it('insertMany: emits the meta as one item when no rows', async () => {
    const { ctx } = fakeCtx([], { insertedCount: 2 });
    const result = await mongoHandler(node({ connectorId: 'c1', operation: 'insertMany', collection: 'obs', query: '[{"a":1},{"a":2}]' }), ctx, []);
    expect(result).toEqual([{ json: { insertedCount: 2 } }]);
  });
  it('throws on invalid query JSON', async () => {
    const { ctx } = fakeCtx([]);
    await expect(mongoHandler(node({ connectorId: 'c1', operation: 'find', collection: 'o', query: '{bad' }), ctx, [])).rejects.toThrow(/invalid query JSON/);
  });
  it('throws without connector / collection / services', async () => {
    const { ctx } = fakeCtx([]);
    await expect(mongoHandler(node({ connectorId: '', operation: 'find', collection: 'o', query: '{}' }), ctx, [])).rejects.toThrow(/connector is required/);
    await expect(mongoHandler(node({ connectorId: 'c1', operation: 'find', collection: '', query: '{}' }), ctx, [])).rejects.toThrow(/collection is required/);
    const bare = createContext(undefined, () => {});
    await expect(mongoHandler(node({ connectorId: 'c1', operation: 'find', collection: 'o', query: '{}' }), bare, [])).rejects.toThrow(/requires server services/);
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Handler** — `mongo.ts`:
```typescript
import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';
import { rowsToItems } from '../items';

/** Run a MongoDB operation (find/aggregate/insertMany) against a connector. `query` is JSON
 *  (object filter, pipeline array, or documents array); a string is template-resolved then parsed. */
export const mongoHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.runConnectorMongo) throw new Error('MongoDB node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const connectorId = (config.connectorId as string) ?? '';
  if (!connectorId) throw new Error('MongoDB node: a connector is required');
  const operation = (config.operation as string) || 'find';
  const collection = (config.collection as string) ?? '';
  if (!collection) throw new Error('MongoDB node: a collection is required');
  const raw = config.query;
  let query: unknown;
  if (typeof raw === 'string') {
    const resolved = resolveTemplate(raw, ctx, input);
    try { query = resolved.trim() ? JSON.parse(resolved) : {}; }
    catch (err) { throw new Error(`MongoDB node: invalid query JSON: ${err instanceof Error ? err.message : String(err)}`); }
  } else {
    query = raw ?? {};
  }
  const { rows, meta } = await ctx.services.runConnectorMongo({ connectorId, operation, collection, query });
  if (rows.length === 0 && meta) return [{ json: meta }];
  return rowsToItems(rows);
};
```
- [ ] **Step 4:** Run → PASS (covers 6 assertions across 4 tests).
- [ ] **Step 5: Wiring.** `index.ts`: `import { mongoHandler } from './mongo';` + `'mongodb': mongoHandler,`. `host-nodes.ts`:
```typescript
  { id: 'mongodb', source: 'host', label: 'MongoDB', kind: 'transform', description: 'Find / aggregate / insert documents.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'connectorId', label: 'Connector', type: 'select', required: true, optionsSource: 'connectors:mongodb' }, { key: 'operation', label: 'Operation', type: 'select', required: false, options: [{ value: 'find', label: 'Find' }, { value: 'aggregate', label: 'Aggregate' }, { value: 'insertMany', label: 'Insert Many' }] }, { key: 'collection', label: 'Collection', type: 'text', required: true }, { key: 'query', label: 'Query / pipeline / docs (JSON)', type: 'json', required: false }] },
```
`constants.ts`: replace `mongodb` palette entry with `data: { config: { connectorId: '', operation: 'find', collection: '', query: {} } }`; add `'mongodb'` to the databases IMPLEMENTED line.
- [ ] **Step 6:** `pnpm -C packages/workflows exec tsc --noEmit` → 0; `pnpm -C packages/workflows test` → green.
- [ ] **Step 7: Commit:**
```bash
git add packages/workflows/src/engine/node-handlers/mongo.ts packages/workflows/src/engine/node-handlers/mongo.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): mongodb node (find/aggregate/insertMany)"
```

---

## Task 5: Redis — connection helper + service

**Files:** Create `packages/bootstrap/src/connector-redis.ts` (+test), `connector-redis-service.ts` (+test); Modify `services.ts`, `index.ts`.

- [ ] **Step 1:** Add to `WorkflowServices`:
```typescript
  /** Run a Redis operation against a host connector. Host-injected. */
  runConnectorRedis?(input: { connectorId: string; operation: string; key: string; value?: string; ttlSeconds?: number }): Promise<{ result: unknown }>;
```
- [ ] **Step 2: helper test** — `connector-redis.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createConnectorRedis } from './connector-redis';

describe('createConnectorRedis', () => {
  it('constructs a client with get/set/del/quit', () => {
    const c = createConnectorRedis({ host: 'h', port: '6379' });
    expect(typeof c.get).toBe('function');
    expect(typeof c.quit).toBe('function');
    void c.quit().catch(() => {}); // tear down the lazy client
  });
  it('rejects an invalid port', () => {
    expect(() => createConnectorRedis({ host: 'h', port: 'abc' })).toThrow(/invalid connector port/);
  });
});
```
- [ ] **Step 3:** Run → FAIL. **Write `connector-redis.ts`:**
```typescript
import Redis from 'ioredis';

function validatePort(raw: string | undefined, fallback: number): number {
  const port = Number(raw ?? fallback);
  if (!Number.isFinite(port) || port < 1 || port > 65535) throw new Error(`invalid connector port: ${raw}`);
  return port;
}

/** Build a lazy ioredis client from connector config. Caller MUST quit(). */
export function createConnectorRedis(config: Record<string, string>): Redis {
  return new Redis({
    host: config.host || 'localhost',
    port: validatePort(config.port, 6379),
    password: config.password || undefined,
    db: config.db ? Number(config.db) : 0,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
}
```
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: service test** — `connector-redis-service.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { createConnectorRedisRunner } from './connector-redis-service';

const connectorsFake = (rec: unknown) => ({
  get: vi.fn(async () => rec as never),
  getDecryptedConfig: vi.fn(async () => ({ host: 'h', port: '6379' })),
});
function fakeClient(getVal: unknown) {
  const calls: string[] = [];
  let quit = false;
  return {
    client: {
      get: async (k: string) => { calls.push(`get ${k}`); return getVal; },
      set: async (...a: unknown[]) => { calls.push(`set ${a.join(',')}`); return 'OK'; },
      del: async (k: string) => { calls.push(`del ${k}`); return 1; },
      quit: async () => { quit = true; return 'OK'; },
    },
    calls, isQuit: () => quit,
  };
}

describe('createConnectorRedisRunner', () => {
  it('get returns {result} and quits', async () => {
    const f = fakeClient('v1');
    const run = createConnectorRedisRunner({ connectors: connectorsFake({ type: 'redis', enabled: true }), secretsKey: 'k', make: () => f.client as never });
    expect(await run({ connectorId: 'r1', operation: 'get', key: 'k1' })).toEqual({ result: 'v1' });
    expect(f.isQuit()).toBe(true);
  });
  it('set with ttl issues EX', async () => {
    const f = fakeClient(null);
    const run = createConnectorRedisRunner({ connectors: connectorsFake({ type: 'redis', enabled: true }), secretsKey: 'k', make: () => f.client as never });
    await run({ connectorId: 'r1', operation: 'set', key: 'k1', value: 'v', ttlSeconds: 60 });
    expect(f.calls.some((c) => c.includes('EX,60') || c.includes('EX,60'))).toBe(true);
  });
  it('throws for wrong type', async () => {
    const run = createConnectorRedisRunner({ connectors: connectorsFake({ type: 'postgres', enabled: true }), secretsKey: 'k', make: () => ({}) as never });
    await expect(run({ connectorId: 'x', operation: 'get', key: 'k' })).rejects.toThrow(/not a redis connector/);
  });
});
```
- [ ] **Step 6:** Run → FAIL. **Write `connector-redis-service.ts`:**
```typescript
import type Redis from 'ioredis';
import { createConnectorRedis } from './connector-redis';

export interface ConnectorRedisDeps {
  connectors: { get(id: string): Promise<{ type: string | null; enabled: boolean } | null>; getDecryptedConfig(id: string, key: string | undefined): Promise<Record<string, string>> };
  secretsKey: string | undefined;
  make?: (config: Record<string, string>) => Redis;
}

export function createConnectorRedisRunner(deps: ConnectorRedisDeps) {
  const make = deps.make ?? createConnectorRedis;
  return async ({ connectorId, operation, key, value, ttlSeconds }: { connectorId: string; operation: string; key: string; value?: string; ttlSeconds?: number }): Promise<{ result: unknown }> => {
    const c = await deps.connectors.get(connectorId);
    if (!c || !c.enabled) throw new Error(`connector ${connectorId} not found or disabled`);
    if (c.type !== 'redis') throw new Error(`connector ${connectorId} is not a redis connector`);
    const config = await deps.connectors.getDecryptedConfig(connectorId, deps.secretsKey);
    const client = make(config);
    try {
      if (operation === 'set') {
        const result = ttlSeconds ? await client.set(key, value ?? '', 'EX', ttlSeconds) : await client.set(key, value ?? '');
        return { result };
      }
      if (operation === 'del') return { result: await client.del(key) };
      return { result: await client.get(key) }; // get (default)
    } finally {
      await client.quit();
    }
  };
}
```
- [ ] **Step 7:** Run → PASS (3).
- [ ] **Step 8: Wire into bootstrap.** `index.ts`: `import { createConnectorRedisRunner } from './connector-redis-service';`; `const connectorRedisRunner = createConnectorRedisRunner({ connectors: connectorStore, secretsKey: cfg.SECRETS_ENCRYPTION_KEY });`; literal member `runConnectorRedis: (input) => connectorRedisRunner(input),`.
- [ ] **Step 9:** `pnpm -C packages/bootstrap exec tsc --noEmit && pnpm -C packages/workflows exec tsc --noEmit` → 0.
- [ ] **Step 10: Commit:**
```bash
git add packages/bootstrap/src/connector-redis.ts packages/bootstrap/src/connector-redis.test.ts packages/bootstrap/src/connector-redis-service.ts packages/bootstrap/src/connector-redis-service.test.ts packages/workflows/src/engine/services.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): redis connector helper + runConnectorRedis service"
```

---

## Task 6: Redis node handler

**Files:** Create `packages/workflows/src/engine/node-handlers/redis.ts` (+test); Modify `node-handlers/index.ts`, `host-nodes.ts`, `constants.ts`.

- [ ] **Step 1: Test** — `redis.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { redisHandler } from './redis';
import { createContext } from '../execution-context';

function fakeCtx(result: unknown) {
  const calls: unknown[] = [];
  const services = { runConnectorRedis: async (i: unknown) => { calls.push(i); return { result }; } } as unknown as import('../services').WorkflowServices;
  return { ctx: createContext(undefined, () => {}, [], undefined, services), calls };
}
const node = (cfg: Record<string, unknown>) => ({ id: 'rd1', type: 'action', data: { action: 'redis', config: cfg } });

describe('redisHandler', () => {
  it('get returns {value}', async () => {
    const { ctx, calls } = fakeCtx('hello');
    const result = await redisHandler(node({ connectorId: 'c1', operation: 'get', key: 'k1' }), ctx, []);
    expect(calls[0]).toEqual({ connectorId: 'c1', operation: 'get', key: 'k1', value: undefined, ttlSeconds: undefined });
    expect(result).toEqual([{ json: { value: 'hello' } }]);
  });
  it('set resolves templates in key/value and returns {ok}', async () => {
    const { ctx, calls } = fakeCtx('OK');
    const result = await redisHandler(node({ connectorId: 'c1', operation: 'set', key: 'k:{{ $json.id }}', value: '{{ $json.v }}', ttlSeconds: 30 }), ctx, [{ json: { id: '7', v: 'x' } }]);
    expect(calls[0]).toEqual({ connectorId: 'c1', operation: 'set', key: 'k:7', value: 'x', ttlSeconds: 30 });
    expect(result).toEqual([{ json: { ok: 'OK' } }]);
  });
  it('del returns {deleted}', async () => {
    const { ctx } = fakeCtx(1);
    expect(await redisHandler(node({ connectorId: 'c1', operation: 'del', key: 'k1' }), ctx, [])).toEqual([{ json: { deleted: 1 } }]);
  });
  it('throws without connector/key/services', async () => {
    const { ctx } = fakeCtx(null);
    await expect(redisHandler(node({ connectorId: '', operation: 'get', key: 'k' }), ctx, [])).rejects.toThrow(/connector is required/);
    await expect(redisHandler(node({ connectorId: 'c1', operation: 'get', key: '' }), ctx, [])).rejects.toThrow(/key is required/);
    const bare = createContext(undefined, () => {});
    await expect(redisHandler(node({ connectorId: 'c1', operation: 'get', key: 'k' }), bare, [])).rejects.toThrow(/requires server services/);
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Handler** — `redis.ts`:
```typescript
import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';

/** Run a Redis op (get/set/del). key/value support {{ }} templates. */
export const redisHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.runConnectorRedis) throw new Error('Redis node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const connectorId = (config.connectorId as string) ?? '';
  if (!connectorId) throw new Error('Redis node: a connector is required');
  const operation = (config.operation as string) || 'get';
  const key = resolveTemplate(String(config.key ?? ''), ctx, input);
  if (!key) throw new Error('Redis node: a key is required');
  const value = config.value !== undefined ? resolveTemplate(String(config.value), ctx, input) : undefined;
  const ttlRaw = config.ttlSeconds;
  const ttlSeconds = ttlRaw === undefined || ttlRaw === '' ? undefined : Number(ttlRaw);
  const { result } = await ctx.services.runConnectorRedis({ connectorId, operation, key, value, ttlSeconds });
  if (operation === 'set') return [{ json: { ok: result } }];
  if (operation === 'del') return [{ json: { deleted: result } }];
  return [{ json: { value: result } }];
};
```
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Wiring.** `index.ts`: `import { redisHandler } from './redis';` + `'redis': redisHandler,`. `host-nodes.ts`:
```typescript
  { id: 'redis', source: 'host', label: 'Redis', kind: 'transform', description: 'Redis get / set / del.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'connectorId', label: 'Connector', type: 'select', required: true, optionsSource: 'connectors:redis' }, { key: 'operation', label: 'Operation', type: 'select', required: false, options: [{ value: 'get', label: 'Get' }, { value: 'set', label: 'Set' }, { value: 'del', label: 'Delete' }] }, { key: 'key', label: 'Key', type: 'text', required: true }, { key: 'value', label: 'Value (set)', type: 'text', required: false }, { key: 'ttlSeconds', label: 'TTL seconds (set)', type: 'number', required: false }] },
```
`constants.ts`: replace `redis` palette entry with `data: { config: { connectorId: '', operation: 'get', key: '', value: '', ttlSeconds: '' } }`; add `'redis'` to the databases IMPLEMENTED line (final: `'postgres', 'microsoft-sql', 'mysql', 'mongodb', 'redis',`).
- [ ] **Step 6:** `pnpm -C packages/workflows exec tsc --noEmit` → 0; `pnpm -C packages/workflows test` → green.
- [ ] **Step 7: Commit:**
```bash
git add packages/workflows/src/engine/node-handlers/redis.ts packages/workflows/src/engine/node-handlers/redis.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): redis node (get/set/del)"
```

---

## Task 7: Per-type connector test probe

**Files:** Create `packages/bootstrap/src/connector-test.ts` (+test); Modify `packages/bootstrap/src/index.ts` (export), `apps/server/src/connectors-routes.ts`.

- [ ] **Step 1: Test** — `connector-test.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { testConnector } from './connector-test';

describe('testConnector', () => {
  it('runs select 1 for sql types', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const close = vi.fn(async () => {});
    await testConnector('postgres', {}, { sqlDb: () => ({ query, close }) as never });
    expect(query).toHaveBeenCalledWith('select 1');
    expect(close).toHaveBeenCalled();
  });
  it('pings for mongodb', async () => {
    const command = vi.fn(async () => ({ ok: 1 }));
    const close = vi.fn(async () => {});
    await testConnector('mongodb', {}, { mongo: async () => ({ db: { command }, close }) as never });
    expect(command).toHaveBeenCalledWith({ ping: 1 });
    expect(close).toHaveBeenCalled();
  });
  it('pings for redis', async () => {
    const ping = vi.fn(async () => 'PONG');
    const quit = vi.fn(async () => 'OK');
    await testConnector('redis', {}, { redis: () => ({ ping, quit }) as never });
    expect(ping).toHaveBeenCalled();
    expect(quit).toHaveBeenCalled();
  });
  it('throws for an unknown type', async () => {
    await expect(testConnector('mystery', {})).rejects.toThrow(/unsupported connector type/);
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Write `connector-test.ts`:**
```typescript
import { createConnectorDb, type ConnectorDb } from './connector-db';
import { createConnectorMongo, type MongoConn } from './connector-mongo';
import { createConnectorRedis } from './connector-redis';
import type Redis from 'ioredis';

const SQL_TYPES = new Set(['postgres', 'microsoft-sql', 'mysql']);

export interface ConnectorTestDeps {
  sqlDb?: (type: string, config: Record<string, string>) => ConnectorDb;
  mongo?: (config: Record<string, string>) => Promise<MongoConn>;
  redis?: (config: Record<string, string>) => Redis;
}

/** Probe a host connector by type (SELECT 1 / mongo ping / redis PING). Throws on failure; always closes. */
export async function testConnector(type: string, config: Record<string, string>, deps: ConnectorTestDeps = {}): Promise<void> {
  if (SQL_TYPES.has(type)) {
    const conn = (deps.sqlDb ?? createConnectorDb)(type, config);
    try { await conn.query('select 1'); } finally { await conn.close(); }
    return;
  }
  if (type === 'mongodb') {
    const conn = await (deps.mongo ?? createConnectorMongo)(config);
    try { await conn.db.command({ ping: 1 }); } finally { await conn.close(); }
    return;
  }
  if (type === 'redis') {
    const client = (deps.redis ?? createConnectorRedis)(config);
    try { await client.ping(); } finally { await client.quit(); }
    return;
  }
  throw new Error(`unsupported connector type: ${type}`);
}
```
> Note: `createConnectorDb`'s default signature is `(type, config)`; the `sqlDb` dep here is `(type, config)` to match — the production default passes `type` through. Adjust the default call to `(deps.sqlDb ?? ((t, c) => createConnectorDb(t, c)))` if needed so the arity matches.
- [ ] **Step 4:** Run → PASS (4). Export from `index.ts`: `export { testConnector } from './connector-test';`.
- [ ] **Step 5: Use it in the route.** In `apps/server/src/connectors-routes.ts` `/:id/test`, replace the host branch's inline `createConnectorDb(...).query('select 1')` with `await testConnector(connector.type, config)` (import `testConnector` from `@openldr/bootstrap`). Keep the `{ ok:true } / { ok:false, error: redact(...) }` + audit behavior.
- [ ] **Step 6:** `pnpm -C packages/bootstrap exec tsc --noEmit && pnpm -C apps/server exec tsc --noEmit` → 0; `pnpm -C apps/server test` → green.
- [ ] **Step 7: Commit:**
```bash
git add packages/bootstrap/src/connector-test.ts packages/bootstrap/src/connector-test.test.ts packages/bootstrap/src/index.ts apps/server/src/connectors-routes.ts
git commit -m "feat(bootstrap): per-type connector test probe (sql/mongo/redis)"
```

---

## Task 8: Connectors UI — per-type field schemas

**Files:** `apps/web/src/pages/settings/Connectors.tsx`, web i18n locale files, `apps/web/src/pages/settings/Connectors.test.tsx`.

- [ ] **Step 1:** In `Connectors.tsx`, extend `HOST_TYPES` to all five:
```typescript
const HOST_TYPES: Array<{ value: string; label: string }> = [
  { value: 'postgres', label: 'Postgres' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'microsoft-sql', label: 'Microsoft SQL' },
  { value: 'mongodb', label: 'MongoDB' },
  { value: 'redis', label: 'Redis' },
];
```
- [ ] **Step 2:** Replace the single `DB_FIELDS` with a per-type map:
```typescript
const SQL_FIELDS: TypeField[] = [
  { key: 'host', labelKey: 'settings.connectors.fieldHost', kind: 'text' },
  { key: 'port', labelKey: 'settings.connectors.fieldPort', kind: 'number' },
  { key: 'database', labelKey: 'settings.connectors.fieldDatabase', kind: 'text' },
  { key: 'user', labelKey: 'settings.connectors.fieldUser', kind: 'text' },
  { key: 'password', labelKey: 'settings.connectors.fieldPassword', kind: 'password' },
  { key: 'ssl', labelKey: 'settings.connectors.fieldSsl', kind: 'boolean' },
];
const CONNECTOR_TYPE_FIELDS: Record<string, TypeField[]> = {
  postgres: SQL_FIELDS,
  mysql: SQL_FIELDS,
  'microsoft-sql': [
    { key: 'host', labelKey: 'settings.connectors.fieldHost', kind: 'text' },
    { key: 'port', labelKey: 'settings.connectors.fieldPort', kind: 'number' },
    { key: 'database', labelKey: 'settings.connectors.fieldDatabase', kind: 'text' },
    { key: 'user', labelKey: 'settings.connectors.fieldUser', kind: 'text' },
    { key: 'password', labelKey: 'settings.connectors.fieldPassword', kind: 'password' },
    { key: 'encrypt', labelKey: 'settings.connectors.fieldEncrypt', kind: 'boolean' },
    { key: 'trustServerCertificate', labelKey: 'settings.connectors.fieldTrustServerCert', kind: 'boolean' },
  ],
  mongodb: [
    { key: 'host', labelKey: 'settings.connectors.fieldHost', kind: 'text' },
    { key: 'port', labelKey: 'settings.connectors.fieldPort', kind: 'number' },
    { key: 'database', labelKey: 'settings.connectors.fieldDatabase', kind: 'text' },
    { key: 'user', labelKey: 'settings.connectors.fieldUser', kind: 'text' },
    { key: 'password', labelKey: 'settings.connectors.fieldPassword', kind: 'password' },
    { key: 'authSource', labelKey: 'settings.connectors.fieldAuthSource', kind: 'text' },
  ],
  redis: [
    { key: 'host', labelKey: 'settings.connectors.fieldHost', kind: 'text' },
    { key: 'port', labelKey: 'settings.connectors.fieldPort', kind: 'number' },
    { key: 'password', labelKey: 'settings.connectors.fieldPassword', kind: 'password' },
    { key: 'db', labelKey: 'settings.connectors.fieldDb', kind: 'number' },
  ],
};
```
Render `CONNECTOR_TYPE_FIELDS[draft.type] ?? SQL_FIELDS` for the database category (replacing the `DB_FIELDS` reference). The all-or-nothing secret guard on edit should treat the password field as "blank = keep" as before; for non-SQL types adapt the "required to create" check to the type's fields (require all non-password fields + password where present, OR simplest: require `host` + `port` and treat the rest as optional). Keep create requiring at least `host`.
- [ ] **Step 2b:** Default `emptyDraft().type` stays `'postgres'`.
- [ ] **Step 3: i18n.** Add keys `fieldAuthSource`, `fieldDb`, `fieldEncrypt`, `fieldTrustServerCert` to every locale file (`en.ts`, `fr.ts`, `pt.ts`) under `settings.connectors`. Sensible labels (e.g. en: "Auth source", "DB index", "Encrypt", "Trust server certificate").
- [ ] **Step 4: Test.** In `Connectors.test.tsx` add: selecting category Database + type "MongoDB" renders an `authSource` field; type "Redis" renders `db` + password but NOT `database`/`user`; saving a Redis connector calls `createConnector` with `{ name, type: 'redis', config: { host, port, ... } }`. Mirror the existing Slice-D test's mock-`@/api` harness.
- [ ] **Step 5:** `pnpm -C apps/web exec tsc --noEmit` → 0; `pnpm -C apps/web exec vitest run src/pages/settings/Connectors.test.tsx` → pass.
- [ ] **Step 6: Commit:**
```bash
git add apps/web/src/pages/settings/Connectors.tsx apps/web/src/pages/settings/Connectors.test.tsx apps/web/src/i18n
git commit -m "feat(web): per-type connector fields for mysql/mongodb/redis"
```

---

## Task 9: Full verification gate

- [ ] **Step 1:** Typecheck all touched packages: `pnpm -C packages/workflows exec tsc --noEmit && pnpm -C packages/bootstrap exec tsc --noEmit && pnpm -C apps/server exec tsc --noEmit && pnpm -C apps/web exec tsc --noEmit` → all 0.
- [ ] **Step 2:** `pnpm -C packages/workflows test && pnpm -C packages/bootstrap test && pnpm -C apps/server test` → all pass (workflows +~10 mongo/redis handler tests; bootstrap +~11 helper/service/test-probe tests).
- [ ] **Step 3:** `pnpm -C apps/web test` (isolated) → pass.
- [ ] **Step 4:** Final commit if any fixups: `git add -A && git commit -m "test(workflows): slice E db connectors — gate green"`.

> **Post-merge reminder:** after ff-merge to `main`, run `pnpm install` in the main checkout (new bootstrap deps) before the gate. Live mysql/mongo/redis `SELECT 1`/ping is an accept-script concern (deferred).

---

## Self-Review (completed during planning)

- **Spec coverage:** mysql (Task 2), mongo helper+service (3) + node (4), redis helper+service (5) + node (6), per-type test probe (7), UI per-type fields incl. MSSQL fix (8), gate (9). All spec sections mapped. ✔
- **Placeholder scan:** full code in backend tasks; the UI task (bespoke) is a concrete field-schema + payload + named tests; library import shapes confirmed in Task 1. No TBD. ✔
- **Type consistency:** `runConnectorMongo`/`runConnectorRedis` signatures identical across services.ts ↔ runners ↔ handlers; `createConnectorMongo`/`MongoConn`, `createConnectorRedis` shared by services + test probe; `connectors:<type>` strings (`mysql`/`mongodb`/`redis`) match descriptor optionsSource ↔ resolver ↔ createConnectorDb branch ↔ UI HOST_TYPES; every descriptor field has `required`. ✔
- **Scope:** bootstrap + workflows + server + web; no DB model/migration change. Cross-package tsc gate noted. ✔
- **Deferred:** mongo update/delete/count, redis incr/expire, SRV URIs, pooling, live e2e (accept script).
