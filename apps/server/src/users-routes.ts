import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { redact } from '@openldr/core';
import { z } from 'zod';
import { requireRole } from './rbac';
import { recordAudit } from './audit-helper';

const resetPasswordInput = z.object({ password: z.string().min(1), temporary: z.boolean().optional() });

// Duck-type by name: apps/server intentionally does not depend on @openldr/ports,
// and name-based detection is robust across module/bundle boundaries. The error
// class sets this name in its constructor.
function isNotConfigured(e: unknown): boolean {
  return e instanceof Error && e.name === 'IdentityAdminNotConfiguredError';
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------
const createInput = z.object({
  username: z.string().min(1),
  email: z.string().nullish(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  roles: z.array(z.string()).optional(),
  password: z.string().optional(),
  extras: z.record(z.object({ value: z.string(), fhirPath: z.string().nullable().optional().transform((v) => v ?? null) })).optional(),
  formSchemaId: z.string().nullish(),
  formVersion: z.number().nullish(),
});
const updateInput = z.object({
  email: z.string().nullish(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  roles: z.array(z.string()).optional(),
  extras: z.record(z.object({ value: z.string(), fhirPath: z.string().nullable().optional().transform((v) => v ?? null) })).optional(),
  formSchemaId: z.string().nullish(),
  formVersion: z.number().nullish(),
});

// ---------------------------------------------------------------------------
// UserSummary composer
// ---------------------------------------------------------------------------
interface DirectoryUser {
  id: string;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  enabled: boolean;
  roles: string[];
  createdAt: string | null;
}
interface UserProfile {
  userId?: string;
  formSchemaId: string | null;
  formVersion: number | null;
  extras: Record<string, { value: string; fhirPath?: string | null }>;
}

function summary(
  d: DirectoryUser,
  profile?: UserProfile,
): Record<string, unknown> {
  const extras: Record<string, string> = {};
  if (profile) {
    for (const [k, v] of Object.entries(profile.extras)) {
      extras[k] = v.value;
    }
  }
  return {
    id: d.id,
    username: d.username,
    email: d.email,
    firstName: d.firstName,
    lastName: d.lastName,
    enabled: d.enabled,
    roles: d.roles,
    createdAt: d.createdAt,
    extras,
    formSchemaId: profile?.formSchemaId ?? null,
    formVersion: profile?.formVersion ?? null,
  };
}

// Fallback: map a local users-mirror row to UserSummary
function localToSummary(u: {
  id: string;
  username: string;
  email: string | null;
  roles: string[];
  status: string;
  createdAt: string | null;
}): Record<string, unknown> {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    firstName: null,
    lastName: null,
    enabled: u.status !== 'disabled',
    roles: u.roles,
    createdAt: u.createdAt,
    extras: {},
    formSchemaId: null,
    formVersion: null,
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerUsersRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  // ------------------------------------------------------------------
  // GET /api/users — composes directory + profiles; falls back to local
  // ------------------------------------------------------------------
  app.get('/api/users', async () => {
    try {
      const users = await ctx.auth.directory.list();
      const profiles = await ctx.userProfiles.list(users.map((u) => u.id));
      return users.map((u) => summary(u, profiles.get(u.id)));
    } catch (e) {
      if (isNotConfigured(e)) {
        return (await ctx.users.list()).map(localToSummary);
      }
      throw e;
    }
  });

  // ------------------------------------------------------------------
  // GET /api/users/:id
  // ------------------------------------------------------------------
  app.get('/api/users/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    try {
      const du = await ctx.auth.directory.get(id);
      if (!du) {
        reply.code(404);
        return { error: 'not found' };
      }
      const profile = await ctx.userProfiles.get(id);
      return summary(du, profile);
    } catch (e) {
      if (isNotConfigured(e)) {
        const u = await ctx.users.get(id);
        if (!u) {
          reply.code(404);
          return { error: 'not found' };
        }
        return localToSummary(u);
      }
      throw e;
    }
  });

  // ------------------------------------------------------------------
  // POST /api/users — create in directory + upsert profile
  // ------------------------------------------------------------------
  app.post('/api/users', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const p = createInput.safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: p.error.message };
    }
    const { username, email, firstName, lastName, roles, password, extras, formSchemaId, formVersion } = p.data;

    try {
      const du = await ctx.auth.directory.create({ username, email, firstName, lastName, roles, password });
      try {
        await ctx.userProfiles.upsert(du.id, { formSchemaId, formVersion, extras });
      } catch (pe) {
        // The identity-provider account WAS created; only the local profile write failed.
        // Surface a recoverable message — the operator can edit the user to set its profile.
        reply.code(502);
        return { error: redact(`user created in the identity provider but the local profile write failed; edit the user to set its profile (${pe instanceof Error ? pe.message : String(pe)})`) };
      }
      const after = summary(du, await ctx.userProfiles.get(du.id));
      await recordAudit(ctx, req, { action: 'user.create', entityType: 'user', entityId: du.id, before: null, after });
      reply.code(201);
      return after;
    } catch (e) {
      if (isNotConfigured(e)) {
        reply.code(503);
        return { error: 'identity provider admin client is not configured' };
      }
      reply.code(502);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });

  // ------------------------------------------------------------------
  // PUT /api/users/:id — update directory + profile
  // ------------------------------------------------------------------
  app.put('/api/users/:id', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const p = updateInput.safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: p.error.message };
    }
    const id = (req.params as { id: string }).id;
    const { email, firstName, lastName, roles, extras, formSchemaId, formVersion } = p.data;

    try {
      const beforeDir = await ctx.auth.directory.get(id);
      if (!beforeDir) {
        reply.code(404);
        return { error: 'not found' };
      }
      const beforeProfile = await ctx.userProfiles.get(id);
      const before = summary(beforeDir, beforeProfile);
      await ctx.auth.directory.update(id, { email, firstName, lastName });
      if (roles !== undefined) {
        await ctx.auth.directory.setRoles(id, roles);
      }
      await ctx.userProfiles.upsert(id, { formSchemaId, formVersion, extras });
      const afterDir = await ctx.auth.directory.get(id);
      const after = summary(afterDir!, await ctx.userProfiles.get(id));
      await recordAudit(ctx, req, {
        action: 'user.update',
        entityType: 'user',
        entityId: id,
        before,
        after,
      });
      return after;
    } catch (e) {
      if (isNotConfigured(e)) {
        reply.code(503);
        return { error: 'identity provider admin client is not configured' };
      }
      reply.code(502);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });

  // ------------------------------------------------------------------
  // POST /api/users/:id/status — enable/disable in directory
  // ------------------------------------------------------------------
  app.post('/api/users/:id/status', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = req.body as { enabled?: boolean; status?: string };

    // Accept { enabled: boolean } (new) or { status: 'active'|'disabled' } (legacy)
    let enabled: boolean;
    if (typeof body.enabled === 'boolean') {
      enabled = body.enabled;
    } else if (body.status === 'active') {
      enabled = true;
    } else if (body.status === 'disabled') {
      enabled = false;
    } else {
      reply.code(400);
      return { error: 'body must include { enabled: boolean } or { status: "active"|"disabled" }' };
    }

    try {
      const beforeDir = await ctx.auth.directory.get(id);
      if (!beforeDir) {
        reply.code(404);
        return { error: 'not found' };
      }
      const beforeProfile = await ctx.userProfiles.get(id);
      const before = summary(beforeDir, beforeProfile);
      await ctx.auth.directory.update(id, { enabled });
      const afterDir = await ctx.auth.directory.get(id);
      const after = summary(afterDir!, await ctx.userProfiles.get(id));
      await recordAudit(ctx, req, {
        action: 'user.status',
        entityType: 'user',
        entityId: id,
        before,
        after,
        metadata: { enabled },
      });
      return after;
    } catch (e) {
      if (isNotConfigured(e)) {
        reply.code(503);
        return { error: 'identity provider admin client is not configured' };
      }
      reply.code(502);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });

  // ------------------------------------------------------------------
  // SP4 routes — id IS the provider subject; no local lookup
  // ------------------------------------------------------------------
  app.post('/api/users/:id/reset-password', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const p = resetPasswordInput.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const id = (req.params as { id: string }).id;
    try {
      await ctx.auth.resetPassword(id, p.data.password, p.data.temporary ?? true);
    } catch (e) {
      if (isNotConfigured(e)) { reply.code(503); return { error: 'identity provider admin client is not configured' }; }
      reply.code(502); return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
    await recordAudit(ctx, req, { action: 'user.reset_password', entityType: 'user', entityId: id, before: null, after: null, metadata: { temporary: p.data.temporary ?? true } });
    reply.code(204); return null;
  });

  app.post('/api/users/:id/send-reset-email', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    try {
      await ctx.auth.sendPasswordResetEmail(id);
    } catch (e) {
      if (isNotConfigured(e)) { reply.code(503); return { error: 'identity provider admin client is not configured' }; }
      reply.code(502); return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
    await recordAudit(ctx, req, { action: 'user.send_reset_email', entityType: 'user', entityId: id, before: null, after: null });
    reply.code(204); return null;
  });

  app.post('/api/users/:id/force-logout', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (req.user?.id === id) { reply.code(400); return { error: 'cannot force-logout your own account' }; }
    try {
      await ctx.auth.forceLogout(id);
    } catch (e) {
      if (isNotConfigured(e)) { reply.code(503); return { error: 'identity provider admin client is not configured' }; }
      reply.code(502); return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
    await recordAudit(ctx, req, { action: 'user.force_logout', entityType: 'user', entityId: id, before: null, after: null });
    reply.code(204); return null;
  });
}
