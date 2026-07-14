import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerSyncRoutes } from './sync-routes';

const SITE = 'lab-A';

// A record as it arrives on the wire (SyncRecord & { seq }).
function rec(id: string, version: number, seq: number, siteId = SITE) {
  return { resourceType: 'Patient', id, version, seq, op: 'upsert' as const, siteId, resource: { resourceType: 'Patient', id } };
}

// Fake ctx: verifyToken resolves/rejects on demand; applyRemote is scripted per-id or default.
function fakeCtx(opts: {
  verify?: (token: string) => Promise<Record<string, unknown>>;
  apply?: (record: any) => Promise<'applied' | 'skipped'>;
}) {
  const calls: { apply: any[] } = { apply: [] };
  const ctx = {
    logger: { warn: () => {}, error: () => {} },
    auth: {
      verifyToken:
        opts.verify ?? (async () => ({ sub: 'client-1', site_id: SITE })),
    },
    fhirStore: {
      applyRemote: async (record: any) => {
        calls.apply.push(record);
        return opts.apply ? opts.apply(record) : 'applied';
      },
    },
  } as any;
  return { ctx, calls };
}

function appWith(ctx: any) {
  const app = Fastify();
  registerSyncRoutes(app, ctx);
  return app;
}

const AUTH = { authorization: 'Bearer tok' };

describe('sync routes — POST /api/sync/push', () => {
  it('401 when no Authorization header', async () => {
    const { ctx } = fakeCtx({});
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/push', payload: { fromSeq: 0, records: [] } });
    expect(res.statusCode).toBe(401);
  });

  it('401 when verifyToken rejects', async () => {
    const { ctx, calls } = fakeCtx({ verify: async () => { throw new Error('bad'); } });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/push', headers: AUTH, payload: { fromSeq: 0, records: [rec('p1', 1, 1)] } });
    expect(res.statusCode).toBe(401);
    expect(calls.apply.length).toBe(0);
  });

  it('403 when token has no site_id claim', async () => {
    const { ctx } = fakeCtx({ verify: async () => ({ sub: 'client-1' }) });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/push', headers: AUTH, payload: { fromSeq: 0, records: [rec('p1', 1, 1)] } });
    expect(res.statusCode).toBe(403);
  });

  it('400 when records is not an array', async () => {
    const { ctx } = fakeCtx({});
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/push', headers: AUTH, payload: { fromSeq: 0 } });
    expect(res.statusCode).toBe(400);
  });

  it('applies every same-site record, tallies applied, ackSeq = max seq', async () => {
    const { ctx, calls } = fakeCtx({});
    const records = [rec('p1', 1, 3), rec('p2', 1, 5), rec('p3', 1, 4)];
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/push', headers: AUTH, payload: { fromSeq: 2, records } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({ ackSeq: 5, applied: 3, skipped: 0, rejects: [] });
    expect(calls.apply.length).toBe(3);
    // applied in seq order
    expect(calls.apply.map((r: any) => r.seq)).toEqual([3, 4, 5]);
    expect(calls.apply[0].id).toBe('p1');
  });

  it('rejects a foreign-site record without applying it, still applies siblings', async () => {
    const { ctx, calls } = fakeCtx({});
    const records = [rec('p1', 1, 1), rec('evil', 2, 2, 'lab-B'), rec('p3', 1, 3)];
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/push', headers: AUTH, payload: { fromSeq: 0, records } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied).toBe(2);
    expect(body.skipped).toBe(0);
    expect(body.rejects).toEqual([{ id: 'evil', version: 2, seq: 2, reason: 'cross-site' }]);
    expect(body.ackSeq).toBe(3);
    expect(calls.apply.map((r: any) => r.id)).toEqual(['p1', 'p3']);
  });

  it('re-sent batch: applyRemote returns skipped for all → skipped tallied, applied 0', async () => {
    const { ctx } = fakeCtx({ apply: async () => 'skipped' });
    const records = [rec('p1', 1, 1), rec('p2', 1, 2)];
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/push', headers: AUTH, payload: { fromSeq: 0, records } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied).toBe(0);
    expect(body.skipped).toBe(2);
    expect(body.rejects).toEqual([]);
    expect(body.ackSeq).toBe(2);
  });

  it('a throwing applyRemote → apply-error reject, batch still 200, siblings applied', async () => {
    const { ctx } = fakeCtx({
      apply: async (r: any) => { if (r.id === 'boom') throw new Error('db down'); return 'applied'; },
    });
    const records = [rec('p1', 1, 1), rec('boom', 1, 2), rec('p3', 1, 3)];
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/push', headers: AUTH, payload: { fromSeq: 0, records } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied).toBe(2);
    expect(body.rejects).toEqual([{ id: 'boom', version: 1, seq: 2, reason: 'apply-error' }]);
    expect(body.ackSeq).toBe(3);
  });

  it('empty batch → ackSeq = fromSeq (cursor does not move backward)', async () => {
    const { ctx, calls } = fakeCtx({});
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/push', headers: AUTH, payload: { fromSeq: 42, records: [] } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ackSeq: 42, applied: 0, skipped: 0, rejects: [] });
    expect(calls.apply.length).toBe(0);
  });
});
