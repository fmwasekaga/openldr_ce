import { describe, it, expect } from 'vitest';
import { createDomMeasurer } from './domMeasurer';

describe('domMeasurer', () => {
  it('returns a positive height and grows with more text (fallback path under jsdom)', () => {
    const m = createDomMeasurer();
    const one = m.measureText('short', {}, 400);
    const many = m.measureText('word '.repeat(300), {}, 120);
    expect(one).toBeGreaterThan(0);
    expect(many).toBeGreaterThan(one);
  });
  it('a bigger font size yields a taller single line', () => {
    const m = createDomMeasurer();
    expect(m.measureText('x', { fontSize: 24 }, 400)).toBeGreaterThan(m.measureText('x', { fontSize: 8 }, 400));
  });
  it('empty text still has one line of height', () => {
    const m = createDomMeasurer();
    expect(m.measureText('', { fontSize: 12 }, 400)).toBeGreaterThan(0);
  });
});
