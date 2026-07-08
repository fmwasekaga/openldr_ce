import { describe, it, expect } from 'vitest';
import { newElement, addElement, reportsOnPage, paperSize, findElement, allElements, updateElementRects, removeElements } from './model';
import { MOCK_TEMPLATES } from './mockTemplates';
import type { ReportTemplate } from './types';

describe('report-designer model', () => {
  it('newElement produces a text element with default content', () => {
    const el = newElement('text');
    expect(el.kind).toBe('text');
    expect(el.text).toBe('Text');
    expect(el.rect).toEqual({ x: 48, y: 48, w: 200, h: 80 });
  });

  it('newElement produces a table with columns and sample rows', () => {
    const el = newElement('table');
    expect(el.kind).toBe('table');
    expect(el.columns?.length).toBe(2);
    expect((el.rows ?? []).length).toBeGreaterThan(0);
  });

  it('addElement appends to the given page immutably', () => {
    const tpl: ReportTemplate = { id: 't', name: 'x', paper: 'A4', orientation: 'portrait', pages: [{ id: 'p1', elements: [] }], parameters: [] };
    const next = addElement(tpl, 0, newElement('text'));
    expect(next.pages[0].elements).toHaveLength(1);
    expect(tpl.pages[0].elements).toHaveLength(0);
  });

  it('reportsOnPage returns distinct bound reports from table elements', () => {
    const tpl = MOCK_TEMPLATES[0];
    const reports = reportsOnPage(tpl.pages[0]);
    expect(reports).toContain('AMR resistance');
    expect(new Set(reports).size).toBe(reports.length);
  });

  it('paperSize swaps width/height for landscape', () => {
    const p = paperSize('A4', 'portrait');
    const l = paperSize('A4', 'landscape');
    expect(l.w).toBe(p.h);
    expect(l.h).toBe(p.w);
  });

  it('findElement locates an element by id across pages', () => {
    const tpl = MOCK_TEMPLATES[0];
    const id = tpl.pages[0].elements[0].id;
    expect(findElement(tpl, id)?.id).toBe(id);
    expect(findElement(tpl, 'nope')).toBeNull();
  });

  it('MOCK_TEMPLATES seeds at least three templates', () => {
    expect(MOCK_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    expect(MOCK_TEMPLATES[0].pages.length).toBeGreaterThan(0);
  });

  it('allElements flattens across pages', () => {
    expect(allElements(MOCK_TEMPLATES[0]).length).toBe(
      MOCK_TEMPLATES[0].pages.reduce((n, p) => n + p.elements.length, 0),
    );
  });

  it('updateElementRects replaces only the given rects, immutably', () => {
    const tpl = MOCK_TEMPLATES[0];
    const id = tpl.pages[0].elements[0].id;
    const next = updateElementRects(tpl, new Map([[id, { x: 1, y: 2, w: 3, h: 4 }]]));
    expect(next.pages[0].elements[0].rect).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(tpl.pages[0].elements[0].rect).not.toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it('removeElements drops the given ids', () => {
    const tpl = MOCK_TEMPLATES[0];
    const id = tpl.pages[0].elements[0].id;
    const next = removeElements(tpl, new Set([id]));
    expect(allElements(next).some((e) => e.id === id)).toBe(false);
  });
});
