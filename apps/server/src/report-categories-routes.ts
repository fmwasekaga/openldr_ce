import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { ReportCategoryListSchema } from '@openldr/reporting';
import { recordAudit } from './audit-helper';
import { requireCapability } from './rbac';

export function registerReportCategoryRoutes(
  app: FastifyInstance<any, any, any, any>, ctx: AppContext,
): void {
  const MANAGE = { preHandler: requireCapability('reports.edit_templates') };
  const VIEW = { preHandler: requireCapability('reports.view') };

  // GET is now gated on reports.view for parity with the sibling reports-routes.ts list route —
  // previously any authenticated user could read report category metadata regardless of role.
  app.get('/api/report-categories', VIEW, async () => ctx.reportCategories.list());

  app.put('/api/report-categories', MANAGE, async (req, reply) => {
    const p = ReportCategoryListSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const before = await ctx.reportCategories.list();
    await ctx.reportCategories.save(p.data);
    await recordAudit(ctx, req, { action: 'report-category.update', entityType: 'report-category', entityId: 'global', before, after: p.data });
    return p.data;
  });
}
