import { type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('form_definitions').addColumn('fhir_version', 'text').execute();
  await db.schema.alterTable('form_definitions').addColumn('fhir_profile_url', 'text').execute();
  await db.schema.alterTable('form_definitions').addColumn('facility_id', 'text').execute();

  await db.schema.alterTable('form_versions').addColumn('fhir_version', 'text').execute();
  await db.schema.alterTable('form_versions').addColumn('fhir_profile_url', 'text').execute();
  await db.schema.alterTable('form_versions').addColumn('facility_id', 'text').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('form_definitions').dropColumn('fhir_version').execute();
  await db.schema.alterTable('form_definitions').dropColumn('fhir_profile_url').execute();
  await db.schema.alterTable('form_definitions').dropColumn('facility_id').execute();

  await db.schema.alterTable('form_versions').dropColumn('fhir_version').execute();
  await db.schema.alterTable('form_versions').dropColumn('fhir_profile_url').execute();
  await db.schema.alterTable('form_versions').dropColumn('facility_id').execute();
}
