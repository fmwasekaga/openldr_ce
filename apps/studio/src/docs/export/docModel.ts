export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; text: string }
  | { type: 'blockquote'; text: string }
  | { type: 'image'; src: string; alt: string };

/** Reduce inline markdown to plain text: keep link text, drop emphasis/code markers. */
export function inlineText(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')          // images removed inline
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')         // links -> text
    .replace(/[*_`~]/g, '')                          // emphasis / code / strike markers
    .replace(/\s+/g, ' ')
    .trim();
}

const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;

export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') { i++; continue; }

    // Fenced code
    if (/^```/.test(line.trim())) {
      i++;
      const code: string[] = [];
      while (i < lines.length && !/^```/.test(lines[i].trim())) { code.push(lines[i]); i++; }
      i++; // closing fence
      blocks.push({ type: 'code', text: code.join('\n').replace(/\n+$/, '') });
      continue;
    }

    // Image (standalone line)
    const img = line.match(IMAGE_LINE);
    if (img) {
      const src = (img[2].split('/').pop() ?? img[2]).trim();
      blocks.push({ type: 'image', src, alt: img[1].trim() });
      i++;
      continue;
    }

    // Heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length, text: inlineText(h[2]) });
      i++;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i++; }
      blocks.push({ type: 'blockquote', text: inlineText(quote.join(' ')) });
      continue;
    }

    // List (unordered or ordered)
    const ulMatch = /^[-*]\s+/.test(line);
    const olMatch = /^\d+\.\s+/.test(line);
    if (ulMatch || olMatch) {
      const ordered = olMatch;
      const items: string[] = [];
      const re = ordered ? /^\d+\.\s+(.*)$/ : /^[-*]\s+(.*)$/;
      const test = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;
      while (i < lines.length && test.test(lines[i])) {
        const m = lines[i].match(re);
        items.push(inlineText(m ? m[1] : lines[i]));
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // Paragraph (gather until blank line or next block starter)
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i].trim()) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !IMAGE_LINE.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', text: inlineText(para.join(' ')) });
  }

  return blocks;
}
