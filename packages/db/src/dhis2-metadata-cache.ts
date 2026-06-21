import { type Kysely, sql } from 'kysely';
import type { TargetMetadata } from '@openldr/ports';
import type { InternalSchema } from './schema/internal';

const ROW_ID = 'latest';

export interface Dhis2MetadataCache {
  get(): Promise<{ metadata: TargetMetadata; pulledAt: string } | null>;
  save(metadata: TargetMetadata): Promise<void>;
}

export function createDhis2MetadataCache(db: Kysely<InternalSchema>): Dhis2MetadataCache {
  return {
    async get() {
      const row = await db
        .selectFrom('dhis2_metadata_cache')
        .select(['metadata', 'pulled_at'])
        .where('id', '=', ROW_ID)
        .executeTakeFirst();
      if (!row) return null;
      const pulledAt = row.pulled_at instanceof Date ? row.pulled_at.toISOString() : String(row.pulled_at);
      return { metadata: row.metadata as TargetMetadata, pulledAt };
    },
    async save(metadata) {
      await db
        .insertInto('dhis2_metadata_cache')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values({ id: ROW_ID, metadata: JSON.stringify(metadata) as any, pulled_at: sql`now()` as any })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            metadata: JSON.stringify(metadata) as any,
            pulled_at: sql`now()`,
          }),
        )
        .execute();
    },
  };
}
