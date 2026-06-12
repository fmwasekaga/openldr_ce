import { describe, it, expect, vi } from 'vitest';
import { createAuth } from './index';

const cfg = { issuerUrl: 'http://localhost:8080/realms/master' };

describe('createAuth', () => {
  it('reports up when the discovery doc returns 200', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    const auth = createAuth(cfg, { fetchFn });
    const r = await auth.healthCheck();
    expect(r.status).toBe('up');
    expect(fetchFn).toHaveBeenCalledWith(
      'http://localhost:8080/realms/master/.well-known/openid-configuration',
      expect.anything(),
    );
  });

  it('reports down when discovery returns non-200', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 404 }) as Response);
    const auth = createAuth(cfg, { fetchFn });
    const r = await auth.healthCheck();
    expect(r.status).toBe('down');
    expect(r.detail).toContain('404');
  });
});
