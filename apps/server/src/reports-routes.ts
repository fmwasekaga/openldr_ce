import type { FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import { ReportNotFoundError, type AppContext } from '@openldr/bootstrap';
import { toCsv } from '@openldr/reporting';

const runBeaconBody = z.object({
  format: z.enum(['preview', 'csv', 'pdf', 'xlsx']),
  rowCount: z.number().int().nullable().optional(),
  params: z.record(z.string()).optional(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerReportRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  app.get('/api/reports', async () => ctx.reporting.list());

  // Register the .csv route BEFORE the bare :id route so it is matched first.
  app.get('/api/reports/:id.csv', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const result = await ctx.reporting.run(id, req.query);
      reply.header('content-type', 'text/csv').header('content-disposition', `attachment; filename="${id}.csv"`);
      return toCsv(result.columns, result.rows);
    } catch (err) {
      return mapError(err, reply);
    }
  });

  app.get('/api/reports/glass/ris.csv', async (req, reply) => {
    try {
      const result = await ctx.reporting.run('amr-glass-ris', req.query as Record<string, unknown>);
      reply.header('content-type', 'text/csv').header('content-disposition', 'attachment; filename="glass-ris.csv"');
      return toCsv(result.columns, result.rows);
    } catch (err) { return mapError(err, reply); }
  });

  app.get('/api/reports/:id.pdf', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const buf = await ctx.reporting.renderPdf(id, req.query);
      reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${id}.pdf"`);
      return reply.send(buf);
    } catch (err) { return mapError(err, reply); }
  });

  app.get('/api/reports/:id/options', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await ctx.reporting.options(id);
    } catch (err) {
      return mapError(err, reply);
    }
  });

  app.get('/api/reports/runs', async (req) => {
    const q = req.query as { reportId?: string; limit?: string; offset?: string };
    const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 200);
    const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
    return ctx.reportRuns.list({ reportId: q.reportId, limit, offset });
  });

  app.post('/api/reports/:id/runs', async (req, reply) => {
    const { id } = req.params as { id: string };
    let body: z.infer<typeof runBeaconBody>;
    try {
      body = runBeaconBody.parse(req.body);
    } catch (err) {
      return mapError(err, reply);
    }
    const def = ctx.reporting.list().find((r) => r.id === id);
    if (!def) {
      reply.code(404);
      return { error: `report not found: ${id}` };
    }
    const user = req.user;
    await ctx.reportRuns.record({
      reportId: id,
      reportName: def.name,
      format: body.format,
      params: body.params ?? {},
      rowCount: body.rowCount ?? null,
      userId: user?.id ?? null,
      userName: user?.username ?? null,
    });
    reply.code(201);
    return { ok: true };
  });

  app.get('/api/reports/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await ctx.reporting.run(id, req.query);
    } catch (err) {
      return mapError(err, reply);
    }
  });
}

function mapError(err: unknown, reply: FastifyReply): { error: string } {
  if (err instanceof ReportNotFoundError) {
    reply.code(404);
    return { error: err.message };
  }
  if (err instanceof ZodError) {
    reply.code(400);
    return { error: 'invalid parameters' };
  }
  const msg = err instanceof Error ? err.message : String(err);
  const isConn = /ECONNREFUSED|ETIMEDOUT|connection|connect/i.test(msg);
  reply.code(isConn ? 503 : 500);
  return { error: msg };
}
