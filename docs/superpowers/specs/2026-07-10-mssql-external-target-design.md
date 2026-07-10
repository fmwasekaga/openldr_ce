# MSSQL as a First-Class External Target — Design

**Date:** 2026-07-10
**Status:** Approved (brainstorm) — ready for implementation planning
**Author:** OpenLDR CE team

## Summary

Make self-hosted Microsoft SQL Server a fully supported **external / analytics target** for OpenLDR CE, selectable at install time, working end-to-end across the write path **and** the interactive query/report surfaces.

The internal operational database stays Postgres, always. The external/target ("analytics warehouse") database — where flat reporting tables live and where dashboards, reports, custom queries, and the report designer read from — may be **Postgres or SQL Server**, chosen by the operator at install time.

## Goals

- Operator declares the external/target DB type at install (defaults to `postgres`).
- SQL Server 2017, 2019, and 2022 are validated and documented as supported self-hosted targets.
- The full read/query experience (query workbench, custom queries, report designer, dashboards raw SQL) works against a SQL Server target, not just Postgres.
- The already-working write path (target-store adapter, external migrations, FlatWriter, built-in reports) is re-validated across the supported version matrix and formally documented.

## Non-goals (explicit)

- **No cloud / hosted databases — ever.** No Azure SQL Database, no Azure SQL Managed Instance, no AWS RDS, no cloud SQL of any kind. This is a hard data-sovereignty requirement: Ministry of Health data must remain within geographic bounds on operator-controlled infrastructure. Self-hosted SQL Server only.
- **No SQL Server 2014 or earlier.** No official Linux container exists and the release is end-of-life. Operators currently on 2014 (e.g. Zambia, Mozambique) are expected to upgrade to the nearest supported release, 2017.
- **Internal operational DB stays Postgres, always** — the event bus, audit log, users, plugins, outbox, and FHIR resource store are unaffected by this workstream.
- **Other connector dialects (MySQL, MongoDB, etc.) are out of scope** — this workstream is SQL-Server-focused. Their query-surface support is a separate future effort.

## Support matrix (to be documented)

| SQL Server version | Linux container | Support level |
|---|---|---|
| 2017 | yes | Supported (floor) |
| 2019 | yes | Supported |
| 2022 | yes | Supported; **managed demo container pinned here** |
| 2014 and earlier | no | **Not supported** — upgrade to 2017 |
| Azure SQL / Managed Instance / cloud | n/a | **Never supported** (data sovereignty) |

- **Managed demo container** (pinned to 2022) is for evaluation/demo only and MUST be clearly labeled non-production — SQL Server Developer/Express editions are not licensed for production use.
- **Production = BYO (bring-your-own)** — the operator points OpenLDR at an existing self-hosted SQL Server; OpenLDR does not ship a production SQL Server.

## Architecture — current state vs. the gap

### Already works (validated 2026-06-21, `pnpm mssql:accept`, against SQL Server 2022)

- Target-store adapter `@openldr/adapter-mssql-store` (`createMssqlStore`, health check).
- Dialect-aware external migrations (`externalMigrations('mssql')`) — all flat tables created.
- `createFlatWriter(db, 'mssql')` — batched, idempotent MERGE upsert.
- Built-in code reports (`@openldr/reporting` `getReport().run()`) over the external schema.
- **Config schema is already MSSQL-ready**: `TARGET_STORE_ADAPTER: z.enum(['pg','mssql'])` plus `MSSQL_HOST/PORT/DATABASE/USER/PASSWORD/ENCRYPT/TRUST_SERVER_CERT`, with cross-field validation requiring the MSSQL fields when the adapter is `mssql` (`packages/config/src/schema.ts`).
- Dynamic connector type `microsoft-sql` — `createConnectorDb` builds a Kysely `MssqlDialect` (`packages/bootstrap/src/connector-db.ts`); the connector **test** path already allows `microsoft-sql` (`packages/bootstrap/src/connector-test.ts`).

### The gap

1. **Installer never selects mssql.** `install/install.sh` (and `install.ps1`) hardcode a Postgres target (`TARGET_DATABASE_URL=postgres://…/openldr_target` against the bundled Postgres container). `TARGET_STORE_ADAPTER` is never set (defaults to `pg`).
2. **Seed always targets Postgres.** Demo data and the default connector row are seeded assuming Postgres.
3. **Interactive read path is Postgres-only.** The query workbench gate is `SQL_TYPES = new Set(['postgres'])` (`apps/server/src/query-routes.ts`), and the shared SQL runner `packages/dashboards/src/sql-runner.ts` uses Postgres-specific `set transaction read only`, `set local statement_timeout`, and a `limit N` pagination wrapper. Identifier quoting (`"schema"."table"`) and the pagination wrapper (`select * from (…) limit N offset M`) are invalid T-SQL. This means a seeded `microsoft-sql` default connector would be unusable in `/query`, Custom Queries, and the Report Designer.

The consequence: the installer choice and the query surfaces are **coupled**. Selecting mssql at install seeds a `microsoft-sql` default connector; unless the read path is dialect-aware, that connector is dead on arrival. Slice 2 is therefore on the critical path, not optional polish.

## Slice decomposition

Baseline first (per approved sequencing), then the installer wiring, then the query-surface lift.

### Slice 0 — Baseline validation + version decision (testing + docs; low code)

- Extend `scripts/mssql-live-acceptance.ts` (`pnpm mssql:accept`) into a **version-matrix** runner that can target 2017, 2019, and 2022 containers.
- Validate per version: store creation + health check; both-dialect external migrations (DDL parity); idempotent MERGE upsert (2× write → no dup rows); built-in code reports over `ExternalSchema`.
- Add edge-case coverage: Unicode text via `nvarchar(max)`, null handling, date-grain bucketing (JS-side math parity), and a larger dataset than the smoke test.
- Document the support matrix and the no-cloud / data-sovereignty policy in `DEPLOYMENT.md` and the in-app/web docs.
- **Deliverable:** a validated, documented baseline and a committed version-support policy.

### Slice 1 — Installer target-DB selection

- `install/install.sh` and `install/install.ps1` prompt for external DB type (default `postgres`).
- **Managed-demo mssql path:** add a pinned `mssql` service (2022) and target-DB init to the installer compose stack; write `MSSQL_*` env vars and `TARGET_STORE_ADAPTER=mssql`. Clearly labeled non-production.
- **BYO mssql path:** collect `MSSQL_HOST/PORT/DATABASE/USER/PASSWORD/ENCRYPT/TRUST_SERVER_CERT`; write env; do not add a container.
- Seed runs against the chosen dialect (dialect-aware seed of demo data into the external DB).
- The **default connector** row is seeded as `microsoft-sql` (vs `postgres`) to match the chosen target, so `/query`, Custom Queries, and the Report Designer bind to the real external DB out of the box.
- Postgres remains the default and is entirely unchanged when not selecting mssql.

### Slice 2 — Dialect-aware query surfaces (the real code lift; critical path)

- **`packages/dashboards/src/sql-runner.ts`** — make the read-only transaction, statement/lock timeout, and row-cap/pagination wrapper dialect-aware. T-SQL uses `OFFSET … ROWS FETCH NEXT … ROWS ONLY` (or `TOP`), snapshot/read-only isolation, and `SET LOCK_TIMEOUT`. Preserve the existing single-statement / SELECT-only validation.
- **`apps/server/src/query-routes.ts`** — extend `SQL_TYPES` to include `microsoft-sql`; make the pagination wrapper and identifier quoting (`"x"` vs `[x]`) genuinely dialect-aware; confirm the `information_schema` introspection queries work on SQL Server (portable, but remove/branch the pg-specific `pg_catalog` / `pg\_%` filters).
- **Custom Queries** execution over an mssql connector.
- **Report Designer** data-binding over mssql connectors (currently deferred to Postgres).
- **Dashboards raw SQL** (`dashboard.raw_sql` flag path) over mssql.
- **`packages/dashboards/src/compile.ts`** builder queries — validation pass under `MssqlDialect` (LIMIT/OFFSET, boolean handling, string ops, ORDER BY of grouped expressions); fix any dialect divergence.

## Testing strategy

- **Slice 0 matrix acceptance script** is the backbone — real SQL Server containers per supported version, exercising the actual code paths (not mocks).
- **Unit tests** for the dialect-aware runner: pagination wrapper, identifier quoting, timeout, and read-only enforcement per dialect.
- **Live end-to-end pass** (Slice 2): drive a seeded mssql install through `/query`, run a built-in report, and bind + preview a report design — all against a live SQL Server target.

## Top risks

- **T-SQL read-only / timeout semantics** differ from Postgres (`SET LOCK_TIMEOUT`, snapshot isolation vs `set transaction read only` + `statement_timeout`). The runner change needs care and per-dialect tests.
- **Identifier quoting and the pagination wrapper** are the two things `query-routes.ts` explicitly deferred; both must be genuinely dialect-aware, not string-patched, to avoid injection and correctness bugs.
- **Managed demo container licensing** — must be labeled non-production and must never be the default target.
- **Version drift** — features are 2017+ safe, but the matrix runner must actually run all three versions to catch regressions (e.g. `STRING_AGG` is 2017+, `GENERATE_SERIES` is 2022+ — avoid the latter or branch).

## Open questions (resolve during planning)

- Exact seed shape for the mssql demo dataset — reuse the Postgres demo fixtures translated to the external schema, or a dedicated mssql seed path?
- Whether the managed-demo mssql container shares the installer's single-port gateway network or is a sidecar (compose networking gotchas noted in the mssql-toolchain memory).
- Connection encryption defaults for BYO (self-signed certs common on-prem → `MSSQL_TRUST_SERVER_CERT` default `true` today; confirm this is the right production default or prompt).
