import { type Kysely } from 'kysely';

const UCUM = 'http://unitsofmeasure.org';
const ICD10 = 'http://hl7.org/fhir/sid/icd-10';
const ICD11 = 'http://id.who.int/icd/release/11/mms';

const UCUM_TERMS: Array<[string, string, string, string]> = [
  ['mg', 'milligram', 'mg', 'mass'],
  ['g', 'gram', 'g', 'mass'],
  ['ug', 'microgram', 'ug', 'mass'],
  ['ng', 'nanogram', 'ng', 'mass'],
  ['L', 'liter', 'L', 'volume'],
  ['mL', 'milliliter', 'mL', 'volume'],
  ['dL', 'deciliter', 'dL', 'volume'],
  ['uL', 'microliter', 'uL', 'volume'],
  ['mmol/L', 'millimole per liter', 'mmol/L', 'concentration'],
  ['mg/dL', 'milligram per deciliter', 'mg/dL', 'concentration'],
  ['g/dL', 'gram per deciliter', 'g/dL', 'concentration'],
  ['g/L', 'gram per liter', 'g/L', 'concentration'],
  ['ng/mL', 'nanogram per milliliter', 'ng/mL', 'concentration'],
  ['U/L', 'enzyme unit per liter', 'U/L', 'catalytic activity'],
  ['m[IU]/L', 'milli-international unit per liter', 'm[IU]/L', 'concentration'],
  ['fL', 'femtoliter', 'fL', 'volume'],
  ['pg', 'picogram', 'pg', 'mass'],
  ['%', 'percent', '%', 'ratio'],
  ['s', 'second', 's', 'time'],
  ['h', 'hour', 'h', 'time'],
  ['mm/h', 'millimeter per hour', 'mm/h', 'rate'],
  ['{INR}', 'international normalized ratio', '{INR}', 'ratio'],
  ['{cells}/uL', 'cells per microliter', '{cells}/uL', 'count concentration'],
  ['{copies}/mL', 'copies per milliliter', '{copies}/mL', 'count concentration'],
  ['10*9/L', '10^9 per liter', '10*9/L', 'count concentration'],
  ['10*12/L', '10^12 per liter', '10*12/L', 'count concentration'],
];

const ICD10_TERMS: Array<[string, string, string, string]> = [
  ['B20', 'Human immunodeficiency virus [HIV] disease', 'HIV disease', 'Infectious'],
  ['A15', 'Respiratory tuberculosis, bacteriologically and histologically confirmed', 'TB confirmed', 'Infectious'],
  ['A16', 'Respiratory tuberculosis, not confirmed bacteriologically or histologically', 'TB unconfirmed', 'Infectious'],
  ['A17', 'Tuberculosis of nervous system', 'TB CNS', 'Infectious'],
  ['B50', 'Plasmodium falciparum malaria', 'Malaria P. falciparum', 'Infectious'],
  ['B51', 'Plasmodium vivax malaria', 'Malaria P. vivax', 'Infectious'],
  ['B54', 'Unspecified malaria', 'Malaria', 'Infectious'],
  ['B16', 'Acute hepatitis B', 'Hepatitis B acute', 'Infectious'],
  ['B18.1', 'Chronic viral hepatitis B without delta-agent', 'Hepatitis B chronic', 'Infectious'],
  ['B18.2', 'Chronic viral hepatitis C', 'Hepatitis C chronic', 'Infectious'],
  ['E10', 'Type 1 diabetes mellitus', 'T1DM', 'Endocrine'],
  ['E11', 'Type 2 diabetes mellitus', 'T2DM', 'Endocrine'],
  ['D50', 'Iron deficiency anaemia', 'IDA', 'Haematology'],
  ['D57', 'Sickle-cell disorders', 'Sickle-cell', 'Haematology'],
  ['N18', 'Chronic kidney disease', 'CKD', 'Renal'],
];

export async function up(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;

  await seedDb.insertInto('coding_systems').values([
    {
      id: 'cs-ucum-seed', system_code: 'UCUM', system_name: 'Unified Code for Units of Measure',
      url: UCUM, system_version: null, description: 'Common laboratory units seeded from UCUM.',
      active: true, publisher_id: 'pub-ucum', seeded: true,
    },
    {
      id: 'cs-icd10-seed', system_code: 'ICD-10', system_name: 'International Classification of Diseases, 10th Revision',
      url: ICD10, system_version: null, description: 'WHO ICD-10 diagnosis codes seeded with lab-relevant starter terms.',
      active: true, publisher_id: 'pub-who-icd-10', seeded: true,
    },
    {
      id: 'cs-icd11-seed', system_code: 'ICD-11', system_name: 'International Classification of Diseases, 11th Revision',
      url: ICD11, system_version: null, description: 'WHO ICD-11 diagnosis codes. Import JSONL/NDJSON terms as needed.',
      active: true, publisher_id: 'pub-who-icd-11', seeded: true,
    },
  ] as never).onConflict((oc) => oc.column('url').doUpdateSet((eb) => ({
    publisher_id: eb.ref('excluded.publisher_id'),
    seeded: eb.ref('excluded.seeded'),
  }))).execute();

  for (const [code, display, shortName, cls] of UCUM_TERMS) {
    await seedDb.insertInto('terminology_concepts').values({
      system: UCUM,
      code,
      display,
      status: 'ACTIVE',
      properties: JSON.stringify({ shortName, class: cls, metadata: { license: 'UCUM' } }) as never,
    } as never).onConflict((oc) => oc.columns(['system', 'code']).doNothing()).execute();
  }

  for (const [code, display, shortName, cls] of ICD10_TERMS) {
    await seedDb.insertInto('terminology_concepts').values({
      system: ICD10,
      code,
      display,
      status: 'ACTIVE',
      properties: JSON.stringify({ shortName, class: cls }) as never,
    } as never).onConflict((oc) => oc.columns(['system', 'code']).doNothing()).execute();
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await (db as Kysely<any>)
    .deleteFrom('terminology_concepts')
    .where('system', 'in', [UCUM, ICD10])
    .execute();
  await (db as Kysely<any>)
    .deleteFrom('coding_systems')
    .where('url', 'in', [UCUM, ICD10, ICD11])
    .execute();
}
