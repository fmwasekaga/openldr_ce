import { describe, it, expect } from 'vitest';
import { buildApp } from './app';
import type { AppContext } from '@openldr/bootstrap';
import { HealthRegistry, createLogger } from '@openldr/core';

type FakeAdmin = AppContext['terminology']['admin'];

/** Minimal in-memory fake admin store for route tests.
 *  The harness hand-mocks ctx (no pg-mem DB available here), so we use a fake.
 *  @openldr/db is not a dep of @openldr/server — types are derived from AppContext.
 *  The LOINC publisher is pre-seeded to satisfy the "LOINC present" assertion. */
function buildFakeAdmin(): FakeAdmin {
  type PubRole = 'local' | 'standard' | 'external';
  type PubRow = { id: string; name: string; role: PubRole; icon: string | null; seeded: boolean; sortOrder: number };
  const publishers: PubRow[] = [
    { id: 'pub-loinc', name: 'LOINC', role: 'standard', icon: null, seeded: true, sortOrder: 1 },
  ];
  const systems: Array<{ id: string; systemCode: string; systemName: string; url: string | null; systemVersion: string | null; description: string | null; active: boolean; publisherId: string | null; seeded: boolean }> = [];
  let pubSeq = 0;
  let sysSeq = 0;

  return {
    publishers: {
      async list() { return [...publishers]; },
      async create(input) {
        const p = { id: `pub-test-${++pubSeq}`, name: input.name, role: input.role, icon: input.icon ?? null, seeded: false, sortOrder: 100 };
        publishers.push(p);
        return p;
      },
      async update(id, input) {
        const p = publishers.find((x) => x.id === id);
        if (!p) throw Object.assign(new Error(`not found: ${id}`), { kind: 'not-found' });
        Object.assign(p, { name: input.name, role: input.role, icon: input.icon ?? null });
        return p;
      },
      async delete(id) {
        const idx = publishers.findIndex((x) => x.id === id);
        if (idx === -1) throw Object.assign(new Error(`not found: ${id}`), { kind: 'not-found' });
        publishers.splice(idx, 1);
      },
      async deletionImpact() { return { systemCount: 0, termCount: 0 }; },
    },
    codingSystems: {
      async list(publisherId) { return publisherId ? systems.filter((s) => s.publisherId === publisherId) : [...systems]; },
      async create(input) {
        const s = { id: `cs-test-${++sysSeq}`, systemCode: input.systemCode, systemName: input.systemName, url: input.url ?? null, systemVersion: input.systemVersion ?? null, description: input.description ?? null, active: input.active, publisherId: input.publisherId ?? null, seeded: false };
        systems.push(s);
        return s;
      },
      async update(id, input) {
        const s = systems.find((x) => x.id === id);
        if (!s) throw Object.assign(new Error(`not found: ${id}`), { kind: 'not-found' });
        Object.assign(s, { systemName: input.systemName, url: input.url ?? null, systemVersion: input.systemVersion ?? null, description: input.description ?? null, active: input.active, publisherId: input.publisherId ?? null });
        return s;
      },
      async delete(id) {
        const idx = systems.findIndex((x) => x.id === id);
        if (idx === -1) throw Object.assign(new Error(`not found: ${id}`), { kind: 'not-found' });
        systems.splice(idx, 1);
      },
      async deletionImpact() { return { termCount: 0, mappingCount: 0 }; },
      async upsertByUrl() { /* no-op in fake */ },
    },
  };
}

function ctxWith(status: 'up' | 'down'): AppContext {
  const health = new HealthRegistry();
  health.register({ name: 'auth', check: async () => ({ status, latencyMs: 1 }) });
  return {
    logger: createLogger({ level: 'silent' }),
    auth: {} as never,
    blob: {} as never,
    eventing: {} as never,
    store: {} as never,
    health,
    reporting: {} as never,
    audit: {} as never,
    users: {} as never,
    terminology: { ops: {} as never, admin: buildFakeAdmin() },
    dashboards: {} as never,
    cfg: {} as never,
    async close() {},
  };
}

describe('GET /health', () => {
  it('returns 200 and overall up when all checks pass', async () => {
    const app = buildApp(ctxWith('up'));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('up');
    await app.close();
  });

  it('returns 503 when any check is down', async () => {
    const app = buildApp(ctxWith('down'));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json().status).toBe('down');
    await app.close();
  });
});

describe('terminology admin routes', () => {
  it('lists seeded publishers and creates a custom publisher + system', async () => {
    const app = buildApp(ctxWith('up'));

    const list = await app.inject({ method: 'GET', url: '/api/terminology/publishers' });
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.body).some((p: { name: string }) => p.name === 'LOINC')).toBe(true);

    const created = await app.inject({ method: 'POST', url: '/api/terminology/publishers', payload: { name: 'My Lab', role: 'local' } });
    expect(created.statusCode).toBe(201);

    const sys = await app.inject({ method: 'POST', url: '/api/terminology/systems', payload: { systemCode: 'MYX', systemName: 'My X', active: true } });
    expect(sys.statusCode).toBe(201);

    await app.close();
  });
});
