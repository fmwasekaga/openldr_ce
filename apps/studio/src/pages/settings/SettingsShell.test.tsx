import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import '@/i18n';

const hasCapability = vi.fn();
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: [] }, loading: false, hasCapability, signOut: vi.fn() }),
}));

import { SettingsShell, SettingsIndexRedirect } from './SettingsShell';
import { RequireCapability } from '@/auth/RequireCapability';

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

/**
 * Mirrors the real App.tsx settings subtree (parent OR-gate + per-child gates +
 * SettingsIndexRedirect) closely enough to catch the "over-gated parent" and
 * "hardcoded index redirect" regressions this fix addresses.
 */
function renderAppLikeSettingsTree(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>home</div>} />
        <Route
          path="/settings"
          element={
            <RequireCapability
              caps={['settings.view', 'notifications.view', 'sync.view', 'sync.manage', 'marketplace.view', 'connectors.manage', 'roles.view']}
            >
              <SettingsShell />
            </RequireCapability>
          }
        >
          <Route index element={<SettingsIndexRedirect />} />
          <Route path="general" element={<RequireCapability cap="settings.view"><div>general child</div></RequireCapability>} />
          <Route path="notifications" element={<RequireCapability cap="notifications.view"><div>notifications child</div></RequireCapability>} />
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

  it('lets a notifications.view-only actor reach /settings/notifications through the parent gate (not bounced to home)', () => {
    hasCapability.mockImplementation((c: string) => c === 'notifications.view');
    renderAppLikeSettingsTree('/settings/notifications');
    expect(screen.getByText('notifications child')).toBeInTheDocument();
    expect(screen.queryByText('home')).not.toBeInTheDocument();
  });

  it('lands a notifications.view-only actor on notifications (not general) when visiting bare /settings', () => {
    hasCapability.mockImplementation((c: string) => c === 'notifications.view');
    renderAppLikeSettingsTree('/settings');
    expect(screen.getByText('notifications child')).toBeInTheDocument();
    expect(screen.queryByText('home')).not.toBeInTheDocument();
  });

  it('still lands an admin (settings.view) on general at bare /settings', () => {
    hasCapability.mockImplementation((c: string) => c === 'settings.view');
    renderAppLikeSettingsTree('/settings');
    expect(screen.getByText('general child')).toBeInTheDocument();
  });

  it('denies a user with none of the settings sub-caps at the parent gate', () => {
    hasCapability.mockReturnValue(false);
    renderAppLikeSettingsTree('/settings');
    expect(screen.getByText('home')).toBeInTheDocument();
  });
});
