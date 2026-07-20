# Terminology Distribution Upload + Ingest — Slice 1 (LOINC end-to-end) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the server-filesystem-path LOINC import with a browser **upload** of a distribution `.zip` to the blob store, ingested **once** by a background job into **both** the flat `terminology_concepts` table **and** the ontology tree, with a completion notification.

**Architecture:** Browser streams the zip to an authenticated API route that pipes it straight into the S3/MinIO blob store and enqueues a `terminology_ingest_jobs` row. A background worker (mirroring `projection-worker`) streams the zip back down, extracts it to a temp dir, orchestrates the existing `loadLoinc` (concepts) + `buildOntologyDistribution` (tree) over that one dir, records an `audit_events` row on finish, and deletes the previous retained zip. The existing notification read-model surfaces the audit row on the bell.

**Tech Stack:** TypeScript, Fastify, Kysely (Postgres), `@aws-sdk/client-s3` + `@aws-sdk/lib-storage`, `unzipper`, React + Vite + shadcn/ui, Vitest.

**Scope note:** This plan is **Slice 1** of the 3-slice spec (`docs/superpowers/specs/2026-07-20-terminology-distribution-upload-ingest-design.md`). It delivers the whole pipeline working end-to-end **for LOINC** (which already has both a term loader and an ontology adapter, so it proves every layer). **Slice 2** (SNOMED/RxNorm flat-term extraction) and **Slice 3** (CLI parity, crash-recovery, legacy-route removal) get their own plans once these interfaces are real.

## Global Constraints

- **Monorepo gate:** `pnpm turbo run typecheck test --force` must pass. Never pipe turbo through `tail`. Known bootstrap parallel-flake — verify a failing package with its own `vitest run`.
- **RBAC:** every mutating terminology route is gated by `const MANAGE = { preHandler: requireRole('lab_admin', 'lab_manager') }` (already defined in `apps/server/src/terminology-admin-routes.ts:13`).
- **Provider-agnostic storage:** ingest code depends only on `BlobStoragePort`, never on MinIO/S3 directly.
- **Errors surfaced to users run through `redact(...)` from `@openldr/core`** (may carry connection strings).
- **i18n parity:** any key added to `apps/studio/src/i18n/en.ts` MUST be added at the identical path to `fr.ts` and `pt.ts` (`apps/studio/src/i18n/parity.test.ts` enforces exact key-set equality).
- **No Claude/Codex co-author trailer on commits.**
- **AWS SDK version pin:** new `@aws-sdk/*` deps use `^3.717.0` to match existing `@aws-sdk/client-s3`.
- **System type for Slice 1 is `'loinc'` only.** Routes/worker accept `systemType` but reject non-`loinc` with a clear error (Slice 2 lifts this).

---

### Task 1: Streaming blob I/O (`putStream` / `getStream` / `delete`)

**Files:**
- Modify: `packages/ports/src/blob.ts`
- Modify: `packages/adapter-s3-bucket/src/index.ts`
- Modify: `packages/adapter-s3-bucket/package.json`
- Test: `packages/adapter-s3-bucket/src/index.test.ts` (extend existing; create if absent)

**Interfaces:**
- Produces: `BlobStoragePort.putStream(key: string, body: Readable, contentType?: string): Promise<void>`, `BlobStoragePort.getStream(key: string): Promise<Readable>`, `BlobStoragePort.delete(key: string): Promise<void>`.
- Consumes: nothing (leaf).

- [ ] **Step 1: Add streaming deps to the adapter**

Edit `packages/adapter-s3-bucket/package.json` `dependencies` (keep alphabetical-ish next to the existing aws entries):

```json
"@aws-sdk/client-s3": "^3.717.0",
"@aws-sdk/lib-storage": "^3.717.0",
"@aws-sdk/s3-request-presigner": "^3.717.0"
```

Run: `pnpm install`
Expected: lockfile updates, `@aws-sdk/lib-storage` present.

- [ ] **Step 2: Extend the port interface**

Edit `packages/ports/src/blob.ts` to:

```ts
import type { HealthResult } from './health';
import type { Readable } from 'node:stream';

export interface BlobStoragePort {
  healthCheck(): Promise<HealthResult>;
  put(key: string, body: Uint8Array | string, contentType?: string): Promise<void>;
  /** Streaming put for large objects (multipart under the hood); never buffers the whole body. */
  putStream(key: string, body: Readable, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** Streaming get for large objects; returns the object body as a Node Readable. */
  getStream(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  presign(key: string, expiresInSeconds?: number): Promise<string>;
}
```

- [ ] **Step 3: Write the failing tests**

Extend `packages/adapter-s3-bucket/src/index.test.ts`. The adapter accepts an injected `client` via `deps.client`; use a fake whose `send` dispatches on the command's constructor name.

```ts
import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { createS3Bucket } from './index';

const cfg = { endpoint: 'http://x', region: 'us-east-1', accessKeyId: 'a', secretAccessKey: 'b', bucket: 'buck', forcePathStyle: true };

function fakeClient(handlers: Record<string, (input: any) => any>) {
  const calls: { name: string; input: any }[] = [];
  return {
    calls,
    send: async (cmd: any) => {
      const name = cmd.constructor.name;
      calls.push({ name, input: cmd.input });
      const h = handlers[name];
      if (!h) throw new Error(`unexpected command ${name}`);
      return h(cmd.input);
    },
  };
}

describe('s3 bucket streaming', () => {
  it('putStream uploads a small body via a single PutObject', async () => {
    const client = fakeClient({ PutObjectCommand: () => ({}) });
    const blob = createS3Bucket(cfg, { client: client as never });
    await blob.putStream('k1.zip', Readable.from([Buffer.from('hello')]), 'application/zip');
    const put = client.calls.find((c) => c.name === 'PutObjectCommand');
    expect(put?.input).toMatchObject({ Bucket: 'buck', Key: 'k1.zip', ContentType: 'application/zip' });
  });

  it('getStream returns the object body as a Readable', async () => {
    const body = Readable.from([Buffer.from('zipbytes')]);
    const client = fakeClient({ GetObjectCommand: () => ({ Body: body }) });
    const blob = createS3Bucket(cfg, { client: client as never });
    const out = await blob.getStream('k1.zip');
    const chunks: Buffer[] = [];
    for await (const c of out) chunks.push(Buffer.from(c));
    expect(Buffer.concat(chunks).toString()).toBe('zipbytes');
  });

  it('delete sends DeleteObjectCommand', async () => {
    const client = fakeClient({ DeleteObjectCommand: () => ({}) });
    const blob = createS3Bucket(cfg, { client: client as never });
    await blob.delete('k1.zip');
    expect(client.calls.at(-1)).toMatchObject({ name: 'DeleteObjectCommand', input: { Bucket: 'buck', Key: 'k1.zip' } });
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd packages/adapter-s3-bucket && npx vitest run src/index.test.ts`
Expected: FAIL — `blob.putStream is not a function` etc.

- [ ] **Step 5: Implement the three methods in the adapter**

Edit `packages/adapter-s3-bucket/src/index.ts`. Add imports:

```ts
import {
  S3Client, HeadBucketCommand, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
```

Inside the returned object literal (next to `put`/`get`), add:

```ts
async putStream(key, body, contentType) {
  // Upload handles multipart automatically for large bodies and a single PutObject for small ones,
  // so the whole object is never buffered in memory.
  const upload = new Upload({
    client,
    params: { Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType },
  });
  await upload.done();
},
async getStream(key) {
  const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
  const stream = res.Body as Readable | undefined;
  if (!stream) throw new Error(`empty object: ${key}`);
  return stream;
},
async delete(key) {
  await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
},
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/adapter-s3-bucket && npx vitest run src/index.test.ts`
Expected: PASS (all three).

Note: with the injected fake client, `Upload` issues a single `PutObjectCommand` for the tiny body, which the test asserts.

- [ ] **Step 7: Commit**

```bash
git add packages/ports/src/blob.ts packages/adapter-s3-bucket/src/index.ts packages/adapter-s3-bucket/package.json packages/adapter-s3-bucket/src/index.test.ts pnpm-lock.yaml
git commit -m "feat(blob): streaming putStream/getStream + delete on BlobStoragePort"
```

---

### Task 2: `terminology_ingest_jobs` table + store

**Files:**
- Modify: `packages/db/src/schema/internal.ts` (add table interface + register in `InternalSchema`)
- Create: `packages/db/src/migrations/internal/061_terminology_ingest_jobs.ts`
- Modify: `packages/db/src/migrations/internal/index.ts` (import + registry entry)
- Create: `packages/db/src/terminology-ingest-job-store.ts`
- Modify: `packages/db/src/index.ts` (barrel export)
- Test: `packages/db/src/terminology-ingest-job-store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type IngestJobStatus = 'queued' | 'running' | 'ready' | 'failed';
  interface TerminologyIngestJob {
    id: string; systemType: string; codingSystemId: string; blobKey: string; version: string | null;
    status: IngestJobStatus; phase: string | null; processed: number; total: number | null;
    error: string | null; createdBy: string | null;
    createdAt: string; startedAt: string | null; finishedAt: string | null;
  }
  interface TerminologyIngestJobStore {
    enqueue(input: { systemType: string; codingSystemId: string; blobKey: string; version: string | null; createdBy: string | null }): Promise<TerminologyIngestJob>;
    claimNext(): Promise<TerminologyIngestJob | null>;
    updateProgress(id: string, p: { phase: string; processed: number; total: number | null }): Promise<void>;
    finish(id: string, status: 'ready' | 'failed', error: string | null): Promise<void>;
    get(id: string): Promise<TerminologyIngestJob | null>;
    latestForSystem(systemType: string): Promise<TerminologyIngestJob | null>;
    hasActive(systemType: string): Promise<boolean>;
    createFactory: typeof createTerminologyIngestJobStore;
  }
  function createTerminologyIngestJobStore(db: Kysely<InternalSchema>): TerminologyIngestJobStore;
  ```

- [ ] **Step 1: Add the table interface + register it**

Edit `packages/db/src/schema/internal.ts`. Add near the other table interfaces:

```ts
export interface TerminologyIngestJobsTable {
  id: string;
  system_type: string;
  coding_system_id: string;
  blob_key: string;
  version: string | null;
  status: string;
  phase: string | null;
  processed: Generated<string>;   // bigint → string on read
  total: string | null;
  error: string | null;
  created_by: string | null;
  created_at: Generated<Date>;
  started_at: Date | null;
  finished_at: Date | null;
}
```

In the `InternalSchema` interface (the table-name → interface map, ~line 655), add:

```ts
  terminology_ingest_jobs: TerminologyIngestJobsTable;
```

- [ ] **Step 2: Write the migration**

Create `packages/db/src/migrations/internal/061_terminology_ingest_jobs.ts`:

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('terminology_ingest_jobs')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('system_type', 'text', (c) => c.notNull())
    .addColumn('coding_system_id', 'text', (c) => c.notNull())
    .addColumn('blob_key', 'text', (c) => c.notNull())
    .addColumn('version', 'text')
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('queued'))
    .addColumn('phase', 'text')
    .addColumn('processed', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('total', 'bigint')
    .addColumn('error', 'text')
    .addColumn('created_by', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('started_at', 'timestamptz')
    .addColumn('finished_at', 'timestamptz')
    .execute();

  // At most one active (queued|running) job per system_type.
  await sql`
    create unique index if not exists terminology_ingest_jobs_one_active
    on terminology_ingest_jobs (system_type)
    where status in ('queued','running')
  `.execute(db);

  await db.schema
    .createIndex('terminology_ingest_jobs_system_created')
    .ifNotExists()
    .on('terminology_ingest_jobs')
    .columns(['system_type', 'created_at'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('terminology_ingest_jobs').ifExists().execute();
}
```

- [ ] **Step 3: Register the migration**

Edit `packages/db/src/migrations/internal/index.ts`:
- Add import after the `m060` import: `import * as m061 from './061_terminology_ingest_jobs';`
- Add to the `internalMigrations` object after the `060_notifications` entry: `'061_terminology_ingest_jobs': { up: m061.up, down: m061.down },`

- [ ] **Step 4: Write the failing store tests**

Create `packages/db/src/terminology-ingest-job-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createTerminologyIngestJobStore } from './terminology-ingest-job-store';

describe('terminology ingest job store', () => {
  it('enqueues a queued job and reads it back', async () => {
    const db = await makeMigratedDb();
    const store = createTerminologyIngestJobStore(db as never);
    const job = await store.enqueue({ systemType: 'loinc', codingSystemId: 'cs1', blobKey: 'terminology-dist/loinc/j1.zip', version: '2.82', createdBy: 'admin1' });
    expect(job.status).toBe('queued');
    expect(job.systemType).toBe('loinc');
    const got = await store.get(job.id);
    expect(got?.blobKey).toBe('terminology-dist/loinc/j1.zip');
    await db.destroy();
  });

  it('rejects a second active job for the same system', async () => {
    const db = await makeMigratedDb();
    const store = createTerminologyIngestJobStore(db as never);
    await store.enqueue({ systemType: 'loinc', codingSystemId: 'cs1', blobKey: 'a.zip', version: null, createdBy: null });
    expect(await store.hasActive('loinc')).toBe(true);
    await expect(store.enqueue({ systemType: 'loinc', codingSystemId: 'cs1', blobKey: 'b.zip', version: null, createdBy: null })).rejects.toThrow();
    await db.destroy();
  });

  it('claimNext moves the oldest queued job to running exactly once', async () => {
    const db = await makeMigratedDb();
    const store = createTerminologyIngestJobStore(db as never);
    const a = await store.enqueue({ systemType: 'loinc', codingSystemId: 'cs1', blobKey: 'a.zip', version: null, createdBy: null });
    const claimed = await store.claimNext();
    expect(claimed?.id).toBe(a.id);
    expect(claimed?.status).toBe('running');
    expect(await store.claimNext()).toBeNull(); // nothing else queued
    await db.destroy();
  });

  it('updateProgress + finish transition status', async () => {
    const db = await makeMigratedDb();
    const store = createTerminologyIngestJobStore(db as never);
    const a = await store.enqueue({ systemType: 'loinc', codingSystemId: 'cs1', blobKey: 'a.zip', version: null, createdBy: null });
    await store.claimNext();
    await store.updateProgress(a.id, { phase: 'concepts', processed: 500, total: 1000 });
    await store.finish(a.id, 'ready', null);
    const got = await store.get(a.id);
    expect(got?.status).toBe('ready');
    expect(got?.processed).toBe(500);
    expect(await store.latestForSystem('loinc')).toMatchObject({ id: a.id, status: 'ready' });
    await db.destroy();
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd packages/db && npx vitest run src/terminology-ingest-job-store.test.ts`
Expected: FAIL — module not found / function undefined.

- [ ] **Step 6: Implement the store**

Create `packages/db/src/terminology-ingest-job-store.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export type IngestJobStatus = 'queued' | 'running' | 'ready' | 'failed';

export interface TerminologyIngestJob {
  id: string;
  systemType: string;
  codingSystemId: string;
  blobKey: string;
  version: string | null;
  status: IngestJobStatus;
  phase: string | null;
  processed: number;
  total: number | null;
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface TerminologyIngestJobStore {
  enqueue(input: { systemType: string; codingSystemId: string; blobKey: string; version: string | null; createdBy: string | null }): Promise<TerminologyIngestJob>;
  claimNext(): Promise<TerminologyIngestJob | null>;
  updateProgress(id: string, p: { phase: string; processed: number; total: number | null }): Promise<void>;
  finish(id: string, status: 'ready' | 'failed', error: string | null): Promise<void>;
  get(id: string): Promise<TerminologyIngestJob | null>;
  latestForSystem(systemType: string): Promise<TerminologyIngestJob | null>;
  hasActive(systemType: string): Promise<boolean>;
}

type Row = {
  id: string; system_type: string; coding_system_id: string; blob_key: string; version: string | null;
  status: string; phase: string | null; processed: string | number; total: string | number | null; error: string | null;
  created_by: string | null; created_at: Date; started_at: Date | null; finished_at: Date | null;
};

function toJob(r: Row): TerminologyIngestJob {
  return {
    id: r.id, systemType: r.system_type, codingSystemId: r.coding_system_id, blobKey: r.blob_key, version: r.version,
    status: r.status as IngestJobStatus, phase: r.phase, processed: Number(r.processed), total: r.total == null ? null : Number(r.total),
    error: r.error, createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
    startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
  };
}

export function createTerminologyIngestJobStore(db: Kysely<InternalSchema>): TerminologyIngestJobStore {
  return {
    async enqueue(input) {
      const id = `tij_${randomUUID().slice(0, 8)}`;
      // The partial unique index (status in queued|running) makes a concurrent second active job fail.
      await db.insertInto('terminology_ingest_jobs')
        .values({
          id, system_type: input.systemType, coding_system_id: input.codingSystemId, blob_key: input.blobKey,
          version: input.version, status: 'queued', created_by: input.createdBy,
        } as never)
        .execute();
      const row = await db.selectFrom('terminology_ingest_jobs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      return toJob(row as never);
    },
    async claimNext() {
      // Atomic claim: pick the oldest queued row FOR UPDATE SKIP LOCKED and flip it to running.
      const rows = await sql<Row>`
        update terminology_ingest_jobs
        set status = 'running', started_at = now()
        where id = (
          select id from terminology_ingest_jobs
          where status = 'queued'
          order by created_at
          limit 1
          for update skip locked
        )
        returning *
      `.execute(db);
      const r = rows.rows[0];
      return r ? toJob(r) : null;
    },
    async updateProgress(id, p) {
      await db.updateTable('terminology_ingest_jobs')
        .set({ phase: p.phase, processed: p.processed as never, total: (p.total ?? null) as never })
        .where('id', '=', id)
        .execute();
    },
    async finish(id, status, error) {
      await db.updateTable('terminology_ingest_jobs')
        .set({ status, error, finished_at: sql`now()` as never })
        .where('id', '=', id)
        .execute();
    },
    async get(id) {
      const r = await db.selectFrom('terminology_ingest_jobs').selectAll().where('id', '=', id).executeTakeFirst();
      return r ? toJob(r as never) : null;
    },
    async latestForSystem(systemType) {
      const r = await db.selectFrom('terminology_ingest_jobs').selectAll()
        .where('system_type', '=', systemType).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
      return r ? toJob(r as never) : null;
    },
    async hasActive(systemType) {
      const r = await db.selectFrom('terminology_ingest_jobs').select('id')
        .where('system_type', '=', systemType).where('status', 'in', ['queued', 'running']).executeTakeFirst();
      return !!r;
    },
  };
}
```

- [ ] **Step 7: Barrel-export the store**

Edit `packages/db/src/index.ts`, add: `export * from './terminology-ingest-job-store';`

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd packages/db && npx vitest run src/terminology-ingest-job-store.test.ts`
Expected: PASS (all four).

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/schema/internal.ts packages/db/src/migrations/internal/061_terminology_ingest_jobs.ts packages/db/src/migrations/internal/index.ts packages/db/src/terminology-ingest-job-store.ts packages/db/src/terminology-ingest-job-store.test.ts packages/db/src/index.ts
git commit -m "feat(db): terminology_ingest_jobs table + store (one active job per system)"
```

---

### Task 3: Ingest orchestrator core (`ingestDistribution`)

**Files:**
- Create: `packages/terminology/src/ingest/ingest-distribution.ts`
- Modify: `packages/terminology/src/index.ts` (export it)
- Test: `packages/terminology/src/ingest/ingest-distribution.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface IngestProgress { phase: string; processed: number; total: number | null }
  interface IngestDeps {
    loadConcepts(systemType: string, distDir: string, opts: { acceptLicense: boolean }): Promise<{ conceptsLoaded: number }>;
    buildOntology(systemType: string, codingSystemId: string, distDir: string, onProgress: (p: IngestProgress) => void): Promise<void>;
  }
  interface IngestResult { conceptsLoaded: number }
  function ingestDistribution(input: {
    systemType: string; codingSystemId: string; distDir: string; acceptLicense: boolean;
    deps: IngestDeps; onProgress: (p: IngestProgress) => void;
  }): Promise<IngestResult>;
  ```
- Consumes: nothing at test time (deps injected). At wiring time (Task 6) `loadConcepts`/`buildOntology` are backed by `loaders.loinc` and `ontology.build`.

- [ ] **Step 1: Write the failing test**

Create `packages/terminology/src/ingest/ingest-distribution.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ingestDistribution } from './ingest-distribution';

describe('ingestDistribution (loinc)', () => {
  it('loads concepts then builds the ontology over the same dir, summing progress', async () => {
    const phases: string[] = [];
    const deps = {
      loadConcepts: vi.fn(async () => ({ conceptsLoaded: 42 })),
      buildOntology: vi.fn(async (_s: string, _id: string, _d: string, onP: (p: any) => void) => { onP({ phase: 'ontology:tree', processed: 10, total: 10 }); }),
    };
    const res = await ingestDistribution({
      systemType: 'loinc', codingSystemId: 'cs1', distDir: '/tmp/dist', acceptLicense: true,
      deps, onProgress: (p) => phases.push(p.phase),
    });
    expect(res.conceptsLoaded).toBe(42);
    expect(deps.loadConcepts).toHaveBeenCalledWith('loinc', '/tmp/dist', { acceptLicense: true });
    expect(deps.buildOntology).toHaveBeenCalledWith('loinc', 'cs1', '/tmp/dist', expect.any(Function));
    expect(phases).toContain('concepts');
    expect(phases).toContain('ontology:tree');
  });

  it('rejects a non-loinc system in slice 1', async () => {
    const deps = { loadConcepts: vi.fn(), buildOntology: vi.fn() };
    await expect(ingestDistribution({ systemType: 'snomed', codingSystemId: 'x', distDir: '/d', acceptLicense: true, deps: deps as never, onProgress: () => {} }))
      .rejects.toThrow(/only loinc/i);
  });

  it('requires license acceptance', async () => {
    const deps = { loadConcepts: vi.fn(), buildOntology: vi.fn() };
    await expect(ingestDistribution({ systemType: 'loinc', codingSystemId: 'x', distDir: '/d', acceptLicense: false, deps: deps as never, onProgress: () => {} }))
      .rejects.toThrow(/license/i);
    expect(deps.loadConcepts).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/terminology && npx vitest run src/ingest/ingest-distribution.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the orchestrator**

Create `packages/terminology/src/ingest/ingest-distribution.ts`:

```ts
export interface IngestProgress { phase: string; processed: number; total: number | null }

export interface IngestDeps {
  loadConcepts(systemType: string, distDir: string, opts: { acceptLicense: boolean }): Promise<{ conceptsLoaded: number }>;
  buildOntology(systemType: string, codingSystemId: string, distDir: string, onProgress: (p: IngestProgress) => void): Promise<void>;
}

export interface IngestResult { conceptsLoaded: number }

/** Orchestrate a single distribution ingest: flat concepts THEN the ontology tree, over one extracted
 *  dir. Slice 1 supports LOINC only (it has both a term loader and an ontology adapter). */
export async function ingestDistribution(input: {
  systemType: string;
  codingSystemId: string;
  distDir: string;
  acceptLicense: boolean;
  deps: IngestDeps;
  onProgress: (p: IngestProgress) => void;
}): Promise<IngestResult> {
  if (input.systemType !== 'loinc') {
    throw new Error(`unsupported system type: ${input.systemType} (only loinc is supported in this release)`);
  }
  if (!input.acceptLicense) {
    throw new Error('the distribution license must be accepted before import');
  }
  input.onProgress({ phase: 'concepts', processed: 0, total: null });
  const { conceptsLoaded } = await input.deps.loadConcepts(input.systemType, input.distDir, { acceptLicense: input.acceptLicense });
  input.onProgress({ phase: 'concepts', processed: conceptsLoaded, total: conceptsLoaded });
  await input.deps.buildOntology(input.systemType, input.codingSystemId, input.distDir, input.onProgress);
  return { conceptsLoaded };
}
```

- [ ] **Step 4: Export it**

Edit `packages/terminology/src/index.ts`, add: `export * from './ingest/ingest-distribution';`

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/terminology && npx vitest run src/ingest/ingest-distribution.test.ts`
Expected: PASS (all three).

- [ ] **Step 6: Commit**

```bash
git add packages/terminology/src/ingest/ingest-distribution.ts packages/terminology/src/ingest/ingest-distribution.test.ts packages/terminology/src/index.ts
git commit -m "feat(terminology): ingestDistribution orchestrator (concepts + ontology, loinc)"
```

---

### Task 4: Zip download + extract helper

**Files:**
- Create: `packages/bootstrap/src/terminology-dist-extract.ts`
- Modify: `packages/bootstrap/package.json` (add `unzipper` + `@types/unzipper`)
- Test: `packages/bootstrap/src/terminology-dist-extract.test.ts`
- Test fixture: `packages/bootstrap/src/__fixtures__/tiny-dist.zip` (a 2-file zip created in-test, not committed binary)

**Interfaces:**
- Produces: `downloadAndExtract(blob: Pick<BlobStoragePort, 'getStream'>, key: string, workDir: string): Promise<{ distDir: string; cleanup(): Promise<void> }>`

- [ ] **Step 1: Add unzipper**

Edit `packages/bootstrap/package.json`: add `"unzipper": "^0.12.3"` to `dependencies` and `"@types/unzipper": "^0.10.10"` to `devDependencies`.
Run: `pnpm install`

- [ ] **Step 2: Write the failing test**

Create `packages/bootstrap/src/terminology-dist-extract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { downloadAndExtract } from './terminology-dist-extract';

// Build a minimal zip in memory (via unzipper's sibling — use a fixed base64 zip of {a.txt:'A', b/c.txt:'C'}).
const ZIP_B64 = 'UEsDBBQAAAAAAAAAIQBTL0oNAQAAAAEAAAAFAAAAYS50eHRBUEsDBBQAAAAAAAAAIQBHZ2p0AQAAAAEAAAAHAAAAYi9jLnR4dENQSwECFAAUAAAAAAAAACEAUy9KDQEAAAABAAAABQAAAAAAAAAAAAAAAAAAAAAAYS50eHRQSwECFAAUAAAAAAAAACEAR2dqdAEAAAABAAAABwAAAAAAAAAAAAAAAAAkAAAAYi9jLnR4dFBLBQYAAAAAAgACAGgAAABKAAAAAAA=';

describe('downloadAndExtract', () => {
  it('streams a zip from the blob and extracts its entries to a dir', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kc-ext-'));
    const blob = { getStream: async () => Readable.from([Buffer.from(ZIP_B64, 'base64')]) };
    const { distDir, cleanup } = await downloadAndExtract(blob, 'k.zip', workDir);
    expect(readFileSync(join(distDir, 'a.txt'), 'utf8')).toBe('A');
    expect(readFileSync(join(distDir, 'b', 'c.txt'), 'utf8')).toBe('C');
    await cleanup();
    expect(existsSync(distDir)).toBe(false);
  });
});
```

*(If the base64 fixture proves finicky across platforms, the implementer may instead write two files and zip them with `unzipper`'s counterpart at test setup; the assertion — two extracted files with the right contents, then cleanup removes the dir — is what matters.)*

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/bootstrap && npx vitest run src/terminology-dist-extract.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `packages/bootstrap/src/terminology-dist-extract.ts`:

```ts
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import unzipper from 'unzipper';
import type { BlobStoragePort } from '@openldr/ports';

/** Stream a distribution zip from the blob store to `workDir`, extract it, and return the extracted
 *  root plus a cleanup that removes the whole working dir (zip + extracted tree). Nothing is buffered
 *  fully in memory: the blob is streamed to a temp file, then unzipper streams each entry to disk. */
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

  await pipeline(createReadStream(zipPath), unzipper.Extract({ path: distDir }));

  return {
    distDir,
    async cleanup() { await rm(workDir, { recursive: true, force: true }); },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/bootstrap && npx vitest run src/terminology-dist-extract.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/terminology-dist-extract.ts packages/bootstrap/src/terminology-dist-extract.test.ts packages/bootstrap/package.json pnpm-lock.yaml
git commit -m "feat(bootstrap): stream + extract terminology distribution zip from blob store"
```

---

### Task 5: Ingest worker

**Files:**
- Create: `packages/bootstrap/src/terminology-ingest-worker.ts`
- Modify: `packages/bootstrap/src/index.ts` (export at the bottom barrel)
- Test: `packages/bootstrap/src/terminology-ingest-worker.test.ts`

**Interfaces:**
- Consumes: `TerminologyIngestJobStore` (Task 2), `BlobStoragePort.getStream`/`delete` (Task 1), `downloadAndExtract` (Task 4), `ingestDistribution` (Task 3), `AuditStore.record` (existing).
- Produces:
  ```ts
  interface TerminologyIngestWorkerDeps {
    jobs: TerminologyIngestJobStore;
    blob: Pick<BlobStoragePort, 'getStream' | 'delete'>;
    runIngest(job: TerminologyIngestJob, onProgress: (p: IngestProgress) => void): Promise<{ conceptsLoaded: number }>;
    audit: Pick<AuditStore, 'record'>;
    workDirBase: string;
    intervalMs?: number;
    logger: { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void };
  }
  interface TerminologyIngestWorker { tickOnce(): Promise<void>; stop(): Promise<void> }
  function createTerminologyIngestWorker(deps): TerminologyIngestWorker;
  ```
  `runIngest` is injected so the worker unit-test doesn't touch S3/unzip/DB. At wiring time (Task 6) it is `downloadAndExtract` → `ingestDistribution` → `cleanup`.

- [ ] **Step 1: Write the failing test**

Create `packages/bootstrap/src/terminology-ingest-worker.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createTerminologyIngestWorker } from './terminology-ingest-worker';

function job(over: Partial<any> = {}) {
  return { id: 'j1', systemType: 'loinc', codingSystemId: 'cs1', blobKey: 'terminology-dist/loinc/j1.zip', version: '2.82', status: 'running', phase: null, processed: 0, total: null, error: null, createdBy: 'admin1', createdAt: '', startedAt: '', finishedAt: null, ...over };
}

function deps(over: Partial<any> = {}) {
  const state: any = { finished: [], audited: [], deleted: [], progress: [] };
  const j = job();
  return {
    state,
    d: {
      jobs: {
        claimNext: vi.fn().mockResolvedValueOnce(j).mockResolvedValue(null),
        updateProgress: vi.fn(async (_id, p) => { state.progress.push(p); }),
        finish: vi.fn(async (id, s, e) => { state.finished.push({ id, s, e }); }),
        latestForSystem: vi.fn(async () => ({ id: 'j0', blobKey: 'terminology-dist/loinc/j0.zip', status: 'ready' })),
        get: vi.fn(), enqueue: vi.fn(), hasActive: vi.fn(),
      },
      blob: { getStream: vi.fn(), delete: vi.fn(async (k: string) => { state.deleted.push(k); }) },
      runIngest: vi.fn(async (_j, onP) => { onP({ phase: 'concepts', processed: 5, total: 5 }); return { conceptsLoaded: 5 }; }),
      audit: { record: vi.fn(async (e: any) => { state.audited.push(e); return { ...e, id: 'a', occurredAt: '' }; }) },
      workDirBase: '/tmp',
      logger: { info() {}, error() {} },
      ...over,
    },
  };
}

describe('terminology ingest worker', () => {
  it('claims a job, ingests, finishes ready, audits completed, deletes the prior blob', async () => {
    const { state, d } = deps();
    const w = createTerminologyIngestWorker(d as never);
    await w.tickOnce();
    expect(d.runIngest).toHaveBeenCalledTimes(1);
    expect(state.finished).toEqual([{ id: 'j1', s: 'ready', e: null }]);
    expect(state.audited[0]).toMatchObject({ action: 'terminology.import.completed', actorType: 'system' });
    expect(state.deleted).toEqual(['terminology-dist/loinc/j0.zip']); // prior retained blob removed
    await w.stop();
  });

  it('on ingest failure: finishes failed, audits failed, keeps the blob', async () => {
    const { state, d } = deps({ runIngest: vi.fn(async () => { throw new Error('boom'); }) });
    const w = createTerminologyIngestWorker(d as never);
    await w.tickOnce();
    expect(state.finished[0]).toMatchObject({ id: 'j1', s: 'failed' });
    expect(state.finished[0].e).toMatch(/boom/);
    expect(state.audited[0]).toMatchObject({ action: 'terminology.import.failed' });
    expect(state.deleted).toEqual([]); // blob retained for retry
    await w.stop();
  });

  it('does nothing when no job is queued', async () => {
    const { d } = deps({ jobs: { claimNext: vi.fn(async () => null), updateProgress: vi.fn(), finish: vi.fn(), latestForSystem: vi.fn(), get: vi.fn(), enqueue: vi.fn(), hasActive: vi.fn() } });
    const w = createTerminologyIngestWorker(d as never);
    await w.tickOnce();
    expect(d.runIngest).not.toHaveBeenCalled();
    await w.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/bootstrap && npx vitest run src/terminology-ingest-worker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the worker**

Create `packages/bootstrap/src/terminology-ingest-worker.ts`:

```ts
import { redact } from '@openldr/core';
import type { BlobStoragePort } from '@openldr/ports';
import type { TerminologyIngestJob, TerminologyIngestJobStore } from '@openldr/db';
import type { AuditStore } from '@openldr/audit';
import type { IngestProgress } from '@openldr/terminology';

export interface TerminologyIngestWorkerDeps {
  jobs: TerminologyIngestJobStore;
  blob: Pick<BlobStoragePort, 'getStream' | 'delete'>;
  runIngest(job: TerminologyIngestJob, onProgress: (p: IngestProgress) => void): Promise<{ conceptsLoaded: number }>;
  audit: Pick<AuditStore, 'record'>;
  workDirBase: string;
  intervalMs?: number;
  logger: { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void };
}

export interface TerminologyIngestWorker {
  tickOnce(): Promise<void>;
  stop(): Promise<void>;
}

export function createTerminologyIngestWorker(deps: TerminologyIngestWorkerDeps): TerminologyIngestWorker {
  const intervalMs = deps.intervalMs ?? 3000;
  let stopped = false;
  let running = false;

  async function processJob(job: TerminologyIngestJob): Promise<void> {
    // Capture the prior retained blob BEFORE finishing, so we can delete it only on success.
    const prior = await deps.jobs.latestForSystem(job.systemType).catch(() => null);
    try {
      const { conceptsLoaded } = await deps.runIngest(job, (p) => {
        void deps.jobs.updateProgress(job.id, p).catch((err) => deps.logger.error({ err, jobId: job.id }, 'ingest progress write failed'));
      });
      await deps.jobs.finish(job.id, 'ready', null);
      await deps.audit.record({
        actorType: 'system', actorName: 'System', action: 'terminology.import.completed',
        entityType: 'coding_system', entityId: job.codingSystemId,
        metadata: { systemType: job.systemType, version: job.version, conceptsLoaded },
      });
      // Retain only the latest zip: drop the previous ready job's blob if it differs.
      if (prior && prior.status === 'ready' && prior.blobKey && prior.blobKey !== job.blobKey) {
        await deps.blob.delete(prior.blobKey).catch((err) => deps.logger.error({ err, key: prior.blobKey }, 'prior distribution blob delete failed'));
      }
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
    }
  }

  async function tickOnce(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const job = await deps.jobs.claimNext();
      if (job) await processJob(job);
    } catch (err) {
      deps.logger.error({ err }, 'terminology ingest tick failed');
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => { if (!stopped) void tickOnce(); }, intervalMs);

  return {
    tickOnce,
    async stop() { stopped = true; clearInterval(timer); },
  };
}
```

- [ ] **Step 4: Export the worker**

Edit `packages/bootstrap/src/index.ts` barrel-export region (near the other worker exports, ~line 1190+): `export * from './terminology-ingest-worker';`

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/bootstrap && npx vitest run src/terminology-ingest-worker.test.ts`
Expected: PASS (all three).

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/terminology-ingest-worker.ts packages/bootstrap/src/terminology-ingest-worker.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): terminology ingest worker (claim→ingest→audit→retain-latest)"
```

---

### Task 6: Wire the job store + worker into bootstrap

**Files:**
- Modify: `packages/bootstrap/src/index.ts` (AppContext field, store + worker construction, start, close)
- Modify: `packages/config/src/schema.ts` (optional `TERMINOLOGY_WORK_DIR`)

**Interfaces:**
- Produces on `AppContext`: `terminologyJobs: TerminologyIngestJobStore` and (already present) `blob: BlobStoragePort`, `terminology: TerminologyContext`. These are what Task 7's routes consume.

- [ ] **Step 1: Add the config key**

Edit `packages/config/src/schema.ts` near the S3 keys (line ~69):

```ts
  // Working dir for terminology distribution download + extraction (needs disk headroom for SNOMED).
  TERMINOLOGY_WORK_DIR: z.string().optional(),
```

- [ ] **Step 2: Construct the job store**

In `packages/bootstrap/src/index.ts`, near the other `create*Store(internal.db)` calls (~line 594), add:

```ts
const terminologyJobs = createTerminologyIngestJobStore(internal.db);
```

Ensure `createTerminologyIngestJobStore` is imported from `@openldr/db` (extend the existing `@openldr/db` import list).

- [ ] **Step 3: Construct + start the worker**

After `blob` (line 347), `terminology` context, and `audit` exist, add (import `createTerminologyIngestWorker` from `./terminology-ingest-worker`, `downloadAndExtract` from `./terminology-dist-extract`, `ingestDistribution` from `@openldr/terminology`, `tmpdir` from `node:os`, `mkdtemp` from `node:fs/promises`, `join` from `node:path`):

```ts
const terminologyIngestWorker = createTerminologyIngestWorker({
  jobs: terminologyJobs,
  blob,
  audit,
  workDirBase: cfg.TERMINOLOGY_WORK_DIR ?? tmpdir(),
  logger,
  runIngest: async (job, onProgress) => {
    const workDir = await mkdtemp(join(cfg.TERMINOLOGY_WORK_DIR ?? tmpdir(), 'terminology-ingest-'));
    const { distDir, cleanup } = await downloadAndExtract(blob, job.blobKey, workDir);
    try {
      return await ingestDistribution({
        systemType: job.systemType,
        codingSystemId: job.codingSystemId,
        distDir,
        acceptLicense: true, // the API enforced acceptance at upload/enqueue time
        onProgress,
        deps: {
          loadConcepts: async (_systemType, dir, opts) => {
            const r = await terminology.loaders.loinc(dir, opts.acceptLicense);
            return { conceptsLoaded: r.conceptsLoaded };
          },
          buildOntology: async (_systemType, codingSystemId, dir, onP) =>
            terminology.ontology.build(codingSystemId, dir, (p) => onP({ phase: p.phase, processed: p.processed, total: p.total })),
        },
      });
    } finally {
      await cleanup();
    }
  },
});
```

- [ ] **Step 4: Expose on AppContext, return it, stop it in close()**

- Add to the `AppContext` interface (near `syncActivity`): `terminologyJobs: TerminologyIngestJobStore;`
- Add `terminologyJobs` to the returned object literal (~line 1176).
- In `close()` (line ~1179), add before the `Promise.allSettled(...)`: `await terminologyIngestWorker.stop();`

- [ ] **Step 5: Typecheck gate**

Run: `pnpm turbo run typecheck --filter=@openldr/bootstrap --filter=@openldr/config --force`
Expected: PASS (this task is wiring; its behavioural coverage lands in Tasks 5 and 7).

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/index.ts packages/config/src/schema.ts
git commit -m "feat(bootstrap): wire terminology ingest job store + worker into startup"
```

---

### Task 7: Upload / status / purge API routes

**Files:**
- Modify: `apps/server/src/terminology-admin-routes.ts`
- Test: `apps/server/src/terminology-admin-routes.test.ts` (extend)

**Interfaces:**
- Consumes: `ctx.terminologyJobs` (Task 6), `ctx.blob.putStream`/`delete` (Task 1), `MANAGE` (existing), `recordAudit` (existing), `isReadableBody` (existing helper in this file).
- Produces routes:
  - `POST /api/terminology/systems/:id/distribution?systemType=loinc&acceptLicense=true&version=2.82` (raw `application/octet-stream` zip body)
  - `GET /api/terminology/systems/:id/distribution/job`
  - `DELETE /api/terminology/systems/:id/distribution`

- [ ] **Step 1: Write the failing route tests**

Extend `apps/server/src/terminology-admin-routes.test.ts` (uses the existing `appWith(ctx, roles)` helper + `fakeCtx()`). Add a fake `terminologyJobs` + `blob` to `fakeCtx()` first (in that file's `fakeCtx`, add):

```ts
// inside fakeCtx()'s returned ctx object:
terminologyJobs: {
  hasActive: async () => ctxState.active,
  enqueue: async (input: any) => { ctxState.enqueued.push(input); return { id: 'tij_1', status: 'queued', ...input }; },
  latestForSystem: async () => ctxState.latest,
  get: async () => ctxState.latest,
},
blob: {
  putStream: async (key: string) => { ctxState.put.push(key); },
  delete: async (key: string) => { ctxState.deleted.push(key); },
},
```

with `const ctxState = { active: false, enqueued: [] as any[], latest: null as any, put: [] as string[], deleted: [] as string[] };` returned alongside for assertions.

Then the tests:

```ts
import { Readable } from 'node:stream';

describe('terminology distribution upload/status/purge', () => {
  it('streams the zip to the blob and enqueues a job (201)', async () => {
    const { ctx, ctxState } = fakeCtx();
    const app = appWith(ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/terminology/systems/cs1/distribution?systemType=loinc&acceptLicense=true&version=2.82',
      headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('PK-fake-zip'),
    });
    expect(res.statusCode).toBe(201);
    expect(ctxState.put.length).toBe(1);
    expect(ctxState.enqueued[0]).toMatchObject({ systemType: 'loinc', codingSystemId: 'cs1', version: '2.82' });
    expect(res.json().jobId).toBe('tij_1');
  });

  it('rejects a missing license (400) and never stores', async () => {
    const { ctx, ctxState } = fakeCtx();
    const app = appWith(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/terminology/systems/cs1/distribution?systemType=loinc&acceptLicense=false', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
    expect(res.statusCode).toBe(400);
    expect(ctxState.put.length).toBe(0);
  });

  it('rejects a non-loinc systemType (400) in this release', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/terminology/systems/cs1/distribution?systemType=snomed&acceptLicense=true', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
    expect(res.statusCode).toBe(400);
  });

  it('rejects when a job is already active (409)', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.active = true;
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/terminology/systems/cs1/distribution?systemType=loinc&acceptLicense=true', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
    expect(res.statusCode).toBe(409);
  });

  it('GET job returns the latest job', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.latest = { id: 'tij_1', status: 'ready', phase: null, processed: 5, total: 5, error: null, version: '2.82', finishedAt: 'now' };
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/terminology/systems/cs1/distribution/job' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ready', processed: 5 });
  });

  it('DELETE purges the retained blob', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.latest = { id: 'tij_1', status: 'ready', blobKey: 'terminology-dist/loinc/tij_1.zip' };
    const res = await appWith(ctx).inject({ method: 'DELETE', url: '/api/terminology/systems/cs1/distribution' });
    expect(res.statusCode).toBe(204);
    expect(ctxState.deleted).toEqual(['terminology-dist/loinc/tij_1.zip']);
  });

  it('a lab_technician is rejected (403) on upload', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx, ['lab_technician']).inject({ method: 'POST', url: '/api/terminology/systems/cs1/distribution?systemType=loinc&acceptLicense=true', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/server && npx vitest run src/terminology-admin-routes.test.ts`
Expected: FAIL — routes 404.

- [ ] **Step 3: Implement the routes**

In `apps/server/src/terminology-admin-routes.ts`, add a small helper + the three routes inside `registerTerminologyAdminRoutes` (the `application/octet-stream` content-type parser at line 38 already passes `req.body` as the raw stream). Use a 1 GiB per-route body limit on the upload:

```ts
const UPLOAD = { preHandler: requireRole('lab_admin', 'lab_manager'), bodyLimit: 1_073_741_824 };
const SUPPORTED_SYSTEMS = new Set(['loinc']); // Slice 2 adds 'snomed','rxnorm'

app.post('/api/terminology/systems/:id/distribution', UPLOAD, async (req, reply) => {
  const codingSystemId = (req.params as IdParam).id;
  const q = req.query as { systemType?: string; acceptLicense?: string; version?: string };
  const systemType = String(q.systemType ?? '');
  if (!SUPPORTED_SYSTEMS.has(systemType)) { reply.code(400); return { error: `unsupported systemType: ${systemType || '(missing)'}` }; }
  if (q.acceptLicense !== 'true') { reply.code(400); return { error: 'the distribution license must be accepted' }; }
  if (await ctx.terminologyJobs.hasActive(systemType)) { reply.code(409); return { error: `an import for ${systemType} is already in progress` }; }
  if (!isReadableBody(req.body)) { reply.code(400); return { error: 'expected a zip stream (application/octet-stream)' }; }

  const jobId = `pending`; // real id assigned by enqueue; the blob key uses a fresh uuid so upload and enqueue can't race a key
  void jobId;
  const key = `terminology-dist/${systemType}/${codingSystemId}-${Date.now()}.zip`;
  try {
    await ctx.blob.putStream(key, req.body as NodeJS.ReadableStream as never, 'application/zip');
  } catch (e) { return mapErr(e, reply); }

  const job = await ctx.terminologyJobs.enqueue({
    systemType, codingSystemId, blobKey: key, version: q.version ?? null, createdBy: req.user?.id ?? null,
  });
  await recordAudit(ctx, req, { action: 'terminology.distribution.uploaded', entityType: 'coding_system', entityId: codingSystemId, before: null, after: null, metadata: { systemType, version: q.version ?? null, jobId: job.id } });
  reply.code(201);
  return { jobId: job.id };
});

app.get('/api/terminology/systems/:id/distribution/job', MANAGE, async (req, reply) => {
  const q = req.query as { systemType?: string };
  const systemType = String(q.systemType ?? 'loinc');
  const job = await ctx.terminologyJobs.latestForSystem(systemType);
  if (!job) { reply.code(404); return { error: 'no import job for this system' }; }
  return { id: job.id, status: job.status, phase: job.phase, processed: job.processed, total: job.total, error: job.error, version: job.version, finishedAt: job.finishedAt };
});

app.delete('/api/terminology/systems/:id/distribution', MANAGE, async (req, reply) => {
  const codingSystemId = (req.params as IdParam).id;
  const q = req.query as { systemType?: string };
  const systemType = String(q.systemType ?? 'loinc');
  const job = await ctx.terminologyJobs.latestForSystem(systemType);
  if (job?.blobKey) {
    try { await ctx.blob.delete(job.blobKey); } catch (e) { return mapErr(e, reply); }
  }
  await recordAudit(ctx, req, { action: 'terminology.distribution.purged', entityType: 'coding_system', entityId: codingSystemId, before: null, after: null, metadata: { systemType } });
  reply.code(204);
  return null;
});
```

Note: `AppContext` must now include `terminologyJobs` and `blob` — both added in Task 6 (`blob` already exists on the context from bootstrap). If TypeScript reports `ctx.blob`/`ctx.terminologyJobs` missing, confirm Task 6 exposed them on the `AppContext` interface.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/server && npx vitest run src/terminology-admin-routes.test.ts`
Expected: PASS (all new + existing).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/terminology-admin-routes.ts apps/server/src/terminology-admin-routes.test.ts
git commit -m "feat(server): terminology distribution upload/status/purge routes (streaming, RBAC, license, 409)"
```

---

### Task 8: Notification mapping for import completion

**Files:**
- Modify: `packages/bootstrap/src/notifications.ts`
- Test: `packages/bootstrap/src/notifications.test.ts` (extend)

**Interfaces:**
- Produces notification types `terminology_import_done` / `terminology_import_failed` on the derived read-model.

- [ ] **Step 1: Write the failing test**

Extend `packages/bootstrap/src/notifications.test.ts` — the file tests `auditRowToNotification(row)`. Add:

```ts
import { auditRowToNotification } from './notifications';

it('maps terminology.import.completed to a notification', () => {
  const n = auditRowToNotification({ id: 'a1', occurredAt: '2026-07-20T00:00:00.000Z', actorType: 'system', actorId: null, actorName: 'System', action: 'terminology.import.completed', entityType: 'coding_system', entityId: 'http://loinc.org', metadata: { systemType: 'loinc', conceptsLoaded: 42 } } as never);
  expect(n?.type).toBe('terminology_import_done');
  expect(n?.priority).toBe('info');
});

it('maps terminology.import.failed to a warning notification', () => {
  const n = auditRowToNotification({ id: 'a2', occurredAt: '2026-07-20T00:00:00.000Z', actorType: 'system', actorId: null, actorName: 'System', action: 'terminology.import.failed', entityType: 'coding_system', entityId: 'http://loinc.org', metadata: { error: 'boom' } } as never);
  expect(n?.type).toBe('terminology_import_failed');
  expect(n?.priority).toBe('warning');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/bootstrap && npx vitest run src/notifications.test.ts`
Expected: FAIL — returns `null` (unmapped action).

- [ ] **Step 3: Implement — FOUR edits in `notifications.ts`**

1. Extend the `NotificationType` union (line 7-9):

```ts
export type NotificationType =
  | 'sync_diverged' | 'sync_failed' | 'sync_quarantined'
  | 'plugin_crashed' | 'auth_failed' | 'site_revoked'
  | 'terminology_import_done' | 'terminology_import_failed';
```

2. Add to `AUDIT_MAP` (line 56):

```ts
  'terminology.import.completed': { type: 'terminology_import_done', priority: 'info', linkTo: '/terminology', title: 'Terminology import complete' },
  'terminology.import.failed': { type: 'terminology_import_failed', priority: 'warning', linkTo: '/terminology', title: 'Terminology import failed' },
```

3. Add both actions to `AUDIT_ACTIONS` (line 93) — **required**, or `gather()` never queries them:

```ts
const AUDIT_ACTIONS = ['auth.failed', 'plugin.crash', 'system.crash', 'system.crash_loop', 'settings.sync.revoke', 'terminology.import.completed', 'terminology.import.failed'];
```

4. (No title table change — audit titles come from `AUDIT_MAP.title`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/bootstrap && npx vitest run src/notifications.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/notifications.ts packages/bootstrap/src/notifications.test.ts
git commit -m "feat(notifications): surface terminology import completed/failed on the bell"
```

---

### Task 9: Studio — upload dialog, status polling, notification i18n

**Files:**
- Modify: `apps/studio/src/api.ts` (upload/status/purge client + `NotificationType`)
- Modify: `apps/studio/src/pages/Terminology.tsx` (replace `LoincImportDialog`, add status badge)
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts` (notification keys)
- Modify: `apps/studio/src/pages/settings/NotificationPreferences.tsx` + `apps/studio/src/pages/Notifications.tsx` (add the two types to the toggle/filter lists)
- Test: `apps/studio/src/api.terminology-upload.test.ts` (new), extend `apps/studio/src/pages/Terminology.test.tsx`

**Interfaces:**
- Consumes: routes from Task 7. Produces client fns `uploadTerminologyDistribution`, `getTerminologyIngestJob`, `purgeTerminologyDistribution`.

- [ ] **Step 1: Add the API client (XHR upload with progress)**

In `apps/studio/src/api.ts`, add (import `getAccessToken` is already imported at line 1):

```ts
export interface TerminologyIngestJobView {
  id: string; status: 'queued' | 'running' | 'ready' | 'failed';
  phase: string | null; processed: number; total: number | null; error: string | null;
  version: string | null; finishedAt: string | null;
}

/** Stream a distribution zip to the server with upload progress. Uses XHR (fetch has no upload
 *  progress). Auth mirrors authFetch: bearer from getAccessToken(). */
export function uploadTerminologyDistribution(
  codingSystemId: string, systemType: string, file: File, acceptLicense: boolean, version: string | null,
  onProgress?: (fraction: number) => void,
): Promise<{ jobId: string }> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ systemType, acceptLicense: String(acceptLicense) });
    if (version) params.set('version', version);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/terminology/systems/${encodeURIComponent(codingSystemId)}/distribution?${params.toString()}`);
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

export const getTerminologyIngestJob = (codingSystemId: string, systemType: string): Promise<TerminologyIngestJobView> =>
  authFetch(`/api/terminology/systems/${encodeURIComponent(codingSystemId)}/distribution/job?systemType=${systemType}`)
    .then((r) => okJson<TerminologyIngestJobView>(r, 'get import job'));

export const purgeTerminologyDistribution = (codingSystemId: string, systemType: string): Promise<void> =>
  authFetch(`/api/terminology/systems/${encodeURIComponent(codingSystemId)}/distribution?systemType=${systemType}`, { method: 'DELETE' }).then(() => undefined);
```

Extend the `NotificationType` union (line 1491):

```ts
export type NotificationType =
  | 'sync_diverged' | 'sync_failed' | 'sync_quarantined'
  | 'plugin_crashed' | 'auth_failed' | 'site_revoked'
  | 'terminology_import_done' | 'terminology_import_failed';
```

- [ ] **Step 2: Write the failing API test**

Create `apps/studio/src/api.terminology-upload.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadTerminologyDistribution } from './api';

class FakeXHR {
  static instances: FakeXHR[] = [];
  upload = { onprogress: null as null | ((e: any) => void) };
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  status = 0; responseText = ''; method = ''; url = ''; headers: Record<string, string> = {}; body: any;
  constructor() { FakeXHR.instances.push(this); }
  open(m: string, u: string) { this.method = m; this.url = u; }
  setRequestHeader(k: string, v: string) { this.headers[k] = v; }
  send(b: any) { this.body = b; this.status = 201; this.responseText = JSON.stringify({ jobId: 'tij_9' }); this.onload?.(); }
}

describe('uploadTerminologyDistribution', () => {
  beforeEach(() => { FakeXHR.instances = []; (globalThis as any).XMLHttpRequest = FakeXHR as never; });
  it('POSTs the file as octet-stream with systemType + license query and resolves the jobId', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'loinc.zip');
    const res = await uploadTerminologyDistribution('cs1', 'loinc', file, true, '2.82');
    expect(res.jobId).toBe('tij_9');
    const xhr = FakeXHR.instances[0];
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toContain('/api/terminology/systems/cs1/distribution');
    expect(xhr.url).toContain('systemType=loinc');
    expect(xhr.url).toContain('acceptLicense=true');
    expect(xhr.url).toContain('version=2.82');
    expect(xhr.headers['content-type']).toBe('application/octet-stream');
  });
});
```

Run: `cd apps/studio && npx vitest run src/api.terminology-upload.test.ts` → Expected: FAIL then (after Step 1 lands) PASS. Run it now to confirm PASS since Step 1 implemented it.

- [ ] **Step 3: Replace the dialog in `Terminology.tsx`**

Replace `LoincImportDialog` (lines 949-1035) with an `ImportDistributionDialog` that takes a file, and update its two mount/trigger sites. The page keeps its hardcoded-string convention. Key changes:

```tsx
function ImportDistributionDialog({ open, onOpenChange, codingSystemId, systemType, onQueued }: {
  open: boolean; onOpenChange: (v: boolean) => void; codingSystemId: string; systemType: string; onQueued: (jobId: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setFile(null); setVersion(''); setAccepted(false); setBusy(false); setPct(0); setError(null); } }, [open]);
  const canImport = !!file && accepted && !busy;
  const handleImport = async (): Promise<void> => {
    if (!canImport || !file) return;
    setBusy(true); setError(null);
    try {
      const { jobId } = await uploadTerminologyDistribution(codingSystemId, systemType, file, accepted, version.trim() || null, setPct);
      onQueued(jobId);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Import distribution</DialogTitle>
        <DialogDescription>Upload an extracted distribution packaged as a .zip. It is stored and imported in the background.</DialogDescription>
        <div className="space-y-3">
          <div>
            <Label htmlFor="distFile">Distribution .zip</Label>
            <Input id="distFile" type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div>
            <Label htmlFor="distVersion">Version (optional)</Label>
            <Input id="distVersion" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="e.g. 2.82" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox id="distLicense" checked={accepted} onCheckedChange={(v) => setAccepted(v === true)} />
            I have accepted the license for this distribution.
          </label>
          {busy && <div className="text-xs text-muted-foreground">Uploading… {Math.round(pct * 100)}%</div>}
          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void handleImport()} disabled={!canImport}>{busy ? 'Uploading…' : 'Upload & import'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- Rename the menu item text from "Import LOINC distribution..." to "Import distribution..." at the three gated sites (lines 491-498, 579-583, 696-700). Keep the `isLoincPublisher`/`isLoincSystem` gate for Slice 1 (only LOINC publishers show it). Pass `systemType="loinc"` and the coding system id.
- Replace the mount (lines 906-910) with `<ImportDistributionDialog ... />` and change `handleLoincImported` (344-348) to `handleDistributionQueued(jobId)` which closes the dialog, sets a toast `Import started — you’ll be notified when it completes.`, and starts polling `getTerminologyIngestJob(codingSystemId, 'loinc')` on an interval until `status` is `ready`/`failed`, updating a small status badge next to the publisher (store `{ [codingSystemId]: job }` in component state; clear the interval on unmount).

- [ ] **Step 4: Add a "Delete stored distribution" menu item**

In the same ⋯ menu (LOINC publisher branch), add a `DropdownMenuItem` "Delete stored distribution" → `await purgeTerminologyDistribution(codingSystemId, 'loinc')` then toast `Stored distribution deleted.`

- [ ] **Step 5: Add notification i18n keys (all three locales) + toggle lists**

In `apps/studio/src/i18n/en.ts` under `notifications.triggers` add:

```ts
terminology_import_done: 'Terminology import complete',
terminology_import_failed: 'Terminology import failed',
```

and under `notifications.body`:

```ts
terminology_import_done: '{{systemType}} imported ({{conceptsLoaded}} concepts).',
terminology_import_failed: '{{systemType}} import failed: {{error}}',
```

Add the identical keys (translated) at the same paths in `fr.ts` and `pt.ts`:
- fr triggers: `'Import de terminologie terminé'` / `'Échec de l’import de terminologie'`; body: `'{{systemType}} importé ({{conceptsLoaded}} concepts).'` / `'Échec de l’import {{systemType}} : {{error}}'`
- pt triggers: `'Importação de terminologia concluída'` / `'Falha na importação de terminologia'`; body: `'{{systemType}} importado ({{conceptsLoaded}} conceitos).'` / `'Falha na importação de {{systemType}}: {{error}}'`

Add both type strings to `TRIGGER_TYPES` in `apps/studio/src/pages/settings/NotificationPreferences.tsx:17-20` and `NOTIFICATION_TYPES` in `apps/studio/src/pages/Notifications.tsx:23-26`.

- [ ] **Step 6: Extend `Terminology.test.tsx`**

Add a test that opening the LOINC publisher ⋯ menu shows "Import distribution..." and that selecting a file + accepting + clicking "Upload & import" calls `uploadTerminologyDistribution` (mock the api module). Mirror the existing dialog tests in that file.

- [ ] **Step 7: Run the studio tests + parity**

Run: `cd apps/studio && npx vitest run src/api.terminology-upload.test.ts src/pages/Terminology.test.tsx src/i18n/parity.test.ts`
Expected: PASS. (Parity fails loudly if any locale is missing a key — fix by adding the missing path.)

- [ ] **Step 8: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/pages/Terminology.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts apps/studio/src/pages/settings/NotificationPreferences.tsx apps/studio/src/pages/Notifications.tsx apps/studio/src/api.terminology-upload.test.ts apps/studio/src/pages/Terminology.test.tsx
git commit -m "feat(studio): terminology distribution upload dialog + status + import notifications"
```

---

### Task 10: Full-gate verification

- [ ] **Step 1: Run the whole gate**

Run: `pnpm turbo run typecheck test --force`
Expected: PASS. If `@openldr/bootstrap` shows a parallel flake, re-run `cd packages/bootstrap && npx vitest run` to confirm green in isolation (per [[repo-conventions]]).

- [ ] **Step 2: Commit any lockfile/config drift**

```bash
git add -A
git commit -m "chore: terminology upload slice 1 — gate green" || echo "nothing to commit"
```

## Self-Review notes (addressed)

- **Spec coverage:** §5 streaming blob → Task 1; §6 job table → Task 2; §7 ingest core + worker → Tasks 3–6; §8 API → Task 7; §10 notifications → Task 8; §9 Studio → Task 9. §11 CLI, §7a SNOMED/RxNorm teeing, and §8 legacy-route removal are **Slice 2/3** (out of this plan by design).
- **Type consistency:** `TerminologyIngestJob`/`IngestJobStatus` (Task 2) are consumed unchanged by Tasks 5–7; `IngestProgress` (Task 3) is the progress type used by the worker (Task 5) and route status; `BlobStoragePort` streaming methods (Task 1) are consumed by Tasks 4, 6, 7.
- **Slice 1 leaves the legacy `POST /api/terminology/import/loinc` route in place** (removed in Slice 3) so nothing breaks mid-migration; the new upload path is additive.
