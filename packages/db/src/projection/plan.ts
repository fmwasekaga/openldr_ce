// Pure projection planning — no DB. Given change_log rows fetched with seq > cursor (ascending)
// plus the current xmin boundary, decide which resources to (re)project and how far the cursor
// may safely advance. A row is "safe" (committed and final, no older txn still able to insert a
// lower seq) iff its inserting xid < boundary. The cursor stops just before the first still
// in-flight seq so an out-of-order lower-seq commit is deferred one cycle, never skipped.

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

export interface ProjectionPlan {
  tasks: ProjectionTask[];
  newCursor: number;
}

export function planProjection(rows: ChangeRow[], boundary: number, cursor: number): ProjectionPlan {
  let firstUnsafe = Infinity;
  for (const r of rows) {
    if (r.xid >= boundary && r.seq < firstUnsafe) firstUnsafe = r.seq;
  }
  const safe = rows.filter((r) => r.seq < firstUnsafe);
  // Dedupe by (resource_type, resource_id) — we project current canonical state, so one task per key.
  const byKey = new Map<string, ProjectionTask>();
  for (const r of safe) byKey.set(`${r.resource_type} ${r.resource_id}`, { resourceType: r.resource_type, id: r.resource_id });
  const tasks = [...byKey.values()];
  let newCursor = cursor;
  if (firstUnsafe !== Infinity) newCursor = firstUnsafe - 1;
  else if (rows.length > 0) newCursor = rows[rows.length - 1].seq;
  return { tasks, newCursor };
}
