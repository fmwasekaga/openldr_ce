import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { DashboardQueryError, type AppContext } from '@openldr/bootstrap';
import { DashboardSchema, WidgetQuerySchema, type Dashboard } from '@openldr/dashboards';
import { recordAudit } from './audit-helper';

// Authoring gate: when DASHBOARD_SQL_ENABLED is off, reject persisting a dashboard whose
// widgets contain any `mode:'sql'` query. This stops an untrusted user (the dashboard routes
// have no role gating) from storing arbitrary SQL and then executing it as "vetted" SQL. The
// server-seeded sample is inserted via the store directly, bypassing this route.
function assertSqlAuthoringAllowed(cfg: AppContext['cfg'], d: Dashboard): void {
  if (cfg.DASHBOARD_SQL_ENABLED) return;
  if (d.widgets.some((w) => w.query.mode === 'sql')) {
    throw new DashboardQueryError('raw SQL widgets are disabled');
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerDashboardRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  app.get('/api/dashboards/models', async () => ctx.dashboards.models());

  app.post('/api/dashboards/query', async (req, reply) => {
    try {
      const q = WidgetQuerySchema.parse(req.body);
      return await ctx.dashboards.query(q);
    } catch (err) { return mapError(err, reply); }
  });

  app.get('/api/dashboards', async () => ctx.dashboards.store.list());

  app.get('/api/dashboards/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const d = await ctx.dashboards.store.get(id);
    if (!d) { reply.code(404); return { error: `unknown dashboard: ${id}` }; }
    return d;
  });

  app.post('/api/dashboards', async (req, reply) => {
    try {
      const parsed = DashboardSchema.parse(req.body);
      assertSqlAuthoringAllowed(ctx.cfg, parsed);
      const created = await ctx.dashboards.store.create(parsed);
      await recordAudit(ctx, req, { action: 'dashboard.create', entityType: 'dashboard', entityId: created.id, before: null, after: created });
      return created;
    } catch (err) { return mapError(err, reply); }
  });

  app.put('/api/dashboards/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const parsed = DashboardSchema.parse(req.body);
      assertSqlAuthoringAllowed(ctx.cfg, parsed);
      const before = await ctx.dashboards.store.get(id);
      const updated = await ctx.dashboards.store.update(id, parsed);
      await recordAudit(ctx, req, { action: 'dashboard.update', entityType: 'dashboard', entityId: id, before, after: updated });
      return updated;
    } catch (err) { return mapError(err, reply); }
  });

  app.delete('/api/dashboards/:id', async (req) => {
    const { id } = req.params as { id: string };
    const before = await ctx.dashboards.store.get(id);
    await ctx.dashboards.store.remove(id);
    if (before) {
      await recordAudit(ctx, req, { action: 'dashboard.delete', entityType: 'dashboard', entityId: id, before, after: null });
    }
    return { ok: true };
  });
}

function mapError(err: unknown, reply: FastifyReply): { error: string } {
  if (err instanceof ZodError) { reply.code(400); return { error: 'invalid payload' }; }
  if (err instanceof DashboardQueryError || (err instanceof Error && err.name === 'DashboardQueryError')) {
    reply.code(400); return { error: (err as Error).message };
  }
  // Postgres unique-violation (SQLSTATE 23505): a concurrent create hit a unique constraint
  // (e.g. the id PK or a name index). That is a conflict, not a server fault — surface 409.
  if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505') {
    reply.code(409); return { error: 'already exists' };
  }
  const msg = err instanceof Error ? err.message : String(err);
  const isConn = /ECONNREFUSED|ETIMEDOUT|connection|connect/i.test(msg);
  reply.code(isConn ? 503 : 500);
  return { error: msg };
}
