import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { resolveImg } from './screenshots';
import type { LightboxImage } from './Lightbox';

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function text(children: ReactNode): string {
  return Array.isArray(children) ? children.map(text).join('') : String(children ?? '');
}

export function DocMarkdown({
  content,
  onImageClick,
}: {
  content: string;
  onImageClick: (image: LightboxImage) => void;
}) {
  const components: Components = {
    img(props) {
      const src = typeof props.src === 'string' ? props.src : '';
      const url = resolveImg(src);
      const alt = props.alt ?? '';
      if (!url) {
        if (import.meta.env.DEV) console.warn(`[docs] unresolved image: ${src}`);
        return (
          <span className="my-3 block rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            {alt ? `Screenshot unavailable: ${alt}` : 'Screenshot unavailable'}
          </span>
        );
      }
      return (
        <span className="my-4 block">
          <button
            type="button"
            onClick={() => onImageClick({ url, alt })}
            aria-label={alt ? `Zoom: ${alt}` : 'Zoom screenshot'}
            className="group block w-full max-w-2xl cursor-zoom-in overflow-hidden rounded-md border border-border transition-colors hover:border-ring"
          >
            <img src={url} alt={alt} loading="lazy" className="block w-full" />
          </button>
          {alt ? <span className="mt-1.5 block text-xs text-muted-foreground">{alt}</span> : null}
        </span>
      );
    },
    a(props) {
      const href = typeof props.href === 'string' ? props.href : '';
      if (/^https?:\/\//.test(href)) {
        return <a href={href} target="_blank" rel="noopener noreferrer">{props.children}</a>;
      }
      // Internal docs link (e.g. /docs/report-designer): use a router Link so it resolves
      // against the app basename (/studio) instead of a bare absolute href that drops it.
      if (href.startsWith('/')) {
        return <Link to={href}>{props.children}</Link>;
      }
      return <a href={href}>{props.children}</a>;
    },
    h1: (p) => <h1 id={slugify(text(p.children))}>{p.children}</h1>,
    h2: (p) => <h2 id={slugify(text(p.children))}>{p.children}</h2>,
    h3: (p) => <h3 id={slugify(text(p.children))}>{p.children}</h3>,
  };

  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{content}</ReactMarkdown>;
}
