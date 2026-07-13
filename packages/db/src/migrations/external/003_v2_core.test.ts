import { describe, expect, it } from 'vitest';
import { makeMigratedExternalDb } from '../../test-helpers-external';

describe('003 v2 core tables', () => {
  it('creates the v2_ core tables (FHIR-id keyed, provenance cols)', async () => {
    const db = await makeMigratedExternalDb();
    await db.insertInto('patients').values({ id: 'p1', patient_guid: 'g1', surname: 'X' }).execute();
    await db.insertInto('lab_requests').values({ id: 'sr1', request_id: 'r1', patient_id: 'p1' }).execute();
    await db.insertInto('lab_results').values({ id: 'o1', request_id: 'sr1', observation_code: 'LOINC-1' }).execute();
    await db.insertInto('facilities').values({ id: 'org1', facility_code: 'F1', source_resource: 'Organization' }).execute();
    expect(await db.selectFrom('patients').selectAll().execute()).toHaveLength(1);
    expect(await db.selectFrom('lab_requests').selectAll().execute()).toHaveLength(1);
    expect(await db.selectFrom('lab_results').selectAll().execute()).toHaveLength(1);
    expect(await db.selectFrom('facilities').selectAll().execute()).toHaveLength(1);
    await db.destroy();
  });
});
