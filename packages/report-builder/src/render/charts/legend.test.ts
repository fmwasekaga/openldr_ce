import { describe, it, expect } from 'vitest';
import { layoutLegend } from './legend';

describe('layoutLegend', () => {
  it('positions one entry per series with a swatch and non-overlapping y', () => {
    const items = layoutLegend(['A', 'B', 'C'], { x: 10, y: 20, swatch: 8, lineHeight: 14 });
    expect(items.length).toBe(3);
    expect(items[0].label).toBe('A');
    expect(items[0].y).toBe(20);
    expect(items[1].y).toBe(34);
    expect(items[0].swatchX).toBe(10);
    expect(items[0].labelX).toBeGreaterThan(items[0].swatchX);
  });
});
