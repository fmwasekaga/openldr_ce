import { describe, expect, it, vi } from 'vitest';
import { recordAuditEvent } from './record-audit';

const nullLogger = { info() {}, warn() {}, error() {}, debug() {} } as any;

describe('recordAuditEvent', () => {
  it('merges actor + details into a single audit record', async () => {
    const record = vi.fn(async (e) => e);
    await recordAuditEvent({ audit: { record } as any, logger: nullLogger },
      { actorType: 'cli', actorId: null, actorName: 'alice' },
      { action: 'user.create', entityType: 'user', entityId: 'u1', metadata: { username: 'bob' } });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'cli', actorName: 'alice', action: 'user.create', entityType: 'user', entityId: 'u1',
    }));
  });
  it('never throws when the store rejects (best-effort)', async () => {
    const record = vi.fn(async () => { throw new Error('db down'); });
    await expect(recordAuditEvent({ audit: { record } as any, logger: nullLogger },
      { actorType: 'cli', actorId: null, actorName: 'a' },
      { action: 'x', entityType: 'y', entityId: 'z' })).resolves.toBeUndefined();
  });
});
