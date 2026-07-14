# Distributed Sync — S2: Directional Pull (central → lab) reference data

**Date:** 2026-07-14
**Slice:** S2 (second buildable slice of the distributed-sync workstream) — "config flows down"
**Branch:** `feat/sync-s2-pull` (to cut)
**Parent architecture:** `docs/superpowers/specs/2026-07-02-distributed-sync-architecture-design.md` (north-star, `6fc9bb75`)
**Predecessor:** S1 directional push (lab → central), merged + pushed (`origin/main` `c5131a31`) — `docs/superpowers/specs/2026-07-14-distributed-sync-s1-push-design.md`

## Context & reframing

S1 made sync a second consumer of `fhir.change_log` — the substrate the FHIR storage restructure already
built for lab-owned operational FHIR. **Reference data is different: none of it lives in `fhir.change_log`.**
An inventory of the four center-owned config domains confirms each writes straight through its Kysely store
with only a mutable `updated_at` — no monotonic sequence, no per-row version, no content hash, no tombstones:

| Domain | Store | Table(s) | Existing ordering |
| --- | --- | --- | --- |
| Forms | `packages/forms/src/store.ts` | `form_definitions` (mutable working copy) + `form_versions` (immutable per-form snapshots) | per-form integer `version`; `updated_at` |
| Dashboards | `packages/dashboards/src/store.ts` | `dashboards` | `updated_at` |
| Reports | `packages/db/src/report-store.ts` | `reports` (+ `report_designs`) | `updated_at` |
| Settings | `packages/db/src/app-settings-store.ts` | `app_settings` (key/value) | `updated_at` |

The 2026-07-02 architecture spec (§3) anticipated a dedicated append-only `sync_changes` log written from
"the forms/terminology/dashboard store writes for center-owned reference data" — that table was never built
(S1 reused `fhir.change_log` for FHIR only). S2 builds it, scoped to reference data, as
**`reference_change_log`**. The architecture spec left reference-data granularity "decide at S2" (§10); this
spec decides **whole-object** granularity.

## Scope (decided)

- **In:** the four small, center-authored config domains — **forms, dashboards, reports, and an allowlisted
  subset of settings (feature flags).**
- **Out (deferred to S3):** **terminology** (LOINC/SNOMED/RxNorm concepts + mappings) — large, user-provided
  (not center-authored), and stored awkwardly (`concept_map_elements` has no PK/timestamps, delete-then-
  reinsert). It will ride the same `reference_change_log` substrate in its own slice with bulk/batched transfer.
- Users/roles stay lab-local (as in v1). Pull is **not site-scoped**: every enrolled lab pulls the same global
  reference data; the client-credentials token authenticates the lab but does not filter the stream.

## Goal

A central instance authors reference config (forms, dashboards, reports, feature-flag settings). Each enrolled
lab continuously pulls those changes down and mirrors them locally — adds, edits, and deletes — **without ever
touching the lab's own locally-authored config** — proven by a two-Postgres round-trip.

## Design

### 1. Central capture — `reference_change_log` + capture helper

**Table** (public/default schema; reference data is not FHIR, so not the `fhir` schema):

```
reference_change_log(
  seq          bigserial primary key,       -- monotonic per instance
  entity_type  text not null,               -- 'form' | 'dashboard' | 'report' | 'setting'
  entity_id    text not null,               -- form_definitions.id / dashboards.id / reports.id / app_settings.key
  op           text not null,               -- 'upsert' | 'delete'
  content_hash text,                         -- canonicalJson hash of the entity body; null for delete
  recorded_at  timestamptz not null default now()
)
```

Same shape family as `fhir.change_log`, minus `site_id` (reference data is global, not site-owned) and
`version` (whole-object, no per-row version needed; the log's `seq` provides ordering).

**Capture helper** `recordReferenceChange(trx, entityType, entityId, op, contentHash)`:

- Called by the four config stores **inside their existing write transactions** (create / update / delete /
  publish) and by the **seed paths** (`seedDefaultDashboard`, `seedDataDrivenReports`, forms/report-designs
  seeds) — the places center authors reference data.
- **Emits a log row only when `content_hash` changed** from the most recent log row for that `(entity_type,
  entity_id)`. For `op='upsert'` the hash is the `canonicalJson` hash of the entity body (the same key-sorted
  canonicalization that already backs seed idempotence, so a re-seed with unchanged content emits nothing and
  does not spam the log). For `op='delete'` a tombstone row is always appended (hash null) unless the latest
  row is already a delete.
- **Content-hash source:** reuse `packages/dashboards/src/seed.ts` `canonicalJson`; promote it to a shared
  helper (e.g. `@openldr/core` or a small `sync` util) so all four stores + the capture helper compute the
  same hash. This is the one piece of existing code S2 lifts out of dashboards-seed into shared use.

**Settings allowlist:** only an explicit constant set of center-owned `app_settings` keys is captured — the
feature flags (e.g. `dashboard.raw_sql`). `sync.*` (lab enrollment/secret) and any other lab-local key are
**never** logged and never pulled. The allowlist lives next to the capture wiring; `app_settings.set` consults
it before calling `recordReferenceChange`.

**Capture is suppressed on the lab apply path.** `applyReferenceChange` (§4) writes the store WITHOUT calling
`recordReferenceChange` — labs mirror, they do not re-originate. (Mechanically: apply uses a store method /
flag that skips capture, mirroring how S1's `applyRemote` is distinct from `save()`.)

### 2. Transport — `POST /api/sync/pull`

- Reuses the S1 `/api/sync/` auth bypass in `auth-plugin.ts` and the client-credentials `sitePrincipal`
  (`verifyToken` → require a token; the `site_id` claim authenticates the lab but does **not** scope the
  response — pull is global).
- **Request:** `{ fromSeq: number }`.
- **Response:** `{ records: [{ seq, entityType, entityId, op, body? }], nextSeq: number }` where `body` is the
  **current** store row for `op='upsert'` (fetched live from the config store at request time; a rapid update
  sequence collapses to the latest body, which is what a mirror wants) and is **absent** for `op='delete'`.
- Server reads `reference_change_log` where `seq > fromSeq` ordered by `seq`, bounded to a batch size, dedups
  to the latest change per `(entity_type, entity_id)` within the batch window (optional optimization; correct
  either way because apply is idempotent), joins upserts to their live store body, and returns `nextSeq` = the
  max `seq` served. The lab loops until `records` is empty.
- Because `reference_change_log.seq` is a plain append-only bigserial written under short store transactions
  (not the multi-statement FHIR persist path), it does **not** have `fhir.change_log`'s in-flight-gap
  skip-hazard at the scale of config writes; a simple `seq > cursor` read is sufficient. (If concurrent
  authoring ever makes gaps observable, the same `fetchSafeChangeRows` frontier can be adopted later — noted,
  not built.)
- Gzip deferred to S7 (as in S1); plain JSON.

### 3. Lab apply — `applyReferenceChange` + origin marker

**Origin marker migration** (additive): add a nullable `managed_origin text` column to `form_definitions`,
`dashboards`, and `reports`. `null` = lab-authored (never touched by pull); `'central'` = center-managed
(reconciled by pull). Settings need no column — the allowlist already delimits center-owned keys, and a
center-owned key on a lab is by definition centrally managed.

**`applyReferenceChange(record)`** — a dispatcher routing by `entityType` to the target store:

- `op='upsert'`: upsert the body into the store, **stamping `managed_origin='central'`** (for settings: `set`
  the key). Idempotent — if the local row already matches the record's `content_hash`, it's a no-op `'skipped'`.
- `op='delete'`: `DELETE ... WHERE id = entity_id AND managed_origin = 'central'` (for settings: delete the key
  only if it's in the allowlist). A lab-local (`managed_origin IS NULL`) row with the same id is **never**
  removed.
- Returns `'applied' | 'skipped'`. Never re-originates (no `recordReferenceChange`).
- Forms nuance: pull mirrors the **published form** the lab consumes. S2 applies to `form_definitions` (the
  active/consumed copy) stamped `managed_origin='central'`; central sends the current published form body.
  (Per-version `form_versions` history replication is not needed for a read-only mirror and is out of scope.)

### 4. Lab pull worker — `createSyncPullWorker`

- Bootstrap host loop, **config-gated by the same `sync.enabled`** as the S1 push worker (pull needs only
  `central_url` + client-cred auth, both already in `readSyncConfig`'s output — no new `sync.*` keys). When
  sync is enabled, both the push worker and the pull worker run.
- Reads a **`'sync-pull'` cursor** (last central `reference_change_log.seq` applied) — a distinct consumer from
  the push worker's `'sync-push'` and the projection's `'projection'`. Cursor storage mirrors the existing
  cursor helper pattern (a `(consumer, last_seq)` row); the exact table is a plan-time detail (reuse
  `change_cursors` with a new consumer key, or a small dedicated `sync_cursors` table — decide in the plan).
- Cycle: read cursor → `POST {central_url}/api/sync/pull {fromSeq: cursor}` with a bearer token from the S1
  `createSyncTokenProvider` → `applyReferenceChange` per record in `seq` order → advance cursor to `nextSeq`.
  On HTTP failure: do not advance, retry next cycle (mirrors push). On a per-record apply error: log + skip
  (quarantine) so one bad record can't wedge the stream, and still advance past it.
- Host-loop structure mirrors `createSyncPushWorker`: fixed interval (reuse the 5000 ms default), no-overlap
  guard, keep-looping-on-error, clean `stop()` on shutdown, config-gated no-op when disabled.

### 5. Bootstrap wiring

Alongside the S1 push worker construction in `packages/bootstrap/src/index.ts`: when `readSyncConfig` returns
non-null, also build the pull deps (token provider is shared with push; `postPull` = a POST to
`{central_url}/api/sync/pull`; `applyReferenceChange` bound to the local config stores; `'sync-pull'` cursor
read/write) and start `createSyncPullWorker`. Disabled/unconfigured → neither worker starts.

## Testing

- **Unit:** `recordReferenceChange` (emits only on content-hash change; tombstone on delete; allowlist gates
  settings); `applyReferenceChange` (upsert stamps central + idempotent skip; delete removes central-managed
  only, never lab-local; dispatch per entity type); `reference_change_log` read/dedup/nextSeq; the pull
  endpoint (auth 401/403; batch shape; live-body join; delete carries no body); the pull worker (advances on
  success, not on failure; quarantines a bad record); the pull cursor.
- **Integration — `pnpm sync:pull:accept`** (two internal Postgres DBs on :5433, mirroring
  `scripts/sync-live-acceptance.ts`): central authors a form, a dashboard, a report, and a feature-flag setting
  → each emits a `reference_change_log` row. A lab holds one **lab-local** form (`managed_origin` null). Drain
  pull into the lab and assert:
  1. all four central entities mirrored locally, stamped `managed_origin='central'`;
  2. the lab-local form is **untouched**;
  3. a central **edit** to the dashboard propagates on the next drain (content_hash changed);
  4. a central **delete** of the report removes the central-managed row but a same-shaped lab-local row would
     survive (assert the delete's `managed_origin='central'` guard);
  5. a re-seed on central with unchanged content emits **no** new log row (no spurious pull);
  6. a second drain with no central changes is a no-op (cursor unchanged, 0 applied).

## Deliberate shortcuts (S2)

- Integration harness uses an in-process `postPull` (auth/HTTP unit-proven in the endpoint tests), as S1 did —
  proves the data round-trip, not the JSON/JWKS hop.
- No gzip, no LISTEN-wakeup (fixed 5000 ms interval) — S7.
- `form_versions` history is not replicated (read-only mirror needs only the active form) — future if labs ever
  need central form history.
- Enrollment automation + the operator UI/CLI to enable sync, and the `sync.config`-blob vs `sync.*`-keys
  config-surface reconciliation, remain in **S4** (both push and pull are configured via the discrete `sync.*`
  keys directly in S2, as the acceptance harness does).

## Build order (implementation plan will detail)

1. `canonicalJson` → shared content-hash helper.
2. `reference_change_log` table + `recordReferenceChange` capture helper (+ settings allowlist).
3. Instrument the four config store write paths + seed paths to capture (central authoring).
4. `managed_origin` migration + `applyReferenceChange` dispatcher (lab apply, capture-suppressed).
5. `POST /api/sync/pull` endpoint (+ reuse `/api/sync/` bypass).
6. `'sync-pull'` cursor + `createSyncPullWorker` + bootstrap wiring (config-gated).
7. Two-PG `pnpm sync:pull:accept` proof.
8. Gate, whole-slice review, merge, (push on user go).

## Relates to

[[distributed-sync-central-workstream]] (parent), S1 push (predecessor; reuses its `@openldr/sync` package,
`sitePrincipal`, token provider, `/api/sync/` bypass, worker-loop shape), the FHIR storage restructure
(the `change_log`/cursor pattern this mirrors for reference data), the dashboards/reporting seed idempotence
(`canonicalJson` content-hash, now shared).
