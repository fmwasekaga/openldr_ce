import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import { type ReportTemplate, ReportTemplateSchema } from './schema';

function toRow(t: ReportTemplate) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    status: t.status,
    page: JSON.stringify(t.page),
    parameters: JSON.stringify(t.parameters),
    dataset: t.dataset ? JSON.stringify(t.dataset) : null,
    rows: JSON.stringify(t.rows),
  };
}

function fromRow(r: Record<string, unknown>): ReportTemplate {
  const parse = (v: unknown, fallback: unknown) => (typeof v === 'string' ? JSON.parse(v) : (v ?? fallback));
  return ReportTemplateSchema.parse({
    id: r.id,
    name: r.name,
    description: r.description ?? '',
    category: r.category ?? 'operational',
    status: r.status ?? 'draft',
    page: parse(r.page, {}),
    parameters: parse(r.parameters, []),
    dataset: r.dataset == null ? undefined : parse(r.dataset, undefined),
    rows: parse(r.rows, []),
    createdAt: r.created_at ? String(r.created_at) : undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  });
}

export interface ReportTemplateStore {
  list(): Promise<ReportTemplate[]>;
  get(id: string): Promise<ReportTemplate | undefined>;
  create(t: ReportTemplate): Promise<ReportTemplate>;
  update(id: string, t: ReportTemplate): Promise<ReportTemplate>;
  remove(id: string): Promise<void>;
}

export function createReportTemplateStore(db: Kysely<InternalSchema>): ReportTemplateStore {
  const t = () => db.selectFrom('report_templates');
  const store: ReportTemplateStore = {
    async list() {
      const rows = await t().selectAll().orderBy('name').execute();
      return rows.map((r) => fromRow(r as Record<string, unknown>));
    },
    async get(id) {
      const r = await t().selectAll().where('id', '=', id).executeTakeFirst();
      return r ? fromRow(r as Record<string, unknown>) : undefined;
    },
    async create(tpl) {
      // Idempotent insert: mirrors the dashboard store — a duplicate id no-ops instead of
      // raising a PK violation, and the existing row is returned.
      const inserted = await db
        .insertInto('report_templates')
        .values(toRow(tpl) as never)
        .onConflict((oc) => oc.column('id').doNothing())
        .returningAll()
        .executeTakeFirst();
      if (inserted) return fromRow(inserted as Record<string, unknown>);
      return (await store.get(tpl.id))!;
    },
    async update(id, tpl) {
      await db.updateTable('report_templates').set({ ...toRow({ ...tpl, id }) } as never).where('id', '=', id).execute();
      return (await store.get(id))!;
    },
    async remove(id) { await db.deleteFrom('report_templates').where('id', '=', id).execute(); },
  };
  return store;
}
