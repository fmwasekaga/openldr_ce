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

const responseInput = z.object({
  answers: z.record(z.unknown()),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerFormsRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
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
    return ctx.forms.update(id, p.data as never);
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
    return ctx.forms.setStatus(id, status);
  });

  app.delete('/api/forms/:id', async (req, reply) => {
    await ctx.forms.delete((req.params as { id: string }).id);
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
      reply.code(201);
      return buildResponse(f.schema, p.data.answers as never, { questionnaire: `/api/forms/${f.id}/questionnaire` });
    } catch (e) {
      reply.code(500);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });
}
