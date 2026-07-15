# Distributed Sync S6a — Central Result Amendment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a central operator amend a lab-owned result (new FHIR version + `Provenance`), route that amendment down to only the owning lab over a new site-scoped pull stream, and apply it via the existing monotonic `applyRemote`.

**Architecture:** A central-side `authorAmendment` primitive writes a new resource version (keeping the owning lab's `site_id`) + a `Provenance` resource + two rows in a new `sync_amendments` outbox, all in one transaction. A machine-authed, **site-scoped** `POST /api/sync/pull-amendments` serves that outbox filtered by the token's `site_id`, carrying the same `SyncRecord` wire shape S1 push uses. A dedicated amendment pull runner (own `'sync-amend-pull'` cursor) drains it inside the existing pull host loop and applies each record through `applyRemote` (higher version wins, idempotent, per-record quarantine).

**Tech Stack:** TypeScript, Kysely (+ pg-mem for unit tests), Fastify, Commander (CLI), Vitest, pnpm/turbo monorepo. Spec: `docs/superpowers/specs/2026-07-15-distributed-sync-s6a-result-amendment-design.md`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/db/src/migrations/internal/054_sync_amendments.ts` | `sync_amendments` outbox table DDL | Create |
| `packages/db/src/migrations/internal/index.ts` | Register migration 054 | Modify |
| `packages/db/src/schema/internal.ts` | `SyncAmendmentsTable` type + `InternalSchema` member | Modify |
| `packages/db/src/fhir-store.ts` | `amend()` primitive + `AmendInput`/`AmendResult`/errors | Modify |
| `packages/db/src/index.ts` | Re-export new amend types/errors (if barrel lists them) | Modify |
| `packages/sync/src/batch.ts` | `AmendmentPullResponse` wire type | Modify |
| `packages/sync/src/amend-pull-worker.ts` | `createAmendmentPullRunner` (own cursor, applyRemote) | Create |
| `packages/sync/src/index.ts` | Export the amendment runner + type | Modify |
| `packages/bootstrap/src/sync-serve.ts` | `serveAmendments(ctx, siteId, fromSeq)` | Modify |
| `apps/server/src/sync-routes.ts` | `POST /api/sync/pull-amendments` (machine, site-scoped) | Modify |
| `apps/server/src/settings-routes.ts` | `POST /api/settings/sync/amend` (lab_admin) | Modify |
| `packages/cli/src/sync.ts` | `runSyncAmend` | Modify |
| `packages/cli/src/index.ts` | Register `sync amend` command | Modify |
| `packages/bootstrap/src/index.ts` | Wire amendment runner into the pull host loop | Modify |
| `scripts/sync-amend-live-acceptance.ts` | Two-DB round-trip acceptance | Create |
| `package.json` (root) | `sync:amend:accept` script | Modify |

**Key type contracts (defined once, referenced throughout):**
- `AmendInput = { resourceType: string; id: string; status: string; patch?: Record<string, unknown>; agent: string; reason?: string }`
- `AmendResult = { version: number; provenanceId: string; siteId: string }`
- `FhirStore.amend(input: AmendInput): Promise<AmendResult>`
- `AmendmentPullResponse = { records: (SyncRecord & { seq: number })[]; nextSeq: number }` (request reuses the existing `PullRequest = { fromSeq }`)

---

## Task 1: `sync_amendments` outbox table

**Files:**
- Create: `packages/db/src/migrations/internal/054_sync_amendments.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/schema/internal.ts`
- Test: `packages/db/src/migrations/internal/054_sync_amendments.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/db/src/migrations/internal/054_sync_amendments.test.ts
import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import { Kysely } from 'kysely';
import { up } from './054_sync_amendments';

describe('054_sync_amendments', () => {
  it('creates the sync_amendments outbox with a bigserial seq and site-scoped columns', async () => {
    const mem = newDb();
    const db = new Kysely<any>({ dialect: mem.adapter.createKyselyDialect() });
    await up(db);
    const seqA = await db
      .insertInto('sync_amendments')
      .values({ site_id: 'lab-a', resource_type: 'Observation', resource_id: 'obs-1', version: 2 })
      .returning('seq')
      .executeTakeFirstOrThrow();
    const seqB = await db
      .insertInto('sync_amendments')
      .values({ site_id: 'lab-a', resource_type: 'Provenance', resource_id: 'prov-1', version: 1 })
      .returning('seq')
      .executeTakeFirstOrThrow();
    expect(Number(seqB.seq)).toBeGreaterThan(Number(seqA.seq));
    const rows = await db.selectFrom('sync_amendments').selectAll().where('site_id', '=', 'lab-a').execute();
    expect(rows).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations/internal/054_sync_amendments.test.ts`
Expected: FAIL — `Cannot find module './054_sync_amendments'`.

- [ ] **Step 3: Create the migration**

```typescript
// packages/db/src/migrations/internal/054_sync_amendments.ts
import { type Kysely, sql } from 'kysely';

// Distributed sync S6a: central-side amendment outbox. When central amends a lab-owned resource
// (new version + Provenance), it records one row per resource here, in the same transaction as the
// fhir writes. The owning lab drains this over POST /api/sync/pull-amendments, site-scoped by seq.
// A pointer log (no body) — the serve reads the live body from fhir.resource_history at `version`.
// Sibling of reference_change_log; lives in the public schema (outside the frozen `fhir` schema).

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('sync_amendments')
    .addColumn('seq', 'bigserial', (c) => c.primaryKey())
    .addColumn('site_id', 'text', (c) => c.notNull())
    .addColumn('resource_type', 'text', (c) => c.notNull())
    .addColumn('resource_id', 'text', (c) => c.notNull())
    .addColumn('version', 'bigint', (c) => c.notNull())
    .addColumn('recorded_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  // The serve filters by site_id and pages by seq — index the routing + cursor axis together.
  await db.schema
    .createIndex('sync_amendments_site_seq_idx')
    .on('sync_amendments')
    .columns(['site_id', 'seq'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('sync_amendments').execute();
}
```

- [ ] **Step 4: Register the migration**

In `packages/db/src/migrations/internal/index.ts`, add the import after the `m053` line:

```typescript
import * as m054 from './054_sync_amendments';
```

And add the entry at the end of the `internalMigrations` record (after the `'053_workflow_secrets'` line):

```typescript
  '054_sync_amendments': { up: m054.up, down: m054.down },
```

- [ ] **Step 5: Add the schema type**

In `packages/db/src/schema/internal.ts`, add this interface immediately after `WorkflowSecretsTable` (before `export interface InternalSchema`):

```typescript
// Distributed sync S6a: central-side amendment outbox (public schema). One row per central-authored
// resource version routed to the owning lab (site_id). Pointer only — the serve reads the live body
// from fhir.resource_history at `version`. `seq` (bigserial) is this stream's pull-cursor axis.
export interface SyncAmendmentsTable {
  seq: Generated<number>;
  site_id: string;
  resource_type: string;
  resource_id: string;
  version: number;
  recorded_at: Generated<Date>;
}
```

Then add this member inside `InternalSchema` (next to `reference_change_log`):

```typescript
  sync_amendments: SyncAmendmentsTable;
```

- [ ] **Step 6: Update the migrations registration test**

`packages/db/src/migrations/migrations.test.ts` asserts the exact ordered key list. Append `'054_sync_amendments'` to the end of the expected array in that test.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations/internal/054_sync_amendments.test.ts src/migrations/internal/migrations.test.ts`
Expected: PASS (both files).

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/migrations/internal/054_sync_amendments.ts packages/db/src/migrations/internal/054_sync_amendments.test.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts packages/db/src/migrations/internal/migrations.test.ts
git commit -m "feat(db): sync_amendments outbox table (sync S6a)"
```

---

## Task 2: `FhirStore.amend` primitive

**Files:**
- Modify: `packages/db/src/fhir-store.ts`
- Test: `packages/db/src/fhir-store-amend.test.ts`

The primitive: read the current canonical body, resolve the owning lab from the latest `change_log.site_id`, refuse if not lab-owned, write a new version (`max(history)+1`) keeping the lab's `site_id`, write a `Provenance` resource (version 1), and insert both `sync_amendments` rows — all in one transaction.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/db/src/fhir-store-amend.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import { Kysely } from 'kysely';
import { createFhirStore, ResourceNotFoundError, NotLabOwnedError } from './fhir-store';
import { migrateToLatestInternal } from './migrations/internal'; // existing helper that runs all up()s

// Helper: build a pg-mem internal DB with the full internal schema migrated.
async function memDb(): Promise<Kysely<any>> {
  const mem = newDb();
  const db = new Kysely<any>({ dialect: mem.adapter.createKyselyDialect() });
  await migrateToLatestInternal(db); // runs 001..054
  return db;
}

describe('FhirStore.amend', () => {
  let db: Kysely<any>;
  beforeEach(async () => {
    db = await memDb();
  });

  it('amends a lab-owned resource: bumps version, preserves site_id, writes Provenance + 2 outbox rows', async () => {
    const store = createFhirStore(db);
    // Seed a lab-owned Observation via the mirror path (origin version 1, site lab-a).
    await store.applyRemote({
      resourceType: 'Observation',
      id: 'obs-1',
      version: 1,
      op: 'upsert',
      siteId: 'lab-a',
      resource: { resourceType: 'Observation', id: 'obs-1', status: 'preliminary' } as any,
    });

    const result = await store.amend({
      resourceType: 'Observation',
      id: 'obs-1',
      status: 'amended',
      patch: { valueString: 'corrected' },
      agent: 'central-reviewer',
      reason: 'value re-validated',
    });

    expect(result.version).toBe(2);
    expect(result.siteId).toBe('lab-a');
    expect(result.provenanceId).toBeTruthy();

    // Amended resource: new version, status flipped, patch applied, meta.versionId bumped.
    const obs = (await store.get('Observation', 'obs-1')) as any;
    expect(obs.status).toBe('amended');
    expect(obs.valueString).toBe('corrected');
    expect(obs.meta.versionId).toBe('2');

    // change_log for the amended version keeps the LAB's site_id (still lab-owned).
    const cl = await db
      .selectFrom('fhir.change_log')
      .select(['site_id', 'version'])
      .where('resource_type', '=', 'Observation')
      .where('resource_id', '=', 'obs-1')
      .where('version', '=', 2)
      .executeTakeFirstOrThrow();
    expect(cl.site_id).toBe('lab-a');

    // Provenance resource created, targeting the amended resource.
    const prov = (await store.get('Provenance', result.provenanceId)) as any;
    expect(prov.resourceType).toBe('Provenance');
    expect(prov.target[0].reference).toBe('Observation/obs-1');
    expect(prov.agent[0].who.display).toBe('central-reviewer');

    // Two outbox rows, both routed to lab-a.
    const outbox = await db.selectFrom('sync_amendments').selectAll().where('site_id', '=', 'lab-a').orderBy('seq', 'asc').execute();
    expect(outbox.map((r) => r.resource_type)).toEqual(['Observation', 'Provenance']);
    expect(Number(outbox[0].version)).toBe(2);
    expect(Number(outbox[1].version)).toBe(1);
  });

  it('rejects amending a resource that does not exist', async () => {
    const store = createFhirStore(db);
    await expect(store.amend({ resourceType: 'Observation', id: 'nope', status: 'amended', agent: 'c' })).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it('rejects amending a resource with no owning site (central-owned / unsynced)', async () => {
    const store = createFhirStore(db);
    // save() with no sync.site_id configured → change_log.site_id is null → not lab-owned.
    await store.save({ resourceType: 'Observation', id: 'local-1', status: 'final' } as any);
    await expect(store.amend({ resourceType: 'Observation', id: 'local-1', status: 'amended', agent: 'c' })).rejects.toBeInstanceOf(NotLabOwnedError);
  });
});
```

> Note: confirm the internal-migrations runner helper name. If `migrateToLatestInternal` does not exist, use the existing pattern other `fhir-store` tests use to build a migrated pg-mem DB (grep the test dir for how `createFhirStore` tests set up their schema) and mirror it — the assertions above are unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/db exec vitest run src/fhir-store-amend.test.ts`
Expected: FAIL — `createFhirStore(...).amend is not a function` / missing `ResourceNotFoundError` export.

- [ ] **Step 3: Add types + errors + the interface method**

In `packages/db/src/fhir-store.ts`, add near the other exported interfaces (after `RemoteRecord`):

```typescript
// Distributed sync S6a: input to a central-authored amendment of a lab-owned resource.
export interface AmendInput {
  resourceType: string;
  id: string;
  status: string; // e.g. 'amended' | 'corrected'
  patch?: Record<string, unknown>; // shallow-merged into the current resource body
  agent: string; // Provenance agent.who.display (who authored the amendment)
  reason?: string; // Provenance reason text
}

export interface AmendResult {
  version: number; // new version of the amended resource
  provenanceId: string; // id of the created Provenance resource
  siteId: string; // owning lab (routing key)
}

export class ResourceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResourceNotFoundError';
  }
}

export class NotLabOwnedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotLabOwnedError';
  }
}
```

Add the method to the `FhirStore` interface (after `applyRemote`):

```typescript
  // Sync S6a: author a central amendment of a lab-owned resource — new version (keeping the owning
  // lab's site_id) + a Provenance resource + two sync_amendments outbox rows, all in one transaction.
  amend(input: AmendInput): Promise<AmendResult>;
```

- [ ] **Step 4: Implement `amend` in `createFhirStore`**

Add this method to the returned object in `createFhirStore` (after `applyRemote`). It uses two local helpers — define them as inner `async function`s just above the `return {` (alongside `resolveSiteId`), so both `amend` and its writes share them:

```typescript
  // Sync S6a helpers. nextVersion mirrors save()/delete() (max history + 1, monotonic across
  // delete→recreate). writeVersion is the 3-write version-append sequence (history → canonical →
  // change_log, in that order so change_log is never the txn's first write — the projection
  // safe-frontier invariant), stamped with an EXPLICIT siteId (the owning lab's, not resolveSiteId()).
  async function nextVersion(trx: Kysely<InternalSchema>, resourceType: string, id: string): Promise<number> {
    const hi = await trx
      .selectFrom('fhir.resource_history')
      .select(sql<number>`coalesce(max(version), 0)`.as('maxv'))
      .where('resource_type', '=', resourceType)
      .where('id', '=', id)
      .executeTakeFirst();
    return Number(hi?.maxv ?? 0) + 1;
  }
  async function writeVersion(
    trx: Kysely<InternalSchema>,
    v: { resourceType: string; id: string; version: number; body: Record<string, unknown>; siteId: string },
  ): Promise<void> {
    const serialized = JSON.stringify(v.body);
    const contentHashHex = contentHash(serialized);
    await trx
      .insertInto('fhir.resource_history')
      .values({ resource_type: v.resourceType, id: v.id, version: v.version, op: 'upsert', resource: serialized })
      .execute();
    await trx
      .insertInto('fhir.fhir_resources')
      .values({ resource_type: v.resourceType, id: v.id, version: v.version, version_id: String(v.version), resource: serialized })
      .onConflict((oc) =>
        oc.columns(['resource_type', 'id']).doUpdateSet({
          version: v.version,
          version_id: String(v.version),
          resource: serialized,
          updated_at: sql`now()`,
        }),
      )
      .execute();
    await trx
      .insertInto('fhir.change_log')
      .values({ resource_type: v.resourceType, resource_id: v.id, version: v.version, op: 'upsert', content_hash: contentHashHex, site_id: v.siteId })
      .execute();
  }
```

Then the method itself:

```typescript
    async amend(input) {
      const { resourceType, id, status, patch, agent, reason } = input;
      const provenanceId = randomUUID();
      const result = await db.transaction().execute(async (trx): Promise<AmendResult> => {
        // 1. Current canonical body must exist.
        const cur = await trx
          .selectFrom('fhir.fhir_resources')
          .select('resource')
          .where('resource_type', '=', resourceType)
          .where('id', '=', id)
          .executeTakeFirst();
        if (!cur) throw new ResourceNotFoundError(`${resourceType}/${id} not found`);

        // 2. Owning lab = latest change_log site_id for this resource. Central may amend ONLY a
        //    lab-owned (synced-up) resource, never its own reference data (which has an empty site).
        const owner = await trx
          .selectFrom('fhir.change_log')
          .select('site_id')
          .where('resource_type', '=', resourceType)
          .where('resource_id', '=', id)
          .orderBy('version', 'desc')
          .limit(1)
          .executeTakeFirst();
        const siteId = owner?.site_id ?? '';
        if (!siteId) throw new NotLabOwnedError(`${resourceType}/${id} is not lab-owned`);

        const nowIso = new Date().toISOString();
        const base = cur.resource as Record<string, unknown>;

        // 3. Amended resource: current body + patch + status + bumped meta.versionId.
        const amendedVersion = await nextVersion(trx, resourceType, id);
        const amendedBody: Record<string, unknown> = {
          ...base,
          ...(patch ?? {}),
          id,
          status,
          meta: { ...(base.meta as Record<string, unknown> | undefined), versionId: String(amendedVersion), lastUpdated: nowIso },
        };
        await writeVersion(trx, { resourceType, id, version: amendedVersion, body: amendedBody, siteId });

        // 4. Provenance resource (new resource → version 1), targeting the amended resource.
        const provBody: Record<string, unknown> = {
          resourceType: 'Provenance',
          id: provenanceId,
          target: [{ reference: `${resourceType}/${id}` }],
          recorded: nowIso,
          activity: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation', code: 'AMEND', display: 'amend' }] },
          agent: [{ who: { display: agent } }],
          ...(reason ? { reason: [{ text: reason }] } : {}),
          meta: { versionId: '1', lastUpdated: nowIso },
        };
        await writeVersion(trx, { resourceType: 'Provenance', id: provenanceId, version: 1, body: provBody, siteId });

        // 5. Outbox rows (amended resource + Provenance) → the owning lab's amendment pull stream.
        await trx
          .insertInto('sync_amendments')
          .values([
            { site_id: siteId, resource_type: resourceType, resource_id: id, version: amendedVersion },
            { site_id: siteId, resource_type: 'Provenance', resource_id: provenanceId, version: 1 },
          ])
          .execute();

        return { version: amendedVersion, provenanceId, siteId };
      });
      // Best-effort projection-worker wakeup (matches save()/applyRemote()).
      try { await sql`select pg_notify('fhir_changes', '')`.execute(db); } catch { /* ignore */ }
      return result;
    },
```

- [ ] **Step 5: Export the new symbols from the package barrel if needed**

Check `packages/db/src/index.ts` — if it re-exports fhir-store symbols explicitly (e.g. `export { createFhirStore, type RemoteRecord } from './fhir-store'`), add `type AmendInput, type AmendResult, ResourceNotFoundError, NotLabOwnedError` to that export list. If it uses `export * from './fhir-store'`, no change is needed.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @openldr/db exec vitest run src/fhir-store-amend.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 7: Run the db package typecheck**

Run: `pnpm --filter @openldr/db exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/fhir-store.ts packages/db/src/fhir-store-amend.test.ts packages/db/src/index.ts
git commit -m "feat(db): FhirStore.amend — central result amendment primitive (sync S6a)"
```

---

## Task 3: `AmendmentPullResponse` wire type

**Files:**
- Modify: `packages/sync/src/batch.ts`
- Test: `packages/sync/src/batch.test.ts` (add a compile-level assertion; if no such file, fold into Task 4's runner test)

- [ ] **Step 1: Add the wire type**

In `packages/sync/src/batch.ts`, add after the `PullResponse` interface:

```typescript
// Sync S6a: central serves amendment records DOWN to the owning lab — the SAME SyncRecord shape S1
// push carries UP (version + siteId verbatim from the origin), plus the sync_amendments seq. The lab
// applies each via fhirStore.applyRemote (higher version wins, idempotent). The request reuses
// PullRequest ({ fromSeq }); the cursor axis is the lab's 'sync-amend-pull' high-water-mark.
export interface AmendmentPullResponse {
  records: (SyncRecord & { seq: number })[];
  nextSeq: number;
}
```

- [ ] **Step 2: Export it**

In `packages/sync/src/index.ts`, ensure `AmendmentPullResponse` is exported. If the file re-exports batch types explicitly, add it; if it uses `export * from './batch'`, no change is needed.

- [ ] **Step 3: Typecheck the sync package**

Run: `pnpm --filter @openldr/sync exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/sync/src/batch.ts packages/sync/src/index.ts
git commit -m "feat(sync): AmendmentPullResponse wire type (sync S6a)"
```

---

## Task 4: `serveAmendments` — the site-scoped serve

**Files:**
- Modify: `packages/bootstrap/src/sync-serve.ts`
- Test: `packages/bootstrap/src/sync-serve-amend.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/bootstrap/src/sync-serve-amend.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import { Kysely } from 'kysely';
import { createFhirStore, migrateToLatestInternal } from '@openldr/db';
import { serveAmendments } from './sync-serve';

// Minimal AppContext stub: serveAmendments only touches ctx.internalDb + ctx.logger.
function stubCtx(db: Kysely<any>): any {
  return { internalDb: db, logger: { warn() {}, info() {}, error() {} } };
}

describe('serveAmendments', () => {
  let db: Kysely<any>;
  beforeEach(async () => {
    db = new Kysely<any>({ dialect: newDb().adapter.createKyselyDialect() });
    await migrateToLatestInternal(db);
  });

  it('serves only the requesting site\'s amendments, as SyncRecords with live bodies', async () => {
    const store = createFhirStore(db);
    // lab-a owns obs-1; lab-b owns obs-2.
    await store.applyRemote({ resourceType: 'Observation', id: 'obs-1', version: 1, op: 'upsert', siteId: 'lab-a', resource: { resourceType: 'Observation', id: 'obs-1', status: 'preliminary' } as any });
    await store.applyRemote({ resourceType: 'Observation', id: 'obs-2', version: 1, op: 'upsert', siteId: 'lab-b', resource: { resourceType: 'Observation', id: 'obs-2', status: 'preliminary' } as any });
    const a = await store.amend({ resourceType: 'Observation', id: 'obs-1', status: 'amended', agent: 'c' });
    await store.amend({ resourceType: 'Observation', id: 'obs-2', status: 'amended', agent: 'c' });

    const resp = await serveAmendments(stubCtx(db), 'lab-a', 0);

    // Only lab-a's amendment + its Provenance (2 records), none of lab-b's.
    expect(resp.records).toHaveLength(2);
    for (const r of resp.records) {
      expect(r.siteId).toBe('lab-a');
      expect(r.op).toBe('upsert');
      expect(r.resource).toBeTruthy();
    }
    const obs = resp.records.find((r) => r.resourceType === 'Observation');
    expect(obs?.version).toBe(a.version);
    expect((obs?.resource as any).status).toBe('amended');
    expect(resp.nextSeq).toBeGreaterThan(0);
  });

  it('pages by seq: a fromSeq at the last served seq returns nothing more', async () => {
    const store = createFhirStore(db);
    await store.applyRemote({ resourceType: 'Observation', id: 'obs-1', version: 1, op: 'upsert', siteId: 'lab-a', resource: { resourceType: 'Observation', id: 'obs-1', status: 'preliminary' } as any });
    await store.amend({ resourceType: 'Observation', id: 'obs-1', status: 'amended', agent: 'c' });
    const first = await serveAmendments(stubCtx(db), 'lab-a', 0);
    const second = await serveAmendments(stubCtx(db), 'lab-a', first.nextSeq);
    expect(second.records).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/sync-serve-amend.test.ts`
Expected: FAIL — `serveAmendments` is not exported.

- [ ] **Step 3: Implement `serveAmendments`**

In `packages/bootstrap/src/sync-serve.ts`, add the `AmendmentPullResponse` and `SyncRecord` imports to the existing `@openldr/sync` import block, then add the function after `servePull`:

```typescript
/** Serve the owning lab's amendment delta after `fromSeq` (Sync S6a). Site-scoped: reads sync_amendments
 *  WHERE site_id = siteId AND seq > fromSeq, deduped to the LATEST version per (resource_type,
 *  resource_id), each body read LIVE from fhir.resource_history at that version. Records use the same
 *  SyncRecord wire shape S1 push carries — the lab applies them via applyRemote. Per-record body fetch is
 *  try/caught (poison-pill isolation): a missing/unreadable history row is skipped, and nextSeq (the max
 *  RAW seq in the window) still advances past it so one bad row cannot wedge the stream. */
export async function serveAmendments(ctx: AppContext, siteId: string, fromSeq: number): Promise<AmendmentPullResponse> {
  const rows = await ctx.internalDb
    .selectFrom('sync_amendments')
    .selectAll()
    .where('site_id', '=', siteId)
    .where('seq', '>', fromSeq)
    .orderBy('seq', 'asc')
    .limit(BATCH)
    .execute();
  const nextSeq = rows.reduce((m, r) => Math.max(m, Number(r.seq)), fromSeq);

  // Dedup to the LATEST row per (resource_type, resource_id) — a resource amended twice in the window
  // collapses to its newest version (applyRemote is monotonic anyway; this just trims payload). A
  // resource and its Provenance have distinct ids, so both survive.
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) latest.set(`${r.resource_type} ${r.resource_id}`, r); // later seq overwrites (asc)

  const records: (SyncRecord & { seq: number })[] = [];
  for (const r of latest.values()) {
    const seq = Number(r.seq);
    const version = Number(r.version);
    let body: unknown;
    try {
      const hist = await ctx.internalDb
        .selectFrom('fhir.resource_history')
        .select('resource')
        .where('resource_type', '=', r.resource_type)
        .where('id', '=', r.resource_id)
        .where('version', '=', version)
        .executeTakeFirst();
      body = hist?.resource ?? null;
    } catch (e) {
      ctx.logger.warn(
        { error: e instanceof Error ? e.message : String(e), resourceType: r.resource_type, resourceId: r.resource_id, seq },
        'sync amend serve: history fetch failed for record, skipping',
      );
      continue;
    }
    if (body == null) continue; // history row vanished — skip; nextSeq still advances past it.
    records.push({
      seq,
      resourceType: r.resource_type,
      id: r.resource_id,
      version,
      op: 'upsert',
      siteId: r.site_id,
      resource: body as SyncRecord['resource'],
    });
  }
  records.sort((a, b) => a.seq - b.seq);
  return { records, nextSeq };
}
```

Update the top-of-file import:

```typescript
import type {
  PullRecord,
  PullResponse,
  ConceptsPage,
  ConceptWire,
  MapElementsPage,
  MapElementWire,
  SyncRecord,
  AmendmentPullResponse,
} from '@openldr/sync';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/sync-serve-amend.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/sync-serve.ts packages/bootstrap/src/sync-serve-amend.test.ts
git commit -m "feat(bootstrap): serveAmendments — site-scoped amendment serve (sync S6a)"
```

---

## Task 5: Amendment pull runner

**Files:**
- Create: `packages/sync/src/amend-pull-worker.ts`
- Modify: `packages/sync/src/index.ts`
- Test: `packages/sync/src/amend-pull-worker.test.ts`

A focused runner: read the `'sync-amend-pull'` cursor, ask central for records after it, apply each via `applyRemote` in seq order, quarantine per-record failures (advance past — amendments are per-row, never hold-the-cursor), advance to `nextSeq` guarded `> cursor`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/sync/src/amend-pull-worker.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createAmendmentPullRunner } from './amend-pull-worker';
import type { AmendmentPullResponse } from './batch';

const silent = { warn() {}, info() {}, error() {} } as any;

function rec(seq: number, id: string) {
  return { seq, resourceType: 'Observation', id, version: 2, op: 'upsert' as const, siteId: 'lab-a', resource: { resourceType: 'Observation', id } as any };
}

describe('createAmendmentPullRunner', () => {
  it('applies records in seq order and advances the cursor to nextSeq', async () => {
    let cursor = 0;
    const applied: string[] = [];
    const resp: AmendmentPullResponse = { records: [rec(5, 'a'), rec(6, 'b')], nextSeq: 6 };
    const runner = createAmendmentPullRunner({
      getToken: async () => 't',
      postPull: async () => resp,
      applyRecord: async (r) => { applied.push(r.id); return 'applied'; },
      readCursor: async () => cursor,
      advanceCursor: async (s) => { cursor = s; },
      logger: silent,
    });
    const n = await runner.runCycle();
    expect(n).toBe(2);
    expect(applied).toEqual(['a', 'b']);
    expect(cursor).toBe(6);
  });

  it('quarantines a failing record and still advances past it (per-row, no hold)', async () => {
    let cursor = 0;
    const resp: AmendmentPullResponse = { records: [rec(5, 'bad'), rec(6, 'good')], nextSeq: 6 };
    const runner = createAmendmentPullRunner({
      getToken: async () => 't',
      postPull: async () => resp,
      applyRecord: async (r) => { if (r.id === 'bad') throw new Error('boom'); return 'applied'; },
      readCursor: async () => cursor,
      advanceCursor: async (s) => { cursor = s; },
      logger: silent,
    });
    await runner.runCycle();
    expect(cursor).toBe(6); // advanced past the quarantined record
  });

  it('holds the cursor on a transport/token failure (retry next cycle)', async () => {
    let cursor = 3;
    const runner = createAmendmentPullRunner({
      getToken: async () => { throw new Error('token down'); },
      postPull: async () => ({ records: [], nextSeq: 0 }),
      applyRecord: async () => 'applied',
      readCursor: async () => cursor,
      advanceCursor: async (s) => { cursor = s; },
      logger: silent,
    });
    const n = await runner.runCycle();
    expect(n).toBe(0);
    expect(cursor).toBe(3); // unchanged
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/sync exec vitest run src/amend-pull-worker.test.ts`
Expected: FAIL — `Cannot find module './amend-pull-worker'`.

- [ ] **Step 3: Implement the runner**

```typescript
// packages/sync/src/amend-pull-worker.ts
import type { Logger } from '@openldr/db';
import type { PullRequest, AmendmentPullResponse, SyncRecord } from './batch';

// Injected deps for the amendment pull runner (Sync S6a). Kept pure over its deps (fakeable in tests).
// The bootstrap host wires applyRecord to fhirStore.applyRemote, postPull to POST
// /api/sync/pull-amendments, and cursor deps to the 'sync-amend-pull' consumer.
export interface AmendPullDeps {
  postPull: (req: PullRequest, token: string) => Promise<AmendmentPullResponse>;
  getToken: () => Promise<string>;
  applyRecord: (rec: SyncRecord & { seq: number }) => Promise<'applied' | 'skipped'>;
  readCursor: () => Promise<number>; // change_cursors consumer 'sync-amend-pull'
  advanceCursor: (seq: number) => Promise<void>;
  logger: Logger;
}

export interface AmendmentPullRunner {
  runCycle(): Promise<number>;
}

/** A stateful amendment pull runner. Each cycle reads the 'sync-amend-pull' cursor, asks central for the
 *  ordered window of amendments after it, and applies each in seq order via applyRemote (higher version
 *  wins, idempotent). Failure model mirrors the reference pull runner MINUS the hold policy: amendments
 *  are per-row, so a transport/token failure (getToken INSIDE the try) holds the cursor for a full-window
 *  retry, while a per-record apply failure is quarantined (logged + skipped) and the cursor advances PAST
 *  it — one bad record can never wedge the stream. Advances to central's nextSeq, guarded `> cursor`. */
export function createAmendmentPullRunner(deps: AmendPullDeps): AmendmentPullRunner {
  return {
    async runCycle(): Promise<number> {
      const cursor = await deps.readCursor();
      let resp: AmendmentPullResponse;
      try {
        const token = await deps.getToken();
        resp = await deps.postPull({ fromSeq: cursor }, token);
      } catch (err) {
        deps.logger.warn({ err: (err as Error).message }, 'sync amend pull failed; cursor not advanced (will retry)');
        return 0;
      }
      if (resp.records.length === 0) return 0;

      let safeSeq = cursor;
      let applied = 0;
      for (const rec of resp.records) {
        try {
          await deps.applyRecord(rec);
          applied++;
          safeSeq = rec.seq;
        } catch (err) {
          deps.logger.warn(
            { err: (err as Error).message, resourceType: rec.resourceType, id: rec.id, seq: rec.seq },
            'sync amend pull: apply failed; skipping (quarantine)',
          );
          safeSeq = rec.seq; // quarantined record is handled — safe to advance past it
        }
      }
      const target = Math.max(safeSeq, resp.nextSeq);
      if (target > cursor) await deps.advanceCursor(target);
      return applied;
    },
  };
}
```

- [ ] **Step 4: Export it**

In `packages/sync/src/index.ts`, add (or extend the existing barrel):

```typescript
export { createAmendmentPullRunner, type AmendPullDeps, type AmendmentPullRunner } from './amend-pull-worker';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/sync exec vitest run src/amend-pull-worker.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 6: Commit**

```bash
git add packages/sync/src/amend-pull-worker.ts packages/sync/src/amend-pull-worker.test.ts packages/sync/src/index.ts
git commit -m "feat(sync): amendment pull runner (sync S6a)"
```

---

## Task 6: `POST /api/sync/pull-amendments` route (machine, site-scoped)

**Files:**
- Modify: `apps/server/src/sync-routes.ts`
- Test: `apps/server/src/sync-routes.test.ts` (extend the existing route test file; if none, create `apps/server/src/sync-routes-amend.test.ts`)

- [ ] **Step 1: Write the failing test**

Mirror the existing sync-route tests' harness (they build a Fastify app with a fake `ctx` whose `auth.verifyToken` returns a `site_id` claim). Add:

```typescript
// in apps/server/src/sync-routes.test.ts (or a new sync-routes-amend.test.ts using the same harness)
it('POST /api/sync/pull-amendments serves the token site\'s amendments', async () => {
  // ctx.serveAmendments is provided by @openldr/bootstrap; here the fake ctx stubs it to assert wiring.
  const app = buildApp({
    auth: { verifyToken: async () => ({ site_id: 'lab-a' }) },
    // The route calls serveAmendments(ctx, siteId, fromSeq); stub via a spy on the bootstrap import is
    // not possible, so this test asserts the route passes the token site + sanitized fromSeq through by
    // seeding a real internalDb. Prefer the integration-style harness the other sync-route tests use.
  });
  const res = await app.inject({
    method: 'POST',
    url: '/api/sync/pull-amendments',
    headers: { authorization: 'Bearer valid' },
    payload: { fromSeq: 0 },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(Array.isArray(body.records)).toBe(true);
  expect(typeof body.nextSeq).toBe('number');
});

it('rejects a token with no site_id claim (403)', async () => {
  const app = buildApp({ auth: { verifyToken: async () => ({}) } });
  const res = await app.inject({ method: 'POST', url: '/api/sync/pull-amendments', headers: { authorization: 'Bearer valid' }, payload: { fromSeq: 0 } });
  expect(res.statusCode).toBe(403);
});
```

> Follow whatever `buildApp`/fake-ctx pattern the existing `sync-routes` tests use (grep the file for how `/api/sync/pull` is tested and copy it — the route reuses the identical `sitePrincipal`). The site-scoping assertion (lab-a sees only lab-a) is fully covered by Task 4's `serveAmendments` unit test; this task's tests assert the route's auth gate + wiring only.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server exec vitest run src/sync-routes.test.ts`
Expected: FAIL — route returns 404 (not registered).

- [ ] **Step 3: Implement the route**

In `apps/server/src/sync-routes.ts`, add `serveAmendments` to the `@openldr/bootstrap` import, then add this handler inside `registerSyncRoutes` (after the `/api/sync/pull` handler):

```typescript
  // POST /api/sync/pull-amendments — the owning lab's amendment delta since its 'sync-amend-pull'
  // cursor (Sync S6a). Machine-authed AND site-scoped: sitePrincipal derives site_id from the token and
  // serveAmendments filters to it — a lab can only ever pull its OWN amendments (mirror of push's
  // cross-site write rejection). Records use the SyncRecord wire shape; the lab applies via applyRemote.
  app.post('/api/sync/pull-amendments', async (req, reply) => {
    const principal = await sitePrincipal(req, reply, ctx);
    if (!principal) return; // reply already sent (401/403)

    const rawFrom = (req.body as { fromSeq?: unknown } | undefined)?.fromSeq;
    const fromSeq = typeof rawFrom === 'number' && Number.isFinite(rawFrom) ? rawFrom : 0;

    const { records, nextSeq } = await serveAmendments(ctx, principal.siteId, fromSeq);
    reply.code(200).send({ records, nextSeq });
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/server exec vitest run src/sync-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/sync-routes.ts apps/server/src/sync-routes.test.ts
git commit -m "feat(server): POST /api/sync/pull-amendments — site-scoped amendment pull (sync S6a)"
```

---

## Task 7: `POST /api/settings/sync/amend` route (lab_admin)

**Files:**
- Modify: `apps/server/src/settings-routes.ts`
- Test: `apps/server/src/settings-sync-routes.test.ts` (extend the existing settings-sync route test)

- [ ] **Step 1: Write the failing test**

Using the existing settings-route test harness (fake `ctx` with `fhirStore.amend`, `requireRole` stubbed to pass):

```typescript
it('POST /api/settings/sync/amend amends via fhirStore.amend and audits', async () => {
  const amend = vi.fn(async () => ({ version: 2, provenanceId: 'prov-1', siteId: 'lab-a' }));
  const app = buildSettingsApp({ fhirStore: { amend } });
  const res = await app.inject({
    method: 'POST',
    url: '/api/settings/sync/amend',
    payload: { resourceType: 'Observation', id: 'obs-1', status: 'amended', reason: 'x' },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ version: 2, provenanceId: 'prov-1', siteId: 'lab-a' });
  expect(amend).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'Observation', id: 'obs-1', status: 'amended' }));
});

it('maps ResourceNotFoundError → 404 and NotLabOwnedError → 409', async () => {
  const app404 = buildSettingsApp({ fhirStore: { amend: async () => { const e = new Error('nf'); e.name = 'ResourceNotFoundError'; throw e; } } });
  expect((await app404.inject({ method: 'POST', url: '/api/settings/sync/amend', payload: { resourceType: 'Observation', id: 'x', status: 'amended' } })).statusCode).toBe(404);
  const app409 = buildSettingsApp({ fhirStore: { amend: async () => { const e = new Error('no'); e.name = 'NotLabOwnedError'; throw e; } } });
  expect((await app409.inject({ method: 'POST', url: '/api/settings/sync/amend', payload: { resourceType: 'Observation', id: 'x', status: 'amended' } })).statusCode).toBe(409);
});

it('rejects missing resourceType/id/status with 400', async () => {
  const app = buildSettingsApp({ fhirStore: { amend: async () => ({ version: 2, provenanceId: 'p', siteId: 'lab-a' }) } });
  expect((await app.inject({ method: 'POST', url: '/api/settings/sync/amend', payload: { id: 'obs-1' } })).statusCode).toBe(400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server exec vitest run src/settings-sync-routes.test.ts`
Expected: FAIL — route 404.

- [ ] **Step 3: Implement the route**

In `apps/server/src/settings-routes.ts`, add after the `/api/settings/sync/now` handler:

```typescript
  // POST /api/settings/sync/amend — a central operator amends a lab-owned result (Sync S6a). User-authed
  // + lab_admin (this is a central-side authoring action), deliberately NOT under /api/sync/* (that
  // surface is machine-cred). fhirStore.amend does the transactional version-bump + Provenance + outbox
  // write, keeping the owning lab's site_id; the amendment then flows down that lab's pull-amendments
  // stream. Audited SECRET/PHI-free: resource reference + new version only.
  app.post('/api/settings/sync/amend', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const b = (req.body ?? {}) as { resourceType?: unknown; id?: unknown; status?: unknown; reason?: unknown; patch?: unknown; agent?: unknown };
    if (typeof b.resourceType !== 'string' || !b.resourceType || typeof b.id !== 'string' || !b.id || typeof b.status !== 'string' || !b.status) {
      reply.code(400).send({ error: 'resourceType, id and status are required' });
      return;
    }
    try {
      const result = await ctx.fhirStore.amend({
        resourceType: b.resourceType,
        id: b.id,
        status: b.status,
        reason: typeof b.reason === 'string' ? b.reason : undefined,
        patch: b.patch && typeof b.patch === 'object' ? (b.patch as Record<string, unknown>) : undefined,
        agent: typeof b.agent === 'string' && b.agent ? b.agent : 'central',
      });
      await recordAudit(ctx, req, {
        action: 'settings.sync.amend',
        entityType: b.resourceType,
        entityId: b.id,
        metadata: { version: result.version, provenanceId: result.provenanceId, siteId: result.siteId },
      });
      reply.code(200).send(result);
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      if (name === 'ResourceNotFoundError') { reply.code(404).send({ error: 'resource not found' }); return; }
      if (name === 'NotLabOwnedError') { reply.code(409).send({ error: 'resource is not lab-owned' }); return; }
      throw e; // unknown → 500 via the global handler
    }
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/server exec vitest run src/settings-sync-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/settings-routes.ts apps/server/src/settings-sync-routes.test.ts
git commit -m "feat(server): POST /api/settings/sync/amend — central amend endpoint (sync S6a)"
```

---

## Task 8: `openldr sync amend` CLI

**Files:**
- Modify: `packages/cli/src/sync.ts`
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/src/sync-amend.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/src/sync-amend.test.ts
import { describe, it, expect, vi } from 'vitest';

const amend = vi.fn(async () => ({ version: 2, provenanceId: 'prov-1', siteId: 'lab-a' }));
const close = vi.fn(async () => {});
vi.mock('@openldr/bootstrap', () => ({ createAppContext: async () => ({ fhirStore: { amend }, close }) }));
vi.mock('@openldr/config', () => ({ loadConfig: () => ({}) }));

import { runSyncAmend } from './sync';

describe('runSyncAmend', () => {
  it('calls fhirStore.amend and returns 0 on success', async () => {
    const code = await runSyncAmend({ resourceType: 'Observation', id: 'obs-1', status: 'amended', reason: 'x', json: true });
    expect(code).toBe(0);
    expect(amend).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'Observation', id: 'obs-1', status: 'amended' }));
    expect(close).toHaveBeenCalled();
  });

  it('returns 1 when required options are missing', async () => {
    const code = await runSyncAmend({ resourceType: '', id: '', status: '', json: true });
    expect(code).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/cli exec vitest run src/sync-amend.test.ts`
Expected: FAIL — `runSyncAmend` not exported.

- [ ] **Step 3: Implement `runSyncAmend`**

In `packages/cli/src/sync.ts`, add (after `runSyncRevoke`):

```typescript
// `openldr sync amend` — central-side result amendment (Sync S6a). Writes a new version of a lab-owned
// resource + a Provenance + the amendment outbox rows; the owning lab pulls it down. Runs on central.
export async function runSyncAmend(opts: {
  resourceType?: string;
  id?: string;
  status?: string;
  reason?: string;
  patch?: string;
  agent?: string;
  json?: boolean;
}): Promise<number> {
  const json = opts.json ?? false;
  if (!opts.resourceType || !opts.id || !opts.status) {
    return fail(json, '--resource-type, --id and --status are required');
  }
  let patch: Record<string, unknown> | undefined;
  if (opts.patch) {
    try {
      patch = JSON.parse(opts.patch) as Record<string, unknown>;
    } catch {
      return fail(json, '--patch must be valid JSON');
    }
  }
  const ctx = await createAppContext(loadConfig());
  try {
    const result = await ctx.fhirStore.amend({
      resourceType: opts.resourceType,
      id: opts.id,
      status: opts.status,
      reason: opts.reason,
      patch,
      agent: opts.agent ?? 'central',
    });
    emit(json, result, [
      `resource    = ${opts.resourceType}/${opts.id}`,
      `version     = ${result.version}`,
      `provenance  = ${result.provenanceId}`,
      `owningSite  = ${result.siteId}`,
    ].join('\n'));
    return 0;
  } catch (err) {
    switch (err instanceof Error ? err.name : '') {
      case 'ResourceNotFoundError':
        return fail(json, 'resource not found');
      case 'NotLabOwnedError':
        return fail(json, 'resource is not lab-owned (central can only amend synced-up results)');
      default:
        return fail(json, `sync amend failed: ${redactError(err)}`);
    }
  } finally {
    await ctx.close();
  }
}
```

- [ ] **Step 4: Register the CLI command**

In `packages/cli/src/index.ts`, add `runSyncAmend` to the import from `./sync` (line 22), then add this after the `sync revoke` command registration (around line 183, inside the `syncGroup` block):

```typescript
syncGroup.command('amend')
  .description('Amend a lab-owned result (central) — new version + Provenance, routed to the owning lab')
  .requiredOption('--resource-type <type>', 'FHIR resource type (e.g. Observation)')
  .requiredOption('--id <id>', 'resource id')
  .requiredOption('--status <status>', "new status (e.g. 'amended' or 'corrected')")
  .option('--reason <text>', 'amendment reason (recorded on the Provenance)')
  .option('--patch <json>', 'JSON object shallow-merged into the resource body')
  .option('--agent <name>', 'amending agent name (Provenance agent.who.display)', 'central')
  .option('--json', 'emit JSON', false)
  .action(async (opts) => {
    try { process.exitCode = await runSyncAmend(opts); } catch (err) { process.stderr.write(`sync amend failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/cli exec vitest run src/sync-amend.test.ts`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/sync.ts packages/cli/src/index.ts packages/cli/src/sync-amend.test.ts
git commit -m "feat(cli): openldr sync amend (sync S6a)"
```

---

## Task 9: Wire the amendment runner into the pull host loop

**Files:**
- Modify: `packages/bootstrap/src/index.ts`

The existing pull host loop (one interval worker) will drain reference config first, then amendments — a single loop, two streams. No new worker host; `runCycle` composes the two runners.

- [ ] **Step 1: Add the import**

In `packages/bootstrap/src/index.ts`, extend the `@openldr/sync` import (line 40) to include `createAmendmentPullRunner`:

```typescript
import { createSyncPushRunner, createSyncPullRunner, createAmendmentPullRunner, createSyncTokenProvider, createTerminologyBulkSync, readSyncConfig, type PushBatch, type PushResponse, type SyncConfig } from '@openldr/sync';
```

- [ ] **Step 2: Build the amendment runner and compose the pull cycle**

Inside the `if (shouldStartPull(syncCfg.mode)) { ... }` block, AFTER `syncPullRunner` is constructed and BEFORE `syncPullWorker = createSyncPullWorker({ ... })`, insert:

```typescript
      // Sync S6a: the amendment pull runner — a SECOND stream drained in the same host loop, over its own
      // 'sync-amend-pull' cursor. Wire = SyncRecord (same as push), applied via applyRemote (higher
      // version wins, idempotent). canonicalFhirStore is the same store the server exposes as ctx.fhirStore.
      const amendmentPullRunner = createAmendmentPullRunner({
        getToken: () => tokenProvider.getToken(), // SHARE the token provider instance
        postPull: async (body, token) =>
          (await postJson(`${syncCfg.centralUrl}/api/sync/pull-amendments`, body, token)) as import('@openldr/sync').AmendmentPullResponse,
        applyRecord: (rec) => canonicalFhirStore.applyRemote(rec),
        readCursor: () => readChangeCursor(internal.db, 'sync-amend-pull'),
        advanceCursor: (seq) => advanceChangeCursor(internal.db, 'sync-amend-pull', seq),
        logger,
      });
```

Then change the `syncPullWorker` construction to compose both runners in one cycle:

```typescript
      syncPullWorker = createSyncPullWorker({
        runner: {
          // One host loop drains BOTH downward streams per cycle: reference config first, then amendments.
          // Each runner owns its cursor + failure model; a throw in one is contained by its own try/catch,
          // but to be safe the sum is computed defensively.
          runCycle: async () => {
            const ref = await syncPullRunner.runCycle();
            const amend = await amendmentPullRunner.runCycle();
            return ref + amend;
          },
        },
        intervalMs,
        logger,
      });
      syncPullWorker.start();
```

- [ ] **Step 3: Typecheck the bootstrap package**

Run: `pnpm --filter @openldr/bootstrap exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the bootstrap package tests (no regressions)**

Run: `pnpm --filter @openldr/bootstrap exec vitest run`
Expected: PASS (existing pull-worker tests + the new serveAmendments test).

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): drain the amendment stream in the pull host loop (sync S6a)"
```

---

## Task 10: Two-DB live acceptance harness

**Files:**
- Create: `scripts/sync-amend-live-acceptance.ts`
- Modify: `package.json` (root) — add `sync:amend:accept`

Model this on `scripts/sync-pull-live-acceptance.ts` (two internal DBs, in-process serve/apply, no HTTP — auth/site-scoping is unit-proven in Tasks 6/7). Read that file first to reuse its two-DB bootstrap + PG connection helpers exactly.

- [ ] **Step 1: Write the acceptance script**

```typescript
// scripts/sync-amend-live-acceptance.ts
// Sync S6a end-to-end: lab pushes a preliminary Observation UP → central amends it (new version +
// Provenance + outbox) → lab pulls the amendment DOWN and applies it. Asserts the lab converges to the
// amended version, Provenance lands, ownership (site_id) is preserved, cross-site isolation holds, and a
// re-drain is idempotent. Two Postgres DBs (central + lab), in-process serve/apply (HTTP auth is
// unit-proven). Mirrors scripts/sync-pull-live-acceptance.ts's setup.
import { createFhirStore } from '@openldr/db';
import { serveAmendments } from '@openldr/bootstrap';
import { createAmendmentPullRunner } from '@openldr/sync';
// Reuse the same two-DB connect + migrate helpers sync-pull-live-acceptance.ts uses (copy its header).

async function main(): Promise<void> {
  // 1. Connect + migrate two internal DBs: `central` and `lab`. (Reuse the helper from the sibling script.)
  const central = await connectInternal(process.env.CENTRAL_DATABASE_URL!);
  const lab = await connectInternal(process.env.LAB_DATABASE_URL!);
  const centralStore = createFhirStore(central);
  const labStore = createFhirStore(lab);
  const SITE = 'lab-a';

  // 2. Lab authors a preliminary Observation locally (site stamped via sync.site_id on the lab DB), then
  //    it is mirrored UP to central (simulate the S1 push apply with applyRemote at origin version+site).
  const obs = { resourceType: 'Observation', id: 'obs-amd-1', status: 'preliminary', valueString: 'lo' };
  await labStore.applyRemote({ resourceType: 'Observation', id: obs.id, version: 1, op: 'upsert', siteId: SITE, resource: obs as any });
  await centralStore.applyRemote({ resourceType: 'Observation', id: obs.id, version: 1, op: 'upsert', siteId: SITE, resource: obs as any });

  // 3. Central amends the lab-owned result.
  const amended = await centralStore.amend({ resourceType: 'Observation', id: obs.id, status: 'amended', patch: { valueString: 'hi' }, agent: 'central-reviewer', reason: 'revalidated' });
  assert(amended.version === 2, 'amended version is 2');
  assert(amended.siteId === SITE, 'amendment preserves owning site');

  // 4. Lab pulls its amendment stream (in-process serve + runner apply).
  const ctxCentral: any = { internalDb: central, logger: console };
  let cursor = 0;
  const runner = createAmendmentPullRunner({
    getToken: async () => 'x',
    postPull: async ({ fromSeq }) => serveAmendments(ctxCentral, SITE, fromSeq),
    applyRecord: (rec) => labStore.applyRemote(rec),
    readCursor: async () => cursor,
    advanceCursor: async (s) => { cursor = s; },
    logger: console as any,
  });
  const applied = await runner.runCycle();
  assert(applied === 2, `applied 2 records (got ${applied})`);

  // 5. Assertions at the lab.
  const labObs = (await labStore.get('Observation', obs.id)) as any;
  assert(labObs.status === 'amended', 'lab result is now amended');
  assert(labObs.valueString === 'hi', 'lab result carries the corrected value');
  assert(labObs.meta.versionId === '2', 'lab result is at version 2');
  const labProv = (await labStore.get('Provenance', amended.provenanceId)) as any;
  assert(labProv?.resourceType === 'Provenance', 'Provenance landed at the lab');
  assert(labProv.target[0].reference === `Observation/${obs.id}`, 'Provenance targets the result');
  // change_log at the lab keeps SITE (still lab-owned).
  const cl = await lab.selectFrom('fhir.change_log').select('site_id').where('resource_type', '=', 'Observation').where('resource_id', '=', obs.id).where('version', '=', 2).executeTakeFirstOrThrow();
  assert(cl.site_id === SITE, 'lab change_log for the amendment keeps the owning site');

  // 6. Cross-site isolation: a different site pulls nothing.
  const other = await serveAmendments(ctxCentral, 'lab-b', 0);
  assert(other.records.length === 0, 'a different site sees no amendments');

  // 7. Idempotent re-drain: a second cycle applies nothing new and holds the cursor.
  const again = await runner.runCycle();
  assert(again === 0, 'idempotent re-drain applies nothing');

  console.log('sync:amend:accept PASSED');
  await central.destroy();
  await lab.destroy();
}

// assert + connectInternal: copy from scripts/sync-pull-live-acceptance.ts.
main().catch((e) => { console.error(e); process.exit(1); });
```

> The `connectInternal` + `assert` helpers and the exact env-var names must match `scripts/sync-pull-live-acceptance.ts`. Read that file and copy its header verbatim before filling this in.

- [ ] **Step 2: Add the pnpm script**

In the root `package.json` `scripts` block, next to the other `sync:*:accept` entries, add:

```json
"sync:amend:accept": "tsx scripts/sync-amend-live-acceptance.ts",
```

(Match the exact runner the sibling `sync:pull:accept` script uses — `tsx` or `pnpm exec tsx`.)

- [ ] **Step 3: Run the acceptance harness**

Ensure dev Postgres is up (`docker compose up -d postgres`), then run with two DBs (mirror how `sync:pull:accept` provisions its two DBs — the sibling script documents its env vars):

Run: `pnpm sync:amend:accept`
Expected: `sync:amend:accept PASSED`.

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-amend-live-acceptance.ts package.json
git commit -m "test(sync): S6a amendment two-DB live acceptance harness"
```

---

## Task 11: Docs, gate, and regression

**Files:**
- Modify: `docs/` sync documentation if a sync operations guide exists (grep `docs` for `sync pull` / `/api/sync/pull`)

- [ ] **Step 1: Document the new surfaces**

If a sync operator/API doc exists (e.g. `docs/**/sync*.md`), add: `POST /api/settings/sync/amend` (lab_admin), `POST /api/sync/pull-amendments` (machine, site-scoped), `openldr sync amend`, and the `'sync-amend-pull'` cursor. If none exists, skip — do NOT invent a new doc tree.

- [ ] **Step 2: Full typecheck + test gate (per-package on Windows — never pipe turbo through `tail`)**

Run each and confirm PASS:

```
pnpm --filter @openldr/db exec vitest run
pnpm --filter @openldr/sync exec vitest run
pnpm --filter @openldr/bootstrap exec vitest run
pnpm --filter @openldr/server exec vitest run
pnpm --filter @openldr/cli exec vitest run
```

Then typecheck the touched packages:

```
pnpm --filter @openldr/db exec tsc --noEmit
pnpm --filter @openldr/sync exec tsc --noEmit
pnpm --filter @openldr/bootstrap exec tsc --noEmit
pnpm --filter @openldr/server exec tsc --noEmit
pnpm --filter @openldr/cli exec tsc --noEmit
```

Expected: all green. (If a turbo `--force` full run is used instead, verify any flake by re-running the specific package's `vitest run` directly — see the workstream conventions.)

- [ ] **Step 3: Regression — re-run the prior sync acceptance harnesses**

With dev Postgres + Keycloak up, run the existing harnesses and confirm each still passes:

```
pnpm sync:accept
pnpm sync:pull:accept
pnpm sync:terminology:accept
```

(`sync:enroll:accept` and `sync:bundle:accept` require the live-Keycloak setup documented in the workstream note; run them if that environment is available.)
Expected: each prints its PASSED line.

- [ ] **Step 4: Commit any doc changes**

```bash
git add docs
git commit -m "docs(sync): document S6a amendment surfaces"
```

(Skip if Step 1 made no changes.)

---

## Self-Review (completed during planning)

**Spec coverage:**
- §4.1 `sync_amendments` outbox → Task 1. §4.2 version/site semantics → Task 2 (`amend`). §4.3 Provenance → Task 2. §5 primitive + CLI + endpoint → Tasks 2, 7, 8. §6.1 site-scoped pull (endpoint + cursor + worker + serve + reuse applyRemote) → Tasks 4, 5, 6, 9. §7.2 error isolation (transactional author, serve poison-isolation, per-record quarantine, site-scope) → Tasks 2, 4, 5, 6. §9 testing (unit + round-trip + live acceptance + regression) → Tasks 2, 4, 5, 10, 11. §6.2 bundle parity + §7.1 tie limitation → deferred by spec, no task (correct).
- Not implemented by design (deferred in spec): studio UI, bundle parity, tie-detection, S6b/S6c.

**Type consistency:** `AmendInput`/`AmendResult`/`FhirStore.amend` (Task 2) are used verbatim in Tasks 7, 8, 10. `AmendmentPullResponse` (Task 3) is used in Tasks 4, 5, 9. `createAmendmentPullRunner`/`AmendPullDeps` (Task 5) used in Task 9. `serveAmendments(ctx, siteId, fromSeq)` (Task 4) used in Tasks 6, 10. Cursor consumer `'sync-amend-pull'` consistent in Tasks 5, 9. Error names `ResourceNotFoundError`/`NotLabOwnedError` consistent across Tasks 2, 7, 8, 10.

**Placeholder scan:** the two `> Note:` callouts (Task 2 migration-runner helper name, Task 6/10 harness pattern) point the implementer at an existing pattern to copy rather than leaving logic undefined — the assertions and target behavior are fully specified. All code steps contain complete code.
