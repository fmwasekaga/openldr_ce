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

  it('advances reported_at on a re-report', async () => {
    const db = await makeMigratedDb();
    const store = createSyncSiteCursorStore(db as never);
    await store.report('lab-a', 'sync-pull', 1);
    const first = (await store.list()).find((r) => r.siteId === 'lab-a')!.reportedAt.getTime();
    await new Promise((r) => setTimeout(r, 5));
    await store.report('lab-a', 'sync-pull', 2);
    const second = (await store.list()).find((r) => r.siteId === 'lab-a')!.reportedAt.getTime();
    expect(second).toBeGreaterThanOrEqual(first);
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
