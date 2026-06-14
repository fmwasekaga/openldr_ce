# Warehouse load results — batched flat-writer (P2-HARD-2, P2-NFR-3)

Date: 2026-06-14. Measured on the developer machine via `pnpm load:measure -- --rows 500`
(500 synthetic WHONET isolates → **3000 FHIR resources** per run: 500 Patient + 500
Specimen + 500 organism Observations + 1500 AST Observations), ingested end-to-end
through the CLI (`openldr ingest --plugin whonet-sqlite`): plugin convert → canonical
FHIR save (internal Postgres) → flat-table write (target warehouse). Each run starts from
a clean `db reset`. The single background ingest worker (`apps/server`) was stopped so the
CLI's own drain is the sole consumer and the timing is attributable.

**Baseline** = per-resource flat writes (one `INSERT`/`MERGE` per resource — the pre-batch
path, measured by temporarily routing the ingest persist through `persistResource`).
**Batched** = `FlatWriter.writeMany` (multi-row `INSERT … ON CONFLICT` on Postgres /
multi-row `MERGE` on SQL Server), wired through `persistResources`.

## Results (500 isolates ≈ 3000 resources)

| Engine | Path | Wall time | Throughput | Speedup |
|--------|------|-----------|------------|---------|
| Postgres | baseline (per-resource) | 20,925 ms | 143.4 resources/s | — |
| Postgres | **batched** | 9,667 ms | **310.3 resources/s** | **~2.2×** |
| SQL Server | baseline (per-resource) | 119,904 ms | 25.0 resources/s | — |
| SQL Server | **batched** | 10,304 ms | **192.9 resources/s** | **~7.7×** |

(Throughput counts the whole ingest wall-clock incl. constant process/plugin startup, so
it understates the pure DB-write speedup. The per-row `MERGE` on SQL Server is especially
slow — 3000 separate MERGE statements — which is why the batched win there is dramatic.)

## Correctness & parity (P2-NFR-3)

- After ingest, both engines hold **identical** flat-table counts: `patients=500`,
  `specimens=500`, `observations=2000`.
- **Idempotent:** re-ingesting the same deterministic sample leaves the counts unchanged
  on both engines (the batched upsert/MERGE keys on `id`).
- Batched output is row-equivalent to the per-resource output on both engines.

## Bug found and fixed during this live acceptance

The first SQL Server batched run reported the batch `done (3000 resources)` but wrote **0
flat rows** (DP-7 degraded the flat write silently while the canonical saves succeeded).
Root cause: **SQL Server caps a single statement at 2100 bound parameters**, and the
original `writeMany` used a fixed `MSSQL_MAX_ROWS = 500` chunk — but params = rows ×
columns, so 500 rows of a wide table (e.g. observations) is ~7500 params, well over 2100,
and the whole `MERGE` failed. A 3-row ingest worked (few params), which is why unit tests
and small smoke runs didn't catch it.

Fix (`packages/db/src/flat-writer.ts`): size each chunk by a **parameter budget** derived
from the actual column count — `floor(budget / cols)` — with budgets under each driver's
ceiling (Postgres 60000 of 65535; SQL Server 2000 of 2100, also capped at the 1000-row
`VALUES` constructor limit). Regression tests assert a large batch splits into multiple
MERGE statements on SQL Server and stays a single insert on Postgres.

## Honest caveat

This is **synthetic local volume** (one machine, Dockerized Postgres/SQL Server, 3000
resources) measured to make the batching win observable and to verify multi-driver parity
— it is **not** a production-scale, concurrent, or distributed load test. True bulk-copy
(`tedious bulkLoad` → staging → MERGE) for SQL Server remains a deferred carry-forward; the
batched multi-row MERGE delivered here is the per-row-parity throughput win, not native
bulk load.
