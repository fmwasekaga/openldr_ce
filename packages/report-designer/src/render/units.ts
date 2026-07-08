import type { Paper, Orientation, Rect } from '../schema';

export const PX_TO_PT = 72 / 96; // 0.75

const PORTRAIT_PT: Record<Paper, [number, number]> = {
  A4: [595.28, 841.89],
  Letter: [612, 792],
};

export function paperSizePt(paper: Paper, orientation: Orientation): [number, number] {
  const [w, h] = PORTRAIT_PT[paper];
  return orientation === 'landscape' ? [h, w] : [w, h];
}

export function toPt(r: Rect): Rect {
  return { x: r.x * PX_TO_PT, y: r.y * PX_TO_PT, w: r.w * PX_TO_PT, h: r.h * PX_TO_PT };
}
