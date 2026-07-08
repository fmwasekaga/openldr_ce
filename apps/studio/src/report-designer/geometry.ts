import type { DesignElement, Rect } from './types';

export interface Box { x: number; y: number; w: number; h: number; }
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function clampRectToPage(rect: Rect, page: { w: number; h: number }): Rect {
  const w = Math.min(rect.w, page.w);
  const h = Math.min(rect.h, page.h);
  return { w, h, x: Math.max(0, Math.min(rect.x, page.w - w)), y: Math.max(0, Math.min(rect.y, page.h - h)) };
}

/** Clamp a group move delta so the most-constrained member stays on the page. */
export function clampGroupDelta(rects: Rect[], dx: number, dy: number, page: { w: number; h: number }): { dx: number; dy: number } {
  let cdx = dx, cdy = dy;
  for (const r of rects) {
    cdx = Math.max(cdx, -r.x); cdx = Math.min(cdx, page.w - (r.x + r.w));
    cdy = Math.max(cdy, -r.y); cdy = Math.min(cdy, page.h - (r.y + r.h));
  }
  return { dx: cdx, dy: cdy };
}

export function boundingBox(rects: Rect[]): Box | null {
  if (rects.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function rectsIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function marqueeHits(marquee: Box, elements: DesignElement[]): string[] {
  return elements.filter((el) => rectsIntersect(marquee, el.rect)).map((el) => el.id);
}

/** Resize `rect` by dragging `handle` by (dx, dy) model px; opposite edge stays fixed; min-size floor. */
export function resizeRect(rect: Rect, handle: Handle, dx: number, dy: number, min = 8): Rect {
  let { x, y, w, h } = rect;
  const right = x + w, bottom = y + h;
  if (handle.includes('w')) { x = Math.min(x + dx, right - min); w = right - x; }
  if (handle.includes('e')) { w = Math.max(min, w + dx); }
  if (handle.includes('n')) { y = Math.min(y + dy, bottom - min); h = bottom - y; }
  if (handle.includes('s')) { h = Math.max(min, h + dy); }
  return { x, y, w, h };
}

export function boxFromPoints(ax: number, ay: number, bx: number, by: number): Box {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

/** Scale a group of rects proportionally about the anchor opposite `handle`; min-size floor + page-bound scale clamp. */
export function scaleGroup(base: Map<string, Rect>, bbox: Box, handle: Handle, dx: number, dy: number, page: { w: number; h: number }, min = 8): Map<string, Rect> {
  const rects = [...base.values()];
  let sx = 1, anchorX = bbox.x;
  if (handle.includes('e')) { anchorX = bbox.x; sx = (bbox.w + dx) / bbox.w; }
  else if (handle.includes('w')) { anchorX = bbox.x + bbox.w; sx = (bbox.w - dx) / bbox.w; }
  let sy = 1, anchorY = bbox.y;
  if (handle.includes('s')) { anchorY = bbox.y; sy = (bbox.h + dy) / bbox.h; }
  else if (handle.includes('n')) { anchorY = bbox.y + bbox.h; sy = (bbox.h - dy) / bbox.h; }

  if (handle.includes('e') || handle.includes('w')) {
    const minW = Math.min(...rects.map((r) => r.w));
    sx = Math.max(sx, min / minW);
    sx = Math.min(sx, handle.includes('e') ? (page.w - anchorX) / bbox.w : anchorX / bbox.w);
  }
  if (handle.includes('s') || handle.includes('n')) {
    const minH = Math.min(...rects.map((r) => r.h));
    sy = Math.max(sy, min / minH);
    sy = Math.min(sy, handle.includes('s') ? (page.h - anchorY) / bbox.h : anchorY / bbox.h);
  }

  const out = new Map<string, Rect>();
  for (const [id, r] of base) {
    out.set(id, { x: anchorX + (r.x - anchorX) * sx, y: anchorY + (r.y - anchorY) * sy, w: r.w * sx, h: r.h * sy });
  }
  return out;
}
