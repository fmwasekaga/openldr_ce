import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';
import type { CustomQuery, CustomQueryParam } from '@openldr/dashboards';

export interface NewCustomQuery {
  id: string; name: string; connectorId: string; sql: string; params: CustomQueryParam[];
}
export interface CustomQueryPatch {
  name?: string; connectorId?: string; sql?: string; params?: CustomQueryParam[];
}
export interface CustomQueryStore {
  create(q: NewCustomQuery): Promise<void>;
  get(id: string): Promise<CustomQuery | null>;
  getByName(name: string): Promise<CustomQuery | null>;
  list(): Promise<CustomQuery[]>;
  update(id: string, patch: CustomQueryPatch): Promise<void>;
  remove(id: string): Promise<void>;
}

const COLS = ['id', 'name', 'connector_id', 'sql', 'params'] as const;

function toQuery(r: { id: string; name: string; connector_id: string; sql: string; params: unknown }): CustomQuery {
  return {
    id: r.id, name: r.name, connectorId: r.connector_id, sql: r.sql,
    params: (r.params as CustomQueryParam[]) ?? [],
  };
}

export function createCustomQueryStore(db: Kysely<InternalSchema>): CustomQueryStore {
  return {
    async create(q) {
      await db.insertInto('custom_queries').values({
        id: q.id, name: q.name, connector_id: q.connectorId, sql: q.sql,
        params: JSON.stringify(q.params) as never,
      }).execute();
    },
    async get(id) {
      const r = await db.selectFrom('custom_queries').select(COLS).where('id', '=', id).executeTakeFirst();
      return r ? toQuery(r) : null;
    },
    async getByName(name) {
      const r = await db.selectFrom('custom_queries').select(COLS).where('name', '=', name).executeTakeFirst();
      return r ? toQuery(r) : null;
    },
    async list() {
      return (await db.selectFrom('custom_queries').select(COLS).orderBy('name', 'asc').execute()).map(toQuery);
    },
    async update(id, patch) {
      const set: Record<string, unknown> = { updated_at: sql`now()` };
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.connectorId !== undefined) set.connector_id = patch.connectorId;
      if (patch.sql !== undefined) set.sql = patch.sql;
      if (patch.params !== undefined) set.params = JSON.stringify(patch.params) as never;
      await db.updateTable('custom_queries').set(set).where('id', '=', id).execute();
    },
    async remove(id) { await db.deleteFrom('custom_queries').where('id', '=', id).execute(); },
  };
}
