import { parseBlocks } from './docModel';
import { resolveImg } from '../screenshots';

async function imageBytes(src: string): Promise<Uint8Array | null> {
  const url = resolveImg(src);
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** Read intrinsic pixel dimensions from a PNG's IHDR header; null if not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  // PNG signature check
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return null;
  const be = (o: number) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  const width = be(16);
  const height = be(20);
  if (!width || !height) return null;
  return { width, height };
}

/** Render a markdown document to a .docx Blob. `docx` is imported on demand. */
export async function renderDocx(title: string, markdown: string): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun } = await import('docx');
  const headingFor = (lvl: number) =>
    lvl <= 1 ? HeadingLevel.HEADING_1 : lvl === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;

  const children: object[] = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] })];

  for (const b of parseBlocks(markdown)) {
    if (b.type === 'heading') {
      children.push(new Paragraph({ heading: headingFor(b.level), children: [new TextRun(b.text)] }));
    } else if (b.type === 'paragraph') {
      children.push(new Paragraph({ children: [new TextRun(b.text)] }));
    } else if (b.type === 'list') {
      for (const it of b.items) children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(it)] }));
    } else if (b.type === 'code') {
      for (const ln of b.text.split('\n')) {
        children.push(new Paragraph({ children: [new TextRun({ text: ln, font: 'Courier New', size: 18 })] }));
      }
    } else if (b.type === 'blockquote') {
      children.push(new Paragraph({ children: [new TextRun({ text: b.text, italics: true })] }));
    } else if (b.type === 'image') {
      const bytes = await imageBytes(b.src);
      if (bytes) {
        const size = pngSize(bytes);
        const maxW = 480;
        const width = size ? Math.min(maxW, size.width) : maxW;
        const height = size ? Math.round((size.height / size.width) * width) : 300;
        children.push(new Paragraph({
          children: [new ImageRun({ type: 'png', data: bytes, transformation: { width, height } })],
        }));
      } else {
        children.push(new Paragraph({ children: [new TextRun({ text: `[Screenshot: ${b.alt}]`, italics: true })] }));
      }
    }
  }

  const doc = new Document({ sections: [{ children: children as never }] });
  return Packer.toBlob(doc);
}
