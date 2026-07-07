import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerQueryRoutes, type QueryRouteDeps } from './query-routes';

// Minimal in-memory fakes.
function makeDeps(): QueryRouteDeps {
  const store = new Map<string, any>();
  return {
    customQueries: {
      async create(q) { store.set(q.id, { ...q }); },
      async get(id) { return store.get(id) ?? null; },
      async getByName(name) { return [...store.values()].find((q) => q.name === name) ?? null; },
      async list() { return [...store.values()]; },
      async update(id, patch) { store.set(id, { ...store.get(id), ...patch }); },
      async remove(id) { store.delete(id); },
    },
    connectors: {
      async list() { return [{ id: 'c1', name: 'PG', type: 'postgres', enabled: true } as any]; },
      async get(id) { return id === 'c1' ? ({ id, name: 'PG', type: 'postgres', enabled: true } as any) : null; },
    },
    datasets: { async list() { return []; }, async getByName() { return null; } },
    runConnectorSql: async ({ sql }) => ({ columns: [{ key: 'n', label: 'n' }], rows: [{ n: 1 }], sql } as any),
  };
}

async function build(deps = makeDeps()): Promise<FastifyInstance> {
  const app = Fastify();
  // Inject an authenticated actor with the analyst role.
  app.addHook('preHandler', async (req) => { (req as any).user = { sub: 'u1', roles: ['data_analyst'] }; });
  registerQueryRoutes(app, { logger: console } as any, deps);
  await app.ready();
  return app;
}

describe('custom-queries CRUD', () => {
  let app: FastifyInstance;
  beforeEach(async () => { app = await build(); });

  it('creates and lists a custom query', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/custom-queries',
      payload: { name: 'Q1', connectorId: 'c1', sql: 'select 1', params: [] } });
    expect(create.statusCode).toBe(200);
    const id = create.json().id;
    const list = await app.inject({ method: 'GET', url: '/api/custom-queries' });
    expect(list.json().map((q: any) => q.id)).toContain(id);
  });

  it('rejects a create with a duplicate name', async () => {
    await app.inject({ method: 'POST', url: '/api/custom-queries', payload: { name: 'Dup', connectorId: 'c1', sql: 'select 1', params: [] } });
    const dup = await app.inject({ method: 'POST', url: '/api/custom-queries', payload: { name: 'Dup', connectorId: 'c1', sql: 'select 1', params: [] } });
    expect(dup.statusCode).toBe(409);
  });
});
