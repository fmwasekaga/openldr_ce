import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { resolveImg } from './screenshots';

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function text(children: ReactNode): string {
  return Array.isArray(children) ? children.map(text).join('') : String(children ?? '');
}

const components: Components = {
  img(props) {
    const src = typeof props.src === 'string' ? props.src : '';
    const url = resolveImg(src);
    if (!url) {
      if (import.meta.env.DEV) console.warn(`[docs] unresolved image: ${src}`);
      return null;
    }
    return <img src={url} alt={props.alt ?? ''} loading="lazy" />;
  },
  a(props) {
    const href = typeof props.href === 'string' ? props.href : '';
    const external = /^https?:\/\//.test(href);
    return external
      ? <a href={href} target="_blank" rel="noopener noreferrer">{props.children}</a>
      : <a href={href}>{props.children}</a>;
  },
  h1: (p) => <h1 id={slugify(text(p.children))}>{p.children}</h1>,
  h2: (p) => <h2 id={slugify(text(p.children))}>{p.children}</h2>,
  h3: (p) => <h3 id={slugify(text(p.children))}>{p.children}</h3>,
};

export function DocMarkdown({ content }: { content: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{content}</ReactMarkdown>;
}
