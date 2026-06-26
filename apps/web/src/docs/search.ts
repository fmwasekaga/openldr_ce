import Fuse from 'fuse.js';
import type { DocSection } from './registry';

export interface DocRecord {
  slug: string;
  title: string;
  summary: string;
  audience: string;
  roles: string;
  headings: string;
  body: string;
}

export interface SearchHit {
  slug: string;
  title: string;
  snippet: string;
}

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
  return md
    .split('\n')
    .filter((line) => /^#{2,3}\s+/.test(line.trim()))
    .map((line) => line.trim().replace(/^#{2,3}\s+/, '').trim())
    .join(' ');
}

export function toRecord(section: DocSection): DocRecord {
  return {
    slug: section.slug,
    title: section.title,
    summary: section.summary,
    audience: section.audience.join(' '),
    roles: section.requiredRoles.join(' '),
    headings: headingsOf(section.content),
    body: plainText(section.content),
  };
}

export function buildIndex(sections: DocSection[]): Fuse<DocRecord> {
  return new Fuse(
    sections
      .filter((section) => !/dhis2/i.test(section.slug))
      .map(toRecord)
      .filter((record) => !/dhis2/i.test(JSON.stringify(record))),
    {
      keys: [
        { name: 'title', weight: 0.3 },
        { name: 'summary', weight: 0.2 },
        { name: 'headings', weight: 0.2 },
        { name: 'body', weight: 0.2 },
        { name: 'roles', weight: 0.05 },
        { name: 'audience', weight: 0.05 },
      ],
      includeMatches: true,
      includeScore: true,
      ignoreLocation: true,
      threshold: 0.4,
      minMatchCharLength: 2,
    },
  );
}

// Fuse can surface a page whose aggregate relevance is weak. Keep the score gate
// for fuzzy matches, but allow task-style queries when every word is explicitly
// present across the indexed guide fields.
const SCORE_CUTOFF = 0.64;

function snippet(record: DocRecord, query: string): string {
  const index = record.body.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return record.title;
  const start = Math.max(0, index - 60);
  const end = Math.min(record.body.length, index + query.length + 60);
  return (
    (start > 0 ? '…' : '') +
    record.body.slice(start, end).trim() +
    (end < record.body.length ? '…' : '')
  );
}

function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function hasToken(text: string, token: string): boolean {
  if (text.includes(token)) return true;
  if (!token.endsWith('s') && text.includes(`${token}s`)) return true;
  if (token.endsWith('s') && text.includes(token.slice(0, -1))) return true;
  return false;
}

function hasAllQueryTokens(record: DocRecord, query: string): boolean {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return false;
  const haystack = [
    record.title,
    record.summary,
    record.headings,
    record.body,
    record.roles,
    record.audience,
  ]
    .join(' ')
    .toLowerCase();
  return tokens.every((token) => hasToken(haystack, token));
}

export function searchDocs(index: Fuse<DocRecord>, query: string): SearchHit[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (/dhis2/i.test(trimmed)) return [];
  return index
    .search(trimmed)
    .filter(
      (result) =>
        result.score == null ||
        result.score <= SCORE_CUTOFF ||
        hasAllQueryTokens(result.item, trimmed),
    )
    .map((result) => ({
      slug: result.item.slug,
      title: result.item.title,
      snippet: snippet(result.item, trimmed),
    }));
}
