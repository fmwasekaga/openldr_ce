import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'me', username: 'admin', displayName: null, roles: ['lab_admin'] },
    loading: false,
    hasRole: (r: string) => r === 'lab_admin',
    signOut: vi.fn(),
  }),
}));

import { AppShell } from './AppShell';

describe('AppShell settings entry', () => {
  it('navigates to /settings from the user dropdown for an admin', () => {
    render(
      <MemoryRouter>
        <AppShell title="Dashboard"><div>content</div></AppShell>
      </MemoryRouter>,
    );
    // Radix opens on pointerdown under jsdom — click the trigger button
    const trigger = screen.getByText('admin'); // username text inside trigger
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    // Fall back to keyboard if the portal hasn't appeared yet
    if (!screen.queryByText('Settings')) {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    }
    const settingsItem = screen.getByText('Settings');
    fireEvent.pointerMove(settingsItem);
    fireEvent.click(settingsItem);
    expect(navigate).toHaveBeenCalledWith('/settings');
  });
});
