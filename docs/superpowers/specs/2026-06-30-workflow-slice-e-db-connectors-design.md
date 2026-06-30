# Slice E — Remaining Database Connectors (MySQL, MongoDB, Redis) Design

**Date:** 2026-06-30
**Status:** Design / spec
**Relates to:** [Slice D — connector foundation](2026-06-30-workflow-connector-foundation-design.md), [workflow-node-palette inventory]

## Purpose

Finish the database connector family on top of the Slice D foundation. MySQL is a near-mechanical reuse of the SQL path; MongoDB and Redis are two new **non-SQL** node families (their own drivers, service methods, node config shapes, and connector types). The generalized Connector model, encryption, `connectors:<type>` options resolver, and type-aware Connectors UI from Slice D all carry over.

**Decisions locked during brainstorming:** scope = all three (mysql + mongodb + redis); MVP operations = mongo `find`/`aggregate`/`insertMany`, redis `get`/`set`(+TTL)/`del` (read **and** write).

## What already exists (reused from Slice D)

- Connector model: `connectors` table with nullable `plugin_id` + `type`; `connector-store` create/get/list/getDecryptedConfig; XOR(`pluginId`,`type`) invariant. **No model/migration change needed** — new types are just new `type` string values.
- `createConnectorDb(type, config) → { query, close }` (`packages/bootstrap/src/connector-db.ts`) — pg + mssql branches today; add a `mysql` branch.
- `runConnectorSql` service + `connector-sql` handler (`packages/workflows`) — MySQL reuses both unchanged.
- `resolveNodeOptions` `connectors:<type>` filter — works for any type with **no change**.
- Connectors UI (`apps/web/src/pages/settings/Connectors.tsx`) — `HOST_TYPES` + per-type field rendering; generalize the field schema to per-type.
- `POST /api/connectors` host create (kind='database') — works for any type unchanged; `POST /:id/test` currently does SQL `SELECT 1` — must branch by type.
- AES-256-GCM secret encryption; audit records `configKeys` only; errors `redact`ed.

## Architecture

### 1. MySQL (SQL reuse)

- **Dep:** `mysql2` (in `packages/bootstrap`).
- **`createConnectorDb` `mysql` branch:** build a Kysely `MysqlDialect` over a `mysql2` pool from `{ host, port, database, user, password, ssl? }` (validate host/port like the pg branch; ssl → `{ ssl: { rejectUnauthorized: false } }` when `ssl==='true'`, else none). Return the shared `wrap(store)` shape. No new adapter package — the dialect is constructed inline in `connector-db.ts` (it is the connection factory).
- **Node:** `mysql` reuses the existing `connectorSqlHandler` (register `ACTION_HANDLERS['mysql'] = connectorSqlHandler`). New descriptor in `host-nodes.ts` (kind 'transform', config `connectorId` select `optionsSource:'connectors:mysql'` + `sql` text). Add `mysql` to `IMPLEMENTED_TEMPLATE_IDS` + palette default `{connectorId:'', sql:''}`.
- **Service:** none — `runConnectorSql` resolves the connector, reads `type==='mysql'`, calls `createConnectorDb('mysql', …)`. Already type-agnostic.

### 2. MongoDB (non-SQL)

- **Dep:** `mongodb` (in `packages/bootstrap`).
- **Connector type `mongodb`**, config `{ host, port, database, user, password, authSource? }`.
- **`createConnectorMongo(config) → { db, close }`** (new sibling helper file `packages/bootstrap/src/connector-mongo.ts`): build a `MongoClient` (`mongodb://` URL assembled from discrete fields with encoded credentials + IPv6 bracketing, `authSource` as a query param when set), connect, return the `Db` handle for `config.database` + a `close()` that calls `client.close()`. Client factory injectable for tests.
- **Service** (`WorkflowServices.runConnectorMongo?`):
  ```ts
  runConnectorMongo?(input: { connectorId: string; operation: string; collection: string; query: unknown }):
    Promise<{ rows: Record<string, unknown>[]; meta?: Record<string, unknown> }>;
  ```
  Implementation (bootstrap, `createConnectorMongoRunner`): resolve connector (must be `type==='mongodb'`), decrypt, `createConnectorMongo`, then by `operation`:
  - `find`: `coll.find(query ?? {}).toArray()` → rows.
  - `aggregate`: `coll.aggregate(query as Document[]).toArray()` → rows.
  - `insertMany`: `coll.insertMany(query as Document[])` → `rows: []`, `meta: { insertedCount }`.
  Serialize every returned doc to plain JSON (stringify `_id`/ObjectId → string; via a small `toPlain` that JSON-roundtrips with ObjectId→`$oid`-free string). Always `close()` in `finally`.
- **Node `mongodb`** (new handler `mongo.ts`): guard `!ctx.services?.runConnectorMongo`; read `connectorId` (required), `operation` (default `find`), `collection` (required), `query` (a `json` config field; if a string, `resolveTemplate` then `JSON.parse` with a clear error; if already an object/array, use as-is). Call the service; `rowsToItems(rows)`; if `meta` present and rows empty, emit one item `{ json: meta }`. Records `meta` on the node run (set `ctx.nodeMeta` if available — optional).

### 3. Redis (non-SQL)

- **Dep:** `ioredis` (in `packages/bootstrap`).
- **Connector type `redis`**, config `{ host, port, password?, db? }`.
- **`createConnectorRedis(config) → client`** (new helper): `new Redis({ host, port: validatePort(port,6379), password: password||undefined, db: Number(db||0), lazyConnect: true, maxRetriesPerRequest: 1 })`; factory injectable for tests; caller `quit()`s.
- **Service** (`WorkflowServices.runConnectorRedis?`):
  ```ts
  runConnectorRedis?(input: { connectorId: string; operation: string; key: string; value?: string; ttlSeconds?: number }):
    Promise<{ result: unknown }>;
  ```
  Implementation (bootstrap, `createConnectorRedisRunner`): resolve (must be `type==='redis'`), decrypt, `createConnectorRedis`, then by `operation`:
  - `get`: `await client.get(key)` → `{ result }`.
  - `set`: `ttlSeconds ? client.set(key, value, 'EX', ttlSeconds) : client.set(key, value)` → `{ result: 'OK' }`.
  - `del`: `await client.del(key)` → `{ result: <deletedCount> }`.
  Always `quit()` in `finally`.
- **Node `redis`** (new handler `redis.ts`): guard service; read `connectorId`, `operation` (default `get`), `key` (required, templated), `value` (templated, for set), `ttlSeconds` (number). Call service; return `[{ json: { value: result } }]` for `get`, `[{ json: { deleted: result } }]` for `del`, `[{ json: { ok: result } }]` for `set` (one passthrough-style item; preserve upstream item json by spreading the first input item if present).

### 4. Connector test route (per-type health check)

`POST /api/connectors/:id/test` (`apps/server/src/connectors-routes.ts`): the host branch must dispatch by `connector.type`:
- `postgres`/`mysql`/`microsoft-sql` → `createConnectorDb(type, config).query('select 1')` (existing path).
- `mongodb` → `createConnectorMongo(config)` then `db.command({ ping: 1 })`.
- `redis` → `createConnectorRedis(config)` then `client.ping()`.
Extract a single `testConnector(type, config) → Promise<void>` helper in bootstrap that performs the right probe per type and always closes; the route calls it, returns `{ ok:true }` / `{ ok:false, error: redact(...) }`, and audits the test. Plugin connectors keep the DHIS2 path.

### 5. Connectors UI

- `HOST_TYPES` gains `mysql` (Postgres/MySQL/Microsoft SQL/MongoDB/Redis).
- Replace the single `DB_FIELDS` with a per-type `CONNECTOR_TYPE_FIELDS: Record<string, TypeField[]>`:
  - `postgres`, `mysql`: host, port, database, user, password, ssl(bool).
  - `microsoft-sql`: host, port, database, user, password, encrypt(bool), trustServerCertificate(bool) — fixes the Slice-D gap where only `ssl` was collected.
  - `mongodb`: host, port, database, user, password, authSource(text, optional).
  - `redis`: host, port, password(optional), db(number, optional).
- The form renders the schema for the selected type; create payload `{ name, type, config }` unchanged. New i18n keys for the new field labels (`fieldAuthSource`, `fieldDb`, `fieldEncrypt`, `fieldTrustServerCert`) across en/fr/pt.

### 6. Components & boundaries

| Unit | Responsibility | New? |
|---|---|---|
| `connector-db.ts` mysql branch | type→Kysely(MysqlDialect) | edit |
| `connector-mongo.ts` `createConnectorMongo` | mongo client + db handle | new |
| `connector-redis.ts` `createConnectorRedis` | ioredis client | new |
| `testConnector(type,config)` (bootstrap) | per-type health probe | new |
| `connector-mongo-service.ts` `createConnectorMongoRunner` | resolve+op+close | new |
| `connector-redis-service.ts` `createConnectorRedisRunner` | resolve+op+quit | new |
| `runConnectorMongo`/`runConnectorRedis` on WorkflowServices | engine-facing | new (optional) |
| `mongo.ts` / `redis.ts` handlers | parse config, call service, rows→items | new |
| `mysql` descriptor + `mongodb`/`redis` descriptors | builder config | new |
| Connectors UI per-type fields | create mysql/mongo/redis connectors | edit |
| connectors `/:id/test` per-type branch | host health check | edit |

## Error handling

- All new services guard the connector (`get` → enabled + correct `type`), throw clear errors on missing/disabled/wrong-type; connection/op failures propagate as node errors (runner records them). Mongo `query` JSON parse failure → clear `Mongo node: invalid query JSON` error. Handlers guard the optional service (`requires server services`). Secrets never logged; `/test` errors `redact`ed; audit records type + `configKeys` only.

## Testing strategy

- `connector-db` mysql branch: construction test (no live connect) — returns `{query, close}`; invalid host/port throw (reuse the existing validators).
- `createConnectorMongoRunner` / `createConnectorRedisRunner`: unit tests with an **injected client factory** (mock) — assert op dispatch (find/aggregate/insertMany; get/set/del), ObjectId serialization (mongo), TTL passthrough (redis set), close/quit in `finally` even on op error, and the missing/disabled/wrong-type guards.
- `mongo`/`redis` handlers: unit with fake services — config parsing (incl. mongo query JSON parse + template), rows→items mapping, guards.
- `mysql` node: covered by the existing `connector-sql` handler test (already type-agnostic) + the new descriptor/constants wiring (typecheck).
- Connectors UI: extend the component test — selecting MongoDB renders authSource; Redis renders db/password (no database/user); create payload carries the right `type` + config keys.
- `testConnector`: unit with mocked factories asserting it calls the right probe per type and closes.
- **Live mysql/mongo/redis acceptance deferred** to the accept script (alongside the deferred pg/mssql `SELECT 1`).

## Out of scope / deferred

- Mongo: update/delete/count; SRV/Atlas URIs (discrete fields only in MVP). Redis: incr/expire/exists/pub-sub. Connection pooling/caching (ephemeral per call). Live DB e2e in the unit gate.

## Non-goals

- No change to the connector data model/migration (new types are just new `type` values). No second connectors UI. No change to the DHIS2 plugin path.

## Cross-package gate reminder

Adding optional `WorkflowServices` methods + new bootstrap services touches packages consumed by `apps/server`. Per the Slice C/D lesson, the gate MUST run `tsc` for `packages/workflows`, `packages/bootstrap`, AND `apps/server` (+ `apps/web`), not just the owning package.
