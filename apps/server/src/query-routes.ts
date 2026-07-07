import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '@openldr/bootstrap';
import { CustomQueryInputSchema, validateSelectSql } from '@openldr/dashboards';
import type { CustomQueryStore } from '@openldr/db';
import { requireRole } from './rbac';
import { recordAudit } from './audit-helper';
import { substituteParams } from './query-sql';

const AUTHOR_ROLES = ['lab_admin', 'lab_manager', 'data_analyst'];
const ROW_CAP = 1000;

export interface QueryRouteDeps {
  customQueries: CustomQueryStore;
  connectors: {
    list(): Promise<{ id: string; name: string; type: string | null; enabled: boolean }[]>;
    get(id: string): Promise<{ id: string; name: string; type: string | null; enabled: boolean } | null>;
  };
  datasets: {
    list(): Promise<{ id: string; name: string; rowCount: number; publishedTable?: string | null }[]>;
    getByName(name: string): Promise<{ name: string; columns: unknown; rows: unknown[]; publishedTable?: string | null } | null>;
  };
  runConnectorSql(input: { connectorId: string; sql: string }): Promise<{ columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerQueryRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext, deps: QueryRouteDeps): void {
  const GUARD = { preHandler: requireRole(...AUTHOR_ROLES) };

  // ---- Custom Query CRUD ----
  app.get('/api/custom-queries', GUARD, async () => deps.customQueries.list());

  app.get('/api/custom-queries/:id', GUARD, async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = await deps.customQueries.get(id);
    if (!q) { reply.code(404); return { error: 'not found' }; }
    return q;
  });

  app.post('/api/custom-queries', GUARD, async (req, reply) => {
    const parsed = CustomQueryInputSchema.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    // The DB unique(name) constraint is the real guard; this pre-check is a best-effort
    // friendly error (TOCTOU: a concurrent create could still win the race).
    if (await deps.customQueries.getByName(parsed.data.name)) { reply.code(409); return { error: 'name already exists' }; }
    const id = `cq_${randomUUID().slice(0, 8)}`;
    const created = { id, ...parsed.data };
    await deps.customQueries.create(created);
    await recordAudit(ctx, req, {
      action: 'customQuery.create', entityType: 'customQuery', entityId: id, before: null, after: created,
    });
    return { id };
  });

  app.put('/api/custom-queries/:id', GUARD, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await deps.customQueries.get(id);
    if (!existing) { reply.code(404); return { error: 'not found' }; }
    const parsed = CustomQueryInputSchema.partial().safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    if (parsed.data.name && parsed.data.name !== existing.name) {
      const clash = await deps.customQueries.getByName(parsed.data.name);
      if (clash && clash.id !== id) { reply.code(409); return { error: 'name already exists' }; }
    }
    await deps.customQueries.update(id, parsed.data);
    const after = (await deps.customQueries.get(id)) ?? { ...existing, ...parsed.data };
    await recordAudit(ctx, req, {
      action: 'customQuery.update', entityType: 'customQuery', entityId: id, before: existing, after,
    });
    return { ok: true };
  });

  app.delete('/api/custom-queries/:id', GUARD, async (req) => {
    const { id } = req.params as { id: string };
    const before = await deps.customQueries.get(id);
    await deps.customQueries.remove(id);
    await recordAudit(ctx, req, {
      action: 'customQuery.delete', entityType: 'customQuery', entityId: id, before, after: null,
    });
    return { ok: true };
  });

  // ---- Read-only execution ----
  const RunBody = z.object({
    connectorId: z.string().min(1),
    sql: z.string().min(1),
    params: z.array(z.any()).optional(),
    values: z.record(z.any()).optional(),
    limit: z.number().int().positive().max(ROW_CAP).optional(),
    offset: z.number().int().min(0).optional(),
  });

  app.post('/api/query/run', GUARD, async (req, reply) => {
    const parsed = RunBody.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    const c = await deps.connectors.get(parsed.data.connectorId);
    if (!c || !c.enabled) { reply.code(404); return { error: 'connector not found or disabled' }; }
    let sql = parsed.data.sql;
    try {
      if (parsed.data.params?.length) sql = substituteParams(sql, parsed.data.params as never, parsed.data.values ?? {});
      validateSelectSql(sql);
    } catch (e) { reply.code(400); return { error: (e as Error).message }; }
    // Always wrap with a LIMIT so an unbounded `select * from big_table` never streams every row
    // into memory; the requested limit is clamped to ROW_CAP.
    const cap = Math.min(parsed.data.limit ?? ROW_CAP, ROW_CAP);
    sql = `select * from (${sql.replace(/;\s*$/, '')}) as _q limit ${cap} offset ${parsed.data.offset ?? 0}`;
    try {
      const started = Date.now();
      const { columns, rows } = await deps.runConnectorSql({ connectorId: parsed.data.connectorId, sql });
      const capped = rows.slice(0, ROW_CAP);
      return { columns, rows: capped, rowCount: capped.length, ms: Date.now() - started };
    } catch (e) { reply.code(400); return { error: (e as Error).message }; }
  });

  // ---- Connector introspection ----
  // v1 supports Postgres only. information_schema introspection is portable across Postgres/MySQL/SQL Server,
  // but the EXECUTION path is Postgres-specific: the run wrapper (`select * from (…) limit N offset M`) is
  // invalid T-SQL and the TableTab identifier quoting (`"schema"."table"`) breaks on MySQL. Other dialects
  // are deferred until the run pagination wrapper + identifier quoting are made dialect-aware.
  const SQL_TYPES = new Set(['postgres']);

  app.get('/api/query/connectors', GUARD, async () => {
    const all = await deps.connectors.list();
    return all.filter((c) => c.enabled && c.type && SQL_TYPES.has(c.type)).map((c) => ({ id: c.id, name: c.name, type: c.type }));
  });

  app.get('/api/query/connectors/:id/schemas', GUARD, async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = await deps.connectors.get(id);
    if (!c || !c.enabled) { reply.code(404); return { error: 'connector not found' }; }
    try {
      const { rows } = await deps.runConnectorSql({ connectorId: id,
        sql: "select schema_name from information_schema.schemata where schema_name not in ('pg_catalog','information_schema') order by 1" });
      return rows.map((r) => String(r.schema_name));
    } catch (e) { reply.code(400); return { error: (e as Error).message }; }
  });

  app.get('/api/query/connectors/:id/schemas/:schema/tables', GUARD, async (req, reply) => {
    const { id, schema } = req.params as { id: string; schema: string };
    const c = await deps.connectors.get(id);
    if (!c || !c.enabled) { reply.code(404); return { error: 'connector not found' }; }
    // Validate the schema as a bare identifier before interpolating: quote-doubling alone is
    // defeatable under MySQL backslash-escaping. Keep the quote-double as defense-in-depth.
    if (!/^[A-Za-z0-9_]+$/.test(schema)) { reply.code(400); return { error: 'invalid schema name' }; }
    const safeSchema = schema.replace(/'/g, "''");
    try {
      const { rows } = await deps.runConnectorSql({ connectorId: id,
        sql: `select table_name from information_schema.tables where table_schema = '${safeSchema}' order by 1` });
      return rows.map((r) => String(r.table_name));
    } catch (e) { reply.code(400); return { error: (e as Error).message }; }
  });

  app.post('/api/query/param-options', GUARD, async (req, reply) => {
    const body = z.object({ connectorId: z.string().min(1), optionsSql: z.string().min(1) }).safeParse(req.body);
    if (!body.success) { reply.code(400); return { error: body.error.message }; }
    try { validateSelectSql(body.data.optionsSql); } catch (e) { reply.code(400); return { error: (e as Error).message }; }
    const c = await deps.connectors.get(body.data.connectorId);
    if (!c || !c.enabled) { reply.code(404); return { error: 'connector not found' }; }
    try {
      const { rows } = await deps.runConnectorSql({ connectorId: body.data.connectorId, sql: body.data.optionsSql });
      return rows.slice(0, ROW_CAP).map((r) => Object.values(r)[0]);
    } catch (e) { reply.code(400); return { error: (e as Error).message }; }
  });

  // ---- Datasets ----
  app.get('/api/query/datasets', GUARD, async () => {
    const all = await deps.datasets.list();
    return all.map((d) => ({ id: d.id, name: d.name, rowCount: d.rowCount }));
  });

  app.get('/api/query/datasets/:name', GUARD, async (req, reply) => {
    const { name } = req.params as { name: string };
    const d = await deps.datasets.getByName(decodeURIComponent(name));
    if (!d) { reply.code(404); return { error: 'dataset not found' }; }
    // Stored-rows is the v1 default path (fully covered). A *published* dataset is materialized to an
    // internal DB table (`d.publishedTable`), but `runConnectorSql` targets external connectors only —
    // there is no clean/correct internal-DB SQL path via the services wired here, so we do NOT attempt an
    // unsafe internal query. We fall back to the dataset's stored snapshot columns/rows. A live read of the
    // published table is deferred until a dedicated internal-SQL runner is available (see report note).
    return { columns: d.columns, rows: d.rows, rowCount: (d.rows as unknown[]).length };
  });
}
