import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getNotificationPrefs: vi.fn(), saveNotificationPrefs: vi.fn() };
});
import * as api from '@/api';
import { toast } from 'sonner';
import { NotificationPreferences } from './NotificationPreferences';

beforeEach(() => {
  vi.clearAllMocks();
  (api.getNotificationPrefs as any).mockResolvedValue({
    disabled: ['auth_failed'],
    minPriority: 'info',
  });
});

describe('NotificationPreferences page', () => {
  it('seeds switches from the disabled array (unchecked for disabled types, checked otherwise)', async () => {
    render(<MemoryRouter><NotificationPreferences /></MemoryRouter>);
    const authFailed = await screen.findByTestId('notif-enabled-auth_failed');
    const syncFailed = screen.getByTestId('notif-enabled-sync_failed');
    expect(authFailed.getAttribute('aria-checked')).toBe('false');
    expect(syncFailed.getAttribute('aria-checked')).toBe('true');
  });

  it('toggling a switch auto-applies immediately, calling saveNotificationPrefs with every type + minPriority', async () => {
    (api.saveNotificationPrefs as any).mockResolvedValue(undefined);
    render(<MemoryRouter><NotificationPreferences /></MemoryRouter>);

    const authFailed = await screen.findByTestId('notif-enabled-auth_failed');
    expect(authFailed.getAttribute('aria-checked')).toBe('false');

    // Re-enable auth_failed (currently disabled) — no Save button, this should save right away.
    fireEvent.click(authFailed);

    await waitFor(() => expect(api.saveNotificationPrefs).toHaveBeenCalledWith(
      [
        { type: 'sync_diverged', enabled: true },
        { type: 'sync_failed', enabled: true },
        { type: 'sync_quarantined', enabled: true },
        { type: 'plugin_crashed', enabled: true },
        { type: 'system_crashed', enabled: true },
        { type: 'auth_failed', enabled: true },
        { type: 'site_revoked', enabled: true },
        { type: 'terminology_import_done', enabled: true },
        { type: 'terminology_import_failed', enabled: true },
      ],
      'info',
    ));
    expect(toast.success).toHaveBeenCalled();
    expect(screen.queryByTestId('notif-save')).toBeNull();
  });

  it('reverts the toggle and shows an error toast when the save fails', async () => {
    (api.saveNotificationPrefs as any).mockRejectedValue(new Error('boom'));
    render(<MemoryRouter><NotificationPreferences /></MemoryRouter>);

    const authFailed = await screen.findByTestId('notif-enabled-auth_failed');
    expect(authFailed.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(authFailed);

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await waitFor(() => expect(authFailed.getAttribute('aria-checked')).toBe('false'));
  });

  it('changing the min-priority select auto-applies immediately', async () => {
    (api.saveNotificationPrefs as any).mockResolvedValue(undefined);
    render(<MemoryRouter><NotificationPreferences /></MemoryRouter>);
    await screen.findByTestId('notif-min-priority');

    fireEvent.keyDown(screen.getByTestId('notif-min-priority'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: /warning/i }));

    await waitFor(() => expect(api.saveNotificationPrefs).toHaveBeenCalledWith(
      expect.any(Array),
      'warning',
    ));
  });
});
