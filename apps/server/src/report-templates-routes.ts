import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { ReportTemplateSchema } from '@openldr/report-builder/pure';
import type { ReportTemplate, Block } from '@openldr/report-builder/pure';
import { renderReportTemplatePdf } from '@openldr/report-builder';
import { recordAudit } from './audit-helper';
import { requireRole } from './rbac';

// Collect the trimmed SQL text of every sql-mode block query in a template (kpi/chart .query,
// table .source when not 'primary', plus the optional dataset). Mirrors the dashboards gate.
function blockSql(block: Block): string | null {
  if (block.kind === 'kpi' || block.kind === 'chart') return block.query.mode === 'sql' ? block.query.sql.trim() : null;
  if (block.kind === 'table') return block.source !== 'primary' && block.source.mode === 'sql' ? block.source.sql.trim() : null;
  return null;
}
function reportSqlTemplates(t: ReportTemplate | undefined): Set<string> {
  const set = new Set<string>();
  if (!t) return set;
  if (t.dataset?.mode === 'sql') set.add(t.dataset.sql.trim());
  for (const row of t.rows) for (const cell of row.cells) { const s = blockSql(cell.block); if (s != null) set.add(s); }
  return set;
}
// Authoring gate: with `dashboard.raw_sql` off, reject NEW/changed sql-mode blocks. Unchanged SQL
// (text matches an already-persisted template) is exempt so layout/binding edits still save and the
// vetted query still previews. Only the SQL text is gated.
function assertReportSqlAuthoringAllowed(sqlEnabled: boolean, t: ReportTemplate, prev: Set<string>): void {
  if (sqlEnabled) return;
  const current = reportSqlTemplates(t);
  for (const sql of current) if (!prev.has(sql)) throw new Error('raw SQL blocks are disabled');
}

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

  app.post('/api/report-templates/:id/preview', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tpl = await ctx.reportTemplates.get(id);
    if (!tpl) { reply.code(404); return { error: 'not found' }; }
    const body = (req.body ?? {}) as { params?: Record<string, string> };
    const pdf = await renderReportTemplatePdf(tpl, body.params ?? {}, (q) => ctx.dashboards.query(q));
    reply.header('content-type', 'application/pdf');
    reply.header('content-disposition', `inline; filename="${id}.pdf"`);
    return reply.send(pdf);
  });

  app.post('/api/report-templates', MANAGE, async (req, reply) => {
    const p = ReportTemplateSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const sqlEnabled = await ctx.featureFlags.get('dashboard.raw_sql');
    try { assertReportSqlAuthoringAllowed(sqlEnabled, p.data, new Set()); }
    catch (e) { reply.code(400); return { error: e instanceof Error ? e.message : String(e) }; }
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
    const sqlEnabled = await ctx.featureFlags.get('dashboard.raw_sql');
    try { assertReportSqlAuthoringAllowed(sqlEnabled, p.data, reportSqlTemplates(before)); }
    catch (e) { reply.code(400); return { error: e instanceof Error ? e.message : String(e) }; }
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
