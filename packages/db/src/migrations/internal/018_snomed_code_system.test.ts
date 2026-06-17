import { describe, expect, it } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { internalMigrations } from './index';
import * as m018 from './018_snomed_code_system';

async function migratedThrough017(): Promise<Kysely<any>> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<any>;
  for (const [name, migration] of Object.entries(internalMigrations)) {
    if (name === '018_snomed_code_system') break;
    await migration.up(db);
  }
  return db;
}

describe('018_snomed_code_system', () => {
  it('repairs legacy seeded SNOMED rows so RF2 imports use the SNOMED parser', async () => {
    const db = await migratedThrough017();
    await db.insertInto('coding_systems').values({
      id: 'cs-sct-legacy',
      system_code: 'SCT',
      system_name: 'SNOMED CT (all versions)',
      url: 'http://snomed.info/sct',
      active: true,
      publisher_id: 'pub-hl7-fhir',
      seeded: true,
    }).execute();

    await m018.up(db);

    const row = await db.selectFrom('coding_systems')
      .select(['system_code', 'system_name', 'active', 'publisher_id', 'seeded'])
      .where('url', '=', 'http://snomed.info/sct')
      .executeTakeFirstOrThrow();
    expect(row).toEqual({
      system_code: 'SNOMED-CT',
      system_name: 'SNOMED CT',
      active: true,
      publisher_id: 'pub-snomed-ct',
      seeded: true,
    });

    await db.destroy();
  });
});
