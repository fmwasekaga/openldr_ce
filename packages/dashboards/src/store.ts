import type { Kysely } from 'kysely';
import { canonicalHash } from '@openldr/core';
import type { InternalSchema, ReferenceCapture } from '@openldr/db';
import { type Dashboard, DashboardSchema } from './types';

function toRow(d: Dashboard) {
  return {
    id: d.id, owner_id: d.ownerId ?? null, name: d.name,
    layout: JSON.stringify(d.layout), widgets: JSON.stringify(d.widgets), filters: JSON.stringify(d.filters),
    refresh_interval_sec: d.refreshIntervalSec, is_default: d.isDefault,
  };
}
function fromRow(r: Record<string, unknown>): Dashboard {
  const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : (v ?? []));
  return DashboardSchema.parse({
    id: r.id, ownerId: r.owner_id ?? null, name: r.name,
    layout: parse(r.layout), widgets: parse(r.widgets), filters: parse(r.filters),
    refreshIntervalSec: Number(r.refresh_interval_sec ?? 0), isDefault: Boolean(r.is_default),
    createdAt: r.created_at ? String(r.created_at) : undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  });
}

export interface DashboardStore {
  list(): Promise<Dashboard[]>;
  get(id: string): Promise<Dashboard | undefined>;
  create(d: Dashboard): Promise<Dashboard>;
  update(id: string, d: Dashboard): Promise<Dashboard>;
  remove(id: string): Promise<void>;
}

// Hash the exact seed-relevant field set used by dashboardContentEqual (seed.ts) so the
// reference-change content hash is stable against jsonb key reordering and never drifts from
// the seed-equality check. canonicalHash sorts keys, so filters/widgets/layout order is fixed.
function hashOf(d: Dashboard): string {
  return canonicalHash({ name: d.name, filters: d.filters, widgets: d.widgets, layout: d.layout });
}

export function createDashboardStore(db: Kysely<InternalSchema>, capture?: ReferenceCapture): DashboardStore {
  const t = () => db.selectFrom('dashboards');
  const store: DashboardStore = {
    async list() {
      const rows = await t().selectAll().orderBy('name').execute();
      return rows.map((r) => fromRow(r as Record<string, unknown>));
    },
    async get(id) {
      const r = await t().selectAll().where('id', '=', id).executeTakeFirst();
      return r ? fromRow(r as Record<string, unknown>) : undefined;
    },
    async create(d) {
      // Idempotent insert: React StrictMode double-fires the empty-list seed effect, so two
      // concurrent POSTs of the same id race on the PK. ON CONFLICT DO NOTHING lets the loser
      // no-op instead of hitting a unique-violation (which mapError surfaced as a 500). If no
      // row comes back (a concurrent insert won), read the existing row and return it.
      return db.transaction().execute(async (trx) => {
        const inserted = await trx
          .insertInto('dashboards')
          .values(toRow(d) as never)
          .onConflict((oc) => oc.column('id').doNothing())
          .returningAll()
          .executeTakeFirst();
        if (capture) await capture.record(trx, 'dashboard', d.id, 'upsert', hashOf(d));
        if (inserted) return fromRow(inserted as Record<string, unknown>);
        const row = await trx.selectFrom('dashboards').selectAll().where('id', '=', d.id).executeTakeFirst();
        return fromRow(row as Record<string, unknown>);
      });
    },
    async update(id, d) {
      return db.transaction().execute(async (trx) => {
        await trx.updateTable('dashboards').set({ ...toRow({ ...d, id }) } as never).where('id', '=', id).execute();
        if (capture) await capture.record(trx, 'dashboard', id, 'upsert', hashOf({ ...d, id }));
        const row = await trx.selectFrom('dashboards').selectAll().where('id', '=', id).executeTakeFirst();
        return fromRow(row as Record<string, unknown>);
      });
    },
    async remove(id) {
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('dashboards').where('id', '=', id).execute();
        if (capture) await capture.record(trx, 'dashboard', id, 'delete', null);
      });
    },
  };
  return store;
}
