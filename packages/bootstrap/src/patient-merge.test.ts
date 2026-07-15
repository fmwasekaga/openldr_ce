import { describe, it, expect, vi } from 'vitest';
import { mergePatients } from './patient-merge';

it('enumerates referencing refs from the read model and calls fhirStore.mergePatients', async () => {
  const merge = vi.fn(async (_input: any) => ({ survivorId: 'p-surv', duplicateId: 'p-dup', repointed: 2, provenanceId: 'prov-1', siteId: 'lab-a' }));
  const rowsByTable: Record<string, { id: string }[]> = {
    lab_requests: [{ id: 'sr-1' }], lab_results: [{ id: 'obs-1' }], specimens: [], diagnostic_reports: [],
  };
  // Minimal chainable stub of the Kysely calls the orchestrator makes:
  //   ctx.store.db.selectFrom(table).select('id').where('patient_id','=',dup).execute()
  const storeDb = {
    selectFrom: (t: string) => ({ select: () => ({ where: () => ({ execute: async () => rowsByTable[t] ?? [] }) }) }),
  };
  const ctx: any = { store: { db: storeDb }, fhirStore: { mergePatients: merge } };

  const result = await mergePatients(ctx, { survivorId: 'p-surv', duplicateId: 'p-dup', agent: 'mpi' });
  expect(result.repointed).toBe(2);
  expect(merge).toHaveBeenCalledWith(expect.objectContaining({
    survivorId: 'p-surv', duplicateId: 'p-dup', agent: 'mpi',
    referencingRefs: expect.arrayContaining([
      { resourceType: 'ServiceRequest', id: 'sr-1' }, { resourceType: 'Observation', id: 'obs-1' },
    ]),
  }));
  // empty tables contribute nothing:
  expect(merge.mock.calls[0][0].referencingRefs).toHaveLength(2);
});
