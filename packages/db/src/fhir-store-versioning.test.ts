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
    const db1 = await makeMigratedDb();
    await db1.insertInto('app_settings').values({ key: 'sync.site_id', value: 'lab-A', updated_by: null }).execute();
    await createFhirStore(db1 as any).save({ resourceType: 'Patient', id: 'p1' } as never);
    const l1 = await db1.selectFrom('fhir.change_log').select('site_id').where('resource_id', '=', 'p1').executeTakeFirstOrThrow();
    expect(l1.site_id).toBe('lab-A');
    await db1.destroy();

    const db2 = await makeMigratedDb();
    process.env.OPENLDR_SITE_ID = 'lab-B';
    await createFhirStore(db2 as any).save({ resourceType: 'Patient', id: 'p2' } as never);
    const l2 = await db2.selectFrom('fhir.change_log').select('site_id').where('resource_id', '=', 'p2').executeTakeFirstOrThrow();
    expect(l2.site_id).toBe('lab-B');
    delete process.env.OPENLDR_SITE_ID;
    await db2.destroy();

    const db3 = await makeMigratedDb();
    await createFhirStore(db3 as any).save({ resourceType: 'Patient', id: 'p3' } as never);
    const l3 = await db3.selectFrom('fhir.change_log').select('site_id').where('resource_id', '=', 'p3').executeTakeFirstOrThrow();
    expect(l3.site_id).toBeNull();
    await db3.destroy();
  });
});
