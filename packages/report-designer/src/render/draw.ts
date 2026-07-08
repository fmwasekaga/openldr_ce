import type { DesignElement, DesignPage, ReportDesign } from '../schema';
import { toPt, PX_TO_PT } from './units';
import type { ResolvedTable } from './index';

type Doc = PDFKit.PDFDocument;
type Box = { x: number; y: number; w: number; h: number };

const TEXT_COLOR = '#262626';
const LINE_COLOR = '#a3a3a3';
const RECT_BORDER = '#d4d4d4';
export const ROW_H = 16; // pt

export function paramMap(design: ReportDesign, now: Date): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of design.parameters) {
    if (typeof p.value === 'string') m.set(p.key, p.value);
    else if (p.value) { m.set('from', p.value.from); m.set('to', p.value.to); }
  }
  m.set('date', now.toLocaleDateString());
  return m;
}

export function interpolate(input: string, tokens: Map<string, string>): string {
  return input
    .replace(/\{\{\s*param\.([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k: string) => tokens.get(k) ?? '')
    .replace(/\{\{\s*date\s*\}\}/g, tokens.get('date') ?? '');
}

/** The projected body rows for a table element (bound → project columns from resolved.rows; static → el.rows; error/unresolved → []). */
export function rowsFor(el: DesignElement, resolved: ResolvedTable | undefined): string[][] {
  if (el.kind !== 'table') return [];
  if (el.dataSource) {
    if (!resolved || 'error' in resolved) return [];
    const cols = el.boundColumns && el.boundColumns.length ? el.boundColumns : resolved.columns;
    return resolved.rows.map((row) => cols.map((c) => String(row[c.key] ?? '')));
  }
  return el.rows ?? [];
}

/** How many physical pages this one table needs (repeat-page model). 1 for non-tables/errors/degenerate boxes. */
export function tableChunkCount(el: DesignElement, resolved: ResolvedTable | undefined): number {
  if (el.kind !== 'table') return 1;
  const maxRows = Math.floor((toPt(el.rect).h - ROW_H) / ROW_H);
  if (maxRows < 1) return 1;
  const rowCount = rowsFor(el, resolved).length;
  return Math.max(1, Math.ceil(rowCount / maxRows));
}

/** Physical pages needed for a design page = the largest table's chunk count (min 1). */
export function pageChunkCount(page: DesignPage, resolved: Map<string, ResolvedTable>): number {
  return Math.max(1, ...page.elements.map((el) => tableChunkCount(el, resolved.get(el.id))));
}

export function drawElement(
  doc: Doc, el: DesignElement, tokens: Map<string, string>, resolved: ResolvedTable | undefined, chunk = 0,
): void {
  const r = toPt(el.rect);
  const s = el.style ?? {};
  switch (el.kind) {
    case 'rect': {
      if (s.fill && s.fill !== 'none') doc.save().rect(r.x, r.y, r.w, r.h).fill(s.fill).restore();
      doc.save().lineWidth(s.strokeWidth ?? 1).strokeColor(s.strokeColor ?? RECT_BORDER)
        .rect(r.x, r.y, r.w, r.h).stroke().restore();
      return;
    }
    case 'line': {
      doc.save().lineWidth(s.strokeWidth ?? 1).strokeColor(s.strokeColor ?? LINE_COLOR)
        .moveTo(r.x, r.y).lineTo(r.x + r.w, r.y + r.h).stroke().restore();
      return;
    }
    case 'text':
    case 'datetime': {
      const raw = el.text ?? (el.kind === 'datetime' ? '{{date}}' : '');
      drawText(doc, interpolate(raw, tokens), r, s);
      return;
    }
    case 'image': {
      if (el.src) {
        doc.save();
        try { doc.image(el.src, r.x, r.y, { fit: [r.w, r.h] }); doc.restore(); return; }
        catch { doc.restore(); /* fall through to placeholder */ }
      }
      doc.save().lineWidth(1).strokeColor(RECT_BORDER).dash(3, { space: 2 })
        .rect(r.x, r.y, r.w, r.h).stroke().undash().restore();
      return;
    }
    case 'table': {
      drawTable(doc, el, r, resolved, chunk);
      return;
    }
  }
}

function drawText(doc: Doc, str: string, r: Box, s: DesignElement['style']): void {
  const st = s ?? {};
  doc.save()
    .font(st.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize((st.fontSize ?? 11) * PX_TO_PT) // element fontSize is px@96 too → to pt
    .fillColor(st.color ?? TEXT_COLOR)
    .text(str, r.x, r.y, { width: r.w, height: r.h, align: st.align ?? 'left', ellipsis: true });
  doc.restore();
}

function drawTable(doc: Doc, el: DesignElement, r: Box, resolved: ResolvedTable | undefined, chunk: number): void {
  if (el.dataSource && resolved && 'error' in resolved) { drawErrorPlaceholder(doc, r, resolved.error); return; }
  const headers = tableHeaders(el, resolved);
  const allRows = rowsFor(el, resolved);
  drawGrid(doc, r, headers, allRows, chunk);
}

function tableHeaders(el: DesignElement, resolved: ResolvedTable | undefined): string[] {
  if (!el.dataSource) return el.columns ?? [];
  const cols = el.boundColumns && el.boundColumns.length
    ? el.boundColumns
    : (resolved && !('error' in resolved) ? resolved.columns : []);
  return cols.map((c) => c.label);
}

function drawGrid(doc: Doc, r: Box, headers: string[], allRows: string[][], chunk: number): void {
  const n = Math.max(headers.length, 1);
  const colW = r.w / n;
  const maxRows = Math.floor((r.h - ROW_H) / ROW_H);
  const rows = maxRows >= 1 ? allRows.slice(chunk * maxRows, chunk * maxRows + maxRows) : [];
  doc.save().rect(r.x, r.y, r.w, r.h).clip();
  doc.rect(r.x, r.y, r.w, ROW_H).fill('#f5f5f5');
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#262626');
  headers.forEach((h, i) => doc.text(h, r.x + i * colW + 3, r.y + 4, { width: colW - 6, ellipsis: true }));
  doc.font('Helvetica').fontSize(8).fillColor('#404040');
  rows.forEach((row, ri) => {
    const y = r.y + ROW_H + ri * ROW_H;
    if (ri % 2 === 1) doc.rect(r.x, y, r.w, ROW_H).fill('#fafafa').fillColor('#404040');
    row.forEach((cell, ci) => doc.text(cell, r.x + ci * colW + 3, y + 4, { width: colW - 6, ellipsis: true }));
  });
  doc.restore();
}

function drawErrorPlaceholder(doc: Doc, r: Box, msg: string): void {
  doc.save().rect(r.x, r.y, r.w, r.h).fill('#fef2f2');
  doc.fillColor('#b91c1c').font('Helvetica').fontSize(8)
    .text(`Query error: ${msg}`, r.x + 4, r.y + 4, { width: r.w - 8, height: r.h - 8, ellipsis: true });
  doc.restore();
}
