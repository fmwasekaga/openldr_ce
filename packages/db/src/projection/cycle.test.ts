import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from '../migrations/internal/test-helpers';
import { makeMigratedExternalDb } from '../test-helpers-external';
import { createFhirStore } from '../fhir-store';
import { createFlatWriter } from '../flat-writer';
import { runProjectionCycle, reprojectAll, type FetchSafeRows } from './cycle';
import { readCursor } from './cursor';

const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;

describe('runProjectionCycle', () => {
  it('projects safe rows to the external store and advances the cursor', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const fhirStore = createFhirStore(internalDb as never);
    const flatWriter = createFlatWriter(externalDb as never, 'postgres');
    await fhirStore.save({ resourceType: 'Patient', id: 'p1', name: [{ family: 'A' }] } as never);

    const fetch: FetchSafeRows = async () => ({
      rows: [{ seq: 1, xid: 1, resource_type: 'Patient', resource_id: 'p1', op: 'upsert' }],
      boundary: 100,
    });

    const n = await runProjectionCycle({ internalDb: internalDb as never, fhirStore, flatWriter, logger, fetch, batchSize: 500 });
    expect(n).toBe(1);
    expect(await externalDb.selectFrom('patients').selectAll().execute()).toHaveLength(1);
    expect(await readCursor(internalDb as never, 'projection')).toBe(1);
    await internalDb.destroy();
    await externalDb.destroy();
  });

  it('deletes the flat row when the canonical resource is gone (tombstone)', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const fhirStore = createFhirStore(internalDb as never);
    const flatWriter = createFlatWriter(externalDb as never, 'postgres');
    await fhirStore.save({ resourceType: 'Patient', id: 'p1' } as never);
    await flatWriter.write({ resourceType: 'Patient', id: 'p1' });
    await fhirStore.delete('Patient', 'p1');

    const fetch: FetchSafeRows = async () => ({
      rows: [{ seq: 2, xid: 1, resource_type: 'Patient', resource_id: 'p1', op: 'delete' }],
      boundary: 100,
    });
    await runProjectionCycle({ internalDb: internalDb as never, fhirStore, flatWriter, logger, fetch, batchSize: 500 });
    expect(await externalDb.selectFrom('patients').selectAll().execute()).toHaveLength(0);
    await internalDb.destroy();
    await externalDb.destroy();
  });
});
