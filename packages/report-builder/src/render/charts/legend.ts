export interface LegendOpts { x: number; y: number; swatch: number; lineHeight: number }
export interface LegendItem { label: string; y: number; swatchX: number; labelX: number; swatch: number }

/** Vertical legend: one row per series, swatch left, label right, rows spaced by lineHeight. */
export function layoutLegend(series: string[], opts: LegendOpts): LegendItem[] {
  return series.map((label, i) => ({
    label,
    y: opts.y + i * opts.lineHeight,
    swatchX: opts.x,
    labelX: opts.x + opts.swatch + 6,
    swatch: opts.swatch,
  }));
}
