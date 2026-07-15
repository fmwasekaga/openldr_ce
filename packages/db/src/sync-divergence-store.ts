import type { Kysely, Transaction } from 'kysely';
import type { InternalSchema } from './schema/internal';

// Distributed sync S7: same-version divergence records (migration 056).
//
// TWO shapes, deliberately, in ONE module so the column knowledge lives in one place:
//  - recordDivergence(trx, …) takes the CALLER'S transaction, because applyRemote must write the row
//    in the SAME txn as the skip that caused it (atomic: a crash can never leave a dropped edit with
//    no trace — the exact failure this slice exists to prevent).
//  - createSyncDivergenceStore(db) serves the operator read/clear paths.

export interface SyncDivergenceRow {
  resourceType: string;
  resourceId: string;
  version: number;
  /** Canonical hash of the body we KEPT. null = the local side was a tombstone. */
  localHash: string | null;
  /** Canonical hash of the body we DROPPED. null = the incoming side was a tombstone. */
  incomingHash: string | null;
  /** The dropped content (PHI). null = the incoming side was a tombstone. */
  incomingBody: unknown | null;
  incomingSiteId: string;
  detectedAt: Date;
}

/** The PHI-free projection served by the list endpoint / CLI. Deliberately omits incomingBody. */
export type SyncDivergenceSummary = Omit<SyncDivergenceRow, 'incomingBody'>;

export interface RecordDivergenceInput {
  resourceType: string;
  resourceId: string;
  version: number;
  localHash: string | null;
  incomingHash: string | null;
  incomingBody: unknown | null;
  incomingSiteId: string;
}

export interface SyncDivergenceStore {
  list(): Promise<SyncDivergenceSummary[]>;
  get(resourceType: string, resourceId: string, version: number): Promise<SyncDivergenceRow | undefined>;
  clear(resourceType: string, resourceId: string, version: number): Promise<void>;
}

function toRow(r: {
  resource_type: string; resource_id: string; version: number | string;
  local_hash: string | null; incoming_hash: string | null; incoming_body?: unknown;
  incoming_site_id: string; detected_at: Date;
}): SyncDivergenceRow {
  return {
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    // bigint reads back as string on real pg, number on pg-mem — always coerce.
    version: Number(r.version),
    localHash: r.local_hash,
    incomingHash: r.incoming_hash,
    // jsonb reads back parsed on pg; a driver that hands it over as text is normalized here.
    incomingBody: typeof r.incoming_body === 'string' ? JSON.parse(r.incoming_body) : (r.incoming_body ?? null),
    incomingSiteId: r.incoming_site_id,
    detectedAt: r.detected_at,
  };
}

/**
 * Record a same-version divergence inside the CALLER'S transaction.
 *
 * onConflict doNothing: re-delivery of the same diverged record must neither insert a duplicate nor
 * churn detected_at — the FIRST detection is the fact worth keeping, and a stuck redelivery loop must
 * not be able to inflate the table.
 */
export async function recordDivergence(
  trx: Transaction<InternalSchema> | Kysely<InternalSchema>,
  input: RecordDivergenceInput,
): Promise<void> {
  await trx
    .insertInto('sync_divergences')
    .values({
      resource_type: input.resourceType,
      resource_id: input.resourceId,
      version: input.version,
      local_hash: input.localHash,
      incoming_hash: input.incomingHash,
      // jsonb is written as text (the repo idiom — see dashboards.layout/widgets); null stays null.
      incoming_body: input.incomingBody == null ? null : JSON.stringify(input.incomingBody),
      incoming_site_id: input.incomingSiteId,
    })
    .onConflict((oc) => oc.columns(['resource_type', 'resource_id', 'version']).doNothing())
    .execute();
}

export function createSyncDivergenceStore(db: Kysely<InternalSchema>): SyncDivergenceStore {
  return {
    async list(): Promise<SyncDivergenceSummary[]> {
      const rows = await db
        .selectFrom('sync_divergences')
        // PHI-free by CONSTRUCTION: incoming_body is not selected. Do not add it here — the list
        // surface is the one a UI or a bored admin lands on. Body requires the explicit get().
        .select(['resource_type', 'resource_id', 'version', 'local_hash', 'incoming_hash', 'incoming_site_id', 'detected_at'])
        // version desc is the tiebreaker: rows detected in the same transaction/tick share detected_at.
        .orderBy('detected_at', 'desc')
        .orderBy('version', 'desc')
        .execute();
      // Reuse toRow rather than re-hand-mapping the columns: the coercion rules (bigint, jsonb) live in
      // ONE place. The selected row has no incoming_body — toRow maps that to null, and we drop it here.
      return rows.map((r) => {
        const { incomingBody: _drop, ...summary } = toRow(r);
        return summary;
      });
    },
    async get(resourceType, resourceId, version) {
      const row = await db
        .selectFrom('sync_divergences')
        .selectAll()
        .where('resource_type', '=', resourceType)
        .where('resource_id', '=', resourceId)
        .where('version', '=', version)
        .executeTakeFirst();
      return row ? toRow(row) : undefined;
    },
    async clear(resourceType, resourceId, version) {
      await db
        .deleteFrom('sync_divergences')
        .where('resource_type', '=', resourceType)
        .where('resource_id', '=', resourceId)
        .where('version', '=', version)
        .execute();
    },
  };
}
