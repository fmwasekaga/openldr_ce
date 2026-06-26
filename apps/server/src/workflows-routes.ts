import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import type { AppContext } from '@openldr/bootstrap';
import { WorkflowSchema, WorkflowDefinitionSchema, runWorkflow, type RunEvent } from '@openldr/workflows';
import { toCsv } from '@openldr/reporting';
import { recordAudit } from './audit-helper';
import { requireRole } from './rbac';

/** Sync a workflow's trigger nodes into the derived registries (webhooks + schedules). */
async function syncWorkflowTriggers(ctx: AppContext, workflow: { id: string; definition: unknown }): Promise<void> {
  const def = WorkflowDefinitionSchema.parse(workflow.definition);
  // webhooks (in-memory)
  ctx.workflows.webhooks.sync(workflow.id, def.nodes);
  // schedules (derived table) — replace this workflow's rows with current schedule nodes
  await ctx.workflows.schedules.removeForWorkflow(workflow.id);
  for (const n of def.nodes as Array<{ id: string; type?: string; data?: Record<string, unknown> }>) {
    const isSchedule = n.type === 'trigger' && n.data?.triggerType === 'schedule';
    const cron = n.data?.cron as string | undefined;
    if (isSchedule && cron && cron.trim()) {
      await ctx.workflows.schedules.upsert({
        workflowId: workflow.id, nodeId: n.id, cron, tz: (n.data?.tz as string) ?? null, enabled: true, nextDueAt: null,
      });
    }
  }
}

/** Scan all saved workflows for ingest trigger nodes; returns the ids that should fire on ingest. */
async function listIngestWorkflowIds(ctx: AppContext): Promise<string[]> {
  const all = await ctx.workflows.store.list();
  return all.filter((w) => {
    const def = WorkflowDefinitionSchema.parse(w.definition);
    return (def.nodes as Array<{ type?: string; data?: Record<string, unknown> }>).some(
      (n) => n.type === 'trigger' && n.data?.triggerType === 'ingest');
  }).map((w) => w.id);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerWorkflowRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const MANAGE = { preHandler: requireRole('lab_admin', 'lab_manager') };

  app.get('/api/workflows', async () => ctx.workflows.store.list());

  app.get('/api/workflows/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const w = await ctx.workflows.store.get(id);
    if (!w) { reply.code(404); return { error: `unknown workflow: ${id}` }; }
    return w;
  });

  app.post('/api/workflows', MANAGE, async (req, reply) => {
    try {
      const created = await ctx.workflows.store.create(WorkflowSchema.parse(req.body));
      await syncWorkflowTriggers(ctx, created);
      ctx.workflows.runner.setIngestWorkflowIds(await listIngestWorkflowIds(ctx));
      await recordAudit(ctx, req, { action: 'workflow.create', entityType: 'workflow', entityId: created.id, before: null, after: created });
      return created;
    } catch (err) { return mapError(err, reply); }
  });

  app.put('/api/workflows/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const before = await ctx.workflows.store.get(id);
      const updated = await ctx.workflows.store.update(id, WorkflowSchema.parse(req.body));
      await syncWorkflowTriggers(ctx, updated);
      ctx.workflows.runner.setIngestWorkflowIds(await listIngestWorkflowIds(ctx));
      await recordAudit(ctx, req, { action: 'workflow.update', entityType: 'workflow', entityId: id, before, after: updated });
      return updated;
    } catch (err) { return mapError(err, reply); }
  });

  app.delete('/api/workflows/:id', MANAGE, async (req) => {
    const { id } = req.params as { id: string };
    const before = await ctx.workflows.store.get(id);
    await ctx.workflows.store.remove(id);
    ctx.workflows.webhooks.clear(id);
    await ctx.workflows.schedules.removeForWorkflow(id);
    ctx.workflows.runner.setIngestWorkflowIds(await listIngestWorkflowIds(ctx));
    if (before) {
      await recordAudit(ctx, req, { action: 'workflow.delete', entityType: 'workflow', entityId: id, before, after: null });
    }
    return { ok: true };
  });

  // SSE execution. POST so the client can pass an optional trigger `input` body.
  app.post('/api/workflows/:id/execute-stream', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const workflow = await ctx.workflows.store.get(id);
    if (!workflow) { reply.code(404); return { error: `unknown workflow: ${id}` }; }

    const body = (req.body ?? {}) as { input?: unknown };
    const def = WorkflowDefinitionSchema.parse(workflow.definition);

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (evt: RunEvent) => reply.raw.write(`data: ${JSON.stringify(evt)}\n\n`);
    try {
      const result = await runWorkflow(def.nodes, def.edges, {
        input: body.input,
        onEvent: send,
        codeLimits: { timeoutMs: ctx.cfg.WORKFLOW_CODE_TIMEOUT_MS, memoryMb: ctx.cfg.WORKFLOW_CODE_MEMORY_MB, enabled: ctx.cfg.WORKFLOW_CODE_ENABLED },
        services: ctx.workflows.services,
        workflowId: id,
        logger: { warn: (msg: string) => ctx.logger.warn(msg) },
      });
      reply.raw.write(`event: done\ndata: ${JSON.stringify(result)}\n\n`);
      await ctx.workflows.runs.record({
        id: randomUUID(), workflowId: id, triggerSource: 'manual', status: result.status,
        startedAt: result.startedAt, finishedAt: result.finishedAt, result, error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
      await ctx.workflows.runs.record({
        id: randomUUID(), workflowId: id, triggerSource: 'manual', status: 'failed',
        startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        result: { status: 'failed', results: [] }, error: message,
      }).catch(() => {});
    } finally {
      reply.raw.end();
    }
    return reply;
  });

  app.get('/api/workflows/:id/runs', MANAGE, async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string; offset?: string };
    return ctx.workflows.runs.list(id, { limit: q.limit ? Number(q.limit) : 50, offset: q.offset ? Number(q.offset) : 0 });
  });

  app.get('/api/workflows/runs/:runId', MANAGE, async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = await ctx.workflows.runs.get(runId);
    if (!run) { reply.code(404); return { error: `unknown run: ${runId}` }; }
    return run;
  });

  // Materialized datasets produced by workflow sink nodes.
  app.get('/api/workflows/datasets', MANAGE, async () => ctx.workflows.datasets.list());

  // CSV download for a dataset (declared before :name so the .csv suffix isn't swallowed).
  app.get('/api/workflows/datasets/:name.csv', MANAGE, async (req, reply) => {
    const { name } = req.params as { name: string };
    const d = await ctx.workflows.datasets.getByName(name);
    if (!d) { reply.code(404); return { error: `unknown dataset: ${name}` }; }
    reply.header('content-type', 'text/csv');
    reply.header('content-disposition', `attachment; filename="${name}.csv"`);
    return toCsv(d.columns, d.rows);
  });

  app.get('/api/workflows/datasets/:name', MANAGE, async (req, reply) => {
    const { name } = req.params as { name: string };
    const d = await ctx.workflows.datasets.getByName(name);
    if (!d) { reply.code(404); return { error: `unknown dataset: ${name}` }; }
    return d;
  });

  // Stream an exported artifact out of blob storage by its object key.
  app.get('/api/workflows/artifacts/*', MANAGE, async (req, reply) => {
    const key = (req.params as Record<string, string>)['*'];
    try {
      const buf = await ctx.blob.get(key);
      reply.header('content-type', 'application/octet-stream');
      return reply.send(Buffer.from(buf));
    } catch {
      reply.code(404);
      return { error: 'artifact not found' };
    }
  });

  // Secret-gated webhook trigger. NOT MANAGE-gated — auth is the per-path secret.
  app.post('/api/workflows/hooks/*', async (req, reply) => {
    const wildcard = (req.params as Record<string, string>)['*'] ?? '';
    const entry = ctx.workflows.webhooks.resolve(wildcard);
    if (!entry) { reply.code(404); return { error: 'unknown webhook' }; }
    const token = (req.headers['x-webhook-token'] as string | undefined) ?? (req.query as { token?: string }).token;
    if (entry.secret && token !== entry.secret) { reply.code(401); return { error: 'invalid webhook token' }; }
    await ctx.workflows.runner.runAndRecord(entry.workflowId, 'webhook', {
      method: req.method, body: req.body, headers: req.headers, query: req.query,
    });
    return { ok: true };
  });
}

function mapError(err: unknown, reply: FastifyReply): { error: string } {
  if (err instanceof ZodError) { reply.code(400); return { error: 'invalid payload' }; }
  const msg = err instanceof Error ? err.message : String(err);
  const isConn = /ECONNREFUSED|ETIMEDOUT|connection|connect/i.test(msg);
  reply.code(isConn ? 503 : 500);
  return { error: msg };
}
