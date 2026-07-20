import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/api', () => ({
  listNotifications: vi.fn(async () => ({ notifications: [], unreadCount: 0, total: 0 })),
  markNotificationsRead: vi.fn(async () => undefined),
  markAllNotificationsRead: vi.fn(async () => undefined),
}));

import { NotificationBell } from './NotificationBell';

describe('NotificationBell', () => {
  it('renders the bell button with its aria-label and no unread badge', async () => {
    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    );

    const button = await screen.findByRole('button', { name: 'notifications.ariaOpen' });
    expect(button).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();

    const api = await import('@/api');
    await waitFor(() => expect(api.listNotifications).toHaveBeenCalledWith({ limit: 50, unreadOnly: true }));
  });
});
