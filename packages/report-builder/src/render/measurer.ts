import type { BlockStyle, Measurer } from './layout';

const BASE_FONT_SIZE = 11;

function fontName(style: BlockStyle): string {
  if (style.bold && style.italic) return 'Helvetica-BoldOblique';
  if (style.bold) return 'Helvetica-Bold';
  if (style.italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

/** A Measurer backed by a live pdfkit document (uses its font metrics + line wrapping). */
export function pdfkitMeasurer(doc: PDFKit.PDFDocument): Measurer {
  return {
    measureText(text, style, maxWidth) {
      doc.font(fontName(style)).fontSize(style.fontSize ?? BASE_FONT_SIZE);
      // heightOfString accounts for wrapping at the given width. Guard empty string to one line.
      return doc.heightOfString(text || ' ', { width: maxWidth });
    },
  };
}
