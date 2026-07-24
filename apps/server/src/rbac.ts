import type { FastifyReply, FastifyRequest } from 'fastify';

/** preHandler guard: requires the request actor to hold at least one of `roles`. */
export function requireRole(...roles: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) {
      reply.code(401);
      return reply.send({ error: 'authentication required' });
    }
    if (!req.user.roles.some((r) => roles.includes(r))) {
      reply.code(403);
      return reply.send({ error: 'insufficient role' });
    }
  };
}

/** preHandler guard: requires the request actor to hold `cap`. */
export function requireCapability(cap: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) {
      reply.code(401);
      return reply.send({ error: 'authentication required' });
    }
    if (!req.user.capabilities.includes(cap)) {
      reply.code(403);
      return reply.send({ error: 'insufficient capability' });
    }
  };
}
