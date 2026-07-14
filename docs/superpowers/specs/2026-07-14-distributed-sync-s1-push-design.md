# Distributed Sync — S1: Directional Push (lab → central)

**Date:** 2026-07-14
**Slice:** S1 (first buildable slice of the distributed-sync workstream) — "results flow up" MVP with real auth
**Branch:** `feat/sync-s1-push`
**Parent architecture:** `docs/superpowers/specs/2026-07-02-distributed-sync-architecture-design.md` (north-star, `6fc9bb75`)
**Substrate:** the FHIR storage restructure (R0–R3e) — `fhir.change_log` / `resource_history` / `change_cursors` + `site_id` stamping, all complete + pushed (`origin/main` `aee9939a`).

## Context & reframing

The 2026-07-02 architecture spec designed a dedicated `sync_changes` change-capture table (its §3 + S0
"Foundations" slice). The storage restructure **already built that substrate** as `fhir.change_log`
(monotonic `seq`, `resource_type`/`resource_id`/`version`/`op`/`content_hash`/**`site_id`**/`recorded_at`),
with `resource_history` holding full per-version content + tombstones and `change_cursors` holding
per-consumer high-water-marks. So sync becomes a **second consumer of `change_log`** alongside the
projection worker, and the old S0 collapses:

- **`site_id` stamping is DONE** — `fhir-store.ts` resolves `sync.site_id` (from `app_settings` or
  `OPENLDR_SITE_ID`), memoized, and stamps it on every `change_log` row in both `save()` and `delete()`.
- **The change-log read has a known skip-hazard** (the R2 safe-frontier problem) — sync must read
  through the same `fetchSafeChangeRows` the projection worker uses, with its own cursor, or it can
  skip in-flight-then-committed rows.

This slice is the first buildable one: **directional push, lab → central, all lab-owned operational
FHIR, with Keycloak client-credentials auth + per-site scoping.** It ends with a two-Postgres
integration proof of the round-trip.

## Goal

A lab instance continuously pushes its lab-owned operational FHIR (Patient, Specimen, ServiceRequest,
Observation, DiagnosticReport) up to a central instance, which mirrors each record **at its origin
version, stamped with the origin site-id**, idempotently and resumably, rejecting cross-site writes.
Central's own projection then reflects the mirrored data in central's canonical read model.

## Scope

**In:** the mirror-apply primitive; the `POST /api/sync/push` endpoint + client-credentials/site
scoping; lab-side sync config; the lab push worker (change_log→batch→POST→advance cursor); token
acquisition; a two-DB integration test.

**Out (later slices, unchanged from the architecture spec):** pull central→lab / reference data (S3);
Sync UI + full enrollment automation (admin registers lab, mints Keycloak client) + CLI (S4);
store-and-forward bundles (S5); co-edit / conflict policy (S6); hardening — tombstone compaction,
backpressure, apply-retry-on-missing-reference, metrics (S7). Users/roles stay lab-local.

## Design

### 1. Versioned-mirror-apply primitive (`packages/db/src/fhir-store.ts`)

`save()` derives the next version as `max(history)+1` — correct for a lab authoring locally, **wrong
for a mirror** (it would re-version the lab's record). Add a new method to `FhirStore`:

```ts
interface RemoteRecord {
  resourceType: string;
  id: string;
  version: number;          // the ORIGIN version (from the lab's change_log)
  op: 'upsert' | 'delete';
  siteId: string;           // the ORIGIN site-id (ownership stamp)
  resource?: FhirResource;  // present for op:'upsert' (the content at that version)
}
type ApplyResult = 'applied' | 'skipped';   // skipped = already present (idempotent)
applyRemote(record: RemoteRecord): Promise<ApplyResult>;
```

Behavior (one transaction, mirroring `save()`/`delete()`'s table set):
- **Idempotency:** `insert into fhir.resource_history (resource_type,id,version,op,resource) … on
  conflict (resource_type,id,version) do nothing`. If **no row inserted** (this version already
  applied) → return `'skipped'` and do nothing else (no `fhir_resources`/`change_log` write). This
  makes re-push and out-of-order re-delivery safe.
- **On a fresh insert:**
  - `op:'upsert'` → upsert `fhir.fhir_resources` to this record's `version`/content **only when the
    received `version` >= the stored version** (guards a late/out-of-order older version from
    clobbering a newer mirrored one); write `version_id = String(version)`, `resource = content`.
  - `op:'delete'` → delete the `fhir_resources` row (tombstone already in history).
  - Insert one `fhir.change_log` row `(resource_type, resource_id, version, op, content_hash,
    site_id = record.siteId)` — stamped with the **origin** site-id (not central's local site) — so
    central's projection mirrors it into central's read model. (Respect the load-bearing invariant:
    the `change_log` insert must not be the transaction's first write — the history/resources writes
    precede it, exactly as `save()` documents.)
- `content_hash` = sha256 of the resource content (reuse `save()`'s pre-stamp hashing helper, applied
  to the received content).

Note: `applyRemote` does **not** call `pg_notify` differently — a best-effort `pg_notify('fhir_changes')`
after the tx (as `save()` does) wakes central's projection worker.

### 2. `@openldr/sync` package (new) — shared sync core

- `batch.ts` — wire types:
  ```ts
  interface SyncRecord { resourceType: string; id: string; version: number; op: 'upsert' | 'delete'; siteId: string; resource?: FhirResource }
  interface PushBatch { fromSeq: number; records: (SyncRecord & { seq: number })[] }   // seq = change_log seq, for ack
  interface PushResponse { ackSeq: number; applied: number; skipped: number; rejects: { id: string; version: number; seq: number; reason: string }[] }
  ```
- `push-worker.ts` — the pure orchestration (deps injected: a change-log reader, a content fetcher, an
  http `postPush`, a token provider, a cursor store):
  - Read the next batch: `fetchSafeChangeRows(internalDb, cursor, limit)` → for each safe row, if
    `op:'upsert'` fetch content from `resource_history` at `(resource_type,id,version)` (fall back to
    `fhir_resources` for the current version); build `SyncRecord` (stamp `siteId` from the row).
    Compute the safe advance the same way the projection runner does (reuse `planProjection`'s
    frontier so gaps aren't skipped).
  - `postPush(batch)` with the bearer token; on `2xx`, advance the `sync-push` cursor to
    `response.ackSeq`. Per-record `rejects` are logged; a persistently-rejected (poison) record is
    quarantined (logged, cursor still advances past it so it never blocks the stream) — a minimal
    quarantine set for S1; richer handling in S7.
  - Backoff on network failure; no cursor advance on a failed POST (idempotent re-send next cycle).
- `token.ts` — client-credentials token acquisition against central's Keycloak
  (`grant_type=client_credentials` + `client_id`/`client_secret`), cached until `expires_in - 30s`
  (mirror `adapter-auth`'s `getAdminToken`). The token carries the `site_id` claim.

### 3. Central endpoint (`apps/server/src/sync-routes.ts`)

- **Auth bypass + client principal:** the user `onRequest` hook in `auth-plugin.ts` protects `/api/*`
  by syncing a *user* from the token — wrong for a machine client. Add `/api/sync/` to the hook's
  bypass list (like `/api/workflows/hooks/`), and have the sync route do its **own** auth in a
  `preHandler`: `ctx.auth.verifyToken(bearer)` → claims → extract `site_id` (a Keycloak client
  protocol-mapper claim); reject `401` if no token / invalid, `403` if no `site_id` claim. Result: a
  `sitePrincipal = { siteId }`.
- **`POST /api/sync/push`:** body = `PushBatch` (gzip-accepted). For each record: **reject if
  `record.siteId !== sitePrincipal.siteId`** (cross-site write — central never trusts a
  client-asserted owner); otherwise `fhirStore.applyRemote(record)` in `seq` order, tallying
  applied/skipped/rejects (a per-record apply error → reject, not a 500). Return `PushResponse` with
  `ackSeq` = the highest `seq` that was applied-or-skipped-or-safely-rejected (so the lab advances
  past handled rows). gzip the response.

### 4. Lab config (`app_settings`, secrets encrypted)

Keys (secrets via `SECRETS_ENCRYPTION_KEY`, like connector configs): `sync.enabled` (`'true'`/`'false'`),
`sync.central_url` (central `/api` base for the push endpoint), `sync.oidc_issuer` (central Keycloak
realm URL the lab authenticates against), `sync.client_id`, `sync.client_secret` (encrypted).
`sync.site_id` already exists (used by `fhir-store`). Minimal config surface — full enrollment
automation is S4.

### 5. Wiring (`packages/bootstrap`)

- A `createSyncPushWorker` host loop, modeled on `createProjectionWorker` (interval + optional
  on-demand trigger), started at boot **only when** `sync.enabled` is true and the config is present;
  a no-op otherwise. It injects the internal DB (change-log read), the fhir-store (content fetch), an
  http client (`postPush` to `sync.central_url`), and the token provider.
- Central's existing projection worker already consumes `change_log`, so mirrored writes flow into
  central's read model with no extra wiring.

## Auth model

- Each lab is a **Keycloak confidential client** in central's realm, with a **`site_id` protocol-mapper**
  putting the lab's site-id into the access token. The lab uses `client_credentials` to obtain the
  token; central `verifyToken`s it (issuer = central's realm) and reads `site_id`.
- **DEV/OPS SHORTCUT (flagged):** S1 does **not** automate enrollment — the Keycloak client + its
  `site_id` mapper are created **manually** by an admin (or via a documented `kcadm`/console step),
  and the lab's `sync.*` config is set by hand / env. Automated enrollment (`openldr sync enroll`
  mints the client) is deferred to S4.

## Cursor, idempotency, ordering

- **Cursor:** a `sync-push` consumer row in `fhir.change_cursors` (distinct from `projection`). The lab
  advances it to the endpoint's `ackSeq`.
- **Idempotency:** `applyRemote` is idempotent by `(resource_type, id, version)` (history-PK
  conflict → skip). Re-pushing from an earlier cursor is always safe.
- **Ordering:** push and apply in `change_log` `seq` order. `seq` is causal for the common case (a
  `Patient` save precedes an `Observation` referencing it, so its `seq` is lower), giving central a
  referentially-consistent mirror without extra machinery. Apply-and-retry-on-missing-reference is a
  documented S7 hardening item, not needed for S1.
- **Safe frontier:** the lab reads `change_log` via `fetchSafeChangeRows` + the `planProjection`
  frontier so an uncommitted-then-committed `seq` gap is never skipped — the same guarantee the
  projection worker has.

## Testing strategy

- **Unit:**
  - `applyRemote` (pg-mem where possible; real-PG for the tx/`on conflict` path): fresh apply writes
    history+resources+change_log at the origin version with the origin site_id; re-apply of the same
    version → `'skipped'`, no duplicate change_log; `op:'delete'` tombstones; an older out-of-order
    version doesn't clobber a newer `fhir_resources` row.
  - `push-worker` (fakes for reader/http/token/cursor): builds the batch from change_log rows, fetches
    content by version, advances the cursor to `ackSeq`, does NOT advance on POST failure, quarantines
    a persistently-rejected record.
  - endpoint auth/scoping (fake `verifyToken`): missing token → 401; no `site_id` claim → 403; a record
    with a foreign `site_id` → rejected in the response, not applied.
- **Integration (load-bearing, real PG):** a `pnpm sync:accept`-style harness with **two internal
  Postgres DBs** (lab + central). Seed lab: `save()` a Patient, Specimen, ServiceRequest, Observation,
  DiagnosticReport (all stamped with the lab's `sync.site_id`). Run the push worker once against a
  central `applyRemote`/endpoint (endpoint auth via the `adapter-auth` local-JWKS **stub token** seam —
  flagged dev shortcut). Assert: central has all 5 resources at the lab's versions with the lab's
  site_id in central's `change_log`; central's projection (run once) mirrors them into central's
  canonical read model; a second push is a no-op (all `'skipped'`); a batch with a foreign site_id is
  rejected. Model on the existing multi-DB acceptance harnesses.
- **Type + package gate:** `tsc --noEmit` on `@openldr/db`, `@openldr/sync`, `apps/server`,
  `@openldr/bootstrap`; `pnpm turbo run typecheck test --force` (ignore the known Windows
  parallel-turbo flakes; verify in isolation).

## Task breakdown (~9)

1. **`applyRemote` primitive** — add to `FhirStore` (`packages/db`); unit tests (fresh/idempotent/
   delete/out-of-order).
2. **`@openldr/sync` package scaffold + `batch.ts` wire types** + package wiring (tsconfig, deps).
3. **`push-worker.ts`** — pure orchestration (inject reader/content/http/token/cursor) reusing
   `fetchSafeChangeRows` + `planProjection` frontier; unit tests with fakes.
4. **`token.ts`** — client-credentials acquisition + cache; unit test.
5. **`sync-routes.ts` (central)** — `POST /api/sync/push` + `preHandler` client-auth/site-scoping;
   `/api/sync/` bypass in `auth-plugin.ts`; endpoint unit tests (auth/scoping/apply).
6. **Lab sync config** — `app_settings` keys + encrypted secret handling; a small typed config reader.
7. **Bootstrap wiring** — `createSyncPushWorker` host loop, gated by config; boot integration
   (no-op when disabled).
8. **Integration harness** — `scripts/sync-live-acceptance.ts` (two PG DBs, stub-token endpoint) +
   `pnpm sync:accept`; prove the round-trip on real PG.
9. **Whole-slice review, gate, merge & push** — cross-package gate; spec-conformance + quality review;
   merge `--no-ff` + push; update memory.

## Constraints & conventions

- Lab is always the client; central never dials out (NAT-friendly).
- `site_id` is always token-derived at central, never client-asserted; cross-site writes rejected.
- Idempotent everywhere; resumable by cursor.
- Enrollment automation + UI + pull + bundles + co-edit + hardening are explicitly out of S1.
- Next internal migration only if a new table is needed — none is (change_cursors already exists; the
  `sync-push` cursor is just a new consumer row).
- No `Co-Authored-By: Claude`/`Codex` trailers. Merge to local `main` (`--no-ff`); push when green.
