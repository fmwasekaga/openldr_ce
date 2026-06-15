import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { redact } from '@openldr/core';
import { z } from 'zod';
import { parseTermsCsv, TERMS_CSV_TEMPLATE } from '@openldr/terminology';

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

  // ── Terms ────────────────────────────────────────────────────────────────
  const termInput = z.object({
    code: z.string().min(1), display: z.string().min(1),
    status: z.enum(['ACTIVE', 'DRAFT', 'DEPRECATED', 'DISABLED']),
    shortName: z.string().nullish(), class: z.string().nullish(), unit: z.string().nullish(),
    replacedBy: z.string().nullish(), metadata: z.record(z.unknown()).nullish(),
  });

  async function systemUrl(id: string): Promise<string> {
    const sys = (await admin.codingSystems.list()).find((s) => s.id === id);
    if (!sys || !sys.url) {
      throw Object.assign(new Error(`coding system has no url: ${id}`), { name: 'TerminologyAdminError', kind: 'not-found' as const });
    }
    return sys.url;
  }

  app.get('/api/terminology/systems/:id/terms', async (req, reply) => {
    try {
      const url = await systemUrl((req.params as IdParam).id);
      const { q, status, limit, offset } = req.query as { q?: string; status?: string; limit?: string; offset?: string };
      return await admin.terms.search(url, { query: q, statuses: status ? [status] : undefined, limit: Number(limit ?? 50), offset: Number(offset ?? 0) });
    } catch (e) { return mapErr(e, reply); }
  });
  app.post('/api/terminology/systems/:id/terms', async (req, reply) => {
    const parsed = termInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try {
      const url = await systemUrl((req.params as IdParam).id);
      const created = await admin.terms.create({ system: url, ...parsed.data });
      reply.code(201);
      return created;
    } catch (e) { return mapErr(e, reply); }
  });
  app.put('/api/terminology/systems/:id/terms/:code', async (req, reply) => {
    const parsed = termInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try {
      const url = await systemUrl((req.params as IdParam).id);
      const code = decodeURIComponent((req.params as { id: string; code: string }).code);
      return await admin.terms.update(url, code, { system: url, ...parsed.data });
    } catch (e) { return mapErr(e, reply); }
  });
  app.delete('/api/terminology/systems/:id/terms/:code', async (req, reply) => {
    try {
      const url = await systemUrl((req.params as IdParam).id);
      await admin.terms.delete(url, decodeURIComponent((req.params as { id: string; code: string }).code));
      reply.code(204); return null;
    } catch (e) { return mapErr(e, reply); }
  });
  app.post('/api/terminology/systems/:id/terms/import', async (req, reply) => {
    try {
      const url = await systemUrl((req.params as IdParam).id);
      const rawRows = parseTermsCsv(String((req.body as { csv?: string }).csv ?? ''), url);
      const rows = rawRows.map((r) => ({ ...r, status: r.status ?? 'ACTIVE' }));
      return await admin.terms.importRows(rows);
    } catch (e) { return mapErr(e, reply); }
  });
  app.get('/api/terminology/systems/:id/terms/template.csv', async (_req, reply) => {
    reply.header('content-type', 'text/csv');
    return TERMS_CSV_TEMPLATE;
  });

  // ── Term Mappings ─────────────────────────────────────────────────────────
  const mappingInput = z.object({
    toSystem: z.string().min(1), toCode: z.string().min(1), toDisplay: z.string().nullish(),
    mapType: z.enum(['SAME-AS', 'NARROWER-THAN', 'BROADER-THAN', 'RELATED-TO', 'UNMAPPED-FROM']),
    relationship: z.string().nullish(), owner: z.string().nullish(), isActive: z.boolean(),
  });
  const mappingUpdateInput = mappingInput.extend({ fromSystem: z.string().min(1), fromCode: z.string().min(1) });

  app.get('/api/terminology/terms/:system/:code/mappings', async (req, reply) => {
    try {
      const system = decodeURIComponent((req.params as { system: string; code: string }).system);
      const code = decodeURIComponent((req.params as { system: string; code: string }).code);
      const [outgoing, reverse] = await Promise.all([admin.termMappings.listOutgoing(system, code), admin.termMappings.listReverse(system, code)]);
      return { outgoing, reverse };
    } catch (e) { return mapErr(e, reply); }
  });
  app.post('/api/terminology/terms/:system/:code/mappings', async (req, reply) => {
    const parsed = mappingInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try {
      const system = decodeURIComponent((req.params as { system: string; code: string }).system);
      const code = decodeURIComponent((req.params as { system: string; code: string }).code);
      const created = await admin.termMappings.create({ fromSystem: system, fromCode: code, ...parsed.data, toDisplay: parsed.data.toDisplay ?? null });
      reply.code(201);
      return created;
    } catch (e) { return mapErr(e, reply); }
  });
  app.put('/api/terminology/mappings/:id', async (req, reply) => {
    const parsed = mappingUpdateInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try { return await admin.termMappings.update((req.params as IdParam).id, { ...parsed.data, toDisplay: parsed.data.toDisplay ?? null }); }
    catch (e) { return mapErr(e, reply); }
  });
  app.delete('/api/terminology/mappings/:id', async (req, reply) => {
    try { await admin.termMappings.delete((req.params as IdParam).id); reply.code(204); return null; }
    catch (e) { return mapErr(e, reply); }
  });

  // Value Sets
  const composeClause = z.object({
    system: z.string().optional(),
    version: z.string().optional(),
    concept: z.array(z.object({ code: z.string(), display: z.string().optional() })).optional(),
    filter: z.array(z.object({ property: z.string(), op: z.string(), value: z.string() })).optional(),
    valueSet: z.array(z.string()).optional(),
  });
  const valueSetInput = z.object({
    url: z.string().min(1),
    version: z.string().nullish(),
    name: z.string().nullish(),
    title: z.string().nullish(),
    status: z.enum(['draft', 'active', 'retired']),
    experimental: z.boolean().optional(),
    description: z.string().nullish(),
    compose: z.object({ include: z.array(composeClause).optional(), exclude: z.array(composeClause).optional() }),
    publisherId: z.string().nullish(),
    category: z.string().nullish(),
  });

  app.get('/api/terminology/valuesets', async (req) => {
    const { publisherId } = req.query as { publisherId?: string };
    return admin.valueSets.list(publisherId);
  });
  app.post('/api/terminology/valuesets', async (req, reply) => {
    const parsed = valueSetInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try { const saved = await admin.valueSets.save(parsed.data); reply.code(201); return saved; }
    catch (e) { return mapErr(e, reply); }
  });
  app.get('/api/terminology/valuesets/:id', async (req, reply) => {
    try { return await admin.valueSets.get((req.params as IdParam).id); }
    catch (e) { return mapErr(e, reply); }
  });
  app.put('/api/terminology/valuesets/:id', async (req, reply) => {
    const parsed = valueSetInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try { return await admin.valueSets.save(parsed.data); }
    catch (e) { return mapErr(e, reply); }
  });
  app.delete('/api/terminology/valuesets/:id', async (req, reply) => {
    try { await admin.valueSets.delete((req.params as IdParam).id); reply.code(204); return null; }
    catch (e) { return mapErr(e, reply); }
  });
  app.post('/api/terminology/valuesets/:id/duplicate', async (req, reply) => {
    try { const dup = await admin.valueSets.duplicate((req.params as IdParam).id); reply.code(201); return dup; }
    catch (e) { return mapErr(e, reply); }
  });
  app.get('/api/terminology/valuesets/:id/expand', async (req, reply) => {
    try {
      const { activeOnly } = req.query as { activeOnly?: string };
      return await admin.valueSets.expand((req.params as IdParam).id, activeOnly !== 'false');
    } catch (e) { return mapErr(e, reply); }
  });
  app.post('/api/terminology/valuesets/import', async (req, reply) => {
    try { const saved = await admin.valueSets.importFhir(req.body); reply.code(201); return saved; }
    catch (e) { return mapErr(e, reply); }
  });
  app.get('/api/terminology/valuesets/:id/export', async (req, reply) => {
    try {
      const resource = await admin.valueSets.exportFhir((req.params as IdParam).id);
      reply.header('content-type', 'application/fhir+json');
      reply.header('content-disposition', `attachment; filename="${(req.params as IdParam).id}.json"`);
      return resource;
    } catch (e) { return mapErr(e, reply); }
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
