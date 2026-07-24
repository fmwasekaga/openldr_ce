import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { redact, OpenLdrError } from '@openldr/core';
import { CAPABILITY_GROUPS } from '@openldr/rbac';
import { z } from 'zod';
import { requireCapability } from './rbac';
import { recordAudit } from './audit-helper';

const roleInput = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  description: z.string().nullish(),
  capabilities: z.array(z.string()).default([]),
});
const assignInput = z.object({ roleIds: z.array(z.string()) });

function isInvariant(e: unknown): e is OpenLdrError {
  return e instanceof OpenLdrError;
}

// ---------------------------------------------------------------------------
// Route registration — role CRUD, capability catalog, user-role assignment.
// All mutations are capability-gated (roles.manage) and audited; reads
// require roles.view. Store invariant violations (OpenLdrError) map to
// 400/409 depending on the route; unexpected errors map to 500 + redact().
// ---------------------------------------------------------------------------
export function registerRolesRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const VIEW = { preHandler: requireCapability('roles.view') };
  const MANAGE = { preHandler: requireCapability('roles.manage') };

  app.get('/api/roles', VIEW, async () => ctx.roles.list());

  app.get('/api/roles/catalog', VIEW, async () => ({ groups: CAPABILITY_GROUPS }));

  app.get('/api/roles/:id', VIEW, async (req, reply) => {
    const r = await ctx.roles.get((req.params as { id: string }).id);
    if (!r) {
      reply.code(404);
      return { error: 'not found' };
    }
    return r;
  });

  app.post('/api/roles', MANAGE, async (req, reply) => {
    const p = roleInput.safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: p.error.message };
    }
    try {
      const created = await ctx.roles.create(p.data);
      await recordAudit(ctx, req, {
        action: 'role.create',
        entityType: 'role',
        entityId: created.id,
        before: null,
        after: created as unknown as Record<string, unknown>,
      });
      reply.code(201);
      return created;
    } catch (e) {
      if (isInvariant(e)) {
        reply.code(400);
        return { error: e.message };
      }
      reply.code(500);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });

  app.put('/api/roles/:id', MANAGE, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const p = roleInput.partial().safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: p.error.message };
    }
    const before = await ctx.roles.get(id);
    if (!before) {
      reply.code(404);
      return { error: 'not found' };
    }
    try {
      const after = await ctx.roles.update(id, p.data);
      await recordAudit(ctx, req, {
        action: 'role.update',
        entityType: 'role',
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    } catch (e) {
      if (isInvariant(e)) {
        reply.code(400);
        return { error: e.message };
      }
      reply.code(500);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });

  app.delete('/api/roles/:id', MANAGE, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const before = await ctx.roles.get(id);
    if (!before) {
      reply.code(404);
      return { error: 'not found' };
    }
    try {
      await ctx.roles.remove(id);
      await recordAudit(ctx, req, {
        action: 'role.delete',
        entityType: 'role',
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: null,
      });
      reply.code(204);
      return null;
    } catch (e) {
      if (isInvariant(e)) {
        reply.code(409);
        return { error: e.message };
      }
      reply.code(500);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });

  app.get('/api/users/:id/roles', VIEW, async (req) => ctx.roles.rolesForUser((req.params as { id: string }).id));

  app.put('/api/users/:id/roles', MANAGE, async (req, reply) => {
    const subject = (req.params as { id: string }).id;
    const p = assignInput.safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: p.error.message };
    }
    const before = await ctx.roles.rolesForUser(subject);
    try {
      await ctx.roles.setUserRoles(subject, p.data.roleIds);
      const after = await ctx.roles.rolesForUser(subject);
      await recordAudit(ctx, req, {
        action: 'user.assign_role',
        entityType: 'user',
        entityId: subject,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    } catch (e) {
      if (isInvariant(e)) {
        reply.code(400);
        return { error: e.message };
      }
      reply.code(500);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });
}
