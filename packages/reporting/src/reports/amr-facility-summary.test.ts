import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import { amrFacilitySummary } from './amr-facility-summary';

type Obs = { interpretation_code: string; subject_ref: string | null; effective_date_time?: string };
type Patient = { id: string; managing_organization: string | null };

// Dispatching fake: selectFrom('observations') → obs rows; selectFrom('patients') → patient rows.
function fakeDb(obs: Obs[], patients: Patient[]): Kysely<ExternalSchema> {
  const mk = (rows: unknown[]) => {
    const b = { select: () => b, where: () => b, execute: async () => rows };
    return b;
  };
  return { selectFrom: (t: string) => (t === 'patients' ? mk(patients) : mk(obs)) } as unknown as Kysely<ExternalSchema>;
}

describe('amrFacilitySummary', () => {
  it('declares wide-format columns: facility + tested + resistant', () => {
    expect(amrFacilitySummary.id).toBe('amr-facility-summary');
    // The DHIS2 aggregate mapping needs a per-row facility column plus numeric metric columns.
  });

  it('produces one row per facility with tested and resistant counts', async () => {
    const db = fakeDb(
      [
        { interpretation_code: 'R', subject_ref: 'Patient/p1' },
        { interpretation_code: 'S', subject_ref: 'Patient/p1' },
        { interpretation_code: 'R', subject_ref: 'Patient/p2' },
        { interpretation_code: 'I', subject_ref: 'Patient/p2' },
      ],
      [
        { id: 'p1', managing_organization: 'fac-A' },
        { id: 'p2', managing_organization: 'fac-B' },
      ],
    );
    const result = await amrFacilitySummary.run(db, {});
    expect(result.columns.map((c) => c.key)).toEqual(['facility', 'tested', 'resistant']);
    expect(result.rows).toEqual([
      { facility: 'fac-A', tested: 2, resistant: 1 },
      { facility: 'fac-B', tested: 2, resistant: 1 },
    ]);
  });

  it('drops observations whose patient has no facility (cannot attribute an org unit)', async () => {
    const db = fakeDb(
      [
        { interpretation_code: 'R', subject_ref: 'Patient/p1' },
        { interpretation_code: 'R', subject_ref: 'Patient/p9' }, // no patient row → no facility
      ],
      [{ id: 'p1', managing_organization: 'fac-A' }],
    );
    const result = await amrFacilitySummary.run(db, {});
    expect(result.rows).toEqual([{ facility: 'fac-A', tested: 1, resistant: 1 }]);
  });

  it('returns an empty result (no rows) when there are no AST observations', async () => {
    const result = await amrFacilitySummary.run(fakeDb([], []), {});
    expect(result.rows).toEqual([]);
    expect(result.columns.map((c) => c.key)).toEqual(['facility', 'tested', 'resistant']);
  });
});
