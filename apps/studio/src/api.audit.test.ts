import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuditEvent, queryAudit } from './api';

describe('audit api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ events: [], total: 0 }), { status: 200, headers: { 'content-type': 'application/json' } })));
  });

  it('serializes only non-empty audit query params', async () => {
    await queryAudit({ action: 'user.disable', entityType: '', limit: 25, offset: 50 });

    expect(fetch).toHaveBeenCalledWith('/api/audit?action=user.disable&limit=25&offset=50');
  });

  it('fetches an audit event by id', async () => {
    await getAuditEvent('a1');

    expect(fetch).toHaveBeenCalledWith('/api/audit/a1');
  });
});
