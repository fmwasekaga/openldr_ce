import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { DashboardQueryError, type AppContext } from '@openldr/bootstrap';
import { DashboardSchema, WidgetQuerySchema } from '@openldr/dashboards';

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
    try { return await ctx.dashboards.store.create(DashboardSchema.parse(req.body)); }
    catch (err) { return mapError(err, reply); }
  });

  app.put('/api/dashboards/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try { return await ctx.dashboards.store.update(id, DashboardSchema.parse(req.body)); }
    catch (err) { return mapError(err, reply); }
  });

  app.delete('/api/dashboards/:id', async (req) => {
    const { id } = req.params as { id: string };
    await ctx.dashboards.store.remove(id);
    return { ok: true };
  });
}

function mapError(err: unknown, reply: FastifyReply): { error: string } {
  if (err instanceof ZodError) { reply.code(400); return { error: 'invalid payload' }; }
  if (err instanceof DashboardQueryError || (err instanceof Error && err.name === 'DashboardQueryError')) {
    reply.code(400); return { error: (err as Error).message };
  }
  const msg = err instanceof Error ? err.message : String(err);
  const isConn = /ECONNREFUSED|ETIMEDOUT|connection|connect/i.test(msg);
  reply.code(isConn ? 503 : 500);
  return { error: msg };
}
