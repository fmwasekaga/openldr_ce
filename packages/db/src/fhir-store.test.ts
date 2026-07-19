import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFhirStore } from './fhir-store';

describe('fhir-store listByType', () => {
  it('returns only resources of the requested type', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db);
    await store.save({ resourceType: 'Location', id: 'loc-1', name: 'Clinic A' } as never);
    await store.save({ resourceType: 'Location', id: 'loc-2', name: 'Clinic B' } as never);
    await store.save({ resourceType: 'Organization', id: 'org-1', name: 'MoH' } as never);

    const locations = await store.listByType('Location');
    expect(locations.map((r) => r.id).sort()).toEqual(['loc-1', 'loc-2']);
    expect(locations.every((r) => r.resource.resourceType === 'Location')).toBe(true);

    expect(await store.listByType('Organization')).toHaveLength(1);
    expect(await store.listByType('Patient')).toEqual([]);
    await db.destroy();
  });
});

describe('fhir-store exists', () => {
  it('is true for a saved resource and false for a missing one', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db);
    await store.save({ resourceType: 'ServiceRequest', id: 'sr-1', status: 'active' } as never);

    expect(await store.exists('ServiceRequest', 'sr-1')).toBe(true);
    expect(await store.exists('ServiceRequest', 'nope')).toBe(false);
    await db.destroy();
  });
});
