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
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.3,
    minMatchCharLength: 2,
  });
}

// Fuse's per-key threshold can surface a page whose aggregate relevance is weak
// (e.g. a slug term mentioned once in another page's body). Drop those by combined
// Fuse score (lower = better; 0 = perfect): real matches score well under this
// cutoff, incidental ones land far above it.
// Measured (corpus @ DOCS_VERSION 0.1.0): real title hit ~0; legit antibiogram body
// match 0.569 (keep); incidental cross-page slug mention 0.708 (drop). 0.64 centers
// the (0.569, 0.708) window for symmetric margin.
const SCORE_CUTOFF = 0.64;

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
  return index
    .search(q)
    .filter((r) => r.score == null || r.score <= SCORE_CUTOFF)
    .map((r) => ({ slug: r.item.slug, title: r.item.title, snippet: snippet(r.item, q) }));
}
