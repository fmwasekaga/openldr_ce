# Terminology CLI Parity, Crash Recovery & Legacy-Route Removal (Slice 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the terminology-distribution upload pipeline an inline CLI (`openldr terminology distribution import/purge`) that runs the *same* code the server does, recover orphaned `running` jobs on worker startup, and delete the now-dead legacy `POST /api/terminology/import/loinc` route + its Studio client.

**Architecture:** Extract three units the server route + worker already contain (`resolveCodingSystemId`, `createRunIngest`, `runIngestJob`) into a shared `@openldr/bootstrap` module so the route, the worker, and the new CLI all call one code path. Expose `jobs` + `blob` on `TerminologyContext` (built in bootstrap, where the S3-config mapping already lives) so the CLI needs no new package deps. Add two store methods (`insertRunning`, `failStaleRunning`).

**Tech Stack:** TypeScript, Kysely (Postgres + pg-mem), Fastify, commander (CLI), Vitest, turbo.

## Global Constraints

- **No co-author trailer.** NEVER add `Co-Authored-By: Claude` or `Co-Authored-By: Codex` to any commit or PR (user is sole contributor). Scan every commit message — including fix commits — before moving on.
- **Typecheck `apps/server` too.** Adding a required method to `TerminologyIngestJobStore` or a required field to `TerminologyContext`/`AppContext['terminology']` breaks `apps/server` fakes in `apps/server/src/test-helpers.ts` — per-package typecheck of only the owning package will not catch it. Every task that touches those interfaces runs `pnpm --filter @openldr/server typecheck` and updates the fakes.
- **Gate flakes are real.** On Windows, parallel turbo flakes both `test` and `typecheck` tasks with lock/EPERM races and occasional 5000ms timeouts. A "failure" is only real if it reproduces with `--concurrency=1` or in an isolated `npx vitest run <file>`. Verify touched packages in isolation before calling a task done.
- **`redact()` all error text** surfaced to logs/audit/stdout (it may carry a DB connection string). CLI uses `redactError()` (its existing wrapper); bootstrap uses `redact()` from `@openldr/core`.
- **Concept keying is single-URL.** Never introduce a second URL for a system: `resolveCodingSystemId` derives the URL only from `canonicalSystemUrl(systemType)` (loinc→`http://loinc.org`, snomed→`http://snomed.info/sct`, rxnorm→`http://www.nlm.nih.gov/research/umls/rxnorm`) — NOT a publisher `matchPrefix`.

---

## File Structure

**Bootstrap (`packages/bootstrap/src/`)**
- Create `terminology-ingest-shared.ts` — `resolveCodingSystemId`, `IngestTerminology` interface, `createRunIngest`, `RunIngestJobDeps`, `runIngestJob`. The single ingest code path.
- Create `s3-config.ts` — `toS3BucketConfig(cfg)` (extracted from `index.ts:357`).
- Modify `terminology-ingest-worker.ts` — `processJob` becomes a thin call to `runIngestJob`; add crash-recovery `failStaleRunning` at startup.
- Modify `terminology-context.ts` — add `jobs` + `blob` to `TerminologyContext`.
- Modify `index.ts` — worker wiring uses `createRunIngest`; `blob` uses `toS3BucketConfig`; export the new shared module.

**DB (`packages/db/src/`)**
- Modify `terminology-ingest-job-store.ts` — add `insertRunning` + `failStaleRunning`.

**Server (`apps/server/src/`)**
- Modify `terminology-admin-routes.ts` — route calls shared `resolveCodingSystemId`; delete legacy loinc-import route + `loincImportInput`.
- Modify `terminology-admin-routes.test.ts` — delete the legacy-route test.
- Modify `test-helpers.ts` — fake `TerminologyIngestJobStore` gains `insertRunning` + `failStaleRunning`.

**CLI (`packages/cli/src/`)**
- Create `distribution-args.ts` — pure `validateDistributionImportArgs` (unit-testable without a DB).
- Create `distribution-args.test.ts` — its tests.
- Modify `terminology.ts` — `runDistributionImport` + `runDistributionPurge`.
- Modify `index.ts` — register the `terminology distribution import/purge` group.

**Studio (`apps/studio/src/`)**
- Modify `api.ts` — delete `importLoincDistribution` + `TerminologyLoadResult`.
- Modify `api.ontology.test.ts` — delete its references.

---

## Task 1: Shared `resolveCodingSystemId` + route rewire

**Files:**
- Create: `packages/bootstrap/src/terminology-ingest-shared.ts`
- Create: `packages/bootstrap/src/terminology-ingest-shared.test.ts`
- Modify: `packages/bootstrap/src/index.ts` (add `export * from './terminology-ingest-shared';` near the other terminology exports, ~line 1313)
- Modify: `apps/server/src/terminology-admin-routes.ts:387-398` (replace inline `resolveCodingSystemId` with a call to the shared one)

**Interfaces:**
- Produces: `resolveCodingSystemId(admin: TerminologyAdminStore, systemType: string, version: string | null): Promise<string>`

- [ ] **Step 1: Write the failing test** — `packages/bootstrap/src/terminology-ingest-shared.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { resolveCodingSystemId } from './terminology-ingest-shared';

function fakeAdmin(existing: Record<string, { id: string }>) {
  const upserts: unknown[] = [];
  const store = { ...existing };
  const admin = {
    codingSystems: {
      async getByUrl(url: string) { return store[url] ?? null; },
      async upsertByUrl(input: { url: string }) {
        upserts.push(input);
        store[input.url] = { id: `cs_${Object.keys(store).length}` };
      },
    },
  } as never;
  return { admin, upserts };
}

describe('resolveCodingSystemId', () => {
  it('creates the coding system by canonical URL when absent (snomed → .../sct)', async () => {
    const { admin, upserts } = fakeAdmin({});
    const id = await resolveCodingSystemId(admin, 'snomed', '2026-01');
    expect(id).toMatch(/^cs_/);
    expect(upserts).toHaveLength(1);
    expect((upserts[0] as { url: string }).url).toBe('http://snomed.info/sct');
    expect((upserts[0] as { systemVersion: string }).systemVersion).toBe('2026-01');
  });

  it('reuses the existing coding system without upserting', async () => {
    const { admin, upserts } = fakeAdmin({ 'http://loinc.org': { id: 'cs_existing' } });
    const id = await resolveCodingSystemId(admin, 'loinc', null);
    expect(id).toBe('cs_existing');
    expect(upserts).toHaveLength(0);
  });

  it('throws on an unsupported system type', async () => {
    const { admin } = fakeAdmin({});
    await expect(resolveCodingSystemId(admin, 'icd10', null)).rejects.toThrow(/unsupported system type/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/bootstrap && npx vitest run src/terminology-ingest-shared.test.ts`
Expected: FAIL — cannot find module `./terminology-ingest-shared`.

- [ ] **Step 3: Create the shared module with `resolveCodingSystemId`** — `packages/bootstrap/src/terminology-ingest-shared.ts`

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { redact } from '@openldr/core';
import type { BlobStoragePort } from '@openldr/ports';
import type { AuditStore } from '@openldr/audit';
import { deriveSystemCode, resolveSeedPublisherId, type TerminologyAdminStore, type TerminologyIngestJob, type TerminologyIngestJobStore } from '@openldr/db';
import { canonicalSystemUrl, ingestDistribution, type IngestProgress } from '@openldr/terminology';
import { downloadAndExtract } from './terminology-dist-extract';

// Resolve the coding system for a systemType by its loader-backed canonical URL, creating it if
// absent with the SAME values loadLoinc's saveSystem uses (so it is one row, not a duplicate).
// Shared by the upload route and the CLI so both key concepts to exactly one URL per system.
export async function resolveCodingSystemId(
  admin: TerminologyAdminStore,
  systemType: string,
  version: string | null,
): Promise<string> {
  const url = canonicalSystemUrl(systemType);
  if (!url) throw new Error(`unsupported system type: ${systemType}`);
  let cs = await admin.codingSystems.getByUrl(url);
  if (!cs) {
    await admin.codingSystems.upsertByUrl({
      url,
      systemCode: deriveSystemCode(url),
      systemName: deriveSystemCode(url),
      systemVersion: version,
      publisherId: resolveSeedPublisherId(url),
    });
    cs = await admin.codingSystems.getByUrl(url);
  }
  return cs!.id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/bootstrap && npx vitest run src/terminology-ingest-shared.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Rewire the route to the shared function** — `apps/server/src/terminology-admin-routes.ts`

Delete the inline `resolveCodingSystemId` (lines 385-398). Add `resolveCodingSystemId` to the `@openldr/bootstrap` import at the top of the file. At the single call site (was line 410), change:

```ts
    try { codingSystemId = await resolveCodingSystemId(systemType, q.version ?? null); }
```

to:

```ts
    try { codingSystemId = await resolveCodingSystemId(admin, systemType, q.version ?? null); }
```

Add `export * from './terminology-ingest-shared';` to `packages/bootstrap/src/index.ts` alongside the other `export * from './terminology-*'` lines (~1313-1314).

- [ ] **Step 6: Typecheck bootstrap + server; run the route tests**

Run: `pnpm --filter @openldr/bootstrap typecheck && pnpm --filter @openldr/server typecheck && cd apps/server && npx vitest run src/terminology-admin-routes.test.ts`
Expected: typecheck clean; route tests still PASS (the resolve-or-create behaviour is unchanged — the create-when-absent + reuse-when-present paths are exercised by the existing upload tests).

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src/terminology-ingest-shared.ts packages/bootstrap/src/terminology-ingest-shared.test.ts packages/bootstrap/src/index.ts apps/server/src/terminology-admin-routes.ts
git commit -m "refactor(terminology): extract resolveCodingSystemId into @openldr/bootstrap"
```

---

## Task 2: Shared `createRunIngest` + `runIngestJob` + worker rewire

**Files:**
- Modify: `packages/bootstrap/src/terminology-ingest-shared.ts` (add `IngestTerminology`, `createRunIngest`, `RunIngestJobDeps`, `runIngestJob`)
- Create: `packages/bootstrap/src/terminology-ingest-shared.runjob.test.ts`
- Modify: `packages/bootstrap/src/terminology-ingest-worker.ts` (`processJob` → `runIngestJob`)
- Modify: `packages/bootstrap/src/index.ts:638-662` (worker `runIngest` uses `createRunIngest`)

**Interfaces:**
- Consumes: `TerminologyIngestJob`, `IngestProgress`, `resolveCodingSystemId` (Task 1)
- Produces:
  - `interface IngestTerminology { loaders: { loinc(dir: string, acceptLicense: boolean): Promise<{ conceptsLoaded: number }> }; ontology: { build(systemId: string, dir: string, onProgress: (p: IngestProgress) => void): Promise<unknown> }; ingestOntologyWithConcepts(systemType: string, systemId: string, dir: string, onProgress: (p: IngestProgress) => void): Promise<{ conceptsLoaded: number }> }`
  - `createRunIngest(opts: { blob: Pick<BlobStoragePort, 'getStream'>; terminology: IngestTerminology; workDirBase: string }): (job: TerminologyIngestJob, onProgress: (p: IngestProgress) => void) => Promise<{ conceptsLoaded: number }>`
  - `interface RunIngestJobDeps { job: TerminologyIngestJob; jobs: Pick<TerminologyIngestJobStore, 'latestReadyForSystem' | 'updateProgress' | 'finish'>; blob: Pick<BlobStoragePort, 'delete'>; runIngest(job: TerminologyIngestJob, onProgress: (p: IngestProgress) => void): Promise<{ conceptsLoaded: number }>; audit: Pick<AuditStore, 'record'>; logger: { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void }; onProgress?: (p: IngestProgress) => void }`
  - `runIngestJob(deps: RunIngestJobDeps): Promise<{ status: 'ready' | 'failed'; conceptsLoaded: number; error: string | null }>`

- [ ] **Step 1: Write the failing test** — `packages/bootstrap/src/terminology-ingest-shared.runjob.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { runIngestJob } from './terminology-ingest-shared';
import type { TerminologyIngestJob } from '@openldr/db';

const job = { id: 'tij_1', systemType: 'snomed', codingSystemId: 'cs_1', blobKey: 'k/new.zip', version: '2026', status: 'running' } as TerminologyIngestJob;
const logger = { info: vi.fn(), error: vi.fn() };

function deps(over: Partial<Parameters<typeof runIngestJob>[0]> = {}) {
  return {
    job,
    jobs: {
      latestReadyForSystem: vi.fn(async () => null),
      updateProgress: vi.fn(async () => {}),
      finish: vi.fn(async () => {}),
    },
    blob: { delete: vi.fn(async () => {}) },
    runIngest: vi.fn(async () => ({ conceptsLoaded: 42 })),
    audit: { record: vi.fn(async () => {}) },
    logger,
    ...over,
  } as Parameters<typeof runIngestJob>[0];
}

describe('runIngestJob', () => {
  it('finishes ready, audits completed, deletes the prior ready blob, returns conceptsLoaded', async () => {
    const d = deps({ jobs: {
      latestReadyForSystem: vi.fn(async () => ({ status: 'ready', blobKey: 'k/old.zip' } as never)),
      updateProgress: vi.fn(async () => {}), finish: vi.fn(async () => {}),
    } });
    const r = await runIngestJob(d);
    expect(r).toEqual({ status: 'ready', conceptsLoaded: 42, error: null });
    expect(d.jobs.finish).toHaveBeenCalledWith('tij_1', 'ready', null);
    expect(d.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'terminology.import.completed' }));
    expect(d.blob.delete).toHaveBeenCalledWith('k/old.zip');
  });

  it('does NOT delete the prior blob when it equals the current job blob', async () => {
    const d = deps({ jobs: {
      latestReadyForSystem: vi.fn(async () => ({ status: 'ready', blobKey: 'k/new.zip' } as never)),
      updateProgress: vi.fn(async () => {}), finish: vi.fn(async () => {}),
    } });
    await runIngestJob(d);
    expect(d.blob.delete).not.toHaveBeenCalled();
  });

  it('on runIngest throw: finishes failed with a redacted message, audits failed, keeps the blob', async () => {
    const d = deps({ runIngest: vi.fn(async () => { throw new Error('boom'); }) });
    const r = await runIngestJob(d);
    expect(r.status).toBe('failed');
    expect(d.jobs.finish).toHaveBeenCalledWith('tij_1', 'failed', expect.stringContaining('boom'));
    expect(d.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'terminology.import.failed' }));
    expect(d.blob.delete).not.toHaveBeenCalled();
  });

  it('forwards progress to the optional onProgress AND jobs.updateProgress', async () => {
    const onProgress = vi.fn();
    const d = deps({ onProgress, runIngest: vi.fn(async (_j, cb) => { cb({ phase: 'flat', processed: 5, total: 10 }); return { conceptsLoaded: 1 }; }) });
    await runIngestJob(d);
    expect(onProgress).toHaveBeenCalledWith({ phase: 'flat', processed: 5, total: 10 });
    expect(d.jobs.updateProgress).toHaveBeenCalledWith('tij_1', { phase: 'flat', processed: 5, total: 10 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/bootstrap && npx vitest run src/terminology-ingest-shared.runjob.test.ts`
Expected: FAIL — `runIngestJob` is not exported.

- [ ] **Step 3: Add `IngestTerminology`, `createRunIngest`, `runIngestJob`** to `packages/bootstrap/src/terminology-ingest-shared.ts` (append below `resolveCodingSystemId`)

```ts
export interface IngestTerminology {
  loaders: { loinc(dir: string, acceptLicense: boolean): Promise<{ conceptsLoaded: number }> };
  ontology: { build(systemId: string, dir: string, onProgress: (p: IngestProgress) => void): Promise<unknown> };
  ingestOntologyWithConcepts(systemType: string, systemId: string, dir: string, onProgress: (p: IngestProgress) => void): Promise<{ conceptsLoaded: number }>;
}

// The download→extract→ingest closure. Streams the uploaded zip to a fresh scratch dir per job
// (cleaned up unconditionally, including on a mid-extract throw), then hands the extracted dir to
// the orchestrator (flat concepts before the ontology tree). Shared by the worker and the CLI.
export function createRunIngest(opts: {
  blob: Pick<BlobStoragePort, 'getStream'>;
  terminology: IngestTerminology;
  workDirBase: string;
}): (job: TerminologyIngestJob, onProgress: (p: IngestProgress) => void) => Promise<{ conceptsLoaded: number }> {
  return async (job, onProgress) => {
    const workDir = await mkdtemp(join(opts.workDirBase, 'terminology-ingest-'));
    try {
      const { distDir } = await downloadAndExtract(opts.blob, job.blobKey, workDir);
      return await ingestDistribution({
        systemType: job.systemType,
        codingSystemId: job.codingSystemId,
        distDir,
        acceptLicense: true, // acceptance was enforced at upload/enqueue time
        onProgress,
        deps: {
          loadConcepts: async (_systemType, dir, o) => {
            const r = await opts.terminology.loaders.loinc(dir, o.acceptLicense);
            return { conceptsLoaded: r.conceptsLoaded };
          },
          buildOntology: async (_systemType, codingSystemId, dir, onP) =>
            opts.terminology.ontology.build(codingSystemId, dir, (p) => onP({ phase: p.phase, processed: p.processed, total: p.total })),
          buildOntologyWithConcepts: async (systemType, codingSystemId, dir, onP) =>
            opts.terminology.ingestOntologyWithConcepts(systemType, codingSystemId, dir, onP),
        },
      });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  };
}

export interface RunIngestJobDeps {
  job: TerminologyIngestJob;
  jobs: Pick<TerminologyIngestJobStore, 'latestReadyForSystem' | 'updateProgress' | 'finish'>;
  blob: Pick<BlobStoragePort, 'delete'>;
  runIngest(job: TerminologyIngestJob, onProgress: (p: IngestProgress) => void): Promise<{ conceptsLoaded: number }>;
  audit: Pick<AuditStore, 'record'>;
  logger: { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void };
  onProgress?: (p: IngestProgress) => void;
}

// Process one claimed/inserted 'running' job to completion: capture the prior retained blob
// (latestReadyForSystem excludes the current still-'running' job), run the ingest, finish
// ready/failed, audit, and drop the prior blob only on success. Behaviour is identical to the
// worker's former inline processJob; it additionally returns a result and forwards progress to an
// optional onProgress so the CLI can print to the terminal.
export async function runIngestJob(deps: RunIngestJobDeps): Promise<{ status: 'ready' | 'failed'; conceptsLoaded: number; error: string | null }> {
  const { job } = deps;
  const prior = await deps.jobs.latestReadyForSystem(job.systemType).catch(() => null);
  try {
    const { conceptsLoaded } = await deps.runIngest(job, (p) => {
      deps.onProgress?.(p);
      void deps.jobs.updateProgress(job.id, p).catch((err) => deps.logger.error({ err, jobId: job.id }, 'ingest progress write failed'));
    });
    await deps.jobs.finish(job.id, 'ready', null);
    await deps.audit.record({
      actorType: 'system', actorName: 'System', action: 'terminology.import.completed',
      entityType: 'coding_system', entityId: job.codingSystemId,
      metadata: { systemType: job.systemType, version: job.version, conceptsLoaded },
    });
    if (prior && prior.status === 'ready' && prior.blobKey && prior.blobKey !== job.blobKey) {
      await deps.blob.delete(prior.blobKey).catch((err) => deps.logger.error({ err, key: prior.blobKey }, 'prior distribution blob delete failed'));
    }
    return { status: 'ready', conceptsLoaded, error: null };
  } catch (err) {
    const msg = redact(err instanceof Error ? err.message : String(err));
    await deps.jobs.finish(job.id, 'failed', msg);
    await deps.audit.record({
      actorType: 'system', actorName: 'System', action: 'terminology.import.failed',
      entityType: 'coding_system', entityId: job.codingSystemId,
      metadata: { systemType: job.systemType, version: job.version, error: msg },
    });
    deps.logger.error({ jobId: job.id, err }, 'terminology ingest failed');
    // The uploaded blob is intentionally retained so the operator can retry.
    return { status: 'failed', conceptsLoaded: 0, error: msg };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/bootstrap && npx vitest run src/terminology-ingest-shared.runjob.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Rewire the worker to `runIngestJob`** — `packages/bootstrap/src/terminology-ingest-worker.ts`

Add to the imports: `import { runIngestJob } from './terminology-ingest-shared';`. Replace the entire `processJob` function body (lines 27-58) with:

```ts
  async function processJob(job: TerminologyIngestJob): Promise<void> {
    await runIngestJob({
      job, jobs: deps.jobs, blob: deps.blob, runIngest: deps.runIngest,
      audit: deps.audit, logger: deps.logger,
    });
  }
```

Remove the now-unused `redact` import and the `IngestProgress` import if they become unused (leave `IngestProgress` if still referenced by `TerminologyIngestWorkerDeps.runIngest`). Verify with typecheck in Step 7.

- [ ] **Step 6: Rewire `index.ts` worker wiring to `createRunIngest`** — `packages/bootstrap/src/index.ts`

Add `createRunIngest` to the imports from `./terminology-ingest-shared` (or rely on the barrel — import explicitly: `import { createRunIngest } from './terminology-ingest-shared';`). Replace the inline `runIngest: async (job, onProgress) => { ... }` (lines 638-662) with:

```ts
    runIngest: createRunIngest({ blob, terminology, workDirBase: terminologyWorkDirBase }),
```

where `terminology` is the existing inline terminology context object (it already exposes `loaders.loinc`, `ontology.build`, `ingestOntologyWithConcepts`, satisfying `IngestTerminology`). Remove any now-unused imports (`mkdtemp`/`join`/`rm`/`downloadAndExtract`/`ingestDistribution`) **only if** no other code in `index.ts` uses them — verify with typecheck.

- [ ] **Step 7: Typecheck bootstrap + server; run worker + shared tests**

Run: `pnpm --filter @openldr/bootstrap typecheck && pnpm --filter @openldr/server typecheck && cd packages/bootstrap && npx vitest run src/terminology-ingest-worker.test.ts src/terminology-ingest-shared.test.ts src/terminology-ingest-shared.runjob.test.ts`
Expected: typecheck clean; the existing worker tests still PASS unchanged (processJob now delegates but behaves identically), plus the new shared tests PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/bootstrap/src/terminology-ingest-shared.ts packages/bootstrap/src/terminology-ingest-shared.runjob.test.ts packages/bootstrap/src/terminology-ingest-worker.ts packages/bootstrap/src/index.ts
git commit -m "refactor(terminology): extract createRunIngest + runIngestJob; worker delegates"
```

---

## Task 3: Store `insertRunning` + `failStaleRunning`

**Files:**
- Modify: `packages/db/src/terminology-ingest-job-store.ts` (interface + impl)
- Modify: `packages/db/src/terminology-ingest-job-store.test.ts` (add tests — if the file does not exist, create it)
- Modify: `apps/server/src/test-helpers.ts` (fake store gains both methods)

**Interfaces:**
- Produces (added to `TerminologyIngestJobStore`):
  - `insertRunning(input: { systemType: string; codingSystemId: string; blobKey: string; version: string | null; createdBy: string | null }): Promise<TerminologyIngestJob>`
  - `failStaleRunning(error: string): Promise<number>`

- [ ] **Step 1: Write the failing test** — add to `packages/db/src/terminology-ingest-job-store.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { newTestInternalDb } from './test-helpers'; // existing pg-mem helper; match the file's existing import
import { createTerminologyIngestJobStore } from './terminology-ingest-job-store';

describe('insertRunning / failStaleRunning', () => {
  let store: ReturnType<typeof createTerminologyIngestJobStore>;
  beforeEach(async () => { store = createTerminologyIngestJobStore(await newTestInternalDb()); });

  it('insertRunning creates a running, active job the queued-only claimer will not pick up', async () => {
    const job = await store.insertRunning({ systemType: 'snomed', codingSystemId: 'cs_1', blobKey: 'k/a.zip', version: null, createdBy: 'cli' });
    expect(job.status).toBe('running');
    expect(await store.claimNext()).toBeNull(); // claimNext only claims 'queued'
    expect(await store.hasActive('snomed')).toBe(true);
  });

  it('insertRunning rejects a second active job for the same system', async () => {
    await store.insertRunning({ systemType: 'snomed', codingSystemId: 'cs_1', blobKey: 'k/a.zip', version: null, createdBy: 'cli' });
    await expect(store.insertRunning({ systemType: 'snomed', codingSystemId: 'cs_1', blobKey: 'k/b.zip', version: null, createdBy: 'cli' }))
      .rejects.toThrow(/already active/);
  });

  it('failStaleRunning fails only running jobs, clears active_key, returns the count', async () => {
    const running = await store.insertRunning({ systemType: 'snomed', codingSystemId: 'cs_1', blobKey: 'k/a.zip', version: null, createdBy: 'cli' });
    const n = await store.failStaleRunning('interrupted');
    expect(n).toBe(1);
    const after = await store.get(running.id);
    expect(after?.status).toBe('failed');
    expect(after?.error).toBe('interrupted');
    // active_key cleared → a fresh job for the system may now be inserted
    await expect(store.insertRunning({ systemType: 'snomed', codingSystemId: 'cs_1', blobKey: 'k/c.zip', version: null, createdBy: 'cli' })).resolves.toBeDefined();
  });

  it('failStaleRunning leaves queued/ready jobs untouched', async () => {
    const q = await store.enqueue({ systemType: 'loinc', codingSystemId: 'cs_2', blobKey: 'k/q.zip', version: null, createdBy: null });
    const n = await store.failStaleRunning('interrupted');
    expect(n).toBe(0);
    expect((await store.get(q.id))?.status).toBe('queued');
  });
});
```

> If `packages/db/src/terminology-ingest-job-store.test.ts` already exists, append these cases and reuse its existing pg-mem setup helper instead of `newTestInternalDb` if it differs. Match the file's existing import style — do not introduce a second db-setup pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/db && npx vitest run src/terminology-ingest-job-store.test.ts`
Expected: FAIL — `insertRunning`/`failStaleRunning` are not functions.

- [ ] **Step 3: Add both methods** — `packages/db/src/terminology-ingest-job-store.ts`

Add to the `TerminologyIngestJobStore` interface (after `enqueue`):

```ts
  insertRunning(input: { systemType: string; codingSystemId: string; blobKey: string; version: string | null; createdBy: string | null }): Promise<TerminologyIngestJob>;
```

and (after `hasActive`):

```ts
  failStaleRunning(error: string): Promise<number>;
```

Add the implementations inside `createTerminologyIngestJobStore`'s `store` object. `insertRunning` (place next to `enqueue`):

```ts
    async insertRunning(input) {
      // Insert a job already claimed by this process (status 'running'), so a live server worker —
      // which only claims 'queued' — never races an inline CLI ingest. The one-active-per-system
      // guard (hasActive + the active_key unique index) still rejects a concurrent second import.
      if (await store.hasActive(input.systemType)) {
        throw new Error(`A terminology ingest job is already active for system "${input.systemType}"`);
      }
      const id = `tij_${randomUUID().slice(0, 8)}`;
      await db.insertInto('terminology_ingest_jobs')
        .values({
          id, system_type: input.systemType, coding_system_id: input.codingSystemId, blob_key: input.blobKey,
          version: input.version, status: 'running', started_at: sql`now()` as never, created_by: input.createdBy,
          active_key: input.systemType,
        } as never)
        .execute();
      const row = await db.selectFrom('terminology_ingest_jobs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      return toJob(row as never);
    },
```

`failStaleRunning` (place after `hasActive`):

```ts
    async failStaleRunning(error) {
      // Crash recovery: on a single-worker install any job left 'running' is orphaned. Fail it and
      // clear active_key so its one-active slot frees up. Returns how many were reset.
      const rows = await sql<{ id: string }>`
        update terminology_ingest_jobs
        set status = 'failed', error = ${error}, finished_at = now(), active_key = null
        where status = 'running'
        returning id
      `.execute(db);
      return rows.rows.length;
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/db && npx vitest run src/terminology-ingest-job-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the `apps/server` fake store** — `apps/server/src/test-helpers.ts`

Find the fake `TerminologyIngestJobStore` (search `latestReadyForSystem` or `terminologyJobs`). Add both methods to the fake so the object still satisfies the interface. Minimal in-memory behaviour consistent with the fake's existing map:

```ts
    insertRunning: async (input) => {
      const job = { id: `tij_${Object.keys(jobsById).length + 1}`, ...input, status: 'running', phase: null, processed: 0, total: null, error: null, createdAt: '', startedAt: '', finishedAt: null } as TerminologyIngestJob;
      jobsById[job.id] = job; // match the fake's existing storage shape
      return job;
    },
    failStaleRunning: async (error) => {
      let n = 0;
      for (const j of Object.values(jobsById)) if (j.status === 'running') { j.status = 'failed'; j.error = error; n++; }
      return n;
    },
```

> Match the fake's actual storage variable/shape (it may be an array or a single-job stub, not `jobsById`). The goal is only interface satisfaction + typecheck; keep it minimal.

- [ ] **Step 6: Typecheck db + server**

Run: `pnpm --filter @openldr/db typecheck && pnpm --filter @openldr/server typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/terminology-ingest-job-store.ts packages/db/src/terminology-ingest-job-store.test.ts apps/server/src/test-helpers.ts
git commit -m "feat(terminology): job store insertRunning + failStaleRunning"
```

---

## Task 4: Crash recovery — worker fails orphaned running jobs at startup

**Files:**
- Modify: `packages/bootstrap/src/terminology-ingest-worker.ts` (startup call before the interval)
- Modify: `packages/bootstrap/src/terminology-ingest-worker.test.ts` (startup test)

**Interfaces:**
- Consumes: `jobs.failStaleRunning` (Task 3)

- [ ] **Step 1: Write the failing test** — add to `packages/bootstrap/src/terminology-ingest-worker.test.ts`

```ts
it('fails orphaned running jobs once at startup', async () => {
  const failStaleRunning = vi.fn(async () => 2);
  const logger = { info: vi.fn(), error: vi.fn() };
  // Build deps matching the file's existing fake pattern; only failStaleRunning + logger.info matter here.
  const worker = createTerminologyIngestWorker(makeDeps({ jobs: { ...fakeJobs(), failStaleRunning }, logger }));
  // allow the fire-and-forget startup promise to settle
  await new Promise((r) => setTimeout(r, 0));
  expect(failStaleRunning).toHaveBeenCalledWith('interrupted — the server restarted before the import finished');
  expect(logger.info).toHaveBeenCalled();
  await worker.stop();
});
```

> Adapt `makeDeps`/`fakeJobs` to the helpers this test file already uses. If the file builds deps inline, mirror that shape; the only new expectations are the `failStaleRunning` argument and that startup does not throw.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/bootstrap && npx vitest run src/terminology-ingest-worker.test.ts`
Expected: FAIL — `failStaleRunning` is not called (not yet wired), or `makeDeps` missing the method.

- [ ] **Step 3: Wire the startup call** — `packages/bootstrap/src/terminology-ingest-worker.ts`

Immediately before `const timer = setInterval(...)` (was line 73), add:

```ts
  // Crash recovery: any job still 'running' at startup is orphaned (single worker), so fail it.
  // Best-effort and non-blocking — a failure here must never prevent the worker from starting.
  void deps.jobs.failStaleRunning('interrupted — the server restarted before the import finished')
    .then((n) => { if (n > 0) deps.logger.info({ count: n }, 'reset orphaned terminology ingest jobs at startup'); })
    .catch((err) => deps.logger.error({ err }, 'terminology ingest crash-recovery failed'));
```

(`failStaleRunning` is already on `TerminologyIngestWorkerDeps.jobs` because that field is the full `TerminologyIngestJobStore`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/bootstrap && npx vitest run src/terminology-ingest-worker.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @openldr/bootstrap typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/terminology-ingest-worker.ts packages/bootstrap/src/terminology-ingest-worker.test.ts
git commit -m "feat(terminology): reset orphaned running ingest jobs on worker startup"
```

---

## Task 5: `TerminologyContext` exposes `jobs` + `blob`; shared `toS3BucketConfig`

**Files:**
- Create: `packages/bootstrap/src/s3-config.ts`
- Modify: `packages/bootstrap/src/terminology-context.ts` (construct + expose `jobs`, `blob`)
- Modify: `packages/bootstrap/src/index.ts:357-364` (use `toS3BucketConfig`; export `s3-config`)
- Modify: `packages/bootstrap/src/terminology-context.test.ts` (if present; else create a focused test)

**Interfaces:**
- Produces:
  - `toS3BucketConfig(cfg: Config): S3BucketConfig`
  - `TerminologyContext` gains `jobs: TerminologyIngestJobStore` and `blob: BlobStoragePort`

- [ ] **Step 1: Write the failing test** — `packages/bootstrap/src/s3-config.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { toS3BucketConfig } from './s3-config';

describe('toS3BucketConfig', () => {
  it('maps the S3_* config fields onto S3BucketConfig', () => {
    const cfg = { S3_ENDPOINT: 'http://minio:9000', S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: 'ak', S3_SECRET_ACCESS_KEY: 'sk', S3_BUCKET: 'openldr', S3_FORCE_PATH_STYLE: true } as never;
    expect(toS3BucketConfig(cfg)).toEqual({ endpoint: 'http://minio:9000', region: 'us-east-1', accessKeyId: 'ak', secretAccessKey: 'sk', bucket: 'openldr', forcePathStyle: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/bootstrap && npx vitest run src/s3-config.test.ts`
Expected: FAIL — cannot find `./s3-config`.

- [ ] **Step 3: Create `s3-config.ts`** — `packages/bootstrap/src/s3-config.ts`

```ts
import type { Config } from '@openldr/config';
import { createS3Bucket, type S3BucketConfig } from '@openldr/adapter-s3-bucket';
import type { BlobStoragePort } from '@openldr/ports';

export function toS3BucketConfig(cfg: Config): S3BucketConfig {
  return {
    endpoint: cfg.S3_ENDPOINT,
    region: cfg.S3_REGION,
    accessKeyId: cfg.S3_ACCESS_KEY_ID,
    secretAccessKey: cfg.S3_SECRET_ACCESS_KEY,
    bucket: cfg.S3_BUCKET,
    forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
  };
}

export function createBlobFromConfig(cfg: Config): BlobStoragePort {
  return createS3Bucket(toS3BucketConfig(cfg));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/bootstrap && npx vitest run src/s3-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Expose `jobs` + `blob` on `TerminologyContext`** — `packages/bootstrap/src/terminology-context.ts`

Add imports: `import { createTerminologyIngestJobStore, type TerminologyIngestJobStore } from '@openldr/db';`, `import type { BlobStoragePort } from '@openldr/ports';`, `import { createBlobFromConfig } from './s3-config';`.

Add to the `TerminologyContext` interface:

```ts
  jobs: TerminologyIngestJobStore;
  blob: BlobStoragePort;
```

Inside `createTerminologyContext`, after `const ontologyStore = createOntologyStore(db);`:

```ts
  const jobs = createTerminologyIngestJobStore(db);
  const blob = createBlobFromConfig(cfg);
```

Add `jobs` and `blob` to the returned object (alongside `admin`, `ontology`, …).

- [ ] **Step 6: Use `toS3BucketConfig` in `index.ts`** — `packages/bootstrap/src/index.ts`

Replace the inline `createS3Bucket({ endpoint: cfg.S3_ENDPOINT, … })` (lines 357-364) with:

```ts
  const blob = createS3Bucket(toS3BucketConfig(cfg));
```

Add `import { toS3BucketConfig } from './s3-config';` and `export * from './s3-config';` (near the other exports). Keep the existing `createS3Bucket` import.

- [ ] **Step 7: Typecheck bootstrap + server; run the s3-config test + any terminology-context test**

Run: `pnpm --filter @openldr/bootstrap typecheck && pnpm --filter @openldr/server typecheck && cd packages/bootstrap && npx vitest run src/s3-config.test.ts`
Expected: clean + PASS. (The two required new fields on `TerminologyContext` are also used by `AppContext`-adjacent fakes only if they consume `TerminologyContext` directly — the server builds its own context, so this addition should not break server fakes; confirm via the server typecheck above.)

- [ ] **Step 8: Commit**

```bash
git add packages/bootstrap/src/s3-config.ts packages/bootstrap/src/s3-config.test.ts packages/bootstrap/src/terminology-context.ts packages/bootstrap/src/index.ts
git commit -m "feat(terminology): expose jobs + blob on TerminologyContext; share toS3BucketConfig"
```

---

## Task 6: CLI `terminology distribution import/purge`

**Files:**
- Create: `packages/cli/src/distribution-args.ts`
- Create: `packages/cli/src/distribution-args.test.ts`
- Modify: `packages/cli/src/terminology.ts` (`runDistributionImport`, `runDistributionPurge`)
- Modify: `packages/cli/src/index.ts` (register `tdist` group after the `tterm`/`tvs` groups, ~line 297)

**Interfaces:**
- Consumes: `resolveCodingSystemId`, `createRunIngest`, `runIngestJob` (bootstrap), `ctx.jobs`, `ctx.blob`, `ctx.admin`, `ctx.audit`, `ctx.logger` (Task 5)
- Produces:
  - `validateDistributionImportArgs(system: string, opts: { file?: string; acceptLicense?: boolean }): string | null` (error message or null)
  - `runDistributionImport(system: string, opts: { file?: string; acceptLicense?: boolean; version?: string; json: boolean }): Promise<number>`
  - `runDistributionPurge(system: string, opts: { json: boolean }): Promise<number>`

- [ ] **Step 1: Write the failing test** — `packages/cli/src/distribution-args.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { validateDistributionImportArgs } from './distribution-args';

describe('validateDistributionImportArgs', () => {
  it('rejects an unsupported system', () => {
    expect(validateDistributionImportArgs('icd10', { file: 'x.zip', acceptLicense: true })).toMatch(/unsupported system/);
  });
  it('requires --file', () => {
    expect(validateDistributionImportArgs('loinc', { acceptLicense: true })).toMatch(/--file/);
  });
  it('requires --accept-license', () => {
    expect(validateDistributionImportArgs('snomed', { file: 'x.zip' })).toMatch(/license/);
  });
  it('passes for a valid loinc/snomed/rxnorm invocation', () => {
    for (const s of ['loinc', 'snomed', 'rxnorm']) {
      expect(validateDistributionImportArgs(s, { file: 'x.zip', acceptLicense: true })).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && npx vitest run src/distribution-args.test.ts`
Expected: FAIL — cannot find `./distribution-args`.

- [ ] **Step 3: Create the validator** — `packages/cli/src/distribution-args.ts`

```ts
export const DISTRIBUTION_SYSTEMS = new Set(['loinc', 'snomed', 'rxnorm']);

// Pure argument validation for `terminology distribution import`, split out so the branch logic is
// unit-testable without a database/blob store. Returns an error message, or null when valid.
export function validateDistributionImportArgs(system: string, opts: { file?: string; acceptLicense?: boolean }): string | null {
  if (!DISTRIBUTION_SYSTEMS.has(system)) return `unsupported system '${system}' (loinc|snomed|rxnorm)`;
  if (!opts.file) return 'missing --file <dist.zip>';
  if (!opts.acceptLicense) return 'the distribution license must be accepted (pass --accept-license)';
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && npx vitest run src/distribution-args.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Add the runners** — `packages/cli/src/terminology.ts`

Add imports at the top: `import { createReadStream } from 'node:fs';`, `import { tmpdir } from 'node:os';`, and extend the bootstrap import to `import { createTerminologyContext, resolveCodingSystemId, createRunIngest, runIngestJob, recordAuditEvent } from '@openldr/bootstrap';`, and `import { validateDistributionImportArgs } from './distribution-args';`.

```ts
export async function runDistributionImport(system: string, opts: { file?: string; acceptLicense?: boolean; version?: string; json: boolean }): Promise<number> {
  const argErr = validateDistributionImportArgs(system, opts);
  if (argErr) { process.stderr.write(`${argErr}\n`); return 1; }
  const cfg = loadConfig();
  const ctx = await createTerminologyContext(cfg);
  try {
    const codingSystemId = await resolveCodingSystemId(ctx.admin, system, opts.version ?? null);
    const key = `terminology-dist/${system}/${codingSystemId}-${Date.now()}.zip`;
    await ctx.blob.putStream(key, createReadStream(opts.file!), 'application/zip');
    let job;
    try {
      job = await ctx.jobs.insertRunning({ systemType: system, codingSystemId, blobKey: key, version: opts.version ?? null, createdBy: 'cli' });
    } catch {
      // one-active-per-system guard tripped — clean up the just-uploaded blob and bail
      await ctx.blob.delete(key).catch(() => {});
      process.stderr.write(`an import for ${system} is already in progress\n`);
      return 1;
    }
    const runIngest = createRunIngest({ blob: ctx.blob, terminology: ctx, workDirBase: cfg.TERMINOLOGY_WORK_DIR ?? tmpdir() });
    const result = await runIngestJob({
      job, jobs: ctx.jobs, blob: ctx.blob, runIngest, audit: ctx.audit, logger: ctx.logger,
      onProgress: (p) => process.stderr.write(`${p.phase}: ${p.processed}${p.total != null ? `/${p.total}` : ''}\r`),
    });
    if (result.status === 'ready') {
      out(opts.json, { system, conceptsLoaded: result.conceptsLoaded }, `\nimported ${system} (${result.conceptsLoaded} concepts)`);
      return 0;
    }
    process.stderr.write(`\nterminology distribution import failed: ${result.error}\n`);
    return 1;
  } catch (err) { process.stderr.write(`terminology distribution import failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runDistributionPurge(system: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const job = await ctx.jobs.latestForSystem(system);
    if (job?.blobKey) await ctx.blob.delete(job.blobKey);
    await recordAuditEvent(ctx, cliActor(), { action: 'terminology.distribution.purged', entityType: 'coding_system', entityId: job?.codingSystemId ?? system, metadata: { systemType: system, jobId: job?.id ?? null } });
    out(opts.json, { system, purged: !!job?.blobKey }, job?.blobKey ? `purged ${system} distribution` : `no distribution to purge for ${system}`);
    return 0;
  } catch (err) { process.stderr.write(`terminology distribution purge failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}
```

- [ ] **Step 6: Register the command group** — `packages/cli/src/index.ts` (after the `tvs` value-set group, ~line 303)

Extend the `runTerminologyImport` import line to also bring in the new runners: `import { runTerminologyImport, runDistributionImport, runDistributionPurge, … } from './terminology';` (add to the existing terminology import). Then:

```ts
const tdist = term.command('distribution').description('Import/purge terminology distributions (zip → flat terms + ontology)');
tdist.command('import <system>').description('import a loinc|snomed|rxnorm distribution zip inline')
  .requiredOption('--file <path>', 'path to the distribution .zip')
  .option('--accept-license', 'accept the distribution license', false)
  .option('--version <v>', 'distribution version')
  .option('--json', 'emit JSON', false)
  .action(async (system: string, opts: { file: string; acceptLicense: boolean; version?: string; json: boolean }) => {
    process.exitCode = await runDistributionImport(system, opts);
  });
tdist.command('purge <system>').description('delete the retained distribution zip for a system')
  .option('--json', 'emit JSON', false)
  .action(async (system: string, opts: { json: boolean }) => {
    process.exitCode = await runDistributionPurge(system, opts);
  });
```

- [ ] **Step 7: Typecheck CLI; run the args test**

Run: `pnpm --filter @openldr/cli typecheck && cd packages/cli && npx vitest run src/distribution-args.test.ts`
Expected: clean + PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/distribution-args.ts packages/cli/src/distribution-args.test.ts packages/cli/src/terminology.ts packages/cli/src/index.ts
git commit -m "feat(cli): terminology distribution import/purge (inline ingest)"
```

---

## Task 7: Remove the legacy `POST /api/terminology/import/loinc` route + Studio client

**Files:**
- Modify: `apps/server/src/terminology-admin-routes.ts` (delete `loincImportInput` + the route)
- Modify: `apps/server/src/terminology-admin-routes.test.ts` (delete the legacy-route test)
- Modify: `apps/studio/src/api.ts` (delete `importLoincDistribution` + `TerminologyLoadResult`)
- Modify: `apps/studio/src/api.ontology.test.ts` (delete its references)

- [ ] **Step 1: Confirm no live callers remain**

Run:
```bash
grep -rn "importLoincDistribution\|import/loinc\|TerminologyLoadResult" apps packages --include=*.ts --include=*.tsx
```
Expected: matches ONLY in the four files above (route def + its test, api.ts def + api.ontology.test.ts). If any *production* Studio component references `importLoincDistribution`, STOP and escalate — the assumption that it is dead is wrong.

- [ ] **Step 2: Delete the server route + schema** — `apps/server/src/terminology-admin-routes.ts`

Remove `loincImportInput` (lines 30-33) and the entire `app.post('/api/terminology/import/loinc', …)` handler (lines 124-136). Leave everything else (the publisher-scoped distribution routes, `termInput`, etc.) intact.

- [ ] **Step 3: Delete the route's test** — `apps/server/src/terminology-admin-routes.test.ts`

Remove the `describe`/`it` block(s) that POST to `/api/terminology/import/loinc`. Leave the distribution-upload tests intact.

- [ ] **Step 4: Delete the Studio client** — `apps/studio/src/api.ts`

Remove `importLoincDistribution` (the function ~line 860) and the `TerminologyLoadResult` type (~line 836). If `TerminologyLoadResult` is referenced by any retained export, the Step 1 grep will have shown it — in that case keep the type and remove only the function.

- [ ] **Step 5: Delete its Studio test references** — `apps/studio/src/api.ontology.test.ts`

Remove the import of `importLoincDistribution` and the `describe`/`it` block(s) that exercise it. Leave the ontology + distribution-upload tests intact.

- [ ] **Step 6: Typecheck + run affected tests**

Run: `pnpm --filter @openldr/server typecheck && pnpm --filter @openldr/studio typecheck && cd apps/server && npx vitest run src/terminology-admin-routes.test.ts && cd ../../apps/studio && npx vitest run src/api.ontology.test.ts`
Expected: typechecks clean; both test files PASS with the removed cases gone.

- [ ] **Step 7: Re-grep to confirm nothing dangling**

Run: `grep -rn "importLoincDistribution\|import/loinc" apps packages --include=*.ts --include=*.tsx`
Expected: no matches.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/terminology-admin-routes.ts apps/server/src/terminology-admin-routes.test.ts apps/studio/src/api.ts apps/studio/src/api.ontology.test.ts
git commit -m "chore(terminology): remove dead legacy loinc server-path import route + studio client"
```

---

## Task 8: Full-gate verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full gate**

Run: `pnpm turbo run typecheck test --force`
Expected: GREEN, allowing for the known Windows parallel flakes (see Global Constraints).

- [ ] **Step 2: Triage any red**

For each failing package, re-run it in isolation to distinguish a real failure from a parallel flake:

Run: `pnpm --filter @openldr/<pkg> test -- --run` (or `cd packages/<pkg> && npx vitest run <file>`)
Expected: touched packages (`@openldr/bootstrap`, `@openldr/db`, `@openldr/cli`, `@openldr/server`, `@openldr/studio`) PASS in isolation. Untouched packages that only flake under parallel turbo (audit/plugins/sync/users/workflows) are the known flake — record which, don't "fix".

- [ ] **Step 3: Scan all Slice-3 commit messages for trailers**

Run: `git log --format='%H %s%n%b' <slice3-base>..HEAD | grep -in "co-authored-by\|claude\|codex" || echo CLEAN`
Expected: `CLEAN`. If any trailer slipped in (fixer subagents have done this before), `git rebase`/`git commit --amend` it out (do NOT use `--no-verify`, which a hook blocks) and re-verify.

- [ ] **Step 4: Final commit (if triage notes were added anywhere)**

No code commit expected; the gate is verification. Report the gate result to the controller for the final whole-branch review.

---

## Self-Review

**Spec coverage:**
- Spec §4a shared extractions → Tasks 1 (`resolveCodingSystemId`) + 2 (`createRunIngest`, `runIngestJob`). ✅
- Spec §4b CLI import/purge → Task 6 (+ `insertRunning` from Task 3). ✅
- Spec §4c crash recovery → Task 3 (`failStaleRunning`) + Task 4 (worker startup). ✅
- Spec §4d legacy removal → Task 7. ✅
- Spec §5 testing → each task's TDD steps; Task 8 gate. ✅
- CLI dep-surface concern (spec §7 open question) → resolved by exposing `jobs`+`blob` on `TerminologyContext` (Task 5), so the CLI adds no new package deps. ✅

**Type consistency:** `resolveCodingSystemId(admin, systemType, version)` (Task 1) is called identically by the route (Task 1 Step 5) and the CLI (Task 6). `runIngestJob` deps shape (Task 2) matches both the worker's call (Task 2 Step 5) and the CLI's (Task 6 Step 5). `insertRunning`/`failStaleRunning` signatures (Task 3) match the CLI + worker call sites. `createRunIngest`'s `IngestTerminology` param is satisfied by both `TerminologyContext` and `index.ts`'s inline terminology object.

**Placeholder scan:** none — every code step carries full code. Fake-store shapes in Tasks 3-4 are flagged "match the file's existing shape" because the exact fake storage variable must be read at implementation time; the behaviour to implement is fully specified.
