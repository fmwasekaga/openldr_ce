import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import { type ReportDesign, ReportDesignSchema } from './schema';

function toRow(d: ReportDesign) {
  return {
    id: d.id,
    name: d.name,
    paper: d.paper,
    orientation: d.orientation,
    pages: JSON.stringify(d.pages),
    parameters: JSON.stringify(d.parameters),
    margins: d.margins ? JSON.stringify(d.margins) : null,
  };
}

function fromRow(r: Record<string, unknown>): ReportDesign {
  const parse = (v: unknown, fallback: unknown) => (typeof v === 'string' ? JSON.parse(v) : (v ?? fallback));
  return ReportDesignSchema.parse({
    id: r.id,
    name: r.name,
    paper: r.paper ?? 'A4',
    orientation: r.orientation ?? 'portrait',
    pages: parse(r.pages, []),
    parameters: parse(r.parameters, []),
    margins: r.margins == null ? undefined : parse(r.margins, undefined),
    createdAt: r.created_at ? String(r.created_at) : undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  });
}

export interface ReportDesignStore {
  list(): Promise<ReportDesign[]>;
  get(id: string): Promise<ReportDesign | undefined>;
  create(d: ReportDesign): Promise<ReportDesign>;
  update(id: string, d: ReportDesign): Promise<ReportDesign>;
  remove(id: string): Promise<void>;
}

export function createReportDesignStore(db: Kysely<InternalSchema>): ReportDesignStore {
  const t = () => db.selectFrom('report_designs');
  const store: ReportDesignStore = {
    async list() {
      const rows = await t().selectAll().orderBy('name').execute();
      return rows.map((r) => fromRow(r as Record<string, unknown>));
    },
    async get(id) {
      const r = await t().selectAll().where('id', '=', id).executeTakeFirst();
      return r ? fromRow(r as Record<string, unknown>) : undefined;
    },
    async create(d) {
      // Idempotent insert: mirrors the report-template store — a duplicate id no-ops instead of
      // raising a PK violation, and the existing row is returned.
      const inserted = await db
        .insertInto('report_designs')
        .values(toRow(d) as never)
        .onConflict((oc) => oc.column('id').doNothing())
        .returningAll()
        .executeTakeFirst();
      if (inserted) return fromRow(inserted as Record<string, unknown>);
      return (await store.get(d.id))!;
    },
    async update(id, d) {
      await db.updateTable('report_designs').set({ ...toRow({ ...d, id }) } as never).where('id', '=', id).execute();
      return (await store.get(id))!;
    },
    async remove(id) { await db.deleteFrom('report_designs').where('id', '=', id).execute(); },
  };
  return store;
}
