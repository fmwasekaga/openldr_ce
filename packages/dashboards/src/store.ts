import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
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

export function createDashboardStore(db: Kysely<InternalSchema>): DashboardStore {
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
      const inserted = await db
        .insertInto('dashboards')
        .values(toRow(d) as never)
        .onConflict((oc) => oc.column('id').doNothing())
        .returningAll()
        .executeTakeFirst();
      if (inserted) return fromRow(inserted as Record<string, unknown>);
      return (await store.get(d.id))!;
    },
    async update(id, d) {
      await db.updateTable('dashboards').set({ ...toRow({ ...d, id }) } as never).where('id', '=', id).execute();
      return (await store.get(id))!;
    },
    async remove(id) { await db.deleteFrom('dashboards').where('id', '=', id).execute(); },
  };
  return store;
}
