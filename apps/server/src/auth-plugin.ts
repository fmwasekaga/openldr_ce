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
  if (h && h.startsWith('Bearer ')) { const t = h.slice('Bearer '.length).trim(); if (t) return t; }
  const url = req.raw.url ?? '';
  const path = url.split('?')[0];
  // Server-Sent Events streams (ontology build/rebuild) cannot set an Authorization header,
  // so accept the access token from the query string for THOSE routes only. It is verified
  // identically to a header token — no weakening of auth.
  if (/^\/api\/terminology\/ontology\/[^/]+\/(build|rebuild)$/.test(path)) {
    const qs = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
    const tok = new URLSearchParams(qs).get('access_token');
    if (tok && tok.trim()) return tok.trim();
  }
  return null;
}

const PROVIDER_DEFAULT_ROLE = (n: string): boolean =>
  n.startsWith('default-roles') || n === 'offline_access' || n === 'uma_authorization';

/**
 * RBAC roles come from the verified token's `realm_access.roles` (Keycloak owns roles in
 * the decoupled model), with provider-default roles filtered out. The local user record is
 * only the audit-actor identity + the disable switch — never the authorization source.
 */
function realmRolesFromClaims(claims: Record<string, unknown>): string[] {
  const ra = claims['realm_access'];
  const roles = ra && typeof ra === 'object' ? (ra as { roles?: unknown }).roles : undefined;
  if (!Array.isArray(roles)) return [];
  return roles.filter((r): r is string => typeof r === 'string' && !PROVIDER_DEFAULT_ROLE(r));
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
  } catch (e) {
    ctx.logger.warn({ error: e instanceof Error ? e.message : String(e) }, 'dev-bypass actor fell back to synthetic (user store unavailable)');
    return { id: `dev:${username}`, username, displayName: 'Dev Admin', roles };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerAuth(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = (req.raw.url ?? '').split('?')[0];
    // Only /api/* is protected. /health and the static SPA stay public.
    if (path === '/api/config') return; // public: the SPA reads OIDC settings before it has a token
    // Webhook trigger endpoints authenticate via their per-path X-Webhook-Token secret (a
    // constant-time compare in the route), not a Keycloak session — external callers have no
    // bearer token. Let them through to the route's own secret check. The trailing slash keeps
    // this scoped to the hooks subtree, so workflow management routes (/api/workflows) stay gated.
    if (path.startsWith('/api/workflows/hooks/')) return;
    // Distributed-sync push endpoints authenticate via their OWN client-credentials check in the
    // route (a machine client has no local user record, so users.syncFromClaims must not run for
    // it). The trailing slash scopes this to the sync subtree. Analogous to the hooks bypass above.
    if (path.startsWith('/api/sync/')) return;
    if (path !== '/api' && !path.startsWith('/api/')) return;

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
      req.user = { id: u.id, username: u.username, displayName: u.displayName, roles: realmRolesFromClaims(claims) };
    } catch (e) {
      ctx.logger.error({ error: e instanceof Error ? e.message : String(e) }, 'user sync failed');
      reply.code(401);
      return reply.send({ error: 'authentication failed' });
    }
  });
}
