import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import { ReportNotFoundError, type AppContext } from '@openldr/bootstrap';
import { toCsv, nextRunAt, type ScheduleFrequency } from '@openldr/reporting';
import { appError } from '@openldr/core';
import { requireRole } from './rbac';

const runBeaconBody = z.object({
  format: z.enum(['preview', 'csv', 'pdf', 'xlsx']),
  rowCount: z.number().int().nullable().optional(),
  params: z.record(z.string()).optional(),
});

const FREQ = z.enum(['daily', 'weekly', 'monthly', 'quarterly']);
const FORMAT = z.enum(['csv', 'xlsx', 'pdf']);
const scheduleCreate = z.object({
  frequency: FREQ,
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
  outputFormat: FORMAT,
  params: z.record(z.string()).optional(),
});
const FORMAT_CONTENT_TYPE: Record<string, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};
const schedulePatch = z.object({
  enabled: z.boolean().optional(),
  frequency: FREQ.optional(),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
  outputFormat: FORMAT.optional(),
  params: z.record(z.string()).optional(),
});

export function registerReportRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  app.get('/api/reports', async () => ctx.reporting.listAll());

  // Register the .csv route BEFORE the bare :id route so it is matched first.
  app.get('/api/reports/:id.csv', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const result = await ctx.reporting.run(id, req.query);
      reply.header('content-type', 'text/csv').header('content-disposition', `attachment; filename="${id}.csv"`);
      return toCsv(result.columns, result.rows);
    } catch (err) {
      rethrowAsAppError(err);
    }
  });

  app.get('/api/reports/glass/ris.csv', async (req, reply) => {
    try {
      const result = await ctx.reporting.run('r-amr-glass-ris', req.query as Record<string, unknown>);
      reply.header('content-type', 'text/csv').header('content-disposition', 'attachment; filename="glass-ris.csv"');
      return toCsv(result.columns, result.rows);
    } catch (err) { rethrowAsAppError(err); }
  });

  app.get('/api/reports/:id.pdf', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const buf = await ctx.reporting.renderPdf(id, req.query);
      reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${id}.pdf"`);
      return reply.send(buf);
    } catch (err) { rethrowAsAppError(err); }
  });

  app.get('/api/reports/:id/options', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await ctx.reporting.options(id);
    } catch (err) {
      rethrowAsAppError(err);
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
      rethrowAsAppError(err);
    }
    const def = await ctx.reporting.findSummary(id);
    if (!def) throw appError('RP0002', { message: `report not found: ${id}` });
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

  const MANAGE = { preHandler: requireRole('lab_admin', 'lab_manager') };

  app.get('/api/reports/:id/schedules', async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 200);
    const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
    return ctx.reportSchedules.listPaged({ reportId: id, limit, offset });
  });

  app.post('/api/reports/:id/schedules', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    let body: z.infer<typeof scheduleCreate>;
    try { body = scheduleCreate.parse(req.body); } catch (err) { rethrowAsAppError(err); }
    if (!(await ctx.reporting.findSummary(id))) throw appError('RP0002', { message: `report not found: ${id}` });
    const sid = randomUUID();
    const nextDueAt = nextRunAt(body.frequency as ScheduleFrequency, body.dayOfWeek ?? null, body.dayOfMonth ?? null, new Date());
    await ctx.reportSchedules.create({
      id: sid, reportId: id, params: body.params ?? {}, frequency: body.frequency,
      dayOfWeek: body.dayOfWeek ?? null, dayOfMonth: body.dayOfMonth ?? null,
      outputFormat: body.outputFormat, createdBy: req.user?.id ?? null, nextDueAt,
    });
    await ctx.eventing.publish({ type: 'report.schedule.due', payload: { scheduleId: sid } }, { availableAt: nextDueAt });
    reply.code(201);
    return await ctx.reportSchedules.get(sid);
  });

  app.patch('/api/reports/schedules/:sid', MANAGE, async (req, reply) => {
    const { sid } = req.params as { sid: string };
    let body: z.infer<typeof schedulePatch>;
    try { body = schedulePatch.parse(req.body); } catch (err) { rethrowAsAppError(err); }
    const existing = await ctx.reportSchedules.get(sid);
    if (!existing) throw appError('RP0002', { message: `schedule not found: ${sid}` });
    const timingChanged = body.frequency !== undefined || body.dayOfWeek !== undefined || body.dayOfMonth !== undefined;
    const nextDueAt = timingChanged
      ? nextRunAt((body.frequency ?? existing.frequency) as ScheduleFrequency,
          body.dayOfWeek !== undefined ? body.dayOfWeek : existing.dayOfWeek,
          body.dayOfMonth !== undefined ? body.dayOfMonth : existing.dayOfMonth, new Date())
      : undefined;
    await ctx.reportSchedules.update(sid, { ...body, ...(nextDueAt ? { nextDueAt } : {}) });
    if (nextDueAt) await ctx.eventing.publish({ type: 'report.schedule.due', payload: { scheduleId: sid } }, { availableAt: nextDueAt });
    return await ctx.reportSchedules.get(sid);
  });

  app.delete('/api/reports/schedules/:sid', MANAGE, async (req) => {
    const { sid } = req.params as { sid: string };
    await ctx.reportSchedules.remove(sid);
    return { ok: true };
  });

  app.post('/api/reports/schedules/:sid/run', MANAGE, async (req, reply) => {
    const { sid } = req.params as { sid: string };
    if (!(await ctx.reportSchedules.get(sid))) { reply.code(404); return { error: `schedule not found: ${sid}` }; }
    ctx.reportScheduler.runNow(sid);
    reply.code(202);
    return { ok: true };
  });

  app.get('/api/reports/schedule-runs', async (req) => {
    const q = req.query as { reportId?: string; scheduleId?: string; limit?: string; offset?: string };
    const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 200);
    const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
    return ctx.reportSchedules.listRuns({ reportId: q.reportId, scheduleId: q.scheduleId, limit, offset });
  });

  app.get('/api/reports/schedule-runs/:runId/download', async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = await ctx.reportSchedules.getRun(runId);
    if (!run || !run.objectKey) { reply.code(404); return { error: 'run output not found' }; }
    const bytes = await ctx.blob.get(run.objectKey);
    const ct = FORMAT_CONTENT_TYPE[run.outputFormat] ?? 'application/octet-stream';
    void reply.header('content-type', ct);
    void reply.header('content-disposition', `attachment; filename="${run.reportId}.${run.outputFormat}"`);
    return reply.send(Buffer.from(bytes));
  });

  app.get('/api/reports/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await ctx.reporting.run(id, req.query);
    } catch (err) {
      rethrowAsAppError(err);
    }
  });
}

// Reports-specific error mapping: turn the known reports failures into catalog codes and throw
// so the central error handler renders them uniformly ({ error, code, correlationId }). Anything
// else re-throws unchanged and is classified as a SY#### fallback by the central handler.
function rethrowAsAppError(err: unknown): never {
  if (err instanceof ReportNotFoundError) throw appError('RP0002', { message: err.message, cause: err });
  if (err instanceof ZodError) {
    const fields = err.issues.map((i) => i.path.join('.') || '(root)').join(', ');
    throw appError('RP0004', { message: `invalid report parameters: ${fields}`, details: err.flatten(), cause: err });
  }
  throw err;
}
