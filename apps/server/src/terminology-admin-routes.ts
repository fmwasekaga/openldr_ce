import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { redact } from '@openldr/core';
import { z } from 'zod';

const publisherInput = z.object({
  name: z.string().min(1),
  role: z.enum(['local', 'standard', 'external']),
  icon: z.string().nullish(),
});
const systemInput = z.object({
  systemCode: z.string().min(1),
  systemName: z.string().min(1),
  url: z.string().nullish(),
  systemVersion: z.string().nullish(),
  description: z.string().nullish(),
  active: z.boolean(),
  publisherId: z.string().nullish(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerTerminologyAdminRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const admin = ctx.terminology.admin;
  type IdParam = { id: string };

  app.get('/api/terminology/publishers', async () => admin.publishers.list());
  app.post('/api/terminology/publishers', async (req, reply) => {
    const parsed = publisherInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    reply.code(201);
    return admin.publishers.create(parsed.data);
  });
  app.put('/api/terminology/publishers/:id', async (req, reply) => {
    const parsed = publisherInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try { return await admin.publishers.update((req.params as IdParam).id, parsed.data); }
    catch (e) { return mapErr(e, reply); }
  });
  app.delete('/api/terminology/publishers/:id', async (req, reply) => {
    try { await admin.publishers.delete((req.params as IdParam).id); reply.code(204); return null; }
    catch (e) { return mapErr(e, reply); }
  });
  app.get('/api/terminology/publishers/:id/deletion-impact', async (req, reply) => {
    try { return await admin.publishers.deletionImpact((req.params as IdParam).id); }
    catch (e) { return mapErr(e, reply); }
  });

  app.get('/api/terminology/systems', async (req) => {
    const { publisher } = req.query as { publisher?: string };
    return admin.codingSystems.list(publisher);
  });
  app.post('/api/terminology/systems', async (req, reply) => {
    const parsed = systemInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try { const created = await admin.codingSystems.create(parsed.data); reply.code(201); return created; }
    catch (e) { return mapErr(e, reply); }
  });
  app.put('/api/terminology/systems/:id', async (req, reply) => {
    const parsed = systemInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try { return await admin.codingSystems.update((req.params as IdParam).id, parsed.data); }
    catch (e) { return mapErr(e, reply); }
  });
  app.delete('/api/terminology/systems/:id', async (req, reply) => {
    try { await admin.codingSystems.delete((req.params as IdParam).id); reply.code(204); return null; }
    catch (e) { return mapErr(e, reply); }
  });
  app.get('/api/terminology/systems/:id/deletion-impact', async (req, reply) => {
    try { return await admin.codingSystems.deletionImpact((req.params as IdParam).id); }
    catch (e) { return mapErr(e, reply); }
  });
}

// Duck-type guard rather than `instanceof TerminologyAdminError`: that class lives in
// @openldr/db, which apps/server intentionally does NOT depend on (it would couple the
// server build to the full Kysely/migrations DB layer). The real class sets
// name='TerminologyAdminError', so checking name + kind is reliable. (Follow-up: move
// TerminologyAdminError into @openldr/terminology, alongside TerminologyError.)
function isAdminError(err: unknown): err is { message: string; kind: 'not-found' | 'conflict' } {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'TerminologyAdminError' &&
    typeof (err as { kind?: unknown }).kind === 'string'
  );
}

function mapErr(err: unknown, reply: FastifyReply) {
  if (isAdminError(err)) {
    reply.code(err.kind === 'not-found' ? 404 : 409);
    return { error: redact(err.message) };
  }
  const msg = err instanceof Error ? err.message : String(err);
  reply.code(/ECONNREFUSED|connect/i.test(msg) ? 503 : 500);
  return { error: redact(msg) };
}
