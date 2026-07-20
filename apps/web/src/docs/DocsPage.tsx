import { useState, type ComponentProps, type ReactNode } from 'react';
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

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function textContent(children: ReactNode): string {
  if (Array.isArray(children)) return children.map(textContent).join('');
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  return '';
}

// The app runs under a HashRouter, so raw docs links can collide with client
// routing. Render internal page links through react-router and same-page anchors
// through scrollIntoView so they do not replace the route hash.
function markdownComponents(): Components {
  let skippedFirstHeading = false;
  return {
    h1({ children }: ComponentProps<'h1'>) {
      if (!skippedFirstHeading) {
        skippedFirstHeading = true;
        return null;
      }
      return <h1 id={slugify(textContent(children))}>{children}</h1>;
    },
    h2({ children }: ComponentProps<'h2'>) {
      return <h2 id={slugify(textContent(children))}>{children}</h2>;
    },
    h3({ children }: ComponentProps<'h3'>) {
      return <h3 id={slugify(textContent(children))}>{children}</h3>;
    },
    table({ children }: ComponentProps<'table'>) {
      return (
        <div className="max-w-full overflow-x-auto">
          <table>{children}</table>
        </div>
      );
    },
    a({ href, children }: ComponentProps<'a'>) {
      if (href?.startsWith('#')) {
        return (
          <a
            href={href}
            onClick={(event) => {
              event.preventDefault();
              document.getElementById(href.slice(1))?.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
              });
            }}
          >
            {children}
          </a>
        );
      }
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
}

function NavLink({ slug, active, nested }: { slug: string; active: string; nested?: boolean }) {
  const isActive = slug === active;
  return (
    <Link
      to={`/docs/${slug}`}
      aria-current={isActive ? 'page' : undefined}
      className={[
        'block rounded-md px-3 py-2 text-sm no-underline transition-colors',
        nested ? 'ml-3' : '',
        isActive
          ? 'bg-accent text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
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
    <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase text-primary">Documentation</p>
          <h1 className="mt-2 text-2xl font-semibold">Public docs</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Install, configure, deploy, and develop OpenLDR.
          </p>
        </div>
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
        <nav aria-label="Public documentation" className="mt-4 space-y-1 border-t border-border pt-4">
          {NAV.map((item) => (
            <div key={item.slug} className="space-y-1">
              <NavLink slug={item.slug} active={key} />
              {item.children?.map((child) => (
                <NavLink key={child} slug={child} active={key} nested />
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <article className="doc-content min-w-0 max-w-3xl" aria-labelledby="doc-title">
        <div className="mb-6 border-b border-border pb-4">
          <p className="text-xs font-medium text-muted-foreground">OpenLDR {version}</p>
          <h2 id="doc-title" className="mt-1 text-3xl font-semibold">
            {TITLES[key]}
          </h2>
        </div>
        {body == null ? (
          <p className="text-muted-foreground">This page is not available for version {version}.</p>
        ) : (
          <div className="doc-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents()}>
              {body}
            </ReactMarkdown>
          </div>
        )}
      </article>
    </div>
  );
}
