# MySQL/MariaDB External Target — S2 (Dialect-Aware Read Surfaces) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MySQL 8.4 / MariaDB 11.4 a full peer of Postgres/SQL Server across every OpenLDR read surface — the dashboards raw-SQL runner, the `/query` workbench (connector list, introspection, custom queries), the Report Designer, and all built-in data-driven reports — by threading `SqlDialect += 'mysql'` through the runner/query-route/report-seed seams, adding a MySQL variant of each built-in report query, and registering the mysql warehouse connector so reports seed on a mysql target.

**Architecture:** S0 delivered the write path; S1 delivered install-time target selection (a mysql install boots, migrates, seeds a `Target Warehouse (MySQL/MariaDB)` connector — but built-in reports were intentionally skipped and the read surfaces filtered mysql out). S2 finishes the seams. Much of the read path is already mysql-aware from earlier connector work: `packages/bootstrap/src/connector-db.ts` builds a mysql `Kysely`+`MysqlDialect` connection, `connector-sql-service.ts` already routes mysql through the Postgres LIMIT/OFFSET pagination wrapper, and `connector-test.ts` already lists mysql. S2 closes the remaining gaps: (a) the dashboards raw-SQL runner (`sql-runner.ts`) gets a `'mysql'` engine branch (portable per-engine statement timeout, no read-only txn — mirroring the mssql rationale); (b) `query-routes.ts` lists + introspects mysql connectors; (c) the studio's table-preview identifier quoting learns backticks; (d) `report-seeds.ts` gains a third SQL variant per built-in report and registers the mysql warehouse connector name so `seedDataDrivenReports` resolves it and picks the `mysql` variant; (e) the two S1 tracking items (3-way engine derivation at `index.ts:435`; an explicit strict-TLS-verify knob on the mysql adapter) land; (f) a `reports:parity` harness proves pg-vs-mysql equivalence on both engines.

**Tech Stack:** TypeScript, kysely (`MysqlDialect` + mysql2), zod (`@openldr/config`), vitest, MySQL 8.4, MariaDB 11.4, tsx (live scripts), throwaway Playwright (`e2e/*.mjs`).

**Dev shortcuts used (flagged up front, per project convention):** the live e2e (Task 10) runs the **dev API** (`node apps/server/dev.mjs`, NO `--watch`) against **throwaway `mysql:8.4` / `mariadb:11.4` containers**, dev Postgres on :5433, and sets **`AUTH_DEV_BYPASS=true`** to skip Keycloak while driving the `/query` + Report Designer UI via throwaway `e2e/*.mjs` Playwright — dev/test only, never production. `reports:parity` (Task 9) is a **live acceptance script** (like the mssql one), not a committed unit test. All gates run **per-package** (`pnpm --filter <pkg> exec vitest run` / `tsc --noEmit`) — NEVER pipe turbo through `tail`.

---

## Background the engineer needs

**`SqlDialect` is declared in TWO places (both must be widened):**
1. `packages/dashboards/src/sql-runner.ts` — `export type SqlDialect = 'postgres' | 'mssql'` — the source of truth, imported by `@openldr/bootstrap`'s `connector-sql-service.ts`.
2. `packages/reporting/src/seed/report-seeds.ts` — a **local re-declaration** (`type SqlDialect = 'postgres' | 'mssql'`) with a doc comment explaining it is intentionally NOT imported from `@openldr/dashboards` to avoid a package cycle (`@openldr/dashboards` already depends on `@openldr/reporting`). Keep the re-declaration; just widen it. `DialectSql = { postgres; mssql }` in the same file also widens to `+ mysql`.

**Report-SQL is tri-variant, NOT abstracted** (deliberate — the spec chose triplication + a parity harness over a helper). Each of the 9 `SEED_QUERIES` entries carries `sql: { postgres, mssql }`; S2 adds a `mysql` string to each, and `seedDataDrivenReports` picks `q.sql[dialect]` where `dialect` derives from the resolved warehouse connector's `type`.

**Cross-package tsc gate (memory rule):** widening `SqlDialect` in `@openldr/dashboards` is a shared-type change — after Task 1, `@openldr/bootstrap` and `@openldr/reporting` must still typecheck. The final gate runs tsc on every touched package directly.

**MySQL vs MariaDB statement-timeout is the top risk (spec Risks):** MySQL 8.4 uses `max_execution_time` (milliseconds, SELECT-only); MariaDB 11.4 uses `max_statement_time` (seconds). The names are mutually exclusive — each engine errors "Unknown system variable" on the other's name. The runner sets BOTH, swallowing the unknown-variable error on whichever engine lacks it (an errored `SET SESSION` does not roll back a MySQL/MariaDB transaction). No read-only txn pragma for mysql — `START/SET TRANSACTION READ ONLY` can't be issued inside an already-open txn (kysely has already sent `BEGIN`), so the runner relies on the shared `validateSelectSql` SELECT-only guard, exactly as the mssql branch does.

### MySQL report-SQL translation reference (from the Postgres variant)

Apply these when writing each `mysql:` variant in Task 5. The `mssql:` variant is a useful cross-check for the CASE-based rewrites, but MySQL has simpler equivalents for age and month bucketing:

| Postgres construct | MySQL equivalent | Notes |
|---|---|---|
| `A \|\| B` (string concat) | `concat(A, B)` | **CRITICAL** — MySQL `\|\|` is logical OR by default, NOT concat. Every `'Patient/' \|\| p.id`, `'Specimen/' \|\| s.id`, and the `(... \|\| 'T23:59:59.999Z')` end-of-day expressions must become `concat(...)`. |
| `count(*) filter (where P)` | `sum(case when P then 1 else 0 end)` | Same rewrite as the mssql variant. |
| `X::int` | `cast(X as signed)` | Counts are already integers; cast only where the pg variant explicitly casts. |
| `X::float8` | `cast(X as double)` | MySQL 8.0.17+/MariaDB 11.4 support `CAST(x AS DOUBLE)`. Keeps `percentR` a JS number (parity harness normalizes numerics anyway). |
| `to_char(date_trunc('month', authored_on::timestamptz), 'YYYY-MM')` | `substr(sr.authored_on, 1, 7)` | `authored_on` is an ISO `YYYY-MM-DD...` string, so the first 7 chars ARE `YYYY-MM`. Simpler and avoids MySQL's fussy parsing of `T`/`Z` in `str_to_date`/`cast`. Matches `monthKey()` exactly. |
| `extract(year from age(ref, birth))` (calendar-exact age) | `timestampdiff(year, cast(substr(birth,1,10) as date), cast(substr(ref,1,10) as date))` | MySQL's `timestampdiff(YEAR, ...)` is calendar-exact (handles the month/day borrow), so NO borrow-day CASE is needed (unlike mssql). `substr(x,1,10)` strips the `T..Z` before `cast(... as date)` (raw ISO-with-`T` casts unreliably in MySQL). |
| `X::date` (comparison, e.g. `birth_date::date > ref_date`) | `cast(substr(X,1,10) as date)` | Same `substr` guard. |
| `nullif({{param.asOf}}, '')::date` | `cast(nullif({{param.asOf}}, '') as date)` — but the seed default is a full ISO string; use `cast(substr(coalesce(nullif({{param.asOf}},''),'2026-01-01T00:00:00Z'),1,10) as date)` | Strip to `YYYY-MM-DD` before casting. |
| `distinct on (k1,k2,k3) ... order by k1,k2,k3,(iso_date is null),iso_date asc,obs_id asc` | `row_number() over (partition by k1,k2,k3 order by case when iso_date is null then 1 else 0 end asc, iso_date asc, obs_id asc) = 1` | Same window-function idiom as the mssql variant. MySQL 8 + MariaDB 10.2+ support window functions. |
| `order by array_position(array['0-4',...]::text[], band)` | `order by case band when '0-4' then 1 when '5-14' then 2 ... end` | Same CASE-mapping as the mssql variant. |
| `group by 1, 2` | spell out the grouped expressions | **`ONLY_FULL_GROUP_BY` is ON by default in MySQL 8.** Every non-aggregated selected column must be grouped. Ordinal group-by technically works, but spell expressions out (as the mssql variant does) to be strict-mode-safe and unambiguous. |
| `round(x, 1)` / `coalesce(...)` / `nullif(...)` | identical | No change. |
| double-quoted column alias `"percentR"` / `"Iso3Country"` | keep double quotes for aliases you WANT preserved? | MySQL only honors `"..."` as an identifier under `ANSI_QUOTES` (off by default) — it treats `"..."` as a **string literal**. Use **backtick** aliases (`` `percentR` ``) in the mysql variant so the returned column key is `percentR`. Plain lowercase aliases (`antibiotic`, `tested`) need no quoting. |

The `antibiogramCellSql(antibiotic, dialect)` helper (report-seeds.ts:68) also gains a `mysql` branch: `count(*) filter (where …)` → `sum(case when … then 1 else 0 end)`, `::float8)::text` → `cast(… as char)`, `||` → `concat(…)`, and the column alias uses a **backtick-escaped** identifier (``ident.replace(/`/g, '``')``) instead of the double-quote escape.

---

## File Structure

- Modify: `packages/dashboards/src/sql-runner.ts` — `SqlDialect += 'mysql'`; `planPagination` mysql branch (reuse pg path); `runSqlQuery` mysql engine branch (per-engine timeout, no read-only txn).
- Modify: `packages/dashboards/src/sql-runner.test.ts` — cover mysql `planPagination` + `runSqlQuery` session setup.
- Modify: `packages/bootstrap/src/connector-sql-service.ts` — `dialectFor('mysql')` returns `'mysql'` (was `'postgres'`).
- Modify: `packages/bootstrap/src/connector-sql-service.test.ts` — cover mysql pagination wrapper.
- Modify: `apps/server/src/query-routes.ts` — `SQL_TYPES += 'mysql'`; mysql system-schema introspection filter.
- Modify: `apps/server/src/query-routes.test.ts` — cover mysql connector listing + introspection.
- Modify: `apps/studio/src/query/store.ts` — mysql backtick identifier quoting for table-preview SQL.
- Modify: `apps/studio/src/query/store.test.ts` — cover mysql tab SQL.
- Modify: `apps/studio/src/query/workspace/TabBar.tsx` — same backtick quoting for the "open in editor" default SQL.
- Modify: `apps/studio/src/query/workspace/TableTab.test.tsx` — (only if it asserts the SQL; otherwise leave).
- Modify: `packages/reporting/src/seed/report-seeds.ts` — `SqlDialect`/`DialectSql += mysql`; `antibiogramCellSql` mysql branch; a `mysql` SQL string on all 9 `SEED_QUERIES`; `WAREHOUSE_NAMES += 'Target Warehouse (MySQL/MariaDB)'`; 3-way dialect resolution.
- Modify: `packages/reporting/src/seed/report-seeds.test.ts` — three-variant assertions + a mysql-connector seed test.
- Modify: `packages/bootstrap/src/index.ts:435` — 3-way engine derivation for the dashboards raw-SQL runner (S1 tracking item 1).
- Modify: `packages/bootstrap/src/seed.ts` — update the S1 comment (mysql reports now seed in S2) — no logic change beyond the TLS knob in Task 8.
- Modify: `packages/adapter-mysql-store/src/index.ts` + `index.test.ts` — explicit `rejectUnauthorized` knob (S1 tracking item 2).
- Modify: `packages/config/src/schema.ts` + `load.test.ts` — `MYSQL_SSL_REJECT_UNAUTHORIZED` env.
- Modify: `packages/bootstrap/src/target-store.ts` + `target-store.test.ts` — pass the new knob through.
- Modify: `packages/bootstrap/src/seed.ts` + `seed.test.ts` — write the knob into the seeded mysql connector config.
- Modify: `packages/bootstrap/src/connector-db.ts` — mysql branch honors `config.sslRejectUnauthorized`.
- Create: `scripts/lib/reports-parity-fixture.ts` — the shared FHIR fixture + normalize/diff helpers (extracted from `mssql-reports-parity.ts`, behavior-preserving).
- Modify: `scripts/mssql-reports-parity.ts` — import the shared fixture instead of inlining it (behavior-preserving refactor).
- Create: `scripts/mysql-reports-parity.ts` — pg-reference vs mysql-target parity using `q.sql.mysql`.
- Create: `scripts/mysql-reports-parity-matrix.sh` — run the mysql parity script against MySQL 8.4 then MariaDB 11.4.
- Modify: `package.json` — `reports:parity:mysql` + `reports:parity:mysql:matrix` scripts.
- Modify: `DEPLOYMENT.md` (support matrix) — note built-in reports + full read surfaces now validated on MySQL/MariaDB.

---

## Task 1: `sql-runner` — `SqlDialect += 'mysql'` (pagination + per-engine timeout)

**Files:**
- Modify: `packages/dashboards/src/sql-runner.ts`
- Test: `packages/dashboards/src/sql-runner.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/dashboards/src/sql-runner.test.ts`. In the `planPagination` describe block:

```typescript
  it('wraps MySQL with LIMIT/OFFSET (reuses the Postgres server-side-offset path)', () => {
    expect(planPagination('select 1', 'mysql', { limit: 100, offset: 0 }))
      .toEqual({ sql: 'select * from (select 1) as _q limit 100 offset 0', sliceOffset: 0 });
    expect(planPagination('select 1', 'mysql', { limit: 50, offset: 25 }))
      .toEqual({ sql: 'select * from (select 1) as _q limit 50 offset 25', sliceOffset: 0 });
  });
```

In the `runSqlQuery dialect-aware session setup + capped query` describe block:

```typescript
  it('mysql: portable statement timeout (max_execution_time ms + max_statement_time s), no read-only txn, LIMIT/OFFSET capped query', async () => {
    const { db, executed } = makeFakeDb([{ a: 1 }]);
    const result = await runSqlQuery(db, 'select 1 as a', { timeoutMs: 5000, rowCap: 100 }, 'mysql');
    // Both engine-specific timeout vars are attempted; the wrong one is swallowed at runtime.
    expect(executed).toContain('set session max_execution_time = 5000'); // MySQL 8.4 (ms)
    expect(executed).toContain('set session max_statement_time = 5');    // MariaDB 11.4 (seconds)
    // No read-only txn pragma (can't change txn characteristics inside an open txn) — SELECT-only
    // validation enforces read-only-ness, exactly like the mssql branch.
    expect(executed.some((s) => /read only/i.test(s))).toBe(false);
    expect(executed.some((s) => /statement_timeout/i.test(s))).toBe(false); // that's the pg var, not mysql's
    expect(executed).toContain('select * from (select 1 as a) as _q limit 100 offset 0');
    expect(result.rows).toEqual([{ a: 1 }]);
  });
```

Note: the fake executor's `executeQuery` always succeeds, so the swallow-on-error path isn't exercised here — it's covered live by Tasks 9/10. The unit test only pins the emitted SQL text.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/sql-runner.test.ts`
Expected: FAIL — `'mysql'` is not assignable to `SqlDialect`, and `runSqlQuery`'s mysql branch doesn't exist (falls into the pg branch → emits `set transaction read only` / `set local statement_timeout`).

- [ ] **Step 3: Implement**

In `packages/dashboards/src/sql-runner.ts`:

(a) Widen the type:
```typescript
export type SqlDialect = 'postgres' | 'mssql' | 'mysql';
```

(b) `planPagination` — MySQL supports `LIMIT/OFFSET` in a derived table exactly like Postgres, so it reuses the Postgres path. The current `else` already emits the pg wrapper, so `'mysql'` falls through correctly — but make it explicit for clarity and to match the doc comment. Replace the function body's tail:
```typescript
export function planPagination(inner: string, dialect: SqlDialect, opts: { limit: number; offset?: number }): PaginationPlan {
  const limit = Math.floor(opts.limit);
  const offset = Math.floor(opts.offset ?? 0);
  if (dialect === 'mssql') {
    return { sql: `set rowcount ${offset + limit}; ${inner}; set rowcount 0`, sliceOffset: offset };
  }
  // Postgres AND MySQL/MariaDB: native LIMIT/OFFSET in a derived table (server-side offset).
  return { sql: `select * from (${inner}) as _q limit ${limit} offset ${offset}`, sliceOffset: 0 };
}
```

(c) `runSqlQuery` — add the mysql branch inside the transaction, before/after the existing mssql/else branches. Replace the `if (engine === 'mssql') { … } else { … }` block with a three-way:
```typescript
  return db.transaction().execute(async (trx) => {
    if (engine === 'mssql') {
      // SQL Server has no `set transaction read only`; SELECT-only validation enforces read-only-ness.
      // SET LOCK_TIMEOUT bounds lock waits (T-SQL has no per-statement time cap).
      await sql`set lock_timeout ${sql.lit(Math.floor(opts.timeoutMs))}`.execute(trx);
    } else if (engine === 'mysql') {
      // MySQL/MariaDB reject changing txn characteristics inside an already-open txn (kysely has
      // sent BEGIN), so there is no read-only pragma here — the shared SELECT-only validation is
      // the read-only guard (same rationale as mssql). The per-statement timeout var differs by
      // engine and the two names are mutually exclusive (MySQL 8.4: max_execution_time in ms;
      // MariaDB 11.4: max_statement_time in seconds). Set BOTH, swallowing the "unknown system
      // variable" error on whichever engine lacks the other's name — a failed SET does not roll
      // back a MySQL/MariaDB transaction.
      const ms = Math.floor(opts.timeoutMs);
      const trySet = async (stmt: ReturnType<typeof sql>) => {
        try { await stmt.execute(trx); } catch { /* wrong-engine unknown-variable: ignore */ }
      };
      await trySet(sql`set session max_execution_time = ${sql.lit(ms)}`);       // MySQL 8.4
      await trySet(sql`set session max_statement_time = ${sql.lit(ms / 1000)}`); // MariaDB 11.4
    } else {
      await sql`set transaction read only`.execute(trx);
      await sql`set local statement_timeout = ${sql.lit(Math.floor(opts.timeoutMs))}`.execute(trx);
    }
    const plan = planPagination(inner, engine, { limit: cap });
    // ...unchanged: run plan.sql, slice, shape columns/rows...
```
Leave the rest of the function (`sql.raw(plan.sql)`, slicing, column shaping) unchanged. Also update the `runSqlQuery` doc comment to mention the mysql branch.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/sql-runner.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck the package**

Run: `pnpm --filter @openldr/dashboards exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboards/src/sql-runner.ts packages/dashboards/src/sql-runner.test.ts
git commit -m "feat(dashboards): SqlDialect += mysql (LIMIT/OFFSET pagination + portable statement timeout)"
```

---

## Task 2: `connector-sql-service` — route mysql through its own dialect

**Files:**
- Modify: `packages/bootstrap/src/connector-sql-service.ts`
- Test: `packages/bootstrap/src/connector-sql-service.test.ts`

- [ ] **Step 1: Write the failing test**

Read `packages/bootstrap/src/connector-sql-service.test.ts` to match its `connectorsFake`/`createDb` harness (it already has `microsoft-sql` cases). Add a mysql case asserting the runner wraps the SQL with the Postgres-style `LIMIT/OFFSET` (mysql reuses that plan) and does NOT use `set rowcount`:

```typescript
  it('runs a mysql connector query through the LIMIT/OFFSET pagination wrapper', async () => {
    const seen: string[] = [];
    const runner = createConnectorSqlRunner({
      connectors: connectorsFake({ type: 'mysql', enabled: true }),
      secretsKey: undefined,
      createDb: () => ({
        query: async (sqlText: string) => { seen.push(sqlText); return { rows: [{ n: 1 }] }; },
        close: async () => {},
      }),
    });
    const res = await runner({ connectorId: 'c1', sql: 'select 1 as n', rowCap: 50, offset: 10 });
    expect(seen[0]).toBe('select * from (select 1 as n) as _q limit 50 offset 10');
    expect(seen[0]).not.toMatch(/rowcount/i);
    expect(res.rows).toEqual([{ n: 1 }]);
  });
```
(Match the exact shape of the existing mssql test in this file — copy its `connectorsFake`/`createDb` construction rather than inventing new helpers.)

- [ ] **Step 2: Run test to verify it fails or already passes**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/connector-sql-service.test.ts`
Note: `dialectFor('mysql')` currently returns `'postgres'`, and the pg plan is byte-identical to the mysql plan — so this test may already PASS. If it passes, that's fine; Step 3 still makes the routing explicit + self-documenting. If the existing code returns `null` for any reason and the test fails, Step 3 fixes it.

- [ ] **Step 3: Implement**

In `packages/bootstrap/src/connector-sql-service.ts`, change `dialectFor` so mysql returns its own dialect (now that `SqlDialect` includes `'mysql'` after Task 1). `planPagination` maps mysql to the same LIMIT/OFFSET plan, so behavior is unchanged — but the code now says what it means:
```typescript
function dialectFor(type: string): SqlDialect | null {
  if (type === 'postgres') return 'postgres';
  if (type === 'microsoft-sql') return 'mssql';
  if (type === 'mysql') return 'mysql';
  return null;
}
```
Update the stale comment that said "reuse the postgres wrapper" — `planPagination`'s mysql arm now reuses the pg path internally.

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/connector-sql-service.test.ts` → PASS
Run: `pnpm --filter @openldr/bootstrap exec tsc --noEmit` → clean

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/connector-sql-service.ts packages/bootstrap/src/connector-sql-service.test.ts
git commit -m "feat(bootstrap): route mysql connectors through the mysql SqlDialect"
```

---

## Task 3: `query-routes` — list + introspect mysql connectors

**Files:**
- Modify: `apps/server/src/query-routes.ts`
- Test: `apps/server/src/query-routes.test.ts`

READ `apps/server/src/query-routes.test.ts` first to match its Fastify test harness (how it builds `deps`, fakes `connectors`, and asserts route responses). Mirror the existing `microsoft-sql` / `postgres` introspection tests.

- [ ] **Step 1: Write the failing tests**

Add tests analogous to the existing connector-list + schemas tests, for a mysql connector:

```typescript
  it('includes mysql connectors in GET /api/query/connectors', async () => {
    // Build deps with an enabled mysql connector (mirror the existing postgres/mssql list test).
    // Assert the mysql connector appears in the returned list.
  });

  it('introspects a mysql connector schema list with the mysql system-schema filter', async () => {
    // Mirror the existing mssql schemas test: stub runConnectorSql, call
    // GET /api/query/connectors/:id/schemas for a { type: 'mysql' } connector, and assert the
    // emitted SQL excludes information_schema/mysql/performance_schema/sys.
  });
```
Fill these in against the real harness in the file (copy the exact request/inject + assertion style from the adjacent `microsoft-sql` tests — do NOT invent a new harness).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server exec vitest run src/query-routes.test.ts`
Expected: FAIL — mysql is filtered out of the connector list (`SQL_TYPES` lacks `'mysql'`), so the list assertion fails; the schemas endpoint uses the `PG_SYS` filter (wrong system schemas).

Note: confirm the filter package name — if `apps/server`'s package is not `@openldr/server`, use its real name from `apps/server/package.json` (`grep '"name"' apps/server/package.json`).

- [ ] **Step 3: Implement**

In `apps/server/src/query-routes.ts`:

(a) Add mysql to the allow-set:
```typescript
  const SQL_TYPES = new Set(['postgres', 'microsoft-sql', 'mysql']);
```

(b) Add a MySQL system-schema filter next to `PG_SYS`/`MSSQL_SYS`:
```typescript
  const MYSQL_SYS = "schema_name not in ('information_schema','mysql','performance_schema','sys')";
```

(c) In the `/schemas` handler, pick the filter three ways:
```typescript
      const sysFilter = c.type === 'microsoft-sql' ? MSSQL_SYS : c.type === 'mysql' ? MYSQL_SYS : PG_SYS;
```

(d) The `/schemas/:schema/tables` handler already filters `information_schema.tables where table_schema = '<schema>'`, which is correct for MySQL (schema ≡ database name). No change. The total-count path (`c.type !== 'microsoft-sql'`) already includes mysql — MySQL supports wrapping the inner SQL in a `count(*) from (…) as _q` derived table, so mysql gets pagination totals. Leave it.

Update the block comment at the top of the introspection section (currently "Postgres and SQL Server are both supported…") to mention MySQL/MariaDB and the backtick-quoting note (the studio-side quoting lands in Task 4).

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @openldr/server exec vitest run src/query-routes.test.ts` → PASS
Run: `pnpm --filter @openldr/server exec tsc --noEmit` → clean

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/query-routes.ts apps/server/src/query-routes.test.ts
git commit -m "feat(server): list + introspect mysql connectors in the query workbench"
```

---

## Task 4: Studio — backtick identifier quoting for mysql table preview

**Files:**
- Modify: `apps/studio/src/query/store.ts:40`
- Modify: `apps/studio/src/query/workspace/TabBar.tsx:15`
- Test: `apps/studio/src/query/store.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/studio/src/query/store.test.ts`, mirror the existing `microsoft-sql` `openTableTab` case for mysql:

```typescript
  it('quotes mysql table identifiers with backticks', () => {
    useQueryStore.getState().reset();
    useQueryStore.getState().openTableTab({ connectorId: 'c3', type: 'mysql', schema: 'openldr_target', table: 'patients' });
    const s = useQueryStore.getState();
    expect(s.tabs[0]).toMatchObject({ type: 'mysql', sql: 'select * from `openldr_target`.`patients`' });
  });
```
(Match the exact `openTableTab`/`reset` usage of the adjacent mssql test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/query/store.test.ts`
Expected: FAIL — the mysql branch falls into the `else` (double-quote) path, producing `"openldr_target"."patients"`.

Note: confirm the studio package name (`grep '"name"' apps/studio/package.json` → likely `@openldr/studio`).

- [ ] **Step 3: Implement**

In `apps/studio/src/query/store.ts`, replace the `sql` assignment in `openTableTab`:
```typescript
    const sql =
      type === 'microsoft-sql' ? `select * from [${schema}].[${table}]`
      : type === 'mysql' ? `select * from \`${schema}\`.\`${table}\``
      : `select * from "${schema}"."${table}"`;
```

In `apps/studio/src/query/workspace/TabBar.tsx`, replace the `def` assignment (same three-way):
```typescript
  const def =
    t.type === 'microsoft-sql' ? `select * from [${t.schema}].[${t.table}]`
    : t.type === 'mysql' ? `select * from \`${t.schema}\`.\`${t.table}\``
    : `select * from "${t.schema}"."${t.table}"`;
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @openldr/studio exec vitest run src/query/store.test.ts` → PASS
Run: `pnpm --filter @openldr/studio exec tsc --noEmit` → clean

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/query/store.ts apps/studio/src/query/workspace/TabBar.tsx apps/studio/src/query/store.test.ts
git commit -m "feat(studio): backtick identifier quoting for mysql table preview"
```

---

## Task 5: Tri-variant report SQL — a MySQL variant for every built-in report

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts`
- Test: `packages/reporting/src/seed/report-seeds.test.ts`

This is the largest task. Use the **MySQL report-SQL translation reference** table above for every rewrite. Work one query at a time; the parity harness (Task 9) is the ultimate check, but the unit test below pins structure + token parity.

- [ ] **Step 1: Widen the types + update the "every entry carries both dialect variants" test to three**

In `packages/reporting/src/seed/report-seeds.ts`:
```typescript
export type SqlDialect = 'postgres' | 'mssql' | 'mysql';
// ...
type DialectSql = { postgres: string; mssql: string; mysql: string };
```

In `packages/reporting/src/seed/report-seeds.test.ts`, extend the existing block:
```typescript
describe('SEED_QUERIES — every entry carries all three dialect variants', () => {
  it('has non-empty sql.postgres, sql.mssql, and sql.mysql for every seed query', () => {
    for (const q of SEED_QUERIES) {
      expect(q.sql.postgres.trim().length).toBeGreaterThan(0);
      expect(q.sql.mssql.trim().length).toBeGreaterThan(0);
      expect(q.sql.mysql.trim().length).toBeGreaterThan(0);
    }
  });
});
```
Also extend the two token-parity tests (`q-amr-resistance`, `q-amr-antibiogram`) to loop over all THREE variants:
```typescript
    for (const variant of [q?.sql.postgres, q?.sql.mssql, q?.sql.mysql]) { /* ...unchanged token assertions... */ }
```
For `q-amr-antibiogram`'s per-antibiotic assertion, the mysql variant uses **backtick** aliases, so relax that check to accept either quote char, e.g. assert the antibiotic name appears (`` expect(variant).toContain(a) ``) rather than `"${a}"` for the mysql variant, OR assert `` `${a}` `` for mysql specifically. Keep the postgres/mssql assertion as `"${a}"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/reporting exec vitest run src/seed/report-seeds.test.ts`
Expected: FAIL — `DialectSql` now requires `mysql`, but no `SEED_QUERIES` entry has it (type error) and the three-variant test fails.

- [ ] **Step 3: Add the `antibiogramCellSql` mysql branch**

In `report-seeds.ts`, extend `antibiogramCellSql(antibiotic, dialect)`:
```typescript
function antibiogramCellSql(antibiotic: string, dialect: SqlDialect): string {
  const lit = antibiotic.replace(/'/g, "''");
  if (dialect === 'mssql') {
    const ident = antibiotic.replace(/"/g, '""');
    return `case when sum(case when antibiotic = '${lit}' then 1 else 0 end) = 0 then ''
    else cast(cast(round(100.0 * sum(case when antibiotic = '${lit}' and ris = 'R' then 1 else 0 end) / nullif(sum(case when antibiotic = '${lit}' then 1 else 0 end), 0), 1) as float) as nvarchar(max))
      + '% (' + cast(sum(case when antibiotic = '${lit}' then 1 else 0 end) as nvarchar(max)) + ')' end as "${ident}"`;
  }
  if (dialect === 'mysql') {
    const ident = antibiotic.replace(/`/g, '``');
    return `case when sum(case when antibiotic = '${lit}' then 1 else 0 end) = 0 then ''
    else concat(cast(cast(round(100.0 * sum(case when antibiotic = '${lit}' and ris = 'R' then 1 else 0 end) / nullif(sum(case when antibiotic = '${lit}' then 1 else 0 end), 0), 1) as double) as char),
      '% (', cast(sum(case when antibiotic = '${lit}' then 1 else 0 end) as char), ')') end as \`${ident}\``;
  }
  const ident = antibiotic.replace(/"/g, '""');
  return `case when count(*) filter (where antibiotic = '${lit}') = 0 then ''
    else (round(100.0 * count(*) filter (where antibiotic = '${lit}' and ris = 'R') / nullif(count(*) filter (where antibiotic = '${lit}'), 0), 1)::float8)::text
      || '% (' || count(*) filter (where antibiotic = '${lit}')::text || ')' end as "${ident}"`;
}
```

- [ ] **Step 4: Add the `mysql` variant to each of the 9 `SEED_QUERIES` entries**

For every entry, add a `mysql:` string alongside `postgres:`/`mssql:` inside the `sql: { … }` object, translating from the Postgres variant per the reference table. The specifics per query:

- **`q-facilities`** — no postgres-isms; the mysql variant is byte-identical to postgres:
  ```sql
  select distinct managing_organization as facility
  from patients
  where managing_organization is not null
  order by 1
  ```

- **`q-amr-resistance`** — `count(*) filter` → `sum(case…)` (already sum-based in this one; only casts + concat change): drop `::int`→`cast(... as signed)`, `::float8`→`cast(... as double)`, and `'Patient/' || p.id` → `concat('Patient/', p.id)`. GROUP BY already spells out the expression. Keep `order by \`percentR\` desc` with a **backtick** alias.

- **`q-test-volume`** — month bucket: `to_char(date_trunc('month', sr.authored_on::timestamptz), 'YYYY-MM')` → `substr(sr.authored_on, 1, 7)`; `count(*)::int` → `cast(count(*) as signed)`; end-of-day concat → `concat({{param.to}}, 'T23:59:59.999Z')`. Spell out `group by substr(sr.authored_on,1,7), coalesce(sr.code_text,'(unknown)')` (ONLY_FULL_GROUP_BY). `order by 1, 2` is fine.

- **`q-turnaround-time`** — `extract(epoch from (issued::timestamptz - received::timestamptz))/3600.0` → `timestampdiff(second, cast(substr(r.received_time,1,19) as datetime), cast(substr(dr.issued,1,19) as datetime)) / 3600.0` (arg order is (start,end)=(received,issued); `substr(x,1,19)` = `YYYY-MM-DDTHH:MM:SS` → replace the `T`? MySQL `cast('2026-03-01T08:00:00' as datetime)` — the embedded `T` is NOT accepted by MySQL datetime cast. Use `str_to_date(substr(x,1,19), '%Y-%m-%dT%H:%i:%s')` which parses the literal `T`, OR `cast(replace(substr(x,1,19),'T',' ') as datetime)`). Use **`str_to_date(substr(x,1,19), '%Y-%m-%dT%H:%i:%s')`** for both received and issued. `round(x)::int` → `cast(round(x, 0) as signed)`. `avg(hours)::numeric` → `avg(cast(hours as decimal(18,4)))` then `cast(round(..., 1) as double)` (avoid MySQL avg-of-int giving a truncated-looking string; casting to decimal first mirrors the mssql fix). `min/max(hours)::int` → `cast(min/max(hours) as signed)`. Concat + facility subquery `'Patient/' || p.id` → `concat('Patient/', p.id)`. Keep `order by \`avgHours\` desc, test asc`.

- **`q-patient-demographics`** — the trickiest, but MySQL simplifies it: replace the whole `extract(year from age(...))` ladder with `timestampdiff(year, cast(substr(p.birth_date,1,10) as date), pr.ref_date)`. Compute `ref_date` in the `params` CTE: `cast(substr(coalesce(nullif({{param.asOf}}, ''), '2026-01-01T00:00:00Z'), 1, 10) as date) as ref_date`. In `banded`, guard `p.birth_date is null` and `cast(substr(p.birth_date,1,10) as date) > pr.ref_date` first (both → `'unknown'`), else band on the single `timestampdiff` value. Cross join: `from patients p cross join params pr`. Order by the CASE-mapping (same as mssql). `sum(case…)::int` → `cast(sum(case…) as signed)`.

- **`q-amr-facility-summary`** — `count(*)::int`/`sum(case…)::int` → `cast(... as signed)`; join `'Patient/' || p.id` → `concat('Patient/', p.id)`; end-of-day concat. Straightforward.

- **`q-amr-glass-ris`** — port the CTE chain like the mssql variant: `distinct on` → `row_number() over (partition by subject_ref, pathogen_code, specimen_type order by case when iso_date is null then 1 else 0 end asc, iso_date asc, obs_id asc) = 1`. Age: `extract(year from age(coalesce(iso_date,'1970-01-01')::date, birth_date::date))::int` → `timestampdiff(year, cast(substr(im.birth_date,1,10) as date), cast(substr(coalesce(im.iso_date,'1970-01-01'),1,10) as date))` (NULL birth_date → timestampdiff returns NULL → outer CASE `birth_date is null` handles it first). `'Specimen/' || s.id`/`'Patient/' || p.id` → `concat(...)`. End-of-day concat. `coalesce(nullif({{param.year}}, ''), '0')::int` → `cast(coalesce(nullif({{param.year}}, ''), '0') as signed)`. `sum(case…)::int`/`count(*)::int` → `cast(... as signed)`. Preserve the exact GROUP BY / ORDER BY column lists.

- **`q-amr-first-isolate-summary`** — identical CTE-chain port to `q-amr-glass-ris` (same dedup/age rules), final grouping by `specimen_type, pathogen_code, antibiotic` only. `round(...,1)::float8` → `cast(round(..., 1) as double)`.

- **`q-amr-antibiogram`** — simpler CTE chain (no age/gender): `distinct on` → `row_number()` window `= 1`; `'Specimen/' || s.id` → `concat(...)`; end-of-day concat; the select uses `${ANTIBIOGRAM_PANEL.map((a) => antibiogramCellSql(a, 'mysql')).join(',\n  ')}`. Keep `group by pathogen_code order by pathogen_code`.

For every mysql variant, double-check: (1) no bare `||` remains; (2) every non-aggregated selected column appears in GROUP BY; (3) quoted aliases you rely on as result keys use backticks; (4) every `{{param.x}}` token that appears in postgres also appears in mysql (the token-parity test enforces this).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @openldr/reporting exec vitest run src/seed/report-seeds.test.ts`
Expected: PASS (structure + token parity). Semantic parity is proven live in Task 9.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @openldr/reporting exec tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts packages/reporting/src/seed/report-seeds.test.ts
git commit -m "feat(reporting): MySQL variant for every built-in report query (tri-variant DialectSql)"
```

---

## Task 6: Register the mysql warehouse connector so reports seed on a mysql target

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts` (`WAREHOUSE_NAMES` + dialect resolution)
- Modify: `packages/bootstrap/src/seed.ts` (update the S1 comment — no logic change)
- Test: `packages/reporting/src/seed/report-seeds.test.ts`

- [ ] **Step 1: Write the failing test**

In `report-seeds.test.ts`, add a mysql-connector seed test mirroring the existing mssql one (around line 93):

```typescript
  it('resolves a mysql-typed warehouse connector by its own name and seeds the mysql SQL variant', async () => {
    const { deps, queries } = fakeDeps([{ id: 'conn-mysql', name: 'Target Warehouse (MySQL/MariaDB)', type: 'mysql' }]);
    const res = await seedDataDrivenReports(deps);
    expect(res.queriesSeeded).toBe(SEED_QUERIES.length);
    const testVolume = queries.get('q-test-volume');
    // MySQL variant uses substr(...) month bucketing, not to_char/format.
    expect(testVolume?.sql).toContain('substr(');
    expect(testVolume?.sql).not.toContain('to_char(');
    expect(testVolume?.sql).not.toContain('format(');
    for (const q of queries.values()) expect(q.connectorId).toBe('conn-mysql');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/reporting exec vitest run src/seed/report-seeds.test.ts`
Expected: FAIL — `WAREHOUSE_NAMES` doesn't include the mysql name, so `seedDataDrivenReports` finds no connector and returns all-zero.

- [ ] **Step 3: Implement**

In `report-seeds.ts`:

(a) Add the mysql name to `WAREHOUSE_NAMES` (must be byte-identical to `bootstrap/src/seed.ts`'s `MYSQL_CONNECTOR_NAME`):
```typescript
const WAREHOUSE_NAMES = ['Target Warehouse (Postgres)', 'Target Warehouse (SQL Server)', 'Target Warehouse (MySQL/MariaDB)'];
```

(b) Make the dialect resolution 3-way:
```typescript
  const dialect: SqlDialect =
    connector.type === 'microsoft-sql' ? 'mssql'
    : connector.type === 'mysql' ? 'mysql'
    : 'postgres';
```
Update the block comment above `WAREHOUSE_NAMES` (currently "Task 2 (mssql-slice2b) reversal…") to note the three-engine set and that S2 adds mysql.

In `packages/bootstrap/src/seed.ts`, update the `MYSQL_CONNECTOR_NAME` comment (S1 said "Deliberately NOT in reporting's WAREHOUSE_NAMES yet") to reflect that S2 registered it and reports now seed on mysql. No code change here.

- [ ] **Step 4: Run test + typecheck (both packages — cross-package)**

Run: `pnpm --filter @openldr/reporting exec vitest run src/seed/report-seeds.test.ts` → PASS
Run: `pnpm --filter @openldr/reporting exec tsc --noEmit` → clean
Run: `pnpm --filter @openldr/bootstrap exec tsc --noEmit` → clean

- [ ] **Step 5: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts packages/bootstrap/src/seed.ts packages/reporting/src/seed/report-seeds.test.ts
git commit -m "feat(reporting): seed built-in reports on a mysql warehouse target (register connector + mysql dialect)"
```

---

## Task 7: 3-way engine derivation for the dashboards raw-SQL runner (S1 tracking item 1)

**Files:**
- Modify: `packages/bootstrap/src/index.ts` (the `=== 'mssql' ? 'mssql' : 'postgres'` site, ~line 435)

- [ ] **Step 1: Locate every occurrence**

Run: `grep -n "=== 'mssql' ? 'mssql' : 'postgres'" packages/bootstrap/src/index.ts`
Expected: at least the `runDashboardQuery` site (~435) that passes the engine to `runSqlQuery`. Update EVERY occurrence found.

- [ ] **Step 2: Implement**

Change the derivation to 3-way (now that `runSqlQuery`/`SqlDialect` accept `'mysql'` from Task 1):
```typescript
      }, cfg.TARGET_STORE_ADAPTER === 'mssql' ? 'mssql' : cfg.TARGET_STORE_ADAPTER === 'mysql' ? 'mysql' : 'postgres');
```
This wires a mysql target's dashboards **raw-SQL** widgets to the mysql runner branch (portable timeout, LIMIT/OFFSET). Builder-mode dashboards already go through `runBuilderQuery` (`compile.ts`), which is portable kysely — validated live in Task 10.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @openldr/bootstrap exec tsc --noEmit`
Expected: clean.

(No unit test — `index.ts` is the composition root; this one-line derivation is covered by the live e2e in Task 10. `runSqlQuery`'s mysql branch itself is unit-tested in Task 1.)

- [ ] **Step 4: Commit**

```bash
git add packages/bootstrap/src/index.ts
git commit -m "fix(bootstrap): 3-way SqlDialect derivation for the dashboards raw-SQL runner (mysql target)"
```

---

## Task 8: Explicit strict-TLS-verify knob on the mysql adapter (S1 tracking item 2)

Replace the mysql adapter's carried-forward `rejectUnauthorized: false` with an explicit, config-driven knob (mirroring the MSSQL `encrypt`/`trustServerCertificate` precedent). Default stays `false` (on-prem self-signed certs are common — same stance as MSSQL's `MSSQL_TRUST_SERVER_CERT` default `true`), but it is now overridable.

**Files:**
- Modify: `packages/adapter-mysql-store/src/index.ts` + `packages/adapter-mysql-store/src/index.test.ts`
- Modify: `packages/config/src/schema.ts` + `packages/config/src/load.test.ts`
- Modify: `packages/bootstrap/src/target-store.ts` + `packages/bootstrap/src/target-store.test.ts`
- Modify: `packages/bootstrap/src/seed.ts` + `packages/bootstrap/src/seed.test.ts`
- Modify: `packages/bootstrap/src/connector-db.ts`

- [ ] **Step 1: Write the failing adapter test**

Read `packages/adapter-mysql-store/src/index.test.ts`. Add a case asserting the new `rejectUnauthorized` field flows into the pool `ssl` options. Since the adapter builds a real `createPool` (no live connect at construction), assert via the exported config type / a small factory seam. If the existing test only checks the shape, add:

```typescript
it('accepts an explicit rejectUnauthorized flag in the config type', () => {
  const cfg = { host: 'h', port: 3306, database: 'd', user: 'u', password: 'p', ssl: true, rejectUnauthorized: true };
  // Constructing must not throw; the field is part of MysqlStoreConfig.
  const store = createMysqlStore(cfg);
  expect(typeof store.close).toBe('function');
  return store.close();
});
```
(Match the existing test's construction/teardown style.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/adapter-mysql-store exec vitest run`
Expected: FAIL — `rejectUnauthorized` is not a member of `MysqlStoreConfig` (type error).

- [ ] **Step 3: Implement the adapter knob**

In `packages/adapter-mysql-store/src/index.ts`:
```typescript
export interface MysqlStoreConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  /** When ssl is on, verify the server certificate chain. Defaults to false because on-prem
   *  MySQL/MariaDB commonly uses self-signed certs (mirrors MSSQL's trustServerCertificate default).
   *  Set true to enforce strict TLS verification against a CA-signed cert. */
  rejectUnauthorized?: boolean;
}
```
And in `createPool(...)`:
```typescript
    ...(cfg.ssl ? { ssl: { rejectUnauthorized: cfg.rejectUnauthorized ?? false } } : {}),
```

- [ ] **Step 4: Config env var**

In `packages/config/src/schema.ts`, add after the `MYSQL_SSL` line:
```typescript
    MYSQL_SSL_REJECT_UNAUTHORIZED: envBoolean(false),
```
In `packages/config/src/load.test.ts`, add a case mirroring the `MSSQL_TRUST_SERVER_CERT` parse test:
```typescript
  it('parses MYSQL_SSL_REJECT_UNAUTHORIZED (default false, "true" -> true)', () => {
    expect(loadConfig({ ...basePg } as never).MYSQL_SSL_REJECT_UNAUTHORIZED).toBe(false);
    expect(loadConfig({ ...basePg, MYSQL_SSL_REJECT_UNAUTHORIZED: 'true' } as never).MYSQL_SSL_REJECT_UNAUTHORIZED).toBe(true);
  });
```

- [ ] **Step 5: Thread through the composition root + seed + connector-db**

In `packages/bootstrap/src/target-store.ts`, pass it in the mysql branch:
```typescript
      store: createMysqlStore({
        host: cfg.MYSQL_HOST!, port: cfg.MYSQL_PORT, database: cfg.MYSQL_DATABASE!,
        user: cfg.MYSQL_USER!, password: cfg.MYSQL_PASSWORD!, ssl: cfg.MYSQL_SSL,
        rejectUnauthorized: cfg.MYSQL_SSL_REJECT_UNAUTHORIZED,
      }),
```
Extend `packages/bootstrap/src/target-store.test.ts`'s mysql cfg fixture with `MYSQL_SSL_REJECT_UNAUTHORIZED: false`.

In `packages/bootstrap/src/seed.ts`, add `MYSQL_SSL_REJECT_UNAUTHORIZED?: boolean` to the `cfg` type and write it into the seeded mysql connector config (as a string, matching the other connector config values):
```typescript
          sslRejectUnauthorized: String(app.cfg.MYSQL_SSL_REJECT_UNAUTHORIZED),
```
Extend `packages/bootstrap/src/seed.test.ts`'s mysql seed test to set `MYSQL_SSL_REJECT_UNAUTHORIZED: false` and (optionally) assert `created[0].config.sslRejectUnauthorized === 'false'`.

In `packages/bootstrap/src/connector-db.ts`, honor it in the mysql branch:
```typescript
      ...(config.ssl === 'true' ? { ssl: { rejectUnauthorized: config.sslRejectUnauthorized === 'true' } } : {}),
```

- [ ] **Step 6: Run tests + typecheck (all touched packages)**

```
pnpm --filter @openldr/adapter-mysql-store exec vitest run
pnpm --filter @openldr/adapter-mysql-store exec tsc --noEmit
pnpm --filter @openldr/config exec vitest run
pnpm --filter @openldr/config exec tsc --noEmit
pnpm --filter @openldr/bootstrap exec vitest run
pnpm --filter @openldr/bootstrap exec tsc --noEmit
```
Expected: all PASS/clean.

- [ ] **Step 7: Commit**

```bash
git add packages/adapter-mysql-store/src packages/config/src/schema.ts packages/config/src/load.test.ts packages/bootstrap/src/target-store.ts packages/bootstrap/src/target-store.test.ts packages/bootstrap/src/seed.ts packages/bootstrap/src/seed.test.ts packages/bootstrap/src/connector-db.ts
git commit -m "feat(mysql): explicit MYSQL_SSL_REJECT_UNAUTHORIZED strict-TLS knob (replace carried-forward rejectUnauthorized:false)"
```

---

## Task 9: `reports:parity` extended to MySQL (pg reference vs MySQL 8.4 + MariaDB 11.4)

Add a pg-vs-mysql parity harness reusing the exact fixture + normalization the mssql harness uses. To avoid drift (two fixtures diverging) AND to avoid destabilizing the proven mssql harness, extract the shared fixture/normalize/diff into a module both scripts import. This is a **live acceptance script**, not a committed unit test.

> Deviation note (surface to the reviewer): the spec says "extend `scripts/mssql-reports-parity.ts`". This plan instead extracts the shared fixture into `scripts/lib/reports-parity-fixture.ts` and adds a sibling `scripts/mysql-reports-parity.ts` — same fixture, no duplication, and the validated mssql harness keeps working. Functionally this satisfies "validate MySQL vs Postgres on the same fixture across both engines."

**Files:**
- Create: `scripts/lib/reports-parity-fixture.ts`
- Modify: `scripts/mssql-reports-parity.ts`
- Create: `scripts/mysql-reports-parity.ts`
- Create: `scripts/mysql-reports-parity-matrix.sh`
- Modify: `package.json`

- [ ] **Step 1: Extract the shared fixture (behavior-preserving)**

Create `scripts/lib/reports-parity-fixture.ts` exporting exactly what both harnesses need, moved verbatim from `mssql-reports-parity.ts`: the `patients`/`specimens`/`serviceRequests`/`diagnosticReports`/`observations` arrays, the `obs(...)` builder, `TABLES`, `PROV`, `PARAM_BAG`, and the normalization helpers (`round3`, `CELL_RE`, `NUMERIC_RE`, `normalizeValue`, `normalizeRow`, `normalizeRows`, `Diff`, `firstDiff`). Example exports:
```typescript
export const TABLES = ['observations', 'diagnostic_reports', 'service_requests', 'specimens', 'patients', 'organizations', 'locations'] as const;
export const PROV = { sourceSystem: 'reports-parity-harness', batchId: 'fixture-1' };
export const patients = [ /* ...moved verbatim... */ ];
export const specimens = [ /* ... */ ];
export const serviceRequests = [ /* ... */ ];
export const diagnosticReports = [ /* ... */ ];
export const observations = [ /* ... */ ];
export const PARAM_BAG: Record<string, unknown> = { from: '2026-01-01', to: '2026-12-31', facility: '', asOf: '', country: '', year: '' };
export function normalizeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] { /* ...moved... */ }
export interface Diff { reason: string; a?: unknown; b?: unknown; }
export function firstDiff(a: Record<string, unknown>[], b: Record<string, unknown>[]): Diff | null { /* ...moved (rename pg/mssql -> a/b for engine-neutrality)... */ }
```

- [ ] **Step 2: Point the mssql harness at the shared module**

In `scripts/mssql-reports-parity.ts`, delete the now-moved inline fixture/normalize/diff and `import` them from `./lib/reports-parity-fixture`. Keep everything else (MSSQL_CFG, migrate/seed/runQuery/main) unchanged. Adjust the `firstDiff` call sites to the neutral `a`/`b` field names.

- [ ] **Step 3: Verify the mssql harness still passes (live, needs containers)**

Bring up the pg + mssql containers per the header comment in `mssql-reports-parity.ts`, then:
Run: `pnpm reports:parity`
Expected: `✅ ALL 9 report queries are cross-dialect parity-equivalent` (no regression from the refactor). If containers aren't available in this environment, at minimum typecheck: `node_modules/.bin/tsc --noEmit scripts/mssql-reports-parity.ts` is not standalone — instead confirm `node_modules/.bin/tsx scripts/mssql-reports-parity.ts` starts and fails only on connection (proving imports resolve).

- [ ] **Step 4: Create the mysql parity harness**

Create `scripts/mysql-reports-parity.ts` mirroring the mssql one but using `createMysqlStore` and `q.sql.mysql`, comparing pg (reference) vs mysql:
```typescript
import { Kysely, sql } from 'kysely';
import { createMigrator, externalMigrations, createFlatWriter, type ExternalSchema } from '@openldr/db';
import { createDbStore } from '@openldr/adapter-db-store';
import { createMysqlStore } from '@openldr/adapter-mysql-store';
import { prepareSelect } from '@openldr/dashboards';
import { SEED_QUERIES } from '../packages/reporting/src/seed/report-seeds';
import { TABLES, PROV, patients, specimens, serviceRequests, diagnosticReports, observations, PARAM_BAG, normalizeRows, firstDiff } from './lib/reports-parity-fixture';

const PG_URL = process.env.TARGET_DATABASE_URL ?? 'postgresql://postgres:openldr@localhost:5544/openldr_target';
const MYSQL_CFG = {
  host: process.env.MYSQL_HOST ?? 'localhost',
  port: Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.MYSQL_DATABASE ?? 'openldr_target',
  user: process.env.MYSQL_USER ?? 'root',
  password: process.env.MYSQL_PASSWORD ?? 'Openldr_Local_2026!',
  ssl: process.env.MYSQL_SSL === 'true',
};

async function migrateAndClean(db: Kysely<ExternalSchema>, engine: 'postgres' | 'mysql'): Promise<void> {
  const migrator = createMigrator(db as unknown as Kysely<unknown>, externalMigrations(engine));
  const res = await migrator.migrateToLatest();
  if (res.error) throw res.error;
  for (const t of TABLES) await sql.raw(`delete from ${t}`).execute(db as unknown as Kysely<unknown>);
}
async function seedFixture(db: Kysely<ExternalSchema>, engine: 'postgres' | 'mysql'): Promise<void> {
  const writer = createFlatWriter(db, engine);
  const items = [...patients, ...specimens, ...serviceRequests, ...diagnosticReports, ...observations].map((resource) => ({ resource, provenance: PROV }));
  const results = await writer.writeMany(items);
  const skipped = results.filter((r) => r === 'skipped').length;
  if (skipped > 0) throw new Error(`${engine}: ${skipped} fixture item(s) skipped by the flat writer`);
}
async function runQuery(db: Kysely<ExternalSchema>, sqlText: string): Promise<Record<string, unknown>[]> {
  const r = await sql.raw<Record<string, unknown>>(sqlText).execute(db as unknown as Kysely<unknown>);
  return r.rows;
}

async function main(): Promise<void> {
  const pgStore = createDbStore({ url: PG_URL });
  const pgDb = pgStore.db as unknown as Kysely<ExternalSchema>;
  const myStore = createMysqlStore(MYSQL_CFG);
  const myDb = myStore.db as unknown as Kysely<ExternalSchema>;
  let failures = 0;
  try {
    await migrateAndClean(pgDb, 'postgres'); await migrateAndClean(myDb, 'mysql');
    await seedFixture(pgDb, 'postgres'); await seedFixture(myDb, 'mysql');
    console.log(`\n[parity] running ${SEED_QUERIES.length} report queries on postgres vs mysql...\n`);
    for (const q of SEED_QUERIES) {
      const pgSql = prepareSelect(q.sql.postgres, q.params, PARAM_BAG).replace(/;\s*$/, '');
      const mySql = prepareSelect(q.sql.mysql, q.params, PARAM_BAG).replace(/;\s*$/, '');
      const [pgRows, myRows] = await Promise.all([runQuery(pgDb, pgSql), runQuery(myDb, mySql)]);
      const a = normalizeRows(pgRows); const b = normalizeRows(myRows);
      const diff = firstDiff(a, b);
      if (diff) { failures++; console.log(`✗ ${q.id}: ${diff.reason}\n    postgres: ${JSON.stringify(diff.a)}\n    mysql:    ${JSON.stringify(diff.b)}`); }
      else console.log(`✓ ${q.id}  (${a.length} rows)`);
    }
  } finally { await pgStore.close(); await myStore.close(); }
  console.log(failures === 0 ? '\n✅ ALL 9 report queries are pg-vs-mysql parity-equivalent' : `\n❌ ${failures} report quer${failures === 1 ? 'y' : 'ies'} mismatched`);
  process.exit(failures === 0 ? 0 : 1);
}
void main();
```
Add a header comment block (mirroring the mssql script) documenting the preconditions: a reachable Postgres 16 (`openldr-parity-pg` on :5544) + a MySQL/MariaDB with `openldr_target`, and the env overrides.

- [ ] **Step 5: Create the matrix runner**

Create `scripts/mysql-reports-parity-matrix.sh` mirroring `scripts/mysql-matrix-accept.sh` (READ it first for the container-lifecycle + MariaDB-client-fallback pattern). It must: start a Postgres 16 reference container once; then for each of `mysql:8.4` and `mariadb:11.4`, start the container, create `openldr_target`, wait for ready, run `MYSQL_HOST/PORT/... node_modules/.bin/tsx scripts/mysql-reports-parity.ts`, capture pass/fail, tear the engine container down; finally tear down pg and exit non-zero if any engine failed. Reuse the exact wait-for-ready + `mariadb`-vs-`mysql` client fallback logic from `mysql-matrix-accept.sh`.

- [ ] **Step 6: Wire package.json scripts**

In `package.json` `scripts`, add:
```json
    "reports:parity:mysql": "tsx scripts/mysql-reports-parity.ts",
    "reports:parity:mysql:matrix": "bash scripts/mysql-reports-parity-matrix.sh",
```

- [ ] **Step 7: Run the mysql parity matrix (live)**

Run: `pnpm reports:parity:mysql:matrix`
Expected: `✅ ALL 9 report queries are pg-vs-mysql parity-equivalent` for BOTH MySQL 8.4 and MariaDB 11.4. Fix any tri-variant SQL drift surfaced here back in Task 5's `report-seeds.ts` (this harness is precisely why the tri-variant approach was chosen). Re-commit report-seeds.ts fixes under a `fix(reporting): …` message if needed.

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/reports-parity-fixture.ts scripts/mssql-reports-parity.ts scripts/mysql-reports-parity.ts scripts/mysql-reports-parity-matrix.sh package.json
git commit -m "test(reports): pg-vs-mysql report parity harness (MySQL 8.4 + MariaDB 11.4)"
```

---

## Task 10: Live end-to-end read surfaces on both engines

Prove the whole read lift against real engines using the dev API + throwaway Playwright. **Dev shortcuts (flagged): dev servers + `AUTH_DEV_BYPASS=true` + throwaway containers — dev/test only.** Not committed code.

- [ ] **Step 1: Bring up infra + a MySQL target**

```bash
docker compose up -d postgres minio minio-init keycloak
docker run -d --name openldr-s2-mysql -p 13306:3306 -e MYSQL_ROOT_PASSWORD='Openldr_Local_2026' -e MYSQL_DATABASE=openldr_target mysql:8.4 --character-set-server=utf8mb4
for i in $(seq 1 40); do docker exec openldr-s2-mysql sh -c "mysql -uroot -p'Openldr_Local_2026' -e 'select 1'" >/dev/null 2>&1 && break; sleep 3; done
```

- [ ] **Step 2: Boot the dev API against the mysql target (reports must now seed)**

```bash
MIGRATE_ON_START=true SEED_ON_START=true AUTH_DEV_BYPASS=true \
NODE_OPTIONS="--dns-result-order=ipv4first" \
TARGET_STORE_ADAPTER=mysql MYSQL_HOST=127.0.0.1 MYSQL_PORT=13306 MYSQL_DATABASE=openldr_target \
MYSQL_USER=root MYSQL_PASSWORD='Openldr_Local_2026' MYSQL_SSL=false \
node apps/server/dev.mjs > /tmp/s2-api.log 2>&1 &
```
Confirm in `/tmp/s2-api.log`: `startup seed complete` with a NON-zero `dataDrivenReportsSeeded` (the reversal of S1 — the mysql connector now resolves in `WAREHOUSE_NAMES`), and NO error-level lines.

- [ ] **Step 3: Drive the read surfaces (throwaway e2e/*.mjs Playwright, per the memory playbook)**

Write throwaway `e2e/tmp-s2-mysql.mjs` scripts (delete after) that, against the dev studio:
- `/query`: the `Target Warehouse (MySQL/MariaDB)` connector appears in the connector list; expand it → schemas + tables introspect (patients, observations, …); open a table tab → the SQL uses backticks (`` select * from `openldr_target`.`patients` ``); run it → rows return.
- Run a built-in report (e.g. AMR Resistance Rate) from the Reports page → non-empty result, no error.
- Report Designer: open a seeded design (e.g. `rt-amr-resistance`), bind the mysql-backed query, preview → renders rows.
- A dashboards raw-SQL widget (if the flag is on) executes against the mysql target (exercises `runSqlQuery`'s mysql branch via the Task 7 derivation).

Capture pass/fail to the console. (Use the e2e package's own Playwright per `[[playwright-live-troubleshooting]]` — the browser MCP bridge is unusable here.)

- [ ] **Step 4: Repeat against MariaDB 11.4**

Tear down the MySQL target, start a MariaDB one, re-boot the dev API against it, re-run the same drive:
```bash
# stop the dev API (kill the node on :3000 by PID), then:
docker rm -f openldr-s2-mysql
docker run -d --name openldr-s2-mariadb -p 13306:3306 -e MARIADB_ROOT_PASSWORD='Openldr_Local_2026' -e MARIADB_DATABASE=openldr_target mariadb:11.4
for i in $(seq 1 40); do docker exec openldr-s2-mariadb sh -c "mariadb -uroot -p'Openldr_Local_2026' -e 'select 1'" >/dev/null 2>&1 || docker exec openldr-s2-mariadb sh -c "mysql -uroot -p'Openldr_Local_2026' -e 'select 1'" >/dev/null 2>&1 && break; sleep 3; done
# re-run Step 2's dev-API boot + Step 3's drive
```
Both engines must pass the same drive (this exercises the MySQL-vs-MariaDB timeout-var portability in `runSqlQuery`'s mysql branch on a real MariaDB).

- [ ] **Step 5: Tear down**

```bash
docker rm -f openldr-s2-mariadb 2>/dev/null; docker rm -f openldr-s2-mysql 2>/dev/null
rm -f e2e/tmp-s2-*.mjs
```

---

## Final gate

- [ ] **Step 1: Per-package typecheck + tests for every touched package (run directly, NOT via turbo/tail)**

```
pnpm --filter @openldr/dashboards exec tsc --noEmit
pnpm --filter @openldr/dashboards exec vitest run
pnpm --filter @openldr/reporting exec tsc --noEmit
pnpm --filter @openldr/reporting exec vitest run
pnpm --filter @openldr/config exec tsc --noEmit
pnpm --filter @openldr/config exec vitest run
pnpm --filter @openldr/adapter-mysql-store exec tsc --noEmit
pnpm --filter @openldr/adapter-mysql-store exec vitest run
pnpm --filter @openldr/bootstrap exec tsc --noEmit
pnpm --filter @openldr/bootstrap exec vitest run
pnpm --filter @openldr/server exec tsc --noEmit
pnpm --filter @openldr/server exec vitest run
pnpm --filter @openldr/studio exec tsc --noEmit
pnpm --filter @openldr/studio exec vitest run
```
(Substitute the real package names if any differ — verify with `grep '"name"' <pkg>/package.json`.) Expected: all PASS/clean. Cross-package `SqlDialect` widening is covered because `@openldr/bootstrap` and `@openldr/reporting` typecheck here.

- [ ] **Step 2: Live gates green** — `pnpm reports:parity:mysql:matrix` (both engines) + Task 10's e2e (both engines) passed.

- [ ] **Step 3: Docs** — update `DEPLOYMENT.md`'s support matrix / notes so MySQL 8.4 + MariaDB 11.4 are marked validated across the FULL read surface (query workbench, built-in reports, Report Designer, dashboards), not just the write path. Commit:
```bash
git add DEPLOYMENT.md
git commit -m "docs: MySQL/MariaDB validated across all read surfaces (S2)"
```

---

## Self-review — spec coverage

- `SqlDialect += 'mysql'` in `sql-runner.ts` (LIMIT/OFFSET reuse + read-only/per-engine timeout: `max_execution_time` ms vs `max_statement_time` s, handled portably): **Task 1** ✅
- `SqlDialect += 'mysql'` in `report-seeds.ts` (+ `DialectSql += mysql`): **Task 5** ✅
- `query-routes.ts`: `SQL_TYPES += 'mysql'` + `information_schema` introspection filtered for mysql: **Task 3** ✅
- Backtick identifier quoting (studio table preview — the "handled separately" quoting the query-routes comment refers to): **Task 4** ✅
- Tri-variant report SQL — a MySQL variant per built-in report (GROUP_CONCAT/SUM(CASE)/DATE_FORMAT-or-substr bucketing; ONLY_FULL_GROUP_BY strict grouping): **Task 5** ✅ (none of the 9 queries use `string_agg`, so no `GROUP_CONCAT` is needed; `count(*) filter` → `SUM(CASE)` and month bucketing via `substr` are the actual translations)
- Register the mysql connector name in `WAREHOUSE_NAMES` + `connector.type === 'mysql' ? 'mysql'` dialect resolution so reports seed on a mysql target: **Task 6** ✅
- Extend `reports:parity` to validate MySQL vs Postgres on the same fixture across MySQL 8.4 + MariaDB 11.4: **Task 9** ✅ (shared-fixture sibling harness — deviation from "extend the mssql file" noted in the task)
- S1 tracking item 1 — `index.ts:435` 3-way engine derivation: **Task 7** ✅
- S1 tracking item 2 — explicit strict-TLS-verify knob instead of carried-forward `rejectUnauthorized:false`: **Task 8** ✅
- `compile.ts` builder-query validation under `MysqlDialect`: covered by **Task 10** live e2e (builder-mode dashboards run through `runBuilderQuery`; `compile.ts` is portable kysely — the live drive validates LIMIT/OFFSET, boolean handling, string ops, and grouped-expression ORDER BY on a real mysql/mariadb). No code change anticipated; if the live drive surfaces a divergence, fix it in `compile.ts` with a regression test before merge.
- Custom Queries, dashboards raw SQL, Report Designer over mysql; live e2e on both engines: **Task 10** ✅
- Support-matrix docs: **Final gate Step 3** ✅

**Type consistency check:** `SqlDialect` widened identically in both declaration sites (Task 1 dashboards, Task 5 reporting); `DialectSql` gains `mysql` (Task 5); `dialectFor` returns `'mysql'` (Task 2); the warehouse connector name string `'Target Warehouse (MySQL/MariaDB)'` is byte-identical between `bootstrap/seed.ts`'s `MYSQL_CONNECTOR_NAME` (S1) and `report-seeds.ts`'s `WAREHOUSE_NAMES` (Task 6); `MysqlStoreConfig.rejectUnauthorized` (Task 8) is optional and threaded from `MYSQL_SSL_REJECT_UNAUTHORIZED` through target-store/seed/connector-db consistently.

**Placeholder scan:** every code step shows concrete code; the report-SQL translations reference a concrete rule table; the two "fill in against the real harness" notes (Task 3 query-routes tests, which must match an unread Fastify harness) instruct copying the exact adjacent mssql test — acceptable because the harness shape is established and copying it verbatim is the correct, unambiguous action.
