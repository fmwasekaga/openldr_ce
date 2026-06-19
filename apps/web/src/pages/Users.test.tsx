import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listUsers: vi.fn(), setUserStatus: vi.fn(), createUser: vi.fn(), resetUserPassword: vi.fn(), sendUserResetEmail: vi.fn(), forceUserLogout: vi.fn() };
});
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasRole: () => true }),
}));

import { listUsers, setUserStatus, createUser, sendUserResetEmail, type User } from '@/api';
import { Users } from './Users';

const rows: User[] = [
  { id: 'me', subject: null, username: 'me', displayName: 'Me', email: 'me@x', roles: ['lab_admin'], status: 'active', lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'u2', subject: null, username: 'bob', displayName: 'Bob', email: 'bob@x', roles: ['lab_technician'], status: 'active', lastLoginAt: null, createdAt: '2026-01-02T00:00:00Z' },
  { id: 'u3', subject: null, username: 'old', displayName: 'Old', email: 'old@x', roles: [], status: 'disabled', lastLoginAt: null, createdAt: '2026-01-03T00:00:00Z' },
  { id: 'u4', subject: 'kc-sub-4', username: 'ada', displayName: 'Ada', email: 'ada@x', roles: ['lab_technician'], status: 'active', lastLoginAt: null, createdAt: '2026-01-04T00:00:00Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  (listUsers as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
  (createUser as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'u4', subject: null, username: 'grace', displayName: 'Grace Hopper', email: 'grace@test.local',
    roles: ['data_analyst'], status: 'active', lastLoginAt: null, createdAt: '2026-01-04T00:00:00Z',
  });
});

function openDropdown(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  }
}

describe('Users page', () => {
  it('lists active users by default (disabled hidden) with friendly role labels', async () => {
    render(<MemoryRouter><Users /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('me')).toBeTruthy());
    expect(screen.getByText('bob')).toBeTruthy();
    expect(screen.queryByText('old')).toBeNull(); // default active-only filter hides disabled
    expect(screen.getByText('Lab Admin')).toBeTruthy(); // friendly role label, not raw 'lab_admin'
  });

  it('disables another user behind a confirm dialog', async () => {
    (setUserStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ ...rows[1], status: 'disabled' });
    render(<MemoryRouter><Users /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('bob')).toBeTruthy());

    const bobRow = screen.getByText('bob').closest('tr')!;
    const trigger = within(bobRow).getByLabelText(/actions for bob/i);
    openDropdown(trigger);

    const disableItem = await screen.findByText('Disable');
    fireEvent.click(disableItem);

    // ConfirmDialog appears — click the confirm button (role=button name=Disable)
    const confirmBtn = await screen.findByRole('button', { name: 'Disable' });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(setUserStatus).toHaveBeenCalledWith('u2', 'disabled'));
  });

  it('blocks disabling your own account (menu item is disabled)', async () => {
    render(<MemoryRouter><Users /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('me')).toBeTruthy());

    const meRow = screen.getByText('me').closest('tr')!;
    const trigger = within(meRow).getByLabelText(/actions for me/i);
    openDropdown(trigger);

    const item = (await screen.findByText(/disable/i)).closest('[role="menuitem"]') as HTMLElement;
    expect(item.getAttribute('aria-disabled')).toBe('true');
  });

  it('action items are disabled for a user with no subject (no linked account)', async () => {
    render(<MemoryRouter><Users /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('bob')).toBeTruthy());

    const bobRow = screen.getByText('bob').closest('tr')!;
    const trigger = within(bobRow).getByLabelText(/actions for bob/i);
    openDropdown(trigger);

    const resetItem = (await screen.findByText(/reset password/i)).closest('[role="menuitem"]') as HTMLElement;
    expect(resetItem.getAttribute('aria-disabled')).toBe('true');

    const sendEmailItem = (await screen.findByText(/send reset email/i)).closest('[role="menuitem"]') as HTMLElement;
    expect(sendEmailItem.getAttribute('aria-disabled')).toBe('true');

    const forceSignOutItem = (await screen.findByText(/force sign-out/i)).closest('[role="menuitem"]') as HTMLElement;
    expect(forceSignOutItem.getAttribute('aria-disabled')).toBe('true');
  });

  it('send reset email calls sendUserResetEmail for a user with a subject', async () => {
    (sendUserResetEmail as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<MemoryRouter><Users /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('ada')).toBeTruthy());

    const adaRow = screen.getByText('ada').closest('tr')!;
    const trigger = within(adaRow).getByLabelText(/actions for ada/i);
    openDropdown(trigger);

    const sendEmailItem = await screen.findByText(/send reset email/i);
    fireEvent.click(sendEmailItem);

    await waitFor(() => expect(sendUserResetEmail).toHaveBeenCalledWith('u4'));
  });

  it('opens "New user" from the toolbar dropdown, fills the dialog, and calls createUser', async () => {
    render(<MemoryRouter><Users /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('me')).toBeTruthy());

    // Open the toolbar "User actions" dropdown
    const toolbarTrigger = screen.getByLabelText('User actions');
    openDropdown(toolbarTrigger);

    const newUserItem = await screen.findByText('New user');
    fireEvent.click(newUserItem);

    // UserDialog should now be open
    const usernameInput = await screen.findByLabelText('Username');
    fireEvent.change(usernameInput, { target: { value: 'grace' } });
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Grace Hopper' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'grace@test.local' } });
    fireEvent.change(screen.getByLabelText('Add role'), { target: { value: 'data_analyst' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() =>
      expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ username: 'grace' })),
    );
  });
});
