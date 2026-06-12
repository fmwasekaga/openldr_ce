import { describe, it, expect } from 'vitest';
import { probe } from './probe';

describe('probe', () => {
  it('returns up with detail on success', async () => {
    const r = await probe(async () => 'ok');
    expect(r.status).toBe('up');
    expect(r.detail).toBe('ok');
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns down with redacted detail on throw', async () => {
    const r = await probe(async () => {
      throw new Error('connect postgres://u:pw@h/db failed');
    });
    expect(r.status).toBe('down');
    expect(r.detail).toContain('u:***@h');
  });
});
