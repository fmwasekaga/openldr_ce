import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { AppShell } from '../shell/AppShell';
import { useDocLocale } from '../docs/useDocLocale';
import { list, resolve, LOCALES, type Locale } from '../docs/registry';
import { buildIndex, searchDocs } from '../docs/search';
import { DocMarkdown } from '../docs/DocMarkdown';
import { Lightbox, type LightboxImage } from '../docs/Lightbox';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { exportDocs, type ExportFormat, type ExportScope } from '../docs/export/download';

export function Docs() {
  const { slug } = useParams();
  const [locale, setLocale] = useDocLocale();
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const sections = useMemo(() => list(locale), [locale]);
  const index = useMemo(() => buildIndex(sections), [sections]);
  const hits = useMemo(() => searchDocs(index, query), [index, query]);

  const activeSlug = slug ?? 'overview';
  const section = resolve(locale, activeSlug);
  const navSlugs = query.trim() ? hits.map((h) => h.slug) : sections.map((s) => s.slug);
  const titleFor = (s: string) => sections.find((x) => x.slug === s)?.title ?? s;

  const onExport = (scope: ExportScope, format: ExportFormat) => {
    if (!section) return;
    setExportError(null);
    exportDocs({ scope, format, active: section, all: sections }).catch(() => {
      setExportError(`Could not export this page as ${format.toUpperCase()}.`);
    });
  };

  return (
    <AppShell title="Documentation" fullBleed>
      {/* Edge-to-edge: no outer frame or padding — structure comes only from the
          sidebar border-r and the matching h-12 header separators (corlix style). */}
      <div className="ui-scope flex min-h-0 flex-1 overflow-hidden">
        {/* Inner sidebar — a border-r column (not a card), collapsible. */}
        <aside
          className={`flex shrink-0 flex-col border-r border-border transition-[width] duration-200 ease-in-out ${
            collapsed ? 'w-12' : 'w-64'
          }`}
        >
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? 'Expand documentation sidebar' : 'Collapse documentation sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
            {!collapsed && (
              <Input
                className="min-w-0"
                placeholder="Search…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search documentation"
              />
            )}
          </div>
          {!collapsed && (
            <nav aria-label="Documentation sections" className="flex flex-1 flex-col overflow-y-auto py-1">
              {navSlugs.map((s) => (
                <Link
                  key={s}
                  to={`/docs/${s}`}
                  aria-current={s === activeSlug ? 'page' : undefined}
                  className={`border-l-2 px-3 py-2 text-sm no-underline transition-colors ${
                    s === activeSlug
                      ? 'border-primary bg-accent text-primary'
                      : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  {titleFor(s)}
                </Link>
              ))}
              {navSlugs.length === 0 && (
                <p className="px-3 py-2 text-sm text-muted-foreground">No results.</p>
              )}
            </nav>
          )}
        </aside>

        {/* Content — borderless; the toolbar matches the sidebar header height (h-12)
            so the two bottom borders line up across the page. */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-end gap-2 border-b border-border px-2">
            {exportError && (
              <span role="status" aria-live="polite" className="mr-auto text-xs text-destructive">{exportError}</span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Download documentation"><Download className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(['page', 'all'] as ExportScope[]).map((scope) => (
                  <DropdownMenuSub key={scope}>
                    <DropdownMenuSubTrigger>{scope === 'page' ? 'This page' : 'All docs'}</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem onSelect={() => onExport(scope, 'md')}>Markdown (.md)</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onExport(scope, 'pdf')}>PDF (.pdf)</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onExport(scope, 'docx')}>Word (.docx)</DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
                <div className="doc-content"><DocMarkdown content={section.content} onImageClick={setLightbox} /></div>
              </>
            )}
          </div>
        </section>
      </div>
      <Lightbox image={lightbox} onClose={() => setLightbox(null)} />
    </AppShell>
  );
}
