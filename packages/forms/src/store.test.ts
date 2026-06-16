import { describe, expect, it } from 'vitest';
import { type Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { internalMigrations, type InternalSchema } from '@openldr/db';
import { createFormStore } from './store';
import type { FormSchema } from './schema/form-schema';

async function makeMigratedDb(): Promise<Kysely<InternalSchema>> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<InternalSchema>;
  for (const migration of Object.values(internalMigrations)) {
    await migration.up(db);
  }
  return db;
}

const schema = (name = 'Specimen intake'): FormSchema => ({
  id: 'specimen-intake',
  name,
  title: { en: name },
  status: 'active',
  languages: ['en'],
  sections: [
    {
      id: 'main',
      title: { en: 'Main' },
      fields: [
        { id: 'q1', type: 'string', label: { en: 'Question 1' } },
        { id: 'q2', type: 'boolean', label: { en: 'Question 2' } },
      ],
    },
  ],
});

describe('createFormStore', () => {
  it('creates, updates, publishes, lists published by target page, and deletes forms', async () => {
    const db = await makeMigratedDb();
    const store = createFormStore(db);

    const created = await store.create({
      name: 'Specimen intake',
      versionLabel: 'v1',
      fhirResourceType: 'Questionnaire',
      schema: schema(),
      targetPages: ['forms'],
    });
    expect((await store.get(created.id))?.schema).toEqual(schema());

    const updatedSchema = schema('Specimen intake updated');
    const updated = await store.update(created.id, {
      name: 'Specimen intake updated',
      versionLabel: 'v2',
      fhirResourceType: 'Questionnaire',
      schema: updatedSchema,
      targetPages: ['forms', 'specimens'],
    });
    expect(updated.schema).toEqual(updatedSchema);

    const published = await store.setStatus(created.id, 'published');
    expect(published.status).toBe('published');

    const list = await store.list();
    expect(list).toMatchObject([{ id: created.id, name: 'Specimen intake updated', fieldCount: 2 }]);
    expect(await store.listPublished('forms')).toMatchObject([{ id: created.id }]);
    expect(await store.listPublished('users')).toEqual([]);

    await store.delete(created.id);
    expect(await store.get(created.id)).toBeNull();

    await db.destroy();
  });
});
