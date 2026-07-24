import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import AdmZip from 'adm-zip';
import type { AppContext } from '@openldr/bootstrap';
import { redact } from '@openldr/core';
import { toQuestionnaire, toQuestionnaireResponse } from '@openldr/forms';
import { z } from 'zod';
import { recordAudit } from './audit-helper';
import { requireCapability } from './rbac';

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'form';
}

const formInput = z.object({
  name: z.string().min(1),
  versionLabel: z.string().nullish(),
  fhirResourceType: z.string().nullish(),
  fhirVersion: z.string().nullish(),
  fhirProfileUrl: z.string().nullish(),
  facilityId: z.string().nullish(),
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

// These routes were previously UNGATED (no requireRole at all — any authenticated user could hit
// them). Task 8 adds capability gates per the mapping table: read/fill routes require forms.view
// (held by every system-role preset, including lab_technician — so no preset loses access);
// create/edit/delete/export routes require forms.edit; publish-adjacent routes require
// forms.publish. NOTE: POST /:id/status can transition a form to 'published' (and audits as
// 'form.publish' when it does) — it is therefore gated on forms.publish rather than forms.edit,
// even though a plain draft<->archived toggle is arguably a lesser action. This avoids a custom
// role holding forms.edit-without-forms.publish being able to publish via this side door; no
// system-role preset is harmed since every preset that holds forms.edit also holds forms.publish.
const VIEW = { preHandler: requireCapability('forms.view') };
const EDIT = { preHandler: requireCapability('forms.edit') };
const PUBLISH = { preHandler: requireCapability('forms.publish') };

export function registerFormsRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  app.get('/api/forms', VIEW, async () => ctx.forms.list());

  app.get('/api/forms/published', VIEW, async (req) => {
    const query = req.query as Record<string, string | undefined>;
    return ctx.forms.listPublished(query.targetPage || undefined);
  });

  app.get('/api/forms/:id', VIEW, async (req, reply) => {
    const f = await ctx.forms.get((req.params as { id: string }).id);
    if (!f) {
      reply.code(404);
      return { error: 'not found' };
    }
    return f;
  });

  app.post('/api/forms', EDIT, async (req, reply) => {
    const p = formInput.safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: p.error.message };
    }
    try {
      const f = await ctx.forms.create(p.data as never);
      await recordAudit(ctx, req, { action: 'form.create', entityType: 'form', entityId: f.id, before: null, after: f });
      reply.code(201);
      return f;
    } catch (e) {
      reply.code(409);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });

  app.put('/api/forms/:id', EDIT, async (req, reply) => {
    const p = formInput.safeParse(req.body);
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
    const after = await ctx.forms.update(id, p.data as never);
    await recordAudit(ctx, req, { action: 'form.update', entityType: 'form', entityId: id, before, after });
    return after;
  });

  app.post('/api/forms/:id/status', PUBLISH, async (req, reply) => {
    const status = (req.body as { status?: string }).status;
    if (status !== 'draft' && status !== 'published' && status !== 'archived') {
      reply.code(400);
      return { error: 'status must be draft|published|archived' };
    }
    const id = (req.params as { id: string }).id;
    const before = await ctx.forms.get(id);
    if (!before) {
      reply.code(404);
      return { error: 'not found' };
    }
    const after = await ctx.forms.setStatus(id, status);
    await recordAudit(ctx, req, { action: status === 'published' ? 'form.publish' : 'form.status', entityType: 'form', entityId: id, before, after });
    return after;
  });

  app.post('/api/forms/:id/publish', PUBLISH, async (req, reply) => {
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
    const after = await ctx.forms.publish(id, { versionLabel: p.data.versionLabel ?? null, actorId: req.user?.id ?? null });
    await recordAudit(ctx, req, { action: 'form.publish', entityType: 'form', entityId: id, before, after });
    return after;
  });

  app.post('/api/forms/:id/duplicate', EDIT, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await ctx.forms.get(id))) {
      reply.code(404);
      return { error: 'not found' };
    }
    const copy = await ctx.forms.duplicate(id);
    await recordAudit(ctx, req, { action: 'form.duplicate', entityType: 'form', entityId: copy.id, before: null, after: copy, metadata: { sourceFormId: id } });
    reply.code(201);
    return copy;
  });

  app.get('/api/forms/:id/versions', VIEW, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await ctx.forms.get(id))) {
      reply.code(404);
      return { error: 'not found' };
    }
    return ctx.forms.listVersions(id);
  });

  app.get('/api/forms/:id/versions/:version', VIEW, async (req, reply) => {
    const { id, version } = req.params as { id: string; version: string };
    if (!/^[1-9]\d*$/.test(version)) {
      reply.code(400);
      return { error: 'version must be a positive integer' };
    }
    const parsedVersion = Number(version);
    if (!Number.isSafeInteger(parsedVersion) || parsedVersion > 2147483647) {
      reply.code(400);
      return { error: 'version must be a positive integer' };
    }
    if (!(await ctx.forms.get(id))) {
      reply.code(404);
      return { error: 'not found' };
    }
    const snapshot = await ctx.forms.getVersion(id, parsedVersion);
    if (!snapshot) {
      reply.code(404);
      return { error: 'not found' };
    }
    return snapshot;
  });

  app.delete('/api/forms/:id', EDIT, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const before = await ctx.forms.get(id);
    if (!before) {
      reply.code(404);
      return { error: 'not found' };
    }
    await ctx.forms.delete(id);
    await recordAudit(ctx, req, { action: 'form.delete', entityType: 'form', entityId: id, before, after: null });
    reply.code(204);
    return null;
  });

  app.get('/api/forms/:id/questionnaire', VIEW, async (req, reply) => {
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

  app.get('/api/forms/:id/export-bundle', EDIT, async (req, reply) => {
    const { id } = req.params as { id: string };
    const form = await ctx.forms.get(id);
    if (!form) {
      reply.code(404);
      return { error: 'form not found' };
    }
    const versions = await ctx.forms.listVersions(id);
    if (!versions.length) {
      reply.code(404);
      return { error: 'form has no published version to export' };
    }
    const latest = await ctx.forms.getVersion(id, versions[0].version);
    if (!latest) {
      reply.code(404);
      return { error: 'published version not found' };
    }

    const questionnaireBytes = Buffer.from(JSON.stringify(latest.questionnaire, null, 2), 'utf8');
    const questionnaireSha256 = createHash('sha256').update(questionnaireBytes).digest('hex');
    const artifactId = slug(form.name);
    // The artifact manifest requires strict semver; form versionLabel is free-form
    // (e.g. 'v1'), so fall back to '1.0.0' when it isn't already valid semver.
    const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
    const version = form.versionLabel && SEMVER.test(form.versionLabel) ? form.versionLabel : '1.0.0';
    const manifest = {
      schemaVersion: 1,
      type: 'form-template',
      id: artifactId,
      version,
      description: form.name,
      license: 'UNLICENSED',
      compatibility: { ceVersion: '*' },
      capabilities: [],
      payload: { kind: 'form-template', questionnaireSha256 },
    };

    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
    zip.addFile('questionnaire.json', questionnaireBytes);
    const buf = zip.toBuffer();

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${artifactId}-${version}.zip"`);
    return reply.send(buf);
  });

  app.post('/api/forms/:id/responses', VIEW, async (req, reply) => {
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
      const response = toQuestionnaireResponse(f.schema, p.data.answers as never);
      await recordAudit(ctx, req, { action: 'form.response.submit', entityType: 'form', entityId: f.id, before: null, after: response, metadata: { formId: f.id } });
      reply.code(201);
      return response;
    } catch (e) {
      reply.code(500);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });
}
