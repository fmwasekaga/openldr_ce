import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('017_reference_terminology_seeds', () => {
  it('seeds UCUM and ICD-10 code systems with Corlix starter terms', async () => {
    const db = await makeMigratedDb();

    const systems = await db
      .selectFrom('coding_systems')
      .select(['system_code', 'url', 'publisher_id', 'seeded'])
      .where('system_code', 'in', ['UCUM', 'ICD-10', 'ICD-11'])
      .orderBy('system_code')
      .execute();

    expect(systems).toEqual([
      { system_code: 'ICD-10', url: 'http://hl7.org/fhir/sid/icd-10', publisher_id: 'pub-who-icd-10', seeded: true },
      { system_code: 'ICD-11', url: 'http://id.who.int/icd/release/11/mms', publisher_id: 'pub-who-icd-11', seeded: true },
      { system_code: 'UCUM', url: 'http://unitsofmeasure.org', publisher_id: 'pub-ucum', seeded: true },
    ]);

    const ucum = await db
      .selectFrom('terminology_concepts')
      .select(['code', 'display'])
      .where('system', '=', 'http://unitsofmeasure.org')
      .where('code', 'in', ['mg/dL', 'mmol/L', '{copies}/mL'])
      .orderBy('code')
      .execute();

    expect(ucum).toEqual([
      { code: 'mg/dL', display: 'milligram per deciliter' },
      { code: 'mmol/L', display: 'millimole per liter' },
      { code: '{copies}/mL', display: 'copies per milliliter' },
    ]);

    const icd10 = await db
      .selectFrom('terminology_concepts')
      .select(['code', 'display'])
      .where('system', '=', 'http://hl7.org/fhir/sid/icd-10')
      .where('code', 'in', ['B20', 'B50', 'E11'])
      .orderBy('code')
      .execute();

    expect(icd10).toEqual([
      { code: 'B20', display: 'Human immunodeficiency virus [HIV] disease' },
      { code: 'B50', display: 'Plasmodium falciparum malaria' },
      { code: 'E11', display: 'Type 2 diabetes mellitus' },
    ]);

    await db.destroy();
  });
});
