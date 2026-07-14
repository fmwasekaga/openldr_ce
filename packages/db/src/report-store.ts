import type { Kysely } from 'kysely';
import { canonicalHash } from '@openldr/core';
import type { InternalSchema } from './schema/internal';
import type { ReferenceCapture } from './reference-capture';

// Structural mirror of @openldr/reporting ReportDef (db must not depend on reporting; custom-query-store precedent).
export interface ReportRecord {
  id: string;
  name: string;
  description: string;
  category: string;
  designId: string;
  primaryQueryId: string;
  summaryMetrics: unknown[] | null;
  chart: unknown | null;
  paramOptions: Record<string, string> | null;
  status: string;
}

function toRow(r: ReportRecord) {
  return {
    id: r.id, name: r.name, description: r.description, category: r.category,
    design_id: r.designId, primary_query_id: r.primaryQueryId,
    summary_metrics: r.summaryMetrics == null ? null : JSON.stringify(r.summaryMetrics),
    chart: r.chart == null ? null : JSON.stringify(r.chart),
    param_options: r.paramOptions == null ? null : JSON.stringify(r.paramOptions),
    status: r.status,
  };
}
function parse<T>(v: unknown): T | null { return v == null ? null : (typeof v === 'string' ? JSON.parse(v) : v) as T; }
function fromRow(r: Record<string, unknown>): ReportRecord {
  return {
    id: r.id as string, name: r.name as string, description: (r.description as string) ?? '',
    category: r.category as string, designId: r.design_id as string, primaryQueryId: r.primary_query_id as string,
    summaryMetrics: parse<unknown[]>(r.summary_metrics), chart: parse<unknown>(r.chart),
    paramOptions: parse<Record<string, string>>(r.param_options), status: r.status as string,
  };
}

export interface ReportStore {
  list(): Promise<ReportRecord[]>;
  get(id: string): Promise<ReportRecord | undefined>;
  create(r: ReportRecord): Promise<ReportRecord>;
  update(id: string, r: ReportRecord): Promise<ReportRecord>;
  remove(id: string): Promise<void>;
}

// Hash over the seed-relevant fields (NOT id) so the reference-change content hash is stable
// against jsonb key reordering (canonicalHash sorts keys) and matches what a lab consumes.
function hashOf(r: ReportRecord): string {
  return canonicalHash({
    name: r.name, description: r.description, category: r.category,
    designId: r.designId, primaryQueryId: r.primaryQueryId,
    summaryMetrics: r.summaryMetrics, chart: r.chart, paramOptions: r.paramOptions,
    status: r.status,
  });
}

export function createReportStore(db: Kysely<InternalSchema>, capture?: ReferenceCapture): ReportStore {
  const store: ReportStore = {
    async list() {
      const rows = await db.selectFrom('reports').selectAll().orderBy('name').execute();
      return rows.map((r) => fromRow(r as Record<string, unknown>));
    },
    async get(id) {
      const r = await db.selectFrom('reports').selectAll().where('id', '=', id).executeTakeFirst();
      return r ? fromRow(r as Record<string, unknown>) : undefined;
    },
    async create(r) {
      return db.transaction().execute(async (trx) => {
        const inserted = await trx.insertInto('reports').values(toRow(r) as never)
          .onConflict((oc) => oc.column('id').doNothing()).returningAll().executeTakeFirst();
        if (capture) await capture.record(trx, 'report', r.id, 'upsert', hashOf(r));
        if (inserted) return fromRow(inserted as Record<string, unknown>);
        const row = await trx.selectFrom('reports').selectAll().where('id', '=', r.id).executeTakeFirst();
        return fromRow(row as Record<string, unknown>);
      });
    },
    async update(id, r) {
      return db.transaction().execute(async (trx) => {
        await trx.updateTable('reports').set({ ...toRow({ ...r, id }) } as never).where('id', '=', id).execute();
        if (capture) await capture.record(trx, 'report', id, 'upsert', hashOf({ ...r, id }));
        const row = await trx.selectFrom('reports').selectAll().where('id', '=', id).executeTakeFirst();
        return fromRow(row as Record<string, unknown>);
      });
    },
    async remove(id) {
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('reports').where('id', '=', id).execute();
        if (capture) await capture.record(trx, 'report', id, 'delete', null);
      });
    },
  };
  return store;
}
