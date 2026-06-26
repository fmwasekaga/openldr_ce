import { randomUUID, timingSafeEqual } from 'node:crypto';
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

/**
 * Defense-in-depth redaction for the LIST response (SEC-06). Workflow
 * definitions can embed secrets; the list surface only needs id/name/enabled +
 * non-secret node info, so we strip/mask secret-bearing fields before returning.
 *
 * Redacts, for every node's `data`:
 *  - `secret`            → removed (webhook trigger shared secret)
 *  - `data.headers`      → any auth header key (authorization / proxy-authorization /
 *                          x-*-token / x-api-key / cookie) masked to '***'
 *
 * NOTE (out-of-scope follow-up): the deeper fix is to move secrets out of the
 * definition into a server-side secret store referenced by opaque IDs. The detail
 * endpoint deliberately stays FULL (it is manager-gated and the builder needs the
 * real values to edit).
 */
const AUTH_HEADER_RE = /^(authorization|proxy-authorization|cookie|x-api-key|x-.*-token)$/i;

function redactWorkflowSecrets(definition: unknown): unknown {
  if (!definition || typeof definition !== 'object') return definition;
  const def = definition as { nodes?: unknown };
  if (!Array.isArray(def.nodes)) return definition;
  const nodes = def.nodes.map((raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const node = raw as { data?: Record<string, unknown> };
    if (!node.data || typeof node.data !== 'object') return node;
    const data: Record<string, unknown> = { ...node.data };
    // Strip webhook trigger secret entirely.
    if ('secret' in data) delete data.secret;
    // Mask auth-bearing headers when stored as an object.
    if (data.headers && typeof data.headers === 'object' && !Array.isArray(data.headers)) {
      const headers: Record<string, unknown> = { ...(data.headers as Record<string, unknown>) };
      for (const k of Object.keys(headers)) {
        if (AUTH_HEADER_RE.test(k)) headers[k] = '***';
      }
      data.headers = headers;
    }
    return { ...node, data };
  });
  return { ...def, nodes };
}

/** Headers stripped before forwarding webhook request headers into workflow input (SEC-07). */
const FORWARD_STRIP_HEADERS = new Set(['x-webhook-token', 'authorization', 'cookie', 'proxy-authorization']);

function stripAuthHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!FORWARD_STRIP_HEADERS.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

/** Constant-time string compare that does not leak via length (SEC-07). */
function secretEquals(token: string, secret: string): boolean {
  const a = Buffer.from(token, 'utf8');
  const b = Buffer.from(secret, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerWorkflowRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const MANAGE = { preHandler: requireRole('lab_admin', 'lab_manager') };

  // SEC-06: workflow definitions are manager-level config (they can embed
  // webhook secrets, HTTP auth headers, tokens, and SQL). Reads require the same
  // role as writes; the LIST response is additionally redacted (defense in depth).
  app.get('/api/workflows', MANAGE, async () => {
    const all = await ctx.workflows.store.list();
    return all.map((w) => ({ ...w, definition: redactWorkflowSecrets(w.definition) }));
  });

  app.get('/api/workflows/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const w = await ctx.workflows.store.get(id);
    if (!w) { reply.code(404); return { error: `unknown workflow: ${id}` }; }
    // Detail stays FULL — manager-gated and the builder needs real values to edit.
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
  // SEC-08: exports are written under `workflow-artifacts/` (see bootstrap
  // exportArtifact). Constrain the caller-controlled key to that namespace and
  // reject path traversal so a manager cannot fetch blobs outside it.
  app.get('/api/workflows/artifacts/*', MANAGE, async (req, reply) => {
    const raw = (req.params as Record<string, string>)['*'] ?? '';
    let key: string;
    try { key = decodeURIComponent(raw); } catch { key = raw; }
    const traversal = key.split(/[\\/]/).some((seg) => seg === '..');
    if (!key.startsWith('workflow-artifacts/') || traversal) {
      reply.code(404);
      return { error: 'artifact not found' };
    }
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
  // SEC-07: fail closed when no secret is configured; accept the token from the
  // `x-webhook-token` header ONLY (no query-string token); compare in constant
  // time; and strip auth headers before forwarding request headers into input.
  app.post('/api/workflows/hooks/*', async (req, reply) => {
    const wildcard = (req.params as Record<string, string>)['*'] ?? '';
    const entry = ctx.workflows.webhooks.resolve(wildcard);
    if (!entry) { reply.code(404); return { error: 'unknown webhook' }; }
    if (!entry.secret) { reply.code(401); return { error: 'webhook has no secret configured' }; }
    const token = (req.headers['x-webhook-token'] as string | undefined) ?? '';
    if (!secretEquals(token, entry.secret)) { reply.code(401); return { error: 'invalid webhook token' }; }
    await ctx.workflows.runner.runAndRecord(entry.workflowId, 'webhook', {
      method: req.method, body: req.body,
      headers: stripAuthHeaders(req.headers as Record<string, unknown>), query: req.query,
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
