import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const SAFE_IMG = /^(data:image\/(png|jpeg|gif|webp|svg\+xml);|https:\/\/)/i;
const SAFE_HREF = /^https?:\/\//i;

const components: Components = {
  img: ({ src, alt }) =>
    typeof src === 'string' && SAFE_IMG.test(src) ? (
      <img src={src} alt={alt ?? ''} className="my-3 max-w-full rounded-md border border-border" />
    ) : null,
  a: ({ href, children }) =>
    typeof href === 'string' && SAFE_HREF.test(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">{children}</a>
    ) : (
      <span>{children}</span>
    ),
};

/** Renders an UNTRUSTED plugin readme. react-markdown emits no raw HTML; we further
 *  restrict images to data:image/https and links to http(s). The `urlTransform`
 *  identity override defers ALL url filtering to the SAFE_IMG/SAFE_HREF guards above
 *  (react-markdown's default would strip data: URLs before our img component sees them). */
export function ReadmeMarkdown({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none text-sm text-foreground/90 [&_h1]:mt-0 [&_h1]:text-lg [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={(url) => url}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
