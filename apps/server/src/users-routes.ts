import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { redact } from '@openldr/core';
import { z } from 'zod';
import { requireRole } from './rbac';
import { recordAudit } from './audit-helper';

const createInput = z.object({
  username: z.string().min(1),
  displayName: z.string().nullish(),
  email: z.string().nullish(),
  roles: z.array(z.string()).optional(),
});
const updateInput = z.object({
  displayName: z.string().nullish(),
  email: z.string().nullish(),
  roles: z.array(z.string()).optional(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerUsersRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  // Read-only listing/detail: any authenticated user (global auth hook). The
  // lab_admin guard is intentionally applied to mutations only.
  app.get('/api/users', async () => ctx.users.list());

  app.get('/api/users/:id', async (req, reply) => {
    const u = await ctx.users.get((req.params as { id: string }).id);
    if (!u) {
      reply.code(404);
      return { error: 'not found' };
    }
    return u;
  });

  app.post('/api/users', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const p = createInput.safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: p.error.message };
    }
    try {
      const u = await ctx.users.create({
        username: p.data.username,
        displayName: p.data.displayName ?? undefined,
        email: p.data.email ?? undefined,
        roles: p.data.roles,
      });
      await recordAudit(ctx, req, { action: 'user.create', entityType: 'user', entityId: u.id, before: null, after: u });
      reply.code(201);
      return u;
    } catch (e) {
      reply.code(409);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });

  app.put('/api/users/:id', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const p = updateInput.safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: p.error.message };
    }
    const id = (req.params as { id: string }).id;
    const before = await ctx.users.get(id);
    if (!before) {
      reply.code(404);
      return { error: 'not found' };
    }
    if (p.data.roles) await ctx.users.setRoles(id, p.data.roles);
    await ctx.users.update(id, { displayName: p.data.displayName ?? undefined, email: p.data.email ?? undefined });
    const after = await ctx.users.get(id);
    await recordAudit(ctx, req, { action: 'user.update', entityType: 'user', entityId: id, before, after });
    return after;
  });

  app.post('/api/users/:id/status', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const s = (req.body as { status?: string }).status;
    if (s !== 'active' && s !== 'disabled') {
      reply.code(400);
      return { error: 'status must be active|disabled' };
    }
    const id = (req.params as { id: string }).id;
    const before = await ctx.users.get(id);
    if (!before) {
      reply.code(404);
      return { error: 'not found' };
    }
    await ctx.users.setStatus(id, s);
    const after = await ctx.users.get(id);
    await recordAudit(ctx, req, { action: 'user.status', entityType: 'user', entityId: id, before, after, metadata: { status: s } });
    return after;
  });
}
