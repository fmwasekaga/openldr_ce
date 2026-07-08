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
