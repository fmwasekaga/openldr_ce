# Distributed Sync S7-A — Poison-Bulk Quarantine (design)

**Date:** 2026-07-15
**Status:** Approved (brainstorm) → ready for implementation plan
**Workstream:** distributed-sync. S1–S5 + S6a/S6c/S6b (co-edit set) all DONE + PUSHED (`origin/main` `b5c96fe7`). This is the **first S7 hardening sub-slice** — S7 is a bucket; this addresses the one item that is an active production hazard.
**Fixes:** the S3 known limitation — "a poison bulk record wedges the WHOLE pull stream: a reproducibly-failing `syncSystem`/`syncConceptMap` holds the single ordered `'sync-pull'` cursor forever, blocking ALL sync (config + terminology) behind it." S3 spec: `docs/superpowers/specs/2026-07-14-distributed-sync-s3-*` (see [[distributed-sync-central-workstream]]).

---

## 1. Summary

The lab-side pull runner (`createSyncPullRunner`, `packages/sync/src/pull-worker.ts`) drains one ordered `'sync-pull'` stream. Bulk terminology records (`terminology_system`/`concept_map`) are **hold records**: an apply failure does `held=true; break;`, capping the cursor at the last seq *before* the failed record so the whole bulk transfer retries next cycle (all-or-nothing). A record that fails **reproducibly** (poison) holds the cursor **forever** — every reference config + terminology change behind it in the stream silently stops syncing.

S7-A adds a **durable, per-entity failure counter**: after a bulk record fails `threshold` (3) consecutive times, the runner **quarantines** it (advances past + records it in a durable, operator-visible table) instead of holding indefinitely — so the stream flows again. Transient failures still hold-and-retry exactly as today. An operator can list quarantined items and manually retry one (a targeted re-sync by url).

## 2. Decisions (from brainstorm)

1. **Durable, operator-visible quarantine** — a `sync_quarantine` table (not an in-memory counter), plus a CLI/endpoint to list + retry. The wedge's real damage is *silent* staleness; visibility + a retry path is the point.
2. **Manual retry only** — a quarantined item is never auto-retried by the worker; an operator clears + re-syncs it. Quarantine means "stop auto-trying; surface for a human." (Auto-retry-with-backoff deferred.)
3. Single table tracks the whole lifecycle (`holding` → `quarantined`); durable counter survives restarts. Threshold = fixed **3** for v1 (no config knob yet). Counter keys on `(entity_type, entity_id)`; transport/token outages never count (they fail before any apply). Retry = targeted `syncSystem(url)`/`syncConceptMap(url)`, independent of the now-advanced cursor.

## 3. Mechanism — runner hold→quarantine decision (`@openldr/sync`)

Two **optional** injected hooks on `PullDeps` (optional = backward-compatible: absent → today's always-hold behavior, so existing tests/callers are unaffected):
- `holdFailure(rec, err): Promise<'hold' | 'quarantine'>` — durably increments the counter for `(rec.entityType, rec.entityId)`; returns `'hold'` while `attempts < threshold`, `'quarantine'` once it crosses.
- `holdSuccess(rec): Promise<void>` — clears the counter/row for that entity; called after a *successful* apply of a hold-record.

**Loop change** in `createSyncPullRunner`, on a hold-record apply failure (currently an unconditional hold):
```typescript
const decision = (await deps.holdFailure?.(rec, err as Error)) ?? 'hold';
if (decision === 'hold') { held = true; break; }              // < threshold → retry next cycle (unchanged)
deps.logger.error({ ...ctx }, 'sync pull: bulk apply repeatedly failed; quarantined, advancing past');
safeSeq = rec.seq;                                             // >= threshold → advance PAST it (stream flows)
```
And after a successful hold-record apply (`applied++; safeSeq = rec.seq;`): `if (isHold(rec)) await deps.holdSuccess?.(rec);`.

**Lifecycle** (per `(entity_type, entity_id)`):
- 1st/2nd failure → `holding` (attempts 1, 2), cursor held → transient failures retry as today.
- 3rd failure → `quarantined`; runner advances past → everything behind it in the stream syncs.
- Transport/token outage → outer `try/catch` returns before any apply; `holdFailure` never called → never quarantines on an outage.
- A re-served record for an already-quarantined entity (a new generation via the cursor) is attempted once: success → `holdSuccess` clears (auto-heals); failure → `holdFailure` returns `'quarantine'` again → advances past, **never re-holds** (a system with a failure history cannot re-wedge the stream).
- The counter persists durably until a successful apply clears it — a mid-progress restart doesn't reset it.

## 4. Durable store (`@openldr/db`)

**Migration `055_sync_quarantine`** (internal schema, lab-side, sibling of `fhir.change_cursors`; public schema like `reference_change_log`/`sync_amendments`):
```sql
create table sync_quarantine (
  entity_type     text not null,
  entity_id       text not null,       -- e.g. a terminology system url / concept map url
  attempts        integer not null default 0,
  status          text not null,       -- 'holding' | 'quarantined'
  last_error      text,
  last_seq        bigint,              -- seq of the record that last failed (operator context)
  first_failed_at timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  quarantined_at  timestamptz,         -- set when it crosses the threshold
  primary key (entity_type, entity_id)
);
```

**`SyncQuarantineTable` type** in `schema/internal.ts` + member in `InternalSchema`.

**`createSyncQuarantineStore(db)`:**
- `recordFailure(entityType, entityId, { seq, error, threshold }): Promise<{ attempts: number; status: 'holding' | 'quarantined' }>` — upsert: increment `attempts`, refresh `last_error`/`last_seq`/`updated_at`; if `attempts >= threshold` set `status='quarantined'` + `quarantined_at=now()` (only stamp `quarantined_at` on the first crossing), else `'holding'`. Returns the new attempts + status.
- `clear(entityType, entityId): Promise<void>` — delete the row.
- `list(): Promise<SyncQuarantineRow[]>` — all rows, newest-first (`updated_at desc`).
- `get(entityType, entityId): Promise<SyncQuarantineRow | undefined>`.

Barrel-export the store + row type from `@openldr/db`.

## 5. Bootstrap wiring (`@openldr/bootstrap`)

- Build `createSyncQuarantineStore(internal.db)` in the pull gate.
- Wire the runner hooks: `holdFailure: (rec, err) => quarantine.recordFailure(rec.entityType, rec.entityId, { seq: rec.seq, error: err.message, threshold: 3 }).then(r => r.status === 'quarantined' ? 'quarantine' : 'hold')`; `holdSuccess: (rec) => quarantine.clear(rec.entityType, rec.entityId)`. `QUARANTINE_THRESHOLD = 3` const.
- Extend `SyncHandle` (on `AppContext`, always present):
  - `listQuarantine()` → `quarantine.list()` (always available — just reads the table).
  - `retryQuarantine(entityType, entityId)` → `clear` the row, then dispatch to `termBulk.syncSystem(entityId)` / `syncConceptMap(entityId)` by `entityType`; on failure `recordFailure` again (re-quarantine) and surface the error. Errors with a typed "sync pull not enabled" when `termBulk` is absent (pull disabled). The `termBulk` instance (built in the pull gate) is passed into the handle via a retry closure.

## 6. Operator surface (`@openldr/server` + `@openldr/cli`)

- **HTTP** (under `/api/settings/sync/*`, `requireRole('lab_admin')`, user-authed):
  - `GET /api/settings/sync/quarantine` → `ctx.sync.listQuarantine()`.
  - `POST /api/settings/sync/quarantine/retry` (`{ entityType, entityId }`) → `ctx.sync.retryQuarantine(...)`; 200 with the outcome, 400 bad input, 409/503 when pull disabled. Audited `settings.sync.quarantine.retry` (entity ref only).
- **CLI** (`openldr sync quarantine …`):
  - `openldr sync quarantine list [--json]` — table of quarantined/holding entities (type, id, attempts, status, last error, updated).
  - `openldr sync quarantine retry <entityType> <entityId> [--json]` — clears + re-syncs; reports success/failure.

## 7. Testing

- **Unit (store):** `recordFailure` increments and flips `holding`→`quarantined` exactly at the threshold (and stamps `quarantined_at` once); `clear` deletes; `list` orders newest-first.
- **Unit (runner):** extend the pull-worker tests with pure fake hooks — a `holdFailure` returning `'hold'` twice then `'quarantine'`: assert the poison record holds the cursor (capped at the prior safe seq) for 2 cycles, then on the 3rd advances past it so a following record in the window is applied (cursor reaches `nextSeq`); `holdSuccess` is called after a successful hold-apply; a transport/token failure path never calls `holdFailure`; absent hooks → unchanged always-hold behavior (existing tests still pass).
- **In-process acceptance** — `scripts/sync-quarantine-live-acceptance.ts` + `pnpm sync:quarantine:accept` (one lab PG DB + an in-process fake central serve): serve a window `[poison terminology_system, a following reference config record]`; run the real pull runner wired to the real quarantine store with a `termBulk.syncSystem` that throws for the poison url; drive 3 cycles → assert the poison entity is `quarantined` in `sync_quarantine`, the cursor advanced past it, and **the following config record applied** (wedge broken); then `retryQuarantine` with a now-succeeding `syncSystem` → the system applies and the row clears.
- **Regression:** the 3 co-edit accept harnesses (`sync:amend`/`sync:order-status`/`sync:patient-merge`) + `sync:terminology:accept` (now exercising the wired hooks on the happy path) + the full per-package gate stay green.

## 8. Components

| Piece | Package / file |
|---|---|
| `sync_quarantine` table (mig 055) + `createSyncQuarantineStore` + row/table types | `@openldr/db` |
| `holdFailure`/`holdSuccess` optional hooks + quarantine loop logic | `@openldr/sync` `pull-worker.ts` |
| Wire hooks (threshold 3) + `listQuarantine`/`retryQuarantine` on `SyncHandle` | `@openldr/bootstrap` (`index.ts` + `sync-handle.ts`) |
| `GET /api/settings/sync/quarantine` + `POST .../quarantine/retry` (lab_admin) | `@openldr/server` `settings-routes.ts` |
| `openldr sync quarantine list\|retry` | `@openldr/cli` `sync.ts` + `index.ts` |
| In-process unwedge+heal acceptance | `scripts/sync-quarantine-live-acceptance.ts` + `package.json` |
| Docs | `docs/` (CLI/HTTP/operator) |

## 9. Build / process conventions

- Branch `feat/sync-s7-quarantine`; subagent-driven per task with two-stage review; merge `--no-ff` to local `main`.
- Gate per-package on Windows (`pnpm --filter <pkg> exec vitest run` / `tsc --noEmit`); never pipe turbo through `tail`.
- Ask before pushing to origin. **No `Co-Authored-By` trailer.**

## 10. Non-goals / deferred

- Config-knob for the threshold (fixed 3 in v1).
- Auto-retry-with-backoff of quarantined items (manual retry only).
- A studio quarantine UI (CLI + endpoint only).
- Quarantine for non-bulk (per-row) records — they already advance-past on failure (S2 quarantine semantics), so they never wedge; no change needed.
- The rest of the S7 backlog (gzip/LISTEN wakeup, log compaction, S5 bundle encryption + key rotation, observability metrics, same-version divergence detection, etc.) — each its own future sub-slice.
