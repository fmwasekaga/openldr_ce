import { describe, it, expect } from 'vitest';
import PDFDocument from 'pdfkit';
import { drawChart, type ChartData } from './index';

// pdfkit is a Readable stream that emits chunks asynchronously — resolve on 'end'.
function render(fn: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  fn(doc);
  doc.end();
  return done;
}

const box = { x: 40, y: 40, w: 400, h: 200 };
const data: ChartData = { title: 'Resistance', categories: ['E. coli', 'K. pneu'], series: [{ name: '%R', values: [41, 52] }] };

describe('drawChart', () => {
  for (const kind of ['bar', 'line', 'pie', 'kpi'] as const) {
    it(`draws a ${kind} chart without throwing and emits a valid PDF`, async () => {
      const buf = await render((doc) => drawChart(doc, box, kind, data, {}));
      expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(buf.length).toBeGreaterThan(500);
    });
  }

  it('handles empty data without throwing', async () => {
    const buf = await render((doc) => drawChart(doc, box, 'bar', { title: 'Empty', categories: [], series: [] }, {}));
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
