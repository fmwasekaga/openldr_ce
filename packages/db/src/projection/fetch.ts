import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from '../schema/internal';
import type { ChangeRow } from './plan';

export interface SafeFetchResult {
  rows: ChangeRow[];
  boundary: number;
  xmax: number;
}

// Real-Postgres only: uses the system `xmin` column and snapshot functions (pg-mem cannot run these).
// CRITICAL: boundary, xmax, and the rows MUST be sampled in ONE consistent snapshot, else the
// safe-frontier's gap bound (x0 = xmax >= any gap txn's xid) breaks — a txn starting between two
// separate snapshots could grab a low seq (a gap) with xid >= xmax and be falsely confirmed rolled
// back, permanently skipping a committed change. A REPEATABLE READ transaction fixes the snapshot at
// its first query, so all three reads share it.
// xid wraparound (32-bit xmin vs 64-bit xid8) is an accepted limitation at these deployment scales.
export async function fetchSafeChangeRows(db: Kysely<InternalSchema>, cursor: number, limit: number): Promise<SafeFetchResult> {
  return db.transaction().setIsolationLevel('repeatable read').execute(async (trx) => {
    const b = await sql<{ boundary: string; xmax: string }>`
      select pg_snapshot_xmin(pg_current_snapshot())::text::bigint as boundary,
             pg_snapshot_xmax(pg_current_snapshot())::text::bigint as xmax
    `.execute(trx);
    const boundary = Number(b.rows[0]?.boundary ?? 0);
    const xmax = Number(b.rows[0]?.xmax ?? 0);
    const r = await sql<{ seq: string; xid: string; resource_type: string; resource_id: string; op: string }>`
      select seq, xmin::text::bigint as xid, resource_type, resource_id, op
      from fhir.change_log
      where seq > ${cursor}
      order by seq asc
      limit ${limit}
    `.execute(trx);
    const rows: ChangeRow[] = r.rows.map((x) => ({
      seq: Number(x.seq),
      xid: Number(x.xid),
      resource_type: x.resource_type,
      resource_id: x.resource_id,
      op: x.op,
    }));
    return { rows, boundary, xmax };
  });
}
