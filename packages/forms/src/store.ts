import { randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import type { FormSchema } from './schema/form-schema';
import { computeNextFormVersion, formContentChanged, makeDuplicateName } from './lifecycle';
import { toQuestionnaire } from './to-questionnaire';

export interface FormDefinition {
  id: string;
  name: string;
  versionLabel: string | null;
  fhirResourceType: string | null;
  fhirVersion: string | null;
  fhirProfileUrl: string | null;
  facilityId: string | null;
  status: string;
  active: boolean;
  schema: FormSchema;
  targetPages: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface FormSummary {
  id: string;
  name: string;
  versionLabel: string | null;
  status: string;
  active: boolean;
  fhirResourceType: string | null;
  fhirVersion: string | null;
  fhirProfileUrl: string | null;
  facilityId: string | null;
  targetPages: string[] | null;
  fieldCount: number;
  updatedAt: string;
}

export interface FormVersionSummary {
  id: string;
  formId: string;
  version: number;
  versionLabel: string | null;
  name: string;
  fhirResourceType: string | null;
  fhirVersion: string | null;
  fhirProfileUrl: string | null;
  facilityId: string | null;
  targetPages: string[] | null;
  publishedAt: string;
  publishedBy: string | null;
}

export interface FormVersion extends FormVersionSummary {
  schema: FormSchema;
  questionnaire: unknown;
}

export interface PublishInput {
  actorId?: string | null;
  versionLabel?: string | null;
}

export interface FormInput {
  name: string;
  versionLabel?: string | null;
  fhirResourceType?: string | null;
  fhirVersion?: string | null;
  fhirProfileUrl?: string | null;
  facilityId?: string | null;
  status?: string;
  active?: boolean;
  schema: FormSchema;
  targetPages?: string[] | null;
}

type FormRow = {
  id: string;
  name: string;
  version_label: string | null;
  fhir_resource_type: string | null;
  fhir_version: string | null;
  fhir_profile_url: string | null;
  facility_id: string | null;
  status: string;
  active: boolean;
  schema: unknown;
  target_pages: unknown | null;
  created_at: unknown;
  updated_at: unknown;
};

type FormVersionRow = {
  id: string;
  form_id: string;
  version: number;
  version_label: string | null;
  name: string;
  fhir_resource_type: string | null;
  fhir_version: string | null;
  fhir_profile_url: string | null;
  facility_id: string | null;
  schema: unknown;
  target_pages: unknown | null;
  questionnaire: unknown;
  published_at: unknown;
  published_by: string | null;
};

function parseJson(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function toTimestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function countFields(schema: FormSchema): number {
  return schema.fields.length;
}

export function createFormStore(db: Kysely<InternalSchema>) {
  const toDefinition = (r: FormRow): FormDefinition => {
    const schema = parseJson(r.schema) as FormSchema;
    return {
      id: r.id,
      name: r.name,
      versionLabel: r.version_label,
      fhirResourceType: r.fhir_resource_type,
      fhirVersion: r.fhir_version,
      fhirProfileUrl: r.fhir_profile_url,
      facilityId: r.facility_id,
      status: r.status,
      active: r.active,
      schema,
      targetPages: r.target_pages ? (parseJson(r.target_pages) as string[]) : null,
      createdAt: toTimestamp(r.created_at),
      updatedAt: toTimestamp(r.updated_at),
    };
  };
  const toSummary = (r: FormRow): FormSummary => {
    const schema = parseJson(r.schema) as FormSchema;
    return {
      id: r.id,
      name: r.name,
      versionLabel: r.version_label,
      status: r.status,
      active: r.active,
      fhirResourceType: r.fhir_resource_type,
      fhirVersion: r.fhir_version,
      fhirProfileUrl: r.fhir_profile_url,
      facilityId: r.facility_id,
      targetPages: r.target_pages ? (parseJson(r.target_pages) as string[]) : null,
      fieldCount: countFields(schema),
      updatedAt: toTimestamp(r.updated_at),
    };
  };
  const toVersion = (r: FormVersionRow): FormVersion => ({
    id: r.id,
    formId: r.form_id,
    version: r.version,
    versionLabel: r.version_label,
    name: r.name,
    fhirResourceType: r.fhir_resource_type,
    fhirVersion: r.fhir_version,
    fhirProfileUrl: r.fhir_profile_url,
    facilityId: r.facility_id,
    schema: parseJson(r.schema) as FormSchema,
    targetPages: r.target_pages ? (parseJson(r.target_pages) as string[]) : null,
    questionnaire: parseJson(r.questionnaire),
    publishedAt: toTimestamp(r.published_at),
    publishedBy: r.published_by,
  });

  const toVersionSummary = (r: FormVersionRow): FormVersionSummary => {
    return {
      id: r.id,
      formId: r.form_id,
      version: r.version,
      versionLabel: r.version_label,
      name: r.name,
      fhirResourceType: r.fhir_resource_type,
      fhirVersion: r.fhir_version,
      fhirProfileUrl: r.fhir_profile_url,
      facilityId: r.facility_id,
      targetPages: r.target_pages ? (parseJson(r.target_pages) as string[]) : null,
      publishedAt: toTimestamp(r.published_at),
      publishedBy: r.published_by,
    };
  };

  async function get(id: string): Promise<FormDefinition | null> {
    const r = await db.selectFrom('form_definitions').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toDefinition(r as FormRow) : null;
  }

  async function list(): Promise<FormSummary[]> {
    const rows = await db.selectFrom('form_definitions').selectAll().orderBy('updated_at', 'desc').execute();
    return rows.map((r) => toSummary(r as FormRow));
  }

  async function listPublished(targetPage?: string): Promise<FormSummary[]> {
    const rows = await db
      .selectFrom('form_definitions')
      .selectAll()
      .where('status', '=', 'published')
      .where('active', '=', true)
      .orderBy('name')
      .execute();
    const summaries = rows.filter((r) => {
      if (!targetPage) return true;
      const pages = r.target_pages ? parseJson(r.target_pages) : null;
      return Array.isArray(pages) && pages.includes(targetPage);
    });
    return summaries.map((r) => toSummary(r as FormRow));
  }

  async function create(input: FormInput): Promise<FormDefinition> {
    const id = `form-${randomUUID()}`;
    await db
      .insertInto('form_definitions')
      .values({
        id,
        name: input.name,
        version_label: input.versionLabel ?? null,
        fhir_resource_type: input.fhirResourceType ?? null,
        fhir_version: input.fhirVersion ?? null,
        fhir_profile_url: input.fhirProfileUrl ?? null,
        facility_id: input.facilityId ?? null,
        status: input.status ?? 'draft',
        active: input.active ?? true,
        schema: JSON.stringify(input.schema) as never,
        target_pages: input.targetPages ? (JSON.stringify(input.targetPages) as never) : null,
      } as never)
      .execute();
    return (await get(id))!;
  }

  async function update(id: string, input: FormInput): Promise<FormDefinition> {
    const existing = await get(id);
    if (!existing) throw new Error('form not found');
    const contentChanged = formContentChanged(
      {
        name: existing.name,
        fhirResourceType: existing.fhirResourceType,
        schema: existing.schema,
        targetPages: existing.targetPages,
      },
      {
        name: input.name,
        fhirResourceType: input.fhirResourceType ?? null,
        schema: input.schema,
        targetPages: input.targetPages ?? null,
      },
    );
    const nextStatus = existing.status === 'published' && contentChanged ? 'draft' : existing.status;
    await db
      .updateTable('form_definitions')
      .set({
        name: input.name,
        version_label: input.versionLabel ?? null,
        fhir_resource_type: input.fhirResourceType ?? null,
        fhir_version: input.fhirVersion ?? null,
        fhir_profile_url: input.fhirProfileUrl ?? null,
        facility_id: input.facilityId ?? null,
        status: nextStatus,
        schema: JSON.stringify(input.schema) as never,
        target_pages: input.targetPages ? (JSON.stringify(input.targetPages) as never) : null,
        updated_at: sql`now()`,
      })
      .where('id', '=', id)
      .execute();
    return (await get(id))!;
  }

  async function setStatus(id: string, status: 'draft' | 'published' | 'archived'): Promise<FormDefinition> {
    const existing = await get(id);
    if (!existing) throw new Error('form not found');
    if (status === 'published') return publish(id);
    await db.updateTable('form_definitions').set({ status, updated_at: sql`now()` }).where('id', '=', id).execute();
    return (await get(id))!;
  }

  async function deleteForm(id: string): Promise<void> {
    await db.deleteFrom('form_definitions').where('id', '=', id).execute();
  }

  async function publish(id: string, input: PublishInput = {}): Promise<FormDefinition> {
    await db.transaction().execute(async (trx) => {
      const row = await trx.selectFrom('form_definitions').selectAll().where('id', '=', id).executeTakeFirst();
      if (!row) throw new Error('form not found');
      const form = toDefinition(row as FormRow);
      const existing = await trx.selectFrom('form_versions').select(['version']).where('form_id', '=', id).execute();
      const nextVersion = computeNextFormVersion(existing.map((versionRow) => Number(versionRow.version)));
      await trx
        .insertInto('form_versions')
        .values({
          id: `fv-${randomUUID()}`,
          form_id: id,
          version: nextVersion,
          version_label: input.versionLabel ?? form.versionLabel,
          name: form.name,
          fhir_resource_type: form.fhirResourceType,
          fhir_version: form.fhirVersion,
          fhir_profile_url: form.fhirProfileUrl,
          facility_id: form.facilityId,
          schema: JSON.stringify(form.schema) as never,
          target_pages: form.targetPages ? (JSON.stringify(form.targetPages) as never) : null,
          questionnaire: JSON.stringify(toQuestionnaire(form.schema)) as never,
          published_by: input.actorId ?? null,
        } as never)
        .execute();
      await trx
        .updateTable('form_definitions')
        .set({ status: 'published', version_label: input.versionLabel ?? form.versionLabel, updated_at: sql`now()` })
        .where('id', '=', id)
        .execute();
    });
    return (await get(id))!;
  }

  async function duplicate(id: string): Promise<FormDefinition> {
    const form = await get(id);
    if (!form) throw new Error('form not found');
    return create({
      name: makeDuplicateName(form.name),
      versionLabel: form.versionLabel,
      fhirResourceType: form.fhirResourceType,
      fhirVersion: form.fhirVersion,
      fhirProfileUrl: form.fhirProfileUrl,
      facilityId: form.facilityId,
      status: 'draft',
      active: true,
      schema: form.schema,
      targetPages: form.targetPages,
    });
  }

  async function listVersions(id: string): Promise<FormVersionSummary[]> {
    const rows = await db.selectFrom('form_versions').selectAll().where('form_id', '=', id).orderBy('version', 'desc').execute();
    return rows.map((row) => toVersionSummary(row as FormVersionRow));
  }

  async function getVersion(id: string, version: number): Promise<FormVersion | null> {
    const row = await db
      .selectFrom('form_versions')
      .selectAll()
      .where('form_id', '=', id)
      .where('version', '=', version)
      .executeTakeFirst();
    return row ? toVersion(row as FormVersionRow) : null;
  }

  return { get, list, listPublished, create, update, setStatus, delete: deleteForm, publish, duplicate, listVersions, getVersion };
}

export type FormStore = ReturnType<typeof createFormStore>;
