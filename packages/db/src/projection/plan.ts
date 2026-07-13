// Pure projection planning — no DB. Given the visible change_log rows (seq > cursor, ascending)
// plus the current xmin/xmax snapshot bounds and the carried-over pendingGaps, decide which
// resources to (re)project and how far the cursor may safely advance, never permanently skipping
// a row. A row is "safe" (committed, final) iff its inserting xid < boundary. An UNCOMMITTED row is
// invisible — a GAP; the cursor must stop before an in-flight gap. A gap is confirmed rolled back
// (skippable) once boundary >= the xmax recorded when the gap was first observed (x0): the gap's txn
// was assigned its xid before that observation (xid < x0), so once the oldest running txn is >= x0
// that txn has finished, and a still-missing seq will never commit.

export interface ChangeRow {
  seq: number;
  xid: number; // inserting transaction id (system xmin)
  resource_type: string;
  resource_id: string;
  op: string; // 'upsert' | 'delete' (a hint; projection reads current canonical state)
}

export interface ProjectionTask {
  resourceType: string;
  id: string;
}

// A gap observed but not yet resolved (filled or confirmed rolled back). x0 = pg_snapshot_xmax
// recorded when first seen — an upper bound on the gap txn's xid.
export interface Gap {
  seq: number;
  x0: number;
}

export interface PlanInput {
  rows: ChangeRow[]; // visible change_log rows, seq > cursor, ascending
  boundary: number; // pg_snapshot_xmin — oldest txn still running
  xmax: number; // pg_snapshot_xmax — first not-yet-assigned xid
  cursor: number;
  pendingGaps: Gap[]; // carried from the previous cycle
}

export interface ProjectionPlan {
  tasks: ProjectionTask[];
  newCursor: number;
  pendingGaps: Gap[]; // carry to the next cycle
}

export function planProjection(input: PlanInput): ProjectionPlan {
  const { rows, boundary, xmax, cursor, pendingGaps } = input;
  const gapMap = new Map<number, number>(pendingGaps.map((g) => [g.seq, g.x0]));

  if (rows.length === 0) {
    // Nothing visible above the cursor — can't resolve gaps or advance. Keep gaps still ahead.
    const kept = [...gapMap.entries()].filter(([s]) => s > cursor).map(([seq, x0]) => ({ seq, x0 }));
    return { tasks: [], newCursor: cursor, pendingGaps: kept };
  }

  const visible = new Map<number, ChangeRow>();
  for (const r of rows) visible.set(r.seq, r);
  const maxSeq = rows[rows.length - 1].seq;

  // Scan the contiguous integer range (cursor, maxSeq]; find the first blocking position. We do NOT
  // break early so every gap in the window gets its x0 stamped on first sight (a rolled-back region
  // then confirms together on a later cycle).
  let firstBlock: number | null = null;
  for (let s = cursor + 1; s <= maxSeq; s++) {
    const row = visible.get(s);
    if (row) {
      gapMap.delete(s); // a previously-pending gap has now committed (filled)
      if (row.xid >= boundary && firstBlock === null) firstBlock = s; // unsafe committed row: wait
    } else {
      let x0 = gapMap.get(s);
      if (x0 === undefined) {
        x0 = xmax;
        gapMap.set(s, x0); // first observation of this gap
      }
      const confirmedRolledBack = x0 <= boundary;
      if (!confirmedRolledBack && firstBlock === null) firstBlock = s;
    }
  }
  const newCursor = firstBlock !== null ? firstBlock - 1 : maxSeq;

  // Project distinct keys among SAFE visible rows we are advancing past (current-state projection).
  const byKey = new Map<string, ProjectionTask>();
  for (const r of rows) {
    if (r.seq <= newCursor && r.xid < boundary) {
      byKey.set(`${r.resource_type} ${r.resource_id}`, { resourceType: r.resource_type, id: r.resource_id });
    }
  }
  const tasks = [...byKey.values()];

  // Carry forward only gaps still ahead of the new cursor.
  const nextPending = [...gapMap.entries()].filter(([s]) => s > newCursor).map(([seq, x0]) => ({ seq, x0 }));
  return { tasks, newCursor, pendingGaps: nextPending };
}
