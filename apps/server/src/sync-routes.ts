import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import type { PushBatch, PushResponse } from '@openldr/sync';

// Site principal derived from a machine client's bearer token. The user-auth onRequest hook
// in auth-plugin.ts is bypassed for /api/sync/* (a machine client has no user record), so the
// sync route does its OWN client-credentials auth here and scopes writes to the token's site.
async function sitePrincipal(
  req: FastifyRequest,
  reply: FastifyReply,
  ctx: AppContext,
): Promise<{ siteId: string } | undefined> {
  const h = req.headers.authorization;
  const token = h?.startsWith('Bearer ') ? h.slice('Bearer '.length).trim() : '';
  if (!token) {
    reply.code(401).send({ error: 'authentication required' });
    return;
  }
  let claims: Awaited<ReturnType<typeof ctx.auth.verifyToken>>;
  try {
    claims = await ctx.auth.verifyToken(token);
  } catch {
    reply.code(401).send({ error: 'invalid token' });
    return;
  }
  const siteId = typeof claims['site_id'] === 'string' ? (claims['site_id'] as string) : '';
  if (!siteId) {
    reply.code(403).send({ error: 'token missing site_id claim' });
    return;
  }
  return { siteId };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerSyncRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  // POST /api/sync/push — a lab pushes an ordered window of change_log records. Each record is
  // mirror-applied at its origin version/site via fhirStore.applyRemote (idempotent).
  // S1 accepts plain JSON only; gzip transport is deferred to S7.
  app.post('/api/sync/push', async (req, reply) => {
    const principal = await sitePrincipal(req, reply, ctx);
    if (!principal) return; // reply already sent (401/403)

    const body = req.body as Partial<PushBatch> | undefined;
    const records = body?.records;
    if (!Array.isArray(records)) {
      reply.code(400).send({ error: 'records must be an array' });
      return;
    }
    const fromSeq = typeof body?.fromSeq === 'number' ? body.fromSeq : 0;

    let applied = 0;
    let skipped = 0;
    const rejects: PushResponse['rejects'] = [];

    // Apply in seq order (labs push contiguous windows already ordered, but be explicit).
    const ordered = [...records].sort((a, b) => a.seq - b.seq);
    for (const record of ordered) {
      if (record.siteId !== principal.siteId) {
        // A client may only push its OWN site's changes. Do not apply cross-site records.
        rejects.push({ id: record.id, version: record.version, seq: record.seq, reason: 'cross-site' });
        continue;
      }
      try {
        // SyncRecord & { seq } is structurally a superset of RemoteRecord; the extra seq is harmless.
        const r = await ctx.fhirStore.applyRemote(record);
        if (r === 'applied') applied++;
        else skipped++;
      } catch (e) {
        // One bad record must not 500 the whole batch — record it as a reject and continue.
        ctx.logger.warn(
          { error: e instanceof Error ? e.message : String(e), id: record.id, seq: record.seq },
          'sync push: applyRemote failed for record',
        );
        rejects.push({ id: record.id, version: record.version, seq: record.seq, reason: 'apply-error' });
      }
    }

    // Every record is "handled" (applied, skipped, or rejected), so the lab may advance past all of
    // them. Empty batch → hold the cursor at fromSeq so it never moves backward.
    const ackSeq = records.reduce((m, r) => Math.max(m, r.seq), fromSeq);

    const response: PushResponse = { ackSeq, applied, skipped, rejects };
    reply.code(200).send(response);
  });
}
