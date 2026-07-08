import type { DesignElement, Rect } from './types';
import type { Box, Handle } from './geometry';

export interface GuideLine { axis: 'x' | 'y'; pos: number; from: number; to: number; }
export interface Snap { dx: number; dy: number; lines: GuideLine[]; }

interface AxisCand { pos: number; lo: number; hi: number; }

export function axisCandidates(axis: 'x' | 'y', others: DesignElement[], page: { w: number; h: number }): AxisCand[] {
  const c: AxisCand[] = [];
  if (axis === 'x') {
    c.push({ pos: 0, lo: 0, hi: page.h }, { pos: page.w / 2, lo: 0, hi: page.h }, { pos: page.w, lo: 0, hi: page.h });
    for (const e of others) { const r = e.rect; c.push({ pos: r.x, lo: r.y, hi: r.y + r.h }, { pos: r.x + r.w / 2, lo: r.y, hi: r.y + r.h }, { pos: r.x + r.w, lo: r.y, hi: r.y + r.h }); }
  } else {
    c.push({ pos: 0, lo: 0, hi: page.w }, { pos: page.h / 2, lo: 0, hi: page.w }, { pos: page.h, lo: 0, hi: page.w });
    for (const e of others) { const r = e.rect; c.push({ pos: r.y, lo: r.x, hi: r.x + r.w }, { pos: r.y + r.h / 2, lo: r.x, hi: r.x + r.w }, { pos: r.y + r.h, lo: r.x, hi: r.x + r.w }); }
  }
  return c;
}

export function snapAxis(probes: number[], cands: AxisCand[], threshold: number): { delta: number; cand: AxisCand } | null {
  let best: { delta: number; cand: AxisCand; dist: number } | null = null;
  for (const p of probes) for (const cand of cands) {
    const delta = cand.pos - p; const dist = Math.abs(delta);
    if (dist <= threshold && (!best || dist < best.dist)) best = { delta, cand, dist };
  }
  return best ? { delta: best.delta, cand: best.cand } : null;
}

export function computeMoveGuides(box: Box, others: DesignElement[], page: { w: number; h: number }, threshold: number): Snap {
  const sx = snapAxis([box.x, box.x + box.w / 2, box.x + box.w], axisCandidates('x', others, page), threshold);
  const sy = snapAxis([box.y, box.y + box.h / 2, box.y + box.h], axisCandidates('y', others, page), threshold);
  const lines: GuideLine[] = [];
  if (sx) lines.push({ axis: 'x', pos: sx.cand.pos, from: sx.cand.lo, to: sx.cand.hi });
  if (sy) lines.push({ axis: 'y', pos: sy.cand.pos, from: sy.cand.lo, to: sy.cand.hi });
  return { dx: sx?.delta ?? 0, dy: sy?.delta ?? 0, lines };
}

export function computeResizeGuides(rect: Rect, handle: Handle, others: DesignElement[], page: { w: number; h: number }, threshold: number): Snap {
  const xProbes: number[] = []; const yProbes: number[] = [];
  if (handle.includes('w')) xProbes.push(rect.x);
  if (handle.includes('e')) xProbes.push(rect.x + rect.w);
  if (handle.includes('n')) yProbes.push(rect.y);
  if (handle.includes('s')) yProbes.push(rect.y + rect.h);
  const sx = xProbes.length ? snapAxis(xProbes, axisCandidates('x', others, page), threshold) : null;
  const sy = yProbes.length ? snapAxis(yProbes, axisCandidates('y', others, page), threshold) : null;
  const lines: GuideLine[] = [];
  if (sx) lines.push({ axis: 'x', pos: sx.cand.pos, from: sx.cand.lo, to: sx.cand.hi });
  if (sy) lines.push({ axis: 'y', pos: sy.cand.pos, from: sy.cand.lo, to: sy.cand.hi });
  return { dx: sx?.delta ?? 0, dy: sy?.delta ?? 0, lines };
}

/** Apply a resize snap delta to the moving edge(s) of `rect`. */
export function applyResizeSnap(rect: Rect, handle: Handle, snap: Snap): Rect {
  let { x, y, w, h } = rect;
  if (handle.includes('w')) { x += snap.dx; w -= snap.dx; }
  else if (handle.includes('e')) { w += snap.dx; }
  if (handle.includes('n')) { y += snap.dy; h -= snap.dy; }
  else if (handle.includes('s')) { h += snap.dy; }
  return { x, y, w, h };
}
