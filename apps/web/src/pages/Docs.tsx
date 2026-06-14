import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { useDocLocale } from '../docs/useDocLocale';
import { list, resolve, LOCALES, type Locale } from '../docs/registry';
import { buildIndex, searchDocs } from '../docs/search';
import { DocMarkdown } from '../docs/DocMarkdown';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';

export function Docs() {
  const { slug } = useParams();
  const [locale, setLocale] = useDocLocale();
  const [query, setQuery] = useState('');
  const sections = useMemo(() => list(locale), [locale]);
  const index = useMemo(() => buildIndex(sections), [sections]);
  const hits = useMemo(() => searchDocs(index, query), [index, query]);

  const activeSlug = slug ?? 'overview';
  const section = resolve(locale, activeSlug);
  const navSlugs = query.trim() ? hits.map((h) => h.slug) : sections.map((s) => s.slug);
  const titleFor = (s: string) => sections.find((x) => x.slug === s)?.title ?? s;

  return (
    <AppShell title="Documentation">
      <div className="ui-scope flex h-[calc(100vh-7rem)] gap-4">
        {/* Inner sidebar */}
        <aside className="flex w-64 shrink-0 flex-col rounded-lg border border-border bg-card">
          <div className="border-b border-border p-2">
            <input
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search documentation"
            />
          </div>
          <nav aria-label="Documentation sections" className="flex flex-1 flex-col overflow-y-auto p-1">
            {navSlugs.map((s) => (
              <Link
                key={s}
                to={`/docs/${s}`}
                className={`rounded-md px-3 py-2 text-sm no-underline transition-colors ${
                  s === activeSlug
                    ? 'bg-accent text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {titleFor(s)}
              </Link>
            ))}
            {navSlugs.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">No results.</p>
            )}
          </nav>
        </aside>

        {/* Content */}
        <section className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-card">
          <div className="flex items-center justify-end gap-2 border-b border-border p-2">
            <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
              <SelectTrigger aria-label="Language" className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LOCALES.map((l) => <SelectItem key={l} value={l}>{l.toUpperCase()}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {!section ? (
              <p className="text-sm text-muted-foreground">
                Documentation page not found. <Link to="/docs" className="text-primary">All docs</Link>
              </p>
            ) : (
              <>
                {section.localeUsed !== locale && (
                  <p className="mb-3 text-xs text-muted-foreground">Shown in English — not yet translated.</p>
                )}
                <div className="doc-content"><DocMarkdown content={section.content} /></div>
              </>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
