import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedExternalDb } from '../../test-helpers-external';

describe('007 drop thin + rename v2->canonical', () => {
  it('drops thin tables and renames v2_ tables to canonical', async () => {
    const db = await makeMigratedExternalDb();
    // canonical tables (the renamed v2_ tables) exist and accept inserts
    await sql`insert into patients (id, sex) values ('p1','M')`.execute(db);
    await sql`insert into lab_results (id, abnormal_flag, patient_id) values ('o1','R','p1')`.execute(db);
    await sql`insert into specimens (id, patient_id, origin) values ('s1','p1','inpatient')`.execute(db);
    const pats = await sql<{ id: string }>`select id from patients`.execute(db);
    expect(pats.rows).toHaveLength(1);
    const labs = await sql<{ id: string }>`select id from lab_results`.execute(db);
    expect(labs.rows).toHaveLength(1);
    // the dropped thin `observations` table no longer exists
    await expect(sql`select 1 from observations`.execute(db)).rejects.toThrow();
    // the old v2_ name no longer exists (it was renamed)
    await expect(sql`select 1 from v2_lab_results`.execute(db)).rejects.toThrow();
    await db.destroy();
  });
});
