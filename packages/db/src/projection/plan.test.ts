import { describe, expect, it } from 'vitest';
import { planProjection, type ChangeRow } from './plan';

const row = (seq: number, xid: number, id: string, op = 'upsert'): ChangeRow => ({ seq, xid, resource_type: 'Patient', resource_id: id, op });

describe('planProjection', () => {
  it('all rows safe (xid < boundary): projects distinct keys, advances to max seq', () => {
    const rows = [row(1, 10, 'p1'), row(2, 10, 'p2'), row(3, 11, 'p1')];
    const plan = planProjection(rows, 20, 0);
    expect(plan.newCursor).toBe(3);
    expect(plan.tasks.map((t) => t.id).sort()).toEqual(['p1', 'p2']);
  });

  it('caps cursor at firstUnsafe-1 and skips unsafe rows (no permanent skip)', () => {
    const rows = [row(1, 10, 'p1'), row(2, 25, 'p2'), row(3, 11, 'p3')];
    const plan = planProjection(rows, 20, 0);
    expect(plan.newCursor).toBe(1);
    expect(plan.tasks.map((t) => t.id)).toEqual(['p1']);
  });

  it('no rows: cursor unchanged', () => {
    expect(planProjection([], 20, 5)).toEqual({ tasks: [], newCursor: 5 });
  });

  it('first row unsafe: nothing processed, cursor unchanged', () => {
    const plan = planProjection([row(6, 30, 'p1')], 20, 5);
    expect(plan).toEqual({ tasks: [], newCursor: 5 });
  });

  it('tolerates rollback gaps (missing seq) among safe rows', () => {
    const rows = [row(1, 10, 'p1'), row(3, 10, 'p2')];
    const plan = planProjection(rows, 20, 0);
    expect(plan.newCursor).toBe(3);
    expect(plan.tasks.map((t) => t.id).sort()).toEqual(['p1', 'p2']);
  });

  it('all rows unsafe: nothing processed, cursor unchanged', () => {
    const plan = planProjection([row(1, 30, 'p1'), row(2, 31, 'p2')], 20, 0);
    expect(plan).toEqual({ tasks: [], newCursor: 0 });
  });

  it('dedup respects the unsafe cutoff — a later safe row for the same key past firstUnsafe is excluded', () => {
    // p1 is safe at seq1, but also appears at seq3 which is AFTER the unsafe seq2. Only seq1 counts,
    // and the cursor stops at firstUnsafe-1 regardless of the later same-key row.
    const rows = [row(1, 10, 'p1'), row(2, 25, 'p2'), row(3, 10, 'p1')];
    const plan = planProjection(rows, 20, 0);
    expect(plan.tasks.map((t) => t.id)).toEqual(['p1']);
    expect(plan.newCursor).toBe(1);
  });
});
