import type { FastifyInstance, FastifyReply } from 'fastify';
import { gunzipSync } from 'node:zlib';
import type { AppContext } from '@openldr/bootstrap';
import { redact } from '@openldr/core';
import { z } from 'zod';
import { recordAudit } from './audit-helper';
import { isFhirValueSetCatalog, parseTerminologyTerms, parseTerminologyTermsStream, terminologyImportTemplate } from '@openldr/terminology';

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
const loincImportInput = z.object({
  path: z.string().min(1),
  acceptLicense: z.boolean(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerTerminologyAdminRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const admin = ctx.terminology.admin;
  type IdParam = { id: string };

  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => {
    done(null, payload);
  });
  app.addContentTypeParser('application/fhir+json', (_req, payload, done) => {
    done(null, payload);
  });
  app.addContentTypeParser('application/gzip', (_req, payload, done) => {
    done(null, payload);
  });
  app.addContentTypeParser('application/x-gzip', (_req, payload, done) => {
    done(null, payload);
  });

  app.get('/api/terminology/publishers', async () => admin.publishers.list());
  app.post('/api/terminology/publishers', async (req, reply) => {
    const parsed = publisherInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try {
      const created = await admin.publishers.create(parsed.data);
      await recordAudit(ctx, req, { action: 'publisher.create', entityType: 'publisher', entityId: created.id, before: null, after: created });
      reply.code(201);
      return created;
    } catch (e) { return mapErr(e, reply); }
  });
  app.put('/api/terminology/publishers/:id', async (req, reply) => {
    const parsed = publisherInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try {
      const updated = await admin.publishers.update((req.params as IdParam).id, parsed.data);
      await recordAudit(ctx, req, { action: 'publisher.update', entityType: 'publisher', entityId: (req.params as IdParam).id, before: null, after: updated });
      return updated;
    }
    catch (e) { return mapErr(e, reply); }
  });
  app.delete('/api/terminology/publishers/:id', async (req, reply) => {
    try {
      await admin.publishers.delete((req.params as IdParam).id);
      await recordAudit(ctx, req, { action: 'publisher.delete', entityType: 'publisher', entityId: (req.params as IdParam).id, before: null, after: null });
      reply.code(204); return null;
    }
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
    try {
      const created = await admin.codingSystems.create(parsed.data);
      await recordAudit(ctx, req, { action: 'coding_system.create', entityType: 'coding_system', entityId: created.id, before: null, after: created });
      reply.code(201); return created;
    }
    catch (e) { return mapErr(e, reply); }
  });
  app.put('/api/terminology/systems/:id', async (req, reply) => {
    const parsed = systemInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try {
      const updated = await admin.codingSystems.update((req.params as IdParam).id, parsed.data);
      await recordAudit(ctx, req, { action: 'coding_system.update', entityType: 'coding_system', entityId: (req.params as IdParam).id, before: null, after: updated });
      return updated;
    }
    catch (e) { return mapErr(e, reply); }
  });
  app.delete('/api/terminology/systems/:id', async (req, reply) => {
    try {
      await admin.codingSystems.delete((req.params as IdParam).id);
      await recordAudit(ctx, req, { action: 'coding_system.delete', entityType: 'coding_system', entityId: (req.params as IdParam).id, before: null, after: null });
      reply.code(204); return null;
    }
    catch (e) { return mapErr(e, reply); }
  });
  app.get('/api/terminology/systems/:id/deletion-impact', async (req, reply) => {
    try { return await admin.codingSystems.deletionImpact((req.params as IdParam).id); }
    catch (e) { return mapErr(e, reply); }
  });

  // ── Terms ────────────────────────────────────────────────────────────────
  app.post('/api/terminology/import/loinc', async (req, reply) => {
    const parsed = loincImportInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    if (!parsed.data.acceptLicense) {
      reply.code(400);
      return { error: 'LOINC import requires accepting the LOINC license.' };
    }
    try {
      const result = await ctx.terminology.loaders.loinc(parsed.data.path, parsed.data.acceptLicense);
      await recordAudit(ctx, req, { action: 'coding_system.import', entityType: 'coding_system', entityId: 'loinc', before: null, after: null, metadata: { source: 'loinc', result } });
      return result;
    } catch (e) { return mapErr(e, reply); }
  });

  const termInput = z.object({
    code: z.string().min(1), display: z.string().min(1),
    status: z.enum(['ACTIVE', 'DRAFT', 'DEPRECATED', 'DISABLED']),
    shortName: z.string().nullish(), class: z.string().nullish(), unit: z.string().nullish(),
    replacedBy: z.string().nullish(), metadata: z.record(z.unknown()).nullish(),
  });

  async function systemInfo(id: string): Promise<{ url: string; systemCode: string }> {
    const sys = (await admin.codingSystems.list()).find((s) => s.id === id);
    if (!sys || !sys.url) {
      throw Object.assign(new Error(`coding system has no url: ${id}`), { name: 'TerminologyAdminError', kind: 'not-found' as const });
    }
    return { url: sys.url, systemCode: sys.systemCode };
  }

  async function systemUrl(id: string): Promise<string> {
    return (await systemInfo(id)).url;
  }

  async function importTermRowsInBatches(rows: ReturnType<typeof parseTerminologyTerms>): Promise<{ imported: number }> {
    const batchSize = 1000;
    let imported = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize).map((r) => ({ ...r, status: r.status ?? 'ACTIVE' }));
      const result = await admin.terms.importRows(batch);
      imported += result.imported;
    }
    return { imported };
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
      await recordAudit(ctx, req, { action: 'term.create', entityType: 'term', entityId: created.code, before: null, after: created, metadata: { system: url } });
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
      const updated = await admin.terms.update(url, code, { system: url, ...parsed.data });
      await recordAudit(ctx, req, { action: 'term.update', entityType: 'term', entityId: code, before: null, after: updated, metadata: { system: url } });
      return updated;
    } catch (e) { return mapErr(e, reply); }
  });
  app.delete('/api/terminology/systems/:id/terms/:code', async (req, reply) => {
    try {
      const url = await systemUrl((req.params as IdParam).id);
      const code = decodeURIComponent((req.params as { id: string; code: string }).code);
      await admin.terms.delete(url, code);
      await recordAudit(ctx, req, { action: 'term.delete', entityType: 'term', entityId: code, before: null, after: null, metadata: { system: url } });
      reply.code(204); return null;
    } catch (e) { return mapErr(e, reply); }
  });
  app.post('/api/terminology/systems/:id/terms/import', async (req, reply) => {
    try {
      const system = await systemInfo((req.params as IdParam).id);
      let result: { imported: number };
      if (isReadableBody(req.body)) {
        const rows = await parseTerminologyTermsStream(req.body, system.url, system.systemCode);
        result = await importTermRowsInBatches(rows);
      } else {
        const rawBody = req.body;
        const raw = rawBody && typeof rawBody === 'object' && !Buffer.isBuffer(rawBody)
          ? rawBody as { csv?: string; text?: string }
          : { text: await bodyToText(rawBody) };
        const rawRows = parseTerminologyTerms(String(raw.text ?? raw.csv ?? ''), system.url, system.systemCode);
        result = await importTermRowsInBatches(rawRows);
      }
      await recordAudit(ctx, req, { action: 'term.import', entityType: 'term', entityId: system.url, before: null, after: null, metadata: { systemId: (req.params as IdParam).id, result } });
      return result;
    } catch (e) { return mapErr(e, reply); }
  });
  app.get('/api/terminology/systems/:id/terms/template.csv', async (req, reply) => {
    try {
      const system = await systemInfo((req.params as IdParam).id);
      const template = terminologyImportTemplate(system.systemCode);
      reply.header('content-type', template.contentType);
      reply.header('content-disposition', `attachment; filename="${template.filename}"`);
      return template.body;
    } catch (e) { return mapErr(e, reply); }
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
      await recordAudit(ctx, req, { action: 'term_mapping.create', entityType: 'term_mapping', entityId: created.mapping.id, before: null, after: created.mapping, metadata: { draftCreated: created.draftCreated } });
      reply.code(201);
      return created;
    } catch (e) { return mapErr(e, reply); }
  });
  app.put('/api/terminology/mappings/:id', async (req, reply) => {
    const parsed = mappingUpdateInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try {
      const updated = await admin.termMappings.update((req.params as IdParam).id, { ...parsed.data, toDisplay: parsed.data.toDisplay ?? null });
      await recordAudit(ctx, req, { action: 'term_mapping.update', entityType: 'term_mapping', entityId: (req.params as IdParam).id, before: null, after: updated });
      return updated;
    }
    catch (e) { return mapErr(e, reply); }
  });
  app.delete('/api/terminology/mappings/:id', async (req, reply) => {
    try {
      await admin.termMappings.delete((req.params as IdParam).id);
      await recordAudit(ctx, req, { action: 'term_mapping.delete', entityType: 'term_mapping', entityId: (req.params as IdParam).id, before: null, after: null });
      reply.code(204); return null;
    }
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
    try {
      const saved = await admin.valueSets.save(parsed.data);
      await recordAudit(ctx, req, { action: 'value_set.create', entityType: 'value_set', entityId: saved.id, before: null, after: saved });
      reply.code(201); return saved;
    }
    catch (e) { return mapErr(e, reply); }
  });
  app.get('/api/terminology/valuesets/:id', async (req, reply) => {
    try { return await admin.valueSets.get((req.params as IdParam).id); }
    catch (e) { return mapErr(e, reply); }
  });
  app.put('/api/terminology/valuesets/:id', async (req, reply) => {
    const parsed = valueSetInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try {
      const id = (req.params as IdParam).id;
      const before = await admin.valueSets.get(id).catch(() => null);
      const saved = await admin.valueSets.save(parsed.data);
      await recordAudit(ctx, req, { action: 'value_set.update', entityType: 'value_set', entityId: id, before, after: saved });
      return saved;
    }
    catch (e) { return mapErr(e, reply); }
  });
  app.delete('/api/terminology/valuesets/:id', async (req, reply) => {
    try {
      const id = (req.params as IdParam).id;
      const before = await admin.valueSets.get(id).catch(() => null);
      await admin.valueSets.delete(id);
      await recordAudit(ctx, req, { action: 'value_set.delete', entityType: 'value_set', entityId: id, before, after: null });
      reply.code(204); return null;
    }
    catch (e) { return mapErr(e, reply); }
  });
  app.post('/api/terminology/valuesets/:id/duplicate', async (req, reply) => {
    try {
      const id = (req.params as IdParam).id;
      const dup = await admin.valueSets.duplicate(id);
      await recordAudit(ctx, req, { action: 'value_set.duplicate', entityType: 'value_set', entityId: dup.id, before: null, after: dup, metadata: { sourceId: id } });
      reply.code(201); return dup;
    }
    catch (e) { return mapErr(e, reply); }
  });
  app.get('/api/terminology/valuesets/:id/expand', async (req, reply) => {
    try {
      const { activeOnly } = req.query as { activeOnly?: string };
      return await admin.valueSets.expand((req.params as IdParam).id, activeOnly !== 'false');
    } catch (e) { return mapErr(e, reply); }
  });
  app.post('/api/terminology/valuesets/import', async (req, reply) => {
    try {
      const resource = await parseJsonUpload(req.body);
      if (isFhirValueSetCatalog(resource)) {
        const result = await admin.valueSets.importFhirCatalog(resource);
        await recordAudit(ctx, req, { action: 'value_set.import', entityType: 'value_set', entityId: 'catalog', before: null, after: null, metadata: { imported: result.imported, skipped: result.skipped } });
        reply.code(201);
        return result;
      }
      const saved = await admin.valueSets.importFhir(resource);
      await recordAudit(ctx, req, { action: 'value_set.import', entityType: 'value_set', entityId: saved.id, before: null, after: null, metadata: { id: saved.id, url: saved.url } });
      reply.code(201);
      return saved;
    }
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

function isReadableBody(body: unknown): body is NodeJS.ReadableStream {
  return !!body && typeof body === 'object' && typeof (body as { pipe?: unknown }).pipe === 'function';
}

async function bodyToText(body: unknown): Promise<string> {
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (isReadableBody(body)) {
    let text = '';
    for await (const chunk of body as AsyncIterable<Buffer | string>) text += chunk.toString();
    return text;
  }
  return '';
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (isReadableBody(body)) {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  return Buffer.alloc(0);
}

async function parseJsonUpload(body: unknown): Promise<unknown> {
  if (body && typeof body === 'object' && !Buffer.isBuffer(body) && !isReadableBody(body)) return body;
  let bytes = await bodyToBuffer(body);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  return JSON.parse(bytes.toString('utf8'));
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
