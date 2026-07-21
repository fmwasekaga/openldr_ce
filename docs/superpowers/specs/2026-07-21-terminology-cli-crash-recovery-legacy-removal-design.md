# Terminology upload — CLI parity, crash recovery, legacy-route removal (Slice 3) — design

- **Date:** 2026-07-21
- **Status:** approved (brainstorm) → ready for implementation plan
- **Depends on:** Slices 1 / 1.1 / 2 (merged local `main` `a3e2b0bd`; Slices 1/1.1 pushed).
- **Scope:** (A) a CLI `terminology distribution import/purge` group that runs the ingest **inline** (standalone, no server needed), reusing the exact server logic via shared extractions; (B) orphaned-`running`-job crash recovery on worker startup; (C) remove the now-dead legacy `POST /api/terminology/import/loinc` route + its Studio client.

## 1. Motivation

The upload→ingest pipeline (Slices 1–2) is HTTP + background-worker only. Per [[cli-operator-parity]], operator features need CLI commands — and an operator reaching for the CLI often does **not** have the full server stack running, so the CLI must be able to ingest a distribution **inline**. Two loose ends also close here: a worker crash mid-ingest leaves a job stuck `running` forever (no recovery), and the legacy server-filesystem-path `POST /api/terminology/import/loinc` route is now dead (Slice 1.1 replaced the Studio dialog that called it) but still shipped.

## 2. Goals / Non-goals

**Goals**
- `openldr terminology distribution import <loinc|snomed|rxnorm> --file <dist.zip> [--accept-license] [--version V]` — inline ingest (resolve-or-create coding system → store zip to blob → process inline → report `conceptsLoaded`), reusing the **same** code the server route + worker run.
- `openldr terminology distribution purge <system>` — mirror the DELETE route.
- Crash recovery: on worker startup, reset orphaned `running` jobs → `failed` (retained blob makes retry cheap; no crash-loop risk).
- Remove the dead legacy route + Studio client + its test.
- No logic divergence between CLI and server — shared extractions, not copy-paste.

**Non-goals**
- CLI `--wait`/enqueue-for-server mode (rejected in brainstorm — inline only).
- Removing the CLI's existing `terminology import loinc|amr|resource <path>` commands (orthogonal inline loaders; retained) or the folder-path `loaders.loinc`.
- Multi-worker heartbeat-based orphan detection (single-worker model; out of scope).
- Consolidating the two bootstrap terminology contexts (tracked tech-debt; not this slice).

## 3. Current state (what we build on)

- **Route** (`apps/server/src/terminology-admin-routes.ts`): `resolveCodingSystemId(systemType, version)` (inline closure in `registerTerminologyAdminRoutes`); the publisher-scoped upload/status/purge routes; the legacy `POST /api/terminology/import/loinc` (line ~124) + its `loincImportInput` zod schema.
- **Worker** (`packages/bootstrap/src/terminology-ingest-worker.ts`): `processJob(job)` (capture `latestReadyForSystem` prior → `runIngest` → `finish` ready/failed → audit `terminology.import.completed`/`.failed` → delete prior blob); `tickOnce` = `claimNext()` → `processJob`; `setInterval`.
- **Bootstrap wiring** (`packages/bootstrap/src/index.ts` `runIngest`): the `mkdtemp` → `downloadAndExtract` → `ingestDistribution` → `rm` closure that the worker's `runIngest` dep uses.
- **Job store** (`packages/db/src/terminology-ingest-job-store.ts`): `enqueue/claimNext/updateProgress/finish/get/latestForSystem/latestReadyForSystem/hasActive`; `status: 'queued'|'running'|'ready'|'failed'`; nullable `active_key` mirror column + unique index (one active per system). **No `failStaleRunning` yet.**
- **CLI** (`packages/cli/src/terminology.ts` + `index.ts`): `runTerminologyImport(kind, path, opts)` (inline `loaders.loinc`/`amr`/`resource`); commands registered under `term = program.command('terminology')`; uses `createTerminologyContext(loadConfig())` (which has `admin`, `loaders`, `ingestOntologyWithConcepts`). CLI has no job store / blob today.
- **Studio** (`apps/studio/src/api.ts`): `importLoincDistribution` (line ~860) + `TerminologyLoadResult` (line ~836) — **used only by `api.ontology.test.ts`** now (no production caller); safe to remove.
- **Blob/extract:** `createS3Bucket(cfg)` (`@openldr/adapter-s3-bucket`); `downloadAndExtract(blob, key, workDir)` (`@openldr/bootstrap`).

## 4. Design

### 4a. Shared extractions (`@openldr/bootstrap`) — one code path for route + worker + CLI
Move three small units so the CLI and server are provably identical:

1. **`resolveCodingSystemId(admin, systemType, version)`** — lifted verbatim from the route's inline closure: `getByUrl(canonicalSystemUrl(systemType))` else `upsertByUrl({ url, systemCode: deriveSystemCode(url), systemName: deriveSystemCode(url), systemVersion: version, publisherId: resolveSeedPublisherId(url) })` then read back the id. `admin` is the `TerminologyAdminStore` (both the route's `ctx.terminology.admin` and the CLI's `ctx.admin`). The route calls this shared fn instead of its inline copy.

2. **`createRunIngest({ blob, terminology, workDirBase })`** → `(job, onProgress) => Promise<{ conceptsLoaded }>` — the `mkdtemp → downloadAndExtract → ingestDistribution → finally rm` closure currently inline in bootstrap's `runIngest`. `terminology` supplies `loaders.loinc` + `ingestOntologyWithConcepts` (the `ingestDistribution` deps). Bootstrap's worker wiring calls this factory instead of the inline closure; the CLI calls it too.

3. **`runIngestJob({ job, jobs, blob, runIngest, audit, logger })`** → `Promise<{ status: 'ready'|'failed'; conceptsLoaded: number; error: string | null }>` — the worker's `processJob` body (capture `latestReadyForSystem` prior → `runIngest` → `finish` → audit `terminology.import.completed`/`.failed` → delete prior blob on success). The worker's `processJob` becomes a thin call to this; the CLI calls it too.

These live next to the worker in `@openldr/bootstrap` and are exported. No behaviour change for the server (it just calls the extracted fns).

### 4b. CLI — `terminology distribution import/purge` (inline)
New command group under `term` (`packages/cli/src/terminology.ts` + registration in `index.ts`):

```
openldr terminology distribution import <system> --file <dist.zip> [--accept-license] [--version V] [--json]
openldr terminology distribution purge   <system> [--json]
```

`runDistributionImport(system, file, opts)`:
1. `cfg = loadConfig()`; build: `ctx = createTerminologyContext(cfg)` (admin, loaders, ingestOntologyWithConcepts, audit), `internalDb`, `jobs = createTerminologyIngestJobStore(internalDb)`, `blob = createS3Bucket(cfg)`.
2. Validate `system ∈ {loinc,snomed,rxnorm}` (else exit 1); require `--accept-license` (else exit 1).
3. `codingSystemId = await resolveCodingSystemId(ctx.admin, system, version ?? null)`.
4. Stream the local zip to the blob: `key = terminology-dist/${system}/${codingSystemId}-${Date.now()}.zip`; `await blob.putStream(key, createReadStream(file), 'application/zip')`.
5. **Insert the job already in `running`** via a new store method `insertRunning({ systemType, codingSystemId, blobKey, version, createdBy })` (so the server worker — which claims only `queued` — never races it; the `active_key` unique index still enforces one-active-per-system → on conflict, report "an import for `<system>` is already in progress" and exit 1). Returns the job.
6. `runIngest = createRunIngest({ blob, terminology: ctx, workDirBase: cfg.TERMINOLOGY_WORK_DIR ?? tmpdir() })`.
7. `result = await runIngestJob({ job, jobs, blob, runIngest, audit: ctx.audit, logger: <stdout progress logger> })` — progress phases printed to stdout.
8. Print `imported <system> (<conceptsLoaded> concepts)` (or the failure + redacted error); exit `result.status === 'ready' ? 0 : 1`.

`runDistributionPurge(system, opts)`: `job = await jobs.latestForSystem(system)`; if `job?.blobKey` → `blob.delete(job.blobKey)`; audit `terminology.distribution.purged` (actor = `cliActor()`); print + exit 0.

Actor for CLI audits: `cliActor()` (already used by the other CLI terminology commands). Errors run through `redactError`.

### 4c. Crash recovery
New store method `failStaleRunning(error: string): Promise<number>` → `UPDATE terminology_ingest_jobs SET status='failed', error=$error, finished_at=now(), active_key=NULL WHERE status='running'` (returns affected count). The worker calls it **once at startup**, inside `createTerminologyIngestWorker(...)` before the interval starts (single worker ⇒ any `running` job is orphaned), with error `"interrupted — the server restarted before the import finished"`. Best-effort + logged (a failure here must not crash worker startup). The retained blob (not deleted on failure) means the operator retries via a fresh upload/CLI import.

### 4d. Legacy-route removal
- Remove `app.post('/api/terminology/import/loinc', ...)` and the `loincImportInput` zod schema from `apps/server/src/terminology-admin-routes.ts`.
- Remove its test in `apps/server/src/terminology-admin-routes.test.ts`.
- Remove `importLoincDistribution` + `TerminologyLoadResult` from `apps/studio/src/api.ts` (no production caller) and their reference in `apps/studio/src/api.ontology.test.ts`.
- Keep the CLI's `terminology import loinc|amr|resource <path>` commands and `ctx.terminology.loaders.loinc` (still used by the CLI).

## 5. Testing

- **Shared extractions:**
  - `resolveCodingSystemId`: create-when-absent (`upsertByUrl` called with the canonical url/code/publisher) + reuse-when-present, against fakes — and the route's existing tests still pass (it now calls the shared fn).
  - `runIngestJob`: reuse the worker's existing unit tests (they already exercise this body) — after the extraction they target `runIngestJob` directly (claim→ingest→finish ready + audit + prior-blob delete; failure keeps the blob + audits failed).
  - `createRunIngest`: covered by the worker/gate integration; a light unit test that it wires downloadAndExtract→ingestDistribution and cleans the temp dir (fakes).
- **`failStaleRunning`:** insert a `running` job → `failStaleRunning('x')` → it's `failed` with the error + `active_key` cleared + count 1; a `ready`/`queued` job is untouched. Worker-startup test: a pre-existing `running` job is `failed` after the worker is constructed.
- **CLI:** `runDistributionImport` with fakes (fake `jobs`/`blob`/`runIngestJob`): resolves the coding system, stores the zip (putStream called with the file stream), inserts a `running` job, runs `runIngestJob`, prints/exits per result; unsupported system → exit 1; missing license → exit 1; active-job conflict → exit 1. `runDistributionPurge`: deletes the latest blob + audits.
- **Legacy removal:** `POST /api/terminology/import/loinc` now 404s (route gone) — update/remove the old test; `apps/studio` builds/typechecks without `importLoincDistribution`; `api.ontology.test.ts` no longer imports it.
- Gate: `pnpm turbo run typecheck test --force` (bootstrap/db/server/studio parallel flakes pass in isolation / `--concurrency=1`, per [[repo-conventions]]).

## 6. Out of scope (future)
- Consolidating the two bootstrap terminology contexts (standalone + inline) — tracked tech-debt.
- CLI `--dir <folder>` (extracted-folder) ingest without blob retention.
- SNOMED preferred synonyms; RxNorm concept-map extraction.

## 7. Open questions / risks
- **CLI job/blob construction:** the CLI builds `jobs` + `blob` from config directly (a little wiring the server does in bootstrap). Acceptable — small and explicit; a shared `createIngestDeps(cfg)` factory could DRY it later if it grows.
- **`insertRunning` vs enqueue+claim:** insert-directly-as-`running` avoids a race with a live server worker (which claims only `queued`) and reuses the `active_key` unique guard for "already in progress"; chosen over enqueue+`claimNext` (which could claim a different queued job).
- **Interrupted-inline CLI job:** if the CLI process is killed mid-ingest, its job stays `running`; the next server worker startup's `failStaleRunning` cleans it. Consistent.
