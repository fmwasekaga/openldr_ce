import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import '@/i18n';

const hasCapability = vi.fn();
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: [] }, loading: false, hasCapability, signOut: vi.fn() }),
}));

import { SettingsShell } from './SettingsShell';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings" element={<SettingsShell />}>
          <Route path="marketplace" element={<div>marketplace child</div>} />
          <Route path="connectors" element={<div>connectors child</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('SettingsShell', () => {
  it('renders the Connectors sub-nav link and the active child for a user with connectors.manage', () => {
    hasCapability.mockImplementation((c: string) => c === 'connectors.manage');
    renderAt('/settings/connectors');
    expect(screen.getByRole('link', { name: 'Connectors' })).toHaveAttribute('href', '/settings/connectors');
    expect(screen.getByText('connectors child')).toBeInTheDocument();
  });

  it('hides the sub-nav links for a user without the capability', () => {
    hasCapability.mockReturnValue(false);
    renderAt('/settings/connectors');
    expect(screen.queryByRole('link', { name: 'Connectors' })).not.toBeInTheDocument();
  });

  it('renders the Marketplace sub-nav link for a user with marketplace.view', () => {
    hasCapability.mockImplementation((c: string) => c === 'marketplace.view');
    renderAt('/settings/marketplace');
    expect(screen.getByRole('link', { name: 'Marketplace' })).toHaveAttribute('href', '/settings/marketplace');
  });

  it('hides the Marketplace sub-nav link for a user without the capability', () => {
    hasCapability.mockReturnValue(false);
    renderAt('/settings/marketplace');
    expect(screen.queryByRole('link', { name: 'Marketplace' })).not.toBeInTheDocument();
  });

  it('renders the Connectors sub-nav link for a user with connectors.manage', () => {
    hasCapability.mockImplementation((c: string) => c === 'connectors.manage');
    renderAt('/settings/connectors');
    expect(screen.getByRole('link', { name: 'Connectors' })).toHaveAttribute('href', '/settings/connectors');
  });
});
