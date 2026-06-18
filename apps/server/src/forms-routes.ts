import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { redact } from '@openldr/core';
import { buildResponse, toQuestionnaire, validateAnswers } from '@openldr/forms';
import { z } from 'zod';

const formInput = z.object({
  name: z.string().min(1),
  versionLabel: z.string().nullish(),
  fhirResourceType: z.string().nullish(),
  status: z.string().optional(),
  active: z.boolean().optional(),
  schema: z.unknown(),
  targetPages: z.array(z.string()).nullish(),
});

const publishInput = z.object({
  versionLabel: z.string().nullish(),
});

const responseInput = z.object({
  answers: z.record(z.unknown()),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerFormsRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  async function audit(action: string, entityId: string, before: unknown, after: unknown, metadata: Record<string, unknown> = {}) {
    const input = {
      actorType: 'system' as const,
      actorId: null,
      actorName: 'System',
      action,
      entityType: 'form',
      entityId,
      before: before as Record<string, unknown> | null,
      after: after as Record<string, unknown> | null,
      metadata,
    };
    try {
      const auditStore = ctx.audit as typeof ctx.audit & { safeRecord?: typeof ctx.audit.record };
      if (auditStore.safeRecord) {
        await auditStore.safeRecord(input);
        return;
      }
      await auditStore.record(input);
    } catch (e) {
      ctx.logger.error({ action, error: e instanceof Error ? e.message : String(e) }, 'audit record failed');
    }
  }

  app.get('/api/forms', async () => ctx.forms.list());

  app.get('/api/forms/published', async (req) => {
    const query = req.query as Record<string, string | undefined>;
    return ctx.forms.listPublished(query.targetPage || undefined);
  });

  app.get('/api/forms/:id', async (req, reply) => {
    const f = await ctx.forms.get((req.params as { id: string }).id);
    if (!f) {
      reply.code(404);
      return { error: 'not found' };
    }
    return f;
  });

  app.post('/api/forms', async (req, reply) => {
    const p = formInput.safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: p.error.message };
    }
    try {
      const f = await ctx.forms.create(p.data as never);
      await audit('form.create', f.id, null, f);
      reply.code(201);
      return f;
    } catch (e) {
      reply.code(409);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });

  app.put('/api/forms/:id', async (req, reply) => {
    const p = formInput.safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: p.error.message };
    }
    const id = (req.params as { id: string }).id;
    if (!(await ctx.forms.get(id))) {
      reply.code(404);
      return { error: 'not found' };
    }
    const before = await ctx.forms.get(id);
    const after = await ctx.forms.update(id, p.data as never);
    await audit('form.update', id, before, after);
    return after;
  });

  app.post('/api/forms/:id/status', async (req, reply) => {
    const status = (req.body as { status?: string }).status;
    if (status !== 'draft' && status !== 'published' && status !== 'archived') {
      reply.code(400);
      return { error: 'status must be draft|published|archived' };
    }
    const id = (req.params as { id: string }).id;
    if (!(await ctx.forms.get(id))) {
      reply.code(404);
      return { error: 'not found' };
    }
    const before = await ctx.forms.get(id);
    const after = await ctx.forms.setStatus(id, status);
    await audit('form.status', id, before, after);
    return after;
  });

  app.post('/api/forms/:id/publish', async (req, reply) => {
    const p = publishInput.safeParse(req.body ?? {});
    if (!p.success) {
      reply.code(400);
      return { error: p.error.message };
    }
    const id = (req.params as { id: string }).id;
    const before = await ctx.forms.get(id);
    if (!before) {
      reply.code(404);
      return { error: 'not found' };
    }
    const after = await ctx.forms.publish(id, { versionLabel: p.data.versionLabel ?? null, actorId: null });
    await audit('form.publish', id, before, after);
    return after;
  });

  app.post('/api/forms/:id/duplicate', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await ctx.forms.get(id))) {
      reply.code(404);
      return { error: 'not found' };
    }
    const copy = await ctx.forms.duplicate(id);
    await audit('form.duplicate', copy.id, null, copy, { sourceFormId: id });
    reply.code(201);
    return copy;
  });

  app.get('/api/forms/:id/versions', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await ctx.forms.get(id))) {
      reply.code(404);
      return { error: 'not found' };
    }
    return ctx.forms.listVersions(id);
  });

  app.get('/api/forms/:id/versions/:version', async (req, reply) => {
    const { id, version } = req.params as { id: string; version: string };
    const parsedVersion = Number.parseInt(version, 10);
    if (!Number.isInteger(parsedVersion) || parsedVersion < 1) {
      reply.code(400);
      return { error: 'version must be a positive integer' };
    }
    const snapshot = await ctx.forms.getVersion(id, parsedVersion);
    if (!snapshot) {
      reply.code(404);
      return { error: 'not found' };
    }
    return snapshot;
  });

  app.delete('/api/forms/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const before = await ctx.forms.get(id);
    await ctx.forms.delete(id);
    await audit('form.delete', id, before, null);
    reply.code(204);
    return null;
  });

  app.get('/api/forms/:id/questionnaire', async (req, reply) => {
    const f = await ctx.forms.get((req.params as { id: string }).id);
    if (!f) {
      reply.code(404);
      return { error: 'not found' };
    }
    try {
      return toQuestionnaire(f.schema);
    } catch (e) {
      reply.code(500);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });

  app.post('/api/forms/:id/responses', async (req, reply) => {
    const p = responseInput.safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: p.error.message };
    }
    const f = await ctx.forms.get((req.params as { id: string }).id);
    if (!f) {
      reply.code(404);
      return { error: 'not found' };
    }
    try {
      const result = validateAnswers(f.schema, p.data.answers as never);
      if (!result.ok) {
        reply.code(422);
        return result.outcome;
      }
      const response = buildResponse(f.schema, p.data.answers as never, { questionnaire: `/api/forms/${f.id}/questionnaire` });
      await audit('form.response.submit', f.id, null, response, { formId: f.id });
      reply.code(201);
      return response;
    } catch (e) {
      reply.code(500);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });
}
