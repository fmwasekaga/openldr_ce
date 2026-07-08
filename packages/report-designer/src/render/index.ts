import PDFDocument from 'pdfkit';
import type { ReportDesign } from '../schema';
import { paperSizePt } from './units';
import { drawElement, paramMap } from './draw';

export type ResolvedTable =
  | { columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }
  | { error: string };

export interface RenderOptions { now?: Date }

export function renderReportDesignPdf(
  design: ReportDesign,
  resolved: Map<string, ResolvedTable>,
  opts: RenderOptions = {},
): Promise<Buffer> {
  const now = opts.now ?? new Date();
  const tokens = paramMap(design, now);
  const pages = design.pages.length ? design.pages : [{ id: '_empty', elements: [] }];
  const [w, h] = paperSizePt(design.paper, design.orientation);

  const doc = new PDFDocument({ size: [w, h], margin: 0, autoFirstPage: false });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  for (const page of pages) {
    doc.addPage({ size: [w, h], margin: 0 });
    for (const el of page.elements) drawElement(doc, el, tokens, resolved.get(el.id));
  }
  doc.end();
  return done;
}
