# MSSQL External Target — Slice 2b: Raw-SQL widget + dialect-portable built-in reports — Design

**Date:** 2026-07-10
**Status:** Approved (brainstorm) — ready for implementation planning
**Depends on:** Slices 0, 1, 2 (all merged to local `main`)

## Summary

Complete the MSSQL query story so a SQL Server install is fully functional: (1) make the `dashboard.raw_sql` widget path (`runSqlQuery`, "Path B") dialect-aware, and (2) make the 9 built-in data-driven report queries run on SQL Server by seeding **dialect-portable** variants — reversing Slice 1's deliberate "reports skip on MSSQL" decision now that we can execute them.

## Goals

- `dashboard.raw_sql` can be enabled and used against a SQL Server target (lift the `pg`-only gate).
- The 9 built-in reports (`SEED_QUERIES`) seed and run on an MSSQL install, producing **semantically equivalent** results to the Postgres versions.
- A repeatable cross-dialect parity harness proves equivalence.

## Non-goals

- **Byte-for-byte output parity** with the old catalog on MSSQL. Per decision: **semantic equivalence** — same rows, same numbers; trivial formatting differences (e.g. a percent rendered `100.0` vs `100`, or `avgHours` `1.0` vs `1`) are acceptable on MSSQL.
- Rewriting the reports into a portable query-builder model (that's the separate query-model-expansion workstream). We use **dual-variant SQL strings**.
- MySQL report execution (only postgres + microsoft-sql).

## Approach

### Part 1 — Path B raw-SQL widget (small)

`packages/dashboards/src/sql-runner.ts` `runSqlQuery` is Postgres-specific (`set transaction read only`, `set local statement_timeout`, `select * from (…) limit N`). Make it dialect-aware:
- Accept an `engine: SqlDialect` parameter.
- Use `planPagination` (from Slice 2) for the row cap instead of the inline `limit` wrapper.
- **Postgres:** keep `set transaction read only` + `set local statement_timeout`.
- **MSSQL:** SQL Server has no `set transaction read only`; rely on the existing `validateSelectSql` SELECT-only guard for read-only-ness, and use `SET LOCK_TIMEOUT ${ms}` for the timeout. Run inside a transaction as today.
- Thread the engine at the call site (`packages/bootstrap/src/index.ts:436` — it knows `cfg.TARGET_STORE_ADAPTER`).
- Lift the `&& ctx.cfg.TARGET_STORE_ADAPTER === 'pg'` gate in `apps/server/src/app.ts:42` (`dashboardSqlEnabled`).

### Part 2 — dialect-portable built-in report queries (large)

**Dual-variant seeds.** Change each `SEED_QUERIES` entry's `sql` from `string` to `{ postgres: string; mssql: string }`, and `antibiogramCellSql(antibiotic)` → `antibiogramCellSql(antibiotic, dialect)`. `SEED_QUERIES` becomes a new local type (not `NewCustomQuery[]`); the seed builds a real `NewCustomQuery` by selecting the dialect variant.

**Dialect-aware seed.** `seedDataDrivenReports` resolves the warehouse connector by **either** `Target Warehouse (Postgres)` *or* `Target Warehouse (SQL Server)` (whichever exists), reads its `type` to pick the dialect, and seeds `q.sql[dialect]`. This reverses Slice 1's report-skip-on-MSSQL: reports now seed on MSSQL with T-SQL.

**T-SQL porting rules** (semantic equivalence). Applied per query:

| Postgres | T-SQL |
|----------|-------|
| `count(*) filter (where C)` | `sum(case when C then 1 else 0 end)` (or `count(case when C then 1 end)`) |
| `X::int` / `X::float8` / `X::text` / `X::numeric` | `cast(X as int)` / `cast(X as float)` / `cast(X as nvarchar(max))` / `cast(X as decimal(18,4))` |
| `X::date` / `X::timestamptz` | `cast(X as date)` / `cast(X as datetime2)` |
| `a || b` (string concat) | `a + b` (cast non-text operands) or `concat(a, b)` |
| `to_char(date_trunc('month', d::timestamptz), 'YYYY-MM')` | `format(cast(d as datetime2), 'yyyy-MM')` |
| `extract(epoch from (a::timestamptz - b::timestamptz)) / 3600.0` | `datediff(second, cast(b as datetime2), cast(a as datetime2)) / 3600.0` |
| `extract(year from age(ref, birth))` | `datediff(year, birth, ref) - case when (month(birth) > month(ref)) or (month(birth) = month(ref) and day(birth) > day(ref)) then 1 else 0 end` |
| `array_position(array['0-4',…]::text[], band)` (ORDER BY) | `case band when '0-4' then 1 when '5-14' then 2 … end` |
| `round(X, 1)`, `coalesce`, `nullif` | portable (same syntax) |

Note the flat date columns (`authored_on`, `effective_date_time`, `issued`, `received_time`, `birth_date`) are `nvarchar` (ISO strings) on MSSQL — string comparisons work; only date **arithmetic** (age, epoch diff, month bucket) needs a `cast … as datetime2/date`.

**Live parity harness.** A script that: creates an MSSQL target + a Postgres target, seeds **identical** fixture data into both, runs each of the 9 reports against both via the real `runStoredQuery` path, and asserts **semantic equivalence** (normalize numeric formatting + tie order, then compare rows). This is the safety net that validates each T-SQL port; ports are iterated against it until green.

## Architecture — what changes

- `packages/dashboards/src/sql-runner.ts` — `runSqlQuery(db, sql, opts, engine)`.
- `packages/bootstrap/src/index.ts` — pass the engine to `runSqlQuery`.
- `apps/server/src/app.ts` — lift the `raw_sql` pg-only gate.
- `packages/reporting/src/seed/report-seeds.ts` — `SEED_QUERIES` dual-variant + `antibiogramCellSql(dialect)` + `seedDataDrivenReports` dialect-aware resolution + 9 T-SQL variants.
- New: a cross-dialect parity acceptance script (`scripts/mssql-reports-parity.ts`, `pnpm reports:parity`).

## Testing strategy

- Unit: `runSqlQuery` dialect branch (mssql builds `SET LOCK_TIMEOUT` + SET ROWCOUNT, postgres unchanged); `seedDataDrivenReports` picks the mssql variant for a `microsoft-sql` connector; the dual-variant type compiles.
- The existing Postgres parity tests (`amr-*-parity.test.ts`) must stay green (postgres variants unchanged).
- **Live cross-dialect parity** (the crux): the harness proves all 9 reports match semantically across PG and MSSQL.
- **Local container test** (the user's explicit ask): a full `--mssql-demo` install, confirm reports seed + render on MSSQL.

## Risks

- **T-SQL semantic drift** — `age()` borrow logic, month bucketing, and rounding are the highest-risk ports; the live parity harness is the mitigation (each validated against real data on both engines).
- **`concat`/`+` NULL handling** differs (Postgres `||` yields NULL on any NULL operand; T-SQL `+` too, but `concat` treats NULL as ''); use the form that matches the Postgres semantics per query.
- **Reversing Slice 1's skip** — must confirm the design/report-def ids are shared across dialects (only the query SQL differs), so `SEED_DESIGNS`/`SEED_REPORT_DEFS` are unchanged.

## Open questions (resolve in planning)

- Whether the parity harness seeds via the ingest pipeline (FHIR → flat) or writes flat rows directly (faster, deterministic — likely the latter, mirroring `mssql-live-acceptance.ts`).
- Timeout semantics: `SET LOCK_TIMEOUT` bounds lock waits, not total statement time (MSSQL has no direct per-statement timeout in T-SQL); acceptable for a read-only SELECT cap, documented as a minor dialect difference.
