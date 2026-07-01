import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../shell/AppShell';
import {
  DOC_GROUPS,
  DOC_GUIDES,
  list,
  resolve,
  type DocAudience,
  type DocSection,
  type Locale,
} from '../docs/registry';
import { buildIndex, searchDocs } from '../docs/search';
import { DocMarkdown } from '../docs/DocMarkdown';
import { Lightbox, type LightboxImage } from '../docs/Lightbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { exportDocs, type ExportFormat, type ExportScope } from '../docs/export/download';

const AUDIENCE_LABELS: Record<DocAudience, string> = {
  'all-users': 'All users',
  'lab-users': 'Lab users',
  'lab-managers': 'Lab managers',
  administrators: 'Administrators',
};

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function GuideLink({
  section,
  activeSlug,
}: {
  section: DocSection;
  activeSlug: string;
}) {
  return (
    <Link
      to={`/docs/${section.slug}`}
      aria-current={section.slug === activeSlug ? 'page' : undefined}
      className={`block border-l-2 px-3 py-2 text-sm no-underline transition-colors ${
        section.slug === activeSlug
          ? 'border-primary bg-accent text-primary'
          : 'border-transparent text-foreground/85 hover:bg-accent hover:text-foreground'
      }`}
    >
      <span>{section.title}</span>
      {section.status === 'coming-soon' && (
        <Badge variant="outline" className="ml-2 align-middle text-[10px]">
          Coming soon
        </Badge>
      )}
    </Link>
  );
}

export function Docs() {
  const { slug } = useParams();
  const { i18n } = useTranslation();
  const locale: Locale = (['en', 'fr', 'pt'] as const).includes(i18n.language as Locale)
    ? (i18n.language as Locale)
    : 'en';
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => list(locale), [locale]);
  const index = useMemo(() => buildIndex(sections), [sections]);
  const hits = useMemo(() => searchDocs(index, query), [index, query]);
  const sectionBySlug = useMemo(
    () => new Map(sections.map((candidate) => [candidate.slug, candidate])),
    [sections],
  );

  const defaultSlug = sections[0]?.slug ?? 'start-here';
  const activeSlug = slug ?? defaultSlug;
  const section = resolve(locale, activeSlug);
  // Reset the reading pane to the top whenever the active guide changes.
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [activeSlug]);
  const navSections = useMemo(() => {
    if (!query.trim()) return sections;
    return hits
      .map((hit) => sectionBySlug.get(hit.slug))
      .filter((candidate): candidate is DocSection => candidate != null);
  }, [hits, query, sectionBySlug, sections]);
  const orderedSections = useMemo(
    () =>
      DOC_GUIDES.map((guide) => sectionBySlug.get(guide.slug)).filter(
        (candidate): candidate is DocSection => candidate != null,
      ),
    [sectionBySlug],
  );
  const activeIndex = orderedSections.findIndex((candidate) => candidate.slug === activeSlug);
  const previousSection = activeIndex > 0 ? orderedSections[activeIndex - 1] : null;
  const nextSection =
    activeIndex >= 0 && activeIndex < orderedSections.length - 1
      ? orderedSections[activeIndex + 1]
      : null;
  const relatedSections = section
    ? section.relatedSlugs
        .filter((relatedSlug) => relatedSlug !== section.slug)
        .map((relatedSlug) => sectionBySlug.get(relatedSlug))
        .filter((candidate): candidate is DocSection => candidate != null)
    : [];

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
              aria-label={
                collapsed ? 'Expand documentation sidebar' : 'Collapse documentation sidebar'
              }
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </Button>
            {!collapsed && (
              <Input
                className="min-w-0"
                placeholder="Search…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search documentation"
              />
            )}
          </div>
          {!collapsed && (
            <nav
              aria-label="Documentation sections"
              className="flex flex-1 flex-col overflow-y-auto py-1"
            >
              {query.trim() ? (
                <>
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                    Search results
                  </div>
                  {navSections.map((navSection) => (
                    <GuideLink
                      key={navSection.slug}
                      section={navSection}
                      activeSlug={activeSlug}
                    />
                  ))}
                </>
              ) : (
                DOC_GROUPS.map((group) => ({
                  group,
                  items: navSections.filter((navSection) => navSection.group === group.id),
                }))
                  .filter((entry) => entry.items.length > 0)
                  .map(({ group, items }, idx) => (
                    <div
                      key={group.id}
                      className={`pb-1${idx > 0 ? ' mt-1 border-t border-border pt-2' : ''}`}
                    >
                      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                        {group.title}
                      </div>
                      {items.map((navSection) => (
                        <GuideLink
                          key={navSection.slug}
                          section={navSection}
                          activeSlug={activeSlug}
                        />
                      ))}
                    </div>
                  ))
              )}
              {navSections.length === 0 && (
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
              <span role="status" aria-live="polite" className="mr-auto text-xs text-destructive">
                {exportError}
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Download documentation">
                  <Download className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(['page', 'all'] as ExportScope[]).map((scope) => (
                  <DropdownMenuSub key={scope}>
                    <DropdownMenuSubTrigger>
                      {scope === 'page' ? 'This page' : 'All docs'}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem onSelect={() => onExport(scope, 'md')}>
                        Markdown (.md)
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onExport(scope, 'pdf')}>
                        PDF (.pdf)
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onExport(scope, 'docx')}>
                        Word (.docx)
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div ref={contentRef} className="flex-1 overflow-y-auto p-6">
            {!section ? (
              <p className="text-sm text-muted-foreground">
                Documentation page not found.{' '}
                <Link to="/docs" className="text-primary">
                  All docs
                </Link>
              </p>
            ) : (
              <>
                {section.localeUsed !== locale && (
                  <p className="mb-3 text-xs text-muted-foreground">
                    Shown in English — not yet translated.
                  </p>
                )}
                <div className="mb-4 flex flex-wrap gap-2" aria-label="Guide metadata">
                  {section.audience.map((audience) => (
                    <Badge key={audience} variant="secondary">
                      {AUDIENCE_LABELS[audience]}
                    </Badge>
                  ))}
                  {section.requiredRoles.length === 0 ? (
                    <Badge variant="outline">No special role</Badge>
                  ) : (
                    section.requiredRoles.map((role) => (
                      <Badge key={role} variant="outline">
                        {role}
                      </Badge>
                    ))
                  )}
                  <Badge variant="outline">About {section.estimatedMinutes} minutes</Badge>
                  <Badge variant="outline">{titleCase(section.difficulty)}</Badge>
                </div>
                <div className="doc-content">
                  <DocMarkdown content={section.content} onImageClick={setLightbox} />
                </div>
                {(previousSection || nextSection || relatedSections.length > 0) && (
                  <div className="mt-8 border-t border-border pt-4">
                    <div className="flex flex-wrap justify-between gap-3">
                      {previousSection ? (
                        <Link to={`/docs/${previousSection.slug}`} className="text-sm text-primary">
                          Previous: {previousSection.title}
                        </Link>
                      ) : (
                        <span />
                      )}
                      {nextSection && (
                        <Link to={`/docs/${nextSection.slug}`} className="text-sm text-primary">
                          Next: {nextSection.title}
                        </Link>
                      )}
                    </div>
                    {relatedSections.length > 0 && (
                      <div className="mt-4">
                        <h2 className="text-base font-semibold">Related guides</h2>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {relatedSections.map((relatedSection) => (
                            <Link
                              key={relatedSection.slug}
                              to={`/docs/${relatedSection.slug}`}
                              className="rounded-md border border-border px-3 py-1 text-sm text-primary no-underline hover:bg-accent"
                            >
                              {relatedSection.title}
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </div>
      <Lightbox image={lightbox} onClose={() => setLightbox(null)} />
    </AppShell>
  );
}
