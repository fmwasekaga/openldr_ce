import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('057_sync_site_cursors', () => {
  it('stores one row per (site_id, consumer)', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('sync_site_cursors').values({ site_id: 'lab-a', consumer: 'sync-pull', seq: 500 } as never).execute();
    await db.insertInto('sync_site_cursors').values({ site_id: 'lab-a', consumer: 'sync-amend-pull', seq: 7 } as never).execute();
    const rows = await db.selectFrom('sync_site_cursors').selectAll().where('site_id', '=', 'lab-a').execute();
    expect(rows.map((r) => Number((r as never as { seq: number }).seq)).sort((a, b) => a - b)).toEqual([7, 500]);
    await db.destroy();
  });

  it('rejects a duplicate (site_id, consumer) — one row per stream, not an append log', async () => {
    const db = await makeMigratedDb();
    const row = { site_id: 'lab-a', consumer: 'sync-pull', seq: 500 };
    await db.insertInto('sync_site_cursors').values(row as never).execute();
    await expect(
      db.insertInto('sync_site_cursors').values({ ...row, seq: 900 } as never).execute(),
    ).rejects.toThrow();
    await db.destroy();
  });

  it('defaults reported_at', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('sync_site_cursors').values({ site_id: 'lab-a', consumer: 'sync-pull', seq: 1 } as never).execute();
    const r = await db.selectFrom('sync_site_cursors').selectAll().executeTakeFirst();
    expect((r as never as { reported_at: Date }).reported_at).toBeInstanceOf(Date);
    await db.destroy();
  });
});
