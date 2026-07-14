import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import type { PushBatch, PushResponse, SyncRecord, PullRecord, PullResponse } from '@openldr/sync';
import { formSyncBody, type FormRow } from '@openldr/forms';

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
    const BATCH = 500;

    // Raw window ordered by seq, then DEDUP to the LATEST row per (entity_type, entity_id) so a
    // create-then-delete (or several edits) inside the window collapses to one record — avoids a
    // null-body upsert and cuts payload. nextSeq = max seq in the RAW window (before dedup) so the
    // cursor still advances past collapsed rows.
    const rows = await ctx.internalDb
      .selectFrom('reference_change_log')
      .selectAll()
      .where('seq', '>', fromSeq)
      .orderBy('seq', 'asc')
      .limit(BATCH)
      .execute();
    const nextSeq = rows.reduce((m, r) => Math.max(m, Number(r.seq)), fromSeq);

    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) latest.set(`${r.entity_type} ${r.entity_id}`, r); // later seq overwrites (asc)

    const records: PullRecord[] = [];
    for (const r of latest.values()) {
      const entityType = r.entity_type as PullRecord['entityType'];
      const seq = Number(r.seq);
      if (r.op === 'delete') {
        records.push({ seq, entityType, entityId: r.entity_id, op: 'delete' });
        continue;
      }
      const body = await fetchReferenceBody(ctx, entityType, r.entity_id);
      if (body == null) {
        // The entity was deleted since it was logged (its live body is gone) → serve a delete so the
        // lab converges rather than upserting a null body.
        records.push({ seq, entityType, entityId: r.entity_id, op: 'delete' });
        continue;
      }
      records.push({ seq, entityType, entityId: r.entity_id, op: 'upsert', contentHash: r.content_hash, body });
    }
    records.sort((a, b) => a.seq - b.seq);

    reply.code(200).send({ records, nextSeq } satisfies PullResponse);
  });
}

// Live current body for a reference entity, read from its read store (NOT from the capture log, so a
// pull always serves the freshest config). The served upsert body MUST equal what the reference
// applier (reference-apply.ts) consumes: dashboards/reports serve the store RECORD shape; a form
// serves formSyncBody(rawRow) (the store's get() returns a camelCase FormDefinition, which
// formSyncBody can't consume, so read the raw form_definitions row exactly like capture does); a
// setting serves its string value. Returns null when the entity no longer exists.
async function fetchReferenceBody(
  ctx: AppContext,
  entityType: PullRecord['entityType'],
  id: string,
): Promise<unknown | null> {
  switch (entityType) {
    case 'dashboard':
      return (await ctx.dashboards.store.get(id)) ?? null;
    case 'report':
      return (await ctx.reportDefs.get(id)) ?? null;
    case 'form': {
      const row = await ctx.internalDb
        .selectFrom('form_definitions')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return formSyncBody((row ?? null) as FormRow | null); // null for a missing row
    }
    case 'setting':
      return (await ctx.appSettings.get(id))?.value ?? null;
    default:
      return null;
  }
}
