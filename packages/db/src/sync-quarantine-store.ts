import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export interface SyncQuarantineRow {
  entityType: string;
  entityId: string;
  attempts: number;
  status: 'holding' | 'quarantined';
  lastError: string | null;
  lastSeq: number | null;
  /** The failing record's body — central's descriptor for the bulk entity. Replayed on a manual retry so
   *  the reconcile stamps the REAL identity/version/generation instead of an empty descriptor. */
  lastBody: unknown | null;
  firstFailedAt: Date;
  updatedAt: Date;
  quarantinedAt: Date | null;
}

export interface SyncQuarantineStore {
  recordFailure(
    entityType: string,
    entityId: string,
    opts: { seq: number; error: string; threshold: number; body?: unknown },
  ): Promise<{ attempts: number; status: 'holding' | 'quarantined' }>;
  clear(entityType: string, entityId: string): Promise<void>;
  list(): Promise<SyncQuarantineRow[]>;
  get(entityType: string, entityId: string): Promise<SyncQuarantineRow | undefined>;
}

function toRow(r: {
  entity_type: string; entity_id: string; attempts: number; status: string; last_error: string | null;
  last_seq: number | string | null; last_body?: unknown; first_failed_at: Date; updated_at: Date; quarantined_at: Date | null;
}): SyncQuarantineRow {
  return {
    entityType: r.entity_type, entityId: r.entity_id, attempts: Number(r.attempts),
    status: r.status === 'quarantined' ? 'quarantined' : 'holding',
    lastError: r.last_error, lastSeq: r.last_seq == null ? null : Number(r.last_seq),
    // jsonb reads back parsed on pg; a driver that hands it over as text is normalized here.
    lastBody: typeof r.last_body === 'string' ? JSON.parse(r.last_body) : (r.last_body ?? null),
    firstFailedAt: r.first_failed_at, updatedAt: r.updated_at, quarantinedAt: r.quarantined_at,
  };
}

export function createSyncQuarantineStore(db: Kysely<InternalSchema>): SyncQuarantineStore {
  return {
    async recordFailure(entityType, entityId, { seq, error, threshold, body }) {
      // Single-threaded pull runner → read-then-upsert is safe. attempts climbs monotonically; status
      // crosses to 'quarantined' at the threshold and stays there. quarantined_at is stamped ONCE (on the
      // first crossing) and preserved thereafter.
      const cur = await db.selectFrom('sync_quarantine').select(['attempts', 'quarantined_at'])
        .where('entity_type', '=', entityType).where('entity_id', '=', entityId).executeTakeFirst();
      const attempts = Number(cur?.attempts ?? 0) + 1;
      const status: 'holding' | 'quarantined' = attempts >= threshold ? 'quarantined' : 'holding';
      const quarantinedAt = status === 'quarantined' ? (cur?.quarantined_at ?? new Date()) : null;
      // jsonb is written as text (the repo idiom — see dashboards.layout/widgets); undefined → null.
      const lastBody = body === undefined ? null : JSON.stringify(body);
      await db.insertInto('sync_quarantine')
        .values({ entity_type: entityType, entity_id: entityId, attempts, status, last_error: error, last_seq: seq, last_body: lastBody, quarantined_at: quarantinedAt })
        .onConflict((oc) => oc.columns(['entity_type', 'entity_id']).doUpdateSet({
          attempts, status, last_error: error, last_seq: seq, last_body: lastBody, updated_at: sql`now()`, quarantined_at: quarantinedAt,
        }))
        .execute();
      return { attempts, status };
    },
    async clear(entityType, entityId) {
      await db.deleteFrom('sync_quarantine').where('entity_type', '=', entityType).where('entity_id', '=', entityId).execute();
    },
    async list() {
      const rows = await db.selectFrom('sync_quarantine').selectAll().orderBy('updated_at', 'desc').execute();
      return rows.map(toRow);
    },
    async get(entityType, entityId) {
      const r = await db.selectFrom('sync_quarantine').selectAll()
        .where('entity_type', '=', entityType).where('entity_id', '=', entityId).executeTakeFirst();
      return r ? toRow(r) : undefined;
    },
  };
}
