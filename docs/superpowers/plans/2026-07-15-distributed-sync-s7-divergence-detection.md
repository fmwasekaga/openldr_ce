# Distributed Sync S7 — Same-Version Divergence Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make same-version divergence visible — when a lab and central independently author the same version with different content, record the dropped content durably instead of silently discarding it.

**Architecture:** Detection rides `applyRemote`'s **existing** idempotency SELECT in `packages/db/src/fhir-store.ts`. When a history row already exists at `(resource_type, id, version)`, canonical-hash the stored body and the incoming body (volatile `meta` stripped). Equal → `'skipped'`, byte-identical to today. Different → `recordDivergence(trx, …)` into a new `sync_divergences` table **inside the same transaction** and return a new `'diverged'` result. Both central and the lab run `applyRemote`, so each side independently records what *it* dropped — hence **no wire-protocol change**. Detect-and-surface only; no auto-heal.

**Tech Stack:** TypeScript, Kysely (Postgres), Fastify, Commander (CLI), Vitest, pnpm workspaces, `tsx` for live acceptance harnesses.

**Spec:** `docs/superpowers/specs/2026-07-15-distributed-sync-s7-divergence-detection-design.md` (commits `17626be7`, `d2f9d326`).

---

## Read This First — Repo Landmines

These have each already cost a live defect in this workstream. They are not optional reading.

1. **`return reply.send(...)` — always.** `@fastify/compress` is registered globally. A bare or `void`'d `reply.send(x)` in an **async** handler resolves to `undefined` before an async (gzipped, >1KB) send has written, so Fastify re-sends `undefined` and **clobbers the body**. Enforced by the `openldr/require-return-reply-send` lint rule (`apps/server` is the **only** package with real lint; every other package's `lint` script is `echo "no lint"`). Unit tests **cannot** see this — their fixtures are sub-threshold.
2. **`change_log` must never be a transaction's first write.** The projection safe-frontier depends on the txn's xid being assigned before `nextval(seq)` is drawn for `change_log`. Our new code only adds a read (the existing SELECT gains a column) and, on the diverged path, writes **no** `change_log`/`fhir_resources` rows at all. Do not reorder anything in `applyRemote`.
3. **`bigint` reads back as a `string` on real Postgres and a `number` on pg-mem.** Always `Number(...)`-coerce. `version` is `bigint`.
4. **`jsonb` is written as text** (the repo idiom) and may read back either parsed or as a string depending on driver — normalize on read. Copy `sync-quarantine-store.ts`'s `toRow` handling exactly.
5. **Test the thing that ships.** Three times in S7-A/S7-B a green unit gate missed a real defect that only the live harness caught. Task 11's acceptance harness is the real proof; treat a green unit suite as necessary, not sufficient.
6. **Do not add `Co-Authored-By` trailers** to any commit.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/db/src/migrations/internal/056_sync_divergences.ts` | Create/drop the table | 1 |
| `packages/db/src/migrations/internal/index.ts` | Register migration `056` | 1 |
| `packages/db/src/schema/internal.ts` | `SyncDivergencesTable` type + `InternalSchema` entry | 1 |
| `packages/db/src/divergence-hash.ts` | `divergenceHash(body)` — the single comparison-basis fn | 2 |
| `packages/db/src/sync-divergence-store.ts` | `recordDivergence(trx, …)` (in-txn write) + `createSyncDivergenceStore(db)` (reads/clear) | 3 |
| `packages/db/src/fhir-store.ts` | Detection in `applyRemote`; `ApplyResult` widening | 4 |
| `packages/db/src/index.ts` | Barrel exports | 3 |
| `packages/sync/src/amend-pull-worker.ts` | Retype `applyRecord` to `ApplyResult` | 5 |
| `apps/server/src/sync-routes.ts` | Tally `'diverged'` in the push route | 6 |
| `packages/bootstrap/src/sync-bundle.ts` | Tally `'diverged'` in bundle import | 6 |
| `packages/bootstrap/src/sync-handle.ts` | `listDivergences` / `getDivergence` / `clearDivergence` | 7 |
| `packages/bootstrap/src/index.ts` | Construct the store **unconditionally**; wire the handle | 7 |
| `apps/server/src/settings-routes.ts` | 3 HTTP routes + audit | 8, 9 |
| `packages/cli/src/sync.ts` + `packages/cli/src/index.ts` | `openldr sync divergence list\|show\|clear` | 10 |
| `scripts/sync-divergence-live-acceptance.ts` + `package.json` | `pnpm sync:divergence:accept` | 11 |

---

### Task 1: Migration `056` + schema types

**Files:**
- Create: `packages/db/src/migrations/internal/056_sync_divergences.ts`
- Modify: `packages/db/src/migrations/internal/index.ts` (imports ~line 55; map ~line 112)
- Modify: `packages/db/src/schema/internal.ts` (add interface near `SyncQuarantineTable` ~line 70; add to `InternalSchema` ~line 619)
- Test: `packages/db/src/migrations/internal/056_sync_divergences.test.ts`

**Context:** Mirrors `055_sync_quarantine.ts` exactly — internal migration set, table created **unprefixed** (lands in the internal DB's public schema), typed into `InternalSchema`. Hash and body columns are **nullable**: NULL means "tombstone / no content", which is required to represent a delete-vs-edit divergence (spec §5.2).

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/migrations/internal/056_sync_divergences.test.ts`. Mirror the structure of the existing `054_sync_amendments.test.ts` (open it first and copy its harness imports and DB-setup idiom verbatim — it is the reference for this repo's migration tests).

```typescript
import { describe, it, expect } from 'vitest';
import { up } from './056_sync_divergences';
import { makeMigrationDb } from './test-helpers';

describe('056_sync_divergences', () => {
  it('creates sync_divergences with a (resource_type, resource_id, version) PK', async () => {
    const db = await makeMigrationDb();
    await up(db as any);

    await db
      .insertInto('sync_divergences' as any)
      .values({
        resource_type: 'Observation',
        resource_id: 'obs-1',
        version: 2,
        local_hash: 'aaa',
        incoming_hash: 'bbb',
        incoming_body: JSON.stringify({ resourceType: 'Observation', id: 'obs-1' }),
        incoming_site_id: 'lab-a',
      })
      .execute();

    const rows = await db.selectFrom('sync_divergences' as any).selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(Number((rows[0] as any).version)).toBe(2);
  });

  it('allows NULL hashes and body (tombstone side of a divergence)', async () => {
    const db = await makeMigrationDb();
    await up(db as any);

    await db
      .insertInto('sync_divergences' as any)
      .values({
        resource_type: 'Observation',
        resource_id: 'obs-2',
        version: 3,
        local_hash: 'aaa',
        incoming_hash: null,
        incoming_body: null,
        incoming_site_id: 'lab-a',
      })
      .execute();

    const rows = await db.selectFrom('sync_divergences' as any).selectAll().execute();
    expect((rows[0] as any).incoming_hash).toBeNull();
    expect((rows[0] as any).incoming_body).toBeNull();
  });
});
```

> If `test-helpers.ts` exposes a differently-named factory than `makeMigrationDb`, use whatever `054_sync_amendments.test.ts` uses — do not invent one.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/db test -- 056_sync_divergences`
Expected: FAIL — `Cannot find module './056_sync_divergences'`

- [ ] **Step 3: Write the migration**

Create `packages/db/src/migrations/internal/056_sync_divergences.ts`:

```typescript
import { type Kysely, sql } from 'kysely';

// Distributed sync S7: same-version divergence record. applyRemote's idempotency key is
// (resource_type, id, version) — when two sides independently author the SAME version with DIFFERENT
// content, the apply finds the key present and skips, silently dropping the incoming content. This
// table records what was dropped, at the moment it is dropped, inside the same transaction.
//
// Detect-and-surface only: there is no auto-heal. A row's EXISTENCE is the open state (no status
// column) — an operator clears it by DELETing it.
//
// local_hash / incoming_hash / incoming_body are NULLABLE: NULL = tombstone (no content). A lab may
// delete a resource at v2 while central amends it to v2 — a genuine delete-vs-edit divergence that
// MUST be representable. Two tombstones agree (both NULL) and are never recorded.
//
// Public schema (operational state), sibling of reference_change_log / sync_amendments /
// sync_quarantine. Lives on BOTH central and lab — each side records what IT dropped.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('sync_divergences')
    .addColumn('resource_type', 'text', (c) => c.notNull())
    .addColumn('resource_id', 'text', (c) => c.notNull())
    .addColumn('version', 'bigint', (c) => c.notNull())
    // Canonical hash of the body we KEPT / the body we DROPPED, volatile meta stripped. NULL = tombstone.
    .addColumn('local_hash', 'text')
    .addColumn('incoming_hash', 'text')
    // The dropped content itself (PHI). Stored so the divergence is diffable LOCALLY and OFFLINE — the
    // peer holding the other copy may be unreachable for days on these links. NULL = incoming tombstone.
    .addColumn('incoming_body', 'jsonb')
    .addColumn('incoming_site_id', 'text', (c) => c.notNull())
    .addColumn('detected_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    // PK grain = resource_history's grain, which is the grain at which divergence is defined. A resource
    // can diverge at v2 and again at v5 — two independent facts, two rows. Re-delivery of the same
    // diverged record hits this PK and no-ops (onConflict doNothing), so a stuck redelivery loop can
    // neither inflate the table nor churn detected_at.
    .addPrimaryKeyConstraint('sync_divergences_pkey', ['resource_type', 'resource_id', 'version'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('sync_divergences').execute();
}
```

- [ ] **Step 4: Register the migration**

In `packages/db/src/migrations/internal/index.ts`, add the import next to the `m055` import (~line 56):

```typescript
import * as m056 from './056_sync_divergences';
```

and the map entry next to `'055_sync_quarantine'` (~line 113):

```typescript
  '056_sync_divergences': { up: m056.up, down: m056.down },
```

- [ ] **Step 5: Add the schema types**

In `packages/db/src/schema/internal.ts`, add after `SyncQuarantineTable` (~line 81):

```typescript
// Distributed sync S7: same-version divergence record (see migration 056). Nullable hash/body columns
// mean "tombstone" — a delete-vs-edit collision at the same version is a real divergence.
export interface SyncDivergencesTable {
  resource_type: string;
  resource_id: string;
  version: number;
  local_hash: string | null;
  incoming_hash: string | null;
  incoming_body: unknown | null;
  incoming_site_id: string;
  detected_at: Generated<Date>;
}
```

and register it in `InternalSchema` immediately after the `sync_quarantine` line (~line 619):

```typescript
  sync_divergences: SyncDivergencesTable;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @openldr/db test -- 056_sync_divergences`
Expected: PASS (2 tests)

Run: `pnpm --filter @openldr/db test -- migrations.test`
Expected: PASS — this suite asserts the migration registry is complete/ordered; it will fail if step 4 was missed.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/migrations/internal/056_sync_divergences.ts \
        packages/db/src/migrations/internal/056_sync_divergences.test.ts \
        packages/db/src/migrations/internal/index.ts \
        packages/db/src/schema/internal.ts
git commit -m "feat(db): sync_divergences table (migration 056)"
```

---

### Task 2: `divergenceHash` — the comparison basis

**Files:**
- Create: `packages/db/src/divergence-hash.ts`
- Test: `packages/db/src/divergence-hash.test.ts`

**Context:** The single function defining "did we lose content". Uses `canonicalHash` from `@openldr/core` (already a dependency of `@openldr/db` — verified, no package.json change needed) and strips `meta.versionId` / `meta.lastUpdated`.

**Why strip volatile meta:** `save()` already hashes pre-stamp content for exactly this reason — this codebase has *already decided* those fields aren't part of content identity. Two sides holding clinically identical content that differs only in server-stamped timestamps is **not** a divergence; flagging it would be a lie, and false positives destroy operator trust (they stop looking, and you're back to silent divergence with extra steps).

**Why canonical:** immune to key-order drift. Raw-string comparison happens to work today because both stored bodies flow through the same `JSON.stringify`, but it is silently coupled to key order — a future refactor of `save()` or `applyRemote` would start manufacturing phantom divergences with no test to catch it.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/divergence-hash.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { divergenceHash } from './divergence-hash';

describe('divergenceHash', () => {
  it('returns null for a tombstone (no content)', () => {
    expect(divergenceHash(null)).toBeNull();
  });

  it('ignores meta.versionId and meta.lastUpdated', () => {
    const a = { resourceType: 'Observation', id: 'o1', status: 'final', meta: { versionId: '2', lastUpdated: '2026-01-01T00:00:00Z' } };
    const b = { resourceType: 'Observation', id: 'o1', status: 'final', meta: { versionId: '9', lastUpdated: '2099-12-31T23:59:59Z' } };
    expect(divergenceHash(a)).toBe(divergenceHash(b));
  });

  it('preserves other meta fields (they ARE content)', () => {
    const a = { resourceType: 'Observation', id: 'o1', meta: { versionId: '2', source: 'lab-a' } };
    const b = { resourceType: 'Observation', id: 'o1', meta: { versionId: '2', source: 'lab-b' } };
    expect(divergenceHash(a)).not.toBe(divergenceHash(b));
  });

  it('is insensitive to key order', () => {
    const a = { resourceType: 'Observation', id: 'o1', status: 'final' };
    const b = { status: 'final', id: 'o1', resourceType: 'Observation' };
    expect(divergenceHash(a)).toBe(divergenceHash(b));
  });

  it('detects a real content difference', () => {
    const a = { resourceType: 'Observation', id: 'o1', status: 'preliminary' };
    const b = { resourceType: 'Observation', id: 'o1', status: 'final' };
    expect(divergenceHash(a)).not.toBe(divergenceHash(b));
  });

  it('drops meta entirely when it held only volatile fields', () => {
    const withMeta = { resourceType: 'Observation', id: 'o1', meta: { versionId: '2', lastUpdated: 'x' } };
    const without = { resourceType: 'Observation', id: 'o1' };
    expect(divergenceHash(withMeta)).toBe(divergenceHash(without));
  });

  it('parses a serialized body string', () => {
    const obj = { resourceType: 'Observation', id: 'o1', status: 'final' };
    expect(divergenceHash(JSON.stringify(obj))).toBe(divergenceHash(obj));
  });

  it('returns null for an unparseable body string rather than throwing', () => {
    expect(divergenceHash('{not json')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/db test -- divergence-hash`
Expected: FAIL — `Cannot find module './divergence-hash'`

- [ ] **Step 3: Write the implementation**

Create `packages/db/src/divergence-hash.ts`:

```typescript
import { canonicalHash } from '@openldr/core';

// Distributed sync S7: THE comparison basis for same-version divergence detection.
//
// canonicalHash sorts keys, so this is immune to serialization key-order drift (a raw-string compare
// happens to work today only because both stored bodies flow through the same JSON.stringify — a
// future refactor would start manufacturing phantom divergences with no test to catch it).
//
// meta.versionId / meta.lastUpdated are STRIPPED because they are server-stamped and volatile:
// save() already hashes pre-stamp content for exactly this reason. Two sides holding identical
// content that differs only in those stamps did NOT lose anything, so it is not a divergence.
// False positives are fatal to this feature — an operator who sees noise stops looking.
//
// Returns null for "no content" (a tombstone, or an unparseable body). Callers compare with
// NULL-aware semantics: null vs null = agree; null vs hash = diverged.
const VOLATILE_META_KEYS = ['versionId', 'lastUpdated'] as const;

export function divergenceHash(body: unknown): string | null {
  if (body == null) return null;

  let value: unknown = body;
  if (typeof value === 'string') {
    // resource_history.resource is stored serialized; some drivers hand jsonb back as text.
    try {
      value = JSON.parse(value);
    } catch {
      // An unreadable stored body cannot be meaningfully compared. Treat as "no content" rather than
      // throwing — a hash failure must never fail the apply it is inspecting.
      return null;
    }
  }
  if (value == null || typeof value !== 'object') return null;

  const rest = { ...(value as Record<string, unknown>) };
  const meta = rest.meta;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const trimmed = { ...(meta as Record<string, unknown>) };
    for (const k of VOLATILE_META_KEYS) delete trimmed[k];
    // A meta that held ONLY volatile fields is dropped entirely, so a body carrying stamps hashes
    // identically to one that never had them.
    if (Object.keys(trimmed).length === 0) delete rest.meta;
    else rest.meta = trimmed;
  }
  return canonicalHash(rest);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/db test -- divergence-hash`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/divergence-hash.ts packages/db/src/divergence-hash.test.ts
git commit -m "feat(db): divergenceHash — canonical hash with volatile meta stripped"
```

---

### Task 3: `sync-divergence-store`

**Files:**
- Create: `packages/db/src/sync-divergence-store.ts`
- Modify: `packages/db/src/index.ts` (add exports next to the `sync-quarantine-store` export, ~line 27)
- Test: `packages/db/src/sync-divergence-store.test.ts`

**Context:** The write **must** happen inside `applyRemote`'s transaction (spec decision 6). A store bound to `db` can't do that, so this module exports **two** shapes rather than duplicating column knowledge across two files:
- `recordDivergence(trx, …)` — takes the **caller's** transaction. Used by `applyRemote`.
- `createSyncDivergenceStore(db)` — `list` / `get` / `clear` for operator paths.

Copy the `toRow` jsonb normalization from `sync-quarantine-store.ts` — `jsonb` may read back parsed or as text depending on driver.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/sync-divergence-store.test.ts`. Use the same DB-setup idiom as `packages/db/src/sync-quarantine-store.test.ts` if one exists; otherwise mirror the migration test's `test-helpers` factory and run migration `056`'s `up` first.

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import { up } from './migrations/internal/056_sync_divergences';
import { makeMigrationDb } from './migrations/internal/test-helpers';
import { recordDivergence, createSyncDivergenceStore } from './sync-divergence-store';
import type { InternalSchema } from './schema/internal';

const BODY = { resourceType: 'Observation', id: 'obs-1', status: 'final' };

async function seed(db: Kysely<InternalSchema>, over: Partial<Record<string, unknown>> = {}) {
  await db.transaction().execute(async (trx) =>
    recordDivergence(trx as any, {
      resourceType: 'Observation',
      resourceId: 'obs-1',
      version: 2,
      localHash: 'local-aaa',
      incomingHash: 'incoming-bbb',
      incomingBody: BODY,
      incomingSiteId: 'lab-a',
      ...over,
    }),
  );
}

describe('sync-divergence-store', () => {
  let db: Kysely<InternalSchema>;
  beforeEach(async () => {
    db = (await makeMigrationDb()) as unknown as Kysely<InternalSchema>;
    await up(db as any);
  });

  it('records a divergence and reads it back with the body', async () => {
    await seed(db);
    const store = createSyncDivergenceStore(db);
    const row = await store.get('Observation', 'obs-1', 2);
    expect(row).toBeDefined();
    expect(row!.localHash).toBe('local-aaa');
    expect(row!.incomingHash).toBe('incoming-bbb');
    expect(row!.incomingBody).toEqual(BODY);
    expect(row!.incomingSiteId).toBe('lab-a');
    expect(row!.version).toBe(2);
  });

  it('re-recording the same key is a no-op and does not churn detected_at', async () => {
    await seed(db);
    const store = createSyncDivergenceStore(db);
    const first = await store.get('Observation', 'obs-1', 2);

    await seed(db, { incomingHash: 'DIFFERENT', incomingBody: { changed: true } });

    const rows = await store.list();
    expect(rows).toHaveLength(1);
    const after = await store.get('Observation', 'obs-1', 2);
    expect(after!.incomingHash).toBe('incoming-bbb');
    expect(after!.detectedAt.getTime()).toBe(first!.detectedAt.getTime());
  });

  it('records a tombstone side as NULL hash and body', async () => {
    await seed(db, { version: 3, incomingHash: null, incomingBody: null });
    const store = createSyncDivergenceStore(db);
    const row = await store.get('Observation', 'obs-1', 3);
    expect(row!.incomingHash).toBeNull();
    expect(row!.incomingBody).toBeNull();
  });

  it('treats each version as an independent row', async () => {
    await seed(db, { version: 2 });
    await seed(db, { version: 5 });
    const store = createSyncDivergenceStore(db);
    expect(await store.list()).toHaveLength(2);
  });

  it('clear removes only the targeted row', async () => {
    await seed(db, { version: 2 });
    await seed(db, { version: 5 });
    const store = createSyncDivergenceStore(db);
    await store.clear('Observation', 'obs-1', 2);
    const rows = await store.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(5);
  });

  it('list is newest-first', async () => {
    await seed(db, { version: 2 });
    await seed(db, { version: 5 });
    const rows = await createSyncDivergenceStore(db).list();
    expect(rows.map((r) => r.version)).toEqual([5, 2]);
  });

  it('get returns undefined for an unknown key', async () => {
    expect(await createSyncDivergenceStore(db).get('Observation', 'nope', 1)).toBeUndefined();
  });
});
```

> `list` ordering: the test above pins `detected_at desc, version desc`. Two rows inserted in the same test can share a `now()` timestamp, so `version desc` is the tiebreaker that makes this deterministic.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/db test -- sync-divergence-store`
Expected: FAIL — `Cannot find module './sync-divergence-store'`

- [ ] **Step 3: Write the implementation**

Create `packages/db/src/sync-divergence-store.ts`:

```typescript
import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';

// Distributed sync S7: same-version divergence records (migration 056).
//
// TWO shapes, deliberately, in ONE module so the column knowledge lives in one place:
//  - recordDivergence(trx, …) takes the CALLER'S transaction, because applyRemote must write the row
//    in the SAME txn as the skip that caused it (atomic: a crash can never leave a dropped edit with
//    no trace — the exact failure this slice exists to prevent).
//  - createSyncDivergenceStore(db) serves the operator read/clear paths.

export interface SyncDivergenceRow {
  resourceType: string;
  resourceId: string;
  version: number;
  /** Canonical hash of the body we KEPT. null = the local side was a tombstone. */
  localHash: string | null;
  /** Canonical hash of the body we DROPPED. null = the incoming side was a tombstone. */
  incomingHash: string | null;
  /** The dropped content (PHI). null = the incoming side was a tombstone. */
  incomingBody: unknown | null;
  incomingSiteId: string;
  detectedAt: Date;
}

/** The PHI-free projection served by the list endpoint / CLI. Deliberately omits incomingBody. */
export type SyncDivergenceSummary = Omit<SyncDivergenceRow, 'incomingBody'>;

export interface RecordDivergenceInput {
  resourceType: string;
  resourceId: string;
  version: number;
  localHash: string | null;
  incomingHash: string | null;
  incomingBody: unknown | null;
  incomingSiteId: string;
}

export interface SyncDivergenceStore {
  list(): Promise<SyncDivergenceSummary[]>;
  get(resourceType: string, resourceId: string, version: number): Promise<SyncDivergenceRow | undefined>;
  clear(resourceType: string, resourceId: string, version: number): Promise<void>;
}

function toRow(r: {
  resource_type: string; resource_id: string; version: number | string;
  local_hash: string | null; incoming_hash: string | null; incoming_body?: unknown;
  incoming_site_id: string; detected_at: Date;
}): SyncDivergenceRow {
  return {
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    // bigint reads back as string on real pg, number on pg-mem — always coerce.
    version: Number(r.version),
    localHash: r.local_hash,
    incomingHash: r.incoming_hash,
    // jsonb reads back parsed on pg; a driver that hands it over as text is normalized here.
    incomingBody: typeof r.incoming_body === 'string' ? JSON.parse(r.incoming_body) : (r.incoming_body ?? null),
    incomingSiteId: r.incoming_site_id,
    detectedAt: r.detected_at,
  };
}

/**
 * Record a same-version divergence inside the CALLER'S transaction.
 *
 * onConflict doNothing: re-delivery of the same diverged record must neither insert a duplicate nor
 * churn detected_at — the FIRST detection is the fact worth keeping, and a stuck redelivery loop must
 * not be able to inflate the table.
 */
export async function recordDivergence(trx: Kysely<InternalSchema>, input: RecordDivergenceInput): Promise<void> {
  await trx
    .insertInto('sync_divergences')
    .values({
      resource_type: input.resourceType,
      resource_id: input.resourceId,
      version: input.version,
      local_hash: input.localHash,
      incoming_hash: input.incomingHash,
      // jsonb is written as text (the repo idiom — see dashboards.layout/widgets); null stays null.
      incoming_body: input.incomingBody == null ? null : JSON.stringify(input.incomingBody),
      incoming_site_id: input.incomingSiteId,
    })
    .onConflict((oc) => oc.columns(['resource_type', 'resource_id', 'version']).doNothing())
    .execute();
}

export function createSyncDivergenceStore(db: Kysely<InternalSchema>): SyncDivergenceStore {
  return {
    async list(): Promise<SyncDivergenceSummary[]> {
      const rows = await db
        .selectFrom('sync_divergences')
        // PHI-free by CONSTRUCTION: incoming_body is not selected. Do not add it here — the list
        // surface is the one a UI or a bored admin lands on. Body requires the explicit get().
        .select(['resource_type', 'resource_id', 'version', 'local_hash', 'incoming_hash', 'incoming_site_id', 'detected_at'])
        // version desc is the tiebreaker: rows detected in the same transaction/tick share detected_at.
        .orderBy('detected_at', 'desc')
        .orderBy('version', 'desc')
        .execute();
      return rows.map((r) => ({
        resourceType: r.resource_type,
        resourceId: r.resource_id,
        version: Number(r.version), // bigint reads back as string on real pg
        localHash: r.local_hash,
        incomingHash: r.incoming_hash,
        incomingSiteId: r.incoming_site_id,
        detectedAt: r.detected_at,
      }));
    },
    async get(resourceType, resourceId, version) {
      const row = await db
        .selectFrom('sync_divergences')
        .selectAll()
        .where('resource_type', '=', resourceType)
        .where('resource_id', '=', resourceId)
        .where('version', '=', version)
        .executeTakeFirst();
      return row ? toRow(row as never) : undefined;
    },
    async clear(resourceType, resourceId, version) {
      await db
        .deleteFrom('sync_divergences')
        .where('resource_type', '=', resourceType)
        .where('resource_id', '=', resourceId)
        .where('version', '=', version)
        .execute();
    },
  };
}
```

- [ ] **Step 4: Export from the barrel**

In `packages/db/src/index.ts`, add next to the existing `export * from './sync-quarantine-store';` (~line 27):

```typescript
export * from './sync-divergence-store';
export * from './divergence-hash';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/db test -- sync-divergence-store`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/sync-divergence-store.ts packages/db/src/sync-divergence-store.test.ts packages/db/src/index.ts
git commit -m "feat(db): sync-divergence-store — in-txn record + operator read/clear"
```

---

### Task 4: Detection in `applyRemote` (the core)

**Files:**
- Modify: `packages/db/src/fhir-store.ts` (`ApplyResult` ~line 30; `applyRemote`'s idempotency SELECT)
- Test: `packages/db/src/fhir-store-divergence.test.ts`

**Context — read carefully:**
- The existing SELECT currently reads only `'version'`. It must also read `'resource'` and `'op'` so the stored body can be hashed.
- **Do not reorder anything.** The SELECT is read-only and assigns no xid, so the safe-frontier invariant is untouched. On the diverged path there are **no** `fhir_resources` / `change_log` writes at all.
- The `'skipped'` path must stay **byte-identical** to today whenever hashes agree — that is every genuine re-drain.
- NULL-aware comparison: `null` vs `null` = agree (two tombstones); `null` vs hash = diverged (delete-vs-edit).

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/fhir-store-divergence.test.ts`. Copy the DB/store setup idiom verbatim from the existing `packages/db/src/fhir-store-apply.test.ts` (open it first) — it already has the harness for `createFhirStore` + migrations.

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createSyncDivergenceStore } from './sync-divergence-store';

// Reuse fhir-store-apply.test.ts's setup: a migrated internal DB + createFhirStore(db).
// `makeStore()` below stands in for whatever that file uses — mirror it exactly.

const obs = (status: string) => ({ resourceType: 'Observation', id: 'obs-1', status }) as any;

describe('applyRemote — same-version divergence detection', () => {
  let db: any;
  let store: any;
  beforeEach(async () => {
    ({ db, store } = await makeStore());
    // Seed v1 so both sides share a common ancestor.
    await store.applyRemote({ resourceType: 'Observation', id: 'obs-1', version: 1, op: 'upsert', siteId: 'lab-a', resource: obs('preliminary') });
  });

  it('same version + DIFFERENT content → diverged + exactly one row holding the dropped body', async () => {
    await store.applyRemote({ resourceType: 'Observation', id: 'obs-1', version: 2, op: 'upsert', siteId: 'lab-a', resource: obs('final') });

    const result = await store.applyRemote({
      resourceType: 'Observation', id: 'obs-1', version: 2, op: 'upsert', siteId: 'central',
      resource: obs('amended'),
    });

    expect(result).toBe('diverged');
    const rows = await createSyncDivergenceStore(db).list();
    expect(rows).toHaveLength(1);
    expect(rows[0].resourceId).toBe('obs-1');
    expect(rows[0].version).toBe(2);
    expect(rows[0].incomingSiteId).toBe('central');
    expect(rows[0].localHash).not.toBe(rows[0].incomingHash);

    const full = await createSyncDivergenceStore(db).get('Observation', 'obs-1', 2);
    expect((full!.incomingBody as any).status).toBe('amended');
  });

  it('does NOT overwrite the canonical row on divergence (the local copy is kept)', async () => {
    await store.applyRemote({ resourceType: 'Observation', id: 'obs-1', version: 2, op: 'upsert', siteId: 'lab-a', resource: obs('final') });
    await store.applyRemote({ resourceType: 'Observation', id: 'obs-1', version: 2, op: 'upsert', siteId: 'central', resource: obs('amended') });

    const row = await db.selectFrom('fhir.fhir_resources').selectAll()
      .where('resource_type', '=', 'Observation').where('id', '=', 'obs-1').executeTakeFirst();
    expect(JSON.parse(row.resource).status).toBe('final');
  });

  it('same version + IDENTICAL content → skipped, NO row (idempotent re-drain unchanged)', async () => {
    const rec = { resourceType: 'Observation', id: 'obs-1', version: 2, op: 'upsert' as const, siteId: 'lab-a', resource: obs('final') };
    await store.applyRemote(rec);
    const result = await store.applyRemote(rec);

    expect(result).toBe('skipped');
    expect(await createSyncDivergenceStore(db).list()).toHaveLength(0);
  });

  it('content differing ONLY in volatile meta → skipped, NO row (the false-positive guard)', async () => {
    await store.applyRemote({
      resourceType: 'Observation', id: 'obs-1', version: 2, op: 'upsert', siteId: 'lab-a',
      resource: { ...obs('final'), meta: { versionId: '2', lastUpdated: '2026-01-01T00:00:00Z' } },
    });
    const result = await store.applyRemote({
      resourceType: 'Observation', id: 'obs-1', version: 2, op: 'upsert', siteId: 'central',
      resource: { ...obs('final'), meta: { versionId: '2', lastUpdated: '2099-12-31T23:59:59Z' } },
    });

    expect(result).toBe('skipped');
    expect(await createSyncDivergenceStore(db).list()).toHaveLength(0);
  });

  it('tombstone vs tombstone → skipped, NO row (two deletes agree)', async () => {
    const del = { resourceType: 'Observation', id: 'obs-1', version: 2, op: 'delete' as const, siteId: 'lab-a' };
    await store.applyRemote(del);
    const result = await store.applyRemote({ ...del, siteId: 'central' });

    expect(result).toBe('skipped');
    expect(await createSyncDivergenceStore(db).list()).toHaveLength(0);
  });

  it('local tombstone vs incoming body → diverged (delete-vs-edit)', async () => {
    await store.applyRemote({ resourceType: 'Observation', id: 'obs-1', version: 2, op: 'delete', siteId: 'lab-a' });
    const result = await store.applyRemote({
      resourceType: 'Observation', id: 'obs-1', version: 2, op: 'upsert', siteId: 'central', resource: obs('amended'),
    });

    expect(result).toBe('diverged');
    const row = await createSyncDivergenceStore(db).get('Observation', 'obs-1', 2);
    expect(row!.localHash).toBeNull();
    expect(row!.incomingHash).not.toBeNull();
  });

  it('local body vs incoming tombstone → diverged, NULL incoming hash/body persisted', async () => {
    await store.applyRemote({ resourceType: 'Observation', id: 'obs-1', version: 2, op: 'upsert', siteId: 'lab-a', resource: obs('final') });
    const result = await store.applyRemote({ resourceType: 'Observation', id: 'obs-1', version: 2, op: 'delete', siteId: 'central' });

    expect(result).toBe('diverged');
    const row = await createSyncDivergenceStore(db).get('Observation', 'obs-1', 2);
    expect(row!.localHash).not.toBeNull();
    expect(row!.incomingHash).toBeNull();
    expect(row!.incomingBody).toBeNull();
  });

  it('re-delivery of a diverged record → still diverged, no duplicate, no detected_at churn', async () => {
    await store.applyRemote({ resourceType: 'Observation', id: 'obs-1', version: 2, op: 'upsert', siteId: 'lab-a', resource: obs('final') });
    const incoming = { resourceType: 'Observation', id: 'obs-1', version: 2, op: 'upsert' as const, siteId: 'central', resource: obs('amended') };

    await store.applyRemote(incoming);
    const first = await createSyncDivergenceStore(db).get('Observation', 'obs-1', 2);
    const again = await store.applyRemote(incoming);

    expect(again).toBe('diverged');
    expect(await createSyncDivergenceStore(db).list()).toHaveLength(1);
    const after = await createSyncDivergenceStore(db).get('Observation', 'obs-1', 2);
    expect(after!.detectedAt.getTime()).toBe(first!.detectedAt.getTime());
  });

  it('divergences at v2 and v5 on one resource are independent rows', async () => {
    await store.applyRemote({ resourceType: 'Observation', id: 'obs-1', version: 2, op: 'upsert', siteId: 'lab-a', resource: obs('final') });
    await store.applyRemote({ resourceType: 'Observation', id: 'obs-1', version: 2, op: 'upsert', siteId: 'central', resource: obs('amended') });
    await store.applyRemote({ resourceType: 'Observation', id: 'obs-1', version: 5, op: 'upsert', siteId: 'lab-a', resource: obs('corrected') });
    await store.applyRemote({ resourceType: 'Observation', id: 'obs-1', version: 5, op: 'upsert', siteId: 'central', resource: obs('recorrected') });

    const rows = await createSyncDivergenceStore(db).list();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.version).sort()).toEqual([2, 5]);
  });

  it('a normal first apply at a new version still returns applied and records nothing', async () => {
    const result = await store.applyRemote({ resourceType: 'Observation', id: 'obs-1', version: 2, op: 'upsert', siteId: 'lab-a', resource: obs('final') });
    expect(result).toBe('applied');
    expect(await createSyncDivergenceStore(db).list()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/db test -- fhir-store-divergence`
Expected: FAIL — divergence rows are never written; `result` is `'skipped'` where `'diverged'` is expected.

- [ ] **Step 3: Widen `ApplyResult`**

In `packages/db/src/fhir-store.ts`, replace line ~30:

```typescript
export type ApplyResult = 'applied' | 'skipped' | 'diverged';
```

Add above it:

```typescript
// 'diverged' (sync S7): a history row already exists at this (resource_type, id, version) but its
// content DIFFERS from the incoming record — two sides independently authored the same version. The
// incoming content is NOT applied (the local copy is kept); it is recorded in sync_divergences for an
// operator. Detect-and-surface only: there is no auto-heal, by design.
//
// NOTE: widening this union does NOT produce a compile error at every call site — sync-routes.ts and
// sync-bundle.ts both use `if (result === 'applied') ... else skipped++`, so `else` silently absorbs
// the new variant. Those sites are updated explicitly (see the S7 plan, Task 6). Correctness does not
// depend on them: the row is written in applyRemote's OWN transaction.
```

- [ ] **Step 4: Add detection to `applyRemote`**

In `packages/db/src/fhir-store.ts`, add the import at the top next to the other local imports:

```typescript
import { divergenceHash } from './divergence-hash';
import { recordDivergence } from './sync-divergence-store';
```

Then, inside `applyRemote`'s transaction, replace the existing idempotency block:

```typescript
        const already = await trx
          .selectFrom('fhir.resource_history')
          .select('version')
          .where('resource_type', '=', resourceType)
          .where('id', '=', id)
          .where('version', '=', version)
          .executeTakeFirst();
        if (already) return 'skipped';
```

with:

```typescript
        // Idempotency + divergence detection (sync S7). This SELECT is unchanged in ROLE — it still
        // decides "have we already applied this exact origin version?" — but it now also reads the
        // stored body so we can tell a genuine re-drain (identical content → skip, as always) from a
        // same-version DIVERGENCE (different content → the incoming edit is being dropped, and that
        // must not be silent). Still read-only: it assigns no xid, so the safe-frontier invariant
        // (change_log must not be the txn's first write) is unaffected. Do not reorder.
        const already = await trx
          .selectFrom('fhir.resource_history')
          .select(['version', 'resource'])
          .where('resource_type', '=', resourceType)
          .where('id', '=', id)
          .where('version', '=', version)
          .executeTakeFirst();
        if (already) {
          // NULL-aware: null == null means two tombstones, which AGREE (nothing was lost).
          const localHash = divergenceHash(already.resource);
          const incomingHash = divergenceHash(op === 'upsert' ? (record.resource ?? null) : null);
          if (localHash === incomingHash) return 'skipped'; // byte-identical to pre-S7 behavior

          // Same version, different content. Keep the local copy (no fhir_resources / change_log
          // writes on this path) and durably record what we dropped, in THIS transaction — the skip
          // and the record of why it happened commit together, so a crash can never leave a dropped
          // edit with no trace.
          await recordDivergence(trx, {
            resourceType,
            resourceId: id,
            version,
            localHash,
            incomingHash,
            incomingBody: op === 'upsert' ? (record.resource ?? null) : null,
            incomingSiteId: siteId,
          });
          return 'diverged';
        }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/db test -- fhir-store-divergence`
Expected: PASS (10 tests)

- [ ] **Step 6: Verify no regression in the existing apply/amend suites**

Run: `pnpm --filter @openldr/db test`
Expected: PASS. `fhir-store-apply.test.ts` and `fhir-store-amend.test.ts` must be **unchanged and green** — they pin that the `'skipped'` path still behaves as before.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/fhir-store.ts packages/db/src/fhir-store-divergence.test.ts
git commit -m "feat(db): detect same-version divergence in applyRemote"
```

---

### Task 5: Retype `AmendPullDeps.applyRecord`

**Files:**
- Modify: `packages/sync/src/amend-pull-worker.ts:10`
- Test: `packages/sync/src/amend-pull-worker.test.ts` (existing — add one case)

**Context:** This is the **one** call site the compiler does catch, because `applyRecord` hardcodes `Promise<'applied' | 'skipped'>` instead of using `ApplyResult`. Retyping it to `ApplyResult` stops it drifting from the store it wraps. The runner must treat `'diverged'` as a **success** (the record was handled, the cursor advances) — it is emphatically not an error.

- [ ] **Step 1: Write the failing test**

Add to `packages/sync/src/amend-pull-worker.test.ts` (mirror the existing fake-deps idiom in that file):

```typescript
  it('treats a diverged apply as handled — cursor advances, no quarantine', async () => {
    const applied: unknown[] = [];
    let cursor = 0;
    const deps = makeDeps({
      applyRecord: async (rec) => { applied.push(rec); return 'diverged' as const; },
      readCursor: async () => cursor,
      advanceCursor: async (seq: number) => { cursor = seq; },
      postPull: async () => ({
        records: [{ resourceType: 'Observation', id: 'o1', version: 2, op: 'upsert', siteId: 'lab-a', resource: {}, seq: 7 } as any],
        nextSeq: 7,
      }),
    });

    const applied1 = await createAmendmentPullRunner(deps).runCycle();

    expect(applied).toHaveLength(1);
    expect(applied1).toBe(1);
    expect(cursor).toBe(7);
  });
```

> The runner's method is `runCycle()` — not `runOnce()`. Verified against `scripts/sync-amend-live-acceptance.ts`.

> `makeDeps` stands in for whatever helper the existing test file uses to build `AmendPullDeps`. Reuse it; do not invent a new one.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/sync test -- amend-pull-worker`
Expected: FAIL — TypeScript rejects `'diverged'`: not assignable to `'applied' | 'skipped'`.

- [ ] **Step 3: Retype the dep**

In `packages/sync/src/amend-pull-worker.ts`, add the import:

```typescript
import type { ApplyResult } from '@openldr/db';
```

and change line ~10:

```typescript
  // ApplyResult (not a hand-copied literal union) so this cannot drift from the store it wraps.
  // 'diverged' (S7) is a HANDLED outcome, not an error: the record was inspected, the divergence was
  // recorded durably by applyRemote itself, and the cursor advances normally.
  applyRecord: (rec: SyncRecord & { seq: number }) => Promise<ApplyResult>;
```

> If `@openldr/db` is not already a dependency of `@openldr/sync`, import the type from wherever `packages/sync` already sources shared db types. **Do not add a new package dependency** — `@openldr/sync`'s dep graph (db + fhir only, no cycle) is load-bearing. Check `packages/sync/package.json` first; `@openldr/db` is expected to be present.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/sync test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sync/src/amend-pull-worker.ts packages/sync/src/amend-pull-worker.test.ts
git commit -m "feat(sync): retype applyRecord to ApplyResult; diverged is handled"
```

---

### Task 6: Tally `'diverged'` at the two silent call sites

**Files:**
- Modify: `apps/server/src/sync-routes.ts` (~line 134-136)
- Modify: `packages/bootstrap/src/sync-bundle.ts` (~line 198-200)
- Test: `apps/server/src/sync-routes.test.ts` (existing — add one case)

**Context — this is the task the compiler cannot help with.** The two sites have DIFFERENT shapes; verified against the code, do not assume they match.

`apps/server/src/sync-routes.ts:135`:
```typescript
if (result === 'applied') applied++;
else skipped++;              // ← 'diverged' silently absorbed into skipped
```

`packages/bootstrap/src/sync-bundle.ts:198` — **no `else`, no `skipped` counter anywhere in the file**; it returns `{ applied, ackSeq, siteId }`:
```typescript
if (result === 'applied') applied++;
                             // ← 'diverged' dropped with no branch at all
```

Correctness is unaffected either way (the row is already written inside `applyRemote`'s transaction), but a divergence would be invisible in logs and counts — the same class of blind spot as S7-B's bare `reply.send`.

**`PushResponse` does NOT change.** Keeping it byte-identical preserves the no-wire-change property: no peer can break on this slice. The count is logged, not returned.

- [ ] **Step 1: Write the failing test**

Add to `apps/server/src/sync-routes.test.ts` (mirror the file's existing fake-`ctx` idiom):

```typescript
  it('a diverged record is not counted as skipped and does not reject the batch', async () => {
    const app = await buildTestApp({
      fhirStore: { applyRemote: async () => 'diverged' as const },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: authHeaders('lab-a'),
      payload: {
        fromSeq: 0,
        records: [{ resourceType: 'Observation', id: 'o1', version: 2, op: 'upsert', siteId: 'lab-a', resource: {}, seq: 5 }],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.skipped).toBe(0);   // MUST NOT be folded into skipped
    expect(body.applied).toBe(0);
    expect(body.rejects).toEqual([]); // a divergence is NOT a reject
    expect(body.ackSeq).toBe(5);      // handled → the lab's cursor still advances
  });
```

> `buildTestApp` / `authHeaders` stand in for whatever that suite already uses. Reuse them.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server test -- sync-routes`
Expected: FAIL — `expected 1 to be 0` on `body.skipped` (the `else` branch counted it).

- [ ] **Step 3: Fix the push route**

In `apps/server/src/sync-routes.ts`, add next to the `applied`/`skipped` declarations (~line 82):

```typescript
    let diverged = 0;
```

and replace the tally (~line 135):

```typescript
        const result = await ctx.fhirStore.applyRemote(rec);
        if (result === 'applied') applied++;
        else if (result === 'diverged') diverged++;
        else skipped++;
```

Then, immediately before the `const response: PushResponse = ...` line, add:

```typescript
    // A divergence means this lab pushed content at a version central had already authored
    // differently — central KEPT its own copy and dropped the lab's, recording it in sync_divergences
    // for an operator. Deliberately NOT reported in PushResponse: adding a field would break the
    // no-wire-change property, and the lab detects its own side independently when it pulls the
    // amendment (each side records what IT dropped). Logged so it is visible here too.
    if (diverged > 0) {
      ctx.logger.warn({ siteId: principal.siteId, diverged }, 'sync push: same-version divergence(s) detected — see sync_divergences');
    }
```

> Leave `PushResponse` and the `response` object exactly as they are. `applied + skipped` no longer sums to the handled count — `rejects` already broke that property, so nothing relies on it.

- [ ] **Step 4: Fix the bundle importer**

`packages/bootstrap/src/sync-bundle.ts` (~line 198) is NOT the same shape as the push route — it has no `else` and no `skipped` counter. Only `applied` is tallied, and the function returns `{ applied, ackSeq, siteId }`. So add a `diverged` counter beside the existing `applied` declaration and give the new variant its own branch:

```typescript
      const result = await ctx.fhirStore.applyRemote(rec);
      if (result === 'applied') applied++;
      else if (result === 'diverged') diverged++;
```

(There is deliberately still no `else` — a plain `'skipped'` remains uncounted here, exactly as before. Do not add a `skipped` counter; that would be scope creep.)

After the loop, before the `return`:

```typescript
  // Same-version divergence (S7) — the record was handled and recorded in sync_divergences by
  // applyRemote itself; surfaced here so a bundle import is not silent about it.
  if (diverged > 0) {
    ctx.logger.warn({ diverged, siteId: manifest.siteId }, 'sync import: same-version divergence(s) detected — see sync_divergences');
  }
```

> Do **not** change this function's return type — leave `{ applied, ackSeq, siteId }` as-is. Callers destructure it, and `diverged` is a log-only concern here (same reasoning as `PushResponse`: no wire/shape change).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/server test -- sync-routes`
Expected: PASS

Run: `pnpm --filter @openldr/server lint`
Expected: PASS — this is the only package with real lint; it enforces `return reply.send(...)`.

Run: `pnpm --filter @openldr/bootstrap test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/sync-routes.ts apps/server/src/sync-routes.test.ts packages/bootstrap/src/sync-bundle.ts
git commit -m "feat(sync): tally diverged at the push + bundle-import call sites"
```

---

### Task 7: Wire the store into bootstrap + `SyncHandle`

**Files:**
- Modify: `packages/bootstrap/src/sync-handle.ts` (interface ~line 34; `createSyncHandle` opts ~line 46; impl ~line 103)
- Modify: `packages/bootstrap/src/index.ts` (construct the store; pass to `createSyncHandle`)
- Test: `packages/bootstrap/src/sync-handle.test.ts` (existing — add cases)

**Context:** Build the store **unconditionally**, outside both sync gates. The rows are durable and must be listable on a push-only or **sync-disabled** node — this is the exact S7-A defect the final review caught (`listQuarantine` was hidden on non-pull nodes). Divergences are recorded by `applyRemote`, which runs regardless of which workers started.

- [ ] **Step 1: Write the failing test**

Add to `packages/bootstrap/src/sync-handle.test.ts`:

```typescript
  it('exposes divergences even when sync is disabled and no workers exist', async () => {
    const rows = [{ resourceType: 'Observation', resourceId: 'o1', version: 2, localHash: 'a', incomingHash: 'b', incomingSiteId: 'lab-a', detectedAt: new Date() }];
    const handle = createSyncHandle({
      db: fakeDb(),
      enabled: false,
      mode: 'push',
      centralUrl: '',
      siteId: 'lab-a',
      divergences: {
        list: async () => rows,
        get: async () => ({ ...rows[0], incomingBody: { status: 'amended' } }),
        clear: async () => {},
      } as any,
    });

    expect(await handle.listDivergences()).toEqual(rows);
    expect((await handle.getDivergence('Observation', 'o1', 2))!.incomingBody).toEqual({ status: 'amended' });
    await expect(handle.clearDivergence('Observation', 'o1', 2)).resolves.toBeUndefined();
  });

  it('degrades to empty when no divergence store was provided', async () => {
    const handle = createSyncHandle({ db: fakeDb(), enabled: false, mode: 'push', centralUrl: '', siteId: 'lab-a' });
    expect(await handle.listDivergences()).toEqual([]);
    expect(await handle.getDivergence('Observation', 'o1', 2)).toBeUndefined();
  });
```

> `fakeDb()` stands in for the existing suite's db stub. Reuse it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/bootstrap test -- sync-handle`
Expected: FAIL — `handle.listDivergences is not a function`

- [ ] **Step 3: Extend `SyncHandle`**

In `packages/bootstrap/src/sync-handle.ts`, extend the import on line 2:

```typescript
import type {
  InternalSchema, SyncQuarantineRow, SyncQuarantineStore,
  SyncDivergenceRow, SyncDivergenceSummary, SyncDivergenceStore,
} from '@openldr/db';
```

Add to the `SyncHandle` interface (~line 38):

```typescript
  /** PHI-FREE summaries. The dropped body requires getDivergence(). */
  listDivergences(): Promise<SyncDivergenceSummary[]>;
  /** Includes incomingBody (PHI) — callers must gate + audit. */
  getDivergence(resourceType: string, resourceId: string, version: number): Promise<SyncDivergenceRow | undefined>;
  clearDivergence(resourceType: string, resourceId: string, version: number): Promise<void>;
```

Add to `createSyncHandle`'s opts (~line 55):

```typescript
  /** Built UNCONDITIONALLY by the host (outside both sync gates): divergence rows are durable and must
   *  be listable on a push-only or sync-disabled node. */
  divergences?: SyncDivergenceStore;
```

Add to the returned object (after `retryQuarantine`, ~line 109):

```typescript
    async listDivergences(): Promise<SyncDivergenceSummary[]> {
      return opts.divergences ? opts.divergences.list() : [];
    },
    async getDivergence(resourceType, resourceId, version): Promise<SyncDivergenceRow | undefined> {
      return opts.divergences ? opts.divergences.get(resourceType, resourceId, version) : undefined;
    },
    async clearDivergence(resourceType, resourceId, version): Promise<void> {
      if (opts.divergences) await opts.divergences.clear(resourceType, resourceId, version);
    },
```

- [ ] **Step 4: Construct the store in bootstrap**

In `packages/bootstrap/src/index.ts`, find where `createSyncQuarantineStore` is constructed. It is built **outside** both sync gates — put the divergence store immediately beside it, matching that placement exactly:

```typescript
  // Built UNCONDITIONALLY, like the quarantine store: applyRemote records divergences regardless of
  // which workers started, and an operator on a push-only or sync-disabled node must still be able to
  // list/clear them. (S7-A shipped this bug first: listQuarantine was hidden on non-pull nodes.)
  const divergences = createSyncDivergenceStore(internalDb);
```

Import it from `@openldr/db` alongside `createSyncQuarantineStore`, and pass it to the existing `createSyncHandle({ ... })` call:

```typescript
    divergences,
```

> Use whatever local variable already names the internal Kysely instance at that point (the quarantine store's argument) — do not introduce a new one.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/bootstrap test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/sync-handle.ts packages/bootstrap/src/sync-handle.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): divergence store + SyncHandle accessors, built unconditionally"
```

---

### Task 8: `GET` list + detail routes

**Files:**
- Modify: `apps/server/src/settings-routes.ts` (add after the quarantine routes, ~line 78)
- Test: `apps/server/src/settings-sync-routes.test.ts` (existing)

**Context:** `requireRole('lab_admin')`, under `/api/settings/sync/*` — the user-authed prefix, **never** the machine-bypassed `/api/sync/*`. The list/detail split is the point: list stays PHI-free, the body needs an explicit second call. **Every send must be `return reply.send(...)`** (see landmine 1).

- [ ] **Step 1: Write the failing test**

Add to `apps/server/src/settings-sync-routes.test.ts` (mirror the file's existing fake-`ctx` + auth idiom):

```typescript
  it('list omits incomingBody (PHI-free by construction)', async () => {
    const app = await buildApp({
      sync: {
        listDivergences: async () => [{
          resourceType: 'Observation', resourceId: 'o1', version: 2,
          localHash: 'a', incomingHash: 'b', incomingSiteId: 'lab-a', detectedAt: new Date(),
        }],
      },
    });

    const res = await app.inject({ method: 'GET', url: '/api/settings/sync/divergences', headers: adminHeaders() });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).not.toHaveProperty('incomingBody');
    expect(body[0].resourceId).toBe('o1');
  });

  it('detail includes incomingBody and audits the PHI read', async () => {
    const audits: any[] = [];
    const app = await buildApp({
      recordAudit: async (_ctx: any, _req: any, e: any) => { audits.push(e); },
      sync: {
        getDivergence: async () => ({
          resourceType: 'Observation', resourceId: 'o1', version: 2,
          localHash: 'a', incomingHash: 'b', incomingBody: { status: 'amended' },
          incomingSiteId: 'lab-a', detectedAt: new Date(),
        }),
      },
    });

    const res = await app.inject({ method: 'GET', url: '/api/settings/sync/divergences/Observation/o1/2', headers: adminHeaders() });

    expect(res.statusCode).toBe(200);
    expect(res.json().incomingBody).toEqual({ status: 'amended' });
    expect(audits.map((a) => a.action)).toContain('settings.sync.divergence.view');
    // The audit itself must carry NO PHI — only the key.
    expect(JSON.stringify(audits[0])).not.toContain('amended');
  });

  it('detail 404s for an unknown key', async () => {
    const app = await buildApp({ sync: { getDivergence: async () => undefined } });
    const res = await app.inject({ method: 'GET', url: '/api/settings/sync/divergences/Observation/nope/1', headers: adminHeaders() });
    expect(res.statusCode).toBe(404);
  });

  it('detail 400s on a non-numeric version', async () => {
    const app = await buildApp({ sync: { getDivergence: async () => undefined } });
    const res = await app.inject({ method: 'GET', url: '/api/settings/sync/divergences/Observation/o1/abc', headers: adminHeaders() });
    expect(res.statusCode).toBe(400);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server test -- settings-sync-routes`
Expected: FAIL — 404 from Fastify (routes not registered).

- [ ] **Step 3: Add the routes**

In `apps/server/src/settings-routes.ts`, immediately after the quarantine retry route (~line 84):

```typescript
  // Sync S7: same-version divergence — applyRemote found a history row at this version whose content
  // DIFFERS from the incoming record, kept the local copy, and recorded what it dropped. Detect-and-
  // surface only: an operator inspects, decides, and (if central should win) re-authors at max+1 via
  // POST /api/settings/sync/amend, then clears. lab_admin + user-authed, deliberately NOT under
  // /api/sync/* (that surface is machine-cred).
  //
  // LIST is PHI-FREE (the store does not select incoming_body). This is the surface a UI lands on;
  // reading the dropped result content requires the explicit detail call below, which is audited.
  app.get('/api/settings/sync/divergences', { preHandler: requireRole('lab_admin') }, async () =>
    ctx.sync.listDivergences(),
  );

  // DETAIL returns incomingBody = the dropped content = PHI. Audited for that reason, even though the
  // audit row itself carries only the key.
  app.get('/api/settings/sync/divergences/:resourceType/:resourceId/:version', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const p = req.params as { resourceType: string; resourceId: string; version: string };
    const version = Number(p.version);
    if (!Number.isInteger(version) || version < 1) {
      return reply.code(400).send({ error: 'version must be a positive integer' });
    }
    const row = await ctx.sync.getDivergence(p.resourceType, p.resourceId, version);
    if (!row) return reply.code(404).send({ error: 'divergence not found' });
    await recordAudit(ctx, req, {
      action: 'settings.sync.divergence.view',
      entityType: p.resourceType,
      entityId: p.resourceId,
      metadata: { version },
    });
    // The `return` on each send is load-bearing, not style — see the comment block in sync-routes.ts.
    // This payload carries a full FHIR body and WILL cross the 1KB compress threshold.
    return reply.code(200).send(row);
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/server test -- settings-sync-routes`
Expected: PASS (4 tests)

Run: `pnpm --filter @openldr/server lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/settings-routes.ts apps/server/src/settings-sync-routes.test.ts
git commit -m "feat(server): GET sync divergences list (PHI-free) + audited detail"
```

---

### Task 9: `POST .../clear` route

**Files:**
- Modify: `apps/server/src/settings-routes.ts` (after the detail route)
- Test: `apps/server/src/settings-sync-routes.test.ts`

**Context:** Clearing is how an operator closes a divergence (spec decision 3 — nothing auto-resolves it). 404 when the row doesn't exist, so a double-clear is honest rather than a silent success. Audit **after** the operation commits (S4d precedent: a `recordAudit` throw must not fail an operation that already succeeded).

- [ ] **Step 1: Write the failing test**

```typescript
  it('clear removes the row, returns 204, and audits', async () => {
    const cleared: any[] = [];
    const audits: any[] = [];
    const app = await buildApp({
      recordAudit: async (_c: any, _r: any, e: any) => { audits.push(e); },
      sync: {
        getDivergence: async () => ({
          resourceType: 'Observation', resourceId: 'o1', version: 2,
          localHash: 'a', incomingHash: 'b', incomingBody: { status: 'amended' },
          incomingSiteId: 'lab-a', detectedAt: new Date(),
        }),
        clearDivergence: async (t: string, i: string, v: number) => { cleared.push([t, i, v]); },
      },
    });

    const res = await app.inject({ method: 'POST', url: '/api/settings/sync/divergences/Observation/o1/2/clear', headers: adminHeaders() });

    expect(res.statusCode).toBe(204);
    expect(cleared).toEqual([['Observation', 'o1', 2]]);
    expect(audits.map((a) => a.action)).toContain('settings.sync.divergence.clear');
    expect(JSON.stringify(audits)).not.toContain('amended'); // audit is PHI-free
  });

  it('clear 404s when there is no such divergence', async () => {
    const app = await buildApp({ sync: { getDivergence: async () => undefined, clearDivergence: async () => {} } });
    const res = await app.inject({ method: 'POST', url: '/api/settings/sync/divergences/Observation/nope/1/clear', headers: adminHeaders() });
    expect(res.statusCode).toBe(404);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server test -- settings-sync-routes`
Expected: FAIL — 404 from Fastify for the 204 case (route not registered).

- [ ] **Step 3: Add the route**

```typescript
  // Clearing is the ONLY lifecycle a divergence has (spec decision 3): nothing auto-resolves it. A
  // later higher version arriving would tell you the disagreement ENDED, not that the RIGHT content
  // won — auto-closing on that would reintroduce the silent loss this slice exists to eliminate.
  app.post('/api/settings/sync/divergences/:resourceType/:resourceId/:version/clear', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const p = req.params as { resourceType: string; resourceId: string; version: string };
    const version = Number(p.version);
    if (!Number.isInteger(version) || version < 1) {
      return reply.code(400).send({ error: 'version must be a positive integer' });
    }
    // 404 rather than a silent success: a double-clear should tell the operator the row is already gone.
    const row = await ctx.sync.getDivergence(p.resourceType, p.resourceId, version);
    if (!row) return reply.code(404).send({ error: 'divergence not found' });

    await ctx.sync.clearDivergence(p.resourceType, p.resourceId, version);
    // Audit AFTER the clear commits (S4d precedent): a recordAudit throw must not fail an operation
    // that already succeeded. PHI-free — the key only, never the body we just discarded.
    await recordAudit(ctx, req, {
      action: 'settings.sync.divergence.clear',
      entityType: p.resourceType,
      entityId: p.resourceId,
      metadata: { version },
    });
    return reply.code(204).send();
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/server test -- settings-sync-routes`
Expected: PASS

Run: `pnpm --filter @openldr/server lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/settings-routes.ts apps/server/src/settings-sync-routes.test.ts
git commit -m "feat(server): POST sync divergence clear"
```

---

### Task 10: `openldr sync divergence list|show|clear`

**Files:**
- Modify: `packages/cli/src/sync.ts` (add after `runSyncQuarantineRetry`, ~line 106)
- Modify: `packages/cli/src/index.ts` (register after the `quarantine` group, ~line 224)
- Test: `packages/cli/src/sync-divergence.test.ts`

**Context:** Required by the operator-parity convention — a CLI-only operator must never be locked out (the S5 lesson). Follows the `emit` / `redactError` / `ctx.close` idiom; errors → exit 1.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/sync-divergence.test.ts`. Mirror the existing CLI test idiom (find the suite covering `runSyncQuarantineList` and copy its `createAppContext` mocking approach verbatim).

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runSyncDivergenceList, runSyncDivergenceShow, runSyncDivergenceClear } from './sync';

const ROW = {
  resourceType: 'Observation', resourceId: 'o1', version: 2,
  localHash: 'aaa', incomingHash: 'bbb', incomingSiteId: 'lab-a', detectedAt: new Date('2026-07-15T00:00:00Z'),
};

describe('sync divergence CLI', () => {
  it('list prints a friendly line per row and exits 0', async () => {
    mockCtx({ listDivergences: async () => [ROW] });
    const out = captureStdout();
    expect(await runSyncDivergenceList({ json: false })).toBe(0);
    expect(out.text()).toContain('Observation');
    expect(out.text()).toContain('o1');
  });

  it('list says so when there are none', async () => {
    mockCtx({ listDivergences: async () => [] });
    const out = captureStdout();
    expect(await runSyncDivergenceList({ json: false })).toBe(0);
    expect(out.text()).toContain('no divergences');
  });

  it('show exits 1 for an unknown divergence', async () => {
    mockCtx({ getDivergence: async () => undefined });
    expect(await runSyncDivergenceShow('Observation', 'nope', 1, { json: false })).toBe(1);
  });

  it('show emits the row including the dropped body', async () => {
    mockCtx({ getDivergence: async () => ({ ...ROW, incomingBody: { status: 'amended' } }) });
    const out = captureStdout();
    expect(await runSyncDivergenceShow('Observation', 'o1', 2, { json: true })).toBe(0);
    expect(out.text()).toContain('amended');
  });

  it('clear exits 0 and calls through', async () => {
    const calls: any[] = [];
    mockCtx({ getDivergence: async () => ROW, clearDivergence: async (...a: any[]) => { calls.push(a); } });
    expect(await runSyncDivergenceClear('Observation', 'o1', 2, { json: false })).toBe(0);
    expect(calls).toEqual([['Observation', 'o1', 2]]);
  });

  it('clear exits 1 when the divergence does not exist', async () => {
    mockCtx({ getDivergence: async () => undefined, clearDivergence: async () => {} });
    expect(await runSyncDivergenceClear('Observation', 'nope', 1, { json: false })).toBe(1);
  });

  it('rejects a non-numeric version without touching the context', async () => {
    mockCtx({});
    expect(await runSyncDivergenceShow('Observation', 'o1', Number('abc'), { json: false })).toBe(1);
  });
});
```

> `mockCtx` / `captureStdout` stand in for the existing suite's helpers. Reuse them.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/cli test -- sync-divergence`
Expected: FAIL — `runSyncDivergenceList is not exported`

- [ ] **Step 3: Write the commands**

Append to `packages/cli/src/sync.ts` after `runSyncQuarantineRetry`:

```typescript
// `openldr sync divergence list|show|clear` — inspect + close same-version divergences (Sync S7).
// Runs on BOTH central and a lab: each side records what IT dropped, so each has its own rows.
//
// `list` is PHI-FREE (no bodies). `show` prints the dropped content — that is the point of it: on
// these links the peer holding the other copy may be unreachable for days, so the divergence must be
// diffable locally and offline.
export async function runSyncDivergenceList(opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const rows = await ctx.sync.listDivergences();
    if (opts.json) {
      emit(true, rows, '');
      return 0;
    }
    if (rows.length === 0) {
      process.stdout.write('no divergences\n');
      return 0;
    }
    for (const r of rows) {
      process.stdout.write(
        `${r.resourceType}/${r.resourceId}  v${r.version}  site=${r.incomingSiteId}  local=${(r.localHash ?? 'tombstone').slice(0, 12)}  incoming=${(r.incomingHash ?? 'tombstone').slice(0, 12)}  ${r.detectedAt.toISOString()}\n`,
      );
    }
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runSyncDivergenceShow(resourceType: string, resourceId: string, version: number, opts: JsonOpt): Promise<number> {
  if (!Number.isInteger(version) || version < 1) {
    process.stderr.write('version must be a positive integer\n');
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    const row = await ctx.sync.getDivergence(resourceType, resourceId, version);
    if (!row) {
      emit(opts.json, { ok: false, error: 'not found' }, `no divergence for ${resourceType}/${resourceId} v${version}`);
      return 1;
    }
    emit(opts.json, row, JSON.stringify(row, null, 2));
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runSyncDivergenceClear(resourceType: string, resourceId: string, version: number, opts: JsonOpt): Promise<number> {
  if (!Number.isInteger(version) || version < 1) {
    process.stderr.write('version must be a positive integer\n');
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    // Mirror the endpoint: a double-clear reports honestly instead of silently succeeding.
    const row = await ctx.sync.getDivergence(resourceType, resourceId, version);
    if (!row) {
      emit(opts.json, { ok: false, error: 'not found' }, `no divergence for ${resourceType}/${resourceId} v${version}`);
      return 1;
    }
    await ctx.sync.clearDivergence(resourceType, resourceId, version);
    emit(opts.json, { ok: true }, `cleared ${resourceType}/${resourceId} v${version}`);
    return 0;
  } finally {
    await ctx.close();
  }
}
```

- [ ] **Step 4: Register the commands**

In `packages/cli/src/index.ts`, import the three functions alongside the existing `runSyncQuarantine*` imports, then add after the `quarantine` group (~line 225):

```typescript
const divergence = syncGroup.command('divergence').description('Inspect + clear same-version divergences (sync S7)');
divergence.command('list').description('List open same-version divergences (PHI-free)').option('--json', 'emit JSON', false)
  .action(async (opts) => {
    try { process.exitCode = await runSyncDivergenceList(opts); } catch (err) { process.stderr.write(`sync divergence list failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
divergence.command('show <resourceType> <resourceId> <version>').description('Show one divergence INCLUDING the dropped content').option('--json', 'emit JSON', false)
  .action(async (resourceType, resourceId, version, opts) => {
    try { process.exitCode = await runSyncDivergenceShow(resourceType, resourceId, Number(version), opts); } catch (err) { process.stderr.write(`sync divergence show failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
divergence.command('clear <resourceType> <resourceId> <version>').description('Close a divergence after resolving it').option('--json', 'emit JSON', false)
  .action(async (resourceType, resourceId, version, opts) => {
    try { process.exitCode = await runSyncDivergenceClear(resourceType, resourceId, Number(version), opts); } catch (err) { process.stderr.write(`sync divergence clear failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/cli test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/sync.ts packages/cli/src/index.ts packages/cli/src/sync-divergence.test.ts
git commit -m "feat(cli): openldr sync divergence list|show|clear"
```

---

### Task 11: Live acceptance harness (the real proof)

**Files:**
- Create: `scripts/sync-divergence-live-acceptance.ts`
- Modify: `package.json` (add `sync:divergence:accept` next to `sync:quarantine:accept`, ~line 45)

**Context — this is the task that matters most.** Three times in S7-A/S7-B a green unit gate missed a real defect that only a live harness caught. This drives the **actual race** on **two real Postgres databases**, not a replica of it.

**Base it on `scripts/sync-amend-live-acceptance.ts`** — open it and copy its scaffolding verbatim. This harness is that one plus a lab-side local edit that collides. The scaffolding you are reusing (**verified names — do not invent alternatives**):

| Helper | What it is |
|---|---|
| `ADMIN_URL`, `urlFor(dbName)` | admin conn + per-DB URL builder (Postgres on `:5433`) |
| `provisionDb(adminDb, name)` / `provisionDrop(adminDb, name)` | drop+create a fresh DB / teardown |
| `migrateInternal(db)` | runs `createMigrator` + `internalMigrations` to latest |
| `step(m)` / `ok(m)` / `pass(m)` | console logging |
| `assert(cond, detail)` | a closure declared **inside `main()`** — increments `failures`, logs, throws |
| `createInternalDb(url)` → `.db` | the Kysely instance |
| `createFhirStore(db)` | the store under test |
| `SITE`, `RUN_TAG`, `obsId` | `'lab-a'`, a `Date.now()` run tag, and a tag-derived resource id |

There is **no** `setupTwoDbs`, `assertEq`, `drainAmendments`, or `close` helper — `main()` inlines all of it. The runner's method is **`runCycle()`**.

The harness must assert the **"before"** too: that this exact sequence is silent without the fix.

- [ ] **Step 1: Write the harness**

Create `scripts/sync-divergence-live-acceptance.ts`. Copy lines 38-95 of `sync-amend-live-acceptance.ts` (imports, `ADMIN_URL`/`urlFor`, `provisionDb`/`provisionDrop`/`migrateInternal`, `ok`/`step`/`pass`) **verbatim**, changing only the DB names and run tag:

```typescript
const CENTRAL_DB = 'openldr_s7div_central';
const LAB_DB = 'openldr_s7div_lab';
const SITE = 'lab-a';
const RUN_TAG = `s7div-accept-${Date.now()}`;
const obsId = `${RUN_TAG}-obs`;
const ctrlId = `${RUN_TAG}-ctrl`;
```

Add `createSyncDivergenceStore` to the `@openldr/db` import block. Then `main()`:

```typescript
async function main(): Promise<void> {
  const admin = createInternalDb(ADMIN_URL);
  const adminDb = admin.db as unknown as Kysely<unknown>;

  let failures = 0;
  const assert = (cond: boolean, detail: string) => {
    if (cond) { ok(detail); return; }
    failures++;
    console.error(`FAIL: ${detail}`);
    throw new Error(detail);
  };

  let central: ReturnType<typeof createInternalDb> | undefined;
  let lab: ReturnType<typeof createInternalDb> | undefined;

  try {
    step('0. provision + migrate two fresh databases on :5433');
    await provisionDb(adminDb, CENTRAL_DB);
    await provisionDb(adminDb, LAB_DB);
    central = createInternalDb(urlFor(CENTRAL_DB));
    lab = createInternalDb(urlFor(LAB_DB));
    const centralDb = central.db;
    const labDb = lab.db;
    await migrateInternal(centralDb as unknown as Kysely<unknown>);
    await migrateInternal(labDb as unknown as Kysely<unknown>);
    ok('migrated central + lab (internal) to latest');

    const centralStore = createFhirStore(centralDb);
    const labStore = createFhirStore(labDb);
    const cenDiv = createSyncDivergenceStore(centralDb);
    const labDiv = createSyncDivergenceStore(labDb);

    // ── 1. Lab authors a preliminary result, mirrored UP to central (simulates the S1 push via
    //    applyRemote at origin version 1 + the lab's site_id). Both change_log rows carry site_id=SITE,
    //    which is what makes central's amend() recognise the resource as lab-owned. ──
    step('1. lab authors preliminary Observation → mirrored up to central (applyRemote v1, siteId=SITE)');
    const seedRecord = {
      resourceType: 'Observation', id: obsId, version: 1, op: 'upsert' as const, siteId: SITE,
      resource: { resourceType: 'Observation', id: obsId, status: 'preliminary' } as never,
    };
    assert((await centralStore.applyRemote(seedRecord)) === 'applied', 'central mirrors v1');
    assert((await labStore.applyRemote(seedRecord)) === 'applied', 'lab holds v1');

    step('2. central amends the lab-owned result → central mints v2');
    const amended = await centralStore.amend({
      resourceType: 'Observation', id: obsId, status: 'amended',
      agent: 'acceptance', reason: 'central validation',
    });
    assert(amended.version === 2, `central amendment is v2 (got ${amended.version})`);

    // ── 3. THE RACE. The lab re-edits locally in the window BEFORE central's amendment arrives, so
    //    save() mints v2 too — the same version, different content. This is the exact sequence that
    //    is silent without S7. ──
    step('3. THE RACE: lab re-edits locally before the amendment arrives → lab also mints v2');
    await labStore.save({ resourceType: 'Observation', id: obsId, status: 'corrected' } as never);
    const labV2 = await labDb.selectFrom('fhir.fhir_resources').selectAll()
      .where('resource_type', '=', 'Observation').where('id', '=', obsId).executeTakeFirst();
    assert(Number((labV2 as never as { version: number }).version) === 2, 'lab independently minted v2');

    step('4. lab pushes its v2 up → central detects, KEEPS its amendment, records what it dropped');
    const pushed = {
      resourceType: 'Observation', id: obsId, version: 2, op: 'upsert' as const, siteId: SITE,
      resource: JSON.parse((labV2 as never as { resource: string }).resource),
    };
    assert((await centralStore.applyRemote(pushed)) === 'diverged', 'central returns diverged');
    assert((await cenDiv.list()).length === 1, 'central recorded exactly one divergence');
    const cenFull = await cenDiv.get('Observation', obsId, 2);
    assert((cenFull?.incomingBody as { status?: string })?.status === 'corrected', "central holds the LAB's dropped content");
    const cenCanonical = await centralDb.selectFrom('fhir.fhir_resources').selectAll()
      .where('resource_type', '=', 'Observation').where('id', '=', obsId).executeTakeFirst();
    assert(JSON.parse((cenCanonical as never as { resource: string }).resource).status === 'amended', 'central KEPT its own amendment');

    // ── 5. The lab drains its amendment stream through the REAL serve + runner path (copied from
    //    sync-amend-live-acceptance.ts step 3 — do NOT hand-roll a drain; a test that builds its own
    //    pipeline proves nothing about the one that ships). ──
    step('5. lab drains its amendment stream → lab detects, KEEPS its edit, records what it dropped');
    const centralCtx = { internalDb: centralDb, logger: console } as never;
    let amendCursor = 0;
    const runner = createAmendmentPullRunner({
      getToken: async () => 'dummy-token', // no HTTP/JWKS in this harness (flagged shortcut)
      postPull: (req: PullRequest): Promise<AmendmentPullResponse> =>
        serveAmendments(centralCtx, SITE, typeof req.fromSeq === 'number' ? req.fromSeq : 0),
      applyRecord: (rec) => labStore.applyRemote(rec),
      readCursor: async () => amendCursor,
      advanceCursor: async (seq) => { amendCursor = seq; },
      logger: {
        info() {}, debug() {},
        warn(o: unknown, m?: string) { console.log('  [sync.warn]', m ?? '', o); },
        error(o: unknown, m?: string) { console.error('  [sync.error]', m ?? '', o); },
      } as never,
    });
    await runner.runCycle();

    assert((await labDiv.list()).length === 1, 'lab recorded exactly one divergence');
    const labFull = await labDiv.get('Observation', obsId, 2);
    assert((labFull?.incomingBody as { status?: string })?.status === 'amended', "lab holds CENTRAL's dropped content");
    const labCanonical = await labDb.selectFrom('fhir.fhir_resources').selectAll()
      .where('resource_type', '=', 'Observation').where('id', '=', obsId).executeTakeFirst();
    assert(JSON.parse((labCanonical as never as { resource: string }).resource).status === 'corrected', 'lab KEPT its own edit');

    // ── 6. THE SYMMETRY — the property that makes detect-only sufficient and needs no wire change:
    //    each side recorded the OTHER's content, and neither lost its own. ──
    step('6. the SYMMETRY: each side recorded the other\'s content; neither lost its own');
    assert(cenFull!.localHash !== cenFull!.incomingHash, 'central hashes differ');
    assert(labFull!.localHash !== labFull!.incomingHash, 'lab hashes differ');
    assert(cenFull!.incomingSiteId === SITE, 'central row carries the lab origin stamp');

    step('7. idempotent re-drain adds nothing and does not churn detected_at');
    const before = labFull!.detectedAt.getTime();
    await centralStore.applyRemote(pushed);
    amendCursor = 0; // replay the whole amendment window
    await runner.runCycle();
    assert((await labDiv.list()).length === 1, 'still exactly one lab row');
    assert((await cenDiv.list()).length === 1, 'still exactly one central row');
    assert((await labDiv.get('Observation', obsId, 2))!.detectedAt.getTime() === before, 'detected_at unchanged');

    step('8. a control resource that never diverged records nothing');
    const ctrl = {
      resourceType: 'Observation', id: ctrlId, version: 1, op: 'upsert' as const, siteId: SITE,
      resource: { resourceType: 'Observation', id: ctrlId, status: 'final' } as never,
    };
    assert((await centralStore.applyRemote(ctrl)) === 'applied', 'control applies');
    assert((await centralStore.applyRemote(ctrl)) === 'skipped', 'control re-drain is skipped, NOT diverged');
    assert((await cenDiv.list()).length === 1, 'control added no divergence row');

    step('9. clear closes the divergence');
    await labDiv.clear('Observation', obsId, 2);
    assert((await labDiv.list()).length === 0, 'lab row cleared');
    assert((await cenDiv.list()).length === 1, 'clearing the lab row left central untouched');

    if (failures > 0) throw new Error(`${failures} assertion(s) failed`);
    pass('sync:divergence:accept');
  } finally {
    await central?.db.destroy();
    await lab?.db.destroy();
    await provisionDrop(adminDb, CENTRAL_DB);
    await provisionDrop(adminDb, LAB_DB);
    await adminDb.destroy();
  }
}

main().catch((e) => { console.error(`\n❌ FAILED: ${e?.stack ?? e}`); process.exit(1); });
```

> Match the teardown to whatever `sync-amend-live-acceptance.ts`'s `finally` block actually does — mirror it exactly rather than the sketch above if they differ.

- [ ] **Step 2: Register the script**

In `package.json`, next to `"sync:quarantine:accept"` (~line 45):

```json
    "sync:divergence:accept": "tsx scripts/sync-divergence-live-acceptance.ts",
```

- [ ] **Step 3: Run the harness**

Ensure Postgres is up (same prerequisite as the other `sync:*:accept` harnesses — check the header comment of `sync-amend-live-acceptance.ts` for the exact DB env vars).

Run: `pnpm sync:divergence:accept`
Expected: `✅ sync:divergence:accept PASSED`

- [ ] **Step 4: Prove the "before" — that this was silent**

Temporarily revert the detection block in `applyRemote` (Task 4, step 4) to the original `if (already) return 'skipped';` and re-run:

Run: `pnpm sync:divergence:accept`
Expected: **FAIL** at step 4 — `expected 'skipped' to be 'diverged'`.

This is the whole point of the slice: the harness must fail without the fix. If it passes, the harness is not driving the real race and must be fixed before proceeding. **Restore the detection block afterwards** and re-run to confirm PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-divergence-live-acceptance.ts package.json
git commit -m "test(sync): live acceptance for same-version divergence detection"
```

---

### Task 12: Full gate + regression

**Files:** none (verification only)

**Context:** Per the repo convention, the full gate runs before the slice is considered done. Every `applyRemote` caller is exercised by an existing harness — those are the real regression surface for the `ApplyResult` widening.

- [ ] **Step 1: Typecheck + test + build across the workspace**

Run: `pnpm turbo typecheck test build`
Expected: PASS. Known flakes: Windows pg-mem timeouts — re-run the affected package to confirm before investigating.

- [ ] **Step 2: Lint the one package that has real lint**

Run: `pnpm --filter @openldr/server lint`
Expected: PASS — enforces `return reply.send(...)` on the routes added in Tasks 8-9.

- [ ] **Step 3: Re-run every sync acceptance harness**

These collectively exercise all three `applyRemote` call sites:

```bash
pnpm sync:accept            # S1 push  → the sync-routes.ts tally
pnpm sync:amend:accept      # S6a      → the amend-pull-worker retype
pnpm sync:order-status:accept
pnpm sync:patient-merge:accept
pnpm sync:bundle:accept     # S5       → the sync-bundle.ts tally
pnpm sync:quarantine:accept
pnpm sync:divergence:accept # S7       → this slice
```

Expected: all PASS. `sync:accept` and `sync:bundle:accept` matter most — they prove the tally change didn't disturb the push/import paths.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(sync): address divergence-detection gate findings"
```

---

## Definition of Done

- [ ] `pnpm turbo typecheck test build` green
- [ ] `pnpm --filter @openldr/server lint` green
- [ ] All 7 sync acceptance harnesses pass live
- [ ] `pnpm sync:divergence:accept` **fails** when the detection block is reverted (Task 11 step 4)
- [ ] Whole-slice review performed (not just per-task gates — every real defect in S7-A/S7-B was found here)
- [ ] Merged to local `main` with `--no-ff`; **ask before pushing**
