import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    listPluginUis: vi.fn(async () => [
      {
        id: 'ui-demo',
        version: '1',
        nav: { label: 'Demo Plugin', icon: 'puzzle', section: 'apps' },
        uiSdkVersion: '1',
        hasWebview: true,
        hasDeclarative: false,
        declarative: null,
      },
    ]),
  };
});

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u', username: 'admin', displayName: null, roles: ['lab_admin'] },
    loading: false,
    hasCapability: () => true,
    signOut: vi.fn(),
  }),
}));

vi.mock('@/i18n/language', async (orig) => {
  const actual = await orig<typeof import('@/i18n/language')>();
  return { ...actual, setLanguage: vi.fn() };
});

import { AppShell } from './AppShell';

describe('AppShell plugin nav', () => {
  it('renders a sidebar entry for an installed UI plugin linking to /x/:id', async () => {
    render(
      <MemoryRouter>
        <AppShell title="Dashboard"><div>content</div></AppShell>
      </MemoryRouter>,
    );
    const link = await waitFor(() => screen.getByRole('link', { name: /Demo Plugin/ }));
    expect(link.getAttribute('href')).toBe('/x/ui-demo');
  });
});
