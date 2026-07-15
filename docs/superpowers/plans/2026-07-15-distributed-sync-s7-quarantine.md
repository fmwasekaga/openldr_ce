# Distributed Sync S7-A — Poison-Bulk Quarantine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a reproducibly-failing terminology bulk record from wedging the lab's entire `'sync-pull'` stream forever — after a threshold of consecutive failures, durably quarantine it (advance past + record it in an operator-visible table) instead of holding indefinitely, with a manual retry path.

**Architecture:** The pull runner (`createSyncPullRunner`) gains two OPTIONAL injected hooks (`holdFailure`/`holdSuccess`); when absent, behavior is byte-identical to today (always-hold). Bootstrap wires them to a new durable `sync_quarantine` store (threshold 3): a hold-record apply failure increments a per-`(entity_type,entity_id)` counter and, once it crosses the threshold, the runner advances past the record so the stream flows. A quarantined item is surfaced via `SyncHandle.listQuarantine()` and cleared+re-synced via `SyncHandle.retryQuarantine()` (a targeted `termBulk.syncSystem(url)`), exposed over CLI + a `lab_admin` endpoint.

**Tech Stack:** TypeScript, Kysely (+ pg-mem tests), Fastify, Commander, Vitest, pnpm/turbo monorepo. Spec: `docs/superpowers/specs/2026-07-15-distributed-sync-s7-quarantine-design.md`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/db/src/migrations/internal/055_sync_quarantine.ts` | `sync_quarantine` table DDL | Create |
| `packages/db/src/migrations/internal/index.ts` | Register migration 055 | Modify |
| `packages/db/src/migrations/migrations.test.ts` | Add `'055_sync_quarantine'` to the key list | Modify |
| `packages/db/src/schema/internal.ts` | `SyncQuarantineTable` + `InternalSchema` member | Modify |
| `packages/db/src/sync-quarantine-store.ts` | `createSyncQuarantineStore` + `SyncQuarantineRow` | Create |
| `packages/db/src/index.ts` | Barrel-export the store + row type (if explicit) | Modify |
| `packages/sync/src/pull-worker.ts` | `holdFailure`/`holdSuccess` optional hooks + quarantine loop logic | Modify |
| `packages/bootstrap/src/sync-handle.ts` | `listQuarantine`/`retryQuarantine` on `SyncHandle` | Modify |
| `packages/bootstrap/src/index.ts` | Build store, wire hooks (threshold 3), build retry closure, pass to handle | Modify |
| `apps/server/src/settings-routes.ts` | `GET .../quarantine` + `POST .../quarantine/retry` | Modify |
| `packages/cli/src/sync.ts` + `index.ts` | `openldr sync quarantine list\|retry` | Modify |
| `scripts/sync-quarantine-live-acceptance.ts` | In-process unwedge+heal acceptance | Create |
| `package.json` (root) | `sync:quarantine:accept` | Modify |
| `docs/{CLI-REFERENCE,HTTP-API,OPERATOR-GUIDE}.md` | quarantine usage | Modify |

**Key contracts:**
- `SyncQuarantineRow = { entityType: string; entityId: string; attempts: number; status: 'holding' | 'quarantined'; lastError: string | null; lastSeq: number | null; firstFailedAt: Date; updatedAt: Date; quarantinedAt: Date | null }`
- `createSyncQuarantineStore(db).recordFailure(entityType, entityId, { seq, error, threshold }) → { attempts, status }`, `.clear(entityType, entityId)`, `.list()`, `.get(entityType, entityId)`
- `PullDeps.holdFailure?: (rec, err) => Promise<'hold' | 'quarantine'>`, `PullDeps.holdSuccess?: (rec) => Promise<void>`
- `SyncHandle.listQuarantine(): Promise<SyncQuarantineRow[]>`, `SyncHandle.retryQuarantine(entityType, entityId): Promise<{ ok: boolean; error?: string }>`

---

## Task 1: `sync_quarantine` table + store

**Files:**
- Create: `packages/db/src/migrations/internal/055_sync_quarantine.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`, `packages/db/src/migrations/migrations.test.ts`, `packages/db/src/schema/internal.ts`, `packages/db/src/index.ts`
- Create: `packages/db/src/sync-quarantine-store.ts`
- Test: `packages/db/src/sync-quarantine-store.test.ts`

Read `packages/db/src/migrations/internal/054_sync_amendments.ts` + that dir's `index.ts` + `packages/db/src/schema/internal.ts` (the `SyncAmendmentsTable` + `InternalSchema`) for the exact idiom. The pg-mem test helper is `makeMigratedDb()` from `packages/db/src/migrations/internal/test-helpers`.

- [ ] **Step 1: Write the failing store test** `packages/db/src/sync-quarantine-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createSyncQuarantineStore } from './sync-quarantine-store';

describe('createSyncQuarantineStore', () => {
  let db: Kysely<any>;
  beforeEach(async () => { db = await makeMigratedDb(); });

  it('increments attempts and flips holding→quarantined at the threshold', async () => {
    const q = createSyncQuarantineStore(db);
    const r1 = await q.recordFailure('terminology_system', 'http://x', { seq: 5, error: 'boom', threshold: 3 });
    expect(r1).toEqual({ attempts: 1, status: 'holding' });
    const r2 = await q.recordFailure('terminology_system', 'http://x', { seq: 6, error: 'boom', threshold: 3 });
    expect(r2.attempts).toBe(2); expect(r2.status).toBe('holding');
    const r3 = await q.recordFailure('terminology_system', 'http://x', { seq: 7, error: 'boom2', threshold: 3 });
    expect(r3).toEqual({ attempts: 3, status: 'quarantined' });

    const row = await q.get('terminology_system', 'http://x');
    expect(row?.status).toBe('quarantined');
    expect(row?.lastError).toBe('boom2');
    expect(row?.lastSeq).toBe(7);
    expect(row?.quarantinedAt).toBeTruthy();
  });

  it('clear() removes the row; list() returns rows', async () => {
    const q = createSyncQuarantineStore(db);
    await q.recordFailure('concept_map', 'http://m', { seq: 1, error: 'e', threshold: 3 });
    expect(await q.list()).toHaveLength(1);
    await q.clear('concept_map', 'http://m');
    expect(await q.list()).toHaveLength(0);
    expect(await q.get('concept_map', 'http://m')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/db exec vitest run src/sync-quarantine-store.test.ts`
Expected: FAIL — module + migration missing.

- [ ] **Step 3: Create the migration** `packages/db/src/migrations/internal/055_sync_quarantine.ts`:

```typescript
import { type Kysely, sql } from 'kysely';

// Distributed sync S7-A: lab-side durable failure counter for poison bulk (terminology) records. When a
// hold-record's apply fails `threshold` consecutive times, the pull runner quarantines it (advances past
// so the stream isn't wedged) and records it here for operator visibility + manual retry. Keyed by the
// record's entity so a system that keeps failing is tracked as one row. Public schema (lab operational
// state), sibling of reference_change_log / sync_amendments.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('sync_quarantine')
    .addColumn('entity_type', 'text', (c) => c.notNull())
    .addColumn('entity_id', 'text', (c) => c.notNull())
    .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('status', 'text', (c) => c.notNull())
    .addColumn('last_error', 'text')
    .addColumn('last_seq', 'bigint')
    .addColumn('first_failed_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('quarantined_at', 'timestamptz')
    .addPrimaryKeyConstraint('sync_quarantine_pkey', ['entity_type', 'entity_id'])
    .execute();
}
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('sync_quarantine').execute();
}
```

Register in `packages/db/src/migrations/internal/index.ts` (`import * as m055 from './055_sync_quarantine';` after m054, and `'055_sync_quarantine': { up: m055.up, down: m055.down },` at the end of the record). Append `'055_sync_quarantine'` to the expected key list in `packages/db/src/migrations/migrations.test.ts`.

- [ ] **Step 4: Add the schema type** — in `packages/db/src/schema/internal.ts`, after `SyncAmendmentsTable` add:

```typescript
// Distributed sync S7-A: lab-side poison-bulk quarantine (public schema). One row per failing bulk entity
// (terminology system / concept map). `status` is 'holding' (below threshold, cursor still holds) or
// 'quarantined' (crossed → runner advances past). PK (entity_type, entity_id).
export interface SyncQuarantineTable {
  entity_type: string;
  entity_id: string;
  attempts: Generated<number>;
  status: string;
  last_error: string | null;
  last_seq: number | null;
  first_failed_at: Generated<Date>;
  updated_at: Generated<Date>;
  quarantined_at: Date | null;
}
```

Add `sync_quarantine: SyncQuarantineTable;` to `InternalSchema` (next to `sync_amendments`).

- [ ] **Step 5: Create the store** `packages/db/src/sync-quarantine-store.ts`:

```typescript
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export interface SyncQuarantineRow {
  entityType: string;
  entityId: string;
  attempts: number;
  status: 'holding' | 'quarantined';
  lastError: string | null;
  lastSeq: number | null;
  firstFailedAt: Date;
  updatedAt: Date;
  quarantinedAt: Date | null;
}

export interface SyncQuarantineStore {
  recordFailure(entityType: string, entityId: string, opts: { seq: number; error: string; threshold: number }): Promise<{ attempts: number; status: 'holding' | 'quarantined' }>;
  clear(entityType: string, entityId: string): Promise<void>;
  list(): Promise<SyncQuarantineRow[]>;
  get(entityType: string, entityId: string): Promise<SyncQuarantineRow | undefined>;
}

function toRow(r: {
  entity_type: string; entity_id: string; attempts: number; status: string; last_error: string | null;
  last_seq: number | string | null; first_failed_at: Date; updated_at: Date; quarantined_at: Date | null;
}): SyncQuarantineRow {
  return {
    entityType: r.entity_type, entityId: r.entity_id, attempts: Number(r.attempts),
    status: r.status === 'quarantined' ? 'quarantined' : 'holding',
    lastError: r.last_error, lastSeq: r.last_seq == null ? null : Number(r.last_seq),
    firstFailedAt: r.first_failed_at, updatedAt: r.updated_at, quarantinedAt: r.quarantined_at,
  };
}

export function createSyncQuarantineStore(db: Kysely<InternalSchema>): SyncQuarantineStore {
  return {
    async recordFailure(entityType, entityId, { seq, error, threshold }) {
      // Single-threaded pull runner → read-then-upsert is safe. attempts climbs monotonically; status
      // crosses to 'quarantined' at the threshold and stays there. quarantined_at is stamped ONCE (on the
      // first crossing) and preserved thereafter.
      const cur = await db.selectFrom('sync_quarantine').select(['attempts', 'quarantined_at'])
        .where('entity_type', '=', entityType).where('entity_id', '=', entityId).executeTakeFirst();
      const attempts = Number(cur?.attempts ?? 0) + 1;
      const status: 'holding' | 'quarantined' = attempts >= threshold ? 'quarantined' : 'holding';
      const quarantinedAt = status === 'quarantined' ? (cur?.quarantined_at ?? new Date()) : null;
      await db.insertInto('sync_quarantine')
        .values({ entity_type: entityType, entity_id: entityId, attempts, status, last_error: error, last_seq: seq, quarantined_at: quarantinedAt })
        .onConflict((oc) => oc.columns(['entity_type', 'entity_id']).doUpdateSet({
          attempts, status, last_error: error, last_seq: seq, updated_at: sql`now()`, quarantined_at: quarantinedAt,
        }))
        .execute();
      return { attempts, status };
    },
    async clear(entityType, entityId) {
      await db.deleteFrom('sync_quarantine').where('entity_type', '=', entityType).where('entity_id', '=', entityId).execute();
    },
    async list() {
      const rows = await db.selectFrom('sync_quarantine').selectAll().orderBy('updated_at', 'desc').execute();
      return rows.map(toRow);
    },
    async get(entityType, entityId) {
      const r = await db.selectFrom('sync_quarantine').selectAll()
        .where('entity_type', '=', entityType).where('entity_id', '=', entityId).executeTakeFirst();
      return r ? toRow(r) : undefined;
    },
  };
}
```

- [ ] **Step 6: Barrel-export** — in `packages/db/src/index.ts`: if it uses explicit re-exports, add `export { createSyncQuarantineStore, type SyncQuarantineStore, type SyncQuarantineRow } from './sync-quarantine-store';`. If `export *`, ensure the file is included. (Match how `sync-site-store` / other stores are exported.)

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm --filter @openldr/db exec vitest run src/sync-quarantine-store.test.ts src/migrations/migrations.test.ts`
Expected: PASS.
Run: `pnpm --filter @openldr/db exec tsc --noEmit` → clean.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/migrations/internal/055_sync_quarantine.ts packages/db/src/migrations/internal/index.ts packages/db/src/migrations/migrations.test.ts packages/db/src/schema/internal.ts packages/db/src/sync-quarantine-store.ts packages/db/src/sync-quarantine-store.test.ts packages/db/src/index.ts
git commit -m "feat(db): sync_quarantine table + store (sync S7-A)"
```
(No `Co-Authored-By` trailer.)

---

## Task 2: Runner hold→quarantine hooks

**Files:**
- Modify: `packages/sync/src/pull-worker.ts`
- Test: `packages/sync/src/pull-worker.test.ts`

- [ ] **Step 1: Write the failing tests** — add to `packages/sync/src/pull-worker.test.ts` (read it first for the harness — it builds `createSyncPullRunner` with fake deps + fake cursor). Add:

```typescript
it('holds while holdFailure returns hold, then advances past once it returns quarantine', async () => {
  let cursor = 0;
  const decisions = ['hold', 'hold', 'quarantine'] as const;
  let call = 0;
  // window: [poison bulk seq 5, following per-row config seq 6]
  const resp = { records: [
    { seq: 5, entityType: 'terminology_system', entityId: 'http://x', op: 'upsert', body: {} },
    { seq: 6, entityType: 'setting', entityId: 's1', op: 'upsert', body: 'v' },
  ], nextSeq: 6 } as any;
  const runner = createSyncPullRunner({
    getToken: async () => 't',
    postPull: async () => resp,
    applyRecord: async (r: any) => { if (r.entityType === 'terminology_system') throw new Error('poison'); return 'applied'; },
    readCursor: async () => cursor,
    advanceCursor: async (s: number) => { cursor = s; },
    holdFailure: async () => decisions[Math.min(call++, decisions.length - 1)],
    holdSuccess: async () => {},
    logger: silentLogger,
  });
  await runner.runCycle(); expect(cursor).toBe(0); // held (attempt 1) — capped before the poison record
  await runner.runCycle(); expect(cursor).toBe(0); // held (attempt 2)
  await runner.runCycle(); expect(cursor).toBe(6); // quarantined → advanced past poison, config seq 6 applied
});

it('calls holdSuccess after a hold-record applies successfully', async () => {
  let cursor = 0; let cleared = false;
  const resp = { records: [{ seq: 5, entityType: 'terminology_system', entityId: 'http://x', op: 'upsert', body: {} }], nextSeq: 5 } as any;
  const runner = createSyncPullRunner({
    getToken: async () => 't', postPull: async () => resp,
    applyRecord: async () => 'applied',
    readCursor: async () => cursor, advanceCursor: async (s: number) => { cursor = s; },
    holdFailure: async () => 'hold', holdSuccess: async () => { cleared = true; }, logger: silentLogger,
  });
  await runner.runCycle();
  expect(cleared).toBe(true); expect(cursor).toBe(5);
});

it('never calls holdFailure on a transport failure (outer catch)', async () => {
  let called = false;
  const runner = createSyncPullRunner({
    getToken: async () => { throw new Error('down'); },
    postPull: async () => ({ records: [], nextSeq: 0 }) as any,
    applyRecord: async () => 'applied', readCursor: async () => 3, advanceCursor: async () => {},
    holdFailure: async () => { called = true; return 'hold'; }, holdSuccess: async () => {}, logger: silentLogger,
  });
  await runner.runCycle();
  expect(called).toBe(false);
});
```

(Use the file's existing `silentLogger`/harness. The `holdFailure` returning the third-time `'quarantine'` models the durable counter crossing the threshold.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @openldr/sync exec vitest run src/pull-worker.test.ts`
Expected: the quarantine + holdSuccess tests FAIL (hooks not consulted yet); the transport test may pass already.

- [ ] **Step 3: Add the hooks to `PullDeps`** — in `packages/sync/src/pull-worker.ts`, after `isHoldRecord?`:

```typescript
  // Sync S7-A: durable poison-bulk quarantine hooks (optional — absent = always-hold, unchanged). On a
  // HOLD-record apply failure, holdFailure durably counts consecutive failures for the record's entity and
  // returns 'quarantine' once a threshold is crossed (→ advance PAST it instead of holding forever), else
  // 'hold'. holdSuccess clears the counter after a hold-record applies successfully.
  holdFailure?: (rec: PullRecord, err: Error) => Promise<'hold' | 'quarantine'>;
  holdSuccess?: (rec: PullRecord) => Promise<void>;
```

- [ ] **Step 4: Wire the loop** — in `createSyncPullRunner`'s `for` loop, change the success branch to clear the counter after a hold-record success, and the hold-failure branch to consult `holdFailure`:

Success branch (currently `applied++; safeSeq = rec.seq;`):
```typescript
          await deps.applyRecord(rec);
          applied++;
          safeSeq = rec.seq;
          if (isHold(rec)) await deps.holdSuccess?.(rec); // S7-A: clear any quarantine counter for this entity
```

Hold-failure branch (currently unconditional `held = true; break;`):
```typescript
          if (isHold(rec)) {
            const decision = (await deps.holdFailure?.(rec, err as Error)) ?? 'hold';
            if (decision === 'hold') {
              deps.logger.warn(
                { err: (err as Error).message, entityType: rec.entityType, entityId: rec.entityId, seq: rec.seq },
                'sync pull: bulk apply failed; holding cursor (will retry)',
              );
              held = true;
              break;
            }
            // S7-A: crossed the failure threshold → quarantine. Advance PAST it (like a per-row skip) so the
            // rest of the stream is no longer wedged; the durable store already recorded it for the operator.
            deps.logger.error(
              { err: (err as Error).message, entityType: rec.entityType, entityId: rec.entityId, seq: rec.seq },
              'sync pull: bulk apply repeatedly failed; quarantined, advancing past',
            );
            safeSeq = rec.seq;
          } else {
            // Per-row quarantine (S2/Layer-A): log, skip, advance past.
            deps.logger.warn(
              { err: (err as Error).message, entityType: rec.entityType, entityId: rec.entityId, seq: rec.seq },
              'sync pull: apply failed; skipping (quarantine)',
            );
            safeSeq = rec.seq;
          }
```
(Restructure the existing `if (isHold(rec)) {...} <per-row code>` into the `if/else` above — keep the per-row branch's behavior identical.)

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @openldr/sync exec vitest run src/pull-worker.test.ts`
Expected: PASS (new + all pre-existing — the pre-existing tests pass no hooks → `?? 'hold'` preserves old behavior).
Run: `pnpm --filter @openldr/sync exec tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/sync/src/pull-worker.ts packages/sync/src/pull-worker.test.ts
git commit -m "feat(sync): pull runner hold→quarantine hooks (sync S7-A)"
```

---

## Task 3: Bootstrap wiring + `SyncHandle` list/retry

**Files:**
- Modify: `packages/bootstrap/src/sync-handle.ts`
- Modify: `packages/bootstrap/src/index.ts`
- Test: `packages/bootstrap/src/sync-handle.test.ts`

- [ ] **Step 1: Extend `SyncHandle`** — in `packages/bootstrap/src/sync-handle.ts`:

Add the import + types:
```typescript
import type { InternalSchema, SyncQuarantineRow, SyncQuarantineStore } from '@openldr/db';
```
Add to the `SyncHandle` interface:
```typescript
  listQuarantine(): Promise<SyncQuarantineRow[]>;
  retryQuarantine(entityType: string, entityId: string): Promise<{ ok: boolean; error?: string }>;
```
Add to `createSyncHandle`'s `opts`:
```typescript
  quarantine?: SyncQuarantineStore;
  retryQuarantine?: (entityType: string, entityId: string) => Promise<{ ok: boolean; error?: string }>;
```
Add to the returned object:
```typescript
    async listQuarantine(): Promise<SyncQuarantineRow[]> {
      return opts.quarantine ? opts.quarantine.list() : [];
    },
    async retryQuarantine(entityType: string, entityId: string): Promise<{ ok: boolean; error?: string }> {
      if (!opts.retryQuarantine) return { ok: false, error: 'sync pull is not enabled on this node' };
      return opts.retryQuarantine(entityType, entityId);
    },
```

- [ ] **Step 2: Write the failing handle test** — extend `packages/bootstrap/src/sync-handle.test.ts`:

```typescript
it('listQuarantine returns [] when no store; delegates when present', async () => {
  const rows = [{ entityType: 'terminology_system', entityId: 'http://x', attempts: 3, status: 'quarantined' }] as any;
  const h1 = createSyncHandle({ db: fakeDb(), enabled: true, mode: 'pull', centralUrl: '', siteId: '' });
  expect(await h1.listQuarantine()).toEqual([]);
  const h2 = createSyncHandle({ db: fakeDb(), enabled: true, mode: 'pull', centralUrl: '', siteId: '', quarantine: { list: async () => rows } as any });
  expect(await h2.listQuarantine()).toEqual(rows);
});

it('retryQuarantine errors when pull is not enabled; delegates when wired', async () => {
  const h1 = createSyncHandle({ db: fakeDb(), enabled: true, mode: 'push', centralUrl: '', siteId: '' });
  expect(await h1.retryQuarantine('terminology_system', 'http://x')).toEqual({ ok: false, error: expect.stringContaining('not enabled') });
  const retry = vi.fn(async () => ({ ok: true }));
  const h2 = createSyncHandle({ db: fakeDb(), enabled: true, mode: 'pull', centralUrl: '', siteId: '', retryQuarantine: retry });
  expect(await h2.retryQuarantine('terminology_system', 'http://x')).toEqual({ ok: true });
  expect(retry).toHaveBeenCalledWith('terminology_system', 'http://x');
});
```

(Reuse the file's existing `fakeDb()`/`createSyncHandle` setup. The existing `status()` tests use a real pg-mem db seeding `fhir.change_cursors` — for these two, `status()` isn't called, so a minimal fake db suffices; match whatever the file already uses.)

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/sync-handle.test.ts` → FAIL (methods missing) then PASS after Step 1.

- [ ] **Step 3: Wire it in `index.ts`** — in `packages/bootstrap/src/index.ts`:

(a) Import: add `createSyncQuarantineStore` to the `@openldr/db` import (the big line ~10).

(b) Before the mode gate (where `syncPushWorker`/`syncPullWorker` are declared with `let`), declare:
```typescript
      let syncQuarantine: import('@openldr/db').SyncQuarantineStore | undefined;
      let syncRetryQuarantine: ((entityType: string, entityId: string) => Promise<{ ok: boolean; error?: string }>) | undefined;
      const QUARANTINE_THRESHOLD = 3; // Sync S7-A: consecutive bulk-apply failures before quarantine
```
(Match the actual scope where the workers are declared — put these next to them.)

(c) Inside `if (shouldStartPull(syncCfg.mode)) { ... }`, AFTER `termBulk` is built and BEFORE `syncPullRunner`:
```typescript
      const quarantine = createSyncQuarantineStore(internal.db);
      syncQuarantine = quarantine;
      // Sync S7-A: a targeted re-sync of a quarantined bulk entity, independent of the advanced cursor.
      // Clears the row, re-runs the entity's bulk sync; on failure re-records (re-quarantines).
      syncRetryQuarantine = async (entityType: string, entityId: string) => {
        await quarantine.clear(entityType, entityId);
        try {
          if (entityType === 'terminology_system') await termBulk.syncSystem(entityId, undefined);
          else if (entityType === 'concept_map') await termBulk.syncConceptMap(entityId, undefined);
          else return { ok: false, error: `not a retriable bulk entity type: ${entityType}` };
          return { ok: true };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await quarantine.recordFailure(entityType, entityId, { seq: 0, error: msg, threshold: QUARANTINE_THRESHOLD });
          return { ok: false, error: msg };
        }
      };
```
NOTE: check `termBulk.syncSystem`/`syncConceptMap`'s real signatures (from `createTerminologyBulkSync` in `@openldr/sync`) — the second arg is the record `body`/descriptor; passing `undefined` triggers a fetch-by-url drain. If the signature differs, adapt so a retry re-drives a full sync of that url. Read `applyRecord` in the same block (it calls `termBulk.syncSystem(rec.entityId, rec.body)`) to match.

(d) In the `createSyncPullRunner({ ... })` deps (same block), add the two hooks:
```typescript
        holdFailure: (rec, err) =>
          quarantine.recordFailure(rec.entityType, rec.entityId, { seq: rec.seq, error: err.message, threshold: QUARANTINE_THRESHOLD })
            .then((r) => (r.status === 'quarantined' ? 'quarantine' : 'hold')),
        holdSuccess: (rec) => quarantine.clear(rec.entityType, rec.entityId),
```

(e) In the `createSyncHandle({ ... })` call (after the mode gate), pass:
```typescript
    quarantine: syncQuarantine,
    retryQuarantine: syncRetryQuarantine,
```

- [ ] **Step 4: Typecheck + tests**

Run: `pnpm --filter @openldr/bootstrap exec tsc --noEmit` → clean.
Run: `pnpm --filter @openldr/bootstrap exec vitest run src/sync-handle.test.ts` → PASS. Then the full bootstrap suite `pnpm --filter @openldr/bootstrap exec vitest run` → PASS (existing pull-worker/sync tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/sync-handle.ts packages/bootstrap/src/index.ts packages/bootstrap/src/sync-handle.test.ts
git commit -m "feat(bootstrap): wire quarantine hooks + SyncHandle list/retry (sync S7-A)"
```

---

## Task 4: `GET/POST /api/settings/sync/quarantine` endpoints

**Files:**
- Modify: `apps/server/src/settings-routes.ts`
- Test: `apps/server/src/settings-sync-routes.test.ts`

Read the existing `/api/settings/sync/status` + `/api/settings/sync/now` handlers (they call `ctx.sync.*`) and their tests for the `fakeCtx`/`adminApp` idiom (the fake ctx has a `sync` object).

- [ ] **Step 1: Write the failing tests** — add (matching the harness):

```typescript
  it('GET /api/settings/sync/quarantine lists quarantined items', async () => {
    const rows = [{ entityType: 'terminology_system', entityId: 'http://x', attempts: 3, status: 'quarantined' }];
    const ctx = fakeCtx(); ctx.sync.listQuarantine = async () => rows;
    const res = await adminApp(ctx).inject({ method: 'GET', url: '/api/settings/sync/quarantine' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(rows);
  });

  it('POST /api/settings/sync/quarantine/retry delegates and audits', async () => {
    const retry = vi.fn(async () => ({ ok: true }));
    const ctx = fakeCtx(); ctx.sync.retryQuarantine = retry;
    const res = await adminApp(ctx).inject({ method: 'POST', url: '/api/settings/sync/quarantine/retry', payload: { entityType: 'terminology_system', entityId: 'http://x' } });
    expect(res.statusCode).toBe(200);
    expect(retry).toHaveBeenCalledWith('terminology_system', 'http://x');
  });

  it('retry returns 400 on missing fields and 409 when pull disabled', async () => {
    const ctx = fakeCtx();
    expect((await adminApp(ctx).inject({ method: 'POST', url: '/api/settings/sync/quarantine/retry', payload: {} })).statusCode).toBe(400);
    const ctx2 = fakeCtx(); ctx2.sync.retryQuarantine = async () => ({ ok: false, error: 'sync pull is not enabled on this node' });
    expect((await adminApp(ctx2).inject({ method: 'POST', url: '/api/settings/sync/quarantine/retry', payload: { entityType: 'terminology_system', entityId: 'http://x' } })).statusCode).toBe(409);
  });
```

(Ensure `fakeCtx().sync` has `listQuarantine`/`retryQuarantine` defaults so unrelated tests don't break — add safe no-op defaults to the shared `fakeCtx` if the tests above assign per-test.)

- [ ] **Step 2: Run to verify failure** → 404s.

- [ ] **Step 3: Implement** — in `apps/server/src/settings-routes.ts`, after the `/api/settings/sync/now` handler:

```typescript
  // Sync S7-A: list quarantined poison-bulk records (lab_admin, user-authed).
  app.get('/api/settings/sync/quarantine', { preHandler: requireRole('lab_admin') }, async () => ctx.sync.listQuarantine());

  // Sync S7-A: manually retry a quarantined bulk entity — clears + re-syncs it by url.
  app.post('/api/settings/sync/quarantine/retry', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const b = (req.body ?? {}) as { entityType?: unknown; entityId?: unknown };
    if (typeof b.entityType !== 'string' || !b.entityType || typeof b.entityId !== 'string' || !b.entityId) {
      reply.code(400).send({ error: 'entityType and entityId are required' });
      return;
    }
    const result = await ctx.sync.retryQuarantine(b.entityType, b.entityId);
    await recordAudit(ctx, req, { action: 'settings.sync.quarantine.retry', entityType: b.entityType, entityId: b.entityId, metadata: { ok: result.ok } });
    if (!result.ok) {
      // "not enabled" → 409; a real re-sync failure → 200 with ok:false (the caller sees the error).
      if ((result.error ?? '').includes('not enabled')) { reply.code(409).send(result); return; }
    }
    reply.code(200).send(result);
  });
```

- [ ] **Step 4: Run tests + typecheck** → PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/settings-routes.ts apps/server/src/settings-sync-routes.test.ts
git commit -m "feat(server): sync quarantine list + retry endpoints (sync S7-A)"
```

---

## Task 5: `openldr sync quarantine list|retry` CLI

**Files:**
- Modify: `packages/cli/src/sync.ts`, `packages/cli/src/index.ts`
- Test: `packages/cli/src/sync-quarantine.test.ts`

Read `runSyncStatus`/`runSyncNow` in `sync.ts` (they build an AppContext and call `ctx.sync.*`) + the `syncGroup` registration in `index.ts`.

- [ ] **Step 1: Write the failing test** `packages/cli/src/sync-quarantine.test.ts` (mirror `sync-amend.test.ts`'s hoisted-mock idiom, mocking `createAppContext` → `{ sync: {...}, close }`):

```typescript
import { describe, it, expect, vi } from 'vitest';
const listQ = vi.hoisted(() => vi.fn(async () => [{ entityType: 'terminology_system', entityId: 'http://x', attempts: 3, status: 'quarantined', lastError: 'boom', updatedAt: new Date() }]));
const retryQ = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const close = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@openldr/bootstrap', () => ({ createAppContext: async () => ({ sync: { listQuarantine: listQ, retryQuarantine: retryQ }, close }) }));
vi.mock('@openldr/config', () => ({ loadConfig: () => ({}) }));
import { runSyncQuarantineList, runSyncQuarantineRetry } from './sync';

describe('sync quarantine CLI', () => {
  it('list returns 0 and calls listQuarantine', async () => {
    expect(await runSyncQuarantineList({ json: true })).toBe(0);
    expect(listQ).toHaveBeenCalled();
  });
  it('retry returns 0 on ok and calls retryQuarantine', async () => {
    expect(await runSyncQuarantineRetry('terminology_system', 'http://x', { json: true })).toBe(0);
    expect(retryQ).toHaveBeenCalledWith('terminology_system', 'http://x');
  });
  it('retry returns 1 when ok:false', async () => {
    retryQ.mockResolvedValueOnce({ ok: false, error: 'nope' });
    expect(await runSyncQuarantineRetry('terminology_system', 'http://x', { json: true })).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure** → not exported.

- [ ] **Step 3: Implement** in `packages/cli/src/sync.ts` (after `runSyncNow`):

```typescript
export async function runSyncQuarantineList(opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const rows = await ctx.sync.listQuarantine();
    if (opts.json) { emit(true, rows, ''); return 0; }
    if (rows.length === 0) { process.stdout.write('no quarantined records\n'); return 0; }
    for (const r of rows) {
      process.stdout.write(`${r.status.padEnd(11)} ${r.entityType}  ${r.entityId}  attempts=${r.attempts}  ${r.lastError ?? ''}\n`);
    }
    return 0;
  } finally { await ctx.close(); }
}

export async function runSyncQuarantineRetry(entityType: string, entityId: string, opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const result = await ctx.sync.retryQuarantine(entityType, entityId);
    emit(opts.json, result, result.ok ? `retried ${entityType} ${entityId}` : `retry failed: ${result.error ?? 'unknown'}`);
    return result.ok ? 0 : 1;
  } finally { await ctx.close(); }
}
```

(`JsonOpt`, `emit`, `createAppContext`, `loadConfig` are already in the file — verify.)

- [ ] **Step 4: Register commands** in `packages/cli/src/index.ts` — add `runSyncQuarantineList, runSyncQuarantineRetry` to the `./sync` import, then in the `syncGroup` block:

```typescript
const quarantine = syncGroup.command('quarantine').description('Inspect + retry poison-bulk quarantine (sync S7-A)');
quarantine.command('list').description('List quarantined / holding bulk records').option('--json', 'emit JSON', false)
  .action(async (opts) => { try { process.exitCode = await runSyncQuarantineList(opts); } catch (err) { process.stderr.write(`sync quarantine list failed: ${redactError(err)}\n`); process.exitCode = 1; } });
quarantine.command('retry <entityType> <entityId>').description('Clear + re-sync a quarantined bulk entity by id (url)').option('--json', 'emit JSON', false)
  .action(async (entityType, entityId, opts) => { try { process.exitCode = await runSyncQuarantineRetry(entityType, entityId, opts); } catch (err) { process.stderr.write(`sync quarantine retry failed: ${redactError(err)}\n`); process.exitCode = 1; } });
```

- [ ] **Step 5: Run tests + typecheck** → PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/sync.ts packages/cli/src/index.ts packages/cli/src/sync-quarantine.test.ts
git commit -m "feat(cli): openldr sync quarantine list|retry (sync S7-A)"
```

---

## Task 6: In-process unwedge+heal acceptance

**Files:**
- Create: `scripts/sync-quarantine-live-acceptance.ts`
- Modify: `package.json` (root) — `sync:quarantine:accept`

Unlike the co-edit harnesses this needs only ONE lab Postgres DB (it's lab-side runner behavior) + an in-process fake central serve. Read `scripts/sync-terminology-live-acceptance.ts` (or the S2 pull harness) for the connect/migrate/teardown + how a `createSyncPullRunner` is driven with a real quarantine store, and `scripts/sync-amend-live-acceptance.ts` for the assert/provision idiom.

- [ ] **Step 1: Write the acceptance script** proving:
  1. Provision one lab internal PG DB (migrate to latest — includes 055).
  2. Build `createSyncQuarantineStore(labDb)` + a `createSyncPullRunner` whose:
     - `postPull` returns a fixed window `[{seq:5, entityType:'terminology_system', entityId:'http://poison', op:'upsert', body:{...}}, {seq:6, entityType:'setting', entityId:'flag.x', op:'upsert', body:'on'}]` then an empty window after the cursor passes 6.
     - `applyRecord` throws for the poison `terminology_system` (simulating a reproducibly-failing bulk apply) and, for the `setting`, writes it via the real reference applier (or a simple recorded set) so you can assert it applied.
     - `holdFailure`/`holdSuccess` wired to the real quarantine store (threshold 3); `readCursor`/`advanceCursor` bound to a real `'sync-pull'` cursor row (or a local var backed by the change_cursors table).
  3. Drive `runCycle()` 3 times → assert: after cycle 1 & 2 the cursor is still 0 (held) and `setting flag.x` did NOT apply; after cycle 3 the poison entity is `quarantined` in `sync_quarantine`, the cursor advanced to 6, and **`setting flag.x` DID apply** (the wedge is broken).
  4. `retryQuarantine`-style heal: flip the fake `applyRecord`/`syncSystem` to now succeed for `http://poison`, call the store `clear` + re-apply (or drive the retry closure if easily constructible) → assert the quarantine row is gone and the system applied.
  Use an `assert(cond,msg)` helper; drop the DB in `finally`. Final line: `sync:quarantine:accept PASSED`. `main().catch(e => { console.error(e); process.exit(1); })`.

  If wiring the real `termBulk`-backed retry closure in-harness is awkward, prove the heal at the store level (record→quarantine→clear→re-apply-succeeds→row absent) — the endpoint/CLI/bootstrap retry path is unit-covered in Tasks 3-5. Do NOT fake the unwedge assertion (steps 3) — that is the crux.

- [ ] **Step 2: Add the pnpm script** in root `package.json` next to `sync:amend:accept`:
```json
"sync:quarantine:accept": "tsx scripts/sync-quarantine-live-acceptance.ts",
```

- [ ] **Step 3: Run it** — `docker compose up -d postgres` if needed, then `pnpm sync:quarantine:accept` → `sync:quarantine:accept PASSED`. If Postgres is unavailable, do NOT fake a pass — report the harness as written + committed with the real run output.

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-quarantine-live-acceptance.ts package.json
git commit -m "test(sync): S7-A quarantine unwedge+heal acceptance"
```

---

## Task 7: Docs, gate, and regression

**Files:** `docs/CLI-REFERENCE.md`, `docs/HTTP-API.md`, `docs/OPERATOR-GUIDE.md`

- [ ] **Step 1: Document quarantine** — extend the existing sync sections:
  - CLI: `openldr sync quarantine list` + `openldr sync quarantine retry <entityType> <entityId>`.
  - HTTP: `GET /api/settings/sync/quarantine` + `POST /api/settings/sync/quarantine/retry` (lab_admin).
  - Operator guide: one paragraph — a terminology system that repeatedly fails to apply is quarantined (after 3 attempts) so it stops blocking the rest of the pull stream; list + retry it once the cause is fixed.

- [ ] **Step 2: Per-package gate** (run each directly; never pipe turbo through `tail`; report counts):
```
pnpm --filter @openldr/db exec vitest run
pnpm --filter @openldr/sync exec vitest run
pnpm --filter @openldr/bootstrap exec vitest run
pnpm --filter @openldr/server exec vitest run
pnpm --filter @openldr/cli exec vitest run
pnpm --filter @openldr/db exec tsc --noEmit
pnpm --filter @openldr/sync exec tsc --noEmit
pnpm --filter @openldr/bootstrap exec tsc --noEmit
pnpm --filter @openldr/server exec tsc --noEmit
pnpm --filter @openldr/cli exec tsc --noEmit
```
Known Windows parallel-pg-mem TIMEOUT flakes in the full db/bootstrap/server runs are NOT real failures — re-run the S7-A-relevant files in isolation to confirm (`@openldr/db`: `src/sync-quarantine-store.test.ts`; `@openldr/sync`: `src/pull-worker.test.ts`; `@openldr/bootstrap`: `src/sync-handle.test.ts`), and report both.

- [ ] **Step 3: Regression** (dev Postgres up):
```
pnpm sync:terminology:accept   # the hooks are wired on the happy path — must still pass
pnpm sync:quarantine:accept
pnpm sync:amend:accept
pnpm sync:order-status:accept
pnpm sync:patient-merge:accept
```
Report each PASSED line. (`sync:terminology:accept` re-passing proves the wired hooks don't disturb the normal bulk-apply happy path.)

- [ ] **Step 4: Commit docs**
```bash
git add docs
git commit -m "docs(sync): document S7-A quarantine list/retry"
```

---

## Self-Review (completed during planning)

**Spec coverage:** §3 mechanism (hooks + loop) → Task 2; §4 store + migration → Task 1; §5 bootstrap wiring + SyncHandle → Task 3; §6 endpoint → Task 4, CLI → Task 5; §7 testing → Tasks 1,2,6; §10 non-goals (config knob, auto-retry, UI, per-row) → not implemented, correct.

**Type consistency:** `SyncQuarantineRow`/`SyncQuarantineStore`/`recordFailure`/`clear`/`list`/`get` (Task 1) consumed by bootstrap (Task 3) + CLI (Task 5). `holdFailure`/`holdSuccess` (Task 2) wired in Task 3. `SyncHandle.listQuarantine`/`retryQuarantine` (Task 3) consumed by endpoint (Task 4) + CLI (Task 5). Threshold `3` consistent (bootstrap const). `'holding'|'quarantined'` status literal consistent across store, runner mapping, and tests.

**Placeholder scan:** Task 3(c) flags "check termBulk.syncSystem/syncConceptMap real signatures" and Task 6 delegates the acceptance's connect/teardown to the sibling idioms — both point at existing code to match, not undefined logic; the unwedge assertion (Task 6 step 3) is fully specified as the crux. Task 1's migration number (055) is confirmed as next after 054_sync_amendments. All code steps contain complete code.
