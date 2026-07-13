import { describe, expect, it } from 'vitest';
import { planProjection, type ChangeRow } from './plan';

const row = (seq: number, xid: number, id: string, op = 'upsert'): ChangeRow => ({ seq, xid, resource_type: 'Patient', resource_id: id, op });

describe('planProjection', () => {
  it('all safe, no gaps: projects distinct keys, advances to max seq', () => {
    const out = planProjection({ rows: [row(1, 10, 'p1'), row(2, 10, 'p2'), row(3, 11, 'p1')], boundary: 100, xmax: 200, cursor: 0, pendingGaps: [] });
    expect(out.newCursor).toBe(3);
    expect(out.tasks.map((t) => t.id).sort()).toEqual(['p1', 'p2']);
    expect(out.pendingGaps).toEqual([]);
  });

  it('a visible unsafe row blocks; safe rows below it still project', () => {
    const out = planProjection({ rows: [row(1, 10, 'p1'), row(2, 250, 'p2'), row(3, 11, 'p3')], boundary: 200, xmax: 300, cursor: 0, pendingGaps: [] });
    expect(out.newCursor).toBe(1);
    expect(out.tasks.map((t) => t.id)).toEqual(['p1']);
    expect(out.pendingGaps).toEqual([]);
  });

  it('does NOT advance past an invisible in-flight gap below an unsafe row (the acceptance-test bug)', () => {
    // seq6 held uncommitted → invisible (absent). seq7 committed but unsafe (xid >= boundary).
    const out = planProjection({ rows: [row(5, 100, 'p5'), row(7, 250, 'p7')], boundary: 200, xmax: 300, cursor: 4, pendingGaps: [] });
    expect(out.newCursor).toBe(5); // stops before the gap at 6 — NOT firstUnsafe-1 = 6
    expect(out.tasks.map((t) => t.id)).toEqual(['p5']);
    expect(out.pendingGaps).toEqual([{ seq: 6, x0: 300 }]);
  });

  it('a freshly-observed gap blocks and records x0 (cannot be instantly confirmed)', () => {
    const out = planProjection({ rows: [row(7, 120, 'p7')], boundary: 150, xmax: 200, cursor: 5, pendingGaps: [] });
    expect(out.newCursor).toBe(5); // gap at 6 blocks (x0=200 > boundary 150)
    expect(out.tasks).toEqual([]);
    expect(out.pendingGaps).toEqual([{ seq: 6, x0: 200 }]);
  });

  it('advances past a gap once confirmed rolled back (boundary >= recorded x0)', () => {
    const out = planProjection({ rows: [row(7, 120, 'p7')], boundary: 150, xmax: 200, cursor: 5, pendingGaps: [{ seq: 6, x0: 100 }] });
    expect(out.newCursor).toBe(7); // gap 6 confirmed aborted (100 <= 150) → skipped
    expect(out.tasks.map((t) => t.id)).toEqual(['p7']);
    expect(out.pendingGaps).toEqual([]);
  });

  it('projects a gap once it becomes visible (committed) and clears it from pending', () => {
    const out = planProjection({ rows: [row(6, 120, 'p6'), row(7, 130, 'p7')], boundary: 150, xmax: 200, cursor: 5, pendingGaps: [{ seq: 6, x0: 200 }] });
    expect(out.newCursor).toBe(7);
    expect(out.tasks.map((t) => t.id).sort()).toEqual(['p6', 'p7']);
    expect(out.pendingGaps).toEqual([]);
  });

  it('no visible rows: cursor unchanged, pending gaps ahead of cursor retained', () => {
    const out = planProjection({ rows: [], boundary: 100, xmax: 200, cursor: 5, pendingGaps: [{ seq: 6, x0: 200 }] });
    expect(out).toEqual({ tasks: [], newCursor: 5, pendingGaps: [{ seq: 6, x0: 200 }] });
  });
});
