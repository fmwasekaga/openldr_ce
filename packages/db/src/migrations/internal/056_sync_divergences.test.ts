import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('056_sync_divergences', () => {
  it('creates sync_divergences with a (resource_type, resource_id, version) PK', async () => {
    const db = await makeMigratedDb();

    await db
      .insertInto('sync_divergences')
      .values({
        resource_type: 'Observation',
        resource_id: 'obs-1',
        version: 2,
        local_hash: 'aaa',
        incoming_hash: 'bbb',
        incoming_body: JSON.stringify({ resourceType: 'Observation', id: 'obs-1' }),
        incoming_site_id: 'lab-a',
      } as never)
      .execute();

    const rows = await db.selectFrom('sync_divergences').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(Number((rows[0] as any).version)).toBe(2);

    await db.destroy();
  });

  it('allows NULL hashes and body (tombstone side of a divergence)', async () => {
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
