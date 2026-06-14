import Fuse from 'fuse.js';
import type { DocSection } from './registry';

export interface DocRecord { slug: string; title: string; headings: string; body: string; }
export interface SearchHit { slug: string; title: string; snippet: string; }

function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function headingsOf(md: string): string {
  return md.split('\n')
    .filter((l) => /^#{2,3}\s+/.test(l.trim()))
    .map((l) => l.trim().replace(/^#{2,3}\s+/, '').trim())
    .join(' ');
}

export function toRecord(s: DocSection): DocRecord {
  return { slug: s.slug, title: s.title, headings: headingsOf(s.content), body: plainText(s.content) };
}

export function buildIndex(sections: DocSection[]): Fuse<DocRecord> {
  return new Fuse(sections.map(toRecord), {
    keys: [
      { name: 'title', weight: 0.5 },
      { name: 'headings', weight: 0.3 },
      { name: 'body', weight: 0.2 },
    ],
    includeMatches: true,
    ignoreLocation: true,
    threshold: 0.3,
    minMatchCharLength: 2,
  });
}

function snippet(rec: DocRecord, query: string): string {
  const i = rec.body.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return rec.title;
  const start = Math.max(0, i - 60);
  const end = Math.min(rec.body.length, i + query.length + 60);
  return (start > 0 ? '…' : '') + rec.body.slice(start, end).trim() + (end < rec.body.length ? '…' : '');
}

export function searchDocs(index: Fuse<DocRecord>, query: string): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  return index.search(q).map((r) => ({ slug: r.item.slug, title: r.item.title, snippet: snippet(r.item, q) }));
}
