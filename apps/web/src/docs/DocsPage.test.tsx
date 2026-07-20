import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DocsPage } from './DocsPage';

function renderDocs(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/docs/:page" element={<DocsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DocsPage', () => {
  it('renders a professional docs shell for a public doc page', () => {
    renderDocs('/docs/install');

    expect(screen.getByRole('navigation', { name: /public documentation/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Documentation version')).toBeInTheDocument();
    expect(screen.getByRole('article')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Install' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('table').parentElement).toHaveClass('overflow-x-auto');
    expect(screen.getAllByRole('heading', { name: 'Install' })).toHaveLength(1);
  });

  it('falls back to getting started when the route slug is unknown', () => {
    renderDocs('/docs/not-a-page');

    expect(screen.getByRole('link', { name: 'Getting started' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('article')).toBeInTheDocument();
  });

  it('scrolls same-page markdown anchor links without replacing the router hash', () => {
    const originalHash = window.location.hash;
    const scrollIntoView = vi.fn();

    try {
      renderDocs('/docs/environment');
      const adapters = document.getElementById('adapters');
      expect(adapters).not.toBeNull();
      if (!adapters) throw new Error('Adapters heading was not rendered');
      expect(adapters).toHaveClass('scroll-mt-20');
      adapters.scrollIntoView = scrollIntoView;
      window.location.hash = '#/docs/environment';

      fireEvent.click(screen.getByRole('link', { name: 'Adapters' }));

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
      expect(window.location.hash).toBe('#/docs/environment');
    } finally {
      window.location.hash = originalHash;
    }
  });

  it('deduplicates generated heading ids for repeated markdown headings', () => {
    renderDocs('/docs/install');

    expect(document.getElementById('demo-evaluation')).not.toBeNull();
    expect(document.getElementById('demo-evaluation-1')).not.toBeNull();
    expect(document.querySelectorAll('[id="demo-evaluation"]')).toHaveLength(1);
  });
});
