import type { BlockStyle, Measurer } from '@openldr/report-builder/pure';

const BASE = 11;
const LINE_FACTOR = 1.35;

// Average glyph width as a fraction of font size for Helvetica-ish fonts (fallback when no canvas).
const AVG_CHAR_W = 0.5;

export function createDomMeasurer(): Measurer {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  } catch { ctx = null; }

  const charsPerLine = (text: string, fontSize: number, maxWidth: number): number => {
    if (ctx) {
      ctx.font = `${fontSize}px Helvetica, Arial, sans-serif`;
      const w = ctx.measureText(text || ' ').width || 1;
      const avg = w / Math.max(1, (text || ' ').length);
      return Math.max(1, Math.floor(maxWidth / Math.max(1, avg)));
    }
    return Math.max(1, Math.floor(maxWidth / (fontSize * AVG_CHAR_W)));
  };

  return {
    measureText(text: string, style: BlockStyle, maxWidth: number): number {
      const fontSize = style.fontSize ?? BASE;
      const lineH = fontSize * LINE_FACTOR;
      const explicitLines = (text || '').split('\n');
      let total = 0;
      for (const line of explicitLines) {
        const cpl = charsPerLine(line || ' ', fontSize, maxWidth);
        total += Math.max(1, Math.ceil((line.length || 1) / cpl));
      }
      return Math.max(1, total) * lineH;
    },
  };
}
