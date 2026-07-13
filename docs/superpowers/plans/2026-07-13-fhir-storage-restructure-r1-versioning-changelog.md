# FHIR Storage Restructure — R1: Versioned Canonical + `change_log` Contract — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the internal FHIR store versioned (monotonic per-resource `version` + history + tombstones) and emit an append-only `fhir.change_log` on every write — the frozen contract every downstream consumer binds to.

**Architecture:** Slice **R1** of the restructure (spec: `docs/superpowers/specs/2026-07-13-fhir-storage-restructure-r1-versioning-changelog-design.md`). Builds on R0 (the `fhir` schema). `FhirStore.save` becomes transactional: read current `version` `FOR UPDATE` → `next = +1` → stamp `meta` → upsert canonical + append `resource_history` + emit `change_log`, all in one tx per resource. Adds `FhirStore.delete` (tombstone). The inline flat-writer in the persist path is **left untouched** (R2 removes it), so R1 is purely additive — reports keep working.

**Tech Stack:** TypeScript, Kysely (Postgres), pg-mem (unit tests), Vitest, node:crypto.

**Established facts (verified by spike — do NOT re-derive):**
- pg-mem supports everything R1 needs: `ALTER TABLE … ADD COLUMN version bigint not null default 0`, backfill `UPDATE`, `bigserial` identity (auto-increments + orders), `SELECT … FOR UPDATE` (raw and Kysely `.forUpdate()`), `db.transaction().execute()`, and `node:crypto` sha256.
- **`bigint` columns read back as JS `number` under pg-mem but as `string` under real node-postgres.** Always coerce version reads with `Number(...)` — never assume `number`.
- `makeMigratedDb()` runs only each migration's `up()` (never `down()`), so `up()` must be pg-mem-safe; `down()` runs only on real Postgres (`db reset`) and may use standard PG DDL freely.
- The db package already uses `db.transaction().execute(async (trx) => …)` (`terminology-admin-store.ts:473`) — mirror that.
- Next internal migration number is **046** (045 was the R0 schema move).
- `FhirStore` today has only `save`/`get`/`listByType` (`packages/db/src/fhir-store.ts`); `get`/`listByType` already query `'fhir.fhir_resources'` (R0). `SavedRef` is `{ resourceType, id }`.

---

## File Structure

**Create:**
- `packages/db/src/migrations/internal/046_fhir_versioning.ts` — add `version` column + backfill; create `resource_history`, `change_log`, `change_cursors` (all in `fhir` schema).
- `packages/db/src/migrations/internal/046_fhir_versioning.test.ts` — asserts the new schema exists after migration.
- `packages/db/src/fhir-store-versioning.test.ts` — versioned save, history, change_log, delete, site_id, content_hash.

**Modify:**
- `packages/db/src/migrations/internal/index.ts` — register `046_fhir_versioning`.
- `packages/db/src/migrations/migrations.test.ts` — append `'046_fhir_versioning'` to the expected key list.
- `packages/db/src/schema/internal.ts` — add `version` to `FhirResourcesTable`; add `ResourceHistoryTable`, `ChangeLogTable`, `ChangeCursorsTable` + their dotted `InternalSchema` keys.
- `packages/db/src/fhir-store.ts` — rewrite `save` (transactional + versioned + emits history/change_log); add `delete`; add `resolveSiteId` + `contentHash` helpers; `SavedRef` gains `version`.

---

## Task 1: Migration 046 — versioning schema

**Files:**
- Create: `packages/db/src/migrations/internal/046_fhir_versioning.ts`
- Create: `packages/db/src/migrations/internal/046_fhir_versioning.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/migrations/migrations.test.ts`
- Modify: `packages/db/src/schema/internal.ts`

- [ ] **Step 1: Write the failing migration test**

Create `packages/db/src/migrations/internal/046_fhir_versioning.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedDb } from './test-helpers';

describe('046 fhir versioning schema', () => {
  it('adds version column (backfilled) and creates history + change_log + change_cursors', async () => {
    const db = await makeMigratedDb();

    // version column exists on the canonical table, defaulting to 1 for pre-seeded rows (014 ValueSets)
    const seeded = await db
      .selectFrom('fhir.fhir_resources')
      .select(['id', 'version'])
      .limit(1)
      .execute();
    expect(seeded.length).toBeGreaterThan(0);
    expect(Number(seeded[0].version)).toBe(1);

    // the three new tables accept inserts with the expected columns
    await db
      .insertInto('fhir.resource_history')
      .values({ resource_type: 'Patient', id: 'p1', version: 1, op: 'upsert', resource: JSON.stringify({ resourceType: 'Patient', id: 'p1' }) })
      .execute();
    await db
      .insertInto('fhir.change_log')
      .values({ resource_type: 'Patient', resource_id: 'p1', version: 1, op: 'upsert', content_hash: 'h', site_id: null })
      .execute();
    await db.insertInto('fhir.change_cursors').values({ consumer: 'projection' }).execute();

    const seq = await db.selectFrom('fhir.change_log').select('seq').executeTakeFirstOrThrow();
    expect(Number(seq.seq)).toBeGreaterThanOrEqual(1);

    const cursor = await db.selectFrom('fhir.change_cursors').select(['consumer', 'last_seq']).executeTakeFirstOrThrow();
    expect(cursor.consumer).toBe('projection');
    expect(Number(cursor.last_seq)).toBe(0);

    await db.destroy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations/internal/046_fhir_versioning.test.ts`
Expected: FAIL — `column "version" does not exist` / `relation "fhir"."change_log" does not exist` (046 not written yet).

- [ ] **Step 3: Create the migration**

Create `packages/db/src/migrations/internal/046_fhir_versioning.ts` (raw `sql` DDL — the exact forms the spike verified under pg-mem; `up()` must stay pg-mem-safe, `down()` runs only on real PG):

```ts
import { type Kysely, sql } from 'kysely';

// R1 of the FHIR storage restructure: make the canonical store versioned and emit an
// append-only change-log. All objects live in the `fhir` schema (created in R0). up() uses
// the plain DDL forms verified to run under pg-mem; down() runs only on real Postgres.

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Monotonic per-resource version on the canonical table; backfill existing rows to 1.
  await sql`alter table fhir.fhir_resources add column version bigint not null default 0`.execute(db);
  await sql`update fhir.fhir_resources set version = 1 where version = 0`.execute(db);

  // 2. Append-only per-version history (upserts store the resource; deletes store null = tombstone).
  await sql`create table fhir.resource_history (
    resource_type text not null,
    id text not null,
    version bigint not null,
    op text not null,
    resource jsonb,
    recorded_at timestamptz not null default now(),
    primary key (resource_type, id, version)
  )`.execute(db);

  // 3. Append-only change-log — the frozen contract. seq (bigserial) is the cursor axis.
  await sql`create table fhir.change_log (
    seq bigserial primary key,
    resource_type text not null,
    resource_id text not null,
    version bigint not null,
    op text not null,
    content_hash text,
    site_id text,
    recorded_at timestamptz not null default now()
  )`.execute(db);

  // 4. Per-consumer high-water-mark cursors (created now to freeze the contract; unused until R2).
  await sql`create table fhir.change_cursors (
    consumer text primary key,
    last_seq bigint not null default 0,
    updated_at timestamptz not null default now()
  )`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`drop table if exists fhir.change_cursors`.execute(db);
  await sql`drop table if exists fhir.change_log`.execute(db);
  await sql`drop table if exists fhir.resource_history`.execute(db);
  await sql`alter table fhir.fhir_resources drop column if exists version`.execute(db);
}
```

- [ ] **Step 4: Register the migration**

In `packages/db/src/migrations/internal/index.ts`, add the import with the others: `import * as m046 from './046_fhir_versioning';` and add the map entry after `'045_fhir_schema'`: `'046_fhir_versioning': { up: m046.up, down: m046.down },`

- [ ] **Step 5: Update the migration-map test**

In `packages/db/src/migrations/migrations.test.ts`, append `'046_fhir_versioning'` as the last element of the expected internal-migrations array (after `'045_fhir_schema'`).

- [ ] **Step 6: Add the schema types**

In `packages/db/src/schema/internal.ts`:

(a) Add `version` to `FhirResourcesTable` (right after the `id` field):

```ts
  version: Generated<number>;
```

(b) Add three new table interfaces (place them next to `FhirResourcesTable`):

```ts
export interface ResourceHistoryTable {
  resource_type: string;
  id: string;
  version: number;
  op: string; // 'upsert' | 'delete'
  resource: JSONColumnType<FhirResource> | null; // null for delete tombstones
  recorded_at: Generated<Date>;
}

export interface ChangeLogTable {
  seq: Generated<number>;
  resource_type: string;
  resource_id: string;
  version: number;
  op: string; // 'upsert' | 'delete'
  content_hash: string | null;
  site_id: string | null;
  recorded_at: Generated<Date>;
}

export interface ChangeCursorsTable {
  consumer: string;
  last_seq: Generated<number>;
  updated_at: Generated<Date>;
}
```

(c) Add the three dotted keys to the `InternalSchema` interface (next to the existing `'fhir.fhir_resources'` key):

```ts
  'fhir.resource_history': ResourceHistoryTable;
  'fhir.change_log': ChangeLogTable;
  'fhir.change_cursors': ChangeCursorsTable;
```

- [ ] **Step 7: Run the migration test + full db suite**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations/internal/046_fhir_versioning.test.ts`
Expected: PASS.

Run: `pnpm --filter @openldr/db exec tsc --noEmit`
Expected: PASS (new types compile; existing `fhir-store.ts` still compiles — it doesn't yet set `version`, but `version` is `Generated<number>` so inserts without it are allowed).

Run: `pnpm --filter @openldr/db exec vitest run`
Expected: PASS (all existing suites — the added column has a default, so the current `save` still works).

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/migrations/internal/046_fhir_versioning.ts packages/db/src/migrations/internal/046_fhir_versioning.test.ts packages/db/src/migrations/internal/index.ts packages/db/src/migrations/migrations.test.ts packages/db/src/schema/internal.ts
git commit -m "feat(db): add fhir versioning schema — version column, resource_history, change_log, change_cursors (restructure R1)"
```

---

## Task 2: Transactional versioned `save` + `change_log` emission

**Files:**
- Modify: `packages/db/src/fhir-store.ts`
- Create: `packages/db/src/fhir-store-versioning.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/fhir-store-versioning.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFhirStore } from './fhir-store';

async function changeLog(db: any) {
  return db.selectFrom('fhir.change_log').select(['seq', 'resource_type', 'resource_id', 'version', 'op', 'content_hash', 'site_id']).orderBy('seq').execute();
}

describe('fhir-store versioning', () => {
  it('assigns monotonic version and mirrors meta.versionId', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as any);

    const r1 = await store.save({ resourceType: 'Patient', id: 'p1', name: [{ family: 'A' }] } as never);
    expect(r1.version).toBe(1);
    const r2 = await store.save({ resourceType: 'Patient', id: 'p1', name: [{ family: 'B' }] } as never);
    expect(r2.version).toBe(2);

    const got = await store.get('Patient', 'p1');
    expect((got as any).meta.versionId).toBe('2');
    expect(typeof (got as any).meta.lastUpdated).toBe('string');
    await db.destroy();
  });

  it('appends a history row per save and stores the resource', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as any);
    await store.save({ resourceType: 'Patient', id: 'p1' } as never);
    await store.save({ resourceType: 'Patient', id: 'p1' } as never);

    const hist = await db.selectFrom('fhir.resource_history').select(['version', 'op']).where('resource_type', '=', 'Patient').where('id', '=', 'p1').orderBy('version').execute();
    expect(hist.map((h: any) => Number(h.version))).toEqual([1, 2]);
    expect(hist.every((h: any) => h.op === 'upsert')).toBe(true);
    await db.destroy();
  });

  it('emits one change_log row per save with hash and increasing seq', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as any);
    await store.save({ resourceType: 'Patient', id: 'p1' } as never);
    await store.save({ resourceType: 'Observation', id: 'o1' } as never);

    const log = await changeLog(db);
    // filter to just the two we created (014 seeds do not emit change_log — only save() does)
    const mine = log.filter((r: any) => ['p1', 'o1'].includes(r.resource_id));
    expect(mine.map((r: any) => [r.resource_type, r.resource_id, Number(r.version), r.op])).toEqual([
      ['Patient', 'p1', 1, 'upsert'],
      ['Observation', 'o1', 1, 'upsert'],
    ]);
    expect(mine.every((r: any) => typeof r.content_hash === 'string' && r.content_hash.length === 64)).toBe(true);
    expect(Number(mine[1].seq)).toBeGreaterThan(Number(mine[0].seq));
    await db.destroy();
  });

  it('resolves site_id from app_settings, then env, then null', async () => {
    // app_settings wins
    const db1 = await makeMigratedDb();
    await db1.insertInto('app_settings').values({ key: 'sync.site_id', value: 'lab-A', updated_by: null }).execute();
    await createFhirStore(db1 as any).save({ resourceType: 'Patient', id: 'p1' } as never);
    const l1 = await db1.selectFrom('fhir.change_log').select('site_id').where('resource_id', '=', 'p1').executeTakeFirstOrThrow();
    expect(l1.site_id).toBe('lab-A');
    await db1.destroy();

    // env fallback
    const db2 = await makeMigratedDb();
    process.env.OPENLDR_SITE_ID = 'lab-B';
    await createFhirStore(db2 as any).save({ resourceType: 'Patient', id: 'p2' } as never);
    const l2 = await db2.selectFrom('fhir.change_log').select('site_id').where('resource_id', '=', 'p2').executeTakeFirstOrThrow();
    expect(l2.site_id).toBe('lab-B');
    delete process.env.OPENLDR_SITE_ID;
    await db2.destroy();

    // null when unset
    const db3 = await makeMigratedDb();
    await createFhirStore(db3 as any).save({ resourceType: 'Patient', id: 'p3' } as never);
    const l3 = await db3.selectFrom('fhir.change_log').select('site_id').where('resource_id', '=', 'p3').executeTakeFirstOrThrow();
    expect(l3.site_id).toBeNull();
    await db3.destroy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openldr/db exec vitest run src/fhir-store-versioning.test.ts`
Expected: FAIL — `r1.version` is `undefined` (current `save` returns `{ resourceType, id }` with no `version`, writes no history/change_log).

- [ ] **Step 3: Rewrite `fhir-store.ts`**

Replace the entire contents of `packages/db/src/fhir-store.ts` with:

```ts
import { randomUUID, createHash } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import type { FhirResource } from '@openldr/fhir';
import type { InternalSchema } from './schema/internal';
import type { Provenance } from './provenance';

export interface SavedRef {
  resourceType: string;
  id: string;
  version: number;
}

export interface DeleteResult {
  deleted: boolean;
  version?: number;
}

export interface FhirStore {
  save(resource: FhirResource, provenance?: Provenance): Promise<SavedRef>;
  get(resourceType: string, id: string): Promise<FhirResource | null>;
  listByType(resourceType: string, limit?: number): Promise<{ id: string; resource: FhirResource }[]>;
  delete(resourceType: string, id: string): Promise<DeleteResult>;
}

function contentHash(serialized: string): string {
  return createHash('sha256').update(serialized).digest('hex');
}

export function createFhirStore(db: Kysely<InternalSchema>): FhirStore {
  // site_id is process-stable; resolve once and memoize. undefined = not yet resolved.
  let siteId: string | null | undefined;
  async function resolveSiteId(): Promise<string | null> {
    if (siteId !== undefined) return siteId;
    const row = await db.selectFrom('app_settings').select('value').where('key', '=', 'sync.site_id').executeTakeFirst();
    siteId = row?.value ?? process.env.OPENLDR_SITE_ID ?? null;
    return siteId;
  }

  return {
    async save(resource, provenance = {}) {
      const resourceType = resource.resourceType;
      const id = (resource as { id?: string }).id ?? randomUUID();
      const site = await resolveSiteId();
      return db.transaction().execute(async (trx) => {
        // bigint reads back as string on real pg, number on pg-mem — always coerce.
        const cur = await trx
          .selectFrom('fhir.fhir_resources')
          .select('version')
          .where('resource_type', '=', resourceType)
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        const next = (cur ? Number(cur.version) : 0) + 1;
        const nowIso = new Date().toISOString();
        const meta = { ...(resource as { meta?: Record<string, unknown> }).meta, versionId: String(next), lastUpdated: nowIso };
        const full = { ...resource, id, meta } as FhirResource;
        const serialized = JSON.stringify(full);
        const prov = {
          source_system: provenance.sourceSystem ?? null,
          plugin_id: provenance.pluginId ?? null,
          plugin_version: provenance.pluginVersion ?? null,
          batch_id: provenance.batchId ?? null,
        };
        await trx
          .insertInto('fhir.fhir_resources')
          .values({ resource_type: resourceType, id, version: next, version_id: String(next), resource: serialized, ...prov })
          .onConflict((oc) =>
            oc.columns(['resource_type', 'id']).doUpdateSet({
              version: next,
              version_id: String(next),
              resource: serialized,
              ...prov,
              updated_at: sql`now()`,
            }),
          )
          .execute();
        await trx
          .insertInto('fhir.resource_history')
          .values({ resource_type: resourceType, id, version: next, op: 'upsert', resource: serialized })
          .execute();
        await trx
          .insertInto('fhir.change_log')
          .values({ resource_type: resourceType, resource_id: id, version: next, op: 'upsert', content_hash: contentHash(serialized), site_id: site })
          .execute();
        return { resourceType, id, version: next };
      });
    },

    async get(resourceType, id) {
      const row = await db
        .selectFrom('fhir.fhir_resources')
        .select('resource')
        .where('resource_type', '=', resourceType)
        .where('id', '=', id)
        .executeTakeFirst();
      return row ? (row.resource as FhirResource) : null;
    },

    async listByType(resourceType, limit = 500) {
      const rows = await db
        .selectFrom('fhir.fhir_resources')
        .select(['id', 'resource'])
        .where('resource_type', '=', resourceType)
        .orderBy('updated_at', 'desc')
        .limit(limit)
        .execute();
      return rows.map((r) => ({ id: r.id, resource: r.resource as FhirResource }));
    },

    async delete(resourceType, id) {
      const site = await resolveSiteId();
      return db.transaction().execute(async (trx) => {
        const cur = await trx
          .selectFrom('fhir.fhir_resources')
          .select('version')
          .where('resource_type', '=', resourceType)
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!cur) return { deleted: false };
        const next = Number(cur.version) + 1;
        await trx
          .insertInto('fhir.resource_history')
          .values({ resource_type: resourceType, id, version: next, op: 'delete', resource: null })
          .execute();
        await trx
          .insertInto('fhir.change_log')
          .values({ resource_type: resourceType, resource_id: id, version: next, op: 'delete', content_hash: null, site_id: site })
          .execute();
        await trx.deleteFrom('fhir.fhir_resources').where('resource_type', '=', resourceType).where('id', '=', id).execute();
        return { deleted: true, version: next };
      });
    },
  };
}
```

- [ ] **Step 4: Run the versioning test + full db suite**

Run: `pnpm --filter @openldr/db exec vitest run src/fhir-store-versioning.test.ts`
Expected: PASS (the delete test lives in Task 3; the four save-related tests here pass).

Run: `pnpm --filter @openldr/db exec tsc --noEmit`
Expected: PASS.

Run: `pnpm --filter @openldr/db exec vitest run`
Expected: PASS (existing `fhir-store.test.ts`, `persist.test.ts`, `export-data.test.ts` still green — `save` return is a superset; persist uses `ref.id`).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/fhir-store.ts packages/db/src/fhir-store-versioning.test.ts
git commit -m "feat(db): transactional versioned save — version bump + history + change_log emission (restructure R1)"
```

---

## Task 3: `delete()` + tombstone

The `delete` method was added to `fhir-store.ts` in Task 2 (it's part of the rewritten file). This task adds its tests and verifies them.

**Files:**
- Modify: `packages/db/src/fhir-store-versioning.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing delete tests**

Append to `packages/db/src/fhir-store-versioning.test.ts`:

```ts
describe('fhir-store delete (tombstone)', () => {
  it('tombstones an existing resource: history + change_log delete rows, get() null, version bumped', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as any);
    await store.save({ resourceType: 'Patient', id: 'p1' } as never); // v1
    const del = await store.delete('Patient', 'p1');
    expect(del).toEqual({ deleted: true, version: 2 });

    expect(await store.get('Patient', 'p1')).toBeNull();

    const hist = await db.selectFrom('fhir.resource_history').select(['version', 'op', 'resource']).where('id', '=', 'p1').orderBy('version').execute();
    expect(hist.map((h: any) => [Number(h.version), h.op])).toEqual([[1, 'upsert'], [2, 'delete']]);
    expect(hist[1].resource).toBeNull();

    const log = await db.selectFrom('fhir.change_log').select(['op', 'content_hash']).where('resource_id', '=', 'p1').orderBy('seq').execute();
    expect(log.map((l: any) => l.op)).toEqual(['upsert', 'delete']);
    expect(log[1].content_hash).toBeNull();
    await db.destroy();
  });

  it('is a no-op for a missing resource', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as any);
    const del = await store.delete('Patient', 'does-not-exist');
    expect(del).toEqual({ deleted: false });
    const log = await db.selectFrom('fhir.change_log').select('seq').where('resource_id', '=', 'does-not-exist').execute();
    expect(log).toEqual([]);
    const hist = await db.selectFrom('fhir.resource_history').select('version').where('id', '=', 'does-not-exist').execute();
    expect(hist).toEqual([]);
    await db.destroy();
  });
});
```

- [ ] **Step 2: Run the delete tests**

Run: `pnpm --filter @openldr/db exec vitest run src/fhir-store-versioning.test.ts`
Expected: PASS (both new delete tests + the four from Task 2). The implementation already exists from Task 2, so these pass immediately — this task's value is locking the tombstone contract behind tests.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/fhir-store-versioning.test.ts
git commit -m "test(db): lock delete/tombstone contract — history + change_log delete rows, idempotent no-op (restructure R1)"
```

---

## Task 4: Persist-path integration + cross-package verification

**Files:**
- Create: `packages/db/src/persist-changelog.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `packages/db/src/persist-changelog.test.ts` — verifies the batch persist path emits one change_log row per resource (per-resource transaction), reusing the real `persistResources`:

```ts
import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFhirStore } from './fhir-store';
import { persistResources } from './persist';

const noopFlatWriter = {
  write: async () => 'skipped' as const,
  writeMany: async (items: unknown[]) => items.map(() => 'skipped' as const),
};
const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;

describe('persist path emits change_log per resource', () => {
  it('one change_log row per resource in a batch, versions correct', async () => {
    const db = await makeMigratedDb();
    const fhirStore = createFhirStore(db as any);

    await persistResources({ fhirStore, flatWriter: noopFlatWriter as never, logger }, [
      { resourceType: 'Patient', id: 'p1' },
      { resourceType: 'Observation', id: 'o1' },
      { resourceType: 'Patient', id: 'p1' }, // second write of p1 → version 2
    ]);

    const log = await db.selectFrom('fhir.change_log').select(['resource_type', 'resource_id', 'version']).where('resource_id', 'in', ['p1', 'o1']).orderBy('seq').execute();
    expect(log.map((r: any) => [r.resource_id, Number(r.version)])).toEqual([
      ['p1', 1],
      ['o1', 1],
      ['p1', 2],
    ]);
    await db.destroy();
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @openldr/db exec vitest run src/persist-changelog.test.ts`
Expected: PASS (no implementation change — `persistResources` already loops `save`, which now emits change_log per resource). If the `logger`/`flatWriter` shapes don't match `PersistDeps`, adjust the test's stubs to satisfy the types (read `packages/db/src/persist.ts` for the exact `PersistDeps` interface) — do NOT change `persist.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/persist-changelog.test.ts
git commit -m "test(db): verify batch persist emits one change_log row per resource (restructure R1)"
```

- [ ] **Step 4: Cross-package verification gate**

The `FhirStore` interface gained `delete` and `SavedRef` gained `version`; confirm no downstream consumer broke. Run per-package (never pipe turbo through `tail`):

```bash
pnpm --filter @openldr/db exec vitest run
pnpm --filter @openldr/ingest exec tsc --noEmit
pnpm --filter @openldr/ingest exec vitest run
pnpm --filter @openldr/bootstrap exec tsc --noEmit
pnpm --filter @openldr/bootstrap exec vitest run
pnpm --filter @openldr/server exec tsc --noEmit
pnpm --filter @openldr/server exec vitest run
```

Expected: ALL PASS. If a downstream package fails to typecheck because it implements/mocks `FhirStore` without `delete`, add a minimal `delete` stub to that mock (test-only) — do NOT change production interfaces to accommodate a mock.

- [ ] **Step 5: Final scoped turbo gate**

```bash
pnpm turbo run typecheck test --filter=@openldr/db --filter=@openldr/ingest --filter=@openldr/bootstrap --filter=@openldr/server --force
```

Expected: PASS. (If Windows lock/EPERM flakes appear, trust the per-package `vitest run`/`tsc` results above.)

---

## Self-Review

**Spec coverage:** R1 spec → tables (`version` column + `resource_history` + `change_log` + `change_cursors`) = Task 1; transactional versioned `save` with history + change_log + `content_hash` + `site_id` = Task 2; `delete`/tombstone = Task 2 (impl) + Task 3 (tests); per-resource-tx batch semantics = Task 4. `SavedRef.version`, `meta.versionId`/`meta.lastUpdated` stamping, three-way `site_id` resolution — all covered. Inline flat-writer left untouched (verified by existing suites staying green in Task 2 step 4). ✔

**Placeholder scan:** No TBD/TODO; every step has complete code and exact commands + expected results. ✔

**Type consistency:** `version` is `bigint`/`Generated<number>` and always read via `Number(...)` (per the spike's string-vs-number finding). `SavedRef` (`{resourceType,id,version}`), `DeleteResult` (`{deleted,version?}`), `ChangeLogTable`/`ResourceHistoryTable`/`ChangeCursorsTable`, and the dotted `InternalSchema` keys are defined in Task 1 and used consistently in Task 2's rewrite. `op` values `'upsert'`/`'delete'` consistent across history + change_log. ✔

**Risk notes for the executor:** (1) `up()` must stay pg-mem-safe (raw DDL forms as written — spike-verified); `down()` is real-PG-only. (2) Never assume `version`/`seq` are JS numbers off a query — coerce with `Number(...)`. (3) Do not modify `persist.ts` or the inline flat-writer in R1 — projection decoupling is R2.
