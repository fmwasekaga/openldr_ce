import { describe, it, expect } from 'vitest';
import { ReportDesignSchema } from './schema';

describe('ReportDesignSchema', () => {
  it('round-trips a full design and strips unknown keys', () => {
    const d = {
      id: 'd1', name: 'Test', paper: 'A4', orientation: 'portrait',
      margins: { top: 10, right: 10, bottom: 10, left: 10 },
      parameters: [{ key: 'p', label: 'P', value: 'v' }],
      pages: [{ id: 'p1', elements: [
        { id: 'e1', kind: 'text', name: 'T', rect: { x: 1, y: 2, w: 3, h: 4 }, text: 'hi', style: { bold: true, fontSize: 14 } },
        { id: 'e2', kind: 'rect', name: 'R', rect: { x: 0, y: 0, w: 9, h: 9 }, style: { fill: '#f00', strokeWidth: 2 }, junk: 1 },
      ] }],
    };
    const out = ReportDesignSchema.parse(d);
    expect(out.pages[0].elements[0].style).toEqual({ bold: true, fontSize: 14 });
    expect((out.pages[0].elements[1] as Record<string, unknown>).junk).toBeUndefined();
  });

  it('applies defaults for paper/orientation/pages/parameters', () => {
    const out = ReportDesignSchema.parse({ id: 'd', name: 'N' });
    expect(out).toMatchObject({ paper: 'A4', orientation: 'portrait', pages: [], parameters: [] });
  });

  it('rejects a design with no name', () => {
    expect(ReportDesignSchema.safeParse({ id: 'd', name: '' }).success).toBe(false);
  });
});
