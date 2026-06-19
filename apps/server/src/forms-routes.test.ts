import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import type { FormDefinition, FormInput, FormVersion, FormVersionSummary } from '@openldr/forms';
import { registerFormsRoutes } from './forms-routes';

type AuditInput = Parameters<AppContext['audit']['record']>[0];

const sampleSchema = {
  id: 'specimen-intake',
  name: 'Specimen intake',
  title: { en: 'Specimen intake' },
  status: 'active',
  languages: ['en'],
  sections: [
    {
      id: 'main',
      title: { en: 'Main' },
      fields: [{ id: 'patientId', type: 'string', label: { en: 'Patient ID' }, required: true }],
    },
  ],
} satisfies FormInput['schema'];

function fakeCtx(): AppContext & { audits: AuditInput[] } {
  const forms: FormDefinition[] = [];
  const versions = new Map<string, FormVersion[]>();
  const audits: AuditInput[] = [];
  let seq = 0;
  const now = '2026-01-01T00:00:00.000Z';

  return {
    logger: {
      error: () => {},
    },
    forms: {
      create: async (input: FormInput) => {
        const form: FormDefinition = {
          id: `form-${++seq}`,
          name: input.name,
          versionLabel: input.versionLabel ?? null,
          fhirResourceType: input.fhirResourceType ?? null,
          status: input.status ?? 'draft',
          active: input.active ?? true,
          schema: input.schema,
          targetPages: input.targetPages ?? null,
          createdAt: now,
          updatedAt: now,
        };
        forms.push(form);
        return form;
      },
      list: async () =>
        forms.map((form) => ({
          id: form.id,
          name: form.name,
          versionLabel: form.versionLabel,
          status: form.status,
          active: form.active,
          fhirResourceType: form.fhirResourceType,
          fieldCount: form.schema.sections.reduce((total, section) => total + section.fields.length, 0),
          updatedAt: form.updatedAt,
        })),
      listPublished: async (targetPage?: string) =>
        forms
          .filter((form) => form.status === 'published' && form.active && (!targetPage || form.targetPages?.includes(targetPage)))
          .map((form) => ({
            id: form.id,
            name: form.name,
            versionLabel: form.versionLabel,
            status: form.status,
            active: form.active,
            fhirResourceType: form.fhirResourceType,
            fieldCount: form.schema.sections.reduce((total, section) => total + section.fields.length, 0),
            updatedAt: form.updatedAt,
          })),
      get: async (id: string) => forms.find((form) => form.id === id) ?? null,
      update: async (id: string, input: FormInput) => {
        const form = forms.find((item) => item.id === id);
        if (!form) throw new Error('not found');
        Object.assign(form, {
          name: input.name,
          versionLabel: input.versionLabel ?? null,
          fhirResourceType: input.fhirResourceType ?? null,
          schema: input.schema,
          targetPages: input.targetPages ?? null,
        });
        return form;
      },
      setStatus: async (id: string, status: 'draft' | 'published' | 'archived') => {
        const form = forms.find((item) => item.id === id);
        if (!form) throw new Error('not found');
        form.status = status;
        return form;
      },
      publish: async (id: string, input?: { versionLabel?: string | null }) => {
        const form = forms.find((item) => item.id === id);
        if (!form) throw new Error('not found');
        const existing = versions.get(id) ?? [];
        const version = existing.length + 1;
        form.status = 'published';
        form.versionLabel = input?.versionLabel ?? null;
        const snapshot: FormVersion = {
          id: `fv-${version}`,
          formId: id,
          version,
          versionLabel: form.versionLabel,
          name: form.name,
          fhirResourceType: form.fhirResourceType,
          schema: form.schema,
          targetPages: form.targetPages,
          questionnaire: {},
          publishedAt: now,
          publishedBy: null,
        };
        versions.set(id, [...existing, snapshot]);
        return form;
      },
      duplicate: async (id: string) => {
        const source = forms.find((item) => item.id === id);
        if (!source) throw new Error('not found');
        const copy: FormDefinition = {
          ...source,
          id: `form-${++seq}`,
          name: `${source.name} copy`,
          status: 'draft',
          versionLabel: null,
          createdAt: now,
          updatedAt: now,
        };
        forms.push(copy);
        return copy;
      },
      listVersions: async (id: string): Promise<FormVersionSummary[]> =>
        (versions.get(id) ?? []).map(({ id: versionId, formId, version, versionLabel, name, fhirResourceType, targetPages, publishedAt, publishedBy }) => ({
          id: versionId,
          formId,
          version,
          versionLabel,
          name,
          fhirResourceType,
          targetPages,
          publishedAt,
          publishedBy,
        })),
      getVersion: async (id: string, version: number) => versions.get(id)?.find((item) => item.version === version) ?? null,
      delete: async (id: string) => {
        const index = forms.findIndex((item) => item.id === id);
        if (index >= 0) forms.splice(index, 1);
      },
    },
    audit: {
      record: async (input: AuditInput) => {
        audits.push(input);
        return { ...input, id: `audit-${audits.length}`, occurredAt: now };
      },
      list: async () => [],
      count: async () => 0,
      get: async () => undefined,
    },
    audits,
  } as unknown as AppContext & { audits: AuditInput[] };
}

describe('forms routes', () => {
  it('creates, lists, publishes, exports questionnaires, and validates responses', async () => {
    const app = Fastify();
    registerFormsRoutes(app, fakeCtx());

    const created = await app.inject({
      method: 'POST',
      url: '/api/forms',
      payload: {
        name: 'Specimen intake',
        versionLabel: 'v1',
        fhirResourceType: 'Questionnaire',
        schema: sampleSchema,
        targetPages: ['forms'],
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;

    const list = await app.inject({ method: 'GET', url: '/api/forms' });
    expect(list.json()).toMatchObject([{ id, name: 'Specimen intake', fieldCount: 1 }]);

    const published = await app.inject({ method: 'POST', url: `/api/forms/${id}/status`, payload: { status: 'published' } });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({ status: 'published' });

    const publishedList = await app.inject({ method: 'GET', url: '/api/forms/published?targetPage=forms' });
    expect(publishedList.json()).toMatchObject([{ id, status: 'published' }]);

    const questionnaire = await app.inject({ method: 'GET', url: `/api/forms/${id}/questionnaire` });
    expect(questionnaire.statusCode).toBe(200);
    expect(questionnaire.json()).toMatchObject({ resourceType: 'Questionnaire', name: 'Specimen intake', item: [{ linkId: 'main' }] });

    const response = await app.inject({ method: 'POST', url: `/api/forms/${id}/responses`, payload: { answers: { patientId: 'P-100' } } });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ resourceType: 'QuestionnaireResponse', status: 'completed' });

    const invalid = await app.inject({ method: 'POST', url: `/api/forms/${id}/responses`, payload: { answers: {} } });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toMatchObject({ resourceType: 'OperationOutcome' });
  });

  it('publishes, duplicates, and returns form versions', async () => {
    const app = Fastify();
    registerFormsRoutes(app, fakeCtx());

    const created = await app.inject({
      method: 'POST',
      url: '/api/forms',
      payload: { name: 'Specimen intake', schema: sampleSchema, targetPages: ['forms'] },
    });
    const id = created.json().id as string;

    const published = await app.inject({ method: 'POST', url: `/api/forms/${id}/publish`, payload: { versionLabel: 'v1' } });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({ status: 'published', versionLabel: 'v1' });

    const versions = await app.inject({ method: 'GET', url: `/api/forms/${id}/versions` });
    expect(versions.statusCode).toBe(200);
    expect(versions.json()).toMatchObject([{ version: 1, versionLabel: 'v1' }]);

    const version = await app.inject({ method: 'GET', url: `/api/forms/${id}/versions/1` });
    expect(version.statusCode).toBe(200);
    expect(version.json()).toMatchObject({ version: 1, schema: sampleSchema });

    const duplicate = await app.inject({ method: 'POST', url: `/api/forms/${id}/duplicate` });
    expect(duplicate.statusCode).toBe(201);
    expect(duplicate.json()).toMatchObject({ status: 'draft' });
  });

  it('rejects malformed form version route params', async () => {
    const app = Fastify();
    registerFormsRoutes(app, fakeCtx());

    const created = await app.inject({
      method: 'POST',
      url: '/api/forms',
      payload: { name: 'Specimen intake', schema: sampleSchema, targetPages: ['forms'] },
    });
    const id = created.json().id as string;
    await app.inject({ method: 'POST', url: `/api/forms/${id}/publish`, payload: { versionLabel: 'v1' } });

    for (const version of ['1abc', '1.5', '0']) {
      const response = await app.inject({ method: 'GET', url: `/api/forms/${id}/versions/${version}` });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'version must be a positive integer' });
    }
  });

  it('records audit events for form lifecycle operations', async () => {
    const app = Fastify();
    const ctx = fakeCtx();
    registerFormsRoutes(app, ctx);

    const created = await app.inject({
      method: 'POST',
      url: '/api/forms',
      payload: { name: 'Specimen intake', schema: sampleSchema, targetPages: ['forms'] },
    });
    const id = created.json().id as string;

    await app.inject({
      method: 'PUT',
      url: `/api/forms/${id}`,
      payload: { name: 'Updated intake', schema: sampleSchema, targetPages: ['forms'] },
    });
    await app.inject({ method: 'POST', url: `/api/forms/${id}/publish`, payload: { versionLabel: 'v1' } });
    const duplicate = await app.inject({ method: 'POST', url: `/api/forms/${id}/duplicate` });
    const duplicateId = duplicate.json().id as string;
    await app.inject({ method: 'POST', url: `/api/forms/${id}/status`, payload: { status: 'archived' } });
    await app.inject({ method: 'POST', url: `/api/forms/${id}/responses`, payload: { answers: { patientId: 'P-100' } } });
    await app.inject({ method: 'DELETE', url: `/api/forms/${id}` });

    expect(ctx.audits.map((event) => event.action)).toEqual([
      'form.create',
      'form.update',
      'form.publish',
      'form.duplicate',
      'form.status',
      'form.response.submit',
      'form.delete',
    ]);
    expect(ctx.audits.find((event) => event.action === 'form.create')).toMatchObject({ entityId: id, before: null });
    expect(ctx.audits.find((event) => event.action === 'form.create')?.after).toMatchObject({ id });
    expect(ctx.audits.find((event) => event.action === 'form.duplicate')).toMatchObject({
      entityId: duplicateId,
      before: null,
      metadata: { sourceFormId: id },
    });
    expect(ctx.audits.find((event) => event.action === 'form.duplicate')?.after).toMatchObject({ id: duplicateId });
    expect(ctx.audits.find((event) => event.action === 'form.response.submit')).toMatchObject({
      entityId: id,
      before: null,
      metadata: { formId: id },
    });
    expect(ctx.audits.find((event) => event.action === 'form.delete')).toMatchObject({
      entityId: id,
      after: null,
    });
    expect(ctx.audits.find((event) => event.action === 'form.delete')?.before).toMatchObject({ id });
  });

  it('does not audit invalid responses or missing deletes', async () => {
    const app = Fastify();
    const ctx = fakeCtx();
    registerFormsRoutes(app, ctx);

    const created = await app.inject({
      method: 'POST',
      url: '/api/forms',
      payload: { name: 'Specimen intake', schema: sampleSchema, targetPages: ['forms'] },
    });
    const id = created.json().id as string;
    ctx.audits.length = 0;

    const invalid = await app.inject({ method: 'POST', url: `/api/forms/${id}/responses`, payload: { answers: {} } });
    expect(invalid.statusCode).toBe(422);

    const missingDelete = await app.inject({ method: 'DELETE', url: '/api/forms/missing' });
    expect(missingDelete.statusCode).toBe(404);
    expect(missingDelete.json()).toMatchObject({ error: 'not found' });
    expect(ctx.audits).toEqual([]);
  });

  it('returns 404 for missing lifecycle resources', async () => {
    const app = Fastify();
    registerFormsRoutes(app, fakeCtx());

    const publish = await app.inject({ method: 'POST', url: '/api/forms/missing/publish', payload: { versionLabel: 'v1' } });
    expect(publish.statusCode).toBe(404);

    const duplicate = await app.inject({ method: 'POST', url: '/api/forms/missing/duplicate' });
    expect(duplicate.statusCode).toBe(404);

    const versions = await app.inject({ method: 'GET', url: '/api/forms/missing/versions' });
    expect(versions.statusCode).toBe(404);

    const created = await app.inject({
      method: 'POST',
      url: '/api/forms',
      payload: { name: 'Specimen intake', schema: sampleSchema, targetPages: ['forms'] },
    });
    const id = created.json().id as string;
    const snapshot = await app.inject({ method: 'GET', url: `/api/forms/${id}/versions/1` });
    expect(snapshot.statusCode).toBe(404);
  });

  it('returns 404 for orphaned version snapshots after the parent form is deleted', async () => {
    const app = Fastify();
    const ctx = fakeCtx();
    registerFormsRoutes(app, ctx);

    const created = await app.inject({
      method: 'POST',
      url: '/api/forms',
      payload: { name: 'Specimen intake', schema: sampleSchema, targetPages: ['forms'] },
    });
    const id = created.json().id as string;
    await app.inject({ method: 'POST', url: `/api/forms/${id}/publish`, payload: { versionLabel: 'v1' } });
    await app.inject({ method: 'DELETE', url: `/api/forms/${id}` });
    const auditCount = ctx.audits.length;

    const snapshot = await app.inject({ method: 'GET', url: `/api/forms/${id}/versions/1` });
    expect(snapshot.statusCode).toBe(404);
    expect(snapshot.json()).toMatchObject({ error: 'not found' });
    expect(ctx.audits).toHaveLength(auditCount);
  });
});
