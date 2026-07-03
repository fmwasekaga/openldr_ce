import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { ReportTemplateSchema } from '@openldr/report-builder/pure';
import { recordAudit } from './audit-helper';
import { requireRole } from './rbac';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerReportTemplateRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const MANAGE = { preHandler: requireRole('lab_admin', 'lab_manager') };

  app.get('/api/report-templates', async () => ctx.reportTemplates.list());

  app.get('/api/report-templates/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await ctx.reportTemplates.get(id);
    if (!t) { reply.code(404); return { error: 'not found' }; }
    return t;
  });

  app.post('/api/report-templates', MANAGE, async (req, reply) => {
    const p = ReportTemplateSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const created = await ctx.reportTemplates.create(p.data);
    await recordAudit(ctx, req, { action: 'report-template.create', entityType: 'report-template', entityId: created.id, before: null, after: created });
    reply.code(201);
    return created;
  });

  app.put('/api/report-templates/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = ReportTemplateSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const before = await ctx.reportTemplates.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }
    const after = await ctx.reportTemplates.update(id, p.data);
    await recordAudit(ctx, req, { action: 'report-template.update', entityType: 'report-template', entityId: id, before, after });
    return after;
  });

  app.delete('/api/report-templates/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await ctx.reportTemplates.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }
    await ctx.reportTemplates.remove(id);
    await recordAudit(ctx, req, { action: 'report-template.delete', entityType: 'report-template', entityId: id, before, after: null });
    reply.code(204);
    return null;
  });
}
