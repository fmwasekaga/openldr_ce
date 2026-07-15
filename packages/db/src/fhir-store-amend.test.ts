import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFhirStore, ResourceNotFoundError, NotLabOwnedError } from './fhir-store';

async function memDb(): Promise<Kysely<any>> {
  return makeMigratedDb() as unknown as Promise<Kysely<any>>;
}

describe('FhirStore.amend', () => {
  let db: Kysely<any>;
  beforeEach(async () => {
    // The third test relies on a saved resource resolving to NO owning site. resolveSiteId() reads
    // the sync.site_id app_setting (absent in a fresh makeMigratedDb) OR process.env.OPENLDR_SITE_ID —
    // so ensure the env var is unset for isolation.
    delete process.env.OPENLDR_SITE_ID;
    db = await memDb();
  });

  it('amends a lab-owned resource: bumps version, preserves site_id, writes Provenance + 2 outbox rows', async () => {
    const store = createFhirStore(db);
    await store.applyRemote({
      resourceType: 'Observation',
      id: 'obs-1',
      version: 1,
      op: 'upsert',
      siteId: 'lab-a',
      resource: { resourceType: 'Observation', id: 'obs-1', status: 'preliminary' } as any,
    });

    const result = await store.amend({
      resourceType: 'Observation',
      id: 'obs-1',
      status: 'amended',
      patch: { valueString: 'corrected' },
      agent: 'central-reviewer',
      reason: 'value re-validated',
    });

    expect(result.version).toBe(2);
    expect(result.siteId).toBe('lab-a');
    expect(result.provenanceId).toBeTruthy();

    const obs = (await store.get('Observation', 'obs-1')) as any;
    expect(obs.status).toBe('amended');
    expect(obs.valueString).toBe('corrected');
    expect(obs.meta.versionId).toBe('2');

    const cl = await db
      .selectFrom('fhir.change_log')
      .select(['site_id', 'version'])
      .where('resource_type', '=', 'Observation')
      .where('resource_id', '=', 'obs-1')
      .where('version', '=', 2)
      .executeTakeFirstOrThrow();
    expect(cl.site_id).toBe('lab-a');

    const prov = (await store.get('Provenance', result.provenanceId)) as any;
    expect(prov.resourceType).toBe('Provenance');
    expect(prov.target[0].reference).toBe('Observation/obs-1');
    expect(prov.agent[0].who.display).toBe('central-reviewer');

    const outbox = await db
      .selectFrom('sync_amendments')
      .selectAll()
      .where('site_id', '=', 'lab-a')
      .orderBy('seq', 'asc')
      .execute();
    expect(outbox.map((r) => r.resource_type)).toEqual(['Observation', 'Provenance']);
    expect(Number(outbox[0].version)).toBe(2);
    expect(Number(outbox[1].version)).toBe(1);
  });

  it('rejects amending a resource that does not exist', async () => {
    const store = createFhirStore(db);
    await expect(
      store.amend({ resourceType: 'Observation', id: 'nope', status: 'amended', agent: 'c' }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it('rejects amending a resource with no owning site (central-owned / unsynced)', async () => {
    const store = createFhirStore(db);
    await store.save({ resourceType: 'Observation', id: 'local-1', status: 'final' } as any);
    await expect(
      store.amend({ resourceType: 'Observation', id: 'local-1', status: 'amended', agent: 'c' }),
    ).rejects.toBeInstanceOf(NotLabOwnedError);
  });
});
