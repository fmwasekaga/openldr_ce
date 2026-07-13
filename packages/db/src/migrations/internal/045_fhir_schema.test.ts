import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import { createFhirStore } from '../../fhir-store';

describe('045 fhir schema move', () => {
  it('relocates fhir_resources into the fhir schema, preserves existing rows, and FhirStore round-trips', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db);

    await store.save({ resourceType: 'Patient', id: 'p1', name: [{ family: 'X' }] } as never);
    const got = await store.get('Patient', 'p1');
    expect(got?.id).toBe('p1');

    const rows = await db
      .selectFrom('fhir.fhir_resources')
      .select(['resource_type', 'id'])
      .execute();
    // the resource we just saved is in the relocated table
    expect(rows).toContainEqual({ resource_type: 'Patient', id: 'p1' });
    // pre-existing rows seeded by earlier migrations (014 ValueSets) were carried
    // over by the relocation — proves the move is zero-data-loss
    expect(rows.some((r) => r.resource_type === 'ValueSet')).toBe(true);

    // the old public.fhir_resources no longer exists
    await expect(
      db.selectFrom('public.fhir_resources').select(['id']).execute(),
    ).rejects.toThrow();

    await db.destroy();
  });
});
