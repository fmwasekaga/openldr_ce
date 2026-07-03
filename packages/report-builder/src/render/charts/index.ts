import { linearScale, niceTicks } from './scale';
import { layoutLegend } from './legend';
import type { ChartData, ChartSeries } from '../chart-data';
export type { ChartData, ChartSeries };

export interface ChartVisual { color?: string; secondaryColor?: string; showLegend?: boolean }

export type ChartKind = 'bar' | 'line' | 'pie';
const PALETTE = ['#378ADD', '#1D9E75', '#D85A30', '#7F77DD', '#EF9F27', '#D4537E'];
const AXIS = '#999';
const GRID = '#e5e5e5';
const TITLE_H = 16;
const LEGEND_W = 90;

interface Box { x: number; y: number; w: number; h: number }

function seriesColor(v: ChartVisual, i: number): string {
  if (i === 0 && v.color) return v.color;
  if (i === 1 && v.secondaryColor) return v.secondaryColor;
  return PALETTE[i % PALETTE.length];
}

function drawTitle(doc: PDFKit.PDFDocument, box: Box, title: string): void {
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#222').text(title, box.x, box.y, { width: box.w, ellipsis: true });
}

function maxValue(d: ChartData): number {
  let mx = 0;
  for (const s of d.series) for (const v of s.values) mx = Math.max(mx, v);
  return mx;
}

function drawAxes(doc: PDFKit.PDFDocument, plot: Box, max: number): (v: number) => number {
  const y = linearScale(0, max || 1, plot.y + plot.h, plot.y);
  const ticks = niceTicks(0, max || 1, 4);
  doc.fontSize(7).fillColor('#666').font('Helvetica');
  for (const t of ticks) {
    const yy = y(t);
    doc.moveTo(plot.x, yy).lineTo(plot.x + plot.w, yy).strokeColor(GRID).lineWidth(0.5).stroke();
    doc.fillColor('#666').text(String(t), plot.x - 26, yy - 3, { width: 24, align: 'right' });
  }
  doc.moveTo(plot.x, plot.y).lineTo(plot.x, plot.y + plot.h).strokeColor(AXIS).lineWidth(0.75).stroke();
  doc.moveTo(plot.x, plot.y + plot.h).lineTo(plot.x + plot.w, plot.y + plot.h).strokeColor(AXIS).stroke();
  return y;
}

function drawLegend(doc: PDFKit.PDFDocument, box: Box, d: ChartData, v: ChartVisual): void {
  const items = layoutLegend(d.series.map((s) => s.name), { x: box.x + box.w - LEGEND_W + 8, y: box.y + TITLE_H + 4, swatch: 8, lineHeight: 14 });
  items.forEach((it, i) => {
    doc.rect(it.swatchX, it.y, it.swatch, it.swatch).fill(seriesColor(v, i));
    doc.fillColor('#333').font('Helvetica').fontSize(8).text(it.label, it.labelX, it.y - 1, { width: LEGEND_W - 20, ellipsis: true });
  });
}

function plotArea(box: Box, hasLegend: boolean): Box {
  return { x: box.x + 30, y: box.y + TITLE_H + 6, w: box.w - 30 - (hasLegend ? LEGEND_W : 8), h: box.h - TITLE_H - 24 };
}

function drawBar(doc: PDFKit.PDFDocument, box: Box, d: ChartData, v: ChartVisual): void {
  const hasLegend = v.showLegend !== false && d.series.length > 1;
  const plot = plotArea(box, hasLegend);
  const max = maxValue(d);
  const y = drawAxes(doc, plot, max);
  const n = d.categories.length || 1;
  const groupW = plot.w / n;
  const barW = (groupW * 0.7) / Math.max(1, d.series.length);
  d.categories.forEach((cat, ci) => {
    const gx = plot.x + ci * groupW + groupW * 0.15;
    d.series.forEach((s, si) => {
      const val = s.values[ci] ?? 0;
      const top = y(val);
      doc.rect(gx + si * barW, top, barW - 1, plot.y + plot.h - top).fill(seriesColor(v, si));
      doc.fillColor('#333').font('Helvetica').fontSize(6).text(String(val), gx + si * barW, top - 8, { width: barW, align: 'center' });
    });
    doc.fillColor('#555').fontSize(7).text(cat, plot.x + ci * groupW, plot.y + plot.h + 3, { width: groupW, align: 'center', ellipsis: true });
  });
  if (hasLegend) drawLegend(doc, box, d, v);
}

function drawLine(doc: PDFKit.PDFDocument, box: Box, d: ChartData, v: ChartVisual): void {
  const hasLegend = v.showLegend !== false && d.series.length > 1;
  const plot = plotArea(box, hasLegend);
  const max = maxValue(d);
  const y = drawAxes(doc, plot, max);
  const n = Math.max(1, d.categories.length - 1);
  const x = linearScale(0, n, plot.x, plot.x + plot.w);
  d.series.forEach((s, si) => {
    const col = seriesColor(v, si);
    s.values.forEach((val, i) => {
      const px = x(i), py = y(val);
      if (i === 0) doc.moveTo(px, py); else doc.lineTo(px, py);
    });
    doc.strokeColor(col).lineWidth(1.25).stroke();
    s.values.forEach((val, i) => doc.circle(x(i), y(val), 1.75).fill(col));
  });
  d.categories.forEach((cat, ci) =>
    doc.fillColor('#555').font('Helvetica').fontSize(7).text(cat, x(ci) - 20, plot.y + plot.h + 3, { width: 40, align: 'center', ellipsis: true }));
  if (hasLegend) drawLegend(doc, box, d, v);
}

function drawPie(doc: PDFKit.PDFDocument, box: Box, d: ChartData, v: ChartVisual): void {
  const plot = plotArea(box, true);
  const values = d.categories.map((_, i) => d.series[0]?.values[i] ?? 0);
  const total = values.reduce((s, n) => s + n, 0) || 1;
  const cx = plot.x + plot.w / 2, cy = plot.y + plot.h / 2, r = Math.min(plot.w, plot.h) / 2 - 4;
  let a0 = -Math.PI / 2;
  values.forEach((val, i) => {
    const a1 = a0 + (val / total) * Math.PI * 2;
    // pdfkit has no reliable `arc`; approximate each slice as a filled polygon fan.
    const steps = Math.max(2, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 48));
    doc.moveTo(cx, cy);
    for (let s = 0; s <= steps; s++) {
      const a = a0 + ((a1 - a0) * s) / steps;
      doc.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    doc.lineTo(cx, cy).fill(seriesColor(v, i));
    a0 = a1;
  });
  const legend = layoutLegend(d.categories, { x: box.x + box.w - LEGEND_W + 8, y: box.y + TITLE_H + 4, swatch: 8, lineHeight: 14 });
  legend.forEach((it, i) => {
    doc.rect(it.swatchX, it.y, it.swatch, it.swatch).fill(seriesColor(v, i));
    doc.fillColor('#333').font('Helvetica').fontSize(8).text(it.label, it.labelX, it.y - 1, { width: LEGEND_W - 20, ellipsis: true });
  });
}

function drawKpi(doc: PDFKit.PDFDocument, box: Box, d: ChartData): void {
  const value = d.series[0]?.values[0] ?? 0;
  doc.font('Helvetica-Bold').fontSize(24).fillColor('#111').text(String(value), box.x, box.y + box.h / 2 - 16, { width: box.w, align: 'center' });
}

export function drawChart(doc: PDFKit.PDFDocument, box: Box, kind: ChartKind | 'kpi', data: ChartData, visual: ChartVisual): void {
  drawTitle(doc, box, data.title);
  if (kind === 'kpi') { drawKpi(doc, box, data); return; }
  if (kind === 'pie') { drawPie(doc, box, data, visual); return; }
  if (kind === 'line') { drawLine(doc, box, data, visual); return; }
  drawBar(doc, box, data, visual);
}
