import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from '../schema/internal';
import type { ChangeRow } from './plan';

export interface SafeFetchResult {
  rows: ChangeRow[];
  boundary: number;
  xmax: number;
}

// Real-Postgres only: uses the system `xmin` column and snapshot functions (pg-mem cannot run these).
// xid wraparound (32-bit xmin vs 64-bit xid8) is an accepted limitation at these deployment scales.
export async function fetchSafeChangeRows(db: Kysely<InternalSchema>, cursor: number, limit: number): Promise<SafeFetchResult> {
  const b = await sql<{ boundary: string; xmax: string }>`
    select pg_snapshot_xmin(pg_current_snapshot())::text::bigint as boundary,
           pg_snapshot_xmax(pg_current_snapshot())::text::bigint as xmax
  `.execute(db);
  const boundary = Number(b.rows[0]?.boundary ?? 0);
  const xmax = Number(b.rows[0]?.xmax ?? 0);
  const r = await sql<{ seq: string; xid: string; resource_type: string; resource_id: string; op: string }>`
    select seq, xmin::text::bigint as xid, resource_type, resource_id, op
    from fhir.change_log
    where seq > ${cursor}
    order by seq asc
    limit ${limit}
  `.execute(db);
  const rows: ChangeRow[] = r.rows.map((x) => ({
    seq: Number(x.seq),
    xid: Number(x.xid),
    resource_type: x.resource_type,
    resource_id: x.resource_id,
    op: x.op,
  }));
  return { rows, boundary, xmax };
}
