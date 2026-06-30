# Slice D — Connector Foundation + SQL Reference Nodes (Design)

**Date:** 2026-06-30
**Status:** Design / spec
**Relates to:** [workflow-node-palette inventory], [DHIS2 sink-plugin / connector workstream]

## Purpose

The workflow palette's database and communication nodes (`postgres`, `mysql`, `microsoft-sql`, `mongodb`, `redis`, `send-email`, `gmail`, `outlook`, `ftp`) all need stored, encrypted credentials for an external system. The repo already has a **Connector** primitive (encrypted `Record<string,string>` config, AES-256-GCM, CRUD, `getDecryptedConfig`) — but it is **plugin-coupled** (`plugin_id NOT NULL`, `kind='sink'`, DHIS2-shaped UI/health-check). Slice D **generalizes** that primitive to support host/native connectors and proves it end-to-end with two SQL reference nodes (**Postgres** and **Microsoft SQL**). Later slices add the remaining DB/comms connectors by reusing this foundation.

**Decisions locked during brainstorming:** (A) generalize the existing `connectors` table rather than add a parallel one; (full) end-to-end including the management UI; (reference) both Postgres and Microsoft SQL.

## What already exists (reused, not rebuilt)

- `ConnectorStore` — `packages/db/src/connector-store.ts`: `create/get/list/update/remove/getDecryptedConfig`; config is any `Record<string,string>` sealed with AES-256-GCM. Generic.
- Crypto — `packages/core/src/crypto.ts`: `parseSecretKey`, `seal`, `open`. Generic, reusable. Key = `SECRETS_ENCRYPTION_KEY` (`packages/config/src/schema.ts`).
- Connectors table — migration `packages/db/src/migrations/internal/033_connectors.ts`; type `ConnectorsTable` in `packages/db/src/schema/internal.ts` (id, name, plugin_id, kind, config_encrypted, allowed_host, enabled, created_at, updated_at).
- Options resolver — `apps/server/src/workflows-node-options.ts` `resolveNodeOptions` (`'connectors'` case filters by `pluginId`).
- Connectors routes — `apps/server/src/connectors-routes.ts` (`/api/connectors` CRUD + `/:id/test` + `/sink-plugins`).
- Connectors UI — `apps/web/src/pages/settings/Connectors.tsx` (DHIS2-shaped form).
- DB connection factories — `packages/adapter-db-store` (Kysely `PostgresDialect` + pg) and `packages/adapter-mssql-store` (`createMssqlStore(cfg)` → Kysely `MssqlDialect` + tedious + tarn; `{ db, transaction, healthCheck, close }`).
- Host SQL precedent — `sql-query` node → `ctx.services.runSql` → `SqlResult { columns, rows }` (`packages/workflows/src/engine/services.ts`).

## Architecture

### 1. Data model (additive migration)

New internal migration: on `connectors`, drop `NOT NULL` from `plugin_id` and add `type text NULL`.

- **Plugin connector** (existing, e.g. DHIS2): `plugin_id` set, `type` null. Unchanged.
- **Host connector** (new): `plugin_id` null, `type ∈ {postgres, microsoft-sql}` (extensible), `kind='database'`, `allowed_host` null.
- **Invariant (app-enforced, not a DB CHECK — cross-dialect):** exactly one of `{plugin_id, type}` is non-null.

`packages/db/src/schema/internal.ts`: `ConnectorsTable.plugin_id: string | null`, add `type: string | null`.

`connector-store.ts`:
- `ConnectorRecord` += `type: string | null`.
- `NewConnector`: `pluginId?: string | null`, `type?: string | null`, `kind` optional (caller supplies `'database'` for host, `'sink'` for plugin).
- `create` inserts `type`; `get`/`list` select + map `type`. Encryption path unchanged.

### 2. Connection service

New optional method on `WorkflowServices` (`packages/workflows/src/engine/services.ts`):

```ts
runConnectorSql?(input: { connectorId: string; sql: string }): Promise<SqlResult>;
```

Implemented in `packages/bootstrap/src/index.ts` (has `connectorStore`, `cfg.SECRETS_ENCRYPTION_KEY`, and the adapter factories):

1. `connectorStore.get(connectorId)` → must exist + `enabled` + have a host `type`; else throw a clear error.
2. `connectorStore.getDecryptedConfig(connectorId, secretsKey)` → `{ host, port, database, user, password, ssl? }`.
3. `createConnectorDb(type, config)` (shared bootstrap helper) builds a Kysely connection via the matching factory (`adapter-db-store` for `postgres`, `createMssqlStore` for `microsoft-sql`); unsupported `type` → throw.
4. `sql.raw(userSql).execute(db)` → derive `columns` from row keys, return `{ columns, rows }`.
5. **`finally` → close the connection** (ephemeral per call; pooling-by-connector deferred).

`createConnectorDb` is also used by the connector test route (§6) so dialect/connection logic lives in one place.

**SQL semantics:** the node runs whatever SQL the workflow author provides (parity with the existing `sql-query` node and with n8n). Connectors are operator-created and editing workflows requires the MANAGE permission, so this is the authorized trust boundary; no statement allow-listing in MVP.

### 3. Nodes — `postgres` and `microsoft-sql`

One shared handler `connector-sql` (`packages/workflows/src/engine/node-handlers/connector-sql.ts`), registered in `ACTION_HANDLERS` under **both** `'postgres'` and `'microsoft-sql'`:

- Guard `!ctx.services?.runConnectorSql` → throw `'<Node> requires server services'`.
- `connectorId = config.connectorId` (required; throw if blank).
- `sql = resolveTemplate(String(config.sql ?? ''), ctx, input)`; throw if empty.
- `const result = await ctx.services.runConnectorSql({ connectorId, sql })`; return `rowsToItems(result.rows)`.

The connector's `type` (read server-side from the record) drives the dialect, so the handler is dialect-agnostic. Two descriptors in `host-nodes.ts`, both `kind: 'transform'` with `ports: { inputs:[in], outputs:[out] }` (in+out so the `sql` field can template `{{ }}` off upstream items), differing only in the connector filter:

- `postgres`: `config: [{ key:'connectorId', type:'select', required:true, optionsSource:'connectors:postgres' }, { key:'sql', type:'text', required:true }]`
- `microsoft-sql`: same with `optionsSource:'connectors:microsoft-sql'`.

`constants.ts`: replace the `postgres` and `microsoft-sql` palette entries with default config `{ connectorId:'', sql:'' }`; add both ids to `IMPLEMENTED_TEMPLATE_IDS`.

### 4. Typed options resolver

`resolveNodeOptions` (`apps/server/src/workflows-node-options.ts`): when `source` matches `connectors:<type>`, filter `connectors.list()` by `c.type === <type>`; bare `connectors` keeps the existing `pluginId` filter. `NodeOptionsDeps.connectors.list()` must now return `type` (and the route wiring that supplies it).

### 5. Connectors management UI

Generalize `apps/web/src/pages/settings/Connectors.tsx`:

- A **connector kind** selector: *Plugin* (existing pluginId picker + DHIS2 baseUrl/username/password) vs *Database* (type picker: Postgres / Microsoft SQL).
- A data-driven per-type field schema, e.g. `CONNECTOR_TYPE_FIELDS: Record<string, Field[]>` with `postgres`/`microsoft-sql` → `[host, port (number), database, user, password (secret), ssl (boolean)]`. Adding a future type = one entry.
- Create payload: host → `{ name, type, config }`; plugin → `{ name, pluginId, config }` (unchanged).
- List view shows a Type/Plugin column. Edit keeps the password-blank-means-unchanged behavior.
- Supported host types are a frontend constant for MVP (`postgres`, `microsoft-sql`); extensible.

### 6. Routes

`apps/server/src/connectors-routes.ts`:
- `POST /api/connectors`: accept `type` (host) **or** `pluginId` (plugin); reject if neither/both. Host: `kind='database'`, `allowed_host=null`, no baseUrl derivation. Plugin path unchanged.
- `POST /api/connectors/:id/test`: branch on the record — plugin → existing DHIS2 health check; host → `createConnectorDb` + `SELECT 1` → `{ ok: true }` or `{ ok:false, error }`.
- `GET /api/connectors` + `/:id`: include `type` in the safe projection.

### 7. Error handling

- Service: connector missing/disabled/wrong-or-missing type → descriptive `Error`; connection or query failure propagates and is recorded as a node error by the runner. Handler guards the optional service. Secrets stay within the existing redaction boundary (never logged; audit records `configKeys` only).

### 8. Components & boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| migration + `ConnectorsTable` | nullable plugin_id + `type` column | — |
| `connector-store` (edit) | persist/return `type`; encrypt config | `@openldr/core` crypto |
| `createConnectorDb` (bootstrap) | type → Kysely connection | adapter-db-store / adapter-mssql-store |
| `runConnectorSql` (bootstrap) | resolve+decrypt connector, run SQL, close | createConnectorDb, connectorStore |
| `connector-sql` handler | template SQL, call service, rows→items | runConnectorSql service |
| options resolver (edit) | `connectors:<type>` filter | connectors.list (+type) |
| connectors routes (edit) | host create + host test branch | connectorStore, createConnectorDb |
| Connectors UI (edit) | type-aware create/edit form | connectors API |

## Testing strategy

- `connector-store`: `type` create/get/list round-trip (host connector with `type`, plugin connector with `pluginId`).
- `connector-sql` handler: unit with a fake `runConnectorSql` — asserts template resolution, connectorId/sql passthrough, rows→items, and the missing-service + empty-sql guards.
- `runConnectorSql` service: unit with a **mocked `createConnectorDb`** — asserts it selects the right dialect by `type`, runs the SQL, maps rows, and calls `close()` in `finally` even on query error; unsupported type throws.
- options resolver: `connectors:postgres` returns only `type==='postgres'`; bare `connectors` unchanged.
- routes: host-connector create (type) persists `type`/`kind='database'`; reject neither/both of `{type,pluginId}`.
- UI: type-driven form renders the right fields per selected type; create payload shape per kind.
- **Live DB acceptance deferred** to a `scripts/`-based accept script (pattern of `mssql:accept`/`dhis2:accept`) running a real pg + mssql `SELECT 1` and a query through a seeded connector — out of the unit gate.

## Out of scope / deferred

- `mysql` (Slice E, reuse `runConnectorSql` + add a mysql factory), `mongodb`/`redis` (non-SQL — own service methods + node shapes, Slice E), `send-email`/`gmail`/`outlook`/`ftp` (reuse the connector model with their own services, Slice F).
- Connection pooling/caching by connector (ephemeral per-call in MVP).
- Per-statement SQL allow-listing / read-only mode.
- Live pg/mssql e2e in the unit gate (accept script instead).

## Non-goals

- No second "connectors" concept/UI (single generalized page).
- No change to the DHIS2 plugin-connector create/health path beyond exposing `type` in projections.
