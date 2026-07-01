import { useParams, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import gettingStarted from './getting-started.md?raw';
import install from './install.md?raw';
import requirements from './requirements.md?raw';

const PAGES: Record<string, { title: string; body: string }> = {
  'getting-started': { title: 'Getting started', body: gettingStarted },
  install: { title: 'Install', body: install },
  requirements: { title: 'Requirements', body: requirements },
};
const ORDER = ['getting-started', 'install', 'requirements'];

export function DocsPage() {
  const { page } = useParams();
  const key = page && PAGES[page] ? page : 'getting-started';
  return (
    <div className="mx-auto flex max-w-5xl gap-8 px-6 py-12">
      <nav className="w-48 shrink-0 space-y-1 text-sm">
        {ORDER.map((k) => (
          <Link
            key={k}
            to={`/docs/${k}`}
            className={k === key ? 'block text-foreground' : 'block text-muted-foreground hover:text-foreground'}
          >
            {PAGES[k].title}
          </Link>
        ))}
      </nav>
      <article className="doc-content prose min-w-0 flex-1">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{PAGES[key].body}</ReactMarkdown>
      </article>
    </div>
  );
}
