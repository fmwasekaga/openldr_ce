import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import type { NotificationListParams } from '@/api';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const EMPTY_RESULT = { notifications: [], unreadCount: 0, total: 0 };
const SYNC_FAILED_NOTIFICATION = {
  id: 'n1',
  type: 'sync_failed',
  priority: 'critical',
  title: 'Sync failed',
  body: 'Push to central failed',
  linkTo: '#/settings/sync',
  createdAt: '2026-07-19T10:00:00Z',
  readAt: null,
  metadata: null,
};

vi.mock('@/api', () => ({
  // AppShell's header also renders the NotificationBell, which independently
  // calls listNotifications({ unreadOnly: true, limit: 50 }) on mount. A single
  // mockResolvedValueOnce would race with that call and could be consumed by
  // the bell instead of the page, so the mock branches on the request shape
  // instead of relying on call order.
  listNotifications: vi.fn(async (params: NotificationListParams = {}) =>
    (params.unreadOnly ? EMPTY_RESULT : { notifications: [SYNC_FAILED_NOTIFICATION], unreadCount: 1, total: 1 })),
  markNotificationsRead: vi.fn(async () => undefined),
  listPluginUis: vi.fn(async () => []),
}));
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasCapability: () => true }),
}));

import { listNotifications, markNotificationsRead } from '@/api';
import { Notifications } from './Notifications';

describe('Notifications page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listNotifications as ReturnType<typeof vi.fn>).mockImplementation(async (params: NotificationListParams = {}) =>
      (params.unreadOnly ? EMPTY_RESULT : { notifications: [SYNC_FAILED_NOTIFICATION], unreadCount: 1, total: 1 }));
  });

  it('renders the empty state when there are no notifications', async () => {
    (listNotifications as ReturnType<typeof vi.fn>).mockImplementation(async () => EMPTY_RESULT);
    render(<MemoryRouter><Notifications /></MemoryRouter>);
    await waitFor(() => expect(listNotifications).toHaveBeenCalled());
    expect(await screen.findByText('No notifications')).toBeInTheDocument();
  });

  it('marks a row read and navigates to its link on click', async () => {
    render(<MemoryRouter><Notifications /></MemoryRouter>);
    // Both the Type and Title columns resolve to the same trigger label ("Sync
    // failed"), so this notification renders that text twice in the row; either
    // cell click bubbles to the TableRow's onClick.
    const [cell] = await screen.findAllByText('Sync failed', {}, { timeout: 5000 });
    fireEvent.click(cell);

    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledWith(['n1']), { timeout: 5000 });
    expect(mockNavigate).toHaveBeenCalledWith('/settings/sync');
  }, 20000);
});
