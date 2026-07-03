import { describe, it, expect } from 'vitest';
import { computeLayout, toLayoutModel, type LayoutModel, type Measurer } from './layout';
import { createEmptyTemplate } from '../helpers';

// Deterministic fake measurer: height = number of \n-separated lines * lineHeight.
const fakeMeasurer: Measurer = {
  measureText: (text, style) => {
    const lh = (style.fontSize ?? 11) + 4;
    return Math.max(1, text.split('\n').length) * lh;
  },
};

const A4_PORTRAIT = { size: 'A4' as const, orientation: 'portrait' as const, margins: { top: 40, right: 40, bottom: 40, left: 40 } };

function model(rows: any[]): LayoutModel { return { page: A4_PORTRAIT, rows }; }

describe('computeLayout', () => {
  it('splits a row into cells by colSpan/12 across the usable width', () => {
    const boxes = computeLayout(model([
      { cells: [
        { kind: 'divider', colSpan: 6 },
        { kind: 'divider', colSpan: 6 },
      ] },
    ]), fakeMeasurer);
    // A4 width 595.28, margins 40+40 → usable 515.28; two 6-col cells ≈ half each.
    expect(boxes.length).toBe(2);
    expect(boxes[0].x).toBeCloseTo(40, 1);
    expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
    expect(boxes[0].w).toBeGreaterThan(240);
    expect(boxes[0].w).toBeLessThan(260);
    expect(boxes[0].page).toBe(1);
  });

  it('measures title/text height via the injected measurer and stacks rows downward', () => {
    const boxes = computeLayout(model([
      { cells: [{ kind: 'title', colSpan: 12, text: 'one line', style: { fontSize: 16 } }] },
      { cells: [{ kind: 'text', colSpan: 12, text: 'a\nb\nc', style: {} }] },
    ]), fakeMeasurer);
    expect(boxes[0].h).toBe(20);          // 1 line * (16+4)
    expect(boxes[1].h).toBe(45);          // 3 lines * (11+4)
    expect(boxes[1].y).toBeGreaterThan(boxes[0].y + boxes[0].h - 1);
  });

  it('gives a table a header + per-row height', () => {
    const boxes = computeLayout(model([
      { cells: [{ kind: 'table', colSpan: 12, rowCount: 3 }] },
    ]), fakeMeasurer);
    expect(boxes[0].h).toBe(18 + 3 * 16); // TABLE_HEADER_H + rows * TABLE_ROW_H
  });

  it('overflows onto a new page when content exceeds the usable height', () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ cells: [{ kind: 'kpi', colSpan: 12 }], _i: i }));
    const boxes = computeLayout(model(rows), fakeMeasurer);
    const pages = new Set(boxes.map((b) => b.page));
    expect(pages.size).toBeGreaterThan(1);
    expect(Math.max(...boxes.map((b) => b.page))).toBeGreaterThanOrEqual(2);
  });

  it('repeats header/footer rows on every page and reserves their space', () => {
    const rows: any[] = [{ repeat: 'header', cells: [{ kind: 'title', colSpan: 12, text: 'H', style: {} }] }];
    for (let i = 0; i < 60; i++) rows.push({ cells: [{ kind: 'kpi', colSpan: 12 }] });
    rows.push({ repeat: 'footer', cells: [{ kind: 'text', colSpan: 12, text: 'F', style: {} }] });
    const boxes = computeLayout(model(rows), fakeMeasurer);
    const pageCount = Math.max(...boxes.map((b) => b.page));
    expect(pageCount).toBeGreaterThanOrEqual(2);
    // one header box + one footer box per page
    expect(boxes.filter((b) => b.repeat === 'header').length).toBe(pageCount);
    expect(boxes.filter((b) => b.repeat === 'footer').length).toBe(pageCount);
    // a header box sits at the top margin on its page
    const h2 = boxes.find((b) => b.repeat === 'header' && b.page === 2)!;
    expect(h2.y).toBeCloseTo(40, 0);
  });

  it('forces a new page at a pageBreak block', () => {
    const boxes = computeLayout(model([
      { cells: [{ kind: 'kpi', colSpan: 12 }] },
      { cells: [{ kind: 'pageBreak', colSpan: 12 }] },
      { cells: [{ kind: 'kpi', colSpan: 12 }] },
    ]), fakeMeasurer);
    const kpis = boxes.filter((b) => b.kind === 'kpi');
    expect(kpis[0].page).toBe(1);
    expect(kpis[1].page).toBe(2);
  });
});

describe('toLayoutModel', () => {
  const primaryResult = { columns: [], rows: [{}, {}, {}], chart: { type: 'bar', x: 'l', y: 'v' }, meta: { generatedAt: 'n', rowCount: 3 } };

  it('interpolates title text and carries style + colSpan', () => {
    const t = createEmptyTemplate('rt', 'R');
    t.rows = [{ id: 'r', cells: [{ colSpan: 8, block: { kind: 'title', text: 'Hi {{param.who}}', style: { fontSize: 16 } } as any }] }];
    const lm = toLayoutModel({ template: t, params: { who: 'Ndola' }, cells: {} });
    expect(lm.rows[0].cells[0].text).toBe('Hi Ndola');
    expect(lm.rows[0].cells[0].style).toEqual({ fontSize: 16 });
    expect(lm.rows[0].cells[0].colSpan).toBe(8);
    expect(lm.page.size).toBe(t.page.size);
  });

  it('fills a primary-table rowCount from the primary dataset', () => {
    const t = createEmptyTemplate('rt', 'R');
    t.rows = [{ id: 'r', cells: [{ colSpan: 12, block: { kind: 'table', source: 'primary', columns: [] } as any }] }];
    const lm = toLayoutModel({ template: t, params: {}, primary: { result: primaryResult as any }, cells: {} });
    expect(lm.rows[0].cells[0].rowCount).toBe(3);
  });

  it('fills an inline-table rowCount from its own resolved cell', () => {
    const t = createEmptyTemplate('rt', 'R');
    const q = { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] };
    t.rows = [{ id: 'r', cells: [{ colSpan: 12, block: { kind: 'table', source: q, columns: [] } as any }] }];
    const lm = toLayoutModel({ template: t, params: {}, cells: { '0:0': { result: { ...primaryResult, rows: [{}, {}] } as any } } });
    expect(lm.rows[0].cells[0].rowCount).toBe(2);
  });

  it('carries repeat flags through', () => {
    const t = createEmptyTemplate('rt', 'R');
    t.rows = [{ id: 'r', repeat: 'header', cells: [{ colSpan: 12, block: { kind: 'text', text: 'x', style: {} } as any }] }];
    const lm = toLayoutModel({ template: t, params: {}, cells: {} });
    expect(lm.rows[0].repeat).toBe('header');
  });
});
