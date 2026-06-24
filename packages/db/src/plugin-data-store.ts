import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export interface PluginDataEntry {
  collection: string;
  key: string;
  doc: unknown;
  updatedAt: Date;
}

export interface PluginDataListOptions {
  /** Equality match on a single top-level field of the stored doc. */
  where?: { field: string; eq: unknown };
  /** Cap the number of returned rows. */
  limit?: number;
}

export interface PluginDataStore {
  get(pluginId: string, collection: string, key: string): Promise<unknown | null>;
  put(pluginId: string, collection: string, key: string, doc: unknown): Promise<void>;
  delete(pluginId: string, collection: string, key: string): Promise<void>;
  list(pluginId: string, collection: string, opts?: PluginDataListOptions): Promise<PluginDataEntry[]>;
  /** Remove an entire plugin namespace (uninstall). */
  purge(pluginId: string): Promise<void>;
}

export function createPluginDataStore(db: Kysely<InternalSchema>): PluginDataStore {
  return {
    async get(pluginId, collection, key) {
      const r = await db.selectFrom('plugin_data').select('doc')
        .where('plugin_id', '=', pluginId).where('collection', '=', collection).where('key', '=', key)
        .executeTakeFirst();
      return r ? (r.doc as unknown) : null;
    },

    async put(pluginId, collection, key, doc) {
      await db.insertInto('plugin_data')
        .values({ plugin_id: pluginId, collection, key, doc: doc as never, updated_at: sql`now()` as never })
        .onConflict((oc) => oc.columns(['plugin_id', 'collection', 'key']).doUpdateSet({ doc: doc as never, updated_at: sql`now()` as never }))
        .execute();
    },

    async delete(pluginId, collection, key) {
      await db.deleteFrom('plugin_data')
        .where('plugin_id', '=', pluginId).where('collection', '=', collection).where('key', '=', key)
        .execute();
    },

    async list(pluginId, collection, opts) {
      let q = db.selectFrom('plugin_data').select(['collection', 'key', 'doc', 'updated_at'])
        .where('plugin_id', '=', pluginId).where('collection', '=', collection);
      if (opts?.where) {
        const field = opts.where.field;
        if (!/^[A-Za-z0-9_]+$/.test(field)) throw new Error(`invalid filter field: ${field}`);
        q = q.where(sql`doc ->> ${sql.lit(field)}`, '=', String(opts.where.eq));
      }
      q = q.orderBy('key');
      if (opts?.limit !== undefined) q = q.limit(opts.limit);
      const rows = await q.execute();
      return rows.map((r) => ({ collection: r.collection, key: r.key, doc: r.doc as unknown, updatedAt: r.updated_at }));
    },

    async purge(pluginId) {
      await db.deleteFrom('plugin_data').where('plugin_id', '=', pluginId).execute();
    },
  };
}
