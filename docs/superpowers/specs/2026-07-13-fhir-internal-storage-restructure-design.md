# FHIR-Internal Storage Restructure (→ CQRS + v2 Relational Read-Model) — Architecture Design

**Date:** 2026-07-13
**Status:** Approved architecture (brainstorm) — **north-star + decomposition.** Each slice (R0–R3) gets its own spec → plan → implementation cycle. This document defines the target architecture and, critically, the **R1 change-log contract** that downstream work (external projection *and* the Lab↔central sync workstream) binds to.
**Relates to:** `distributed-sync-central-workstream` (sync becomes a second consumer of the R1 change-log), `settings-general-feature-flags` (site-id / config source), `mysql-mariadb-target-workstream` + `mssql-toolchain` (external read-model must stay engine-pluggable), `openldr-v2` `02-openldr_external.sql` (the target relational structure).

## Problem & motivation

Today OpenLDR CE already runs two databases, but the boundary between them is under-designed:

- **Internal** (`INTERNAL_DATABASE_URL`, always Postgres) holds `fhir_resources` — the FHIR canonical store, already `jsonb` — but it sits in the `public` schema mixed in with ~45 operational tables, it is **not versioned** (the `version_id` column is inert; deletes overwrite with no tombstone), and it is written **inline** with the analytics projection.
- **External** (`TARGET_DATABASE_URL`, pluggable PG/MSSQL/MySQL) holds only a **thin flat mirror** (7 lean tables) — a shadow of the rich relational analytics schema OpenLDR v2 shipped (`02-openldr_external.sql`: terminology + facilities + provenance + patients/lab_requests/lab_results + AMR isolates/AST/breakpoints/qc/dosage).
- **Projection is synchronous**: `persist()` does `fhirStore.save` (internal) **and** `flatWriter.write` (external) in one inline call, so the analytics write is on the ingest hot path and a projection concern can degrade a canonical write.

We want a clean **CQRS split**: the internal FHIR store becomes the versioned single source of truth in its own schema; an append-only change-log records every write; and downstream consumers (an async external-projection worker now, sync-to-central later) read that log. The external database grows into the full v2 relational structure as a *derived read-model*. The original plan to fake the v2 shape with SQL views over jsonb is dropped — FHIR stays FHIR internally; the relational shape is a real projected read-model.

## Approved decisions (from brainstorm)

1. **Internal FHIR canonical store moves to its own `fhir` schema** (isolated from `public` operational tables). Internal is always Postgres, so `jsonb` is guaranteed.
2. **The write model is versioned FHIR**: monotonic per-resource `versionId` + `lastUpdated`, an append-only history table, and tombstones for deletes.
3. **Every canonical write emits one append-only change-log row.** This log is the **shared substrate** — its row shape is a frozen contract, locked at R1, that both the projection worker and the sync push consume.
4. **External DB end-state = full v2 relational read-model**, projected from FHIR, engine-pluggable (PG/MSSQL/MySQL).
5. **Projection is async** (`pg_notify` + cursor-driven worker), off the inline persist path. The external read-model is **eventually consistent** by design.
6. **Master terminology stays internal** (app-managed, versioned, sync-able down). The external read-model references terminology by code and may carry a denormalized/replicated subset for query joins — but the master lives internal, not in the external DB (a deliberate divergence from v2's layout).
7. **Sync moves in parallel, safely**: sync's transport/auth/cursor/central-mirror design proceeds now; sync's *change-capture* binds to the R1 change-log contract, so no write-path rebuild.

## 1. Target architecture (CQRS)

```
ingest / workflow / API
        │
        ▼
   persist()  ──────────────►  fhir.fhir_resources   (canonical jsonb, versioned)   ← source of truth
        │                          │  (same tx)
        │                          ├─► fhir.resource_history   (append every version + tombstones)
        │                          └─► fhir.change_log         (append-only, monotonic seq)  ── the shared contract
        │                                     │
        │                                     │ pg_notify('fhir_changes')
        │              ┌──────────────────────┴───────────────────────┐
        ▼              ▼                                               ▼
   (emit only)   external-projection worker                     sync push worker (later)
                 consumes change_log by cursor                  consumes change_log by cursor
                        │                                               │
                        ▼                                               ▼
                 external DB (v2 relational read-model)          central OpenLDR (FHIR mirror)
                 PG / MSSQL / MySQL
```

- **Write model** (internal `fhir` schema): the only must-succeed write. Canonical resource + history + change-log row committed atomically.
- **Change-log** (`fhir.change_log`): append-only, monotonic `seq`. The single source of downstream truth about "what changed, in what order." Consumers hold a high-water-mark cursor.
- **Read model(s)**: derived, rebuildable, eventually consistent. The external v2 relational DB is the first read-model consumer; sync-to-central is the second. Either can be rebuilt by replaying the change-log from `seq = 0` (or from the canonical store).

## 2. The R1 change-log contract (frozen interface)

This is the load-bearing decision of the whole workstream. Locked at R1 so parallel work binds to a stable shape.

**`fhir.change_log`**

| column | type | notes |
| --- | --- | --- |
| `seq` | `bigserial` PK | monotonic per instance; the cursor axis |
| `resource_type` | `text` not null | e.g. `Observation` |
| `resource_id` | `text` not null | FHIR logical id |
| `version_id` | `bigint` not null | the resource version this row records (see §3) |
| `op` | `text` not null | `upsert` \| `delete` |
| `content_hash` | `text` null | sha-256 of the canonical serialization at capture time (no-op detection, integrity) |
| `site_id` | `text` null | originating site; nullable now, populated from config; present so **sync never has to alter this table** |
| `recorded_at` | `timestamptz` not null default now() | wall-clock; never an authority, tiebreak only |

**Contract guarantees consumers may rely on:**
- `seq` is monotonic and gap-tolerant (gaps from rolled-back txns are normal). Consumers advance a high-water-mark and must tolerate gaps.
- Every canonical write produces exactly one `change_log` row in the **same transaction** as the `fhir_resources` upsert (no lost or phantom changes).
- `(resource_type, resource_id, version_id)` uniquely identifies a version → idempotent apply downstream (`id + versionId` dedup).
- `op = 'delete'` is a tombstone; the canonical row may be gone but its identity + version persist here and in `resource_history`.

**Consumer cursors** live in a sibling table `fhir.change_cursors(consumer, last_seq, updated_at)` — one row per consumer (`projection`, later `sync:<peer>`). This generalizes the sync spec's `sync_cursors`.

> **Concurrency note (consumer-side, R2+):** a txn with a lower `seq` can commit *after* a reader has already advanced past a higher `seq`, so a naive "`seq > last_seq`" read can skip rows. Consumers must read with a safe watermark (e.g. only consume `seq` below the oldest in-flight transaction, or re-scan a lag window). This is a **consumer** concern; the log itself just guarantees monotonic append. Flagged here so R2 and sync both handle it the same way.

## 3. Versioning model (R1)

- `fhirStore.save` assigns a **monotonic integer `versionId` per `(resource_type, id)`**: first write → `1`, each subsequent write → `previous + 1`. Written to both `fhir_resources.version_id` (promoted to `bigint`) and `resource.meta.versionId`; `meta.lastUpdated` stamped server-side.
- **`fhir.resource_history`** — append every version: `(resource_type, id, version_id, resource jsonb, op, recorded_at)`, PK `(resource_type, id, version_id)`. This is the audit/`_history` substrate and the tombstone home.
- **Delete = tombstone**: a history row with `op='delete'` + a `change_log` row with `op='delete'`; the `fhir_resources` current row is removed (or flagged). A later read returns "gone."
- This is the substrate the sync workstream's conflict policy ("higher `versionId` wins; tie → central-authoritative then `updatedAt`") needs, and it makes real FHIR `_history`/`vread`/optimistic-locking *possible later* — though **exposing a conformant FHIR REST API is explicitly out of scope** for this workstream.

## 4. Slice decomposition

Each slice is independently shippable with its own spec → plan.

- **R0 — `fhir` schema move.** Create schema `fhir`; move `fhir_resources` into it; repoint `fhir-store`, the internal migrator, `persist`, and every query/reference. **Zero behavior change**, fully testable (existing suites stay green). This is the literal "move the DB + all functions that point to it" step. *Only* `fhir_resources` moves; operational/reference tables (terminology, forms, workflows, …) stay in `public`.
- **R1 — Versioned canonical + change-log (the contract).** Monotonic `versionId` + `lastUpdated`; `fhir.resource_history`; tombstone-on-delete; emit `fhir.change_log` (§2) in the same transaction as each save; `fhir.change_cursors`. **Freezes the change-log row shape.** No consumer yet — pure, unit-testable foundation. **This slice unblocks parallel sync.**
- **R2 — Async projection (CQRS decouple).** A `pg_notify('fhir_changes')` + cursor-driven worker (sibling to the existing outbox worker) consumes `change_log` and projects into the external read-model. `persist()` drops the inline `flatWriter` call → becomes "save canonical + emit"; the worker owns projection. Reports/dashboards become eventually consistent (surfaced in UI/docs). Projection apply is idempotent (upsert by id) and replayable from `seq=0`.
- **R3 — v2 relational read-model (incremental).** Grow the external schema from the thin flat tables into the full v2 structure, resource-by-resource: `Patient→patients`, `ServiceRequest→lab_requests`, `Observation→lab_results`, `DiagnosticReport`, `Specimen`, `Organization/Location→facilities`, and micro `Observation`s → `isolates` + `susceptibility_tests`, plus AMR reference (`breakpoints`/`qc_ranges`/`dosage`). Must stay engine-pluggable — v2's PG-isms (`gen_random_uuid`, `gin`/`pg_trgm`, plpgsql triggers, views) need dialect-aware DDL or engine-gated features. **Terminology placement resolved here** per decision 6 (master internal; external carries a denormalized/replicated subset for joins).

**Sync workstream relationship:** the Lab↔central sync (its own S0–S6 in `2026-07-02-distributed-sync-architecture-design.md`) becomes a **second consumer** of `fhir.change_log`. Its S0 "change-capture" collapses into "read R1's change-log by cursor" — no separate `sync_changes` table, no write-path hooks of its own. Sync's transport/auth/enrollment/central-mirror design proceeds in parallel now; only its capture binds to R1.

## 5. Terminology & reference-data placement (decision 6)

- **Master terminology stays internal** (`public`): `coding_systems`/`concepts`/`term_mappings`/`value_sets`/ontology tables as today. It is app-managed reference data, versioned, and (in the sync workstream) pushed *down* to labs.
- The **external v2 read-model references terminology by code**. Where the v2 analytics views need names/joins (e.g. `vw_resistance_rates` joining `concepts`), R3 either (a) projects a **denormalized display** at projection time, or (b) replicates a **read-only terminology subset** into the external DB. Decision deferred to R3; the invariant fixed now is *master-internal*.

## 6. Consistency, error handling, guarantees

- **Canonical write is atomic and must-succeed**: `fhir_resources` + `resource_history` + `change_log` commit together, or not at all. A projection/external failure can never degrade a canonical write (fixes today's inline-degrade coupling).
- **Read-model is eventually consistent**: bounded lag between canonical save and external availability. UI/reports must not assume read-after-write on the external DB. Surfaced explicitly (Settings/status + docs).
- **Idempotent, replayable projection**: apply keyed by `(resource_type, id)`; re-consuming from an earlier cursor is safe; the entire read-model can be rebuilt by replay.
- **Deletes propagate** as tombstones through history + change-log → projection removes/soft-deletes the read-model row.
- **Ordering**: consumers apply in `seq` order with the §2 watermark to avoid skipping late-committing rows.

## 7. Testing strategy

- **R0:** existing internal-DB suites green post-move; migration up/down round-trip; schema-qualified access verified.
- **R1:** `versionId` increments per resource; history append + tombstone; `change_log` row emitted in-tx for every save (upsert + delete); content-hash stability; cursor advance. Pure unit tests, no network.
- **R2:** worker consumes log → projects; idempotent re-consume; replay-from-zero rebuilds read-model; watermark skips no late rows; canonical write survives projection failure.
- **R3:** per-resource projection correctness vs v2 shape; engine parity (PG/MSSQL/MySQL) reusing the `mssql:accept`/`mysql:accept`-style acceptance harness; AMR isolate/AST derivation from micro observations.

## 8. Open items (resolve at slice time)

- `versionId` type/scheme across the jsonb `meta` and the promoted column (integer vs string) — settle at R1.
- Change-log **retention/compaction** (history can grow unbounded) — a hardening concern, likely shared with sync S6.
- External read-model **terminology strategy** (denormalize vs replicate) — R3.
- Engine-specific DDL for v2 PG-isms (UUID default, trigram/gin, views) on MSSQL/MySQL — R3.
- Whether `persist()`'s existing batch path (`persistResources`) emits one change-log row per resource or one per batch — R1 (default: per resource).
- Backfill: emit synthetic change-log rows for pre-existing `fhir_resources` so a fresh read-model can be built on upgrade — R2/R3.
