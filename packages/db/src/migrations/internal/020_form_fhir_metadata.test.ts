import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('020_form_fhir_metadata migration', () => {
  it('adds fhir_version, fhir_profile_url, and facility_id to form_definitions', async () => {
    const db = await makeMigratedDb();
    try {
      await db
        .insertInto('form_definitions')
        .values({
          id: 'fd-1',
          name: 'Test Form',
          version_label: 'v1',
          fhir_resource_type: 'Questionnaire',
          fhir_version: 'R4',
          fhir_profile_url: 'http://example.org/StructureDefinition/test',
          facility_id: 'fac-001',
          status: 'draft',
          active: true,
          schema: JSON.stringify({ id: 'test', fields: [], sections: [] }) as never,
          target_pages: null,
        } as never)
        .execute();

      const row = await db
        .selectFrom('form_definitions')
        .selectAll()
        .where('id', '=', 'fd-1')
        .executeTakeFirstOrThrow();

      expect((row as Record<string, unknown>)['fhir_version']).toBe('R4');
      expect((row as Record<string, unknown>)['fhir_profile_url']).toBe(
        'http://example.org/StructureDefinition/test',
      );
      expect((row as Record<string, unknown>)['facility_id']).toBe('fac-001');
    } finally {
      await db.destroy();
    }
  });
});
