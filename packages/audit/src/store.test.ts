import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '@openldr/core';
import { safeRecord, type AuditStore, type AuditEvent } from './store';

const logger = { error: vi.fn(), info: vi.fn() } as unknown as Logger;
const ev = { id: 'a', occurredAt: 'x' } as AuditEvent;
const input = { actorType: 'system' as const, actorName: 'system', action: 'x.y', entityType: 'e', entityId: '1' };

describe('safeRecord', () => {
  it('forwards to store.record', async () => {
    const store = { record: vi.fn(async () => ev), list: vi.fn(), get: vi.fn() } as AuditStore;
    await safeRecord(store, logger, input);
    expect(store.record).toHaveBeenCalledWith(input);
  });
  it('swallows a throwing store and logs', async () => {
    const store = { record: vi.fn(async () => { throw new Error('db down'); }), list: vi.fn(), get: vi.fn() } as AuditStore;
    await expect(safeRecord(store, logger, input)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});
