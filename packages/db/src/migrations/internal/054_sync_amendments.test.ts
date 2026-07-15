import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('054_sync_amendments', () => {
  it('creates the sync_amendments outbox with a bigserial seq and site-scoped columns', async () => {
    const db = await makeMigratedDb();

    const seqA = await db
      .insertInto('sync_amendments')
      .values({ site_id: 'lab-a', resource_type: 'Observation', resource_id: 'obs-1', version: 2 } as never)
      .returning('seq')
      .executeTakeFirstOrThrow();
    const seqB = await db
      .insertInto('sync_amendments')
      .values({ site_id: 'lab-a', resource_type: 'Provenance', resource_id: 'prov-1', version: 1 } as never)
      .returning('seq')
      .executeTakeFirstOrThrow();
    expect(Number((seqB as any).seq)).toBeGreaterThan(Number((seqA as any).seq));

    const rows = await db.selectFrom('sync_amendments').selectAll().where('site_id', '=', 'lab-a').execute();
    expect(rows).toHaveLength(2);

    await db.destroy();
  });
});
