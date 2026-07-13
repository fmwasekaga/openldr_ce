import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFhirStore } from './fhir-store';
import { persistResources } from './persist';

const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;

describe('persist path emits change_log per resource', () => {
  it('one change_log row per resource in a batch, versions correct', async () => {
    const db = await makeMigratedDb();
    const fhirStore = createFhirStore(db as any);

    await persistResources({ fhirStore, logger }, [
      { resourceType: 'Patient', id: 'p1' },
      { resourceType: 'Observation', id: 'o1', status: 'final', code: { text: 'test observation' } },
      { resourceType: 'Patient', id: 'p1' }, // second write of p1 → version 2
    ]);

    const log = await db
      .selectFrom('fhir.change_log')
      .select(['resource_type', 'resource_id', 'version'])
      .where('resource_id', 'in', ['p1', 'o1'])
      .orderBy('seq')
      .execute();
    expect(log.map((r: any) => [r.resource_id, Number(r.version)])).toEqual([
      ['p1', 1],
      ['o1', 1],
      ['p1', 2],
    ]);
    await db.destroy();
  });
});
