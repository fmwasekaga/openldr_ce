import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { createFhirStore } from '@openldr/db';
import { makeMigratedDb } from '@openldr/db/testing';
import { serveAmendments } from './sync-serve';

// serveAmendments only touches ctx.internalDb + ctx.logger.
function stubCtx(db: Kysely<any>): any {
  return { internalDb: db, logger: { warn() {}, info() {}, error() {} } };
}

describe('serveAmendments', () => {
  let db: Kysely<any>;
  beforeEach(async () => {
    db = await makeMigratedDb();
  });

  it("serves only the requesting site's amendments, as SyncRecords with live bodies", async () => {
    const store = createFhirStore(db);
    await store.applyRemote({
      resourceType: 'Observation',
      id: 'obs-1',
      version: 1,
      op: 'upsert',
      siteId: 'lab-a',
      resource: { resourceType: 'Observation', id: 'obs-1', status: 'preliminary' } as any,
    });
    await store.applyRemote({
      resourceType: 'Observation',
      id: 'obs-2',
      version: 1,
      op: 'upsert',
      siteId: 'lab-b',
      resource: { resourceType: 'Observation', id: 'obs-2', status: 'preliminary' } as any,
    });
    const a = await store.amend({ resourceType: 'Observation', id: 'obs-1', status: 'amended', agent: 'c' });
    await store.amend({ resourceType: 'Observation', id: 'obs-2', status: 'amended', agent: 'c' });

    const resp = await serveAmendments(stubCtx(db), 'lab-a', 0);

    expect(resp.records).toHaveLength(2);
    for (const r of resp.records) {
      expect(r.siteId).toBe('lab-a');
      expect(r.op).toBe('upsert');
      expect(r.resource).toBeTruthy();
    }
    const obs = resp.records.find((r) => r.resourceType === 'Observation');
    expect(obs?.version).toBe(a.version);
    expect((obs?.resource as any).status).toBe('amended');
    expect(resp.nextSeq).toBeGreaterThan(0);
  });

  it('pages by seq: a fromSeq at the last served seq returns nothing more', async () => {
    const store = createFhirStore(db);
    await store.applyRemote({
      resourceType: 'Observation',
      id: 'obs-1',
      version: 1,
      op: 'upsert',
      siteId: 'lab-a',
      resource: { resourceType: 'Observation', id: 'obs-1', status: 'preliminary' } as any,
    });
    await store.amend({ resourceType: 'Observation', id: 'obs-1', status: 'amended', agent: 'c' });
    const first = await serveAmendments(stubCtx(db), 'lab-a', 0);
    const second = await serveAmendments(stubCtx(db), 'lab-a', first.nextSeq);
    expect(second.records).toHaveLength(0);
  });
});
