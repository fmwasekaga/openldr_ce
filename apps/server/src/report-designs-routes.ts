import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { ReportDesignSchema } from '@openldr/report-designer/pure';
import { renderReportDesignPdf, type ResolvedTable } from '@openldr/report-designer';
import { runStoredQuery, type RunStoredQueryDeps } from './run-stored-query';
import { recordAudit } from './audit-helper';
import { requireRole } from './rbac';

export function registerReportDesignRoutes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: FastifyInstance<any, any, any, any>, ctx: AppContext, deps: RunStoredQueryDeps,
): void {
  const MANAGE = { preHandler: requireRole('lab_admin', 'lab_manager') };
  const PREVIEW = { preHandler: requireRole('lab_admin', 'lab_manager', 'data_analyst') };

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

  // Resource-less: renders the POSTed working design (so unsaved/transient designs preview too).
  app.post('/api/report-designs/preview', PREVIEW, async (req, reply) => {
    const p = ReportDesignSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const design = p.data;

    // Binding contract: design.param.key === query.param.id (substituteParams keys by id),
    // so build values once from the design's own params — extra unmapped values are harmless.
    const values: Record<string, unknown> = {};
    for (const dp of design.parameters) if (dp.value != null) values[dp.key] = dp.value;

    const resolved = new Map<string, ResolvedTable>();
    for (const page of design.pages) {
      for (const el of page.elements) {
        if (el.kind !== 'table' || !el.dataSource) continue;
        try {
          const { columns, rows } = await runStoredQuery(deps, el.dataSource.queryId, values);
          resolved.set(el.id, { columns, rows });
        } catch (e) {
          // Per-table failures become an in-PDF placeholder, never a 500
          // (all store access lives inside runStoredQuery, inside this catch).
          resolved.set(el.id, { error: (e as Error).message });
        }
      }
    }

    const pdf = await renderReportDesignPdf(design, resolved);
    reply.header('content-type', 'application/pdf');
    reply.header('content-disposition', 'inline; filename="report-design.pdf"');
    return reply.send(pdf);
  });
}
