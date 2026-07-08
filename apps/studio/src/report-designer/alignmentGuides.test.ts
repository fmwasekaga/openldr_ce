import { describe, it, expect } from 'vitest';
import { computeMoveGuides, computeResizeGuides, applyResizeSnap } from './alignmentGuides';
import type { DesignElement } from './types';

const PAGE = { w: 800, h: 1000 };
const el = (id: string, x: number, y: number, w = 50, h = 50): DesignElement => ({ id, kind: 'rect', name: id, rect: { x, y, w, h } });

describe('alignmentGuides', () => {
  it('snaps a move to a nearby element left edge and returns a guide line', () => {
    const others = [el('a', 100, 400)];
    const snap = computeMoveGuides({ x: 103, y: 10, w: 50, h: 50 }, others, PAGE, 6);
    expect(snap.dx).toBe(-3); // left edge 103 → 100
    expect(snap.lines.some((l) => l.axis === 'x' && l.pos === 100)).toBe(true);
  });

  it('snaps a move to the page horizontal center', () => {
    const snap = computeMoveGuides({ x: 372, y: 10, w: 50, h: 50 }, [], PAGE, 6);
    // box centerX 397 → page centerX 400
    expect(snap.dx).toBe(3);
  });

  it('does not snap when nothing is within the threshold', () => {
    const snap = computeMoveGuides({ x: 200, y: 200, w: 50, h: 50 }, [el('a', 100, 400)], PAGE, 6);
    expect(snap.dx).toBe(0);
    expect(snap.dy).toBe(0);
    expect(snap.lines).toHaveLength(0);
  });

  it('resize snap nudges only the dragged edge', () => {
    const others = [el('a', 300, 400)];
    // right edge at 297, snapping to a's left edge 300
    const rect = { x: 100, y: 100, w: 197, h: 100 };
    const snap = computeResizeGuides(rect, 'e', others, PAGE, 6);
    expect(snap.dx).toBe(3);
    const out = applyResizeSnap(rect, 'e', snap);
    expect(out).toEqual({ x: 100, y: 100, w: 200, h: 100 });
  });
});
