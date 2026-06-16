import { describe, it, expect, vi } from 'vitest';
import { type Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import type { Logger } from '@openldr/core';
import { internalMigrations, type InternalSchema } from '@openldr/db';
import { createAuditStore, safeRecord, type AuditStore, type AuditEvent } from './store';

const logger = { error: vi.fn(), info: vi.fn() } as unknown as Logger;
const ev = { id: 'a', occurredAt: 'x' } as AuditEvent;
const input = { actorType: 'system' as const, actorName: 'system', action: 'x.y', entityType: 'e', entityId: '1' };

async function makeMigratedDb(): Promise<Kysely<InternalSchema>> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<InternalSchema>;
  for (const migration of Object.values(internalMigrations)) {
    await migration.up(db);
  }
  return db;
}

describe('safeRecord', () => {
  it('forwards to store.record', async () => {
    const store = { record: vi.fn(async () => ev), list: vi.fn(), count: vi.fn(), get: vi.fn() } as AuditStore;
    await safeRecord(store, logger, input);
    expect(store.record).toHaveBeenCalledWith(input);
  });
  it('swallows a throwing store and logs', async () => {
    const store = { record: vi.fn(async () => { throw new Error('db down'); }), list: vi.fn(), count: vi.fn(), get: vi.fn() } as AuditStore;
    await expect(safeRecord(store, logger, input)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('createAuditStore', () => {
  it('lists with offset and counts matching filters', async () => {
    const db = await makeMigratedDb();
    const store = createAuditStore(db);

    for (const [i, eventInput] of [
      { ...input, action: 'alpha.create', entityType: 'specimen', entityId: '1' },
      { ...input, action: 'beta.update', entityType: 'specimen', entityId: '2' },
      { ...input, action: 'alpha.create', entityType: 'result', entityId: '3' },
      { ...input, action: 'beta.update', entityType: 'result', entityId: '4' },
      { ...input, action: 'alpha.create', entityType: 'specimen', entityId: '5' },
    ].entries()) {
      const event = await store.record(eventInput);
      await db
        .updateTable('audit_events')
        .set({ occurred_at: new Date(Date.UTC(2026, 0, 1, 0, i)) })
        .where('id', '=', event.id)
        .execute();
    }

    await expect(store.count({})).resolves.toBe(5);
    await expect(store.count({ action: 'alpha.create' })).resolves.toBe(3);

    const page = await store.list({ limit: 2, offset: 2 });
    expect(page.map((event) => event.entityId)).toEqual(['3', '2']);
  });
});
