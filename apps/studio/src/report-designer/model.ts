import type { DesignElement, DesignPage, ElementKind, Orientation, Paper, Rect, ReportTemplate } from './types';

/** Paper sizes in CSS px at 96dpi, portrait. */
export const PAPER_PX: Record<Paper, { w: number; h: number }> = {
  A4: { w: 794, h: 1123 },
  Letter: { w: 816, h: 1056 },
};

export function paperSize(paper: Paper, orientation: Orientation): { w: number; h: number } {
  const b = PAPER_PX[paper];
  return orientation === 'landscape' ? { w: b.h, h: b.w } : b;
}

/** Insertable element kinds, in menu order. */
export const ELEMENT_KINDS: ElementKind[] = ['text', 'table', 'image', 'line', 'rect', 'datetime'];

let seq = 0;
export function newElementId(): string { seq += 1; return `el-${Date.now()}-${seq}`; }

const DEFAULT_NAME: Record<ElementKind, string> = {
  text: 'Text', table: 'Table', image: 'Image', line: 'Line', rect: 'Rectangle', datetime: 'Date/time',
};

export function newElement(kind: ElementKind): DesignElement {
  const id = newElementId();
  const name = DEFAULT_NAME[kind];
  if (kind === 'text') return { id, kind, name, rect: { x: 48, y: 48, w: 200, h: 80 }, text: 'Text' };
  if (kind === 'datetime') return { id, kind, name, rect: { x: 48, y: 48, w: 200, h: 80 }, text: '{{date}}' };
  if (kind === 'line') return { id, kind, name, rect: { x: 48, y: 48, w: 200, h: 2 } };
  if (kind === 'table') return {
    id, kind, name, rect: { x: 48, y: 48, w: 480, h: 160 },
    boundReport: '', columns: ['Column A', 'Column B'], rows: [['—', '—'], ['—', '—']],
  };
  return { id, kind, name, rect: { x: 48, y: 48, w: 200, h: 80 } };
}

export function addElement(tpl: ReportTemplate, pageIndex: number, el: DesignElement): ReportTemplate {
  const pages = tpl.pages.map((p, i) => (i === pageIndex ? { ...p, elements: [...p.elements, el] } : p));
  return { ...tpl, pages };
}

export function reportsOnPage(page: DesignPage): string[] {
  const set = new Set<string>();
  for (const el of page.elements) if (el.kind === 'table' && el.boundReport) set.add(el.boundReport);
  return [...set];
}

export function findElement(tpl: ReportTemplate, id: string | null): DesignElement | null {
  if (!id) return null;
  for (const p of tpl.pages) {
    const e = p.elements.find((x) => x.id === id);
    if (e) return e;
  }
  return null;
}

export function allElements(tpl: ReportTemplate): DesignElement[] {
  return tpl.pages.flatMap((p) => p.elements);
}

export function updateElementRects(tpl: ReportTemplate, rects: Map<string, Rect>): ReportTemplate {
  if (rects.size === 0) return tpl;
  return {
    ...tpl,
    pages: tpl.pages.map((p) => ({
      ...p,
      elements: p.elements.map((e) => (rects.has(e.id) ? { ...e, rect: rects.get(e.id)! } : e)),
    })),
  };
}

export function removeElements(tpl: ReportTemplate, ids: Set<string>): ReportTemplate {
  if (ids.size === 0) return tpl;
  return { ...tpl, pages: tpl.pages.map((p) => ({ ...p, elements: p.elements.filter((e) => !ids.has(e.id)) })) };
}
