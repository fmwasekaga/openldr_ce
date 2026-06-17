import { type Kysely, sql } from 'kysely';

const SNOMED_CT_URL = 'http://snomed.info/sct';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE coding_systems
    SET
      system_code = 'SNOMED-CT',
      system_name = CASE
        WHEN system_name IN ('SCT', 'SNOMED CT (all versions)') THEN 'SNOMED CT'
        ELSE system_name
      END,
      active = true,
      publisher_id = 'pub-snomed-ct'
    WHERE url = ${SNOMED_CT_URL}
      AND (
        system_code = 'SCT'
        OR system_name = 'SNOMED CT (all versions)'
        OR publisher_id = 'pub-hl7-fhir'
      )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE coding_systems
    SET
      system_code = 'SCT',
      system_name = 'SNOMED CT (all versions)',
      active = false,
      publisher_id = 'pub-hl7-fhir'
    WHERE url = ${SNOMED_CT_URL}
      AND system_code = 'SNOMED-CT'
      AND publisher_id = 'pub-snomed-ct'
  `.execute(db);
}
