import { describe, it, expect } from 'vitest';
import { clampRectToPage, clampGroupDelta, boundingBox, rectsIntersect, marqueeHits, resizeRect, boxFromPoints } from './geometry';
import type { DesignElement } from './types';

const PAGE = { w: 800, h: 1000 };
const el = (id: string, x: number, y: number, w = 50, h = 50): DesignElement => ({ id, kind: 'rect', name: id, rect: { x, y, w, h } });

describe('geometry', () => {
  it('clampRectToPage keeps a rect inside the page', () => {
    expect(clampRectToPage({ x: -10, y: 5, w: 40, h: 40 }, PAGE)).toEqual({ x: 0, y: 5, w: 40, h: 40 });
    expect(clampRectToPage({ x: 790, y: 990, w: 40, h: 40 }, PAGE)).toEqual({ x: 760, y: 960, w: 40, h: 40 });
    expect(clampRectToPage({ x: 0, y: 0, w: 9999, h: 9999 }, PAGE)).toEqual({ x: 0, y: 0, w: 800, h: 1000 });
  });

  it('clampGroupDelta limits movement to the most-constrained member', () => {
    const rects = [{ x: 10, y: 10, w: 20, h: 20 }, { x: 700, y: 10, w: 20, h: 20 }];
    expect(clampGroupDelta(rects, -50, 0, PAGE)).toEqual({ dx: -10, dy: 0 }); // left member hits 0
    expect(clampGroupDelta(rects, 200, 0, PAGE)).toEqual({ dx: 80, dy: 0 });  // right member hits 800
  });

  it('boundingBox spans all rects', () => {
    expect(boundingBox([{ x: 10, y: 20, w: 30, h: 40 }, { x: 100, y: 5, w: 10, h: 10 }])).toEqual({ x: 10, y: 5, w: 100, h: 55 });
    expect(boundingBox([])).toBeNull();
  });

  it('rectsIntersect / marqueeHits find overlapping elements', () => {
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 10, h: 10 })).toBe(false);
    const els = [el('a', 0, 0), el('b', 500, 500)];
    expect(marqueeHits({ x: -5, y: -5, w: 60, h: 60 }, els)).toEqual(['a']);
  });

  it('resizeRect moves the dragged edge and honors the min floor', () => {
    expect(resizeRect({ x: 100, y: 100, w: 100, h: 100 }, 'se', 20, 30)).toEqual({ x: 100, y: 100, w: 120, h: 130 });
    expect(resizeRect({ x: 100, y: 100, w: 100, h: 100 }, 'nw', 20, 20)).toEqual({ x: 120, y: 120, w: 80, h: 80 });
    expect(resizeRect({ x: 100, y: 100, w: 100, h: 100 }, 'e', -200, 0)).toEqual({ x: 100, y: 100, w: 8, h: 100 });
    expect(resizeRect({ x: 100, y: 100, w: 100, h: 100 }, 'n', 0, 200)).toEqual({ x: 100, y: 192, w: 100, h: 8 });
  });

  it('boxFromPoints normalizes to a positive box', () => {
    expect(boxFromPoints(30, 40, 10, 10)).toEqual({ x: 10, y: 10, w: 20, h: 30 });
  });
});
