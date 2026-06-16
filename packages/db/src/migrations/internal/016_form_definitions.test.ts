import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('016_form_definitions', () => {
  it('creates form_definitions for persisted form schemas', async () => {
    const db = await makeMigratedDb();

    await db
      .insertInto('form_definitions')
      .values({
        id: 'form-1',
        name: 'Specimen intake',
        version_label: 'v1',
        fhir_resource_type: 'Questionnaire',
        status: 'published',
        active: true,
        schema: JSON.stringify({ name: 'Specimen intake', fields: [] }),
        target_pages: JSON.stringify(['forms']),
      } as never)
      .execute();

    const row = await db
      .selectFrom('form_definitions')
      .select(['id', 'name', 'status', 'active', 'schema', 'target_pages'])
      .where('id', '=', 'form-1')
      .executeTakeFirstOrThrow();

    expect(row).toMatchObject({ id: 'form-1', name: 'Specimen intake', status: 'published', active: true });
    expect(row.schema).toBeTruthy();
    expect(row.target_pages).toBeTruthy();

    await db.destroy();
  });
});
