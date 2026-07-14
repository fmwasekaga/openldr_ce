import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFhirStore, type RemoteRecord } from './fhir-store';

// applyRemote mirror-applies a remote change at its ORIGIN version + site_id (distributed sync S1).
// pg-mem supports the tx / on-conflict paths exercised here (idempotency is gated by an existence
// SELECT, not an engine-dependent row-count), so these run on the in-memory harness like the other
// fhir-store tests.

function upsert(id: string, version: number, siteId: string, family: string): RemoteRecord {
  return {
    resourceType: 'Patient',
    id,
    version,
    op: 'upsert',
    siteId,
    resource: { resourceType: 'Patient', id, name: [{ family }] } as never,
  };
}

describe('fhir-store applyRemote', () => {
  it('fresh upsert → applied; canonical row, history row, and origin-stamped change_log', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as any);

    const res = await store.applyRemote(upsert('p1', 5, 'lab-A', 'Alpha'));
    expect(res).toBe('applied');

    const canon = await db
      .selectFrom('fhir.fhir_resources')
      .select(['version', 'version_id', 'resource'])
      .where('id', '=', 'p1')
      .executeTakeFirstOrThrow();
    expect(Number(canon.version)).toBe(5);
    expect(canon.version_id).toBe('5');
    expect((canon.resource as any).name[0].family).toBe('Alpha');

    const hist = await db
      .selectFrom('fhir.resource_history')
      .select(['version', 'op'])
      .where('id', '=', 'p1')
      .execute();
    expect(hist.map((h: any) => [Number(h.version), h.op])).toEqual([[5, 'upsert']]);

    const log = await db
      .selectFrom('fhir.change_log')
      .select(['resource_type', 'resource_id', 'version', 'op', 'content_hash', 'site_id'])
      .where('resource_id', '=', 'p1')
      .execute();
    expect(log).toHaveLength(1);
    expect(Number(log[0].version)).toBe(5);
    expect(log[0].op).toBe('upsert');
    expect(log[0].site_id).toBe('lab-A');
    expect(typeof log[0].content_hash).toBe('string');
    expect((log[0].content_hash as string).length).toBe(64);

    await db.destroy();
  });

  it('re-apply same (type,id,version) → skipped; no duplicate history or change_log rows', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as any);

    expect(await store.applyRemote(upsert('p1', 5, 'lab-A', 'Alpha'))).toBe('applied');
    expect(await store.applyRemote(upsert('p1', 5, 'lab-A', 'Alpha'))).toBe('skipped');

    const hist = await db.selectFrom('fhir.resource_history').select('version').where('id', '=', 'p1').execute();
    expect(hist).toHaveLength(1);
    const log = await db.selectFrom('fhir.change_log').select('seq').where('resource_id', '=', 'p1').execute();
    expect(log).toHaveLength(1);

    await db.destroy();
  });

  it('op:delete → tombstone in history, canonical row gone, change_log op=delete with null hash', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as any);

    await store.applyRemote(upsert('p1', 1, 'lab-A', 'Alpha'));
    const del = await store.applyRemote({ resourceType: 'Patient', id: 'p1', version: 2, op: 'delete', siteId: 'lab-A' });
    expect(del).toBe('applied');

    expect(await store.get('Patient', 'p1')).toBeNull();

    const hist = await db
      .selectFrom('fhir.resource_history')
      .select(['version', 'op', 'resource'])
      .where('id', '=', 'p1')
      .orderBy('version')
      .execute();
    expect(hist.map((h: any) => [Number(h.version), h.op])).toEqual([[1, 'upsert'], [2, 'delete']]);
    expect(hist[1].resource).toBeNull();

    const log = await db
      .selectFrom('fhir.change_log')
      .select(['op', 'content_hash', 'site_id'])
      .where('resource_id', '=', 'p1')
      .orderBy('seq')
      .execute();
    expect(log.map((l: any) => l.op)).toEqual(['upsert', 'delete']);
    expect(log[1].content_hash).toBeNull();
    expect(log[1].site_id).toBe('lab-A');

    await db.destroy();
  });

  it('out-of-order: v3 then v2 → v2 applied (history) but canonical row stays at v3', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as any);

    expect(await store.applyRemote(upsert('p1', 3, 'lab-A', 'Newer'))).toBe('applied');
    // A late older version must be recorded in history yet must NOT clobber the newer canonical row.
    expect(await store.applyRemote(upsert('p1', 2, 'lab-A', 'Older'))).toBe('applied');

    const canon = await db
      .selectFrom('fhir.fhir_resources')
      .select(['version', 'resource'])
      .where('id', '=', 'p1')
      .executeTakeFirstOrThrow();
    expect(Number(canon.version)).toBe(3);
    expect((canon.resource as any).name[0].family).toBe('Newer');

    const hist = await db.selectFrom('fhir.resource_history').select('version').where('id', '=', 'p1').orderBy('version').execute();
    expect(hist.map((h: any) => Number(h.version))).toEqual([2, 3]);

    // Both versions still emit change_log rows (the sync/projection stream must see every applied change).
    const log = await db.selectFrom('fhir.change_log').select('version').where('resource_id', '=', 'p1').orderBy('version').execute();
    expect(log.map((l: any) => Number(l.version))).toEqual([2, 3]);

    await db.destroy();
  });

  it('op:upsert with no resource → rejects (and writes nothing)', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as any);

    await expect(
      store.applyRemote({ resourceType: 'Patient', id: 'p1', version: 1, op: 'upsert', siteId: 'lab-A' }),
    ).rejects.toThrow(/upsert requires resource/);

    // The guard runs before the transaction, so no partial rows leak.
    const hist = await db.selectFrom('fhir.resource_history').select('version').where('id', '=', 'p1').execute();
    expect(hist).toHaveLength(0);
    const log = await db.selectFrom('fhir.change_log').select('seq').where('resource_id', '=', 'p1').execute();
    expect(log).toHaveLength(0);

    await db.destroy();
  });

  it('a newer version DOES advance the canonical row (upsert path)', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as any);

    await store.applyRemote(upsert('p1', 2, 'lab-A', 'Old'));
    await store.applyRemote(upsert('p1', 4, 'lab-A', 'New'));

    const canon = await db
      .selectFrom('fhir.fhir_resources')
      .select(['version', 'version_id', 'resource'])
      .where('id', '=', 'p1')
      .executeTakeFirstOrThrow();
    expect(Number(canon.version)).toBe(4);
    expect(canon.version_id).toBe('4');
    expect((canon.resource as any).name[0].family).toBe('New');

    await db.destroy();
  });
});
