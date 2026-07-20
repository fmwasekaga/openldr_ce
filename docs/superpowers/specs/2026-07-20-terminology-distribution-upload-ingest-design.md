# Terminology distribution upload + unified ingest — design

- **Date:** 2026-07-20
- **Status:** approved (brainstorm) → ready for implementation plan
- **Scope:** Replace the server-filesystem-path terminology import/ontology-build with a browser
  **upload** to the blob store, ingested **once** into **both** the flat term table **and** the ontology
  tree, as a **background job**, for **LOINC, SNOMED CT, and RxNorm**.

## 1. Motivation

Two operator-facing problems with the current terminology loading flow:

1. **Server-path imports fail in production.** "Import LOINC distribution" and "Ontology distribution…"
   both take an already-extracted **server-side filesystem path** (e.g. `D:\…\corlix\fixtures\Loinc\2.82`).
   In a Docker/production deployment the files live on the operator's laptop, not inside the container,
   so the server cannot see them. A live demo failed on exactly this.
2. **The same distribution is pointed at twice.** The flat *term import* (fills `terminology_concepts`)
   and the *ontology build* (fills the hierarchical browse tree) are two separate actions that each take
   the same folder. Loading a system fully means doing it twice.

**Goal:** upload a distribution **.zip** from the browser once; the app stores it, then ingests it into
both the flat terms and the ontology in a single background job, with a completion notification. Same
experience for LOINC, SNOMED CT, and RxNorm. Keep the license-acceptance gate.

## 2. Goals / Non-goals

**Goals**
- Browser upload of a distribution `.zip` (target size ≈ **500 MB**, SNOMED International being the driver).
- One ingest per upload producing **both** flat `terminology_concepts` **and** the ontology tree.
- LOINC, SNOMED CT, RxNorm — including **new flat-term extraction** for SNOMED/RxNorm (today they have
  an ontology tree but no searchable/mappable flat terms).
- Background processing with live per-system status and a completion/failure **notification** via the
  existing bell (derived read-model over `audit_events`).
- Uploaded zip **retained** in the blob store (rebuild/re-import without re-upload), with an explicit
  **purge** action to reclaim space.
- **Provider-agnostic** storage: works on MinIO or any S3-compatible bucket via `S3_ENDPOINT`/`S3_BUCKET`
  config, zero code change to switch.
- **CLI parity** (`openldr terminology import …`) per [[cli-operator-parity]].

**Non-goals**
- Direct browser→S3 presigned upload (keeps MinIO/S3 internal; transport is API-proxied — see §5).
- Destructive pruning of concepts removed from a newer release (retired codes linger; matches today's
  loader behaviour).
- Auto-detecting the system type from zip contents (the action is launched from a specific publisher's
  menu, so the type is known).
- Changing the sync/reference-change-log semantics of terminology (loaders already call
  `markSystemChanged`; unchanged here).

## 3. Current architecture (what we build on)

- **Blob port:** `packages/ports/src/blob.ts` — `BlobStoragePort { healthCheck, put(key, Uint8Array|string),
  get(key) → Uint8Array, exists, presign }`. `put`/`get` **buffer the whole object in memory** — unsafe at
  500 MB.
- **S3 adapter:** `packages/adapter-s3-bucket/src/index.ts` — `@aws-sdk/client-s3` (`PutObjectCommand`,
  `getSignedUrl`), driven by `endpoint`/`bucket` from `S3_ENDPOINT`/`S3_BUCKET`.
- **Flat term loaders:** `packages/terminology/src/loaders/{loinc,whonet,generic}.ts` — `loadLoinc(dir,
  {acceptLicense}, loaderStore)` reads `Loinc.csv` and upserts concepts. **No SNOMED/RxNorm loaders.**
- **Ontology adapters:** `packages/terminology/src/ontology/adapters/{loinc,snomed,rxnorm}.ts` —
  `buildIndex(dist, writer, onProgress)`; already parse every concept's **code + display**
  (LOINC accessory files + `Loinc.csv`; SNOMED `sct2_Description_Snapshot` / `sct2_Relationship_Snapshot`;
  RxNorm `rrf/RXNCONSO.RRF` / `rrf/RXNREL.RRF`). **Large files are read with `readFileSync`.**
- **Ontology build entry:** `packages/terminology/src/ontology/build.ts` —
  `buildOntologyDistribution(systemId, sourcePath, ontologyStore, onProgress)`.
- **Terminology context:** `packages/bootstrap/src/terminology-context.ts` — wires `loaders`,
  `createOntologyApi`, and `loaderStore { upsertConcepts, upsertMapElements, markSystemChanged,
  saveResource, saveSystem }`.
- **Routes:** `apps/server/src/terminology-admin-routes.ts` (`POST /api/terminology/import/loinc`, gated by
  `MANAGE = requireRole('lab_admin','lab_manager')`); `apps/server/src/ontology-routes.ts` (SSE
  build/rebuild, `MANAGE`).
- **Notifications:** derived read-model `packages/bootstrap/src/notifications.ts` over `audit_events` +
  `sync_activity` (types `sync_failed`, `auth_failed`, `sync_quarantined`); table
  `packages/db/src/migrations/internal/060_notifications.ts`; `apps/server/src/notification-routes.ts`;
  `apps/studio/src/shell/notifications-store.ts`.
- **Worker pattern:** `packages/bootstrap/src/projection-worker.ts` — an interval loop we mirror.
- **Studio:** `apps/studio/src/pages/Terminology.tsx` (publishers list, ⋯ menu, Import-LOINC dialog);
  `apps/studio/src/terminology/ontology/OntologyDistributionDialog.tsx`; `apps/studio/src/api.ts`.
- **CLI:** `packages/cli/src/terminology.ts`.

## 4. End-to-end flow

```
Browser                 API (server)                Blob store (S3/MinIO)     Ingest worker
  │  pick .zip + license                                    │                      │
  │  ── stream upload ─▶  POST …/distribution               │                      │
  │                      putStream(key) ───────────────────▶│  (multipart)         │
  │                      insert terminology_ingest_jobs      │                      │
  │  ◀── { jobId } ──────  status=queued                     │                      │
  │                                                          │   claim queued ◀─────┤ (interval)
  │  poll job status                                         │   getStream(key) ───▶│
  │  (publisher shows %)                                     │   → temp dir, unzip  │
  │                                                          │   ingestDistribution │
  │                                                          │     → concepts sink  │
  │                                                          │     → ontology sink  │
  │                                                          │   status=ready/failed│
  │                                                          │   audit_events row ──┤
  │  ◀── bell notification (derived from audit_events)                              │
```

## 5. Storage layer — streaming blob I/O (provider-agnostic)

Extend `BlobStoragePort` and the S3 adapter with streaming variants; **do not** route 500 MB through the
buffered `put`/`get`.

```ts
// packages/ports/src/blob.ts  (added to BlobStoragePort)
putStream(key: string, body: Readable, contentType?: string): Promise<void>;
getStream(key: string): Promise<Readable>;
delete(key: string): Promise<void>;   // for purge
```

- `putStream` → `@aws-sdk/lib-storage` `Upload` (automatic multipart, memory-bounded, resumes parts
  internally). Works against any S3-compatible endpoint.
- `getStream` → `GetObjectCommand`; return the response body as a Node `Readable`.
- `delete` → `DeleteObjectCommand`.
- Add `@aws-sdk/lib-storage` to `packages/adapter-s3-bucket`.
- **Provider independence:** all ingest code depends only on `BlobStoragePort`; switching MinIO → AWS S3 →
  any S3-compatible backend is a `.env` change (`S3_ENDPOINT`/`S3_BUCKET`/creds), no code change.

**Blob key layout:** `terminology-dist/<systemType>/<version-or-uploadId>.zip`
(e.g. `terminology-dist/loinc/2.82.zip`). Exactly **one retained object per system**: a successful new
upload **supersedes** the prior one — the previous key is deleted on success (§7b step 4), so a
version-named key does not accumulate old releases.

## 6. Ingest job model

New table `terminology_ingest_jobs` (`packages/db/src/migrations/internal/0XX_terminology_ingest_jobs.ts`):

| column            | type      | notes                                                        |
|-------------------|-----------|--------------------------------------------------------------|
| id                | text PK   | `tij_<uuid8>`                                                |
| system_type       | text      | `loinc` \| `snomed` \| `rxnorm`                              |
| coding_system_id  | text      | FK-ish to the coding system / publisher context             |
| blob_key          | text      | retained zip key                                             |
| version           | text null | detected or operator-supplied release label                 |
| status            | text      | `queued` \| `running` \| `ready` \| `failed`                |
| phase             | text null | current phase label (e.g. `concepts`, `ontology:tree`)      |
| processed         | bigint    | rows processed so far (progress)                             |
| total             | bigint null | best-effort total for a %                                  |
| error             | text null | redacted failure message                                    |
| created_by        | text null | actor id                                                    |
| created_at        | timestamptz | default now()                                             |
| started_at        | timestamptz null |                                                       |
| finished_at       | timestamptz null |                                                       |

- **One in-flight job per system:** partial unique index on `system_type` where `status in
  ('queued','running')`; enqueue returns `409` if one is already active for that system.
- A `terminology_ingest_job_store` in `@openldr/db` exposes `enqueue`, `claimNext` (atomic
  `UPDATE … SET status='running', started_at=now() WHERE id = (SELECT id … WHERE status='queued' ORDER BY
  created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`), `updateProgress`, `finish(status, error)`,
  `get`, `listByStatus`, and `latestForSystem`.

## 7. Ingest core + worker

### 7a. Shared ingest core (pure, sink-driven)
`packages/terminology/src/ingest/ingest-distribution.ts`:

```ts
ingestDistribution(input: {
  systemType: 'loinc' | 'snomed' | 'rxnorm';
  distDir: string;                  // extracted distribution root
  sinks: { concepts: ConceptSink; ontology: OntologyWriter };
  onProgress(p: { phase: string; processed: number; total: number | null }): void;
}): Promise<{ conceptCount: number; nodeCount: number; edgeCount: number; version: string | null }>
```

- **One pass, two sinks.** For each system, a single walk over the distribution's files tees rows into
  the **concept sink** and the **ontology writer**. The concept sink is the existing
  `loaderStore.upsertConcepts` (from `terminology-context.ts`); the ontology writer is the existing
  `IndexWriter` the adapters already write to. "Upload once, do everything" = one job, one extraction,
  both outputs — no second action, no re-upload.
- **LOINC:** reuse the rich `Loinc.csv` read (all attributes) for the concept sink; reuse the existing
  accessory-file reads for the ontology sink.
- **SNOMED / RxNorm (new flat terms):** tee the concept displays the ontology adapters already read
  (`sct2_Description_Snapshot`; `RXNCONSO.RRF`) into the concept sink. Capture a small set of
  mapping-useful attributes: SNOMED semantic tag + FSN/preferred term; RxNorm TTY (term type) + SAB.
- **Harden large-file reads:** replace `readFileSync` on the big files (SNOMED Description/Relationship,
  RxNorm RRF) with **streaming line reads** (`readline` over a read stream) so multi-hundred-MB files
  don't OOM the worker. (Existing `readFileSync` is fine for LOINC accessory files.)

### 7b. Worker
`packages/bootstrap/src/terminology-ingest-worker.ts` (mirrors `projection-worker.ts`):

1. Interval poll → `claimNext()`; if none, sleep.
2. `getStream(blob_key)` → write to a temp zip in a **configurable working dir** (`TERMINOLOGY_WORK_DIR`,
   default OS temp) → **unzip** to a temp dir. Note: SNOMED uncompresses to multiple GB — the working dir
   needs ephemeral disk headroom (documented; see §12). *(Future optimization: stream individual zip
   entries instead of full extraction — out of scope for v1.)*
3. Call `ingestDistribution(...)`, wiring `onProgress` → `updateProgress` (throttled).
4. On success: `finish('ready')`, write an `audit_events` row `terminology.import.completed`
   (metadata: system, version, counts); delete any *previous* retained blob for the system.
5. On failure: `finish('failed', redact(err))`, temp dir cleaned in `finally`, write
   `terminology.import.failed`; the retained blob stays for retry.
6. Single worker instance (like the projection worker); `claimNext` is race-safe regardless.

## 8. API surface (`apps/server/src/terminology-admin-routes.ts`, `MANAGE`-gated + audited)

- `POST /api/terminology/systems/:id/distribution` — **streaming upload + enqueue** (one call):
  - `@fastify/multipart` (streaming) — file part piped **directly to `blob.putStream`** (never buffered);
    fields `acceptLicense` (must be `true`, enforced server-side — mirrors today's LOINC license gate) and
    optional `version`.
  - Route-level `bodyLimit` raised (~1 GB) for this route only; global default unchanged.
  - Rejects `409` if a job for that system is already active.
  - Inserts the job (`queued`), returns `{ jobId }`.
- `GET /api/terminology/systems/:id/distribution/job` — latest job status for polling
  (`status`, `phase`, `processed`, `total`, `error`, `version`, `finishedAt`).
- `DELETE /api/terminology/systems/:id/distribution` — **purge**: delete the retained blob (and mark the
  latest job's blob as purged). Audited `terminology.distribution.purged`.
- The legacy `POST /api/terminology/import/loinc` (server-path) is **removed** once the upload path lands
  (or kept behind a dev-only flag — decide in the plan; default: remove).
- Gateway: `nginx` `client_max_body_size` raised on the API location to allow the upload (see §12).

## 9. Studio UX (`apps/studio/src/pages/Terminology.tsx` + a new dialog)

- The publisher ⋯ menu item generalises from **"Import LOINC distribution…"** to
  **"Import distribution…"** on each external publisher that supports it (LOINC / SNOMED CT / RxNorm),
  driven by the publisher's `systemType`.
- **New `ImportDistributionDialog`** (replaces the server-path field): a **file picker (`.zip`)**, an
  optional version field, and the **license checkbox**; primary button uploads with a determinate
  progress bar (browser `fetch`/XHR upload progress).
- After upload, the publisher row shows **live job status** (badge: *importing 45% · concepts → ontology*,
  then *ready* / *failed*) via polling the job endpoint.
- The `OntologyDistributionDialog` server-path flow is retired for these systems (ontology is built by the
  same job); "Rebuild" re-runs the ingest from the **retained blob** (no re-upload). A **"Delete stored
  distribution"** item appears when a blob is retained.
- `apps/studio/src/api.ts`: add `uploadTerminologyDistribution`, `getIngestJob`, `purgeDistribution`.

## 10. Notifications + audit

- The worker writes `audit_events` rows on completion/failure. Extend the notification derivation
  (`packages/bootstrap/src/notifications.ts`) to surface `terminology.import.completed` /
  `terminology.import.failed` as new notification types (e.g. `terminology_import_done` /
  `terminology_import_failed`), reusing the existing bell/store/prefs — no new notification machinery.
- Title/body resolved client-side (i18n en/fr/pt) consistent with the existing notification i18n.

## 11. CLI parity (`packages/cli/src/terminology.ts`)

`openldr terminology import --system <loinc|snomed|rxnorm> --file <dist.zip> --accept-license [--version V]`:

- The CLI has direct DB + blob access. It **stores the zip to the blob store** (`putStream` from a local
  read stream, same retention as the UI) and then runs the **shared `ingestDistribution` core inline**
  (progress to stdout), rather than depending on the server's worker being up. This reuses the exact
  ingest unit the worker uses, so results are identical.
- `openldr terminology distribution purge --system <…>` mirrors the UI purge.

## 12. Config / infra

- `TERMINOLOGY_WORK_DIR` (optional) — working dir for zip download + extraction; defaults to OS temp.
  Documented requirement: **ephemeral disk headroom** (SNOMED uncompresses to several GB). For the Docker
  stack, this is container-writable temp (tmpfs or the overlay); note in `.env.prod.example` and the
  Keycloak/infra docs sibling.
- `@fastify/multipart` and `@aws-sdk/lib-storage` added as deps.
- `nginx` gateway: raise `client_max_body_size` (e.g. `1g`) on the `/api/` location in
  `deploy/nginx/openldr.conf.template`; keep other locations at the default.
- No new exposed services — MinIO/S3 stays internal; the browser only ever talks to the authenticated API.

## 13. Error handling / idempotency / concurrency

- **License:** enqueue rejects unless `acceptLicense === true` (server-side).
- **One-at-a-time per system:** enforced by the partial unique index + `409` on enqueue.
- **Re-import:** concepts are **upserted** (retirements reflected where the distribution encodes status);
  the ontology tree is **rebuilt** for the system (replaces prior tree). No destructive concept prune.
- **Crash recovery:** a `running` job whose worker died is reclaimable — on worker startup, reset
  `running` jobs with no live worker back to `queued` (or `failed` with a "worker restarted" note); the
  retained blob makes a clean retry possible.
- **Redaction:** all surfaced errors run through `redact` (may carry DB/connection strings).
- **Audit:** upload, completion, failure, and purge each write an `audit_events` row.

## 14. Testing strategy

- **Storage:** `putStream`/`getStream`/`delete` against a fake/mem S3 (existing adapter test harness);
  assert multipart path is used for large bodies and nothing is fully buffered.
- **Ingest core:** feed small real fixtures (the `corlix/fixtures` LOINC/SNOMED/RxNorm slices per
  [[terminology-data]]) through `ingestDistribution`; assert **both** sinks populated (concept counts +
  node/edge counts) for all three systems; assert streaming line-reads (no `readFileSync` on the big
  files).
- **Job store:** `enqueue` one-at-a-time `409`; `claimNext` race-safety (concurrent claim yields one
  winner); progress/finish transitions.
- **Worker:** end-to-end with a fake blob + fixture zip → job goes `queued → running → ready`, audit row
  written, temp dir cleaned, previous blob deleted.
- **Routes:** RBAC negative (`lab_technician` → 403); license-not-accepted → 400; active-job → 409; purge
  deletes the blob.
- **Notifications:** a `terminology.import.completed` audit row surfaces as a bell notification.
- **CLI:** `import` stores the blob + runs the ingest inline; `purge` deletes it.
- **Studio:** dialog uploads with progress; publisher shows job status; parity/i18n keys present.
- Gate: `pnpm turbo run typecheck test --force` (per [[repo-conventions]]).

## 15. Phasing (one spec, three slices)

1. **Slice 1 — pipeline end-to-end for LOINC.** Blob streaming (§5) + job table/store (§6) + shared
   ingest core with LOINC extractor teeing both sinks (§7a) + worker (§7b) + upload/status/purge API (§8)
   + Studio dialog & status (§9) + notification mapping (§10). LOINC already has both a term loader and an
   ontology adapter, so it proves the whole machine.
2. **Slice 2 — SNOMED CT + RxNorm flat terms.** Add concept-sink teeing to the SNOMED/RxNorm extractors
   and the streaming large-file hardening (§7a); wire their publishers' "Import distribution…" menu.
3. **Slice 3 — CLI parity + polish.** `openldr terminology import/purge` (§11); crash-recovery reset
   (§13); docs/config (§12); remove the legacy server-path route.

## 16. Open questions / risks

- **Uncompressed disk footprint** (SNOMED multi-GB) in the container — mitigated by `TERMINOLOGY_WORK_DIR`
  + documented headroom; streaming-entry extraction is a future optimization.
- **Version detection** per system (LOINC version file / SNOMED `effectiveTime` in filenames / RxNorm
  release) — best-effort with an operator override field; not blocking.
- **Legacy route removal timing** — default remove in Slice 3; confirm no other caller depends on
  `POST /api/terminology/import/loinc`.
