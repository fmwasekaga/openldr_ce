import { describe, it, expect, vi } from 'vitest';
const listQ = vi.hoisted(() => vi.fn(async () => [{ entityType: 'terminology_system', entityId: 'http://x', attempts: 3, status: 'quarantined', lastError: 'boom', updatedAt: new Date() }]));
const retryQ = vi.hoisted(() => vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })));
const close = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@openldr/bootstrap', () => ({ createAppContext: async () => ({ sync: { listQuarantine: listQ, retryQuarantine: retryQ }, close }) }));
vi.mock('@openldr/config', () => ({ loadConfig: () => ({}) }));
import { runSyncQuarantineList, runSyncQuarantineRetry } from './sync';

describe('sync quarantine CLI', () => {
  it('list returns 0 and calls listQuarantine', async () => {
    expect(await runSyncQuarantineList({ json: true })).toBe(0);
    expect(listQ).toHaveBeenCalled();
  });
  it('retry returns 0 on ok and calls retryQuarantine', async () => {
    expect(await runSyncQuarantineRetry('terminology_system', 'http://x', { json: true })).toBe(0);
    expect(retryQ).toHaveBeenCalledWith('terminology_system', 'http://x');
  });
  it('retry returns 1 when ok:false', async () => {
    retryQ.mockResolvedValueOnce({ ok: false, error: 'nope' });
    expect(await runSyncQuarantineRetry('terminology_system', 'http://x', { json: true })).toBe(1);
  });
});
