import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedDb } from './test-helpers';

describe('019_form_versions migration', () => {
  it('creates immutable published form snapshot storage', async () => {
    const db = await makeMigratedDb();
    try {
      await db
        .insertInto('form_versions')
        .values({
          id: 'fv-1',
          form_id: 'form-1',
          version: 1,
          version_label: 'v1',
          name: 'Specimen intake',
          fhir_resource_type: 'Questionnaire',
          schema: JSON.stringify({ id: 'specimen-intake', sections: [] }) as never,
          target_pages: JSON.stringify(['forms']) as never,
          questionnaire: JSON.stringify({ resourceType: 'Questionnaire', status: 'active' }) as never,
          published_at: sql`now()` as never,
          published_by: 'system',
        } as never)
        .execute();

      const row = await db.selectFrom('form_versions').selectAll().where('form_id', '=', 'form-1').executeTakeFirstOrThrow();
      expect(row.version).toBe(1);
      expect(row.version_label).toBe('v1');
      expect(row.published_by).toBe('system');
    } finally {
      await db.destroy();
    }
  });
});
