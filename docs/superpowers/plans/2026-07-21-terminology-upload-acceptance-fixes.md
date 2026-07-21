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

## Task 2: Enrich the coding-system delete conflict message

**Files:**
- Modify: `packages/db/src/terminology-admin-store.ts` (the `codingSystems.delete(id)` impl)
- Modify: `packages/db/src/terminology-admin-store.test.ts`

**Interfaces:**
- `codingSystems.delete(id)` still returns `Promise<void>`; on a blocked delete it throws `TerminologyAdminError(message, 'conflict')` with an enriched, actionable `message`.

- [ ] **Step 1: Read the current guard.** Open `packages/db/src/terminology-admin-store.ts`, find `codingSystems: { … delete(id) { … } }`. Identify what it currently checks before deleting (concept rows and/or a linked ontology distribution) and the current throw. If it currently deletes without counting, add the counts.

- [ ] **Step 2: Write the failing test** — add to `packages/db/src/terminology-admin-store.test.ts` (match the file's existing `makeMigratedDb()` setup pattern)

```ts
it('codingSystems.delete throws an actionable conflict message when the system has concepts', async () => {
  const db = await makeMigratedDb();
  const admin = createTerminologyAdminStore(db as never, /* projection */ fakeProjection(), /* capture */ undefined as never);
  const cs = await admin.codingSystems.upsertByUrl({ url: 'http://x.test', systemCode: 'X', systemName: 'X', systemVersion: null, publisherId: null });
  // seed one concept for this system's url (match how the store counts — via terminology_concepts.system)
  await db.insertInto('terminology_concepts').values({ system: 'http://x.test', code: 'a', display: 'A', status: 'ACTIVE' } as never).execute();
  const id = (await admin.codingSystems.getByUrl('http://x.test'))!.id;
  await expect(admin.codingSystems.delete(id)).rejects.toThrow(/cannot delete .*concept|delete the .*distribution first/i);
  await db.destroy();
});
```

> Adapt `fakeProjection()`/constructor args to the file's existing test helpers (the file already constructs the admin store in other tests — reuse that exact call). Adapt the concept-seeding to how the store actually counts (by `system` url or by coding_system_id) — read the guard in Step 1 to match.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/db && npx vitest run src/terminology-admin-store.test.ts`
Expected: FAIL — the current message doesn't match the actionable pattern.

- [ ] **Step 4: Enrich the guard** — in `codingSystems.delete(id)`

Before deleting, resolve the system's `url`/code, count its concepts, and check for a linked ontology distribution (query `ontology_distributions` by `coding_system_id = id`). When either is non-empty, throw:

```ts
// inside delete(id), after loading the system row (call it `sys`):
const conceptCount = Number(
  (await db.selectFrom('terminology_concepts').select(({ fn }) => fn.countAll<string>().as('n'))
    .where('system', '=', sys.url).executeTakeFirst())?.n ?? 0,
);
const hasOntology = !!(await db.selectFrom('ontology_distributions').select('coding_system_id')
  .where('coding_system_id', '=', id).executeTakeFirst());
if (conceptCount > 0 || hasOntology) {
  const parts: string[] = [];
  if (conceptCount > 0) parts.push(`${conceptCount} concept(s)`);
  if (hasOntology) parts.push('a linked ontology distribution');
  throw new TerminologyAdminError(
    `Cannot delete coding system ${sys.systemCode}: it has ${parts.join(' and ')}. Delete the stored distribution first.`,
    'conflict',
  );
}
```

> Match `sys.url` / `sys.systemCode` to the actual row shape the store loads. If the store already loads the row for a not-found check, reuse it; otherwise select it first (throw `'not-found'` if absent, preserving existing behaviour).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/db && npx vitest run src/terminology-admin-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck db + server**

Run: `pnpm --filter @openldr/db typecheck && pnpm --filter @openldr/server typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/terminology-admin-store.ts packages/db/src/terminology-admin-store.test.ts
git commit -m "feat(terminology): actionable reason when a coding-system delete is blocked"
```

---

## Task 3: Refetch ontology distributions when an import completes

**Files:**
- Modify: `apps/studio/src/pages/Terminology.tsx` (the import-job poller, ~lines 371-391)
- Modify: a Studio test alongside (or add one) asserting the refetch on completion

**Interfaces:**
- Consumes existing `listOntologyDistributions()`, `listCodingSystems()`, `setDistributions`, `getTerminologyIngestJob`.

- [ ] **Step 1: Read the poller.** In `Terminology.tsx`, the `poll()` (~371) calls `getTerminologyIngestJob(publisherId, systemType)` every 3s and clears the badge on a terminal status. The initial load (~156-161) is the only place `setDistributions` runs, so a freshly-built ontology never refreshes.

- [ ] **Step 2: Write the failing test.** Add a focused test (in `apps/studio/src/pages/Terminology.test.tsx` or a new `Terminology.refetch.test.tsx`) that mounts the page (or the poller unit if extracted), mocks `getTerminologyIngestJob` to return `status: 'ready'`, and asserts `listOntologyDistributions` is called again after the job reaches `ready`. Mock the api module; match the file's existing test setup for this page.

```ts
// sketch — adapt to the page's existing test harness/mocks
expect(listOntologyDistributions).toHaveBeenCalledTimes(1); // initial load
// advance the poll; job returns 'ready'
await flushPollOnce();
expect(listOntologyDistributions).toHaveBeenCalledTimes(2); // refetched on completion
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/studio && npx vitest run src/pages/Terminology.refetch.test.tsx`
Expected: FAIL — refetch not wired (called once).

- [ ] **Step 4: Add the refetch.** In `poll()`, when the job reaches a terminal status (`ready` or `failed`), after clearing the badge, refetch distributions + coding systems and update state:

```ts
if (job.status === 'ready' || job.status === 'failed') {
  // ...existing badge-clear / interval-clear...
  if (job.status === 'ready') {
    const [systems, dists] = await Promise.all([listCodingSystems(), listOntologyDistributions()]);
    if (!cancelled()) {           // use the file's existing unmount guard
      setSystems(systems);        // match the page's coding-systems state setter name
      setDistributions(Object.fromEntries(dists.map((d) => [d.codingSystemId, d])));
    }
  }
}
```

> Use the page's actual state setters and unmount guard (there is an `importPollRef` + an unmount no-op guard around `getTerminologyIngestJob`). Do not introduce a second guard pattern.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/studio && npx vitest run src/pages/Terminology.refetch.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck studio**

Run: `pnpm --filter @openldr/studio typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/pages/Terminology.tsx apps/studio/src/pages/Terminology.refetch.test.tsx
git commit -m "fix(studio): refetch ontology distributions when a terminology import completes"
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

- [ ] **Step 3: Surface the enriched delete message.** `handleSystemDelete` already shows the server `error`. Confirm it renders the server message text (from Task 2) rather than a bare status — the client already receives `{ error }` and should display it. No 409-specific handling needed beyond showing the message.

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
