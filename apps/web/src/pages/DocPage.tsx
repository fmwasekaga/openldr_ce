import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { useDocLocale } from '../docs/useDocLocale';
import { resolve } from '../docs/registry';
import { DocMarkdown } from '../docs/DocMarkdown';

export function DocPage() {
  const { slug = '' } = useParams();
  const [locale] = useDocLocale();
  const section = resolve(locale, slug);

  if (!section) {
    return (
      <AppShell title="Documentation">
        <div className="card">Documentation page not found. <Link to="/docs">All docs</Link></div>
      </AppShell>
    );
  }

  return (
    <AppShell title={section.title}>
      <div style={{ marginBottom: 12 }}><Link to="/docs">← All docs</Link></div>
      {section.localeUsed !== locale && (
        <div className="card" style={{ marginBottom: 12, color: 'var(--text-muted)', fontSize: 13 }}>
          Shown in English — not yet translated.
        </div>
      )}
      <div className="card doc-content"><DocMarkdown content={section.content} /></div>
    </AppShell>
  );
}
