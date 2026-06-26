import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import { Docs } from './Docs';

const registry = vi.hoisted(() => {
  const groups = [
    { id: 'start', title: 'Start here' },
    { id: 'daily-work', title: 'Daily work' },
    { id: 'data-design', title: 'Data and design' },
    { id: 'administration', title: 'Administration' },
    { id: 'more', title: 'More' },
  ];

  const guideData = [
    ['start-here', 'Start Here', 'start', ['dashboard', 'reports', 'advanced-docs']],
    ['dashboard', 'Dashboard', 'daily-work', ['reports', 'workflows']],
    ['reports', 'Reports', 'daily-work', ['dashboard', 'audit']],
    ['workflows', 'Workflows', 'data-design', ['reports', 'connectors', 'audit']],
    ['forms', 'Forms', 'data-design', ['terminology', 'marketplace']],
    ['terminology', 'Terminology', 'data-design', ['forms', 'audit']],
    ['users', 'Users and Roles', 'administration', ['audit', 'settings']],
    ['audit', 'Audit', 'administration', ['users', 'workflows']],
    ['settings', 'Settings', 'administration', ['connectors', 'marketplace']],
    ['connectors', 'Connectors', 'administration', ['settings', 'workflows', 'marketplace']],
    ['marketplace', 'Marketplace', 'administration', ['settings', 'connectors', 'forms']],
    ['advanced-docs', 'Advanced Docs — Coming soon', 'more', ['start-here', 'settings']],
  ] as const;

  const guides = guideData.map(([slug, title, group, relatedSlugs], index) => ({
    slug,
    title,
    group,
    summary: slug === 'workflows' ? 'Create and run workflows.' : `Guide for ${title}.`,
    audience: ['all-users'],
    requiredRoles: slug === 'users' ? ['lab_admin'] : [],
    estimatedMinutes: slug === 'start-here' ? 8 : index + 5,
    difficulty: slug === 'advanced-docs' ? 'advanced' : 'beginner',
    relatedSlugs,
    screenshotNames: [],
    status: slug === 'advanced-docs' ? 'coming-soon' : 'published',
  }));

  const sections = guides.map((guide) => ({
    ...guide,
    content:
      guide.slug === 'advanced-docs'
        ? '# Advanced Docs — Coming soon\n\nThe separate advanced web app does not exist yet.'
        : guide.slug === 'workflows'
          ? '# Workflows\n\nCreate workflow procedures for training.'
        : `# ${guide.title}\n\nStep-by-step content for ${guide.title}.`,
    localeUsed: 'en',
  }));

  return { groups, guides, sections };
});

vi.mock('../docs/registry', () => ({
  DOC_GROUPS: registry.groups,
  DOC_GUIDES: registry.guides,
  list: vi.fn((locale: string) =>
    registry.sections.map((section) => ({ ...section, localeUsed: locale === 'en' ? 'en' : 'en' })),
  ),
  resolve: vi.fn((locale: string, slug: string) => {
    const section = registry.sections.find((candidate) => candidate.slug === slug);
    return section ? { ...section, localeUsed: locale === 'en' ? 'en' : 'en' } : null;
  }),
}));

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
  it('groups the documentation sidebar and excludes retired guides', () => {
    renderAt('/docs');
    const nav = screen.getByRole('navigation', { name: 'Documentation sections' });

    expect(within(nav).getByText('Start here')).toBeInTheDocument();
    expect(within(nav).getByText('Daily work')).toBeInTheDocument();
    expect(within(nav).getByText('Data and design')).toBeInTheDocument();
    expect(within(nav).getByText('Administration')).toBeInTheDocument();
    expect(within(nav).getByText('More')).toBeInTheDocument();
    expect(within(nav).queryByText(/DHIS2/i)).toBeNull();
  });

  it('renders Start Here by default at /docs', () => {
    renderAt('/docs');
    expect(screen.getByRole('heading', { level: 1, name: 'Start Here' })).toBeInTheDocument();
  });

  it('shows metadata, next navigation, and related guides for the active guide', () => {
    renderAt('/docs');

    expect(screen.getByText('About 8 minutes')).toBeInTheDocument();
    expect(screen.getByText('Beginner')).toBeInTheDocument();
    expect(screen.getByText('All users')).toBeInTheDocument();
    expect(screen.getByText('No special role')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Next: Dashboard/i })).toHaveAttribute(
      'href',
      '/docs/dashboard',
    );
    const related = screen.getByRole('heading', { level: 2, name: 'Related guides' }).parentElement!;
    expect(related).toBeInTheDocument();
    expect(within(related).getByRole('link', { name: 'Reports' })).toHaveAttribute(
      'href',
      '/docs/reports',
    );
  });

  it('renders the advanced docs placeholder guide', () => {
    renderAt('/docs/advanced-docs');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Advanced Docs — Coming soon' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Coming soon').length).toBeGreaterThan(0);
  });

  it('shows a flat search result group while searching', () => {
    renderAt('/docs');
    fireEvent.change(screen.getByLabelText('Search documentation'), {
      target: { value: 'create workflow' },
    });

    const nav = screen.getByRole('navigation', { name: 'Documentation sections' });
    expect(within(nav).getByText('Search results')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Workflows' })).toBeInTheDocument();
    expect(within(nav).queryByText('Daily work')).toBeNull();
  });

  it('shows a not-found panel for an unknown or retired slug', () => {
    renderAt('/docs/dhis2');
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
    expect(screen.queryByLabelText('Language')).toBeNull();
  });
});

describe('DocsLayout locale derivation', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('defaults to English content when app language is en', () => {
    renderAt('/docs');
    expect(screen.getByRole('heading', { level: 1, name: 'Start Here' })).toBeInTheDocument();
    expect(screen.queryByText(/Shown in English/)).toBeNull();
  });

  it('uses English fallback when app language is fr', async () => {
    await i18n.changeLanguage('fr');
    renderAt('/docs');
    expect(screen.getByText(/Shown in English/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Start Here' })).toBeInTheDocument();
  });
});
