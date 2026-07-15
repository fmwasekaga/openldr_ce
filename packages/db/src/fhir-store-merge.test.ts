import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { createFhirStore, PatientNotFoundError, CrossSiteMergeError, SamePatientError } from './fhir-store';
import { makeMigratedDb } from './migrations/internal/test-helpers';

async function seedPatient(store: ReturnType<typeof createFhirStore>, id: string, site: string) {
  await store.applyRemote({ resourceType: 'Patient', id, version: 1, op: 'upsert', siteId: site, resource: { resourceType: 'Patient', id, active: true, name: [{ family: id }] } as any });
}
async function seedRef(store: ReturnType<typeof createFhirStore>, resourceType: string, id: string, patientId: string, site: string) {
  await store.applyRemote({ resourceType, id, version: 1, op: 'upsert', siteId: site, resource: { resourceType, id, subject: { reference: `Patient/${patientId}` } } as any });
}

describe('FhirStore.mergePatients', () => {
  let db: Kysely<any>;
  beforeEach(async () => { db = await makeMigratedDb(); });

  it('marks the duplicate replaced, re-points referencing resources, writes a merge Provenance + outbox rows', async () => {
    const store = createFhirStore(db);
    await seedPatient(store, 'p-surv', 'lab-a');
    await seedPatient(store, 'p-dup', 'lab-a');
    await seedRef(store, 'Observation', 'obs-1', 'p-dup', 'lab-a');
    await seedRef(store, 'ServiceRequest', 'sr-1', 'p-dup', 'lab-a');

    const result = await store.mergePatients({
      survivorId: 'p-surv', duplicateId: 'p-dup', agent: 'mpi', reason: 'same person',
      referencingRefs: [{ resourceType: 'Observation', id: 'obs-1' }, { resourceType: 'ServiceRequest', id: 'sr-1' }],
    });

    expect(result.repointed).toBe(2);
    expect(result.siteId).toBe('lab-a');

    const dup = (await store.get('Patient', 'p-dup')) as any;
    expect(dup.active).toBe(false);
    expect(dup.link).toContainEqual({ type: 'replaced-by', other: { reference: 'Patient/p-surv' } });
    expect(dup.meta.versionId).toBe('2');

    const obs = (await store.get('Observation', 'obs-1')) as any;
    expect(obs.subject.reference).toBe('Patient/p-surv');
    const sr = (await store.get('ServiceRequest', 'sr-1')) as any;
    expect(sr.subject.reference).toBe('Patient/p-surv');

    const prov = (await store.get('Provenance', result.provenanceId)) as any;
    expect(prov.activity.coding[0].code).toBe('MERGE');
    expect(prov.target).toEqual(expect.arrayContaining([
      { reference: 'Patient/p-dup' }, { reference: 'Observation/obs-1' }, { reference: 'ServiceRequest/sr-1' },
    ]));

    const outbox = await db.selectFrom('sync_amendments').selectAll().where('site_id', '=', 'lab-a').execute();
    expect(outbox).toHaveLength(4);
    expect(outbox.map((r) => r.resource_type).sort()).toEqual(['Observation', 'Patient', 'Provenance', 'ServiceRequest']);
  });

  it('rejects a cross-site merge (patients owned by different sites)', async () => {
    const store = createFhirStore(db);
    await seedPatient(store, 'p-surv', 'lab-b');
    await seedPatient(store, 'p-dup', 'lab-a');
    await expect(store.mergePatients({ survivorId: 'p-surv', duplicateId: 'p-dup', agent: 'mpi', referencingRefs: [] })).rejects.toBeInstanceOf(CrossSiteMergeError);
  });

  it('rejects merging a patient into itself', async () => {
    const store = createFhirStore(db);
    await seedPatient(store, 'p-1', 'lab-a');
    await expect(store.mergePatients({ survivorId: 'p-1', duplicateId: 'p-1', agent: 'mpi', referencingRefs: [] })).rejects.toBeInstanceOf(SamePatientError);
  });

  it('rejects when a patient does not exist', async () => {
    const store = createFhirStore(db);
    await seedPatient(store, 'p-surv', 'lab-a');
    await expect(store.mergePatients({ survivorId: 'p-surv', duplicateId: 'nope', agent: 'mpi', referencingRefs: [] })).rejects.toBeInstanceOf(PatientNotFoundError);
  });

  it('skips a stale referencing ref that no longer exists (does not fail the merge)', async () => {
    const store = createFhirStore(db);
    await seedPatient(store, 'p-surv', 'lab-a');
    await seedPatient(store, 'p-dup', 'lab-a');
    const result = await store.mergePatients({ survivorId: 'p-surv', duplicateId: 'p-dup', agent: 'mpi', referencingRefs: [{ resourceType: 'Observation', id: 'ghost' }] });
    expect(result.repointed).toBe(0);
  });

  it('skips a ref of a non-mergeable type (never grafts a spurious subject)', async () => {
    const store = createFhirStore(db);
    await seedPatient(store, 'p-surv', 'lab-a');
    await seedPatient(store, 'p-dup', 'lab-a');
    await store.applyRemote({ resourceType: 'Coverage', id: 'cov-1', version: 1, op: 'upsert', siteId: 'lab-a', resource: { resourceType: 'Coverage', id: 'cov-1', subject: { reference: 'Patient/p-dup' } } as any });
    const result = await store.mergePatients({ survivorId: 'p-surv', duplicateId: 'p-dup', agent: 'mpi', referencingRefs: [{ resourceType: 'Coverage', id: 'cov-1' }] });
    expect(result.repointed).toBe(0);
    const cov = (await store.get('Coverage', 'cov-1')) as any;
    expect(cov.subject.reference).toBe('Patient/p-dup'); // untouched — no spurious re-point
    const covLog = await db.selectFrom('fhir.change_log').select('version').where('resource_type', '=', 'Coverage').where('resource_id', '=', 'cov-1').execute();
    expect(covLog.map((r) => Number(r.version))).toEqual([1]); // no version bump
  });

  it('skips a cross-site referencing ref (never re-stamps a resource owned by another site)', async () => {
    const store = createFhirStore(db);
    await seedPatient(store, 'p-surv', 'lab-a');
    await seedPatient(store, 'p-dup', 'lab-a');
    await seedRef(store, 'Observation', 'obs-x', 'p-dup', 'lab-b'); // owned by a DIFFERENT site
    const result = await store.mergePatients({ survivorId: 'p-surv', duplicateId: 'p-dup', agent: 'mpi', referencingRefs: [{ resourceType: 'Observation', id: 'obs-x' }] });
    expect(result.repointed).toBe(0);
    const obs = (await store.get('Observation', 'obs-x')) as any;
    expect(obs.subject.reference).toBe('Patient/p-dup'); // untouched
    const obsLog = await db.selectFrom('fhir.change_log').select('version').where('resource_type', '=', 'Observation').where('resource_id', '=', 'obs-x').execute();
    expect(obsLog.map((r) => Number(r.version))).toEqual([1]); // no version bump
  });
});
