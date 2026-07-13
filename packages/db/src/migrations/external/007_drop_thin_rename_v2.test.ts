import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedExternalDb } from '../../test-helpers-external';

// Uses raw `sql` (not typed `insertInto`) because the ExternalSchema Kysely types still carry the
// pre-rename v2_/thin names until R3e-T4 renames them — typed calls would reference stale names, so
// raw sql avoids that dependency and lets this test pass standalone now.
describe('007 drop thin + rename v2->canonical', () => {
  it('renames all 6 v2_ tables to canonical (which exist + accept rows)', async () => {
    const db = await makeMigratedExternalDb();
    // insert into the ones with well-known columns; select from the rest to prove they resolve
    await sql`insert into patients (id, sex) values ('p1','M')`.execute(db);
    await sql`insert into lab_results (id, abnormal_flag, patient_id) values ('o1','R','p1')`.execute(db);
    await sql`insert into specimens (id, patient_id, origin) values ('s1','p1','inpatient')`.execute(db);
    expect((await sql<{ id: string }>`select id from patients`.execute(db)).rows).toHaveLength(1);
    expect((await sql<{ id: string }>`select id from lab_results`.execute(db)).rows).toHaveLength(1);
    expect((await sql<{ id: string }>`select id from specimens`.execute(db)).rows).toHaveLength(1);
    // the remaining canonical tables exist (resolve) even if empty
    for (const t of ['lab_requests', 'facilities', 'diagnostic_reports']) {
      await expect(sql`select 1 from ${sql.raw(t)}`.execute(db)).resolves.toBeDefined();
    }
    await db.destroy();
  });

  it('drops the 4 thin tables whose names were not reused by a rename', async () => {
    const db = await makeMigratedExternalDb();
    // patients/specimens/diagnostic_reports were dropped then reused by the rename (covered above);
    // these 4 thin names are gone for good.
    for (const t of ['service_requests', 'observations', 'organizations', 'locations']) {
      await expect(sql`select 1 from ${sql.raw(t)}`.execute(db)).rejects.toThrow();
    }
    await db.destroy();
  });

  it('removes all 6 old v2_ table names', async () => {
    const db = await makeMigratedExternalDb();
    for (const t of ['v2_patients', 'v2_lab_requests', 'v2_lab_results', 'v2_facilities', 'v2_specimens', 'v2_diagnostic_reports']) {
      await expect(sql`select 1 from ${sql.raw(t)}`.execute(db)).rejects.toThrow();
    }
    await db.destroy();
  });
});
