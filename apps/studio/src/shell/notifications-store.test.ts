import { describe, it, expect, beforeEach } from 'vitest';
import { useNotificationsStore } from './notifications-store';

const mk = (id: string, readAt: string | null = null) => ({
  id, type: 'sync_failed', priority: 'warning', title: id, body: null, linkTo: null,
  createdAt: '2026-07-20T00:00:00Z', readAt, metadata: null,
} as const);

describe('notifications-store', () => {
  beforeEach(() => useNotificationsStore.setState({ notifications: [], unreadCount: 0, latest: null }));

  it('setAll replaces contents', () => {
    useNotificationsStore.getState().setAll([mk('a')], 1);
    expect(useNotificationsStore.getState().unreadCount).toBe(1);
  });

  it('prepend adds unread + sets latest, dedupes by id', () => {
    const s = useNotificationsStore.getState();
    s.prepend(mk('a'));
    expect(useNotificationsStore.getState().unreadCount).toBe(1);
    expect(useNotificationsStore.getState().latest?.id).toBe('a');
    useNotificationsStore.getState().prepend(mk('a'));
    expect(useNotificationsStore.getState().notifications).toHaveLength(1);
  });

  it('markRead removes ids + decrements', () => {
    useNotificationsStore.getState().setAll([mk('a'), mk('b')], 2);
    useNotificationsStore.getState().markRead(['a']);
    expect(useNotificationsStore.getState().unreadCount).toBe(1);
    expect(useNotificationsStore.getState().notifications.map((n) => n.id)).toEqual(['b']);
  });

  it('markAllRead clears', () => {
    useNotificationsStore.getState().setAll([mk('a')], 1);
    useNotificationsStore.getState().markAllRead();
    expect(useNotificationsStore.getState().unreadCount).toBe(0);
  });
});
