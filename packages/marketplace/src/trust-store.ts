import { type Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import type { TrustStore, PinnedPublisher } from './trust';

export function createTrustStore(db: Kysely<InternalSchema>): TrustStore {
  return {
    async get(publisherId): Promise<PinnedPublisher | undefined> {
      const row = await db.selectFrom('marketplace_publishers')
        .select(['key_fingerprint']).where('publisher_id', '=', publisherId).executeTakeFirst();
      return row ? { keyFingerprint: row.key_fingerprint } : undefined;
    },
    async pin({ publisherId, keyFingerprint, publisherName, approvedBy }) {
      await db.insertInto('marketplace_publishers')
        .values({ publisher_id: publisherId, key_fingerprint: keyFingerprint, publisher_name: publisherName, approved_by: approvedBy })
        .onConflict((oc) => oc.column('publisher_id').doUpdateSet({ key_fingerprint: keyFingerprint, publisher_name: publisherName, approved_by: approvedBy }))
        .execute();
    },
  };
}
