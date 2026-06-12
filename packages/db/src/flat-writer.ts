import type { Kysely } from 'kysely';
import type { ExternalSchema } from './schema/external';
import type { Provenance } from './provenance';
import { flattenResource } from './flatten/index';

export type WriteResult = 'written' | 'skipped';

export interface FlatWriter {
  write(resource: unknown, provenance?: Provenance): Promise<WriteResult>;
}

export function createFlatWriter(db: Kysely<ExternalSchema>): FlatWriter {
  return {
    async write(resource, provenance = {}) {
      const flat = flattenResource(resource, provenance);
      if (!flat) return 'skipped';
      const { table, row } = flat;
      const updateRow = { ...row };
      delete (updateRow as Record<string, unknown>).id;
      await (db as unknown as Kysely<any>)
        .insertInto(table)
        .values(row)
        .onConflict((oc) => oc.column('id').doUpdateSet(updateRow))
        .execute();
      return 'written';
    },
  };
}
