import { useState, type ComponentProps } from 'react';
import { useParams, Link } from 'react-router-dom';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DOC_VERSIONS,
  DEFAULT_DOC_VERSION,
  NAV,
  TITLES,
  docBody,
} from './content';

// The app runs under a HashRouter, so a raw <a href="/docs/..."> triggers a
// full-page load that drops back to the landing route. Render internal links as
// react-router <Link>s (hash-aware client navigation); leave external links alone.
const MARKDOWN_COMPONENTS: Components = {
  a({ href, children }: ComponentProps<'a'>) {
    if (href && href.startsWith('/')) {
      return <Link to={href}>{children}</Link>;
    }
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
};

function NavLink({ slug, active, nested }: { slug: string; active: string; nested?: boolean }) {
  return (
    <Link
      to={`/docs/${slug}`}
      className={[
        'block',
        nested ? 'pl-3' : '',
        slug === active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
      ].join(' ')}
    >
      {TITLES[slug]}
    </Link>
  );
}

export function DocsPage() {
  const { page } = useParams();
  const [version, setVersion] = useState(DEFAULT_DOC_VERSION);
  const key = page && TITLES[page] ? page : 'getting-started';
  const body = docBody(key, version);
  return (
    <div className="mx-auto flex max-w-5xl gap-8 px-6 py-12">
      <nav className="w-48 shrink-0 space-y-3 text-sm">
        <Select value={version} onValueChange={setVersion}>
          <SelectTrigger className="h-8 w-full gap-1 px-2 text-xs" aria-label="Documentation version">
            <span className="text-muted-foreground">Version</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DOC_VERSIONS.map((docVersion) => (
              <SelectItem key={docVersion} value={docVersion} className="text-xs">
                {docVersion}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="space-y-1">
          {NAV.map((item) => (
            <div key={item.slug} className="space-y-1">
              <NavLink slug={item.slug} active={key} />
              {item.children?.map((child) => (
                <NavLink key={child} slug={child} active={key} nested />
              ))}
            </div>
          ))}
        </div>
      </nav>
      <article className="doc-content min-w-0 flex-1">
        {body == null ? (
          <p className="text-muted-foreground">This page isn’t available for version {version}.</p>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
            {body}
          </ReactMarkdown>
        )}
      </article>
    </div>
  );
}
