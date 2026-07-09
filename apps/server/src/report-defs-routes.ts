import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { ReportDefSchema } from '@openldr/reporting';
import { recordAudit } from './audit-helper';
import { requireRole } from './rbac';

export function registerReportDefRoutes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: FastifyInstance<any, any, any, any>, ctx: AppContext,
): void {
  const MANAGE = { preHandler: requireRole('lab_admin', 'lab_manager') };

  app.get('/api/report-defs', async () => ctx.reportDefs.list());

  app.get('/api/report-defs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await ctx.reportDefs.get(id);
    if (!r) { reply.code(404); return { error: 'not found' }; }
    return r;
  });

  app.post('/api/report-defs', MANAGE, async (req, reply) => {
    const p = ReportDefSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const created = await ctx.reportDefs.create(p.data as never);
    await recordAudit(ctx, req, { action: 'report-def.create', entityType: 'report-def', entityId: created.id, before: null, after: created });
    reply.code(201);
    return created;
  });

  app.put('/api/report-defs/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = ReportDefSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const before = await ctx.reportDefs.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }
    const after = await ctx.reportDefs.update(id, p.data as never);
    await recordAudit(ctx, req, { action: 'report-def.update', entityType: 'report-def', entityId: id, before, after });
    return after;
  });

  app.delete('/api/report-defs/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await ctx.reportDefs.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }
    await ctx.reportDefs.remove(id);
    await recordAudit(ctx, req, { action: 'report-def.delete', entityType: 'report-def', entityId: id, before, after: null });
    reply.code(204);
    return null;
  });
}
