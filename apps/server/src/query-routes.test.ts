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

  it('rejects a create with an invalid body', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/custom-queries', payload: { connectorId: 'c1', sql: 'select 1' } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a PUT rename onto another query\'s name with 409', async () => {
    await app.inject({ method: 'POST', url: '/api/custom-queries', payload: { name: 'A', connectorId: 'c1', sql: 'select 1', params: [] } });
    const created = await app.inject({ method: 'POST', url: '/api/custom-queries', payload: { name: 'B', connectorId: 'c1', sql: 'select 1', params: [] } });
    const bId = created.json().id;
    const res = await app.inject({ method: 'PUT', url: `/api/custom-queries/${bId}`, payload: { name: 'A' } });
    expect(res.statusCode).toBe(409);
  });

  it('returns 404 on a PUT to a missing id', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/custom-queries/nope', payload: { name: 'X' } });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a PUT with an invalid body', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/custom-queries', payload: { name: 'C', connectorId: 'c1', sql: 'select 1', params: [] } });
    const id = created.json().id;
    const res = await app.inject({ method: 'PUT', url: `/api/custom-queries/${id}`, payload: { name: 123 } });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/query/run', () => {
  it('runs a read-only select and returns columns/rows/rowCount/ms', async () => {
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/query/run',
      payload: { connectorId: 'c1', sql: 'select 1 as n' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.columns).toEqual([{ key: 'n', label: 'n' }]);
    expect(body.rowCount).toBe(1);
    expect(typeof body.ms).toBe('number');
  });

  it('rejects a non-select statement', async () => {
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/query/run',
      payload: { connectorId: 'c1', sql: 'delete from t' } });
    expect(res.statusCode).toBe(400);
  });

  it('substitutes declared params before running', async () => {
    const deps = makeDeps();
    let seen = '';
    deps.runConnectorSql = async ({ sql }) => { seen = sql; return { columns: [], rows: [] }; };
    const app = await build(deps);
    await app.inject({ method: 'POST', url: '/api/query/run', payload: {
      connectorId: 'c1', sql: 'select * from t where f = {{param.facility}}',
      params: [{ id: 'facility', label: 'Facility', type: 'select', required: false }],
      values: { facility: 'Ndola' },
    } });
    expect(seen).toContain("f = 'Ndola'");
  });

  it('rejects a connector that is missing or disabled', async () => {
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/query/run',
      payload: { connectorId: 'nope', sql: 'select 1' } });
    expect(res.statusCode).toBe(404);
  });
});

describe('introspection', () => {
  it('lists sql-typed connectors', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/query/connectors' });
    expect(res.json()).toEqual([{ id: 'c1', name: 'PG', type: 'postgres' }]);
  });

  it('lists tables for a connector schema via information_schema', async () => {
    const deps = makeDeps();
    deps.runConnectorSql = async ({ sql }) => {
      expect(sql.toLowerCase()).toContain('information_schema.tables');
      return { columns: [], rows: [{ table_name: 'products' }, { table_name: 'orders' }] };
    };
    const app = await build(deps);
    const res = await app.inject({ method: 'GET', url: '/api/query/connectors/c1/schemas/public/tables' });
    expect(res.json()).toEqual(['products', 'orders']);
  });

  it('returns distinct options for a select param', async () => {
    const deps = makeDeps();
    deps.runConnectorSql = async () => ({ columns: [], rows: [{ v: 'A' }, { v: 'B' }] });
    const app = await build(deps);
    const res = await app.inject({ method: 'POST', url: '/api/query/param-options',
      payload: { connectorId: 'c1', optionsSql: 'select distinct v from t' } });
    expect(res.json()).toEqual(['A', 'B']);
  });
});

describe('datasets', () => {
  it('lists datasets', async () => {
    const deps = makeDeps();
    deps.datasets.list = async () => [{ id: 'd1', name: 'AMR Ndola', rowCount: 2, publishedTable: null }];
    const app = await build(deps);
    const res = await app.inject({ method: 'GET', url: '/api/query/datasets' });
    expect(res.json()).toEqual([{ id: 'd1', name: 'AMR Ndola', rowCount: 2 }]);
  });

  it('returns stored rows for an unpublished dataset', async () => {
    const deps = makeDeps();
    deps.datasets.getByName = async () => ({ name: 'AMR Ndola',
      columns: [{ key: 'org', label: 'org' }], rows: [{ org: 'E. coli' }], publishedTable: null });
    const app = await build(deps);
    const res = await app.inject({ method: 'GET', url: '/api/query/datasets/AMR%20Ndola' });
    expect(res.json().rows).toEqual([{ org: 'E. coli' }]);
  });
});
