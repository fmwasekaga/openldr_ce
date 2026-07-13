# FHIR Storage Restructure — R1: Versioned Canonical + `change_log` Contract — Slice Design

**Date:** 2026-07-13
**Status:** Approved-pending-review (brainstorm). Slice **R1** of the restructure north-star (`docs/superpowers/specs/2026-07-13-fhir-internal-storage-restructure-design.md`). Builds on R0 (the `fhir` schema, merged `79b850b2`).
**Relates to:** `fhir-storage-restructure-workstream`, `distributed-sync-central-workstream` (sync consumes the `change_log` frozen here), `settings-general-feature-flags` (`site_id` config source).

## Scope

R1 makes the internal FHIR store **versioned** and emits the **append-only change-log** that is the frozen contract for every downstream consumer (R2 projection worker, later sync push). R1 does **not** build the projection worker, does **not** touch the external DB, and does **not** wire sync. It is pure internal-write-model foundation, unit-testable against pg-mem.

**In scope:** monotonic per-resource version; `fhir.resource_history`; `fhir.change_log` + `fhir.change_cursors`; `FhirStore.save` rewrite (transactional, versioned, emits history + change-log); **`FhirStore.delete` + tombstone** (built now); `content_hash` + `site_id` stamping.

**Out of scope (later slices):** async projection / pg_notify worker (R2); external v2 read-model (R3); sync consumption; exposing a FHIR REST `_history`/`vread` API.

## Locked decisions (brainstorm)

1. **versionId = monotonic integer per `(resource_type, id)`**, computed in a **transaction**: read the current version `FOR UPDATE`, `next = (current ?? 0) + 1`, then write. First write → `1`.
2. **Delete/tombstone is built now** — `FhirStore.delete(resourceType, id)` writes a tombstone and change-log `op='delete'` and removes the current row (`get` → null afterward). History retains the full trail including the tombstone.
3. **Per-resource transaction** in the batch path — each `save()` is its own atomic tx (canonical + history + change-log). One `change_log` row per resource. Preserves today's independent-canonical-save semantics (DP-7).

**Low-stakes defaults (approved):** `content_hash` = sha256 of the canonical serialized JSON; `site_id` resolved from `app_settings['sync.site_id']` → env `OPENLDR_SITE_ID` → `null`; monotonic version stored in a new **`version` bigint** column (the existing `version_id text` column is kept in sync as `String(version)` for FHIR `meta.versionId` continuity — avoids a fragile `ALTER COLUMN TYPE`); migration backfills existing rows to `version = 1`; **no** history/change-log backfill for pre-existing rows (that is R2's projection-backfill concern).

## Reconciliation with the north-star contract

R1 **finalizes** the change-log contract and refines two details of north-star §2/§3, which were directional. R1 is authoritative on these:
1. **Column name:** the monotonic integer is `version` (bigint) everywhere in the new tables — not `version_id`. This disambiguates it from the pre-existing `version_id text` column on `fhir_resources` (the FHIR `meta.versionId` string mirror).
2. **No type-promotion:** rather than promote `fhir_resources.version_id text` → bigint (a fragile `ALTER COLUMN TYPE` under pg-mem), R1 **adds** a `version bigint` column and keeps `version_id text` in sync as `String(version)`.

The north-star's §2/§3 have been updated to match.

## Schema (migration `046_fhir_versioning`, in the `fhir` schema)

**`fhir.fhir_resources`** — add one column (no type-alter of the existing PK/columns):
- `version bigint not null default 0` — the authoritative monotonic version. Migration backfills all existing rows to `1`. (`version_id text` stays, now mirrors `String(version)`.)

**`fhir.resource_history`** — append every version, incl. tombstones:
| column | type | notes |
| --- | --- | --- |
| `resource_type` | `text` not null | |
| `id` | `text` not null | |
| `version` | `bigint` not null | the version this row records |
| `op` | `text` not null | `upsert` \| `delete` |
| `resource` | `jsonb` | full serialized resource for `upsert`; `null` for `delete` |
| `recorded_at` | `timestamptz` not null default now() | |
| | PK `(resource_type, id, version)` | |

**`fhir.change_log`** — the frozen contract (north-star §2):
| column | type | notes |
| --- | --- | --- |
| `seq` | `bigserial` PK | monotonic per instance; the cursor axis |
| `resource_type` | `text` not null | |
| `resource_id` | `text` not null | |
| `version` | `bigint` not null | version recorded by this change |
| `op` | `text` not null | `upsert` \| `delete` |
| `content_hash` | `text` null | sha256 of canonical serialization (`null` for delete) |
| `site_id` | `text` null | originating site; nullable, from config |
| `recorded_at` | `timestamptz` not null default now() | wall-clock; tiebreak only, never authority |

**`fhir.change_cursors`** — created now to complete the contract (no consumer until R2):
| column | type | notes |
| --- | --- | --- |
| `consumer` | `text` PK | e.g. `projection`, later `sync:<peer>` |
| `last_seq` | `bigint` not null default 0 | high-water-mark |
| `updated_at` | `timestamptz` not null default now() | |

## `FhirStore.save` (rewritten — transactional)

Signature unchanged except the return type gains `version`. `SavedRef` becomes `{ resourceType, id, version }`.

Flow, all inside `db.transaction().execute(async (trx) => { … })`:
1. Resolve `id` (existing or `randomUUID()`), as today.
2. `SELECT version FROM fhir.fhir_resources WHERE resource_type = ? AND id = ? FOR UPDATE` → `current` (or none).
3. `next = (current ?? 0) + 1`.
4. Stamp the resource: `meta.versionId = String(next)`, `meta.lastUpdated = <now ISO>` (server-assigned). Serialize → `serialized`; `content_hash = sha256(serialized)`.
5. Upsert `fhir.fhir_resources` (PK `(resource_type, id)`): set `version = next`, `version_id = String(next)`, `resource = serialized`, provenance columns, `updated_at = now()` (existing upsert, plus the two version columns).
6. Insert `fhir.resource_history` `(resource_type, id, version = next, op = 'upsert', resource = serialized)`.
7. Insert `fhir.change_log` `(resource_type, resource_id = id, version = next, op = 'upsert', content_hash, site_id = <resolved>)`.
8. Return `{ resourceType, id, version: next }`.

`persistResource`/`persistResources` keep looping `save` per resource — each call opens its own transaction (decision 3). The existing flat-writer call in the persist path is **unchanged in R1** (it still runs inline; R2 removes it). So R1 adds capture without altering projection yet — the mirror and reports keep working exactly as before.

## `FhirStore.delete` (new — built now)

`delete(resourceType, id): Promise<{ deleted: boolean; version?: number }>`, inside a transaction:
1. `SELECT version FROM fhir.fhir_resources WHERE resource_type = ? AND id = ? FOR UPDATE`. If no row → return `{ deleted: false }` (idempotent; no tombstone for a never-existed resource).
2. `next = current + 1`.
3. Insert `fhir.resource_history` `(resource_type, id, version = next, op = 'delete', resource = null)`.
4. Insert `fhir.change_log` `(resource_type, resource_id = id, version = next, op = 'delete', content_hash = null, site_id = <resolved>)`.
5. `DELETE FROM fhir.fhir_resources WHERE resource_type = ? AND id = ?`.
6. Return `{ deleted: true, version: next }`. Subsequent `get` → `null`; `resource_history` retains all versions incl. the tombstone.

## Helpers

- `resolveSiteId(deps)`: read `app_settings['sync.site_id']`; else `process.env.OPENLDR_SITE_ID`; else `null`. Memoize per store instance (config is stable within a process run).
- `contentHash(serialized: string)`: `createHash('sha256').update(serialized).digest('hex')` (node:crypto).

## Interface / consumer impact

- `SavedRef` gains `version: number`. Call sites that ignore the return (most of the persist path) are unaffected; `persist.ts` maps results as today.
- `FhirStore` interface gains `delete`. `createFhirStore(db)` gains a `site_id` resolution dependency — pass the same `Kysely<InternalSchema>` (it reads `app_settings`), so no new constructor args beyond what's already there.
- No external-schema, server-route, or projection changes in R1.

## Testing strategy (pg-mem unit tests)

- **Versioning:** first `save` → version 1; re-save same id → 2, 3…; `meta.versionId` mirrors; `version_id` text mirrors `String(version)`.
- **History:** each `save` appends one `upsert` history row at the right version; full resource stored.
- **change_log:** exactly one row per `save` with correct `(resource_type, resource_id, version, op='upsert', content_hash present, site_id)`; `seq` strictly increases.
- **Delete:** `delete` on an existing id → tombstone history row (`op='delete'`, `resource null`), change_log `op='delete'` (`content_hash null`), `get` → null, version incremented; `delete` on a missing id → `{ deleted: false }`, no history/change_log row.
- **Per-resource tx:** `persistResources` of N resources → N change_log rows, versions correct; a mid-batch invalid resource still throws per current semantics without corrupting prior rows' logs.
- **site_id:** resolves from `app_settings`, then env, then null (three cases).
- **content_hash:** stable for identical serialization; differs when the resource changes.

## Plan-time spikes (de-risk before writing the plan, mirroring R0)

pg-mem support must be verified for these primitives; if unsupported, the plan adapts (as R0's `SET SCHEMA` fallback did):
1. `bigserial` / auto-increment identity for `change_log.seq`.
2. `SELECT … FOR UPDATE` parse/execute (tests are single-connection, so correctness is moot, but the SQL must parse — if pg-mem rejects it, gate the `FOR UPDATE` for the real-PG path or read-without-lock in the emulated path).
3. `ALTER TABLE … ADD COLUMN version bigint not null default 0` + backfill `UPDATE`.
4. `node:crypto` `createHash` under the test runtime (expected fine).

## Open items (resolve at slice/plan time)

- Whether `resolveSiteId` should also be exposed as a setting in the Settings UI — deferred to the S3 sync UI slice; R1 only reads it.
- `change_cursors` is created but unused until R2 — acceptable (freezes the contract surface).
- History retention/compaction — a hardening concern shared with sync S6; not R1.
