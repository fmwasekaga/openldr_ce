import { randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import type { FormSchema } from './schema/form-schema';

export interface FormDefinition {
  id: string;
  name: string;
  versionLabel: string | null;
  fhirResourceType: string | null;
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
  fieldCount: number;
  updatedAt: string;
}

export interface FormInput {
  name: string;
  versionLabel?: string | null;
  fhirResourceType?: string | null;
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
  status: string;
  active: boolean;
  schema: unknown;
  target_pages: unknown | null;
  created_at: unknown;
  updated_at: unknown;
};

function parseJson(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function toTimestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function countFields(schema: FormSchema): number {
  return schema.sections.reduce((total, section) => total + section.fields.length, 0);
}

export function createFormStore(db: Kysely<InternalSchema>) {
  const toDefinition = (r: FormRow): FormDefinition => {
    const schema = parseJson(r.schema) as FormSchema;
    return {
      id: r.id,
      name: r.name,
      versionLabel: r.version_label,
      fhirResourceType: r.fhir_resource_type,
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
      fieldCount: countFields(schema),
      updatedAt: toTimestamp(r.updated_at),
    };
  };

  async function get(id: string): Promise<FormDefinition | null> {
    const r = await db.selectFrom('form_definitions').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toDefinition(r as FormRow) : null;
  }

  return {
    get,
    async list(): Promise<FormSummary[]> {
      const rows = await db.selectFrom('form_definitions').selectAll().orderBy('updated_at', 'desc').execute();
      return rows.map((r) => toSummary(r as FormRow));
    },
    async listPublished(targetPage?: string): Promise<FormSummary[]> {
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
    },
    async create(input: FormInput): Promise<FormDefinition> {
      const id = `form-${randomUUID()}`;
      await db
        .insertInto('form_definitions')
        .values({
          id,
          name: input.name,
          version_label: input.versionLabel ?? null,
          fhir_resource_type: input.fhirResourceType ?? null,
          status: input.status ?? 'draft',
          active: input.active ?? true,
          schema: JSON.stringify(input.schema) as never,
          target_pages: input.targetPages ? (JSON.stringify(input.targetPages) as never) : null,
        } as never)
        .execute();
      return (await get(id))!;
    },
    async update(id: string, input: FormInput): Promise<FormDefinition> {
      await db
        .updateTable('form_definitions')
        .set({
          name: input.name,
          version_label: input.versionLabel ?? null,
          fhir_resource_type: input.fhirResourceType ?? null,
          schema: JSON.stringify(input.schema) as never,
          target_pages: input.targetPages ? (JSON.stringify(input.targetPages) as never) : null,
          updated_at: sql`now()`,
        })
        .where('id', '=', id)
        .execute();
      return (await get(id))!;
    },
    async setStatus(id: string, status: 'draft' | 'published' | 'archived'): Promise<FormDefinition> {
      await db.updateTable('form_definitions').set({ status, updated_at: sql`now()` }).where('id', '=', id).execute();
      return (await get(id))!;
    },
    async delete(id: string): Promise<void> {
      await db.deleteFrom('form_definitions').where('id', '=', id).execute();
    },
  };
}

export type FormStore = ReturnType<typeof createFormStore>;
