import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { ReportDesignSchema } from '@openldr/report-designer/pure';
import { recordAudit } from './audit-helper';
import { requireRole } from './rbac';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerReportDesignRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const MANAGE = { preHandler: requireRole('lab_admin', 'lab_manager') };

  app.get('/api/report-designs', async () => ctx.reportDesigns.list());

  app.get('/api/report-designs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const d = await ctx.reportDesigns.get(id);
    if (!d) { reply.code(404); return { error: 'not found' }; }
    return d;
  });

  app.post('/api/report-designs', MANAGE, async (req, reply) => {
    const p = ReportDesignSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const created = await ctx.reportDesigns.create(p.data);
    await recordAudit(ctx, req, { action: 'report-design.create', entityType: 'report-design', entityId: created.id, before: null, after: created });
    reply.code(201);
    return created;
  });

  app.put('/api/report-designs/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = ReportDesignSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const before = await ctx.reportDesigns.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }
    const after = await ctx.reportDesigns.update(id, p.data);
    await recordAudit(ctx, req, { action: 'report-design.update', entityType: 'report-design', entityId: id, before, after });
    return after;
  });

  app.delete('/api/report-designs/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await ctx.reportDesigns.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }
    await ctx.reportDesigns.remove(id);
    await recordAudit(ctx, req, { action: 'report-design.delete', entityType: 'report-design', entityId: id, before, after: null });
    reply.code(204);
    return null;
  });
}
