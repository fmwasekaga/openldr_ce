# Terminology Upload — Acceptance Fixes + UX (Slice 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the six issues found in live acceptance testing of the terminology upload flow: SNOMED/large-zip extraction failure, a stale ontology menu after import, unconfirmed/opaque destructive actions, a dated file input with no upload feedback, and notification triplication.

**Architecture:** One server bug fix (random-access unzip), one server message enrichment, and four Studio changes in `apps/studio/src/pages/Terminology.tsx` (+ a small dropzone/progress UI). The upload client already uses XHR with progress and `getAccessToken()` — no api.ts change is needed for progress.

**Tech Stack:** TypeScript, `unzipper`, Fastify, Kysely, React/Vite/shadcn/ui, sonner, Vitest, turbo.

## Global Constraints

- **No co-author trailer.** NEVER add `Co-Authored-By: Claude` or `Co-Authored-By: Codex` to any commit/PR. Scan every commit message, including fix commits.
- **No `git commit --no-verify`** (a hook blocks it). Fix hook failures at the root.
- **Typecheck the packages each task touches.** Server tasks: `@openldr/server` and/or `@openldr/db`. Studio tasks: `@openldr/studio`. Bootstrap task: `@openldr/bootstrap` AND `@openldr/server` (server consumes it).
- **Gate flakes are real** (Windows parallel turbo). A failure is only real if it reproduces with `--concurrency=1` or an isolated `npx vitest run <file>`.
- **`redact()`/`redactError()` all surfaced error text.**
- **Live verification is part of this slice.** The prod stack runs under docker project `openldr-slice3` (`docker-compose.prod.yml`, `--env-file .env.prod`); the failing 554 MB SNOMED blob is retained in MinIO. Task 7 re-runs the real ingest.

---

## File Structure

- `packages/bootstrap/src/terminology-dist-extract.ts` — replace streaming extract with random-access (Task 1).
- `packages/bootstrap/src/terminology-dist-extract.test.ts` — nested-dir + zip-slip tests (Task 1).
- `packages/db/src/terminology-admin-store.ts` — enrich `codingSystems.delete` conflict message (Task 2).
- `packages/db/src/terminology-admin-store.test.ts` — guard-message test (Task 2).
- `apps/studio/src/pages/Terminology.tsx` — refetch-on-complete (Task 3), confirm + danger zone (Task 4), dropzone + progress bar (Task 5), sonner + drop banner (Task 6).
- `apps/studio/src/components/ui/progress.tsx` — shadcn Progress primitive, create if missing (Task 5).
- Studio test files alongside `Terminology.tsx` as needed.

---

## Task 1: SNOMED extract — random-access unzip

**Files:**
- Modify: `packages/bootstrap/src/terminology-dist-extract.ts`
- Modify: `packages/bootstrap/src/terminology-dist-extract.test.ts`

**Interfaces:**
- `downloadAndExtract` signature is unchanged: `(blob, key, workDir) => Promise<{ distDir: string; cleanup(): Promise<void> }>`.

**Root cause:** the streaming `unzipper.Extract()` throws zlib `Z_BUF_ERROR` ("unexpected end of file") on real SNOMED zips (data descriptors / ZIP64). The zip is already fully downloaded to `zipPath`, so use random-access `unzipper.Open.file` which reads the central directory.

- [ ] **Step 1: Write the failing test** — add to `packages/bootstrap/src/terminology-dist-extract.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReadStream } from 'node:fs';
import unzipper from 'unzipper';
import { downloadAndExtract } from './terminology-dist-extract';

// Build a zip on disk with a nested dir, then expose it through a fake blob (getStream = file read).
async function zipFrom(files: Record<string, string>, dir: string): Promise<string> {
  const src = join(dir, 'src');
  for (const [rel, content] of Object.entries(files)) {
    const p = join(src, rel);
    await mkdir(join(p, '..'), { recursive: true });
    await writeFile(p, content);
  }
  // Use unzipper's sibling writer if available; otherwise shell out is unavailable — build via archiver-free path:
  // create the zip with Node's zlib-based store through the 'unzipper' companion is not a writer, so use a minimal
  // deflate archive via the 'zip' cli is unavailable. Instead, rely on a prebuilt fixture: see note below.
  throw new Error('replaced below');
}

afterEach(() => {});
```

> NOTE TO IMPLEMENTER: the repo has no zip *writer* dependency (`archiver`/`jszip`/`zip` are absent — verified). Build the test fixture zip with **Python** (present in the environment) inside the test's setup via `node:child_process`, OR commit a tiny prebuilt fixture zip. Preferred: a helper that runs `python -c` to zip a staging dir with **forward-slash** entries, mirroring how the Slice-4 smoke-test zip was produced. Concretely, replace the broken `zipFrom` above with:

```ts
import { execFileSync } from 'node:child_process';

async function makeZip(files: Record<string, string>, root: string): Promise<string> {
  const stage = join(root, 'stage');
  for (const [rel, content] of Object.entries(files)) {
    const p = join(stage, rel);
    await mkdir(join(p, '..'), { recursive: true });
    await writeFile(p, content);
  }
  const zipPath = join(root, 'dist.zip');
  execFileSync('python', ['-c',
    `import zipfile,os,sys\n` +
    `root=sys.argv[1]; out=sys.argv[2]\n` +
    `z=zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED)\n` +
    `[z.write(os.path.join(dp,f), os.path.relpath(os.path.join(dp,f),root).replace(os.sep,'/')) for dp,_,fs in os.walk(root) for f in fs]\n` +
    `z.close()`,
    stage, zipPath]);
  return zipPath;
}

function fakeBlob(zipPath: string) {
  return { async getStream() { return createReadStream(zipPath); } };
}

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

describe('downloadAndExtract (random-access)', () => {
  it('extracts a nested-directory zip to the right paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ex-')); dirs.push(root);
    const zipPath = await makeZip({
      'LoincTable/Loinc.csv': 'LOINC_NUM\n1-0\n',
      'AccessoryFiles/PartFile/x.csv': 'a,b\n1,2\n',
    }, root);
    const workDir = await mkdtemp(join(tmpdir(), 'wd-')); dirs.push(workDir);
    const { distDir, cleanup } = await downloadAndExtract(fakeBlob(zipPath), 'k', workDir);
    expect((await readFile(join(distDir, 'LoincTable', 'Loinc.csv'), 'utf8'))).toContain('LOINC_NUM');
    expect((await stat(join(distDir, 'AccessoryFiles', 'PartFile', 'x.csv'))).isFile()).toBe(true);
    await cleanup();
  });

  it('rejects a zip-slip entry escaping the dist dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ex-')); dirs.push(root);
    // craft a slip entry via python (arcname with ../)
    const stage = join(root, 's'); await mkdir(stage, { recursive: true }); await writeFile(join(stage, 'ok.txt'), 'ok');
    const zipPath = join(root, 'slip.zip');
    execFileSync('python', ['-c',
      `import zipfile,sys\nz=zipfile.ZipFile(sys.argv[2],'w')\nz.writestr('../evil.txt','x')\nz.write(sys.argv[1]+'/ok.txt','ok.txt')\nz.close()`,
      stage, zipPath]);
    const workDir = await mkdtemp(join(tmpdir(), 'wd-')); dirs.push(workDir);
    await expect(downloadAndExtract(fakeBlob(zipPath), 'k', workDir)).rejects.toThrow(/zip.?slip|outside|invalid entry/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/bootstrap && npx vitest run src/terminology-dist-extract.test.ts`
Expected: the nested-dir test may pass on the OLD streaming code, but the zip-slip test FAILS (streaming `Extract()` does not guard). Both must pass after Step 3.

- [ ] **Step 3: Rewrite extraction to random-access** — `packages/bootstrap/src/terminology-dist-extract.ts`

```ts
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { pipeline } from 'node:stream/promises';
import unzipper from 'unzipper';
import type { BlobStoragePort } from '@openldr/ports';

/** Stream a distribution zip from the blob store to `workDir`, extract it via random-access (reading
 *  the zip's central directory — robust to data descriptors / ZIP64 that streaming inflate chokes on
 *  with `Z_BUF_ERROR`), and return the extracted root plus a cleanup. Per-entry streaming keeps memory
 *  bounded regardless of archive size. */
export async function downloadAndExtract(
  blob: Pick<BlobStoragePort, 'getStream'>,
  key: string,
  workDir: string,
): Promise<{ distDir: string; cleanup(): Promise<void> }> {
  const zipPath = join(workDir, 'distribution.zip');
  const distDir = join(workDir, 'dist');
  await mkdir(distDir, { recursive: true });

  const src = await blob.getStream(key);
  await pipeline(src, createWriteStream(zipPath));

  const directory = await unzipper.Open.file(zipPath);
  for (const entry of directory.files) {
    if (entry.type === 'Directory') continue;
    const dest = join(distDir, entry.path);
    // Zip-slip guard: the resolved destination must stay inside distDir.
    const rel = relative(distDir, dest);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`invalid entry escapes distribution dir (zip-slip): ${entry.path}`);
    }
    await mkdir(dirname(dest), { recursive: true });
    await pipeline(entry.stream(), createWriteStream(dest));
  }

  return {
    distDir,
    async cleanup() { await rm(workDir, { recursive: true, force: true }); },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/bootstrap && npx vitest run src/terminology-dist-extract.test.ts`
Expected: PASS (nested-dir extraction + zip-slip rejection).

- [ ] **Step 5: Typecheck bootstrap + server**

Run: `pnpm --filter @openldr/bootstrap typecheck && pnpm --filter @openldr/server typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/terminology-dist-extract.ts packages/bootstrap/src/terminology-dist-extract.test.ts
git commit -m "fix(terminology): extract distributions via random-access unzip (fixes Z_BUF_ERROR on SNOMED/ZIP64)"
```

---

## Task 2: Delete an uploaded coding system (cascade) + protect true seeds

**REVISED after live investigation (the original "enrich the 409 message" was based on a wrong root cause).** Facts verified against the code + live DB:
- The delete-409 is the `seeded` guard: `codingSystems.delete(id)` does `if (row.seeded) throw new TerminologyAdminError('cannot delete a seeded code system', 'conflict')` (`terminology-admin-store.ts:423`).
- `upsertByUrl` — the resolve-or-create every upload uses — sets **`seeded: true`** (`:446`). So EVERY uploaded distribution's coding system is `seeded` and undeletable. Live DB: `cs-url-LOINC`, `cs-url-RXNORM`, SNOMED all `seeded=t`.
- The client `deleteCodingSystem` (`api.ts:802`) throws `"delete system failed: ${status}"`, **discarding the server message** — hence the bare `409`.

**Decision (user):** make **upload-created** systems deletable — a coding system is upload-created iff it has a `terminology_ingest_jobs` row for its id. Deleting one cascades: ontology + concepts + ingest-job rows + the coding-system row + the stored zip(s). **Migration-seeded system systems** (FHIR/UCUM etc., which have NO ingest job) stay protected with a clear message. The route orchestrates because the blob store lives above the db layer; it reuses `ctx.terminology.ontology.unlink(id)` (tears down all ontology tables + the distribution row).

**Files:**
- Modify: `packages/db/src/terminology-ingest-job-store.ts` (+ interface: `listForCodingSystem`)
- Modify: `packages/db/src/terminology-ingest-job-store.test.ts`
- Modify: `apps/server/src/test-helpers.ts` (fake `terminologyJobs` gains `listForCodingSystem`)
- Modify: `packages/db/src/terminology-admin-store.ts` (`codingSystems.delete(id, opts?)` — policy + cascade)
- Modify: `packages/db/src/terminology-admin-store.test.ts`
- Modify: `apps/server/src/terminology-admin-routes.ts` (DELETE `/systems/:id` orchestration)
- Modify: `apps/server/src/terminology-admin-routes.test.ts`

**Interfaces:**
- Produces `TerminologyIngestJobStore.listForCodingSystem(codingSystemId: string): Promise<TerminologyIngestJob[]>` (newest first).
- Changes `admin.codingSystems.delete(id: string, opts?: { cascade?: boolean }): Promise<void>` — default behaviour is unchanged (block seeded, delete row only); `cascade: true` runs the policy + cascade below. Existing single-arg callers keep working.
- Policy (inside `delete`): block **only** when `row.seeded && jobCount === 0` (a true system seed with no distribution) → `TerminologyAdminError('This is a system-managed coding system and cannot be deleted.', 'conflict')`. Otherwise proceed.

- [ ] **Step 1: jobs store `listForCodingSystem` — failing test** in `packages/db/src/terminology-ingest-job-store.test.ts` (uses the file's `makeMigratedDb()` + `await db.destroy()` pattern)

```ts
it('listForCodingSystem returns all jobs for a coding system, newest first', async () => {
  const db = await makeMigratedDb();
  const store = createTerminologyIngestJobStore(db as never);
  await store.enqueue({ systemType: 'loinc', codingSystemId: 'cs-x', blobKey: 'k/a.zip', version: null, createdBy: null });
  const forX = await store.listForCodingSystem('cs-x');
  expect(forX).toHaveLength(1);
  expect(forX[0].blobKey).toBe('k/a.zip');
  expect(await store.listForCodingSystem('cs-none')).toEqual([]);
  await db.destroy();
});
```

- [ ] **Step 2: Run → fail.** `cd packages/db && npx vitest run src/terminology-ingest-job-store.test.ts` — FAIL (`listForCodingSystem` not a function).

- [ ] **Step 3: Add `listForCodingSystem`** to `packages/db/src/terminology-ingest-job-store.ts` — interface after `latestForSystem`, impl next to it:

```ts
    async listForCodingSystem(codingSystemId) {
      const rows = await db.selectFrom('terminology_ingest_jobs').selectAll()
        .where('coding_system_id', '=', codingSystemId).orderBy('created_at', 'desc').execute();
      return rows.map((r) => toJob(r as never));
    },
```
Interface line: `listForCodingSystem(codingSystemId: string): Promise<TerminologyIngestJob[]>;`. Add the stub `listForCodingSystem: async () => [],` to the `terminologyJobs` fake in `apps/server/src/test-helpers.ts`.

- [ ] **Step 4: Run → pass** the store test; **typecheck** `@openldr/db` + `@openldr/server`.

- [ ] **Step 5: admin `delete(id, opts)` cascade — failing test** in `packages/db/src/terminology-admin-store.test.ts` (reuse the file's real store construction — `createTerminologyAdminStore(db)` or `(db, undefined, referenceCapture)`; there is NO `fakeProjection`)

```ts
it('delete(id,{cascade}) removes an upload-created system + its concepts; protects a true seed', async () => {
  const db = await makeMigratedDb();
  const s = createTerminologyAdminStore(db);
  // upsertByUrl marks seeded=true (mirrors an uploaded system); give it a concept + an ingest job
  await s.codingSystems.upsertByUrl({ url: 'http://x.test', systemCode: 'X', systemName: 'X', systemVersion: null, publisherId: null });
  const id = (await s.codingSystems.getByUrl('http://x.test'))!.id;
  await db.insertInto('terminology_concepts').values({ system: 'http://x.test', code: 'a', display: 'A', status: 'ACTIVE' } as never).execute();
  await db.insertInto('terminology_ingest_jobs').values({ id: 'j1', system_type: 'loinc', coding_system_id: id, blob_key: 'k/a.zip', version: null, status: 'ready', active_key: null } as never).execute();
  // upload-created (has a job) → cascade delete succeeds and removes concepts
  await s.codingSystems.delete(id, { cascade: true });
  expect(await s.codingSystems.getByUrl('http://x.test')).toBeNull();
  const remaining = await db.selectFrom('terminology_concepts').selectAll().where('system','=','http://x.test').execute();
  expect(remaining).toHaveLength(0);

  // a true seed (seeded, NO ingest job) is protected
  await s.codingSystems.upsertByUrl({ url: 'http://seed.test', systemCode: 'SD', systemName: 'SD', systemVersion: null, publisherId: null });
  const seedId = (await s.codingSystems.getByUrl('http://seed.test'))!.id;
  await expect(s.codingSystems.delete(seedId, { cascade: true })).rejects.toThrow(/system-managed coding system/i);
  await db.destroy();
});
```

> Match the concept/job insert column names to the actual schema (read the migrations if a column is rejected). `upsertByUrl` sets `seeded:true`, which is why both test systems are seeded; the difference is the presence of an ingest job.

- [ ] **Step 6: Run → fail.** `cd packages/db && npx vitest run src/terminology-admin-store.test.ts` — FAIL (`delete` ignores `opts`; seeded guard throws for the upload-created one too).

- [ ] **Step 7: Rewrite `codingSystems.delete`** in `packages/db/src/terminology-admin-store.ts` (replace the current `async delete(id) { … }` at ~420):

```ts
      async delete(id, opts) {
        const row = await db.selectFrom('coding_systems').select(['seeded', 'url']).where('id', '=', id).executeTakeFirst();
        if (!row) throw new TerminologyAdminError(`coding system not found: ${id}`, 'not-found');
        const jobCount = Number(
          (await db.selectFrom('terminology_ingest_jobs').select((eb) => eb.fn.countAll<number>().as('n'))
            .where('coding_system_id', '=', id).executeTakeFirst())?.n ?? 0,
        );
        // A true system seed (seeded, no uploaded distribution) is never deletable. An upload-created
        // system (seeded but with an ingest job) is deletable via cascade.
        if (row.seeded && jobCount === 0) {
          throw new TerminologyAdminError('This is a system-managed coding system and cannot be deleted.', 'conflict');
        }
        await db.transaction().execute(async (trx) => {
          if (opts?.cascade) {
            if (row.url) await trx.deleteFrom('terminology_concepts').where('system', '=', row.url).execute();
            await trx.deleteFrom('terminology_ingest_jobs').where('coding_system_id', '=', id).execute();
          }
          await trx.deleteFrom('coding_systems').where('id', '=', id).execute();
          if (capture) await capture.record(trx, 'coding_system', id, 'delete', null);
        });
      },
```
Update the interface signature (`ManagedStore`/type for codingSystems): `delete(id: string, opts?: { cascade?: boolean }): Promise<void>;`.

- [ ] **Step 8: Run → pass** the admin-store test; **typecheck** `@openldr/db` + `@openldr/server`.

- [ ] **Step 9: Rewrite the DELETE route** — `apps/server/src/terminology-admin-routes.ts` (~104-111):

```ts
  app.delete('/api/terminology/systems/:id', MANAGE, async (req, reply) => {
    const id = (req.params as IdParam).id;
    try {
      const jobs = await ctx.terminologyJobs.listForCodingSystem(id);   // capture blob keys before deleting rows
      await admin.codingSystems.delete(id, { cascade: true });          // policy + cascade (concepts + job rows + system row); throws 'conflict' if protected
      await ctx.terminology.ontology.unlink(id).catch(() => {});        // ontology teardown (no-op if none)
      for (const j of jobs) { try { await ctx.blob.delete(j.blobKey); } catch { /* best-effort blob cleanup */ } }
      await recordAudit(ctx, req, { action: 'coding_system.delete', entityType: 'coding_system', entityId: id, before: null, after: null });
      reply.code(204); return null;
    } catch (e) { return mapErr(e, reply); }
  });
```

- [ ] **Step 10: Route test** — in `apps/server/src/terminology-admin-routes.test.ts`, add/adjust a test: deleting an upload-created system (fake `terminologyJobs.listForCodingSystem` returns one job) returns 204 and calls `blob.delete` with its key; a protected seed returns 409 with the "system-managed" message. Match the file's existing app-injection + fake-ctx pattern.

- [ ] **Step 11: Typecheck + tests + commit**

Run: `pnpm --filter @openldr/db typecheck && pnpm --filter @openldr/server typecheck && cd packages/db && npx vitest run src/terminology-ingest-job-store.test.ts src/terminology-admin-store.test.ts && cd ../../apps/server && npx vitest run src/terminology-admin-routes.test.ts`
Expected: clean + PASS.

```bash
git add packages/db/src/terminology-ingest-job-store.ts packages/db/src/terminology-ingest-job-store.test.ts packages/db/src/terminology-admin-store.ts packages/db/src/terminology-admin-store.test.ts apps/server/src/terminology-admin-routes.ts apps/server/src/terminology-admin-routes.test.ts apps/server/src/test-helpers.ts
git commit -m "feat(terminology): delete upload-created coding systems (cascade); protect true seeds"
```

---

## Task 3: Resume in-flight import polling on mount (fixes the stale ontology menu)

**REVISED after reading the code (the original "add a refetch on complete" is already implemented).** Facts:
- The poller ALREADY refreshes on completion: `startPollingImportJob`'s `poll()` (~368-393 in `Terminology.tsx`) calls `await reload()` when `job.status === 'ready'`, and `reload()` (~155-163) refetches `listOntologyDistributions()` → `setDistributions`. So a completion detected *while polling* enables "Browse ontology" correctly.
- The gap: polling is only started when an import is **queued in the current session** (an effect keyed on `distImportPublisherId`, ~line 397). There is **no mount-time resume**. A long import (RxNorm builds 72k nodes) that finishes after a page reload/navigation never triggers `reload()`, so the menu stays stale until a manual refresh — exactly the RxNorm-vs-fast-LOINC asymmetry the user saw.

**Fix:** on mount, for each distribution-capable publisher whose latest job is still in-flight (`queued`/`running`), resume `startPollingImportJob` so its completion refreshes the page. Uses the existing `publisherSystemType(publisher)` helper (maps `pub-loinc→loinc`, `pub-snomed-ct→snomed`, `pub-rxnorm→rxnorm`, else null).

**Files:**
- Modify: `apps/studio/src/pages/Terminology.tsx`
- Modify/add: `apps/studio/src/pages/Terminology.test.tsx` (or a focused new test)

- [ ] **Step 1: Confirm the shape.** Verify in `Terminology.tsx`: `reload()` refetches distributions (it does); `startPollingImportJob(publisherId, systemType)` exists (~368) and reloads on ready; `publisherSystemType(pub)` exists; `getTerminologyIngestJob(publisherId, systemType)` returns the latest job or throws/404s when none. The mount effect(s) (~168-176) only call `reload()` + set unmount cleanup — no poll resume.

- [ ] **Step 2: Write the failing test** in `apps/studio/src/pages/Terminology.test.tsx` (match the file's existing `vi.mock('../api', …)` harness). Mock so a distribution publisher (e.g. `pub-rxnorm`) has an in-flight job on mount that then completes:

```ts
// getTerminologyIngestJob: first call 'running', second call 'ready'
const getJob = vi.mocked(getTerminologyIngestJob);
getJob.mockResolvedValueOnce({ id: 'j', status: 'running', phase: null, processed: 0, total: null, error: null, version: null, finishedAt: null } as never)
      .mockResolvedValue({ id: 'j', status: 'ready', phase: null, processed: 1, total: 1, error: null, version: null, finishedAt: null } as never);
// render with a rxnorm publisher present in listPublishers mock
render(<TerminologyPage/>);   // match the file's actual render/wrapper
await waitFor(() => expect(getJob).toHaveBeenCalledWith('pub-rxnorm', 'rxnorm')); // mount RESUMED polling
// advance the 3s interval so the poll sees 'ready' and reloads
await act(async () => { vi.advanceTimersByTime(3100); await Promise.resolve(); });
await waitFor(() => expect(vi.mocked(listOntologyDistributions).mock.calls.length).toBeGreaterThan(1)); // reload() ran on completion
```

> Adapt render/wrapper, mock names, and timer handling to the file's existing patterns (it may or may not use fake timers — if not, drive the poll via its interval or extract the resume into a testable unit). The essential assertions: (a) mount calls `getTerminologyIngestJob` for the in-flight distribution publisher, (b) a subsequent `ready` triggers another `listOntologyDistributions`.

- [ ] **Step 3: Run → fail.** `cd apps/studio && npx vitest run src/pages/Terminology.test.tsx` — FAIL (mount does not resume polling; `getTerminologyIngestJob` not called on mount).

- [ ] **Step 4: Add the mount-resume effect.** Place it AFTER `startPollingImportJob` is defined (so it's in scope), matching the file's effect/deps conventions:

```tsx
// Resume polling any distribution import still in-flight when the page (re)mounts, so its completion
// refreshes the ontology menu (via reload()) even if the import outlived the session that started it.
useEffect(() => {
  if (publishers.length === 0) return;
  let cancelled = false;
  void (async () => {
    for (const pub of publishers) {
      const systemType = publisherSystemType(pub);
      if (!systemType) continue;
      if (importPollRef.current[pub.id]) continue; // already polling this publisher
      try {
        const job = await getTerminologyIngestJob(pub.id, systemType);
        if (cancelled || !importPollMountedRef.current) return;
        if (job.status === 'queued' || job.status === 'running') {
          setImportJobs((prev) => ({ ...prev, [pub.id]: job }));
          startPollingImportJob(pub.id, systemType);
        }
      } catch { /* no job for this system → nothing to resume */ }
    }
  })();
  return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps — startPollingImportJob/publisherSystemType are stable; resume keyed on publishers only
}, [publishers]);
```

> `publisherSystemType` returns the systemType or null; `getTerminologyIngestJob` throws/404s when there's no job (caught). If the studio package lint doesn't enforce `exhaustive-deps`, drop the disable comment.

- [ ] **Step 5: Run → pass.** `cd apps/studio && npx vitest run src/pages/Terminology.test.tsx`.

- [ ] **Step 6: Typecheck studio.** `pnpm --filter @openldr/studio typecheck` — clean.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/pages/Terminology.tsx apps/studio/src/pages/Terminology.test.tsx
git commit -m "fix(studio): resume in-flight terminology import polling on mount (refreshes ontology menu)"
```

---

## Task 4: Confirm dialog + danger zone for destructive actions

**Files:**
- Modify: `apps/studio/src/pages/Terminology.tsx`
- Modify/add: a Studio test asserting the stored-distribution delete confirms before calling the API

**Interfaces:**
- Reuse the existing `setConfirm({ title, confirmName, confirmLabel, summary, onConfirm })` helper (already used by `handlePublisherDelete`/`handleSystemDelete`).

- [ ] **Step 1: Route the stored-distribution delete through confirm.** Find the "Delete stored distribution" handler (the one calling `purgeTerminologyDistribution(publisherId, systemType)`, ~line 403). Wrap it in `setConfirm`:

```ts
const handleDistributionPurge = (publisherId: string, systemType: string, label: string): void => {
  setConfirm({
    title: 'Delete stored distribution',
    confirmName: label,                 // e.g. the system/publisher name shown
    confirmLabel: 'Delete',
    summary: (
      <span>
        Deletes the retained <b>{label}</b> distribution .zip. Already-ingested terms and ontology are <b>not</b> affected.
      </span>
    ),
    onConfirm: async () => {
      try {
        await purgeTerminologyDistribution(publisherId, systemType);
        setConfirm(null);
        toast.success('Stored distribution deleted.');   // sonner (Task 6 migrates the rest)
      } catch (e) { /* surface via the existing error path */ }
    },
  });
};
```

> If Task 6 (sonner) has not run yet, keep the existing `setToast` call here and let Task 6 migrate it; do not block on ordering. The essential change in THIS task is the `setConfirm` wrap.

- [ ] **Step 2: Move destructive items into a danger section.** For each menu that contains a destructive action — publisher (`handlePublisherDelete`, ~549), stored distribution (~567), code system (`handleSystemDelete`, ~619 and ~778) — ensure the destructive item is the **last** item, preceded by a `<DropdownMenuSeparator />`, and styled `className="text-destructive focus:text-destructive"`. The code-system Delete (~617) already has this class; extend the same treatment to "Delete stored distribution" and "Delete publisher", and reorder so each sits at the bottom of its menu.

- [ ] **Step 3: Surface the server message on delete failure.** `deleteCodingSystem` in `apps/studio/src/api.ts:802` currently throws `"delete system failed: ${r.status}"`, discarding the server's `{ error }` body — that's why the user saw a bare `409`. Change it to read the JSON error and throw it (mirror the other mutations):

```ts
export async function deleteCodingSystem(id: string): Promise<void> {
  const r = await authFetch(`/api/terminology/systems/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) {
    let msg = `delete system failed: ${r.status}`;
    try { const j = await r.json(); if (j?.error) msg = j.error; } catch { /* keep status fallback */ }
    throw new Error(msg);
  }
}
```

So a protected true-seed now shows "This is a system-managed coding system and cannot be deleted." and an upload-created system deletes successfully (Task 2's cascade). `handleSystemDelete` already renders the thrown message.

- [ ] **Step 4: Write/adjust the test.** Add a test that clicking "Delete stored distribution" opens the confirm dialog and does NOT call `purgeTerminologyDistribution` until confirm is clicked:

```ts
// adapt to the page's existing render/test harness
fireEvent.click(screen.getByText('Delete stored distribution'));
expect(purgeTerminologyDistribution).not.toHaveBeenCalled();
fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
await waitFor(() => expect(purgeTerminologyDistribution).toHaveBeenCalled());
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd apps/studio && npx vitest run src/pages/Terminology.*.test.tsx && cd ../.. && pnpm --filter @openldr/studio typecheck`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/pages/Terminology.tsx apps/studio/src/pages/*.test.tsx
git commit -m "feat(studio): confirm + danger-zone all destructive terminology actions"
```

---

## Task 5: Dropzone + upload progress bar

**Files:**
- Modify: `apps/studio/src/pages/Terminology.tsx` (the `ImportDistributionDialog`, ~1034-1075)
- Create (if missing): `apps/studio/src/components/ui/progress.tsx` (shadcn Progress)
- Add: a Studio test for the dropzone/progress rendering

**Interfaces:**
- `uploadTerminologyDistribution(..., onProgress)` is UNCHANGED (already XHR + `upload.onprogress`); the dialog already threads `setPct`. This task is UI only.

- [ ] **Step 1: Ensure a Progress primitive exists.** If `apps/studio/src/components/ui/progress.tsx` is absent, add the standard shadcn Progress (Radix `@radix-ui/react-progress`) — check `package.json` for the dep; if absent, implement a minimal div-based bar instead (no new dep): a track `<div>` with an inner `<div style={{ width: `${pct*100}%` }}>`. Prefer the minimal div bar to avoid adding a dependency.

- [ ] **Step 2: Write the failing test.** In a new `apps/studio/src/pages/ImportDistributionDialog.test.tsx` (or extend an existing page test), render the dialog and assert: (a) a dropzone with the browse copy is present (no bare `type="file"` visible label), (b) selecting a file shows its name + size, (c) when `busy` with `pct=0.5`, a progress bar at ~50% renders. Use a mocked `uploadTerminologyDistribution` that invokes `onProgress(0.5)`.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/studio && npx vitest run src/pages/ImportDistributionDialog.test.tsx`
Expected: FAIL — dropzone/progress-bar not present.

- [ ] **Step 4: Build the dropzone + progress bar.** Replace the `<Input id="distFile" type="file" … />` block (~1044-1047) with a dropzone, and the `Uploading… {pct}%` text (~1058) with a bar. Dropzone:

```tsx
// state: const inputRef = useRef<HTMLInputElement>(null); const [dragOver, setDragOver] = useState(false);
function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ['KB','MB','GB']; let v = n / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${u[i]}`;
}
// ...
<div className="space-y-1.5">
  <Label>Distribution .zip</Label>
  <div
    role="button" tabIndex={0}
    onClick={() => inputRef.current?.click()}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
    onDragLeave={() => setDragOver(false)}
    onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
    className={`flex flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 py-6 text-center text-xs
      ${dragOver ? 'border-primary bg-primary/5' : 'border-border'} cursor-pointer`}
  >
    <Plus className="h-5 w-5 text-muted-foreground" aria-hidden />
    {file
      ? <span className="text-foreground">{file.name} <span className="text-muted-foreground">({humanSize(file.size)})</span></span>
      : <span className="text-muted-foreground">Drag a distribution .zip here, or click to browse</span>}
    <input ref={inputRef} type="file" accept=".zip" className="sr-only"
      onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
  </div>
</div>
```

Progress bar (replaces the text at ~1058):

```tsx
{busy && (
  <div className="space-y-1">
    <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
      <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(pct * 100)}%` }} />
    </div>
    <div className="text-xs text-muted-foreground">Uploading… {Math.round(pct * 100)}%</div>
  </div>
)}
```

Import `Plus` from `lucide-react`. Keep the license checkbox + version input as-is.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/studio && npx vitest run src/pages/ImportDistributionDialog.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck studio**

Run: `pnpm --filter @openldr/studio typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/pages/Terminology.tsx apps/studio/src/pages/ImportDistributionDialog.test.tsx apps/studio/src/components/ui/progress.tsx 2>/dev/null; git add -A apps/studio/src
git commit -m "feat(studio): modern dropzone + live upload progress for terminology distributions"
```

---

## Task 6: Notification consolidation (sonner, drop the inline banner)

**Files:**
- Modify: `apps/studio/src/pages/Terminology.tsx`
- Modify: a Studio test asserting one start toast + no inline banner

**Interfaces:**
- Uses `import { toast } from 'sonner'` (already the app-wide mechanism; `<Toaster/>` is mounted in `App.tsx`).

- [ ] **Step 1: Migrate the custom banner to sonner.** The page has a custom `toast` state (`const [toast, setToast] = useState(...)`, ~151) rendered as an inline banner (~678). Replace all `setToast({ kind: 'ok'|'error', text })` call sites with sonner: `toast.success(text)` / `toast.error(text)`. Rename the sonner import to avoid the name clash with the local `toast` state — either remove the local state entirely (preferred) or `import { toast as sonner } from 'sonner'`. Preferred: **delete** the `toast`/`setToast` state and the inline banner render (~678), and call `toast.success(...)`/`toast.error(...)` from `'sonner'` directly.

- [ ] **Step 2: Remove the inline banner render** (~678, the `{toast && (…)}` block).

- [ ] **Step 3: Ensure one start toast, no page completion toast.** The import-start path (~396) fires `toast.success("Import started — you'll be notified when it completes.")` exactly once. Do NOT add a completion toast in the poller — completion is signalled by the notification poller's own sonner toast + the bell (verified: the notification system already toasts new bell notifications). The in-row `IMPORTING…` badge remains.

- [ ] **Step 4: Write/adjust the test.** Assert that starting an import calls `toast.success` once and renders no inline banner element. Mock `'sonner'` as the existing tests do (`vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))`).

```ts
// adapt to the page harness
await startImport();
expect(toast.success).toHaveBeenCalledTimes(1);
expect(screen.queryByText(/Import started/)).toBeNull(); // no inline banner; it's a toast now (mocked)
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd apps/studio && npx vitest run src/pages/Terminology.*.test.tsx src/pages/ImportDistributionDialog.test.tsx && cd ../.. && pnpm --filter @openldr/studio typecheck`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/pages/Terminology.tsx apps/studio/src/pages/*.test.tsx
git commit -m "refactor(studio): consolidate terminology import notifications on sonner + bell (drop inline banner)"
```

---

## Task 7: Full gate + live verification

**Files:** none (verification only)

- [ ] **Step 1: Full gate.** Run: `pnpm turbo run typecheck test --force`. Expected GREEN modulo known Windows parallel flakes; verify touched packages (`@openldr/bootstrap`, `@openldr/db`, `@openldr/studio`, `@openldr/server`) in isolation if the parallel run reds them.

- [ ] **Step 2: Rebuild + restart the live api/studio images.**

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml -p openldr-slice3 up -d --build api studio
```

- [ ] **Step 3: Live-verify SNOMED extract (the acceptance gate).** Re-run the ingest of the retained 554 MB SNOMED blob. Either re-upload via the UI, or re-enqueue the existing blob by inserting a job for its `blob_key`. Then:

```bash
docker exec openldr-slice3-postgres-1 psql -U openldr -d openldr -c \
  "select system_type,status,left(error,60),processed,total from terminology_ingest_jobs where system_type='snomed' order by created_at desc limit 1;"
```
Expected: `status = ready` (no `unexpected end of file`), concepts + `ontology_distributions` row for SNOMED.

- [ ] **Step 4: Live-verify the UX fixes.** In the browser (`https://localhost`, `labadmin`/`labadmin`): the dropzone shows drag/click + filename + a progress bar during upload; RxNorm/SNOMED "Browse ontology" enables right after completion without reload; "Delete stored distribution" prompts a confirm and sits in a red section; deleting the LOINC code system shows the actionable reason; starting an import shows one toast + a bell entry, no inline banner.

- [ ] **Step 5: Trailer scan.** Run: `git log --format='%b' <slice4-base>..HEAD | grep -in "co-authored-by\|claude\|codex" || echo CLEAN`. Expected `CLEAN`.

---

## Self-Review

**Spec coverage:** A→Task 1; B→Task 3; C(server msg)→Task 2, C(client confirm+danger+message)→Task 4; D→Task 5 (UI only — api already XHR+progress); E→Task 6. Live verification→Task 7. ✅

**Type/name consistency:** `downloadAndExtract` signature unchanged (Task 1). `codingSystems.delete` still `Promise<void>`, enriched throw only (Task 2). `uploadTerminologyDistribution(onProgress)` unchanged (Task 5 is UI). `setConfirm`/`setDistributions`/`getTerminologyIngestJob`/`listOntologyDistributions` are existing symbols reused verbatim.

**Placeholder scan:** the Task-1 test's first `zipFrom` sketch is explicitly replaced by the `makeZip` (python) helper — the implementer uses `makeZip`. UI edits give complete JSX; server edits give complete guard code. Fake/harness shapes (Tasks 2/3/4/6 tests) are flagged "match the file's existing setup" because the exact mock/harness must be read at implementation time; the behaviour to implement is fully specified.

**Ordering:** Tasks 3-6 all edit `Terminology.tsx` and run sequentially (subagent-driven runs one implementer at a time) — no parallel edit conflict. Task 4 and Task 6 both touch the delete/toast paths; Task 4 notes the sonner migration may land in Task 6 and not to block on ordering.
