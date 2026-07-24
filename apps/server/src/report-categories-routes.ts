import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { ReportCategoryListSchema } from '@openldr/reporting';
import { recordAudit } from './audit-helper';
import { requireCapability } from './rbac';

export function registerReportCategoryRoutes(
  app: FastifyInstance<any, any, any, any>, ctx: AppContext,
): void {
  const MANAGE = { preHandler: requireCapability('reports.edit_templates') };

  // GET was, and remains, ungated — the mapping table for this file covers only the existing
  // MANAGE guard (PUT); it does not call for tightening this read the way forms/reports-routes
  // explicitly does for THEIR previously-ungated routes.
  app.get('/api/report-categories', async () => ctx.reportCategories.list());

  app.put('/api/report-categories', MANAGE, async (req, reply) => {
    const p = ReportCategoryListSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const before = await ctx.reportCategories.list();
    await ctx.reportCategories.save(p.data);
    await recordAudit(ctx, req, { action: 'report-category.update', entityType: 'report-category', entityId: 'global', before, after: p.data });
    return p.data;
  });
}
