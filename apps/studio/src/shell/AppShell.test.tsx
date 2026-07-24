import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n/index';

// AppShell's NAV entries are capability-gated (Task 10). Default to an authenticated user
// with every capability so the "happy path" tests below see the full nav; a dedicated test
// flips `mockUser` to null to exercise the anonymous/default-context fallback.
let mockUser: { id: string; username: string; displayName: string | null; roles: string[] } | null = {
  id: 'me', username: 'admin', displayName: null, roles: ['lab_admin'],
};
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: mockUser,
    loading: false,
    hasCapability: () => mockUser !== null,
    signOut: vi.fn(),
    authEnforced: true,
  }),
}));

import { AppShell } from './AppShell';

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
  document.documentElement.setAttribute('data-theme', 'dark');
  mockUser = { id: 'me', username: 'admin', displayName: null, roles: ['lab_admin'] };
});

function renderShell() {
  return render(
    <MemoryRouter>
      <AppShell title="Dashboard"><div>content</div></AppShell>
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  it('renders brand, nav, title, and content', () => {
    renderShell();
    expect(screen.getByText('OpenLDR')).toBeInTheDocument();
    expect(screen.getAllByText('Dashboard').length).toBeGreaterThan(0);
    expect(screen.getByText('Reports')).toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('falls back to the "O" avatar initial when no user is logged in', () => {
    mockUser = null;
    renderShell();
    // The avatar initial falls back to 'O' when no user is logged in (user?.username?.[0] ?? 'O').
    expect(screen.getByText('O')).toBeInTheDocument();
  });

  it('renders Forms, Users, and Audit as active navigation links', () => {
    renderShell();
    expect(screen.getByRole('link', { name: 'Forms' })).toHaveAttribute('href', '/forms');
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/users');
    expect(screen.getByRole('link', { name: 'Audit' })).toHaveAttribute('href', '/audit');
  });

  it('toggles theme via the navbar icon button', () => {
    renderShell();
    fireEvent.click(screen.getByLabelText('Switch to light mode'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('collapses the sidebar — hiding the wordmark and nav labels', () => {
    renderShell();
    expect(screen.getByText('OpenLDR')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Collapse sidebar'));
    expect(screen.queryByText('OpenLDR')).not.toBeInTheDocument();
    expect(screen.queryByText('Reports')).not.toBeInTheDocument();
  });

  it('does not show DHIS2 or a top-level Settings link in the primary nav', () => {
    renderShell();
    expect(screen.queryByRole('link', { name: 'DHIS2' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });
});
