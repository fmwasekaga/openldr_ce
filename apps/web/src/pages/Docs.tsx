import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { useDocLocale } from '../docs/useDocLocale';
import { list, resolve, LOCALES, type Locale } from '../docs/registry';
import { buildIndex, searchDocs } from '../docs/search';
import { DocMarkdown } from '../docs/DocMarkdown';

export function Docs() {
  const [locale, setLocale] = useDocLocale();
  const [query, setQuery] = useState('');
  const sections = useMemo(() => list(locale), [locale]);
  const index = useMemo(() => buildIndex(sections), [sections]);
  const hits = useMemo(() => searchDocs(index, query), [index, query]);
  const overview = resolve(locale, 'overview');

  return (
    <AppShell title="Documentation">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <input
          className="btn-secondary"
          placeholder="Search documentation…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search documentation"
          style={{ flex: 1 }}
        />
        <select
          className="btn-secondary"
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
          aria-label="Language"
        >
          {LOCALES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
        </select>
      </div>

      {query.trim() ? (
        <div className="card">
          {hits.length === 0 ? (
            <p>No results for “{query}”.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {hits.map((h) => (
                <li key={h.slug} style={{ marginBottom: 12 }}>
                  <Link to={`/docs/${h.slug}`} style={{ fontWeight: 600 }}>{h.title}</Link>
                  <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{h.snippet}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {sections.map((s) => (
                <li key={s.slug}><Link to={`/docs/${s.slug}`}>{s.title}</Link></li>
              ))}
            </ul>
          </div>
          {overview && <div className="card doc-content"><DocMarkdown content={overview.content} /></div>}
        </>
      )}
    </AppShell>
  );
}
