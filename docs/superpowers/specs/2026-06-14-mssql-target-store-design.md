# Phase-2 sub-project 1 — SQL Server target-store adapter (P2-DB)

**Date:** 2026-06-14
**Status:** Approved design (ready for implementation planning)
**PRD:** `openldr-ce-prd-phase2.md` — P2-DB-1/2/3/4 (Oracle P2-DB-5 deferred), P2-NFR-3 (multi-driver verified), plus the `target-store test` CLI (PRD §3)
**Build-sequence step:** Phase-2 §7 step 1 — the FIRST Phase-2 sub-project

---

## 1. Purpose & scope

Make the **external/target warehouse** pluggable to **SQL Server** so a Ministry can run OpenLDR CE against MSSQL instead of Postgres. This unblocks real client deployments (PRD §7 step 1).

Only the **target store** is affected: the 7 flattened analytics tables, their DDL/migrations, the FlatWriter that upserts into them, and the reporting layer that reads them. The **internal operational database** (`fhir_resources`, `outbox_events`, `ingest_batches`, `plugins`, `audit_events`, `users`) **stays Postgres always** — it is not part of this work.

Feasibility settled by live probe (see the `mssql-toolchain` memory): `mcr.microsoft.com/mssql/server:2022` runs under Docker here; Kysely's `MssqlDialect` + `tedious` + `tarn` connects and runs dialect-mapped DDL, an idempotent MERGE upsert (twice → no duplicate), and `groupBy`+`countAll`.

**In scope:**
- New `adapter-mssql-store` package implementing `TargetStorePort` over Kysely `MssqlDialect`.
- Dialect-aware external DDL (one schema, Postgres + MSSQL emit) — P2-DB-4.
- Dialect-aware FlatWriter upsert: PG `onConflict`, MSSQL `MERGE` — per-row idempotent parity (P2-DB-2 parity slice).
- Config + bootstrap selection via the existing `TARGET_STORE_ADAPTER` enum.
- Reporting verified on MSSQL with no raw-SQL regressions (P2-DB-3).
- Optional `mssql` docker-compose profile + `.env` vars.
- CLI `target-store test --engine <postgres|mssql>`.
- Unit tests (SQL-string generation, no live DB) + live multi-driver acceptance (P2-NFR-3).

**Out of scope (deferred):**
- True **bulk-copy** fast path (tedious `bulkLoad` → staging → MERGE) and load tuning → **P2-HARD** (the load/perf sub-project). This sub-project delivers correct, idempotent per-row parity with the PG path.
- **Oracle** adapter (P2-DB-5) → Phase 3 / on demand. The port stays ready.
- Reporting **PDF** export (P2-REP-4), the AMR/GLASS pack (P2-REP), and the SQL Server bulk perf/security passes (P2-HARD-2/3).
- Any change to the internal operational DB (stays Postgres).

---

## 2. Cross-cutting principles this sub-project demonstrates

- **DP-1 composition root** — only `@openldr/bootstrap` imports the concrete `adapter-mssql-store`; the new adapter is selected by config. `@openldr/db` stays adapter-free (it takes an `engine` enum, not a dialect).
- **DP-2 portability** — data lands in the client's chosen warehouse (Postgres or SQL Server) over open, flattened tables.
- **DP-7 resilience** — `target-store test` + `healthCheck` degrade gracefully; a missing/unreachable MSSQL surfaces as a health `down`, not a crash.
- **P2-NFR-3 multi-driver verified** — the same WHONET dataset flows through ingest → flat tables → reporting on **both** Postgres and SQL Server with identical report results.

---

## 3. Engine seam: how `@openldr/db` stays adapter-free

`@openldr/db` must emit dialect-correct DDL and upserts without importing any adapter or driver. The seam is a single enum threaded from the composition root:

```ts
export type TargetEngine = 'postgres' | 'mssql';
```

- `externalMigrations` becomes a **factory**: `externalMigrations(engine: TargetEngine): Record<string, Migration>`.
- `createFlatWriter(db, engine: TargetEngine)` branches its upsert.
- Bootstrap derives `engine` from `cfg.TARGET_STORE_ADAPTER` (`'pg' → 'postgres'`, `'mssql' → 'mssql'`) and passes it in.

No Kysely dialect introspection (Kysely does not cleanly expose its dialect); the engine is explicit config-derived state.

---

## 4. New package `adapter-mssql-store`

Sibling to `adapter-db-store`. Depends on `kysely`, `tedious`, `tarn`, `@openldr/core` (probe), `@openldr/ports`. Exports:

```ts
export interface MssqlStoreConfig {
  host: string; port: number; database: string;
  user: string; password: string;
  encrypt: boolean; trustServerCertificate: boolean;
}
export interface MssqlStore extends TargetStorePort { close(): Promise<void>; }
export function createMssqlStore(cfg: MssqlStoreConfig, deps?: { dialect?: Dialect }): MssqlStore;
```

Internals (validated in the probe):
```ts
const dialect = new MssqlDialect({
  tarn: { ...tarn, options: { min: 0, max: 10 } },
  tedious: {
    ...tedious,
    connectionFactory: () => new tedious.Connection({
      server: cfg.host,
      authentication: { type: 'default', options: { userName: cfg.user, password: cfg.password } },
      options: { port: cfg.port, database: cfg.database, encrypt: cfg.encrypt, trustServerCertificate: cfg.trustServerCertificate },
    }),
  },
});
```
`healthCheck` = `probe(() => sql\`select 1\`.execute(db))`. `transaction` = `db.transaction().execute(fn)`. `close` = `db.destroy()`. A `deps.dialect` seam allows a fake dialect in unit tests (mirrors `adapter-db-store`'s `deps.pool`).

`pnpm-workspace.yaml` `allowBuilds`: if pnpm flags a `tedious` build script during install, add it there (decided at implementation time, verified by a clean `pnpm install`).

---

## 5. Dialect-aware external DDL (P2-DB-4)

`001_flat_tables` is refactored to take the engine and use a type map. The 7 tables and their columns are unchanged in meaning; only the emitted column types/defaults differ.

| logical type (column) | postgres | mssql |
|---|---|---|
| codes, names, refs, text fields | `text` | `nvarchar(max)` (raw `sql`) |
| primary key `id` | `text` primaryKey | `varchar(450)` primaryKey (MSSQL PK length limit; 450 is safe) |
| `value_quantity` | `double precision` | `float` (raw `sql`) |
| `created_at` default | `timestamptz` default `now()` | `datetime2` default `SYSUTCDATETIME()` (raw `sql`) |

A helper module (e.g. `migrations/external/dialect.ts`) exports `textType(engine)`, `keyType(engine)`, `floatType(engine)`, and `applyCommon(builder, engine)` (the provenance columns + `created_at`). `down` (drop tables) is dialect-agnostic. `ifNotExists()`/`ifExists()` are supported by both Kysely dialects.

Rationale: a single schema definition avoids per-engine drift (the alternative — separate `external-pg`/`external-mssql` migration sets — was rejected).

---

## 6. Dialect-aware FlatWriter upsert (P2-DB-2 parity)

`createFlatWriter(db, engine)`:
- **postgres** (unchanged): `insertInto(table).values(row).onConflict(oc => oc.column('id').doUpdateSet(updateRow))`.
- **mssql**: per-row `MERGE` (validated in probe):
  ```ts
  db.mergeInto(`${table} as t`)
    .using(buildValuesSource(row), (j) => j.onRef('t.id', '=', 's.id'))
    .whenMatched().thenUpdateSet(updateColsFromSource)
    .whenNotMatched().thenInsertValues(insertColsFromSource)
    .execute();
  ```
Both are idempotent on `id` and behavior-equivalent (insert-or-update one flat row). The `MERGE` source is built from the row's columns; `updateRow` excludes `id` and `created_at` (as today). The writer's public contract (`write(resource, provenance) → 'written' | 'skipped'`) is unchanged.

---

## 7. Config + bootstrap

`ConfigSchema` changes:
- `TARGET_STORE_ADAPTER: z.enum(['pg', 'mssql']).default('pg')`.
- New optional MSSQL fields: `MSSQL_HOST`, `MSSQL_PORT` (coerce number, default 1433), `MSSQL_DATABASE`, `MSSQL_USER`, `MSSQL_PASSWORD`, `MSSQL_ENCRYPT` (coerce boolean, default false for local/dev), `MSSQL_TRUST_SERVER_CERT` (coerce boolean, default true for local/dev).
- A refinement: when `TARGET_STORE_ADAPTER === 'mssql'`, the `MSSQL_*` connection fields are required; when `'pg'`, `TARGET_DATABASE_URL` is required (today it is unconditionally required — relax to conditional). `INTERNAL_DATABASE_URL` stays unconditionally required (always Postgres).

`createAppContext` / `createDbContext`:
- A small `selectTargetStore(cfg)` chooses `createDbStore({ url })` or `createMssqlStore({...mssql})` and yields `{ store, engine }`.
- `engine` is passed to `externalMigrations(engine)` and `createFlatWriter(externalDb, engine)`.
- `reportingDb` binding and the `store.db as Kysely<ExternalSchema>` cast are unchanged (the cast already exists).

---

## 8. Reporting verification (P2-DB-3)

Reporting is pure Kysely query-builder with **zero raw SQL** (verified by grep). Expected to run on MSSQL unchanged. Verification is a live run of all 4 reports against the MSSQL target, asserting parity with Postgres (notably AMR = 100% R on AMP). If any Kysely MSSQL quirk surfaces (candidates: `OFFSET/FETCH` for limit/offset, `countAll` return type, boolean literals), it is fixed in the reporting helpers/queries in a dialect-portable way and flagged per P2-DB-3. No raw SQL is introduced.

---

## 9. Dev infra

`docker-compose.yml` gains an **optional** service behind a profile so it never starts by default:
```yaml
  mssql:
    image: mcr.microsoft.com/mssql/server:2022-latest
    profiles: ['mssql']
    environment:
      ACCEPT_EULA: 'Y'
      MSSQL_SA_PASSWORD: ${MSSQL_PASSWORD:-Openldr_Local_2026!}
    ports: ['1433:1433']
```
(The git-ignored `docker-compose.override.yml` may remap the host port to avoid conflicts, mirroring the Postgres/Keycloak remap.) `.env.example` gains the `MSSQL_*` vars (commented, with the local defaults). `docker compose --profile mssql up -d` starts it.

---

## 10. CLI

`openldr target-store test --engine <postgres|mssql> [--json]` (PRD §3): builds the chosen store from config, runs `healthCheck`, prints status/detail (human + `--json`). Non-zero exit on `down`. Reuses the bootstrap `selectTargetStore` seam.

---

## 11. Testing strategy

- **Unit (no live DB; stays in `pnpm test`):**
  - Dialect DDL: compile `externalMigrations('postgres')` and `externalMigrations('mssql')` `up` against a Kysely instance with each dialect (no connection — Kysely can `.compile()` query/DDL builders to SQL strings) and assert the emitted SQL contains the right types (`timestamptz`/`now()` vs `datetime2`/`SYSUTCDATETIME()`, `double precision` vs `float`).
  - Dialect upsert: compile the FlatWriter statement per engine and assert PG emits `on conflict` and MSSQL emits `merge`.
  - `adapter-mssql-store` health check with a fake dialect/connection (mirrors `adapter-db-store`'s `deps.pool` test): up on success, down on throw.
- **Live acceptance (P2-NFR-3):** see §12.
- `pnpm typecheck` covers the new package + config + db changes.

---

## 12. Live acceptance (multi-driver, P2-NFR-3)

1. `docker compose --profile mssql up -d` (Postgres + MinIO + Keycloak already up; this adds SQL Server). Create the target database if needed.
2. With `TARGET_STORE_ADAPTER=mssql` + `MSSQL_*` set: `openldr db migrate` creates the 7 flat tables in SQL Server (`datetime2`/`nvarchar(max)`/`float`).
3. `openldr target-store test --engine mssql` → up.
4. Seed: install the WHONET plugin and `openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite` → resources flattened and **MERGE-upserted** into the MSSQL flat tables; re-running ingest does not duplicate rows (idempotency).
5. `openldr report run amr-resistance --json` (against MSSQL) → **100% R on AMP**, identical to the Postgres result.
6. Switch back to `TARGET_STORE_ADAPTER=pg` and confirm the Postgres path still works (no regression).

Passing 2–6 demonstrates **P2-DB-1/2/3/4** and **P2-NFR-3** — OpenLDR CE writes to and reports from SQL Server with parity to Postgres.

---

## 13. Risks & mitigations

- **Kysely MSSQL quirks in reporting** (limit/offset, count type, booleans) → caught by §12 step 5; fixed dialect-portably, flagged per P2-DB-3.
- **MSSQL PK length limit** (`nvarchar(max)` can't be a PK) → `id` uses `varchar(450)`; FHIR ids are short UUIDs/identifiers, well within 450.
- **`tedious` install / native deps under pnpm** → verified by a clean `pnpm install`; add to `allowBuilds` only if pnpm requires it.
- **Encryption defaults** — local dev uses `encrypt=false`, `trustServerCertificate=true`; production guidance (encrypt=true + real certs) is documented but credential hardening proper is **P2-HARD-3**.
- **Two-engine config drift** — a single `selectTargetStore` seam + the `engine` enum keep the branch in one place; the `TargetSchema↔ExternalSchema` cast stays in lockstep (existing carry-forward).
