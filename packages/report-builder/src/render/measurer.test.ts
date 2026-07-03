import { describe, it, expect } from 'vitest';
import PDFDocument from 'pdfkit';
import { pdfkitMeasurer } from './measurer';

describe('pdfkitMeasurer', () => {
  it('returns a positive height for a single line and a larger height for wrapped text', () => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const m = pdfkitMeasurer(doc);
    const one = m.measureText('short', {}, 400);
    const many = m.measureText('word '.repeat(200), {}, 120);
    expect(one).toBeGreaterThan(0);
    expect(many).toBeGreaterThan(one);
  });

  it('a larger font size yields a taller single line', () => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const m = pdfkitMeasurer(doc);
    expect(m.measureText('x', { fontSize: 24 }, 400)).toBeGreaterThan(m.measureText('x', { fontSize: 8 }, 400));
  });
});
