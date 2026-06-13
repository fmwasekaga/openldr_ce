import { type Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import type { PluginManifest } from './manifest';

export interface PluginRow {
  id: string;
  version: string;
  sha256: string;
  manifest: PluginManifest;
  status: string;
}

export interface PluginStore {
  upsert(row: { id: string; version: string; sha256: string; manifest: PluginManifest }): Promise<void>;
  get(id: string, version?: string): Promise<PluginRow | undefined>;
  list(): Promise<PluginRow[]>;
  remove(id: string, version?: string): Promise<void>;
}

const COLUMNS = ['id', 'version', 'sha256', 'manifest', 'status'] as const;

function toRow(r: { id: string; version: string; sha256: string; manifest: unknown; status: string }): PluginRow {
  return { ...r, manifest: r.manifest as PluginManifest };
}

/** Compare semver-ish strings numerically by dotted segment; non-numeric segments fall back to string order. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number(pa[i]);
    const nb = Number(pb[i]);
    if (Number.isInteger(na) && Number.isInteger(nb)) {
      if (na !== nb) return na - nb;
    } else {
      const sa = pa[i] ?? '';
      const sb = pb[i] ?? '';
      if (sa !== sb) return sa < sb ? -1 : 1;
    }
  }
  return 0;
}

export function createPluginStore(db: Kysely<InternalSchema>): PluginStore {
  return {
    async upsert(row) {
      await db
        .insertInto('plugins')
        .values({ id: row.id, version: row.version, sha256: row.sha256, manifest: row.manifest as never, status: 'installed' })
        .onConflict((oc) => oc.columns(['id', 'version']).doUpdateSet({ sha256: row.sha256, manifest: row.manifest as never, status: 'installed' }))
        .execute();
    },
    async get(id, version) {
      if (version) {
        const r = await db.selectFrom('plugins').select(COLUMNS).where('id', '=', id).where('version', '=', version).executeTakeFirst();
        return r ? toRow(r) : undefined;
      }
      const rows = await db.selectFrom('plugins').select(COLUMNS).where('id', '=', id).where('status', '=', 'installed').execute();
      if (rows.length === 0) return undefined;
      rows.sort((a, b) => compareVersions(b.version, a.version));
      return toRow(rows[0]);
    },
    async list() {
      const rows = await db.selectFrom('plugins').select(COLUMNS).orderBy('id').orderBy('version', 'desc').execute();
      return rows.map(toRow);
    },
    async remove(id, version) {
      let q = db.deleteFrom('plugins').where('id', '=', id);
      if (version) q = q.where('version', '=', version);
      await q.execute();
    },
  };
}
