import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerQueryRoutes, type QueryRouteDeps } from './query-routes';

// recordAudit reads ctx.audit.record (and ctx.logger.error on failure) — provide a vi.fn() stub.
const auditRecord = vi.fn(async () => {});
function fakeCtx(): any {
  return { logger: console, audit: { record: auditRecord } };
}

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
  registerQueryRoutes(app, fakeCtx(), deps);
  await app.ready();
  return app;
}

describe('custom-queries CRUD', () => {
  let app: FastifyInstance;
  beforeEach(async () => { auditRecord.mockClear(); app = await build(); });

  it('creates and lists a custom query', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/custom-queries',
      payload: { name: 'Q1', connectorId: 'c1', sql: 'select 1', params: [] } });
    expect(create.statusCode).toBe(200);
    const id = create.json().id;
    const list = await app.inject({ method: 'GET', url: '/api/custom-queries' });
    expect(list.json().map((q: any) => q.id)).toContain(id);
    // The create is audited.
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({ action: 'customQuery.create', entityId: id }));
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

  it('returns a total (count) only when a limit is supplied', async () => {
    const app = await build();
    const paged = await app.inject({ method: 'POST', url: '/api/query/run',
      payload: { connectorId: 'c1', sql: 'select 1 as n', limit: 50, offset: 0 } });
    expect(paged.json().total).toBe(1);
    const unpaged = await app.inject({ method: 'POST', url: '/api/query/run',
      payload: { connectorId: 'c1', sql: 'select 1 as n' } });
    expect(unpaged.json().total).toBeUndefined();
  });

  it('skips the total (count) for a microsoft-sql connector — no derived-table count query', async () => {
    const deps = makeDeps();
    deps.connectors.get = (async (id: string) => (id === 'c1' ? { id, name: 'MS', type: 'microsoft-sql', enabled: true } : null)) as any;
    const calls: string[] = [];
    deps.runConnectorSql = (async ({ sql }: { sql: string }) => { calls.push(sql); return { columns: [{ key: 'n', label: 'n' }], rows: [{ n: 1 }] }; }) as any;
    const app = await build(deps);
    const paged = await app.inject({ method: 'POST', url: '/api/query/run',
      payload: { connectorId: 'c1', sql: 'select 1 as n', limit: 50, offset: 0 } });
    expect(paged.json().total).toBeUndefined();
    // The count(*) derived-table query (invalid T-SQL for ORDER BY queries) must not be issued.
    expect(calls.some((s) => /count\(\*\)/i.test(s))).toBe(false);
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

  it('delegates pagination to runConnectorSql via the inner sql plus rowCap/offset', async () => {
    const deps = makeDeps();
    const calls: { connectorId: string; sql: string; rowCap?: number; offset?: number }[] = [];
    deps.runConnectorSql = async (input) => { calls.push(input); return { columns: [{ key: 'n', label: 'n' }], rows: [{ n: 1 }] }; };
    const app = await build(deps);
    const res = await app.inject({ method: 'POST', url: '/api/query/run',
      payload: { connectorId: 'c1', sql: 'select 1 as n', limit: 50, offset: 10 } });
    expect(res.statusCode).toBe(200);
    // The first call is the paginated run: the raw inner sql (no manual limit/offset wrapper),
    // with pagination expressed via rowCap/offset for runConnectorSql to apply per-dialect.
    expect(calls[0]).toEqual({ connectorId: 'c1', sql: 'select 1 as n', rowCap: 50, offset: 10 });
  });

  it('rejects a connector that is missing or disabled', async () => {
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/query/run',
      payload: { connectorId: 'nope', sql: 'select 1' } });
    expect(res.statusCode).toBe(404);
  });

  it('caps returned rows at ROW_CAP even when no limit is supplied', async () => {
    const deps = makeDeps();
    deps.runConnectorSql = async () => ({ columns: [{ key: 'n', label: 'n' }], rows: Array.from({ length: 1500 }, (_, i) => ({ n: i })) });
    const app = await build(deps);
    const res = await app.inject({ method: 'POST', url: '/api/query/run',
      payload: { connectorId: 'c1', sql: 'select n from big_table' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().rowCount).toBe(1000);
  });
});

describe('introspection', () => {
  it('lists sql-typed connectors', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/query/connectors' });
    expect(res.json()).toEqual([{ id: 'c1', name: 'PG', type: 'postgres' }]);
  });

  it('lists postgres and microsoft-sql connectors, excluding non-SQL types', async () => {
    // Both Postgres and SQL Server are dialect-aware end to end (run + introspection); a non-SQL
    // dhis2 connector is still excluded.
    const deps = makeDeps();
    deps.connectors.list = async () => [
      { id: 'c1', name: 'PG', type: 'postgres', enabled: true } as any,
      { id: 'c2', name: 'SQLSvr', type: 'microsoft-sql', enabled: true } as any,
      { id: 'c3', name: 'DHIS2', type: 'dhis2', enabled: true } as any,
    ];
    const app = await build(deps);
    const res = await app.inject({ method: 'GET', url: '/api/query/connectors' });
    expect(res.json()).toEqual([
      { id: 'c1', name: 'PG', type: 'postgres' },
      { id: 'c2', name: 'SQLSvr', type: 'microsoft-sql' },
    ]);
  });

  it('issues the MSSQL system-schema filter for a microsoft-sql connector', async () => {
    const deps = makeDeps();
    deps.connectors.get = async (id) => (id === 'c2' ? ({ id, name: 'SQLSvr', type: 'microsoft-sql', enabled: true } as any) : null);
    let seenSql = '';
    deps.runConnectorSql = async ({ sql }) => { seenSql = sql; return { columns: [], rows: [] }; };
    const app = await build(deps);
    const res = await app.inject({ method: 'GET', url: '/api/query/connectors/c2/schemas' });
    expect(res.statusCode).toBe(200);
    expect(seenSql).toContain("'sys'");
    expect(seenSql).not.toContain('pg_catalog');
  });

  it('lists mysql connectors alongside postgres and microsoft-sql', async () => {
    const deps = makeDeps();
    deps.connectors.list = async () => [
      { id: 'c1', name: 'PG', type: 'postgres', enabled: true } as any,
      { id: 'c2', name: 'SQLSvr', type: 'microsoft-sql', enabled: true } as any,
      { id: 'c3', name: 'MyDB', type: 'mysql', enabled: true } as any,
    ];
    const app = await build(deps);
    const res = await app.inject({ method: 'GET', url: '/api/query/connectors' });
    expect(res.json()).toEqual([
      { id: 'c1', name: 'PG', type: 'postgres' },
      { id: 'c2', name: 'SQLSvr', type: 'microsoft-sql' },
      { id: 'c3', name: 'MyDB', type: 'mysql' },
    ]);
  });

  it('issues the MySQL system-schema filter for a mysql connector', async () => {
    const deps = makeDeps();
    deps.connectors.get = async (id) => (id === 'c3' ? ({ id, name: 'MyDB', type: 'mysql', enabled: true } as any) : null);
    let capturedSql = '';
    deps.runConnectorSql = async ({ sql }) => { capturedSql = sql; return { columns: [], rows: [] }; };
    const app = await build(deps);
    const res = await app.inject({ method: 'GET', url: '/api/query/connectors/c3/schemas' });
    expect(res.statusCode).toBe(200);
    expect(capturedSql).toContain('not in (');
    expect(capturedSql).toContain("'information_schema'");
    expect(capturedSql).toContain("'mysql'");
    expect(capturedSql).toContain("'performance_schema'");
    expect(capturedSql).toContain("'sys'");
    expect(capturedSql).not.toContain('pg_catalog');
  });

  it('reads MySQL uppercase information_schema keys (SCHEMA_NAME/TABLE_NAME) positionally', async () => {
    // MySQL's information_schema returns the column UPPERCASE, unlike Postgres/SQL Server. The
    // handler must read the single selected column positionally, not by a lowercase `schema_name`
    // key (which would yield ["undefined"]).
    const deps = makeDeps();
    deps.connectors.get = async (id) => (id === 'c3' ? ({ id, name: 'MyDB', type: 'mysql', enabled: true } as any) : null);
    deps.runConnectorSql = async ({ sql }) =>
      sql.includes('information_schema.tables')
        ? { columns: [], rows: [{ TABLE_NAME: 'patients' }, { TABLE_NAME: 'observations' }] } as any
        : { columns: [], rows: [{ SCHEMA_NAME: 'openldr_target' }] } as any;
    const app = await build(deps);
    const schemas = await app.inject({ method: 'GET', url: '/api/query/connectors/c3/schemas' });
    expect(schemas.json()).toEqual(['openldr_target']);
    const tables = await app.inject({ method: 'GET', url: '/api/query/connectors/c3/schemas/openldr_target/tables' });
    expect(tables.json()).toEqual(['patients', 'observations']);
  });

  it('issues the Postgres system-schema filter for a postgres connector', async () => {
    const deps = makeDeps();
    let seenSql = '';
    deps.runConnectorSql = async ({ sql }) => { seenSql = sql; return { columns: [], rows: [] }; };
    const app = await build(deps);
    const res = await app.inject({ method: 'GET', url: '/api/query/connectors/c1/schemas' });
    expect(res.statusCode).toBe(200);
    expect(seenSql).toContain('pg_catalog');
    expect(seenSql).not.toContain("'sys'");
  });

  it('rejects a schema name that is not a bare identifier', async () => {
    const deps = makeDeps();
    let ran = false;
    deps.runConnectorSql = async () => { ran = true; return { columns: [], rows: [] }; };
    const app = await build(deps);
    const res = await app.inject({ method: 'GET',
      url: `/api/query/connectors/c1/schemas/${encodeURIComponent("public'; drop")}/tables` });
    expect(res.statusCode).toBe(400);
    expect(ran).toBe(false);
  });

  it('maps a runConnectorSql failure in introspection to a 400', async () => {
    const deps = makeDeps();
    deps.runConnectorSql = async () => { throw new Error('connection refused'); };
    const app = await build(deps);
    const res = await app.inject({ method: 'GET', url: '/api/query/connectors/c1/schemas/public/tables' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('connection refused');
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
