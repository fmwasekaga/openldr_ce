# MSSQL External Target — Slice 2: Dialect-aware connector SQL execution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Query workbench, Custom Queries, and Report Designer execute user-authored SQL against a SQL Server (`microsoft-sql`) connector — closing the Postgres-only gate so the `Target Warehouse (SQL Server)` connector seeded in Slice 1 is fully usable.

**Architecture:** All three surfaces run through "Path A" — they build a Postgres `select * from (…) limit N offset M` wrapper and call `runConnectorSql`, which resolves the connector (knowing its type) and executes the raw SQL. The fix centralizes the row-cap/pagination wrapper **inside** `runConnectorSql` so it emits dialect-correct SQL (Postgres `LIMIT/OFFSET` vs T-SQL `OFFSET…FETCH`) based on the resolved connector type; callers stop building the wrapper themselves. Then: open the `/api/query` connector gate to `microsoft-sql`, make schema/table introspection dialect-aware, and make the studio's table-tab identifier quoting dialect-aware (`"x"` vs `[x]`).

**Tech Stack:** TypeScript, Kysely, Fastify, vitest, React/Zustand (studio).

---

## Scope

**In scope (Path A — user-authored SQL over a connector):**
- `/api/query/run` (workbench Run), `runStoredQuery` (Custom Queries + Report Designer table bindings), `/api/query/param-options`.
- Connector-list gate (`SQL_TYPES`), schema/table introspection, studio table-tab SQL quoting.

**Out of scope (deferred — separate follow-up "Slice 2b"):**
- `runSqlQuery` in `packages/dashboards/src/sql-runner.ts` (Path B — the `dashboard.raw_sql` widget path; its read-only-txn/`statement_timeout` semantics are Postgres-specific).
- Rewriting the **built-in data-driven report queries** (`packages/reporting/src/seed/report-seeds.ts`) to be dialect-portable — they use Postgres SQL (`age()`, etc.) and, per Slice 1, are NOT seeded on an MSSQL install (connector-name divergence), so they don't execute there. Making them run on MSSQL is the query-model-expansion effort.
- The `dashboard.raw_sql` feature flag is already gated to `pg` in `apps/server/src/app.ts` — leave it.

## Context the engineer needs

- **The dialect source is the connector type.** Connector `type` is `'postgres'` | `'microsoft-sql'` | `'mysql'` (see `packages/bootstrap/src/connector-db.ts`). This slice adds `microsoft-sql`; `mysql` stays out of the query gate (its own effort).
- **`runConnectorSql`** is `packages/bootstrap/src/connector-sql-service.ts` → `createConnectorSqlRunner`. It resolves the connector (`c.type`), builds an ephemeral `createConnectorDb(type, config)` connection, runs `conn.query(userSql)`, and closes. It's ALSO used by workflow SQL nodes (which pass raw SQL, no pagination) — so any new pagination param MUST be optional and default to no-op.
- **Three current Postgres wrapper sites** (all `select * from (${inner}) as _q limit …`): `apps/server/src/query-routes.ts:107` (`/api/query/run`, with offset), `packages/dashboards/src/custom-query-run.ts:65` (`runStoredQuery`, limit-only), and `packages/dashboards/src/sql-runner.ts` (Path B — OUT of scope). This slice removes the wrapper from the first two by pushing it into `runConnectorSql`.
- **T-SQL pagination requires `ORDER BY`.** `OFFSET n ROWS FETCH NEXT m ROWS ONLY` is invalid without an `ORDER BY`; `ORDER BY (SELECT NULL)` is the standard stable no-op ordering when wrapping an arbitrary subquery.
- **Introspection** (`query-routes.ts` `/schemas` and `/schemas/:schema/tables`) uses `information_schema`, which exists on SQL Server too, but the current WHERE clauses filter Postgres system schemas (`pg_catalog`, `pg\_%`). SQL Server system schemas to exclude: `sys`, `INFORMATION_SCHEMA`, `guest`, `db_owner`, `db_accessadmin`, `db_securityadmin`, `db_ddladmin`, `db_backupoperator`, `db_datareader`, `db_datawriter`, `db_denydatareader`, `db_denydatawriter`.
- **Studio table-tab SQL** is built in `apps/studio/src/query/store.ts` `openTableTab` as `select * from "${schema}"."${table}"`. The studio knows each connector's `type` (from `/api/query/connectors`). Quoting must be `[schema].[table]` for `microsoft-sql`. `TabBar.tsx:13` compares against this exact string to detect "edited" — keep it consistent.
- **Do NOT add a Co-Authored-By trailer.** Windows / Git Bash; pnpm. Gate: `pnpm --filter <pkg> test` + `typecheck`. Cross-package type changes need the consuming packages typechecked too (`@openldr/bootstrap`, `apps/server`, `apps/studio`).

## File structure

- **Modify** `packages/dashboards/src/sql-runner.ts` — add a pure, exported `paginateSql(inner, dialect, {limit, offset})` helper (co-located with `validateSelectSql`, exported via the package barrel).
- **Modify** `packages/dashboards/src/custom-query-run.ts` — `runStoredQuery` stops building the wrapper; passes `rowCap` to `runConnectorSql`.
- **Modify** `packages/bootstrap/src/connector-sql-service.ts` — `runConnectorSql` accepts optional `{ rowCap?, offset? }` and applies `paginateSql` with the resolved connector's dialect.
- **Modify** `apps/server/src/query-routes.ts` — `/api/query/run` passes `rowCap`/`offset` instead of building `pageSql`; `SQL_TYPES` gains `microsoft-sql`; introspection queries become dialect-aware; the `QueryRouteDeps.runConnectorSql` type gains the optional opts.
- **Modify** `apps/studio/src/query/store.ts` (+ callers passing connector type) — dialect-aware table-tab quoting.
- Test files alongside each.

---

### Task 1: `paginateSql` dialect helper (pure, TDD)

**Files:**
- Modify: `packages/dashboards/src/sql-runner.ts`
- Test: `packages/dashboards/src/sql-runner.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Add to `packages/dashboards/src/sql-runner.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { paginateSql } from './sql-runner';

describe('paginateSql', () => {
  it('wraps Postgres with LIMIT/OFFSET', () => {
    expect(paginateSql('select 1', 'postgres', { limit: 100, offset: 0 }))
      .toBe('select * from (select 1) as _q limit 100 offset 0');
  });
  it('wraps Postgres with a non-zero offset', () => {
    expect(paginateSql('select 1', 'postgres', { limit: 50, offset: 25 }))
      .toBe('select * from (select 1) as _q limit 50 offset 25');
  });
  it('wraps MSSQL with ORDER BY (SELECT NULL) OFFSET/FETCH', () => {
    expect(paginateSql('select 1', 'mssql', { limit: 100, offset: 0 }))
      .toBe('select * from (select 1) as _q order by (select null) offset 0 rows fetch next 100 rows only');
  });
  it('wraps MSSQL with a non-zero offset', () => {
    expect(paginateSql('select 1', 'mssql', { limit: 50, offset: 25 }))
      .toBe('select * from (select 1) as _q order by (select null) offset 25 rows fetch next 50 rows only');
  });
  it('defaults offset to 0 and floors non-integers', () => {
    expect(paginateSql('select 1', 'postgres', { limit: 10.9 }))
      .toBe('select * from (select 1) as _q limit 10 offset 0');
    expect(paginateSql('select 1', 'mssql', { limit: 10.9 }))
      .toBe('select * from (select 1) as _q order by (select null) offset 0 rows fetch next 10 rows only');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @openldr/dashboards test -- sql-runner`
Expected: FAIL — `paginateSql` not exported.

- [ ] **Step 3: Implement**

In `packages/dashboards/src/sql-runner.ts`, add (near `validateSelectSql`):

```ts
export type SqlDialect = 'postgres' | 'mssql';

/** Wrap an inner SELECT with a dialect-correct row-cap + offset. Postgres uses LIMIT/OFFSET;
 *  SQL Server uses OFFSET…FETCH, which requires an ORDER BY — `(SELECT NULL)` is a stable no-op
 *  order for an arbitrary wrapped subquery. */
export function paginateSql(inner: string, dialect: SqlDialect, opts: { limit: number; offset?: number }): string {
  const limit = Math.floor(opts.limit);
  const offset = Math.floor(opts.offset ?? 0);
  if (dialect === 'mssql') {
    return `select * from (${inner}) as _q order by (select null) offset ${offset} rows fetch next ${limit} rows only`;
  }
  return `select * from (${inner}) as _q limit ${limit} offset ${offset}`;
}
```

Confirm `@openldr/dashboards`'s barrel (`packages/dashboards/src/index.ts`) re-exports `sql-runner` (it does: `export * from './sql-runner'`), so `paginateSql` + `SqlDialect` are available to `@openldr/bootstrap` and `apps/server`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @openldr/dashboards test -- sql-runner`
Expected: PASS (all 5).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @openldr/dashboards typecheck` (exit 0).
```bash
git add packages/dashboards/src/sql-runner.ts packages/dashboards/src/sql-runner.test.ts
git commit -m "feat(mssql): paginateSql dialect helper (postgres LIMIT/OFFSET, mssql OFFSET/FETCH)"
```

---

### Task 2: Centralize dialect-aware pagination in `runConnectorSql`

**Files:**
- Modify: `packages/bootstrap/src/connector-sql-service.ts`
- Test: `packages/bootstrap/src/connector-sql-service.test.ts`

- [ ] **Step 1: Read the current runner + its test**

Read `packages/bootstrap/src/connector-sql-service.ts` and `connector-sql-service.test.ts`. Note the returned function signature `({ connectorId, sql }) => Promise<SqlResult>` and that `SqlResult` comes from `@openldr/workflows`.

- [ ] **Step 2: Write failing tests**

Add to `connector-sql-service.test.ts` (match the file's existing fake-connector setup; the existing tests already stub `createDb` to a fake `ConnectorDb` capturing the executed SQL — reuse that capture):

```ts
it('applies a Postgres LIMIT/OFFSET wrapper when rowCap is given (type=postgres)', async () => {
  const seen: string[] = [];
  const run = createConnectorSqlRunner({
    connectors: connectorsFake({ type: 'postgres', enabled: true }),
    secretsKey: 'k',
    createDb: () => ({ query: async (s: string) => { seen.push(s); return { rows: [] }; }, close: async () => {} }) as never,
  });
  await run({ connectorId: 'c1', sql: 'select * from t', rowCap: 100, offset: 0 });
  expect(seen[0]).toBe('select * from (select * from t) as _q limit 100 offset 0');
});

it('applies a T-SQL OFFSET/FETCH wrapper when rowCap is given (type=microsoft-sql)', async () => {
  const seen: string[] = [];
  const run = createConnectorSqlRunner({
    connectors: connectorsFake({ type: 'microsoft-sql', enabled: true }),
    secretsKey: 'k',
    createDb: () => ({ query: async (s: string) => { seen.push(s); return { rows: [] }; }, close: async () => {} }) as never,
  });
  await run({ connectorId: 'c1', sql: 'select * from t', rowCap: 100 });
  expect(seen[0]).toBe('select * from (select * from t) as _q order by (select null) offset 0 rows fetch next 100 rows only');
});

it('runs raw SQL unwrapped when rowCap is omitted (workflow node path)', async () => {
  const seen: string[] = [];
  const run = createConnectorSqlRunner({
    connectors: connectorsFake({ type: 'postgres', enabled: true }),
    secretsKey: 'k',
    createDb: () => ({ query: async (s: string) => { seen.push(s); return { rows: [] }; }, close: async () => {} }) as never,
  });
  await run({ connectorId: 'c1', sql: 'select 1' });
  expect(seen[0]).toBe('select 1');
});
```

If the file's fake helper is named differently than `connectorsFake`, use the actual one. If existing tests don't capture executed SQL, add a capturing fake as above.

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @openldr/bootstrap test -- connector-sql-service`
Expected: FAIL — the runner ignores `rowCap`/`offset` and runs `sql` verbatim.

- [ ] **Step 4: Implement**

In `connector-sql-service.ts`:
- Import the helper: `import { paginateSql, type SqlDialect } from '@openldr/dashboards';`
- Add a type→dialect map (only the two SQL_TYPES this slice supports get a dialect; others → no wrap):
```ts
function dialectFor(type: string): SqlDialect | null {
  if (type === 'postgres') return 'postgres';
  if (type === 'microsoft-sql') return 'mssql';
  return null;
}
```
- Change the returned function to accept optional `rowCap`/`offset` and wrap when `rowCap` is set AND the connector has a known dialect:
```ts
return async ({ connectorId, sql: userSql, rowCap, offset }: { connectorId: string; sql: string; rowCap?: number; offset?: number }): Promise<SqlResult> => {
    const c = await deps.connectors.get(connectorId);
    if (!c || !c.enabled) throw new Error(`connector ${connectorId} not found or disabled`);
    if (!c.type) throw new Error(`connector ${connectorId} is not a database connector`);
    const config = await deps.connectors.getDecryptedConfig(connectorId, deps.secretsKey);
    const conn = make(c.type, config);
    try {
      const dialect = dialectFor(c.type);
      const finalSql = (rowCap !== undefined && dialect)
        ? paginateSql(userSql.replace(/;\s*$/, ''), dialect, { limit: rowCap, offset })
        : userSql;
      const { rows } = await conn.query(finalSql);
      const columns = rows[0] ? Object.keys(rows[0]).map((k) => ({ key: k, label: k })) : [];
      return { columns, rows };
    } finally {
      await conn.close();
    }
  };
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @openldr/bootstrap test -- connector-sql-service`
Expected: PASS (new 3 + existing).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @openldr/bootstrap typecheck` (exit 0).
```bash
git add packages/bootstrap/src/connector-sql-service.ts packages/bootstrap/src/connector-sql-service.test.ts
git commit -m "feat(mssql): runConnectorSql applies dialect-aware pagination by connector type"
```

---

### Task 3: `runStoredQuery` delegates pagination to `runConnectorSql`

**Files:**
- Modify: `packages/dashboards/src/custom-query-run.ts`
- Test: `packages/dashboards/src/custom-query-run.test.ts`

- [ ] **Step 1: Update the `RunStoredQueryDeps.runConnectorSql` type + call**

Read `packages/dashboards/src/custom-query-run.ts`. The `RunStoredQueryDeps.runConnectorSql` type must gain optional `rowCap`/`offset`. Update its type to:
```ts
runConnectorSql(input: { connectorId: string; sql: string; rowCap?: number; offset?: number }): Promise<{ columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }>;
```
Change `runStoredQuery` (line ~65) to pass the inner SQL + `rowCap` instead of the Postgres wrapper:
```ts
  const inner = prepareSelect(rec.sql, rec.params, values).replace(/;\s*$/, '');
  return deps.runConnectorSql({ connectorId: rec.connectorId, sql: inner, rowCap: ROW_CAP });
```
(Remove the `const sql = \`select * from (${inner}) as _q limit ${ROW_CAP}\`;` line.)

- [ ] **Step 2: Update the test**

In `custom-query-run.test.ts`, the existing `runStoredQuery` test asserts the wrapped SQL string passed to `runConnectorSql`. Update its expectation: `runConnectorSql` now receives `{ connectorId, sql: <inner>, rowCap: <ROW_CAP> }` (inner SQL, no `select * from (…) limit` wrapper). Assert the deps mock is called with the inner SQL and `rowCap` equal to the module's ROW_CAP.

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @openldr/dashboards test -- custom-query-run`
Expected: PASS.

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm --filter @openldr/dashboards typecheck` (exit 0).
```bash
git add packages/dashboards/src/custom-query-run.ts packages/dashboards/src/custom-query-run.test.ts
git commit -m "refactor(mssql): runStoredQuery delegates row-cap to dialect-aware runConnectorSql"
```

---

### Task 4: Open the query gate + dialect-aware run/introspection in `query-routes.ts`

**Files:**
- Modify: `apps/server/src/query-routes.ts`
- Test: `apps/server/src/query-routes.test.ts`

- [ ] **Step 1: Update `QueryRouteDeps.runConnectorSql` type**

Change the `runConnectorSql` signature in `QueryRouteDeps` (line ~24) to include the optional opts:
```ts
runConnectorSql(input: { connectorId: string; sql: string; rowCap?: number; offset?: number }): Promise<{ columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }>;
```

- [ ] **Step 2: `/api/query/run` — delegate pagination**

Replace the `pageSql` construction + call (lines ~103-110). Instead of building `select * from (${inner}) as _q limit … offset …`, pass the inner SQL + `rowCap`/`offset` to `runConnectorSql`:
```ts
    inner = inner.replace(/;\s*$/, '');
    const cap = Math.min(parsed.data.limit ?? ROW_CAP, ROW_CAP);
    try {
      const started = Date.now();
      const { columns, rows } = await deps.runConnectorSql({ connectorId: parsed.data.connectorId, sql: inner, rowCap: cap, offset: parsed.data.offset ?? 0 });
      const capped = rows.slice(0, ROW_CAP);
```
The `count(*)` total query (line ~116) wraps `inner` in `select count(*) as _n from (${inner}) as _q` — that subquery form is valid on BOTH Postgres and T-SQL, so leave it (no pagination on it). Verify it still reads `inner` (not the removed `pageSql`).

- [ ] **Step 3: Open the connector gate**

Change `SQL_TYPES` (line ~128):
```ts
const SQL_TYPES = new Set(['postgres', 'microsoft-sql']);
```
Update the nearby comment to note SQL Server is now supported and the pagination/quoting are dialect-aware.

- [ ] **Step 4: Dialect-aware introspection**

The `/schemas` and `/schemas/:schema/tables` routes run `information_schema` queries with Postgres-specific system-schema filters. Make them branch on the connector type. Add a helper near the routes:
```ts
const PG_SYS = "schema_name not in ('pg_catalog','information_schema') and schema_name not like 'pg\\_%'";
const MSSQL_SYS = "schema_name not in ('sys','INFORMATION_SCHEMA','guest','db_owner','db_accessadmin','db_securityadmin','db_ddladmin','db_backupoperator','db_datareader','db_datawriter','db_denydatareader','db_denydatawriter')";
```
In `/schemas`, resolve the connector, pick the filter by `c.type` (`microsoft-sql` → `MSSQL_SYS`, else `PG_SYS`), and interpolate into the existing `select schema_name from information_schema.schemata where <filter> order by 1`. The `/schemas/:schema/tables` route already filters by an exact `table_schema = '<safeSchema>'` (portable) — leave it, but keep the bare-identifier validation.

- [ ] **Step 5: Update tests**

In `query-routes.test.ts`: (a) the existing `/api/query/run` test that asserts the SQL passed to `runConnectorSql` must now expect the INNER sql + `rowCap`/`offset` opts (no `pageSql` wrapper). (b) Add a test that `/api/query/connectors` now includes a `microsoft-sql` connector. (c) Add a test that `/schemas` uses the MSSQL system-schema filter for a `microsoft-sql` connector (assert the SQL passed to the mocked `runConnectorSql` contains `sys` / not `pg_catalog`). Match the file's existing mocking style.

- [ ] **Step 6: Run tests + cross-package typecheck**

Run: `pnpm --filter @openldr/server test -- query-routes` (PASS) and `pnpm --filter @openldr/server typecheck` (exit 0). Also `pnpm --filter @openldr/bootstrap typecheck` (the runConnectorSql wiring in bootstrap index must still satisfy the updated type).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/query-routes.ts apps/server/src/query-routes.test.ts
git commit -m "feat(mssql): /api/query supports microsoft-sql — dialect-aware run + introspection"
```

---

### Task 5: Dialect-aware table-tab quoting in the studio

**Files:**
- Modify: `apps/studio/src/query/store.ts`
- Modify: the tree component that calls `openTableTab` (pass the connector type) — locate via `grep -rn "openTableTab" apps/studio/src/query`
- Test: `apps/studio/src/query/store.test.ts`

- [ ] **Step 1: Thread the connector dialect into `openTableTab`**

`openTableTab({ connectorId, schema, table })` builds `select * from "${schema}"."${table}"`. Add a `type` (connector type) to its argument and quote per dialect. Update the `State` interface's `openTableTab` signature and the store impl:
```ts
openTableTab(t: { connectorId: string; type: string; schema: string; table: string }): void;
```
```ts
  openTableTab({ connectorId, type, schema, table }) {
    const existing = get().tabs.find((t) => t.kind === 'table' && t.connectorId === connectorId && t.schema === schema && t.table === table);
    if (existing) { set({ activeId: existing.id }); return; }
    const sql = type === 'microsoft-sql'
      ? `select * from [${schema}].[${table}]`
      : `select * from "${schema}"."${table}"`;
    const tab: TableTab = { id: nextId(), kind: 'table', connectorId, schema, table, title: table, sql, showSql: false };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },
```

- [ ] **Step 2: Update the caller + the `TabBar` edited-check**

Find the tree node that calls `openTableTab` (in `apps/studio/src/query/tree/`); it has the connector in scope (connectors are listed with `type`). Pass `type`. In `apps/studio/src/query/workspace/TabBar.tsx:13`, the "edited" check compares `t.sql !== \`select * from "${t.schema}"."${t.table}"\``. Make it dialect-aware too — reconstruct the default per the tab's connector type. Simplest: store the connector `type` on the `TableTab` model (add `type: string` to the model in `store.ts`) and have `TabBar` compute the default the same way. Add `type` to `TableTab` and set it in `openTableTab`; update `isEdited` in TabBar to:
```ts
const def = t.type === 'microsoft-sql' ? `select * from [${t.schema}].[${t.table}]` : `select * from "${t.schema}"."${t.table}"`;
return t.kind === 'table' && t.sql !== def;
```

- [ ] **Step 3: Update tests**

In `store.test.ts`, the `openTableTab` tests pass `{ connectorId, schema, table }` — add `type: 'postgres'` and assert the Postgres-quoted sql, plus a new case with `type: 'microsoft-sql'` asserting `select * from [public].[products]`. Update `TableTab.test.tsx` if it constructs a `TableTabModel` (add `type`).

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @openldr/studio test -- query/store` and `-- TableTab` (PASS), `pnpm --filter @openldr/studio typecheck` (exit 0).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/query/store.ts apps/studio/src/query/workspace/TabBar.tsx apps/studio/src/query/tree apps/studio/src/query/store.test.ts apps/studio/src/query/workspace/TableTab.test.tsx
git commit -m "feat(mssql): studio table-tab SQL quotes identifiers per connector dialect"
```

---

### Task 6: Live end-to-end verification against a real SQL Server connector

**Files:** none (verification; may produce a fix commit).

Validates the whole Path A against a live SQL Server, using the dev server + the Slice-0 acceptance container. Docker is available.

- [ ] **Step 1: Boot a SQL Server 2022 container with a seeded table**

```bash
docker rm -f openldr-mssql-s2 >/dev/null 2>&1; \
docker run -d --name openldr-mssql-s2 -e ACCEPT_EULA=Y -e 'MSSQL_SA_PASSWORD=Openldr_Local_2026!' -p 11433:1433 mcr.microsoft.com/mssql/server:2022-latest && sleep 30 && \
MSYS_NO_PATHCONV=1 docker exec openldr-mssql-s2 /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P 'Openldr_Local_2026!' -C -Q "CREATE DATABASE openldr_target;" && \
MSYS_NO_PATHCONV=1 docker exec openldr-mssql-s2 /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P 'Openldr_Local_2026!' -C -d openldr_target -Q "CREATE SCHEMA app; CREATE TABLE app.widgets(id int primary key, name nvarchar(100)); INSERT INTO app.widgets VALUES (1,'alpha'),(2,'beta'),(3,'gamma');"
```

- [ ] **Step 2: Drive Path A via a throwaway integration script**

Because the full studio requires Keycloak, exercise the server-side Path A directly with a small `tsx` script (mirrors how `scripts/mssql-live-acceptance.ts` imports workspace source). Create a TEMPORARY script `scripts/tmp-mssql-query-check.ts` (delete after) that:
  1. Builds a `microsoft-sql` `ConnectorDb` config `{ host:'localhost', port:'11433', database:'openldr_target', user:'sa', password:'Openldr_Local_2026!', encrypt:'false', trustServerCertificate:'true' }`.
  2. Calls the real `createConnectorSqlRunner` with a fake connector store returning `{ type:'microsoft-sql', enabled:true }` + a `getDecryptedConfig` returning that config, and `createDb: createConnectorDb`.
  3. Runs `run({ connectorId:'x', sql:'select id, name from app.widgets', rowCap: 2, offset: 1 })` and asserts it returns exactly rows `{id:2,name:'beta'},{id:3,name:'gamma'}`... (i.e. offset 1, 2 rows — the OFFSET/FETCH wrapper works over real SQL Server). Print PASS/FAIL.
  Run: `node_modules/.bin/tsx scripts/tmp-mssql-query-check.ts`
  Expected: prints the 2 paginated rows and PASS. This proves the T-SQL `OFFSET…FETCH` wrapper executes correctly on a real server (the thing unit tests can't prove).

- [ ] **Step 3: Verify introspection SQL is valid T-SQL**

In the same script (or a second run), execute the introspection queries against the real server via the runner:
  - `select schema_name from information_schema.schemata where <MSSQL_SYS filter> order by 1` → assert `app` appears and `sys`/`INFORMATION_SCHEMA` do not.
  - `select table_name from information_schema.tables where table_schema = 'app' order by 1` → assert `widgets` appears.
  Expected: both succeed (valid T-SQL) with the expected rows.

- [ ] **Step 4: Clean up**

```bash
rm -f scripts/tmp-mssql-query-check.ts
docker rm -f openldr-mssql-s2
```

- [ ] **Step 5: If a step failed, fix + re-verify.** Commit any fix (no trailer). Verification task — no commit unless a fix was needed.

---

## Self-review notes

- **Spec coverage (Slice 2, Path A):** dialect-aware pagination → Tasks 1+2; Custom Queries + Report Designer (both via `runStoredQuery`) → Task 3; workbench run + gate + introspection → Task 4; studio identifier quoting → Task 5; live proof the T-SQL wrapper/introspection execute → Task 6. Path B (`runSqlQuery`) + built-in-report content are explicitly deferred and documented.
- **No placeholders:** `paginateSql` output strings are asserted exactly; the three wrapper sites and the `SQL_TYPES` gate are cited with line numbers; the MSSQL system-schema list is complete.
- **Type consistency:** the optional `{ rowCap?, offset? }` opts are added consistently to `runConnectorSql` in three type decls (`connector-sql-service` impl, `RunStoredQueryDeps`, `QueryRouteDeps`); `paginateSql`/`SqlDialect` come from one place (`@openldr/dashboards`).
- **Risk:** widening `runConnectorSql`'s param is safe for the workflow-node callers because `rowCap` is optional (omitted → raw SQL, identical to today). Task 2's third test locks this in.

## Deferred to Slice 2b (not this plan)

- `packages/dashboards/src/sql-runner.ts` `runSqlQuery` (Path B / `dashboard.raw_sql`): dialect-aware read-only transaction, timeout (`SET LOCK_TIMEOUT` vs `statement_timeout`), and pagination — then lift the `dashboard.raw_sql` pg-only gate in `apps/server/src/app.ts`.
- Making the built-in data-driven report queries (`@openldr/reporting` `report-seeds.ts`) dialect-portable so they can be seeded + run on MSSQL (query-model-expansion tie-in).
- MySQL in the `/api/query` gate (separate dialect effort).
