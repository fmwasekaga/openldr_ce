import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from '@openldr/db';

export interface PluginRow {
  id: string;
  version: string;
  sha256: string;
  manifest: Record<string, unknown>;
  status: string;
  enabled: boolean;
  active: boolean;
  approvedBy: string | null;
}

export interface PluginInstallInput {
  id: string;
  version: string;
  sha256: string;
  manifest: Record<string, unknown>;
  approvedBy: string | null;
}

export interface PluginStore {
  install(input: PluginInstallInput): Promise<void>;
  get(id: string, version?: string): Promise<PluginRow | undefined>;
  list(): Promise<PluginRow[]>;
  rollback(id: string, version: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  remove(id: string, version?: string): Promise<void>;
}

const COLUMNS = ['id', 'version', 'sha256', 'manifest', 'status', 'enabled', 'active', 'approved_by'] as const;

function toRow(r: Record<string, unknown>): PluginRow {
  return {
    id: r.id as string,
    version: r.version as string,
    sha256: r.sha256 as string,
    manifest: r.manifest as Record<string, unknown>,
    status: r.status as string,
    enabled: r.enabled as boolean,
    active: r.active as boolean,
    approvedBy: (r.approved_by as string | null) ?? null,
  };
}

export function createPluginStore(db: Kysely<InternalSchema>): PluginStore {
  return {
    async install({ id, version, sha256, manifest, approvedBy }) {
      // Wrap in a transaction so there is never a window with zero active rows.
      await db.transaction().execute(async (trx) => {
        // The newly installed version becomes the sole active one; deactivate all existing rows for this id.
        await trx.updateTable('plugins').set({ active: false }).where('id', '=', id).execute();
        await trx
          .insertInto('plugins')
          .values({
            id,
            version,
            sha256,
            manifest: manifest as never,
            status: 'installed',
            enabled: true,
            active: true,
            approved_by: approvedBy,
            granted_at: sql`now()`,
          })
          .onConflict((oc) =>
            oc.columns(['id', 'version']).doUpdateSet({
              sha256,
              manifest: manifest as never,
              status: 'installed',
              active: true,
              enabled: true,
              approved_by: approvedBy,
              granted_at: sql`now()`,
            }),
          )
          .execute();
      });
    },

    async get(id, version) {
      let q = db.selectFrom('plugins').select(COLUMNS).where('id', '=', id);
      if (version) {
        q = q.where('version', '=', version).where('enabled', '=', true);
      } else {
        q = q.where('active', '=', true).where('enabled', '=', true);
      }
      const r = await q.executeTakeFirst();
      return r ? toRow(r as Record<string, unknown>) : undefined;
    },

    async list() {
      const rows = await db
        .selectFrom('plugins')
        .select(COLUMNS)
        .orderBy('id')
        .orderBy('version', 'desc')
        .execute();
      return rows.map((r) => toRow(r as Record<string, unknown>));
    },

    async rollback(id, version) {
      const exists = await db
        .selectFrom('plugins')
        .select('version')
        .where('id', '=', id)
        .where('version', '=', version)
        .executeTakeFirst();
      if (!exists) {
        throw new Error(`cannot roll back ${id}: version ${version} is not installed`);
      }
      await db.updateTable('plugins').set({ active: false }).where('id', '=', id).execute();
      await db
        .updateTable('plugins')
        .set({ active: true })
        .where('id', '=', id)
        .where('version', '=', version)
        .execute();
    },

    async setEnabled(id, enabled) {
      await db.updateTable('plugins').set({ enabled }).where('id', '=', id).execute();
    },

    async remove(id, version) {
      let q = db.deleteFrom('plugins').where('id', '=', id);
      if (version) q = q.where('version', '=', version);
      await q.execute();
    },
  };
}
