import { describe, expect, it } from 'vitest';
import { type Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { internalMigrations, type InternalSchema } from '@openldr/db';
import { createFormStore } from './store';
import type { FormSchema } from './schema/form-schema';
import { toQuestionnaire } from './to-questionnaire';

async function makeMigratedDb(): Promise<Kysely<InternalSchema>> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<InternalSchema>;
  for (const migration of Object.values(internalMigrations)) {
    await migration.up(db);
  }
  return db;
}

const NOW = '2026-01-01T00:00:00.000Z';

const schema = (name = 'Specimen intake'): FormSchema => ({
  id: 'specimen-intake',
  name,
  versionLabel: null,
  fhirVersion: 'R4',
  fhirResourceType: 'Questionnaire',
  fhirProfileUrl: null,
  facilityId: null,
  status: 'draft',
  active: true,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  targetPages: ['forms'],
  languages: ['en'],
  sections: [
    {
      id: 'main',
      label: 'Main',
      order: 0,
    },
  ],
  fields: [
    {
      id: 'q1',
      fhirPath: null,
      displayLabel: 'Question 1',
      description: null,
      fieldType: 'text',
      required: false,
      enabled: true,
      order: 0,
      cardinality: { min: 0, max: '1' },
      section: 'main',
    },
    {
      id: 'q2',
      fhirPath: null,
      displayLabel: 'Question 2',
      description: null,
      fieldType: 'boolean',
      required: false,
      enabled: true,
      order: 1,
      cardinality: { min: 0, max: '1' },
      section: 'main',
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
      fhirVersion: 'R4',
      schema: schema(),
      targetPages: ['forms'],
    });
    expect((await store.get(created.id))?.schema).toEqual(schema());

    const updatedSchema = schema('Specimen intake updated');
    const updated = await store.update(created.id, {
      name: 'Specimen intake updated',
      versionLabel: 'v2',
      fhirResourceType: 'Questionnaire',
      fhirVersion: 'R4',
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
  }, 15_000);

  it('publishes immutable version snapshots and lists them newest first', async () => {
    const db = await makeMigratedDb();
    const store = createFormStore(db);
    const sampleForm = schema();
    const created = await store.create({
      name: 'Specimen intake',
      versionLabel: 'v1',
      fhirResourceType: 'Questionnaire',
      targetPages: ['forms'],
      schema: sampleForm,
    });

    const published = await store.publish(created.id, { actorId: 'u1', versionLabel: 'v1' });
    expect(published.status).toBe('published');

    const revisedSchema = { ...sampleForm, name: 'Specimen intake revised' };
    await store.update(created.id, {
      ...created,
      name: 'Specimen intake revised',
      schema: revisedSchema,
      targetPages: ['forms', 'specimens'],
    });
    const republished = await store.publish(created.id, { actorId: 'u1', versionLabel: 'v2' });
    expect(republished.versionLabel).toBe('v2');

    const versions = await store.listVersions(created.id);
    expect(versions.map((version) => version.version)).toEqual([2, 1]);
    expect(versions[0].name).toBe('Specimen intake revised');

    const v1 = await store.getVersion(created.id, 1);
    expect(v1?.versionLabel).toBe('v1');
    expect(v1?.name).toBe('Specimen intake');
    expect(v1?.schema).toEqual(sampleForm);
    expect(v1?.targetPages).toEqual(['forms']);
    expect(v1?.questionnaire).toEqual(toQuestionnaire(sampleForm));

    const v2 = await store.getVersion(created.id, 2);
    expect(v2?.name).toBe('Specimen intake revised');
    expect(v2?.schema).toEqual(revisedSchema);
    expect(v2?.targetPages).toEqual(['forms', 'specimens']);
    expect(v2?.questionnaire).toEqual(toQuestionnaire(revisedSchema));

    await db.destroy();
  });

  it('publishes through setStatus with an immutable version snapshot', async () => {
    const db = await makeMigratedDb();
    const store = createFormStore(db);
    const sampleForm = schema();
    const created = await store.create({
      name: 'Specimen intake',
      versionLabel: 'v1',
      fhirResourceType: 'Questionnaire',
      schema: sampleForm,
      targetPages: ['forms'],
    });

    const published = await store.setStatus(created.id, 'published');

    expect(published.status).toBe('published');
    const versions = await store.listVersions(created.id);
    expect(versions.map((version) => version.version)).toEqual([1]);
    const version = await store.getVersion(created.id, 1);
    expect(version?.name).toBe('Specimen intake');
    expect(version?.schema).toEqual(sampleForm);

    await db.destroy();
  });

  it('updates version labels without drafting published forms', async () => {
    const db = await makeMigratedDb();
    const store = createFormStore(db);
    const created = await store.create({
      name: 'Specimen intake',
      versionLabel: 'v1',
      fhirResourceType: 'Questionnaire',
      schema: schema(),
      targetPages: ['forms'],
    });
    await store.publish(created.id, { versionLabel: 'v1' });

    const updated = await store.update(created.id, { ...created, versionLabel: 'v1.1' });

    expect(updated.status).toBe('published');
    expect(updated.versionLabel).toBe('v1.1');

    await db.destroy();
  });

  it('drafts published forms when form content changes', async () => {
    const cases = [
      {
        name: 'name',
        input: {
          name: 'Specimen intake revised',
          versionLabel: 'v1',
          fhirResourceType: 'Questionnaire',
          schema: schema(),
          targetPages: ['forms'],
        },
      },
      {
        name: 'schema',
        input: {
          name: 'Specimen intake',
          versionLabel: 'v1',
          fhirResourceType: 'Questionnaire',
          schema: { ...schema(), name: 'Revised' },
          targetPages: ['forms'],
        },
      },
      {
        name: 'targetPages',
        input: {
          name: 'Specimen intake',
          versionLabel: 'v1',
          fhirResourceType: 'Questionnaire',
          schema: schema(),
          targetPages: ['forms', 'specimens'],
        },
      },
      {
        name: 'fhirResourceType',
        input: {
          name: 'Specimen intake',
          versionLabel: 'v1',
          fhirResourceType: 'Observation',
          schema: schema(),
          targetPages: ['forms'],
        },
      },
    ];

    for (const testCase of cases) {
      const db = await makeMigratedDb();
      const store = createFormStore(db);
      const created = await store.create({
        name: 'Specimen intake',
        versionLabel: 'v1',
        fhirResourceType: 'Questionnaire',
        schema: schema(),
        targetPages: ['forms'],
      });
      await store.publish(created.id, { versionLabel: 'v1' });

      const updated = await store.update(created.id, testCase.input);

      expect(updated.status, testCase.name).toBe('draft');
      await db.destroy();
    }
  });

  it('publishes inside a transaction', async () => {
    const db = await makeMigratedDb();
    const originalTransaction = db.transaction.bind(db);
    let usedTransaction = false;
    (db as unknown as { transaction: typeof db.transaction }).transaction = () => {
      usedTransaction = true;
      return originalTransaction();
    };
    const store = createFormStore(db);
    const created = await store.create({ name: 'Specimen intake', schema: schema(), targetPages: ['forms'] });

    await store.publish(created.id);

    expect(usedTransaction).toBe(true);
    await db.destroy();
  });

  it('throws when updating or setting status for a missing form', async () => {
    const db = await makeMigratedDb();
    const store = createFormStore(db);

    await expect(store.update('missing', { name: 'Missing', schema: schema(), targetPages: ['forms'] })).rejects.toThrow(
      'form not found',
    );
    await expect(store.setStatus('missing', 'published')).rejects.toThrow('form not found');
    await expect(store.publish('missing')).rejects.toThrow('form not found');
    await expect(store.duplicate('missing')).rejects.toThrow('form not found');

    await db.destroy();
  });

  it('duplicates a form as a draft copy', async () => {
    const db = await makeMigratedDb();
    const store = createFormStore(db);
    const created = await store.create({ name: 'Specimen intake', schema: schema(), targetPages: ['forms'] });
    const copy = await store.duplicate(created.id);
    expect(copy.id).not.toBe(created.id);
    expect(copy.name).toBe('Specimen intake copy');
    expect(copy.status).toBe('draft');
    expect(copy.schema).toEqual(created.schema);

    await db.destroy();
  });

  it('stores and retrieves fhirVersion, fhirProfileUrl, and facilityId', async () => {
    const db = await makeMigratedDb();
    const store = createFormStore(db);
    const created = await store.create({
      name: 'FHIR metadata test',
      fhirVersion: 'R4',
      fhirProfileUrl: 'http://example.org/StructureDefinition/test',
      facilityId: 'fac-001',
      schema: schema(),
      targetPages: [],
    });

    expect(created.fhirVersion).toBe('R4');
    expect(created.fhirProfileUrl).toBe('http://example.org/StructureDefinition/test');
    expect(created.facilityId).toBe('fac-001');

    const fetched = await store.get(created.id);
    expect(fetched?.fhirVersion).toBe('R4');
    expect(fetched?.fhirProfileUrl).toBe('http://example.org/StructureDefinition/test');
    expect(fetched?.facilityId).toBe('fac-001');

    await db.destroy();
  });
});
