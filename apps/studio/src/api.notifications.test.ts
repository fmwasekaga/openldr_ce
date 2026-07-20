import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listNotifications, markNotificationsRead } from './api';

describe('notifications api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ notifications: [], unreadCount: 0, total: 0 }), { status: 200, headers: { 'content-type': 'application/json' } })));
  });

  it('serializes list params and returns the parsed body', async () => {
    const result = await listNotifications({ limit: 25, offset: 50, unreadOnly: true, type: 'sync_failed', priority: 'critical' });

    expect(fetch).toHaveBeenCalledWith('/api/notifications?limit=25&offset=50&unreadOnly=true&type=sync_failed&priority=critical');
    expect(result).toEqual({ notifications: [], unreadCount: 0, total: 0 });
  });

  it('posts ids to mark notifications read', async () => {
    await markNotificationsRead(['x']);

    expect(fetch).toHaveBeenCalledWith('/api/notifications/read', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ['x'] }),
    });
  });
});
