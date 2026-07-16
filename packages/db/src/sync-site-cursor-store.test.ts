import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createSyncSiteCursorStore } from './sync-site-cursor-store';

describe('sync-site-cursor-store', () => {
  it('reports and reads back a position', async () => {
    const db = await makeMigratedDb();
    const store = createSyncSiteCursorStore(db as never);
    await store.report('lab-a', 'sync-pull', 500);
    expect(await store.get('lab-a', 'sync-pull')).toBe(500);
    await db.destroy();
  });

  it('returns 0 for an unknown site — 0 means "full snapshot", undefined would mean "nothing"', async () => {
    const db = await makeMigratedDb();
    const store = createSyncSiteCursorStore(db as never);
    expect(await store.get('never-seen', 'sync-pull')).toBe(0);
    await db.destroy();
  });

  // THE test. If someone "fixes" the missing monotonic guard, this must go red.
  it('NEVER clamps: a LOWER reported seq overwrites — a lab restored from backup needs those records again', async () => {
    const db = await makeMigratedDb();
    const store = createSyncSiteCursorStore(db as never);
    await store.report('lab-a', 'sync-pull', 5000);
    await store.report('lab-a', 'sync-pull', 100);   // DB restored from backup; cursor regressed
    expect(await store.get('lab-a', 'sync-pull')).toBe(100);
    await db.destroy();
  });

  it('re-report TOUCHES the row: seq changes and reported_at is refreshed', async () => {
    const db = await makeMigratedDb();
    const store = createSyncSiteCursorStore(db as never);
    await store.report('lab-a', 'sync-pull', 1);
    const first = (await store.list()).find((r) => r.siteId === 'lab-a')!.reportedAt.getTime();
    await new Promise((r) => setTimeout(r, 10));
    await store.report('lab-a', 'sync-pull', 2);
    const second = (await store.list()).find((r) => r.siteId === 'lab-a')!.reportedAt.getTime();
    // Two independent assertions catching two independent mutants:
    //   seq === 2 catches the whole doUpdateSet degrading to doNothing (the row would keep seq 1).
    expect(await store.get('lab-a', 'sync-pull')).toBe(2);
    //   second > first catches `reported_at: now()` being DROPPED from doUpdateSet while seq stays —
    //   the exact mutant `>=` and a seq check both miss (seq still moves, timestamp goes stale but
    //   equal satisfies >=). reported_at going stale unnoticed is the whole reason list() exists (a
    //   later observability slice reads it), so this must have teeth. Strict `>` is safe, NOT a flake:
    //   the two now() calls are separated by a list() SELECT + a report() INSERT round-tripped through
    //   the DB (tens of ms of real wall-clock, measured), not by the sub-ms gap `>=` was guarding.
    expect(second).toBeGreaterThan(first);
    await db.destroy();
  });

  it('keeps the two streams independent for one site', async () => {
    const db = await makeMigratedDb();
    const store = createSyncSiteCursorStore(db as never);
    await store.report('lab-a', 'sync-pull', 500);
    await store.report('lab-a', 'sync-amend-pull', 7);
    expect(await store.get('lab-a', 'sync-pull')).toBe(500);
    expect(await store.get('lab-a', 'sync-amend-pull')).toBe(7);
    expect(await store.list()).toHaveLength(2);
    await db.destroy();
  });
});
