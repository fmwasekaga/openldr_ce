import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from '../migrations/internal/test-helpers';
import { makeMigratedExternalDb } from '../test-helpers-external';
import { createFhirStore } from '../fhir-store';
import { createRelationalWriter } from '../relational-writer';
import { createProjectionRunner, reprojectAll, type FetchSafeRows } from './cycle';
import { readCursor } from './cursor';

const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;

describe('runProjectionCycle', () => {
  it('projects safe rows to the external store and advances the cursor', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const fhirStore = createFhirStore(internalDb as never);
    const relationalWriter = createRelationalWriter(externalDb as never, 'postgres');
    await fhirStore.save({ resourceType: 'Patient', id: 'p1', name: [{ family: 'A' }] } as never);

    const fetch: FetchSafeRows = async () => ({
      rows: [{ seq: 1, xid: 1, resource_type: 'Patient', resource_id: 'p1', op: 'upsert' }],
      boundary: 100,
      xmax: 200,
    });

    const n = await createProjectionRunner({ internalDb: internalDb as never, fhirStore, relationalWriter, logger, fetch, batchSize: 500 }).runCycle();
    expect(n).toBe(1);
    expect(await externalDb.selectFrom('patients').selectAll().execute()).toHaveLength(1);
    expect(await readCursor(internalDb as never, 'projection')).toBe(1);
    await internalDb.destroy();
    await externalDb.destroy();
  });

  it('deletes the relational row when the canonical resource is gone (tombstone)', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const fhirStore = createFhirStore(internalDb as never);
    const relationalWriter = createRelationalWriter(externalDb as never, 'postgres');
    await fhirStore.save({ resourceType: 'Patient', id: 'p1' } as never);
    await relationalWriter.write({ resourceType: 'Patient', id: 'p1' }, {});
    await fhirStore.delete('Patient', 'p1');

    const fetch: FetchSafeRows = async () => ({
      rows: [{ seq: 1, xid: 1, resource_type: 'Patient', resource_id: 'p1', op: 'delete' }],
      boundary: 100,
      xmax: 200,
    });
    await createProjectionRunner({ internalDb: internalDb as never, fhirStore, relationalWriter, logger, fetch, batchSize: 500 }).runCycle();
    expect(await externalDb.selectFrom('patients').selectAll().execute()).toHaveLength(0);
    await internalDb.destroy();
    await externalDb.destroy();
  });

  it('carries provenance from the canonical row into the projected row', async () => {
    // The bug this file never caught: applyProjection called write(canonical) with
    // no provenance, and write() defaulted it to {} — so source_system/plugin_id/
    // plugin_version/batch_id were NULL in EVERY projected row, for every producer,
    // silently defeating the batchId design in persist-store-service.ts:11-17.
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const fhirStore = createFhirStore(internalDb as never);
    const relationalWriter = createRelationalWriter(externalDb as never, 'postgres');
    await fhirStore.save(
      { resourceType: 'Patient', id: 'p1', name: [{ family: 'A' }] } as never,
      { sourceSystem: 'cdr', batchId: 'batch-1' },
    );

    const fetch: FetchSafeRows = async () => ({
      rows: [{ seq: 1, xid: 1, resource_type: 'Patient', resource_id: 'p1', op: 'upsert' }],
      boundary: 100,
      xmax: 200,
    });
    await createProjectionRunner({ internalDb: internalDb as never, fhirStore, relationalWriter, logger, fetch, batchSize: 500 }).runCycle();

    const [row] = await externalDb.selectFrom('patients').selectAll().execute();
    expect(row.source_system).toBe('cdr');
    expect(row.batch_id).toBe('batch-1');
    await internalDb.destroy();
    await externalDb.destroy();
  });
});

describe('createProjectionRunner (stateful gaps across cycles)', () => {
  it('carries pendingGaps across runCycle() calls: a fresh gap blocks, then confirms once the boundary advances', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const fhirStore = createFhirStore(internalDb as never);
    const relationalWriter = createRelationalWriter(externalDb as never, 'postgres');
    // Canonical resources so applyProjection's fhirStore.get('Patient', ...) returns them.
    await fhirStore.save({ resourceType: 'Patient', id: 'a', name: [{ family: 'A' }] } as never);
    await fhirStore.save({ resourceType: 'Patient', id: 'b', name: [{ family: 'B' }] } as never);

    // A stateful fake fetch: on call #1 seq 1 is an ABSENT gap (only seq 2 visible) with the oldest
    // running txn (boundary=50) below the recorded x0 (xmax=100) → the gap is unconfirmed and blocks.
    // On call #2 the boundary has advanced to 150 (>= x0=100) → the gap is confirmed rolled back, so
    // the runner can safely advance past it and project seq 2. This only works if pendingGaps (the
    // seq→x0 map) survived from cycle #1 to cycle #2 inside the same runner instance.
    let call = 0;
    const fetch: FetchSafeRows = async () => {
      call += 1;
      if (call === 1) {
        // seq 1 missing (gap), seq 2 = Patient 'b'; boundary below x0 → gap unconfirmed.
        return { rows: [{ seq: 2, xid: 10, resource_type: 'Patient', resource_id: 'b', op: 'upsert' }], boundary: 50, xmax: 100 };
      }
      // Same visible row; boundary now >= the x0 (100) stamped on cycle #1 → gap confirmed rolled back.
      return { rows: [{ seq: 2, xid: 10, resource_type: 'Patient', resource_id: 'b', op: 'upsert' }], boundary: 150, xmax: 200 };
    };

    const runner = createProjectionRunner({ internalDb: internalDb as never, fhirStore, relationalWriter, logger, fetch, batchSize: 500 });

    // Cycle #1: blocked before the gap at seq 1 → cursor stays 0, nothing projected.
    const n1 = await runner.runCycle();
    expect(n1).toBe(0);
    expect(await readCursor(internalDb as never, 'projection')).toBe(0);
    expect(await externalDb.selectFrom('patients').selectAll().execute()).toHaveLength(0);

    // Cycle #2: carried gap now confirmed rolled back → cursor advances to 2 and 'b' projects.
    const n2 = await runner.runCycle();
    expect(n2).toBe(1);
    expect(await readCursor(internalDb as never, 'projection')).toBe(2);
    const patients = await externalDb.selectFrom('patients').selectAll().execute();
    expect(patients).toHaveLength(1);
    expect((patients[0] as { id: string }).id).toBe('b');

    await internalDb.destroy();
    await externalDb.destroy();
  });
});

describe('getWithProvenance', () => {
  it('returns the resource alongside its stored provenance', async () => {
    const internalDb = await makeMigratedDb();
    const fhirStore = createFhirStore(internalDb as never);
    await fhirStore.save(
      { resourceType: 'Patient', id: 'p1', name: [{ family: 'A' }] } as never,
      { sourceSystem: 'cdr', batchId: 'batch-1', pluginId: 'plug', pluginVersion: '1.2.3' },
    );

    const found = await fhirStore.getWithProvenance('Patient', 'p1');
    expect(found).not.toBeNull();
    expect((found!.resource as unknown as { id: string }).id).toBe('p1');
    expect(found!.provenance).toEqual({
      sourceSystem: 'cdr', batchId: 'batch-1', pluginId: 'plug', pluginVersion: '1.2.3',
    });
    await internalDb.destroy();
  });

  it('returns an empty provenance (not undefined) when the columns are NULL', async () => {
    const internalDb = await makeMigratedDb();
    const fhirStore = createFhirStore(internalDb as never);
    await fhirStore.save({ resourceType: 'Patient', id: 'p2' } as never);

    const found = await fhirStore.getWithProvenance('Patient', 'p2');
    expect(found).not.toBeNull();
    expect(found!.provenance).toEqual({});
    await internalDb.destroy();
  });

  it('returns null for a missing resource', async () => {
    const internalDb = await makeMigratedDb();
    const fhirStore = createFhirStore(internalDb as never);
    expect(await fhirStore.getWithProvenance('Patient', 'nope')).toBeNull();
    await internalDb.destroy();
  });

  it('leaves get() unchanged — terminology-store.ts:161 depends on the bare resource', async () => {
    const internalDb = await makeMigratedDb();
    const fhirStore = createFhirStore(internalDb as never);
    await fhirStore.save({ resourceType: 'Patient', id: 'p3' } as never, { sourceSystem: 'cdr' });
    const r = await fhirStore.get('Patient', 'p3');
    expect((r as { resourceType: string }).resourceType).toBe('Patient');
    expect((r as Record<string, unknown>).provenance).toBeUndefined();
    await internalDb.destroy();
  });
});

describe('reprojectAll', () => {
  it('rebuilds the read-model from canonical and sets the cursor to max seq', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const fhirStore = createFhirStore(internalDb as never);
    const relationalWriter = createRelationalWriter(externalDb as never, 'postgres');
    await fhirStore.save({ resourceType: 'Patient', id: 'p1' } as never);
    await fhirStore.save({ resourceType: 'Observation', id: 'o1', status: 'final', code: { text: 'x' } } as never);

    const n = await reprojectAll({ internalDb: internalDb as never, relationalWriter });
    expect(n).toBeGreaterThanOrEqual(2);
    expect(await externalDb.selectFrom('patients').selectAll().execute()).toHaveLength(1);
    expect(await externalDb.selectFrom('lab_results').selectAll().execute()).toHaveLength(1);

    // cursor set to current max change_log seq so steady-state tailing won't re-project
    const maxRow = await internalDb.selectFrom('fhir.change_log').select((eb: any) => eb.fn.max('seq').as('m')).executeTakeFirst();
    expect(await readCursor(internalDb as never, 'projection')).toBe(Number((maxRow as any).m));

    await internalDb.destroy();
    await externalDb.destroy();
  });
});
