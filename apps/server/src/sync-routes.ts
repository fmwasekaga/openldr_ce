import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { servePull, type AppContext } from '@openldr/bootstrap';
import type { PushBatch, PushResponse, SyncRecord } from '@openldr/sync';

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
    // The body crosses a trust boundary — sanitize fromSeq (a non-finite value must not seed ackSeq).
    const fromSeq = Number.isFinite(body?.fromSeq) ? (body!.fromSeq as number) : 0;

    let applied = 0;
    let skipped = 0;
    // Every handled record advances ackSeq; a non-finite seq can never contribute, so it can't
    // poison the anchor into NaN (which would serialize to JSON null and break the lab's cursor).
    let ackSeq = fromSeq;
    const rejects: PushResponse['rejects'] = [];

    // Apply in seq order. The comparator must never dereference a malformed element (e.g. null),
    // so read the seq defensively; malformed elements fall back to 0 for ordering and are rejected
    // in the loop below.
    const seqOf = (r: unknown): number =>
      r != null && typeof r === 'object' && Number.isFinite((r as { seq?: unknown }).seq)
        ? ((r as { seq: number }).seq)
        : 0;
    const ordered = [...records].sort((a, b) => seqOf(a) - seqOf(b));

    for (const record of ordered) {
      // A handled record (applied/skipped/rejected of any kind) lets the lab advance past its seq.
      // Advance BEFORE shape validation so even a malformed-but-seq-bearing record moves the cursor;
      // only a record with no usable finite seq is left out (it cannot contribute an anchor).
      const rawSeq = record != null && typeof record === 'object' ? (record as { seq?: unknown }).seq : undefined;
      if (typeof rawSeq === 'number' && Number.isFinite(rawSeq)) ackSeq = Math.max(ackSeq, rawSeq);

      // Shape guard: the element may be null / a primitive / missing required fields (untrusted wire
      // input). A malformed element must degrade to a `malformed` reject, never a 500 or an apply.
      const r = record as Partial<SyncRecord & { seq: number }> | null | undefined;
      if (
        r == null ||
        typeof r !== 'object' ||
        typeof r.id !== 'string' ||
        typeof r.siteId !== 'string' ||
        (r.op !== 'upsert' && r.op !== 'delete') ||
        typeof r.seq !== 'number' ||
        !Number.isFinite(r.seq)
      ) {
        rejects.push({
          id: typeof r?.id === 'string' ? r.id : '',
          version: typeof r?.version === 'number' && Number.isFinite(r.version) ? r.version : 0,
          seq: typeof r?.seq === 'number' && Number.isFinite(r.seq) ? r.seq : 0,
          reason: 'malformed',
        });
        continue;
      }
      const rec = r as SyncRecord & { seq: number };

      if (rec.siteId !== principal.siteId) {
        // A client may only push its OWN site's changes. Do not apply cross-site records.
        rejects.push({ id: rec.id, version: rec.version, seq: rec.seq, reason: 'cross-site' });
        continue;
      }
      try {
        // SyncRecord & { seq } is structurally a superset of RemoteRecord; the extra seq is harmless.
        const result = await ctx.fhirStore.applyRemote(rec);
        if (result === 'applied') applied++;
        else skipped++;
      } catch (e) {
        // One bad record must not 500 the whole batch — record it as a reject and continue.
        ctx.logger.warn(
          { error: e instanceof Error ? e.message : String(e), id: rec.id, seq: rec.seq },
          'sync push: applyRemote failed for record',
        );
        rejects.push({ id: rec.id, version: rec.version, seq: rec.seq, reason: 'apply-error' });
      }
    }

    // Empty batch → ackSeq stayed at fromSeq (the cursor never moves backward).
    const response: PushResponse = { ackSeq, applied, skipped, rejects };
    reply.code(200).send(response);
  });

  // POST /api/sync/pull — global reference-data delta since the lab's cursor. Auth-only (NOT
  // site-scoped: every enrolled lab pulls the same global reference config; sitePrincipal only
  // gates access to a valid enrolled token, it does not filter the response by site).
  app.post('/api/sync/pull', async (req, reply) => {
    const principal = await sitePrincipal(req, reply, ctx);
    if (!principal) return; // reply already sent (401/403)

    // fromSeq crosses a trust boundary — a non-finite value must not seed the cursor.
    const rawFrom = (req.body as { fromSeq?: unknown } | undefined)?.fromSeq;
    const fromSeq = typeof rawFrom === 'number' && Number.isFinite(rawFrom) ? rawFrom : 0;

    // The serve logic lives in @openldr/bootstrap (servePull) so the offline pull-bundle exporter
    // (Sync S5) reuses it verbatim. The HTTP route serves everything servePull returns (S3 behaviour
    // unchanged); only the bundle exporter filters terminology signals out.
    const { records, nextSeq } = await servePull(ctx, fromSeq);
    reply.code(200).send({ records, nextSeq });
  });

  // POST /api/sync/terminology/concepts — keyset-paginated bulk drain of ONE terminology system's
  // concepts. Auth-only (global terminology, not site-scoped). Keyset by `code` (WHERE code > afterCode
  // ORDER BY code LIMIT n) so paging is stable + resumable under concurrent writes. nextCode=null on a
  // short (last) page.
  app.post('/api/sync/terminology/concepts', async (req, reply) => {
    const principal = await sitePrincipal(req, reply, ctx);
    if (!principal) return; // reply already sent (401/403)

    const b = (req.body ?? {}) as { systemUrl?: string; afterCode?: string; limit?: number };
    if (typeof b.systemUrl !== 'string' || !b.systemUrl) {
      reply.code(400).send({ error: 'systemUrl required' });
      return;
    }
    const limit = Number.isFinite(b.limit) && (b.limit as number) > 0 ? Math.min(b.limit as number, 5000) : 1000;

    let q = ctx.internalDb.selectFrom('terminology_concepts').selectAll().where('system', '=', b.systemUrl);
    if (typeof b.afterCode === 'string' && b.afterCode) q = q.where('code', '>', b.afterCode);
    const rows = await q.orderBy('code', 'asc').limit(limit).execute();

    const concepts = rows.map((r) => ({
      code: r.code,
      display: r.display,
      status: r.status,
      // properties is jsonb — parse to an object on the wire (string under some drivers, object under pg).
      properties: r.properties == null ? null : typeof r.properties === 'string' ? JSON.parse(r.properties) : r.properties,
    }));
    // A full page ⇒ there may be more; carry the last code as the resume key. A short page ⇒ done.
    const nextCode = rows.length === limit ? rows[rows.length - 1].code : null;
    reply.send({ concepts, nextCode });
  });

  // POST /api/sync/terminology/map-elements — keyset-paginated bulk drain of ONE concept map's
  // elements. Auth-only. Row-value keyset by (source_system, source_code) so the compound sort key is
  // stable + resumable. nextKey=null on a short (last) page.
  app.post('/api/sync/terminology/map-elements', async (req, reply) => {
    const principal = await sitePrincipal(req, reply, ctx);
    if (!principal) return; // reply already sent (401/403)

    const b = (req.body ?? {}) as {
      mapUrl?: string;
      afterSourceSystem?: string;
      afterSourceCode?: string;
      limit?: number;
    };
    if (typeof b.mapUrl !== 'string' || !b.mapUrl) {
      reply.code(400).send({ error: 'mapUrl required' });
      return;
    }
    const limit = Number.isFinite(b.limit) && (b.limit as number) > 0 ? Math.min(b.limit as number, 5000) : 1000;

    let q = ctx.internalDb.selectFrom('concept_map_elements').selectAll().where('map_url', '=', b.mapUrl);
    if (typeof b.afterSourceSystem === 'string' && b.afterSourceSystem) {
      // Row-value keyset: (source_system, source_code) > (afterSourceSystem, afterSourceCode).
      const ass = b.afterSourceSystem;
      const asc = typeof b.afterSourceCode === 'string' ? b.afterSourceCode : '';
      q = q.where((eb) =>
        eb.or([
          eb('source_system', '>', ass),
          eb.and([eb('source_system', '=', ass), eb('source_code', '>', asc)]),
        ]),
      );
    }
    const rows = await q.orderBy('source_system', 'asc').orderBy('source_code', 'asc').limit(limit).execute();

    const elements = rows.map((r) => ({
      sourceSystem: r.source_system,
      sourceCode: r.source_code,
      targetSystem: r.target_system,
      targetCode: r.target_code,
      equivalence: r.equivalence,
    }));
    const nextKey =
      rows.length === limit
        ? { sourceSystem: rows[rows.length - 1].source_system, sourceCode: rows[rows.length - 1].source_code }
        : null;
    reply.send({ elements, nextKey });
  });
}
