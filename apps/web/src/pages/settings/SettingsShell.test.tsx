import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import '@/i18n';

const hasRole = vi.fn();
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: [] }, loading: false, hasRole, signOut: vi.fn() }),
}));

import { SettingsShell } from './SettingsShell';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings" element={<SettingsShell />}>
          <Route path="dhis2" element={<div>dhis2 child</div>} />
          <Route path="marketplace" element={<div>marketplace child</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('SettingsShell', () => {
  it('renders the DHIS2 sub-nav link and the active child for a lab_admin', () => {
    hasRole.mockImplementation((r: string) => r === 'lab_admin');
    renderAt('/settings/dhis2');
    expect(screen.getByRole('link', { name: 'DHIS2' })).toHaveAttribute('href', '/settings/dhis2');
    expect(screen.getByText('dhis2 child')).toBeInTheDocument();
  });

  it('hides the DHIS2 sub-nav link for a user without the role', () => {
    hasRole.mockReturnValue(false);
    renderAt('/settings/dhis2');
    expect(screen.queryByRole('link', { name: 'DHIS2' })).not.toBeInTheDocument();
  });

  it('renders the Marketplace sub-nav link for a lab_admin', () => {
    hasRole.mockImplementation((r: string) => r === 'lab_admin');
    renderAt('/settings/marketplace');
    expect(screen.getByRole('link', { name: 'Marketplace' })).toHaveAttribute('href', '/settings/marketplace');
  });

  it('hides the Marketplace sub-nav link for a user without the role', () => {
    hasRole.mockReturnValue(false);
    renderAt('/settings/marketplace');
    expect(screen.queryByRole('link', { name: 'Marketplace' })).not.toBeInTheDocument();
  });
});
