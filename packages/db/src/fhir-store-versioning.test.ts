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

  it('keeps version monotonic across delete then recreate (no PK collision)', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as any);
    await store.save({ resourceType: 'Patient', id: 'p1' } as never); // v1
    await store.delete('Patient', 'p1');                              // v2 tombstone
    const again = await store.save({ resourceType: 'Patient', id: 'p1' } as never); // must be v3
    expect(again.version).toBe(3);

    const versions = await db.selectFrom('fhir.change_log').select('version').where('resource_id', '=', 'p1').orderBy('seq').execute();
    expect(versions.map((v: any) => Number(v.version))).toEqual([1, 2, 3]);
    await db.destroy();
  });

  it('content_hash is stable for identical content across saves', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as any);
    await store.save({ resourceType: 'Patient', id: 'p1', name: [{ family: 'A' }] } as never);
    await store.save({ resourceType: 'Patient', id: 'p1', name: [{ family: 'A' }] } as never);
    const hashes = await db.selectFrom('fhir.change_log').select('content_hash').where('resource_id', '=', 'p1').orderBy('seq').execute();
    expect(hashes[0].content_hash).toBe(hashes[1].content_hash);
    await db.destroy();
  });
});

describe('fhir-store delete (tombstone)', () => {
  it('tombstones an existing resource: history + change_log delete rows, get() null, version bumped', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as any);
    await store.save({ resourceType: 'Patient', id: 'p1' } as never); // v1
    const del = await store.delete('Patient', 'p1');
    expect(del).toEqual({ deleted: true, version: 2 });

    expect(await store.get('Patient', 'p1')).toBeNull();

    const hist = await db.selectFrom('fhir.resource_history').select(['version', 'op', 'resource']).where('id', '=', 'p1').orderBy('version').execute();
    expect(hist.map((h: any) => [Number(h.version), h.op])).toEqual([[1, 'upsert'], [2, 'delete']]);
    expect(hist[1].resource).toBeNull();

    const log = await db.selectFrom('fhir.change_log').select(['op', 'content_hash']).where('resource_id', '=', 'p1').orderBy('seq').execute();
    expect(log.map((l: any) => l.op)).toEqual(['upsert', 'delete']);
    expect(log[1].content_hash).toBeNull();
    await db.destroy();
  });

  it('is a no-op for a missing resource', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as any);
    const del = await store.delete('Patient', 'does-not-exist');
    expect(del).toEqual({ deleted: false });
    const log = await db.selectFrom('fhir.change_log').select('seq').where('resource_id', '=', 'does-not-exist').execute();
    expect(log).toEqual([]);
    const hist = await db.selectFrom('fhir.resource_history').select('version').where('id', '=', 'does-not-exist').execute();
    expect(hist).toEqual([]);
    await db.destroy();
  });
});
