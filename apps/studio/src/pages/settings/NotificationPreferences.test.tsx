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
  it('seeds checkboxes from the disabled array (unchecked for disabled types, checked otherwise)', async () => {
    render(<MemoryRouter><NotificationPreferences /></MemoryRouter>);
    const authFailed = await screen.findByTestId('notif-enabled-auth_failed');
    const syncFailed = screen.getByTestId('notif-enabled-sync_failed');
    expect(authFailed.getAttribute('data-state')).toBe('unchecked');
    expect(syncFailed.getAttribute('data-state')).toBe('checked');
  });

  it('Save is disabled until something changes, then calls saveNotificationPrefs with every type + minPriority', async () => {
    (api.saveNotificationPrefs as any).mockResolvedValue(undefined);
    render(<MemoryRouter><NotificationPreferences /></MemoryRouter>);

    const saveBtn = await screen.findByTestId('notif-save');
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);

    // Re-enable auth_failed (currently disabled).
    fireEvent.click(screen.getByTestId('notif-enabled-auth_failed'));
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(saveBtn);

    await waitFor(() => expect(api.saveNotificationPrefs).toHaveBeenCalledWith(
      [
        { type: 'sync_diverged', enabled: true },
        { type: 'sync_failed', enabled: true },
        { type: 'sync_quarantined', enabled: true },
        { type: 'plugin_crashed', enabled: true },
        { type: 'auth_failed', enabled: true },
        { type: 'site_revoked', enabled: true },
      ],
      'info',
    ));
    expect(toast.success).toHaveBeenCalled();
  });

  it('changing the min-priority select marks the form dirty', async () => {
    render(<MemoryRouter><NotificationPreferences /></MemoryRouter>);
    const saveBtn = await screen.findByTestId('notif-save');
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);

    fireEvent.keyDown(screen.getByTestId('notif-min-priority'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: /warning/i }));

    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);
  });
});
