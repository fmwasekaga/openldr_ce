# MySQL / MariaDB as a First-Class External Target — Design

**Date:** 2026-07-11
**Status:** Approved (brainstorm) — ready for implementation planning
**Author:** OpenLDR CE team

## Summary

Make self-hosted **MySQL 8.4 LTS** and **MariaDB 11.4 LTS** fully supported **external / analytics target**
databases for OpenLDR CE, at parity with Postgres and SQL Server — working end-to-end across the write
path **and** the interactive query/report surfaces, selectable at install time.

The internal operational database stays Postgres, always. The external/target ("analytics warehouse")
database — where flat reporting tables live and where dashboards, reports, custom queries, and the report
designer read from — may be **Postgres, SQL Server, or MySQL/MariaDB**, chosen by the operator at install
time.

This workstream is a near-1:1 mirror of the completed MSSQL external-target workstream
(`docs/superpowers/specs/2026-07-10-mssql-external-target-design.md`), reusing the same abstraction seams.
MySQL is dialectally *closer to Postgres* than SQL Server is (native `LIMIT/OFFSET`, similar syntax), so the
read-surface lift is generally smaller — the notable exceptions are captured under Risks.

## Goals

- Operator declares the external/target DB type at install (`--target-db postgres|mssql|mysql`, default `postgres`).
- MySQL 8.4 LTS and MariaDB 11.4 LTS are validated and documented as supported self-hosted targets.
- The full read/query experience (query workbench, custom queries, report designer, dashboards raw SQL,
  built-in reports) works against a MySQL/MariaDB target, not just Postgres/SQL Server.
- The write path (target-store adapter, external migrations, FlatWriter, built-in reports) is validated on
  both engines and formally documented.

## Non-goals (explicit)

- **No cloud / hosted databases — ever.** No Amazon RDS/Aurora MySQL, no Azure Database for MySQL, no Google
  Cloud SQL, no PlanetScale or other hosted MySQL. Same hard data-sovereignty requirement as the MSSQL
  workstream: Ministry-of-Health data stays on operator-controlled infrastructure. Self-hosted only.
- **No MySQL 5.7 / MariaDB ≤ 10.x as validated targets.** MySQL 5.7 is end-of-life. Only the current LTS of
  each engine (MySQL 8.4, MariaDB 11.4) is first-class. Older releases are out of scope (operators upgrade to
  the LTS).
- **Internal operational DB stays Postgres, always** — the event bus, audit log, users, plugins, outbox, and
  FHIR resource store are unaffected.
- **This workstream is MySQL/MariaDB-focused.** Other connector dialects (MongoDB, Redis, etc.) remain
  connector/query-only and are not external target stores.

## Support matrix (to be documented)

| Engine / version | Self-hosted container | Support level |
|---|---|---|
| MySQL 8.4 LTS | yes | Supported (managed demo pinned here) |
| MariaDB 11.4 LTS | yes | Supported |
| MySQL 8.0 / MariaDB 10.11 | yes | Not first-class (likely works via the same adapter; not validated) |
| MySQL 5.7 and earlier | n/a | **Not supported** — end of life; upgrade to 8.4 |
| RDS/Aurora/Azure/Cloud SQL/PlanetScale | n/a | **Never supported** (data sovereignty) |

- The supported set is the single source of truth in a `supported-versions.ts` for the mysql adapter
  (mirroring `packages/adapter-mssql-store/src/supported-versions.ts`) and is validated end-to-end by
  `pnpm mysql:accept:matrix` across **both** MySQL 8.4 and MariaDB 11.4.
- **Managed demo container** (pinned to MySQL 8.4) is for evaluation/demo only.
- **Production = BYO** — the operator points OpenLDR at an existing self-hosted MySQL/MariaDB.

## Architecture — abstraction seams (already in place from the MSSQL work)

The dialect is threaded through a small set of typed seams; this workstream extends each to add `'mysql'`:

- `packages/db/src/engine.ts` — `type TargetEngine = 'postgres' | 'mssql'` → `+ 'mysql'`.
- `packages/dashboards/src/sql-runner.ts` — `type SqlDialect = 'postgres' | 'mssql'` → `+ 'mysql'`.
- `packages/reporting/src/seed/report-seeds.ts` — `type SqlDialect` and `type DialectSql = { postgres; mssql }`
  → `+ mysql`; the connector→dialect map (`connector.type === 'mysql' ? 'mysql' : …`).
- `packages/config/src/schema.ts` — `TARGET_STORE_ADAPTER: z.enum(['pg','mssql'])` → `+ 'mysql'`, plus
  `MYSQL_*` env and cross-field validation.
- Connector type `mysql` already exists (`packages/bootstrap/src/connector-db.ts`: `mysql2` `createPool` +
  kysely `MysqlDialect`) and is reused by the target-store adapter and the query surfaces.

## Write path

- **New `@openldr/adapter-mysql-store`** (`createMysqlStore(cfg)` + health check), mirroring
  `@openldr/adapter-mssql-store`. Reuses the `mysql2` pool + kysely `MysqlDialect` already used by the
  connector. Config: `host/port/database/user/password/ssl`.
- **`externalMigrations('mysql')`** — the flat schema (`patients`, `specimens`, `service_requests`,
  `observations`, `diagnostic_reports`, `organizations`, `locations`, + kysely migration tables) in MySQL
  types: `VARCHAR`/`LONGTEXT` (utf8mb4) for text, `DATETIME` for timestamps, `JSON` where used. Tables keep
  the existing **`id` primary key**.
- **FlatWriter `mysql` branch** (`packages/db/src/flat-writer.ts`): `insertInto(table).values(chunk)
  .onDuplicateKeyUpdate(...)` keyed on the `id` PK — idempotent (2× write → no dup rows), mirroring the
  Postgres `onConflict('id')` and MSSQL `MERGE` branches. No extra unique index is required because the upsert
  keys on the PK the flat tables already have.

## Read surfaces (dialect-aware)

- **`packages/dashboards/src/sql-runner.ts`:**
  - Pagination: MySQL reuses the Postgres derived-table `select * from (…) as _q limit N offset M` path
    (MySQL/MariaDB support `LIMIT/OFFSET` in derived tables; no T-SQL-style `set rowcount` needed).
  - Read-only + timeout: `START TRANSACTION READ ONLY`, plus a **per-engine** statement timeout — MySQL 8.4
    uses `SET max_execution_time = <ms>` (SELECT-only optimizer hint, milliseconds); MariaDB 11.4 uses
    `SET max_statement_time = <seconds>` (session var, seconds). The runner applies the correct one portably
    (attempt/detect; see Risks). SELECT-only validation (already shared) enforces read-only-ness regardless.
- **`apps/server/src/query-routes.ts`:** `SQL_TYPES += 'mysql'`; **backtick** identifier quoting
  (`` `schema`.`table` ``); `information_schema` introspection filtered by `table_schema = DATABASE()` (drop
  the pg-specific `pg_catalog` / `pg\_%` filters for mysql). MySQL follows the Postgres total-count path (the
  mssql-only count skip does not apply).
- **Report SQL — tri-variant:** `DialectSql = { postgres, mssql, mysql }`; each of the ~9 built-in report
  queries gains an explicit MySQL variant. Known translations: `string_agg` → `GROUP_CONCAT`, `FILTER (WHERE …)`
  → `SUM(CASE WHEN … END)`, date bucketing → `DATE_FORMAT`, and strict `GROUP BY` (see `ONLY_FULL_GROUP_BY`
  under Risks). Custom Queries, dashboards raw SQL, and the Report Designer inherit the dialect-aware runner —
  no per-surface report duplication.
- **`packages/dashboards/src/compile.ts`** builder queries — validation pass under `MysqlDialect`
  (LIMIT/OFFSET, boolean handling, string ops, ORDER BY of grouped expressions); fix any divergence.

## Installer + config

- **Config:** `TARGET_STORE_ADAPTER` enum `+= 'mysql'`; `MYSQL_HOST/PORT/DATABASE/USER/PASSWORD/SSL` with
  cross-field validation (required when adapter is `mysql`), mapping to the adapter config.
- **Installer (`install/install.sh` + `install.ps1`):**
  - `--target-db mysql` (`-TargetDb mysql`).
  - **Managed-demo path** `--mysql-demo` (`-MysqlDemo`): a pinned MySQL 8.4 service + target-DB init in the
    installer compose overlay (`deploy/install/docker-compose.mysql.yml`), generated root/app password,
    `openldr_target` created automatically. Labeled evaluation-only.
  - **BYO path:** `--mysql-host/--mysql-port/--mysql-database/--mysql-user/--mysql-password/--mysql-ssl`; the
    target DB must already exist.
  - Dialect-aware seed of demo data; the **default connector** row is seeded as type `mysql` so `/query`,
    Custom Queries, and the Report Designer bind out of the box.
  - Postgres remains the default and is unchanged when mysql is not selected.
- **Docs:** extend the web Install doc's "SQL Server as the analytics database" section (or a sibling) and
  `DEPLOYMENT.md` support matrix + data-sovereignty policy to include MySQL/MariaDB.

## Testing strategy

- **`mysql:accept:matrix`** — the backbone: real MySQL 8.4 **and** MariaDB 11.4 containers, exercising the
  actual code paths (store + health, both-dialect external migrations DDL parity, idempotent
  `ON DUPLICATE KEY UPDATE` (2× write → no dup rows), built-in reports over the external schema). Includes
  Unicode via utf8mb4, null handling, date-grain bucketing parity, and a larger-than-smoke dataset.
- **`reports:parity` extended** — the existing fixture harness compares MySQL results against Postgres
  (semantically equivalent after numeric/tie normalization), catching tri-variant drift. Runs against both
  MySQL 8.4 and MariaDB 11.4.
- **Unit tests** — the dialect-aware runner (pagination wrapper, backtick quoting, read-only/timeout per
  engine), FlatWriter mysql upsert branch, and config validation.
- **Live end-to-end (S2):** drive a seeded mysql install through `/query`, run a built-in report, and bind +
  preview a report design — against both engines.

## Slice decomposition (mirrors MSSQL)

### S0 — Baseline: adapter + migrations + writer + acceptance (low UI)

- `@openldr/adapter-mysql-store` + `supported-versions.ts`.
- `externalMigrations('mysql')`; `TargetEngine += 'mysql'`.
- FlatWriter `mysql` (`onDuplicateKeyUpdate`) branch + unit tests.
- `mysql:accept:matrix` (8.4 + 11.4) + `reports:parity` extended.
- Support-matrix + data-sovereignty docs.
- **Deliverable:** a validated, documented write-path baseline on both engines.

### S1 — Installer target-DB selection

- `TARGET_STORE_ADAPTER += 'mysql'` + `MYSQL_*` config/validation.
- Installer `--target-db mysql`, managed-demo overlay (MySQL 8.4) + BYO flags; PowerShell parity.
- Dialect-aware seed; seed a `mysql` default connector.
- **Deliverable:** an operator can install onto MySQL/MariaDB in one command; the app boots, migrates, and
  seeds against it.

### S2 — Dialect-aware query surfaces (the read lift; critical path)

- `SqlDialect += 'mysql'` across `sql-runner.ts` (pagination + read-only/timeout), `query-routes.ts`
  (`SQL_TYPES`, backtick quoting, `information_schema` introspection).
- Tri-variant report SQL (`DialectSql += mysql`) for all built-in reports.
- `compile.ts` builder-query validation under `MysqlDialect`.
- Custom Queries, dashboards raw SQL, Report Designer over mysql.
- Live e2e on both engines.
- **Deliverable:** MySQL/MariaDB is a full peer of Postgres/SQL Server across every read surface.

## Top risks

- **MySQL ≠ MariaDB on the statement-timeout pragma** — MySQL 8.4 `max_execution_time` (ms, SELECT hint) vs
  MariaDB 11.4 `max_statement_time` (seconds, session var). The runner must apply the correct one portably;
  the acceptance matrix runs both to catch regressions. Other subtle divergences (JSON functions,
  `RETURNING` support, `sql_mode` defaults) are likewise caught by running both engines.
- **`ONLY_FULL_GROUP_BY`** — on by default in MySQL 8; the MySQL report variants must use strict `GROUP BY`
  (every non-aggregated selected column grouped) or they error where the PG/MSSQL variants tolerated loose
  grouping.
- **Backtick identifier quoting + `information_schema` introspection** — must be genuinely dialect-aware in
  `query-routes.ts` (not string-patched) to avoid injection/correctness bugs, exactly as the MSSQL work
  handled `[bracket]` quoting.
- **Report-SQL triplication drift** — mitigated by the extended `reports:parity` harness (the reason the
  tri-variant approach was chosen over a helper abstraction).
- **utf8mb4 / collation** — the mysql flat schema must use `utf8mb4` so Unicode clinical text round-trips;
  collation choice must not break the report string comparisons.

## Open questions (resolve during planning)

- Managed-demo compose networking: sidecar vs the installer's single-port gateway network (same gotcha noted
  for the MSSQL demo overlay).
- BYO connection encryption/SSL defaults (self-signed on-prem common) — confirm the `--mysql-ssl` default and
  the `mysql2` TLS options.
- Whether the MySQL demo container should be MySQL 8.4 or offer a MariaDB 11.4 variant (default MySQL 8.4;
  MariaDB validated via the acceptance matrix regardless).
