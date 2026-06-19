import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';

export interface RequestActor {
  id: string;
  username: string;
  displayName: string | null;
  roles: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: RequestActor;
  }
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  const t = h.slice('Bearer '.length).trim();
  return t.length > 0 ? t : null;
}

async function devActor(ctx: AppContext): Promise<RequestActor> {
  const username = ctx.cfg.AUTH_DEV_USERNAME ?? 'dev-admin';
  const roles = (ctx.cfg.AUTH_DEV_ROLES ?? 'lab_admin')
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  try {
    const existing = await ctx.users.getByUsername(username);
    const u = existing ?? (await ctx.users.create({ username, displayName: 'Dev Admin', roles }));
    return { id: u.id, username: u.username, displayName: u.displayName, roles: u.roles.length > 0 ? u.roles : roles };
  } catch {
    return { id: `dev:${username}`, username, displayName: 'Dev Admin', roles };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerAuth(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.raw.url ?? '';
    // Only /api/* is protected. /health and the static SPA stay public.
    if (url !== '/api' && !url.startsWith('/api/')) return;

    const token = bearer(req);
    if (!token) {
      if (ctx.cfg.AUTH_DEV_BYPASS) {
        req.user = await devActor(ctx);
        return;
      }
      reply.code(401);
      return reply.send({ error: 'authentication required' });
    }

    let claims: Awaited<ReturnType<typeof ctx.auth.verifyToken>>;
    try {
      claims = await ctx.auth.verifyToken(token);
    } catch (e) {
      ctx.logger.warn({ error: e instanceof Error ? e.message : String(e) }, 'token verification failed');
      reply.code(401);
      return reply.send({ error: 'invalid token' });
    }

    try {
      const u = await ctx.users.syncFromClaims(claims);
      if (u.status === 'disabled') {
        reply.code(403);
        return reply.send({ error: 'account disabled' });
      }
      req.user = { id: u.id, username: u.username, displayName: u.displayName, roles: u.roles };
    } catch (e) {
      ctx.logger.error({ error: e instanceof Error ? e.message : String(e) }, 'user sync failed');
      reply.code(401);
      return reply.send({ error: 'authentication failed' });
    }
  });
}
