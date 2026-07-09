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

  it('round-trips the optional pageNumbers flag (default undefined)', () => {
    expect(ReportDesignSchema.parse({ id: 'd', name: 'N', pageNumbers: true }).pageNumbers).toBe(true);
    expect(ReportDesignSchema.parse({ id: 'd', name: 'N' }).pageNumbers).toBeUndefined();
  });
});

describe('ReportDesignSchema — data binding', () => {
  it('accepts a table dataSource + boundColumns', () => {
    const out = ReportDesignSchema.parse({
      id: 'd', name: 'N',
      pages: [{ id: 'p', elements: [{
        id: 'e', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 100, h: 50 },
        dataSource: { kind: 'custom-query', queryId: 'cq_1' },
        boundColumns: [{ key: 'organism', label: 'Organism' }, { key: 'pct_r', label: '%R' }],
      }] }],
    });
    const el = out.pages[0].elements[0];
    expect(el.dataSource).toEqual({ kind: 'custom-query', queryId: 'cq_1' });
    expect(el.boundColumns).toEqual([{ key: 'organism', label: 'Organism' }, { key: 'pct_r', label: '%R' }]);
  });

  it('accepts a string param and a daterange param', () => {
    const out = ReportDesignSchema.parse({
      id: 'd', name: 'N',
      parameters: [
        { key: 'facility', label: 'Facility', type: 'text', value: 'HQ' },
        { key: 'range', label: 'Range', type: 'daterange', value: { from: '2026-01-01', to: '2026-06-30' } },
      ],
    });
    expect(out.parameters[0].value).toBe('HQ');
    expect(out.parameters[1].value).toEqual({ from: '2026-01-01', to: '2026-06-30' });
  });

  it('still accepts a bare {key,label,value} param (back-compat)', () => {
    const out = ReportDesignSchema.parse({ id: 'd', name: 'N', parameters: [{ key: 'k', label: 'L', value: 'v' }] });
    expect(out.parameters[0]).toMatchObject({ key: 'k', label: 'L', value: 'v' });
  });
});
