import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';

export type SyncDirection = 'push' | 'pull' | 'amend';
export type SyncActivityEventKind = 'synced' | 'failed' | 'quarantined' | 'diverged';

export interface SyncActivityInput {
  direction: SyncDirection;
  event: SyncActivityEventKind;
  records?: number;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface SyncActivityRow {
  id: string;
  occurredAt: string;
  direction: SyncDirection;
  event: SyncActivityEventKind;
  records: number;
  error: string | null;
  metadata: Record<string, unknown> | null;
}

export interface SyncActivityStore {
  record(input: SyncActivityInput): Promise<SyncActivityRow>;
  list(opts?: { direction?: SyncDirection; limit?: number }): Promise<SyncActivityRow[]>;
}

interface RawRow {
  id: string;
  occurred_at: unknown;
  direction: string;
  event: string;
  records: unknown;
  error: string | null;
  metadata: unknown;
}

// Real PG returns timestamptz as Date and jsonb as an object; pg-mem can hand back strings — coerce both
// (mirrors sync-divergence-store's toRow).
function toRow(r: RawRow): SyncActivityRow {
  return {
    id: r.id,
    occurredAt: new Date(r.occurred_at as string | number | Date).toISOString(),
    direction: r.direction as SyncDirection,
    event: r.event as SyncActivityEventKind,
    records: Number(r.records ?? 0),
    error: r.error ?? null,
    metadata:
      r.metadata == null
        ? null
        : ((typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) as Record<string, unknown>),
  };
}

/** A bounded, high-signal store of sync outcomes. `record` inserts one row then trims the table to the
 *  most-recent `retentionPerDirection` rows FOR THAT DIRECTION, so per-minute cycles can never grow it
 *  unbounded. Callers (the runners, via the tracker) decide WHEN to write — an idle cycle writes nothing. */
export function createSyncActivityStore(
  db: Kysely<InternalSchema>,
  opts: { retentionPerDirection?: number } = {},
): SyncActivityStore {
  const retention = Math.max(1, opts.retentionPerDirection ?? 200);
  return {
    async record(input) {
      const id = randomUUID();
      await db
        .insertInto('sync_activity')
        .values({
          id,
          direction: input.direction,
          event: input.event,
          records: input.records ?? 0,
          error: input.error ?? null,
          metadata: (input.metadata ?? null) as never,
        })
        .execute();
      // Trim-on-write. The just-inserted row is the newest, so it is always in `keep` → `keep` is never
      // empty and the `not in` is safe.
      const keep = await db
        .selectFrom('sync_activity')
        .select('id')
        .where('direction', '=', input.direction)
        .orderBy('occurred_at', 'desc')
        .orderBy('id', 'desc')
        .limit(retention)
        .execute();
      await db
        .deleteFrom('sync_activity')
        .where('direction', '=', input.direction)
        .where(
          'id',
          'not in',
          keep.map((k) => k.id),
        )
        .execute();
      const row = await db
        .selectFrom('sync_activity')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      return toRow(row as unknown as RawRow);
    },
    async list(o = {}) {
      let q = db.selectFrom('sync_activity').selectAll();
      if (o.direction) q = q.where('direction', '=', o.direction);
      const rows = await q.orderBy('occurred_at', 'desc').orderBy('id', 'desc').limit(o.limit ?? 100).execute();
      return rows.map((r) => toRow(r as unknown as RawRow));
    },
  };
}
