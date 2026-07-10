# MSSQL Slice 2b: Raw-SQL widget + dialect-portable built-in reports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a SQL Server install fully functional for queries: (1) `runSqlQuery` (dashboard raw-SQL, "Path B") dialect-aware + gate lifted; (2) the 9 built-in reports seed + run on MSSQL via dialect-portable SQL variants, validated semantically-equivalent to Postgres by a live cross-dialect parity harness.

**Architecture:** Path B mirrors Slice 2 (reuse `planPagination`; MSSQL uses `SET LOCK_TIMEOUT` instead of Postgres `set transaction read only`/`statement_timeout`). Reports use **dual-variant SQL**: each `SEED_QUERIES` entry carries `{ postgres, mssql }`, and `seedDataDrivenReports` picks the variant from the resolved warehouse connector's dialect (reversing Slice 1's report-skip-on-MSSQL). The T-SQL ports follow a fixed rules table and are validated against a live SQL-Server-vs-Postgres parity harness.

**Tech Stack:** TypeScript, Kysely, vitest, tsx, Docker (SQL Server 2022 + Postgres 16).

---

## Context the engineer needs

- **Semantic equivalence, not byte-for-byte** (per the spec). Same rows + numbers; trivial formatting (`100` vs `100.0`) is fine on MSSQL. The parity harness normalizes formatting + tie order before comparing.
- **Postgres variants must NOT change.** The existing `amr-*-parity.test.ts` (which check the PG SQL against the old catalog) must stay green. Only ADD mssql variants.
- **Dialect source = connector type.** `SqlDialect` (`'postgres'|'mssql'`) is from `@openldr/dashboards` (Slice 1/2). `dialectFor` maps connector `type` → dialect.
- **Flat date columns are `nvarchar` (ISO strings) on MSSQL** (`authored_on`, `effective_date_time`, `issued`, `received_time`, `birth_date`). String comparisons work as-is; only date *arithmetic* needs `cast(x as datetime2)` / `cast(x as date)`.
- **`runSqlQuery`** is `packages/dashboards/src/sql-runner.ts` (Path B — the `dashboard.raw_sql` widget), called at `packages/bootstrap/src/index.ts:436`; gated pg-only at `apps/server/src/app.ts:42`. Distinct from `runConnectorSql` (Path A, done in Slice 2).
- **`seedDataDrivenReports`** (`packages/reporting/src/seed/report-seeds.ts`) resolves the warehouse connector by `DEFAULT_CONNECTOR_NAME` (`'Target Warehouse (Postgres)'`) and stamps its id onto each `SEED_QUERIES` entry. Slice 1 named the MSSQL connector `'Target Warehouse (SQL Server)'` so reports skipped on MSSQL — this slice makes the seed resolve either name + pick the dialect.
- **T-SQL porting rules** (apply per query):

| Postgres | T-SQL |
|----------|-------|
| `count(*) filter (where C)` | `sum(case when C then 1 else 0 end)` |
| `X::int` / `::float8` / `::text` / `::numeric` | `cast(X as int)` / `cast(X as float)` / `cast(X as nvarchar(max))` / `cast(X as decimal(18,4))` |
| `X::date` / `X::timestamptz` | `cast(X as date)` / `cast(X as datetime2)` |
| `a || b` | `a + b` (cast non-text operands) |
| `to_char(date_trunc('month', d::timestamptz), 'YYYY-MM')` | `format(cast(d as datetime2), 'yyyy-MM')` |
| `extract(epoch from (a::timestamptz - b::timestamptz)) / 3600.0` | `datediff(second, cast(b as datetime2), cast(a as datetime2)) / 3600.0` |
| `extract(year from age(ref, birth))` | `datediff(year, birth, ref) - case when (month(birth) > month(ref)) or (month(birth) = month(ref) and day(birth) > day(ref)) then 1 else 0 end` |
| `array_position(array[…]::text[], band)` (ORDER BY) | `case band when '0-4' then 1 when '5-14' then 2 … end` |
| `round(X, 1)`, `coalesce`, `nullif` | unchanged (portable) |

- **Do NOT add a Co-Authored-By trailer.** Windows / Git Bash; pnpm. Cross-package type changes (reporting → bootstrap) need both typechecked.

## File structure

- **Modify** `packages/dashboards/src/sql-runner.ts` — `runSqlQuery` gains an `engine: SqlDialect` param; dialect-aware txn/timeout/pagination.
- **Modify** `packages/bootstrap/src/index.ts` — pass the engine (from `cfg.TARGET_STORE_ADAPTER`) to `runSqlQuery`.
- **Modify** `apps/server/src/app.ts` — lift the `raw_sql` pg-only gate.
- **Modify** `packages/reporting/src/seed/report-seeds.ts` — dual-variant `SEED_QUERIES`, `antibiogramCellSql(dialect)`, dialect-aware `seedDataDrivenReports`, 9 mssql variants.
- **Create** `scripts/mssql-reports-parity.ts` (+ `pnpm reports:parity`) — the live cross-dialect parity harness.
- Test files alongside.

---

### Task 1: Path B — dialect-aware `runSqlQuery` + lift the gate

**Files:**
- Modify: `packages/dashboards/src/sql-runner.ts`
- Test: `packages/dashboards/src/sql-runner.test.ts`
- Modify: `packages/bootstrap/src/index.ts`
- Modify: `apps/server/src/app.ts`

- [ ] **Step 1: Read the current `runSqlQuery`**

Read `packages/dashboards/src/sql-runner.ts` `runSqlQuery` (the Postgres `set transaction read only` + `set local statement_timeout` + `select * from (…) limit N` block) and its `SqlRunOpts`. Read the call site `packages/bootstrap/src/index.ts:~431-440` and the gate `apps/server/src/app.ts:42`.

- [ ] **Step 2: Write failing tests**

Add to `sql-runner.test.ts` a describe that drives `runSqlQuery` with a fake Kysely `db` capturing executed SQL (mirror how the existing `runSqlQuery` tests fake `db.transaction().execute` / `sql.execute`). Assert:
- postgres engine → issues `set transaction read only`, `set local statement_timeout`, and a `planPagination(..,'postgres',..)`-shaped capped query (LIMIT wrapper).
- mssql engine → issues `set lock_timeout <ms>` (NOT `set transaction read only`/`statement_timeout`) and the `planPagination(..,'mssql',..)` SET ROWCOUNT batch, applying the slice.
(If the existing tests already fake the transaction, extend that harness; keep the existing postgres tests passing.)

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @openldr/dashboards test -- sql-runner` → FAIL (`runSqlQuery` takes no engine / always Postgres).

- [ ] **Step 4: Implement dialect-aware `runSqlQuery`**

Change the signature to `runSqlQuery(db, rawSql, opts, engine: SqlDialect = 'postgres')`. Replace the capped-SQL construction with `planPagination(inner, engine, { limit: cap })` (use `.sql`; `sliceOffset` is 0 for a rowCap-only call on postgres, and for mssql slice the returned rows by `plan.sliceOffset` — which is 0 here since no offset). Branch the session setup:
```ts
  return db.transaction().execute(async (trx) => {
    if (engine === 'mssql') {
      // SQL Server has no `set transaction read only`; the SELECT-only validation above enforces
      // read-only-ness. SET LOCK_TIMEOUT bounds lock waits (there is no per-statement time cap in T-SQL).
      await sql.raw(`set lock_timeout ${Math.floor(opts.timeoutMs)}`).execute(trx);
    } else {
      await sql`set transaction read only`.execute(trx);
      await sql`set local statement_timeout = ${sql.lit(Math.floor(opts.timeoutMs))}`.execute(trx);
    }
    const plan = planPagination(inner, engine, { limit: cap });
    const result = await sql.raw<Record<string, unknown>>(plan.sql).execute(trx);
    const rows = plan.sliceOffset ? result.rows.slice(plan.sliceOffset) : result.rows;
    // …existing column/chart derivation using `rows`…
  });
```
(Keep the existing column/chart-shape derivation; just feed it the possibly-sliced `rows`.)

- [ ] **Step 5: Thread the engine at the call site**

In `packages/bootstrap/src/index.ts` where `runSqlQuery(reportingDb, finalSql, { … })` is called (~line 436), pass the engine: `runSqlQuery(reportingDb, finalSql, { … }, cfg.TARGET_STORE_ADAPTER === 'mssql' ? 'mssql' : 'postgres')`.

- [ ] **Step 6: Lift the pg-only gate**

In `apps/server/src/app.ts:42`, change `dashboardSqlEnabled: (await ctx.featureFlags.get('dashboard.raw_sql')) && ctx.cfg.TARGET_STORE_ADAPTER === 'pg'` to drop the `&& … === 'pg'` clause (raw SQL now works on both). Check `apps/server/src/dashboards-routes.ts` (lines ~66, 81) — those gates read only the flag, not the adapter, so they need no change; confirm.

- [ ] **Step 7: Run tests + cross-package typecheck**

Run: `pnpm --filter @openldr/dashboards test -- sql-runner` (PASS), `pnpm --filter @openldr/dashboards typecheck`, `pnpm --filter @openldr/bootstrap typecheck`, `pnpm --filter @openldr/server typecheck` — all exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/dashboards/src/sql-runner.ts packages/dashboards/src/sql-runner.test.ts packages/bootstrap/src/index.ts apps/server/src/app.ts
git commit -m "feat(mssql): dialect-aware runSqlQuery (SET LOCK_TIMEOUT) + lift dashboard.raw_sql pg gate"
```

---

### Task 2: Dual-variant `SEED_QUERIES` + dialect-aware seed + 9 T-SQL variants

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts`
- Test: `packages/reporting/src/seed/report-seeds.test.ts`

- [ ] **Step 1: Introduce the dual-variant type**

Define a local seed type carrying both dialects, e.g.:
```ts
type DialectSql = { postgres: string; mssql: string };
type SeedQuery = Omit<NewCustomQuery, 'sql'> & { sql: DialectSql };
```
Change `export const SEED_QUERIES: NewCustomQuery[]` → `export const SEED_QUERIES: SeedQuery[]`. Change `antibiogramCellSql(antibiotic: string)` → `antibiogramCellSql(antibiotic: string, dialect: SqlDialect)` returning the dialect-appropriate fragment (import `SqlDialect` from `@openldr/dashboards`).

- [ ] **Step 2: For EACH of the 9 queries, set `sql: { postgres: <existing>, mssql: <ported> }`**

Keep the existing SQL verbatim as `postgres`. Author `mssql` by applying the porting rules table (Context). The 9 query ids (confirmed): `q-facilities`, `q-amr-resistance`, `q-test-volume`, `q-turnaround-time`, `q-patient-demographics`, `q-amr-facility-summary`, `q-amr-glass-ris`, `q-amr-first-isolate-summary`, `q-amr-antibiogram`. Read each in the file; the last three (glass-ris, first-isolate-summary, antibiogram) are the most complex (window/dedup + the antibiogram CASE panel). Notable ports:
- `q-facilities`: no Postgres-isms → `mssql` is identical to `postgres` (still provide both keys).
- `q-amr-resistance` / `q-amr-facility-summary`: `sum(case…)::int` → `cast(sum(case…) as int)`; `round(100.0*…/nullif(…,0),1)::float8` → `cast(round(100.0*…/nullif(…,0),1) as float)`; `{{param.to}} || 'T23:59:59.999Z'` → `{{param.to}} + 'T23:59:59.999Z'`; `'Patient/' || p.id` → `'Patient/' + cast(p.id as nvarchar(max))` (id may be text already — cast defensively).
- `q-test-volume`: `to_char(date_trunc('month', sr.authored_on::timestamptz), 'YYYY-MM')` → `format(cast(sr.authored_on as datetime2), 'yyyy-MM')`; `count(*)::int` → `cast(count(*) as int)`.
- `q-turnaround-time`: `extract(epoch from (dr.issued::timestamptz - r.received_time::timestamptz))/3600.0)::int` → `cast(datediff(second, cast(r.received_time as datetime2), cast(dr.issued as datetime2))/3600.0 as int)`; `round(avg(hours)::numeric,1)::float8` → `cast(round(avg(cast(hours as float)),1) as float)`; `+` for concat.
- `q-patient-demographics`: the `age()` band → the `datediff(year,…) - <borrow>` rule; `array_position(array[…])` ORDER BY → `case band when … end`; `coalesce(nullif({{param.asOf}}, ''), '2026-01-01T00:00:00Z')::date` → `cast(coalesce(nullif({{param.asOf}}, ''), '2026-01-01T00:00:00Z') as date)`.
- `q-amr-antibiogram`: uses `antibiogramCellSql` — port its `count(*) filter (where …)` + `::float8::text` + `|| '% (' || …` per rules (`sum(case when … then 1 else 0 end)`, `cast(... as float)`, `cast(... as nvarchar(max))`, `+`).

Do NOT try to get these byte-perfect now — Task 3's live harness validates and drives fixes. Aim for well-formed T-SQL following the rules.

- [ ] **Step 3: Make `seedDataDrivenReports` dialect-aware**

Change the connector resolution to accept either warehouse name and derive the dialect from the connector `type`:
```ts
const WAREHOUSE_NAMES = ['Target Warehouse (Postgres)', 'Target Warehouse (SQL Server)'];
…
  const connector = connectors.find((c) => WAREHOUSE_NAMES.includes(c.name));
  if (!connector) { console.log('[seed] no target-warehouse connector found — skipping data-driven report seed'); return EMPTY_RESULT; }
  const dialect: SqlDialect = connector.type === 'microsoft-sql' ? 'mssql' : 'postgres';
```
When creating each query, select the variant: `await deps.customQueries.create({ ...q, sql: q.sql[dialect], connectorId: connector.id });`. (`ConnectorStore.list`'s record must expose `type` — confirm; it does, connectors carry a `type`.)

- [ ] **Step 4: Unit tests**

In `report-seeds.test.ts`: (a) assert `seedDataDrivenReports` with a fake `microsoft-sql` warehouse connector creates queries whose `sql` equals the `mssql` variant (spot-check one, e.g. `q-test-volume` contains `format(` and not `to_char`). (b) assert with a `postgres` warehouse connector it uses the `postgres` variant (contains `to_char`). (c) assert every `SEED_QUERIES` entry has BOTH `sql.postgres` and `sql.mssql` non-empty. Keep the existing seed tests green (adjust for the new `sql` shape).

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @openldr/reporting test` (PASS, incl. the existing `amr-*-parity` PG tests), `pnpm --filter @openldr/reporting typecheck`, `pnpm --filter @openldr/bootstrap typecheck`.

- [ ] **Step 6: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts packages/reporting/src/seed/report-seeds.test.ts
git commit -m "feat(mssql): dual-variant built-in report queries + dialect-aware report seed"
```

---

### Task 3: Live cross-dialect parity harness — validate + fix the 9 ports

**Files:**
- Create: `scripts/mssql-reports-parity.ts`
- Modify: `package.json` (add `reports:parity`)
- Modify: `packages/reporting/src/seed/report-seeds.ts` (iterative T-SQL fixes driven by the harness)

- [ ] **Step 1: Write the parity harness**

Create `scripts/mssql-reports-parity.ts` (tsx). It:
  1. Connects to a live **Postgres** target (env `TARGET_DATABASE_URL`) and a live **SQL Server** target (env `MSSQL_*`), both with the `openldr_target` flat schema migrated (`externalMigrations('postgres'|'mssql')` via `createMigrator`).
  2. Seeds **identical** fixture data into both via the flat writer (`createFlatWriter(db, engine)` — reuse the pattern in `scripts/mssql-live-acceptance.ts`): a fixed set of patients/service_requests/observations/specimens/diagnostic_reports covering every report (AST results with S/I/R, dated service requests across ≥2 months, specimens+reports for turnaround, varied birth_dates+genders+facilities for demographics).
  3. For each of the 9 queries, runs BOTH variants via the real `runStoredQuery` path (build a `RunStoredQueryDeps` whose `runConnectorSql` targets the matching engine's `createConnectorDb`), with a fixed param bag (`{from,to,facility:'',asOf:''}`).
  4. Normalizes each result set (round floats to 3 dp; coerce numbers; sort rows by all columns to neutralize tie order) and asserts PG-normalized deep-equals MSSQL-normalized. Prints per-report PASS/FAIL with a diff on mismatch.
  Model the container/DB setup + `MSYS_NO_PATHCONV`/tools18 notes on `scripts/mssql-live-acceptance.ts` and `scripts/mssql-matrix-accept.sh`.

- [ ] **Step 2: Add the npm script**

In root `package.json` scripts: `"reports:parity": "tsx scripts/mssql-reports-parity.ts",`.

- [ ] **Step 3: Boot both targets + run the harness**

Boot Postgres 16 + SQL Server 2022 containers, create `openldr_target` in each. Run:
```bash
TARGET_DATABASE_URL=postgres://... MSSQL_HOST=localhost MSSQL_PORT=11433 MSSQL_DATABASE=openldr_target MSSQL_USER=sa MSSQL_PASSWORD='Openldr_Local_2026!' pnpm reports:parity
```
Expected first run: some reports FAIL (T-SQL ports need correction).

- [ ] **Step 4: Iterate each failing port to parity**

For each failing report, read the harness diff, fix the `mssql` variant in `report-seeds.ts` (apply the rules; common culprits: `age()` borrow off-by-one, `format` pattern, `+` NULL propagation vs Postgres `||`, integer vs float division, `datediff` unit). Re-run `pnpm reports:parity`. Repeat until **all 9 report** comparisons PASS. If a genuine semantic difference is irreconcilable (e.g. a formatting-only cell), normalize it in the harness (documented) rather than forcing byte-parity — per the semantic-equivalence decision.

- [ ] **Step 5: Confirm Postgres parity tests still green**

Run: `pnpm --filter @openldr/reporting test` — the existing `amr-*-parity.test.ts` (postgres) must still pass (you only changed mssql variants during iteration).

- [ ] **Step 6: Commit**

```bash
git add scripts/mssql-reports-parity.ts package.json packages/reporting/src/seed/report-seeds.ts
git commit -m "test(mssql): cross-dialect report parity harness + T-SQL ports validated semantically-equivalent"
```

- [ ] **Step 7: Tear down the containers.**

---

### Task 4: Local full-stack container test (MSSQL install)

**Files:** none (verification; may produce a fix commit).

The user's explicit ask: spin up the containers and confirm a real MSSQL install works end-to-end. Uses the Slice-1 installer + Slice-2/2b query surfaces.

- [ ] **Step 1: Build local images (the branch code isn't published)**

The installer pulls `ghcr.io/…/openldr-*`, which predate this branch. Build local images from the working tree so the api/studio carry Slice-1/2/2b code:
```bash
docker build -t ghcr.io/open-laboratory-data-repository/openldr-api:latest -f apps/server/Dockerfile .
docker build -t ghcr.io/open-laboratory-data-repository/openldr-studio:latest -f apps/studio/Dockerfile .
```
(Check the actual Dockerfile paths/build context from `scripts/build-and-push.sh`. If a local build is infeasible on Windows, note it and fall back to running the api/studio dev servers against the MSSQL target instead — `node dev.mjs` + vite — per the live-dev memory.)

- [ ] **Step 2: Fresh MSSQL install via the local installer**

Stage a local install (patched-fetch copying from the working tree, as validated in Slice 1 Task 5) with `--mssql-demo`, or run the dev stack with `TARGET_STORE_ADAPTER=mssql` + `MSSQL_*` pointing at a SQL Server container. Bring it up with the local images / dev servers.

- [ ] **Step 2b: Verify the stack is healthy**

Confirm api migrated the flat schema into MSSQL, the `Target Warehouse (SQL Server)` connector is seeded, and the 9 reports seeded (they no longer skip on MSSQL).

- [ ] **Step 3: Drive the query surfaces (throwaway Playwright or API)**

Using the e2e package's Playwright (per the playwright-live-troubleshooting memory) or direct authenticated API calls: (a) open `/query`, run a `select … order by …` custom query against the MSSQL warehouse connector — rows return; (b) open a built-in report (e.g. Test volume by month) — it renders with data; (c) if `dashboard.raw_sql` is enabled, run a raw-SQL widget.

- [ ] **Step 4: Report findings + fix any live bug, then tear down.**

If the live run surfaces a bug (as Slice 2's did), fix it, re-verify, commit (no trailer). Tear down all containers.

---

## Self-review notes

- **Spec coverage:** Path B dialect-aware + gate → Task 1; dual-variant + dialect seed → Task 2; 9 T-SQL ports validated live → Tasks 2+3; local container test → Task 4. Semantic-equivalence + normalization is Task 3's harness.
- **No placeholders in infra:** Task 1's runSqlQuery branch, Task 2's type + seed resolution, and Task 3's harness are concretely specified. The 9 T-SQL strings are intentionally rule-driven + harness-validated (they require live iteration to be correct — pre-writing them blind would be false precision).
- **Type consistency:** `SqlDialect` from `@openldr/dashboards` used in sql-runner, report-seeds, and the harness; `SeedQuery.sql` is `{postgres, mssql}` and the seed narrows to a `NewCustomQuery` string.
- **Postgres unchanged:** every task preserves the postgres variants and keeps the existing PG parity tests green (Task 2 Step 5, Task 3 Step 5).

## Deferred (not this plan)

- MySQL report execution.
- Publishing rebuilt images (Task 4 builds locally; the publish step is separate).
- A per-statement time cap on MSSQL (T-SQL has none; `SET LOCK_TIMEOUT` bounds lock waits only — documented dialect difference).
