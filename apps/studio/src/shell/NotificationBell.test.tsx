import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/api', () => ({
  listNotifications: vi.fn(async () => ({ notifications: [], unreadCount: 0, total: 0 })),
  markNotificationsRead: vi.fn(async () => undefined),
  markAllNotificationsRead: vi.fn(async () => undefined),
}));

import { NotificationBell } from './NotificationBell';
import { useNotificationsStore } from './notifications-store';
import * as api from '@/api';
import type { Notification } from '@/api';

describe('NotificationBell', () => {
  beforeEach(() => {
    useNotificationsStore.setState({ notifications: [], unreadCount: 0, latest: null });
    vi.mocked(api.listNotifications).mockReset();
    vi.mocked(api.listNotifications).mockResolvedValue({ notifications: [], unreadCount: 0, total: 0 });
  });

  it('renders the bell button with its aria-label and no unread badge', async () => {
    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    );

    const button = await screen.findByRole('button', { name: 'Open notifications' });
    expect(button).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();

    await waitFor(() => expect(api.listNotifications).toHaveBeenCalledWith({ limit: 50, unreadOnly: true }));
  });

  it('toasts a notification that arrives on a later poll, but not the initial backlog', async () => {
    const newNotification: Notification = {
      id: 'n2', type: 'sync_failed', priority: 'critical',
      title: 'Sync failed', body: null, linkTo: null,
      createdAt: '2026-07-20T00:00:00Z', readAt: null, metadata: null,
    };
    vi.mocked(api.listNotifications)
      .mockResolvedValueOnce({ notifications: [], unreadCount: 0, total: 0 })
      .mockResolvedValueOnce({ notifications: [newNotification], unreadCount: 1, total: 1 });

    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    );

    await waitFor(() => expect(api.listNotifications).toHaveBeenCalledTimes(1));
    expect(useNotificationsStore.getState().latest).toBeNull();

    // Simulate the next poll firing (the component also refreshes on window focus).
    window.dispatchEvent(new Event('focus'));

    await waitFor(() => expect(api.listNotifications).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(useNotificationsStore.getState().latest?.id).toBe('n2'));
    expect(useNotificationsStore.getState().notifications.map((n) => n.id)).toEqual(['n2']);
  });
});
