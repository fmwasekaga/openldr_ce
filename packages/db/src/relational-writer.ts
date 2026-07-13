import type { Kysely } from 'kysely';
import type { ExternalSchema } from './schema/external';
import type { Provenance } from './provenance';
import type { TargetEngine } from './engine';
import { insertBatchPg, mergeBatchMssql, insertBatchMysql, type WriteResult } from './batch-upsert';
import { projectResource, tableForResourceType } from './relational/index';

export type { WriteResult };
export interface RelationalWriteItem { resource: unknown; provenance?: Provenance; }

export interface RelationalWriter {
  write(resource: unknown, provenance?: Provenance): Promise<WriteResult>;
  writeMany(items: RelationalWriteItem[]): Promise<WriteResult[]>;
  deleteById(resourceType: string, id: string): Promise<void>;
}

export function createRelationalWriter(db: Kysely<ExternalSchema>, engine: TargetEngine = 'postgres'): RelationalWriter {
  const anyDb = db as unknown as Kysely<any>;
  async function upsert(table: string, rows: Record<string, unknown>[]): Promise<void> {
    if (rows.length === 0) return;
    if (engine === 'mssql') await mergeBatchMssql(anyDb, table, rows);
    else if (engine === 'mysql') await insertBatchMysql(anyDb, table, rows);
    else await insertBatchPg(anyDb, table, rows);
  }
  return {
    async write(resource, provenance = {}) {
      const p = projectResource(resource, provenance);
      if (!p) return 'skipped';
      await upsert(p.table, [p.row]);
      return 'written';
    },
    async writeMany(items) {
      const results: WriteResult[] = new Array(items.length).fill('skipped');
      const byTable = new Map<string, Record<string, unknown>[]>();
      items.forEach((it, idx) => {
        const p = projectResource(it.resource, it.provenance ?? {});
        if (!p) return;
        results[idx] = 'written';
        const list = byTable.get(p.table) ?? [];
        list.push(p.row);
        byTable.set(p.table, list);
      });
      for (const [table, rows] of byTable) await upsert(table, rows);
      return results;
    },
    async deleteById(resourceType, id) {
      const table = tableForResourceType(resourceType);
      if (!table) return;
      await anyDb.deleteFrom(table).where('id', '=', id).execute();
    },
  };
}
