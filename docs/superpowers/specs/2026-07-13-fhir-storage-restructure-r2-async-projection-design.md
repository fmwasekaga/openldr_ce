# FHIR Storage Restructure — R2: Async Projection Worker (CQRS Decouple) — Slice Design

**Date:** 2026-07-13
**Status:** Approved-pending-review (brainstorm). Slice **R2** of the restructure north-star (`docs/superpowers/specs/2026-07-13-fhir-internal-storage-restructure-design.md`). Builds on R1 (versioned canonical + `change_log`, merged `8cfa67d0`).
**Relates to:** `fhir-storage-restructure-workstream`, `distributed-sync-central-workstream` (sync is a parallel second consumer of the same `change_log`), `settings-general-feature-flags`.

## Scope

R2 moves analytics projection off the synchronous persist hot path onto a **dedicated cursor-driven worker** that consumes `fhir.change_log` and projects into the external read-model. This is the CQRS decouple: the internal FHIR write model is the source of truth; the external read-model is derived, async, eventually consistent, and rebuildable.

**In scope:** the projection worker (consume `change_log` by cursor with an **xmin-snapshot safe-frontier**, project op-agnostically to current canonical state); removal of the inline `flatWriter` from `persist()`; `PersistResult.flattened = 'deferred'` + `persist-store-service` update; a `reprojectAll()` rebuild/recovery path; boot wiring + graceful stop; a post-commit `pg_notify('fhir_changes')` wakeup.

**Out of scope:** the **v2 relational read-model** (R3 — R2 keeps projecting into today's *thin flat schema* via the existing `flattenResource`, only moving it from inline → async); sync consumption; any change to the R1 `change_log` logical contract (seq/resource_id/version/op/content_hash/site_id unchanged).

## Locked decisions (brainstorm)

1. **Dedicated cursor worker** (sibling to the outbox worker), interval-poll primary + `LISTEN 'fhir_changes'` wakeup.
2. **xmin snapshot boundary** for the seq-gap hazard — exact, no-skip (not the time-lag approximation).
3. **Remove inline projection**; `persist()` becomes save-canonical-and-emit; `PersistResult.flattened = 'deferred'` (new enum value); `persist-store-service` + the `data.persisted` payload updated.
4. **Include `reprojectAll()`** — scan canonical → project everything (rebuild + recovery).

## 1. Architecture (the decouple)

```
persist(resources)
  └─ per resource: fhirStore.save()  ── writes fhir.fhir_resources + resource_history + change_log (R1, one tx)
  └─ after commit: pg_notify('fhir_changes')          (best-effort wakeup; failure never affects the save)
  └─ returns PersistResult { saved: true, flattened: 'deferred' }   ← no inline flat-write anymore

Projection worker (boot-managed, always-on)
  loop (interval + on NOTIFY):
    boundary  = pg_snapshot_xmin(pg_current_snapshot())        // oldest still-running txn
    rows      = change_log where seq > cursor order by seq limit N   // each row carries system xmin
    { tasks, newCursor } = planProjection(rows, boundary, cursor)    // PURE, unit-testable
    for each task (distinct resource_type,id):
        canonical = fhirStore.get(resource_type, id)
        canonical ? project(canonical) : deleteProjection(resource_type, id)   // op-agnostic, idempotent
    advance change_cursors['projection'] = newCursor
```

- **Read model = today's thin flat schema** (`packages/db/src/schema/external.ts`), written via the existing `flattenResource` — R2 does not change the target shape (R3 does).
- **Eventually consistent**: a bounded lag between `persist` and read-model availability; reports/dashboards read the external store and must not assume read-after-write. Surfaced in docs/UI.

## 2. The xmin-snapshot safe frontier (the correctness crux)

`seq` (bigserial) is assigned at insert but rows become **visible at commit**, so commits can be out of order relative to `seq` (txn T1 gets seq=5 then commits *after* T2's seq=6 → a reader between the commits sees 6, not 5). Advancing the cursor to 6 would **permanently skip 5**.

> **Correction (found by the R2 real-Postgres acceptance test):** an earlier version of this rule computed the frontier from **visible** rows only (`firstUnsafeSeq - 1`). That is wrong: an **uncommitted** row is *invisible* — it's a **gap** in the seq sequence, not a fetched-unsafe row. If seq 6 is held uncommitted (invisible) and seq 7 is committed-but-unsafe, `firstUnsafeSeq = 7 → cursor = 6`, which overshoots the invisible gap at 6 and **permanently skips it** when it later commits. The corrected rule below stops the cursor at the first *gap or* unsafe row, and distinguishes an in-flight gap (must wait) from a rolled-back gap (must skip, or projection stalls on the first aborted txn) using a small stateful marker.

**Rule (no-skip, corrected):** every `change_log` row carries Postgres's hidden **`xmin`** system column (inserting txn id) — *no new column; the R1 contract stays frozen*. Each cycle fetches, alongside the visible rows `seq > cursor` (ascending), two snapshot values: `boundary = pg_snapshot_xmin(pg_current_snapshot())` (oldest txn still running) and `xmax = pg_snapshot_xmax(pg_current_snapshot())` (first not-yet-assigned xid). Then scan the contiguous integer range `(cursor, maxFetchedSeq]`; the cursor advances up to (but not past) the **first blocking position**, where a position blocks iff:
- it is a **visible unsafe row** (`xmin >= boundary`, still possibly in-flight) — wait; or
- it is a **gap** (missing seq) that is **not yet confirmed rolled back**.

A gap is **confirmed rolled back** (skippable) once `boundary >= x0`, where `x0` is the `xmax` recorded the first time the gap was observed. Rationale: the gap's txn grabbed that seq *before* we observed the gap, so its xid `< x0`; once the oldest running txn is `>= x0`, that txn has finished, and a still-missing seq will never commit → aborted. Gaps are stamped with `x0` on first sight and carried across cycles in a small in-memory `pendingGaps` set, so a whole rolled-back region confirms together. `tasks` = distinct `(resource_type, resource_id)` among **safe** visible rows with `seq <= newCursor`.

**Testability split** (pg-mem cannot emulate MVCC / `xmin` / snapshot functions):
- `planProjection({ rows, boundary, xmax, cursor, pendingGaps })` is a **pure function** returning `{ tasks, newCursor, pendingGaps }` — unit-tested with synthetic rows/gaps, including the invisible-gap-below-an-unsafe-row case, the confirm-rolled-back-after-boundary-advance case, and the gap-fills case. **No DB.**
- The Postgres-specific fetch (`seq, xmin::text::bigint` rows + `pg_snapshot_xmin`/`pg_snapshot_xmax`) and the end-to-end projection (incl. the held-transaction no-skip scenario) are **real-Postgres acceptance-tested** (two DBs on `:5433`), `mssql:accept`-style. The stateful `pendingGaps` live in the worker's cycle runner across ticks (in-memory; on restart, gaps are simply re-observed and re-waited — safe).

*xid wraparound:* the 32-bit system `xmin` wraps after ~2^31 txns; ignored for R2 (negligible at these deployment scales) — an `xid8` column can be added later if ever needed. Noted in open items.

## 3. Projection apply (op-agnostic, current-state)

For each distinct `(resource_type, id)` in a safe batch (deduped — only the latest matters), read the **current** canonical row and converge the read-model to it:
- **canonical present** → `flatWriter.write(resource)` (idempotent upsert by id; `flattenResource` returns `skipped` for non-projected types — a no-op).
- **canonical absent** (tombstoned) → **delete** the flat row(s) for that id.

This is op-agnostic (the `change_log.op` is a hint, not the authority — canonical existence is), so it converges correctly regardless of processing order, including delete→recreate, and is fully idempotent → safe to re-run / replay.

**New flat delete path:** `flatWriter` only writes today. R2 adds `deleteById(resourceType, id)` (or a `projectionDelete` helper) that resolves `resourceType → flat table` (the same mapping `flattenResource` uses) and issues `deleteFrom(table).where('id','=',id)` — engine-pluggable across PG/MSSQL/MySQL. Non-projected resource types → no-op.

## 4. `reprojectAll()` (rebuild + recovery)

Scans `fhir.fhir_resources` (all current rows), batches by resource type, `flatWriter.writeMany` into the external store, then sets `change_cursors['projection'] = (current max change_log seq)` so steady-state tailing resumes cleanly. Idempotent. Powers: fresh read-model rebuild, disaster recovery, and (optionally) a periodic self-heal. Exposed as a function now; a CLI/UI trigger is deferred to the S3-style ops slice.

## 5. `persist()` change + result semantics

- Remove the inline `flatWriter.writeMany(items)` block from `persistResource`/`persistResources` ([persist.ts:35-42, 63-71](packages/db/src/persist.ts)). `persist` now: validate → `fhirStore.save` (canonical + change_log, R1) → return.
- `PersistResult.flattened` gains value **`'deferred'`** (projection is async now); `PersistResult` shape otherwise unchanged. `PersistDeps` no longer needs `flatWriter` for the persist path.
- `persist-store-service` ([persist-store-service.ts](packages/bootstrap/src/persist-store-service.ts)) counts `flattened` — update it to report `deferred` (the `data.persisted` event payload's `flattened` becomes `{written:0, skipped:0, degraded:0, deferred:N}` or equivalent). Downstream workflow reactions that read `flattened` see projection is deferred.
- `db-context` ([db-context.ts](packages/bootstrap/src/db-context.ts)) still constructs `flatWriter` — but now hands it to the **worker**, not the inline persist path.

## 6. Worker lifecycle

- A `createProjectionWorker({ internalDb, flatWriter, fhirStore, logger, intervalMs })` returning `{ start(), stop() }`, mirroring the event-bus `startWorker` (interval `setInterval` + a `LISTEN 'fhir_changes'` client that triggers a tick; graceful `stop()` clears the timer and releases the listen client).
- **Always-on** (not feature-flag-gated): after R2 it is the *only* projection path, so gating it off would silently stall the read-model. A config knob (`PROJECTION_INTERVAL_MS`, and an escape hatch to disable for debugging) is allowed, default-on. Started in the same boot path as the other workers; stopped on shutdown.
- Single-worker assumption for v1 (one cursor consumer named `projection`). Multiple concurrent projection workers would need `SELECT … FOR UPDATE` on the cursor row — noted, not built.

## 7. Testing strategy

- **Unit (pg-mem / in-memory):**
  - `planProjection` pure logic: safe-frontier selection, first-unsafe cap, dedup by key, cursor advance (out-of-order commit deferred not skipped; rollback-gap tolerated; empty/full-batch).
  - Projection apply: canonical-present → flat upsert; canonical-absent → flat delete; non-projected type → no-op; idempotent re-apply.
  - `reprojectAll`: seeds read-model from canonical + sets cursor to max seq.
  - `persist` no longer flat-writes inline; returns `flattened: 'deferred'`; `persist-store-service` reports deferred.
- **Real-Postgres integration/acceptance** (two DBs, `:5433`, `mssql:accept`-style script, e.g. `pnpm projection:accept`):
  - the `xmin`/`pg_snapshot_xmin` fetch runs and returns the expected safe frontier;
  - end-to-end: persist N resources → worker projects them into external within a bounded wait; delete → read-model row removed; concurrent/out-of-order commit is eventually projected, never skipped;
  - `reprojectAll` rebuilds a wiped read-model.

## 8. Plan-time spikes (de-risk before writing the plan, mirroring R0/R1)

1. **Confirm pg-mem cannot run** `xmin` system column / `pg_snapshot_xmin(pg_current_snapshot())` (expected: fails) → validates the pure/PG split and the real-PG test requirement.
2. **Exact real-Postgres SQL + casts** for `xmin`/boundary comparison (`xmin::text::bigint`, `pg_snapshot_xmin(pg_current_snapshot())`), verified against dev PG `:5433`.
3. **`flatWriter` delete path** across engines (PG at minimum for R2; MSSQL/MySQL parity can follow) — resourceType→table mapping source.
4. **Acceptance harness bootstrap**: confirm the two-DB dev setup (internal + external Postgres) the accept script needs.

## 9. Open items (resolve at slice/plan time)

- `data.persisted` `flattened` payload exact shape with `deferred` — settle in the persist-service task.
- Periodic self-heal (scheduled `reprojectAll`) — optional; deferred unless wanted.
- xid wraparound hardening (`xid8` column) — deferred; negligible at scale.
- Projection failure handling: a poison resource that fails to project shouldn't stall the cursor forever — quarantine/skip-with-log policy (lean: log + advance, since `reprojectAll` can heal) — settle in the worker task.
- CLI/UI trigger for `reprojectAll` — deferred to an ops slice.
- MSSQL/MySQL projection-delete parity — R2 targets PG external first; other engines follow (they already work for writes).
