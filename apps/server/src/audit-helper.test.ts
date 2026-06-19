import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { actorFromRequest, recordAudit } from './audit-helper';
import './auth-plugin'; // req.user augmentation

const reqWith = (user: unknown) => ({ user } as unknown as FastifyRequest);

function recordingCtx() {
  const events: unknown[] = [];
  const ctx = {
    audit: { record: async (e: unknown) => { events.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
  } as unknown as AppContext;
  return { ctx, events };
}

describe('actorFromRequest', () => {
  it('maps req.user to a user actor', () => {
    const a = actorFromRequest(reqWith({ id: 'u1', username: 'ada', displayName: 'Ada', roles: ['lab_admin'] }));
    expect(a).toEqual({ actorType: 'user', actorId: 'u1', actorName: 'ada' });
  });
  it('falls back to a system actor when no req.user', () => {
    const a = actorFromRequest(reqWith(undefined));
    expect(a).toEqual({ actorType: 'system', actorId: null, actorName: 'System' });
  });
});

describe('recordAudit', () => {
  it('records an event merging actor + details', async () => {
    const { ctx, events } = recordingCtx();
    await recordAudit(ctx, reqWith({ id: 'u1', username: 'ada', displayName: null, roles: [] }), {
      action: 'thing.create', entityType: 'thing', entityId: 't1', before: null, after: { x: 1 },
    });
    expect(events).toEqual([{ actorType: 'user', actorId: 'u1', actorName: 'ada', action: 'thing.create', entityType: 'thing', entityId: 't1', before: null, after: { x: 1 } }]);
  });
  it('never throws when the store rejects (best-effort)', async () => {
    const ctx = { audit: { record: async () => { throw new Error('db down'); } }, logger: { error() {}, warn() {}, info() {} } } as unknown as AppContext;
    await expect(recordAudit(ctx, reqWith({ id: 'u1', username: 'ada', displayName: null, roles: [] }), { action: 'x', entityType: 'y', entityId: 'z' })).resolves.toBeUndefined();
  });
});
