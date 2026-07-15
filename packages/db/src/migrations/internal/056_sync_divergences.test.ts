import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('056_sync_divergences', () => {
  it('rejects a duplicate (resource_type, resource_id, version) — re-delivery cannot inflate the table', async () => {
    const db = await makeMigratedDb();

    const row = {
      resource_type: 'Observation',
      resource_id: 'obs-1',
      version: 2,
      local_hash: 'aaa',
      incoming_hash: 'bbb',
      incoming_body: JSON.stringify({ resourceType: 'Observation', id: 'obs-1' }),
      incoming_site_id: 'lab-a',
    };
    await db.insertInto('sync_divergences').values(row as never).execute();

    // Re-delivery of the same diverged record hits the PK. The detection path will ride this with
    // onConflict doNothing — the constraint is what makes that no-op possible.
    await expect(
      db.insertInto('sync_divergences').values({ ...row, incoming_hash: 'ccc' } as never).execute(),
    ).rejects.toThrow();

    const rows = await db.selectFrom('sync_divergences').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(Number((rows[0] as any).version)).toBe(2);
    // the first write won — the rejected duplicate did not overwrite it
    expect((rows[0] as any).incoming_hash).toBe('bbb');

    await db.destroy();
  });

  it('records the same resource diverging at two versions as two independent rows', async () => {
    const db = await makeMigratedDb();

    const at = (version: number) => ({
      resource_type: 'Observation',
      resource_id: 'obs-1',
      version,
      local_hash: 'aaa',
      incoming_hash: 'bbb',
      incoming_body: null,
      incoming_site_id: 'lab-a',
    });
    await db.insertInto('sync_divergences').values(at(2) as never).execute();
    await db.insertInto('sync_divergences').values(at(5) as never).execute();

    const rows = await db
      .selectFrom('sync_divergences')
      .selectAll()
      .where('resource_id', '=', 'obs-1')
      .execute();
    expect(rows.map((r) => Number((r as any).version)).sort((a, b) => a - b)).toEqual([2, 5]);

    await db.destroy();
  });

  it('allows a NULL local_hash (local tombstone vs incoming edit at the same version)', async () => {
    const db = await makeMigratedDb();

    // The case the design calls out: the lab DELETED the resource at v2 while central AMENDED it to v2.
    // Local side is a tombstone (no content, no hash); the incoming edit is what got dropped.
    await db
      .insertInto('sync_divergences')
      .values({
        resource_type: 'Observation',
        resource_id: 'obs-3',
        version: 2,
        local_hash: null,
        incoming_hash: 'bbb',
        incoming_body: JSON.stringify({ resourceType: 'Observation', id: 'obs-3' }),
        incoming_site_id: 'lab-a',
      } as never)
      .execute();

    const rows = await db.selectFrom('sync_divergences').selectAll().execute();
    expect((rows[0] as any).local_hash).toBeNull();
    expect((rows[0] as any).incoming_hash).toBe('bbb');
    expect((rows[0] as any).incoming_body).not.toBeNull();

    await db.destroy();
  });

  it('allows a NULL incoming hash and body (incoming tombstone vs local edit)', async () => {
    const db = await makeMigratedDb();

    await db
      .insertInto('sync_divergences')
      .values({
        resource_type: 'Observation',
        resource_id: 'obs-2',
        version: 3,
        local_hash: 'aaa',
        incoming_hash: null,
        incoming_body: null,
        incoming_site_id: 'lab-a',
      } as never)
      .execute();

    const rows = await db.selectFrom('sync_divergences').selectAll().execute();
    expect((rows[0] as any).incoming_hash).toBeNull();
    expect((rows[0] as any).incoming_body).toBeNull();

    await db.destroy();
  });
});
