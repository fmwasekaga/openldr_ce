import { DOCS_VERSION } from './version';

export type Locale = 'en' | 'fr' | 'pt';
export const LOCALES: Locale[] = ['en', 'fr', 'pt'];

export interface DocSection {
  slug: string;
  title: string;
  content: string;
  localeUsed: Locale;
}

/** Navigation order; also the authoritative set of pages that must exist in English. */
export const DOC_ORDER = [
  'overview', 'getting-started', 'dashboard', 'reports', 'ingestion',
  'terminology', 'dhis2', 'external-db', 'cli',
] as const;

// Eagerly bundle every locale's markdown. Path shape: ./0.1.0/<locale>/<slug>.md
const files = import.meta.glob('./0.1.0/*/*.md', {
  query: '?raw', eager: true, import: 'default',
}) as Record<string, string>;

// BY_VERSION[version][locale][slug] = content
const BY_VERSION: Record<string, Record<string, Record<string, string>>> = {};
for (const [path, content] of Object.entries(files)) {
  const m = path.match(/\.\/([^/]+)\/([^/]+)\/([^/]+)\.md$/);
  if (!m) continue;
  const [, version, locale, slug] = m;
  ((BY_VERSION[version] ??= {})[locale] ??= {})[slug] = content;
}

export function firstHeading(md: string): string {
  const line = md.split('\n').find((l) => /^#\s+/.test(l.trim()));
  return line ? line.trim().replace(/^#\s+/, '').trim() : '';
}

function titleCase(slug: string): string {
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function localesForVersion(version: string): Record<string, Record<string, string>> {
  if (BY_VERSION[version]) return BY_VERSION[version];
  const versions = Object.keys(BY_VERSION).sort();
  return BY_VERSION[versions[versions.length - 1]] ?? {};
}

export function resolve(locale: Locale, slug: string): DocSection | null {
  const locales = localesForVersion(DOCS_VERSION);
  const localized = locales[locale]?.[slug];
  const content = localized ?? locales['en']?.[slug];
  if (content == null) return null;
  return {
    slug,
    title: firstHeading(content) || titleCase(slug),
    content,
    localeUsed: localized != null ? locale : 'en',
  };
}

export function list(locale: Locale): DocSection[] {
  return DOC_ORDER
    .map((slug) => resolve(locale, slug))
    .filter((s): s is DocSection => s !== null);
}
