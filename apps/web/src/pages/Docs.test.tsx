import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import i18n from '@/i18n';
import { Docs } from './Docs';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/docs" element={<Docs />} />
        <Route path="/docs/:slug" element={<Docs />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DocsLayout', () => {
  it('lists the documentation sections in the sidebar', () => {
    renderAt('/docs');
    const nav = screen.getByRole('navigation', { name: 'Documentation sections' });
    expect(within(nav).getByRole('link', { name: 'Getting Started' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'DHIS2 Aggregate Reporting' })).toBeInTheDocument();
  });

  it('renders the overview content by default at /docs', () => {
    renderAt('/docs');
    expect(screen.getByRole('heading', { level: 1, name: 'OpenLDR Community Edition' })).toBeInTheDocument();
  });

  it('renders the active section heading for a slug route', () => {
    renderAt('/docs/dhis2');
    expect(screen.getByRole('heading', { level: 1, name: 'DHIS2 Aggregate Reporting' })).toBeInTheDocument();
  });

  it('narrows the sidebar list when searching', () => {
    renderAt('/docs');
    fireEvent.change(screen.getByLabelText('Search documentation'), { target: { value: 'dhis2' } });
    const nav = screen.getByRole('navigation', { name: 'Documentation sections' });
    expect(within(nav).getByRole('link', { name: /DHIS2/ })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Getting Started' })).toBeNull();
  });

  it('shows a not-found panel for an unknown slug', () => {
    renderAt('/docs/nope');
    expect(screen.getByText(/not found/i)).toBeInTheDocument();
  });

  it('exposes a download menu in the toolbar', () => {
    renderAt('/docs');
    expect(screen.getByRole('button', { name: 'Download documentation' })).toBeInTheDocument();
  });

  it('collapses and expands the sidebar', () => {
    renderAt('/docs');
    expect(screen.getByRole('navigation', { name: 'Documentation sections' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse documentation sidebar' }));
    expect(screen.queryByRole('navigation', { name: 'Documentation sections' })).toBeNull();
    expect(screen.queryByLabelText('Search documentation')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand documentation sidebar' }));
    expect(screen.getByRole('navigation', { name: 'Documentation sections' })).toBeInTheDocument();
  });

  it('does not render a language Select in the toolbar (locale derives from app language)', () => {
    renderAt('/docs');
    // The docs-only locale Select has been removed; the toolbar holds only the export dropdown.
    expect(screen.queryByLabelText('Language')).toBeNull();
  });
});

describe('DocsLayout locale derivation', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('defaults to English content when app language is en', () => {
    renderAt('/docs');
    // English overview title must be present (no fallback notice)
    expect(screen.getByRole('heading', { level: 1, name: 'OpenLDR Community Edition' })).toBeInTheDocument();
    expect(screen.queryByText(/Shown in English/)).toBeNull();
  });

  it('falls back to English content when app language is fr (fr docs not yet created)', async () => {
    await i18n.changeLanguage('fr');
    renderAt('/docs');
    // fr/overview.md doesn't exist yet (Task 3) so the registry falls back to en content.
    // The fallback notice is shown when localeUsed !== requested locale.
    expect(screen.getByRole('heading', { level: 1, name: 'OpenLDR Community Edition' })).toBeInTheDocument();
    // Fallback notice expected since fr docs don't exist yet
    expect(screen.getByText(/Shown in English/)).toBeInTheDocument();
  });
});
