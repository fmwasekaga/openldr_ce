# Terminology Fresh-Install Coding-System Auto-Provision (Slice 1.1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator upload a LOINC distribution from the LOINC **publisher** with no pre-existing coding system — the distribution routes become publisher-scoped and the coding system is resolve-or-created server-side from a loader-backed canonical URL.

**Architecture:** A new `canonicalSystemUrl(systemType)` helper (single source of truth, reusing the loader's `LOINC_SYSTEM`) + a `codingSystems.getByUrl` store method let the reshaped `POST /api/terminology/publishers/:publisherId/distribution` route resolve-or-create the coding system with the exact same values `loadLoinc` uses (one row, no dupes) before enqueuing the job. The Studio moves "Import distribution…" to the always-enabled publisher-level menu.

**Tech Stack:** TypeScript, Fastify, Kysely, React + Vite + shadcn/ui, Vitest.

**Scope note:** This is **Slice 1.1**, a follow-up to Slice 1 (`docs/superpowers/plans/2026-07-20-terminology-distribution-upload-ingest-slice1.md`, merged local `main` `6f6c91b6`). Spec: `docs/superpowers/specs/2026-07-21-terminology-fresh-install-coding-system-design.md`. Generic plumbing, LOINC-only enablement (SNOMED/RxNorm inherit in Slice 2).

## Global Constraints

- Gate: `pnpm turbo run typecheck test --force` (never pipe turbo through `tail`; bootstrap/db/server parallel flakes pass in isolation — verify with the package's own `vitest run`).
- The coding-system the route pre-creates MUST use the SAME `url`/`systemCode`/`publisherId` values `loadLoinc`'s `saveSystem` uses, so it is one row: `url = canonicalSystemUrl('loinc') = LOINC_SYSTEM = 'http://loinc.org'`, `systemCode = deriveSystemCode(url)`, `publisherId = resolveSeedPublisherId(url)`.
- `SUPPORTED_SYSTEMS` stays `new Set(['loinc'])`. `canonicalSystemUrl` has `snomed`/`rxnorm` entries (generic) but they are gated off.
- Slice 1 is UNPUSHED → replace the `/systems/:id/distribution` routes and their clients outright (no back-compat).
- No Claude/Codex co-author trailer.

---

### Task 1: `canonicalSystemUrl(systemType)` helper

**Files:**
- Modify: `packages/terminology/src/loaders/loinc.ts` (export `LOINC_SYSTEM`)
- Create: `packages/terminology/src/system-urls.ts`
- Modify: `packages/terminology/src/index.ts` (export it)
- Test: `packages/terminology/src/system-urls.test.ts`

**Interfaces:**
- Produces: `type SupportedSystemType = 'loinc' | 'snomed' | 'rxnorm'`; `canonicalSystemUrl(systemType: string): string | null`. Consumed by Task 3.

- [ ] **Step 1: Export `LOINC_SYSTEM` from the loader**

In `packages/terminology/src/loaders/loinc.ts` line 8, change `const LOINC_SYSTEM = 'http://loinc.org';` to:

```ts
export const LOINC_SYSTEM = 'http://loinc.org';
```

- [ ] **Step 2: Write the failing test**

Create `packages/terminology/src/system-urls.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canonicalSystemUrl } from './system-urls';
import { LOINC_SYSTEM } from './loaders/loinc';

describe('canonicalSystemUrl', () => {
  it('returns the loader LOINC_SYSTEM constant for loinc (same value, single source of truth)', () => {
    expect(canonicalSystemUrl('loinc')).toBe('http://loinc.org');
    expect(canonicalSystemUrl('loinc')).toBe(LOINC_SYSTEM);
  });
  it('has snomed/rxnorm canonical urls (generic, gated off elsewhere)', () => {
    expect(canonicalSystemUrl('snomed')).toBe('http://snomed.info/sct');
    expect(canonicalSystemUrl('rxnorm')).toBe('http://www.nlm.nih.gov/research/umls/rxnorm');
  });
  it('returns null for an unknown system type', () => {
    expect(canonicalSystemUrl('nope')).toBeNull();
    expect(canonicalSystemUrl('')).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/terminology && npx vitest run src/system-urls.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `packages/terminology/src/system-urls.ts`:

```ts
import { LOINC_SYSTEM } from './loaders/loinc';

export type SupportedSystemType = 'loinc' | 'snomed' | 'rxnorm';

// Canonical coding-system URL per system type. loinc REUSES the loader's LOINC_SYSTEM constant so the
// distribution route and loadLoinc provably create/resolve the SAME coding-system row. snomed/rxnorm
// entries are the generic wiring for Slice 2 (their loaders should reference these too); note SNOMED's
// canonical url ('.../sct') differs from the publisher matchPrefix ('http://snomed.info/'), which is
// exactly why the URL comes from here, not the publisher.
const CANONICAL_SYSTEM_URL: Record<SupportedSystemType, string> = {
  loinc: LOINC_SYSTEM,
  snomed: 'http://snomed.info/sct',
  rxnorm: 'http://www.nlm.nih.gov/research/umls/rxnorm',
};

export function canonicalSystemUrl(systemType: string): string | null {
  return (CANONICAL_SYSTEM_URL as Record<string, string>)[systemType] ?? null;
}
```

- [ ] **Step 5: Export it**

Edit `packages/terminology/src/index.ts`, add: `export * from './system-urls';`

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/terminology && npx vitest run src/system-urls.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/terminology/src/loaders/loinc.ts packages/terminology/src/system-urls.ts packages/terminology/src/system-urls.test.ts packages/terminology/src/index.ts
git commit -m "feat(terminology): canonicalSystemUrl(systemType) helper (reuses loader LOINC_SYSTEM)"
```

---

### Task 2: `codingSystems.getByUrl` store method

**Files:**
- Modify: `packages/db/src/terminology-admin-store.ts` (interface + impl)
- Test: `packages/db/src/terminology-admin-store.test.ts` (extend; create if absent)

**Interfaces:**
- Produces: `TerminologyAdminStore.codingSystems.getByUrl(url: string): Promise<CodingSystem | null>`. Consumed by Task 3.

- [ ] **Step 1: Add to the interface**

In `packages/db/src/terminology-admin-store.ts`, in the `codingSystems` interface block (after `upsertByUrl(...)`, ~line 18), add:

```ts
    getByUrl(url: string): Promise<CodingSystem | null>;
```

- [ ] **Step 2: Write the failing test**

Add to `packages/db/src/terminology-admin-store.test.ts` (use the migrated-db harness the file already uses; if the file doesn't exist, create it mirroring another store test's `makeMigratedDb` setup):

```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createTerminologyAdminStore } from './terminology-admin-store';

describe('codingSystems.getByUrl', () => {
  it('returns the coding system for a known url, null when absent', async () => {
    const db = await makeMigratedDb();
    const store = createTerminologyAdminStore(db as never);
    expect(await store.codingSystems.getByUrl('http://loinc.org')).toBeNull();
    await store.codingSystems.upsertByUrl({ url: 'http://loinc.org', systemCode: 'LOINC', systemName: 'LOINC', systemVersion: null, publisherId: 'pub-loinc' });
    const cs = await store.codingSystems.getByUrl('http://loinc.org');
    expect(cs?.url).toBe('http://loinc.org');
    expect(cs?.systemCode).toBe('LOINC');
    await db.destroy();
  });
});
```

Note: `createTerminologyAdminStore` is the store factory — confirm its exact name/signature at the top of `terminology-admin-store.ts` and match it (it may take `(db, projection?, capture?)`; pass only `db` if the others are optional, else stub them as the other tests in the repo do).

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/db && npx vitest run src/terminology-admin-store.test.ts -t getByUrl`
Expected: FAIL — `getByUrl is not a function`.

- [ ] **Step 4: Implement**

In the `codingSystems` implementation object (right after the `upsertByUrl` method that ends ~line 454), add — mirroring `valueSets.getByUrl` and reusing the existing `csRow` mapper used by `codingSystems.list`:

```ts
      async getByUrl(url) {
        const r = await db.selectFrom('coding_systems').selectAll().where('url', '=', url).executeTakeFirst();
        return r ? csRow(r) : null;
      },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/db && npx vitest run src/terminology-admin-store.test.ts -t getByUrl`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/terminology-admin-store.ts packages/db/src/terminology-admin-store.test.ts
git commit -m "feat(db): codingSystems.getByUrl on the terminology admin store"
```

---

### Task 3: Publisher-scoped distribution routes + resolve-or-create

**Files:**
- Modify: `apps/server/src/terminology-admin-routes.ts` (imports + replace the 3 distribution routes)
- Modify: `apps/server/src/terminology-admin-routes.test.ts` (fake ctx + rewrite the distribution tests)

**Interfaces:**
- Consumes: `canonicalSystemUrl` (Task 1), `codingSystems.getByUrl`/`upsertByUrl` (Task 2), `deriveSystemCode`/`resolveSeedPublisherId` (`@openldr/db`).
- Produces routes: `POST/GET/DELETE /api/terminology/publishers/:publisherId/distribution`.

- [ ] **Step 1: Add imports**

In `apps/server/src/terminology-admin-routes.ts`:
- Add `canonicalSystemUrl` to the existing `@openldr/terminology` import (line 8): e.g. `import { canonicalSystemUrl, isFhirValueSetCatalog, parseTerminologyTerms, parseTerminologyTermsStream, terminologyImportTemplate } from '@openldr/terminology';`
- Add a new import: `import { deriveSystemCode, resolveSeedPublisherId } from '@openldr/db';`

- [ ] **Step 2: Rewrite the distribution tests (RED)**

In `apps/server/src/terminology-admin-routes.test.ts`, extend `fakeCtx()`'s `admin.codingSystems` with resolve-or-create fakes and a `ctxState.codingSystem` slot. In the `admin.codingSystems` object add:

```ts
      getByUrl: async (_url: string) => ctxState.codingSystem,
      upsertByUrl: async (input: any) => { ctxState.codingSystem = { id: 'cs-url-LOINC', url: input.url, systemCode: input.systemCode, systemName: input.systemName, publisherId: input.publisherId, systemVersion: input.systemVersion ?? null, active: true, seeded: true, description: null }; ctxState.upserts.push(input); },
```

and initialise `ctxState` with `codingSystem: null as any, upserts: [] as any[]` (alongside the existing `enqueued/put/deleted/active/latest`).

Replace the `describe('terminology distribution upload/status/purge', …)` block with:

```ts
describe('terminology distribution upload/status/purge (publisher-scoped)', () => {
  it('resolve-or-CREATES the coding system then enqueues (201) when none exists', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.codingSystem = null;
    const app = appWith(ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/terminology/publishers/pub-loinc/distribution?systemType=loinc&acceptLicense=true&version=2.82',
      headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('PK-fake-zip'),
    });
    expect(res.statusCode).toBe(201);
    expect(ctxState.upserts[0]).toMatchObject({ url: 'http://loinc.org', systemCode: 'LOINC', publisherId: 'pub-loinc' });
    expect(ctxState.enqueued[0]).toMatchObject({ systemType: 'loinc', codingSystemId: 'cs-url-LOINC', version: '2.82' });
    expect(res.json().jobId).toBe('tij_1');
  });

  it('REUSES an existing coding system (no upsert) and enqueues', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.codingSystem = { id: 'cs-existing', url: 'http://loinc.org', systemCode: 'LOINC' };
    const app = appWith(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/terminology/publishers/pub-loinc/distribution?systemType=loinc&acceptLicense=true', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
    expect(res.statusCode).toBe(201);
    expect(ctxState.upserts.length).toBe(0);
    expect(ctxState.enqueued[0].codingSystemId).toBe('cs-existing');
  });

  it('rejects a missing license (400) and never stores', async () => {
    const { ctx, ctxState } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/terminology/publishers/pub-loinc/distribution?systemType=loinc&acceptLicense=false', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
    expect(res.statusCode).toBe(400);
    expect(ctxState.put.length).toBe(0);
  });

  it('rejects a non-loinc systemType (400)', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/terminology/publishers/pub-snomed-ct/distribution?systemType=snomed&acceptLicense=true', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
    expect(res.statusCode).toBe(400);
  });

  it('rejects when a job is already active (409)', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.active = true;
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/terminology/publishers/pub-loinc/distribution?systemType=loinc&acceptLicense=true', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
    expect(res.statusCode).toBe(409);
  });

  it('GET job returns the latest job', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.latest = { id: 'tij_1', status: 'ready', phase: null, processed: 5, total: 5, error: null, version: '2.82', finishedAt: 'now' };
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/terminology/publishers/pub-loinc/distribution/job?systemType=loinc' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ready', processed: 5 });
  });

  it('DELETE purges the retained blob', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.latest = { id: 'tij_1', status: 'ready', blobKey: 'terminology-dist/loinc/tij_1.zip', codingSystemId: 'cs-existing' };
    const res = await appWith(ctx).inject({ method: 'DELETE', url: '/api/terminology/publishers/pub-loinc/distribution?systemType=loinc' });
    expect(res.statusCode).toBe(204);
    expect(ctxState.deleted).toEqual(['terminology-dist/loinc/tij_1.zip']);
  });

  it('a lab_technician is rejected (403) on upload', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx, ['lab_technician']).inject({ method: 'POST', url: '/api/terminology/publishers/pub-loinc/distribution?systemType=loinc&acceptLicense=true', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/server && npx vitest run src/terminology-admin-routes.test.ts`
Expected: FAIL — new publisher-scoped routes 404.

- [ ] **Step 4: Replace the 3 routes**

In `apps/server/src/terminology-admin-routes.ts`, replace the block from `app.post('/api/terminology/systems/:id/distribution', …)` through the closing of the DELETE route (currently lines 384–432) with:

```ts
  // Resolve the coding system for a systemType by its loader-backed canonical URL, creating it if
  // absent with the SAME values loadLoinc's saveSystem uses (so it is one row, not a duplicate).
  async function resolveCodingSystemId(systemType: string, version: string | null): Promise<string> {
    const url = canonicalSystemUrl(systemType)!; // callers validate systemType is supported → non-null
    let cs = await admin.codingSystems.getByUrl(url);
    if (!cs) {
      await admin.codingSystems.upsertByUrl({
        url, systemCode: deriveSystemCode(url), systemName: deriveSystemCode(url),
        systemVersion: version, publisherId: resolveSeedPublisherId(url),
      });
      cs = await admin.codingSystems.getByUrl(url);
    }
    return cs!.id;
  }

  app.post('/api/terminology/publishers/:publisherId/distribution', UPLOAD, async (req, reply) => {
    const publisherId = (req.params as { publisherId: string }).publisherId;
    const q = req.query as { systemType?: string; acceptLicense?: string; version?: string };
    const systemType = String(q.systemType ?? '');
    if (!SUPPORTED_SYSTEMS.has(systemType) || !canonicalSystemUrl(systemType)) { reply.code(400); return { error: `unsupported systemType: ${systemType || '(missing)'}` }; }
    if (q.acceptLicense !== 'true') { reply.code(400); return { error: 'the distribution license must be accepted' }; }
    if (await ctx.terminologyJobs.hasActive(systemType)) { reply.code(409); return { error: `an import for ${systemType} is already in progress` }; }
    if (!isReadableBody(req.body)) { reply.code(400); return { error: 'expected a zip stream (application/octet-stream)' }; }

    let codingSystemId: string;
    try { codingSystemId = await resolveCodingSystemId(systemType, q.version ?? null); }
    catch (e) { return mapErr(e, reply); }

    const key = `terminology-dist/${systemType}/${codingSystemId}-${Date.now()}.zip`;
    try { await ctx.blob.putStream(key, req.body as NodeJS.ReadableStream as never, 'application/zip'); }
    catch (e) { return mapErr(e, reply); }

    const job = await ctx.terminologyJobs.enqueue({ systemType, codingSystemId, blobKey: key, version: q.version ?? null, createdBy: req.user?.id ?? null });
    await recordAudit(ctx, req, { action: 'terminology.distribution.uploaded', entityType: 'coding_system', entityId: codingSystemId, before: null, after: null, metadata: { publisherId, systemType, version: q.version ?? null, jobId: job.id } });
    reply.code(201);
    return { jobId: job.id };
  });

  // Publisher-scoped path; the job itself is systemType-scoped (one active/latest per system), so
  // `latestForSystem` resolves the job regardless of the :publisherId (which is the UI's navigational
  // context + audit subject).
  app.get('/api/terminology/publishers/:publisherId/distribution/job', MANAGE, async (req, reply) => {
    const q = req.query as { systemType?: string };
    const systemType = String(q.systemType ?? 'loinc');
    const job = await ctx.terminologyJobs.latestForSystem(systemType);
    if (!job) { reply.code(404); return { error: 'no import job for this system' }; }
    return { id: job.id, status: job.status, phase: job.phase, processed: job.processed, total: job.total, error: job.error, version: job.version, finishedAt: job.finishedAt };
  });

  app.delete('/api/terminology/publishers/:publisherId/distribution', MANAGE, async (req, reply) => {
    const publisherId = (req.params as { publisherId: string }).publisherId;
    const q = req.query as { systemType?: string };
    const systemType = String(q.systemType ?? 'loinc');
    const job = await ctx.terminologyJobs.latestForSystem(systemType);
    if (job?.blobKey) {
      try { await ctx.blob.delete(job.blobKey); } catch (e) { return mapErr(e, reply); }
    }
    await recordAudit(ctx, req, { action: 'terminology.distribution.purged', entityType: 'coding_system', entityId: job?.codingSystemId ?? publisherId, before: null, after: null, metadata: { systemType, jobId: job?.id ?? null } });
    reply.code(204);
    return null;
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/server && npx vitest run src/terminology-admin-routes.test.ts`
Expected: PASS (all — new distribution tests + the untouched publisher/system/valueset tests). Also run `npx tsc --noEmit` in `apps/server` → clean.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/terminology-admin-routes.ts apps/server/src/terminology-admin-routes.test.ts
git commit -m "feat(server): publisher-scoped distribution routes + resolve-or-create coding system"
```

---

### Task 4: Studio — publisher-scoped upload UI

**Files:**
- Modify: `apps/studio/src/api.ts` (3 client fns → publisherId + new path)
- Modify: `apps/studio/src/pages/Terminology.tsx` (publisher-scoped dialog/menu/polling; drop the disabled-until-coding-system gate; remove the system-row/Term-submenu distribution items)
- Modify: `apps/studio/src/api.terminology-upload.test.ts` (path/query assertions)
- Modify: `apps/studio/src/pages/Terminology.test.tsx` (enabled-on-fresh-install + publisherId assertions)

**Interfaces:**
- Consumes: Task 3 routes.

- [ ] **Step 1: Change the api client (RED for its test)**

In `apps/studio/src/api.ts` replace the three fns (currently ~lines 869–903) — change the first param to `publisherId` and the path to `/publishers/${publisherId}/distribution`:

```ts
export function uploadTerminologyDistribution(
  publisherId: string, systemType: string, file: File, acceptLicense: boolean, version: string | null,
  onProgress?: (fraction: number) => void,
): Promise<{ jobId: string }> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ systemType, acceptLicense: String(acceptLicense) });
    if (version) params.set('version', version);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/terminology/publishers/${encodeURIComponent(publisherId)}/distribution?${params.toString()}`);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({ jobId: '' }); }
      } else {
        let msg = `upload failed (${xhr.status})`;
        try { const j = JSON.parse(xhr.responseText); if (j?.error) msg = j.error; } catch { /* ignore */ }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('network error during upload'));
    xhr.send(file);
  });
}

export const getTerminologyIngestJob = (publisherId: string, systemType: string): Promise<TerminologyIngestJobView> =>
  authFetch(`/api/terminology/publishers/${encodeURIComponent(publisherId)}/distribution/job?systemType=${systemType}`)
    .then((r) => okJson<TerminologyIngestJobView>(r, 'get import job'));

export const purgeTerminologyDistribution = (publisherId: string, systemType: string): Promise<void> =>
  authFetch(`/api/terminology/publishers/${encodeURIComponent(publisherId)}/distribution?systemType=${systemType}`, { method: 'DELETE' }).then(() => undefined);
```

- [ ] **Step 2: Update the api upload test (RED→GREEN)**

In `apps/studio/src/api.terminology-upload.test.ts`, change the call + assertions:

```ts
    const res = await uploadTerminologyDistribution('pub-loinc', 'loinc', file, true, '2.82');
    ...
    expect(xhr.url).toContain('/api/terminology/publishers/pub-loinc/distribution');
    expect(xhr.url).toContain('systemType=loinc');
    expect(xhr.url).toContain('acceptLicense=true');
    expect(xhr.url).toContain('version=2.82');
    expect(xhr.headers['content-type']).toBe('application/octet-stream');
```

Run: `cd apps/studio && npx vitest run src/api.terminology-upload.test.ts` → PASS.

- [ ] **Step 3: Rewire Terminology.tsx to publisher-scoping**

Make these edits in `apps/studio/src/pages/Terminology.tsx`:

(a) State: replace `distImportSystem` (a `CodingSystem`) with a publisher id + name. Where `distImportSystem` is declared, use:

```tsx
  const [distImportPublisherId, setDistImportPublisherId] = useState<string | null>(null);
```

(b) `openDistImport` (lines 361–365) → take a publisher id:

```tsx
  const openDistImport = (publisherId: string | null): void => {
    if (!publisherId) return;
    setDistImportPublisherId(publisherId);
    setDistImportOpen(true);
  };
```

(c) Publisher-level menu (lines 557–567) → always enabled, pass the publisher id; keep both items here and REMOVE the other two distribution sites (Term sub-menu lines ~648–655 and per-row lines ~768–772 — delete those two "Import distribution..." items):

```tsx
                      {isLoincPublisher(activeSection.publisher) && !selectedSystem && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => openDistImport(activeSection.publisher.id)}>
                            Import distribution...
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void handlePurgeDistribution(activeSection.publisher.id)}>
                            Delete stored distribution
                          </DropdownMenuItem>
                        </>
                      )}
```

(d) `handlePurgeDistribution` (lines 399–407) → take a publisher id:

```tsx
  const handlePurgeDistribution = async (publisherId: string | null): Promise<void> => {
    if (!publisherId) return;
    try {
      await purgeTerminologyDistribution(publisherId, 'loinc');
      setToast({ kind: 'ok', text: 'Stored distribution deleted.' });
    } catch (e: unknown) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };
```

(e) Polling `startPollingImportJob` (lines 367–391) → key by publisher id:

```tsx
  const startPollingImportJob = (publisherId: string): void => {
    const existing = importPollRef.current[publisherId];
    if (existing) clearInterval(existing);
    const poll = async (): Promise<void> => {
      try {
        const job = await getTerminologyIngestJob(publisherId, 'loinc');
        if (!importPollMountedRef.current) return;
        setImportJobs((prev) => ({ ...prev, [publisherId]: job }));
        if (job.status === 'ready' || job.status === 'failed') {
          clearInterval(importPollRef.current[publisherId]);
          delete importPollRef.current[publisherId];
          if (job.status === 'ready') {
            await reload();
            if (!importPollMountedRef.current) return;
          }
        }
      } catch {
        if (!importPollMountedRef.current) return;
        clearInterval(importPollRef.current[publisherId]);
        delete importPollRef.current[publisherId];
      }
    };
    void poll();
    importPollRef.current[publisherId] = setInterval(() => void poll(), 3000);
  };
```

(f) `handleDistributionQueued` (lines 393–397) → poll by the publisher id:

```tsx
  const handleDistributionQueued = (_jobId: string): void => {
    setDistImportOpen(false);
    setToast({ kind: 'ok', text: "Import started — you’ll be notified when it completes." });
    if (distImportPublisherId) startPollingImportJob(distImportPublisherId);
  };
```

(g) `activeImportJob` derivation (line 202) → key by the active publisher id:

```tsx
  const activeImportJob = activeSection ? importJobs[activeSection.publisher.id] : null;
```

(h) The dialog mount (lines 978–984) → pass `publisherId`:

```tsx
        <ImportDistributionDialog
          open={distImportOpen}
          onOpenChange={setDistImportOpen}
          publisherId={distImportPublisherId ?? ''}
          systemType="loinc"
          onQueued={(jobId) => handleDistributionQueued(jobId)}
        />
```

(i) `ImportDistributionDialog` (lines 1023–1042) → prop `publisherId` instead of `codingSystemId`, and the upload call uses it:

```tsx
function ImportDistributionDialog({ open, onOpenChange, publisherId, systemType, onQueued }: {
  open: boolean; onOpenChange: (v: boolean) => void; publisherId: string; systemType: string; onQueued: (jobId: string) => void;
}): JSX.Element {
  // ...unchanged state...
  const handleImport = async (): Promise<void> => {
    if (!canImport || !file) return;
    setBusy(true); setError(null);
    try {
      const { jobId } = await uploadTerminologyDistribution(publisherId, systemType, file, accepted, version.trim() || null, setPct);
      onQueued(jobId);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  // ...unchanged JSX...
}
```

(j) Remove the now-unused `loincSystemInSection` if nothing else references it after the deletions (line 201 + its uses in the removed items). If other code still uses it, leave it; otherwise delete the declaration to keep tsc clean.

- [ ] **Step 4: Update Terminology.test.tsx**

Two changes in `apps/studio/src/pages/Terminology.test.tsx`:
- The upload test (lines ~186–206): it opens "Import distribution..." from the **publisher** menu now (the row-level item is gone). Change the assertion to the publisher id:

```tsx
    await waitFor(() => expect(uploadSpy).toHaveBeenCalledWith('pub-loinc', 'loinc', file, true, null, expect.any(Function)));
```

(If the test previously clicked the *row* actions to find the item, point it at the publisher-level ⋯ menu — the item still reads "Import distribution...". Keep the file-select + accept + "Upload & import" steps.)

- The disabled-item test (lines 208–223) becomes an **enabled-on-fresh-install** test — with `listCodingSystems` mocked empty, the publisher-level "Import distribution..." is now ENABLED and opens the dialog:

```tsx
  it('enables the publisher-level "Import distribution..." even when no LOINC code system exists yet', async () => {
    vi.spyOn(api, 'listCodingSystems').mockResolvedValue([] as never);
    vi.spyOn(api, 'uploadTerminologyDistribution').mockResolvedValue({ jobId: 'tij_1' });
    render(<MemoryRouter><Terminology /></MemoryRouter>);
    await screen.findByText(/No code systems or value sets yet/i);
    const actions = await screen.findByRole('button', { name: /actions/i });
    fireEvent.pointerDown(actions, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Import distribution...')) fireEvent.keyDown(actions, { key: 'Enter' });
    fireEvent.click(await screen.findByText('Import distribution...'));
    // Dialog opens now (no coding system required).
    expect(await screen.findByLabelText('Distribution .zip')).toBeInTheDocument();
  });
```

- [ ] **Step 5: Run the studio tests + typecheck**

Run: `cd apps/studio && npx vitest run src/api.terminology-upload.test.ts src/pages/Terminology.test.tsx && npx tsc --noEmit`
Expected: PASS + clean tsc. (If tsc flags an unused `loincSystemInSection` or `isLoincSystem`, remove the now-dead declaration.)

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/pages/Terminology.tsx apps/studio/src/api.terminology-upload.test.ts apps/studio/src/pages/Terminology.test.tsx
git commit -m "feat(studio): publisher-scoped terminology distribution upload (enabled on fresh install)"
```

---

### Task 5: Full-gate verification

- [ ] **Step 1: Run the whole gate**

Run: `pnpm turbo run typecheck test --force`
Expected: PASS. If `@openldr/bootstrap`/`db`/`server` show a parallel flake, re-run that package with `npx vitest run` (or `--concurrency=1`) to confirm green in isolation (per [[repo-conventions]]).

- [ ] **Step 2: Commit any drift**

```bash
git add -A && git commit -m "chore: terminology fresh-install coding-system — gate green" || echo "nothing to commit"
```

## Self-Review notes (addressed)

- **Spec coverage:** §4a canonicalSystemUrl → Task 1; §4b getByUrl → Task 2; §4c publisher-scoped routes + resolve-or-create → Task 3; §4d Studio → Task 4.
- **One-row guarantee:** Task 3's `resolveCodingSystemId` uses `canonicalSystemUrl('loinc') = LOINC_SYSTEM` + `deriveSystemCode(url)` + `resolveSeedPublisherId(url)` — the exact tuple `loadLoinc`'s `saveSystem` upserts, so pre-create + loader-upsert converge on one row.
- **Type consistency:** `canonicalSystemUrl` (Task 1) is consumed by Task 3; `codingSystems.getByUrl` (Task 2) returns `CodingSystem | null` used by Task 3's resolve; the api client's `publisherId` first-arg (Task 4) matches the route's `:publisherId` (Task 3).
- **Gating:** `SUPPORTED_SYSTEMS` stays `{loinc}`; SNOMED/RxNorm 400 at the route and are absent from the UI (only `isLoincPublisher` shows the item).
