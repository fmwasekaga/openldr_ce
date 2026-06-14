import { parseBlocks } from './docModel';
import { resolveImg } from '../screenshots';

/** Fetch a resolved screenshot URL to a PNG data URL; null if unavailable. */
async function imageDataUrl(src: string): Promise<string | null> {
  const url = resolveImg(src);
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return `data:image/png;base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

/** Render a markdown document to a PDF Blob. `jspdf` is imported on demand. */
export async function renderPdf(title: string, markdown: string): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 48;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const maxW = pageW - margin * 2;
  let y = margin;

  const ensure = (h: number) => { if (y + h > pageH - margin) { doc.addPage(); y = margin; } };
  const wrapText = (s: string, size: number) => { doc.setFontSize(size); return doc.splitTextToSize(s, maxW) as string[]; };
  const writeLines = (lines: string[], size: number, lh: number) => {
    doc.setFontSize(size);
    for (const ln of lines) { ensure(lh); doc.text(ln, margin, y); y += lh; }
  };

  doc.setFont('helvetica', 'bold');
  writeLines(wrapText(title, 18), 18, 24);
  y += 6;
  doc.setFont('helvetica', 'normal');

  const blocks = parseBlocks(markdown);
  for (const b of blocks) {
    if (b.type === 'heading') {
      y += 8; doc.setFont('helvetica', 'bold');
      const size = b.level <= 1 ? 16 : b.level === 2 ? 13 : 11;
      writeLines(wrapText(b.text, size), size, b.level <= 1 ? 22 : 18);
      doc.setFont('helvetica', 'normal');
    } else if (b.type === 'paragraph') {
      writeLines(wrapText(b.text, 11), 11, 15); y += 4;
    } else if (b.type === 'list') {
      for (const it of b.items) writeLines(wrapText(`•  ${it}`, 11), 11, 15);
      y += 4;
    } else if (b.type === 'code') {
      doc.setFont('courier', 'normal');
      writeLines(wrapText(b.text, 10), 10, 13);
      doc.setFont('helvetica', 'normal'); y += 4;
    } else if (b.type === 'blockquote') {
      doc.setFont('helvetica', 'italic');
      writeLines(wrapText(b.text, 11), 11, 15);
      doc.setFont('helvetica', 'normal'); y += 4;
    } else if (b.type === 'image') {
      const data = await imageDataUrl(b.src);
      if (data) {
        const props = doc.getImageProperties(data);
        const w = Math.min(maxW, props.width);
        const h = (props.height / props.width) * w;
        ensure(h); doc.addImage(data, 'PNG', margin, y, w, h); y += h + 8;
      } else {
        doc.setFont('helvetica', 'italic');
        writeLines(wrapText(`[Screenshot: ${b.alt}]`, 10), 10, 13);
        doc.setFont('helvetica', 'normal'); y += 4;
      }
    }
  }

  return doc.output('blob');
}
