import { describe, expect, it } from 'vitest';
import { makeMigratedExternalDb } from '../../test-helpers-external';

describe('005 v2 specimen + diagnostic_report', () => {
  it('creates specimens and diagnostic_reports', async () => {
    const db = await makeMigratedExternalDb();
    await db.insertInto('specimens').values({ id: 'sp1', patient_id: 'p1', received_time: '2026-01-01T00:00:00Z' }).execute();
    await db.insertInto('diagnostic_reports').values({ id: 'dr1', patient_id: 'p1', code_text: 'CBC', issued: '2026-01-02T00:00:00Z' }).execute();
    expect(await db.selectFrom('specimens').selectAll().execute()).toHaveLength(1);
    expect(await db.selectFrom('diagnostic_reports').selectAll().execute()).toHaveLength(1);
    await db.destroy();
  });
});
