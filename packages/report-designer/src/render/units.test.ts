import { describe, it, expect } from 'vitest';
import { PX_TO_PT, toPt, paperSizePt } from './units';

describe('units', () => {
  it('converts px@96 to pt@72 (×0.75)', () => {
    expect(PX_TO_PT).toBeCloseTo(0.75);
    expect(toPt({ x: 100, y: 200, w: 40, h: 20 })).toEqual({ x: 75, y: 150, w: 30, h: 15 });
  });
  it('gives A4 portrait + Letter landscape point sizes', () => {
    expect(paperSizePt('A4', 'portrait')).toEqual([595.28, 841.89]);
    const [w, h] = paperSizePt('Letter', 'landscape');
    expect([w, h]).toEqual([792, 612]);
  });
});
