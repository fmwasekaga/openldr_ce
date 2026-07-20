import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { servePull, serveAmendments, serveConceptsPage, serveMapElementsPage, type AppContext } from '@openldr/bootstrap';
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
    // `await`, not `return` — this helper signals "already answered" to its caller by resolving
    // undefined, so returning the reply would make it truthy and defeat every `if (!principal)`
    // guard below. Awaiting the reply thenable still settles only once the body is flushed, so the
    // caller's bare `return` cannot be clobbered by wrap-thenable even if a payload grows past the
    // compression threshold. See the comment block on registerSyncRoutes.
    await reply.code(401).send({ error: 'authentication required' });
    return;
  }
  let claims: Awaited<ReturnType<typeof ctx.auth.verifyToken>>;
  try {
    claims = await ctx.auth.verifyToken(token);
  } catch {
    await reply.code(401).send({ error: 'invalid token' });
    return;
  }
  const siteId = typeof claims['site_id'] === 'string' ? (claims['site_id'] as string) : '';
  if (!siteId) {
    await reply.code(403).send({ error: 'token missing site_id claim' });
    return;
  }
  // Require an ACTIVE enrolled site — a valid token is necessary but not sufficient. Revocation deletes
  // the Keycloak client and marks the registry row 'revoked', but a token minted BEFORE revocation stays
  // usable until it expires; without this check a revoked (or entirely unknown) site could keep calling
  // /api/sync/* until then. Fail closed: a registry lookup error rejects rather than admits.
  let site: Awaited<ReturnType<typeof ctx.syncSites.get>>;
  try {
    site = await ctx.syncSites.get(siteId);
  } catch (err) {
    ctx.logger.error({ err, siteId }, 'sync auth: enrolled-site lookup failed');
    await reply.code(503).send({ error: 'enrollment registry unavailable' });
    return;
  }
  if (!site || site.status !== 'active') {
    await reply.code(403).send({ error: 'site not enrolled or revoked' });
    return;
  }
  // Defense in depth: when the token carries an authorized-party / client claim, it must match the
  // site's enrolled sync client. This rejects a token issued to a different client that merely carries
  // the same site_id. Tolerant of tokens without the claim (older/other issuer shapes).
  const azp = typeof claims['azp'] === 'string' ? (claims['azp'] as string)
    : typeof claims['client_id'] === 'string' ? (claims['client_id'] as string) : '';
  if (azp && azp !== site.clientId) {
    await reply.code(403).send({ error: 'token client does not match enrolled site' });
    return;
  }
  return { siteId };
}

// EVERY async handler below MUST `return reply.send(...)` — the `return` is load-bearing, not style.
// Do not "tidy" it away.
//
// Fastify 5's wrap-thenable.js re-sends the handler's resolved value when:
//     payload !== undefined || (reply.sent === false && reply.raw.headersSent === false && ...)
// `reply.sent` is `raw.writableEnded`. With a BARE `reply.send(x); ` the handler resolves to
// undefined, so the guard falls through to the second clause. Before @fastify/compress (S7-B) that
// clause was always false — a bare send wrote synchronously, so writableEnded/headersSent were
// already true by the time the promise resolved, and Fastify skipped the re-send.
//
// compress breaks that assumption: once a payload crosses the 1024-byte threshold it is gzipped
// through an ASYNC stream, so nothing is written yet when the handler's promise resolves — the guard
// passes and Fastify calls `reply.send(undefined)`, clobbering the real body. The client gets
// `content-encoding: gzip`, `content-length: 0`, and a gunzip error.
//
// `return`ing fixes it, though not for the obvious reason: a Reply is THENABLE
// (Reply.prototype.then), so an async function returning one ADOPTS it, and Reply.prototype.then
// only calls `fulfilled()` after `eos(this.raw)` — end-of-stream. The handler's promise therefore
// cannot resolve until the body is flushed, and `reply.sent` is already true when the guard runs.
// (It still resolves to undefined, NOT to the reply — the safety comes from the eos wait.) That is
// why `await reply.send(...)` is exactly as safe, and why `void reply.send(...)` is exactly as
// broken as a bare send: `void` discards the thenable without awaiting it.
//
// This bites ONLY responses >= 1024 bytes — i.e. exactly the big pull/terminology pages this slice
// exists to compress — which is why every sub-threshold unit test stayed green while /api/sync/pull
// returned empty bodies on the wire. Regression-covered by `pnpm sync:gzip:accept`, and enforced
// repo-wide by the `openldr/require-return-reply-send` lint rule (apps/server/eslint-rules/).
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
      return reply.code(400).send({ error: 'records must be an array' });
    }
    // The body crosses a trust boundary — sanitize fromSeq (a non-finite value must not seed ackSeq).
    const fromSeq = Number.isFinite(body?.fromSeq) ? (body!.fromSeq as number) : 0;

    let applied = 0;
    let skipped = 0;
    let diverged = 0;
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
        else if (result === 'diverged') diverged++;
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

    // A divergence means this lab pushed content at a version central had already authored
    // differently — central KEPT its own copy and dropped the lab's, recording it in sync_divergences
    // for an operator. Deliberately NOT reported in PushResponse: adding a field would break the
    // no-wire-change property, and the lab detects its own side independently when it pulls the
    // amendment (each side records what IT dropped). Logged so it is visible here too.
    if (diverged > 0) {
      ctx.logger.warn({ siteId: principal.siteId, diverged }, 'sync push: same-version divergence(s) detected — see sync_divergences');
    }

    // Empty batch → ackSeq stayed at fromSeq (the cursor never moves backward).
    const response: PushResponse = { ackSeq, applied, skipped, rejects };
    // `return` is load-bearing, not style — see the note above registerSyncRoutes.
    return reply.code(200).send(response);
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

    // S7 (A1): record what this lab says it has consumed, so a later slice can trim
    // reference_change_log / sync_amendments against the SLOWEST site. fromSeq — what it HAS — not
    // nextSeq, which it may fail to apply. Best-effort: a failure here leaves the floor stale-LOW, so
    // a later slice trims LESS. Never fail a pull over bookkeeping.
    try {
      await ctx.syncSiteCursors.report(principal.siteId, 'sync-pull', fromSeq);
    } catch (err) {
      ctx.logger.warn({ err, siteId: principal.siteId }, 'sync pull: failed to record the reported cursor');
    }

    return reply.code(200).send({ records, nextSeq });
  });

  // POST /api/sync/pull-amendments — the owning lab's amendment delta since its 'sync-amend-pull'
  // cursor (Sync S6a). Machine-authed AND site-scoped: sitePrincipal derives site_id from the token and
  // serveAmendments filters to it — a lab can only ever pull its OWN amendments (mirror of push's
  // cross-site write rejection). Records use the SyncRecord wire shape; the lab applies via applyRemote.
  app.post('/api/sync/pull-amendments', async (req, reply) => {
    const principal = await sitePrincipal(req, reply, ctx);
    if (!principal) return; // reply already sent (401/403)

    const rawFrom = (req.body as { fromSeq?: unknown } | undefined)?.fromSeq;
    const fromSeq = typeof rawFrom === 'number' && Number.isFinite(rawFrom) ? rawFrom : 0;

    const { records, nextSeq } = await serveAmendments(ctx, principal.siteId, fromSeq);

    // S7 (A1): same recording as /api/sync/pull, under the amendments' OWN consumer key so the two
    // logs (reference_change_log vs sync_amendments) get independent floors. Best-effort — see the
    // comment above the /api/sync/pull recording for why a failure here must never fail the pull.
    try {
      await ctx.syncSiteCursors.report(principal.siteId, 'sync-amend-pull', fromSeq);
    } catch (err) {
      ctx.logger.warn({ err, siteId: principal.siteId }, 'sync amendment pull: failed to record the reported cursor');
    }

    return reply.code(200).send({ records, nextSeq });
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
      return reply.code(400).send({ error: 'systemUrl required' });
    }
    const limit = Number.isFinite(b.limit) && (b.limit as number) > 0 ? Math.min(b.limit as number, 5000) : 1000;

    // The keyset query lives in @openldr/bootstrap (serveConceptsPage) so the offline pull-bundle
    // exporter (Sync S5) drains the same code. Behaviour unchanged from the inline route.
    const page = await serveConceptsPage(ctx, b.systemUrl, typeof b.afterCode === 'string' && b.afterCode ? b.afterCode : null, limit);
    return reply.send(page);
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
      return reply.code(400).send({ error: 'mapUrl required' });
    }
    const limit = Number.isFinite(b.limit) && (b.limit as number) > 0 ? Math.min(b.limit as number, 5000) : 1000;

    // The row-value keyset query lives in @openldr/bootstrap (serveMapElementsPage) so the offline
    // pull-bundle exporter (Sync S5) drains the same code. Behaviour unchanged from the inline route.
    const afterKey =
      typeof b.afterSourceSystem === 'string' && b.afterSourceSystem
        ? { sourceSystem: b.afterSourceSystem, sourceCode: typeof b.afterSourceCode === 'string' ? b.afterSourceCode : '' }
        : null;
    const page = await serveMapElementsPage(ctx, b.mapUrl, afterKey, limit);
    return reply.send(page);
  });
}
