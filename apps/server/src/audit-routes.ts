import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { redact } from '@openldr/core';
import { requireCapability } from './rbac';

// Audit metadata exposes who did what across the install; restrict reads to audit.view holders.
const VIEW = { preHandler: requireCapability('audit.view') };

export function registerAuditRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  app.get('/api/audit', VIEW, async (req, reply) => {
    try {
      const q = req.query as Record<string, string>;
      const filter = {
        action: q.action || undefined,
        entityType: q.entityType || undefined,
        entityId: q.entityId || undefined,
        actorId: q.actorId || undefined,
        from: q.from || undefined,
        to: q.to || undefined,
        limit: q.limit ? Number(q.limit) : 50,
        offset: q.offset ? Number(q.offset) : 0,
      };
      const [events, total] = await Promise.all([ctx.audit.list(filter), ctx.audit.count(filter)]);
      return { events, total };
    } catch (e) {
      reply.code(500);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });

  app.get('/api/audit/:id', VIEW, async (req, reply) => {
    const ev = await ctx.audit.get((req.params as { id: string }).id);
    if (!ev) {
      reply.code(404);
      return { error: 'not found' };
    }
    return ev;
  });
}
