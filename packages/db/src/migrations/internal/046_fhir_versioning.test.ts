import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedDb } from './test-helpers';

describe('046 fhir versioning schema', () => {
  it('adds version column (backfilled) and creates history + change_log + change_cursors', async () => {
    const db = await makeMigratedDb();

    const seeded = await db
      .selectFrom('fhir.fhir_resources')
      .select(['id', 'version'])
      .limit(1)
      .execute();
    expect(seeded.length).toBeGreaterThan(0);
    expect(Number(seeded[0].version)).toBe(1);

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
