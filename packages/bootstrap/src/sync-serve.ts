import { formSyncBody, type FormRow } from '@openldr/forms';
import type { PullRecord, PullResponse } from '@openldr/sync';
import type { AppContext } from './index';

// Sync S5: the /api/sync/pull serve logic, EXTRACTED from apps/server's sync route so both the HTTP
// route and the offline pull-bundle exporter (sync-bundle.ts) produce byte-identical reference-config
// windows from the same code. Behaviour is unchanged from the inline route (S3): a raw seq window,
// deduped to the LATEST row per (entity_type, entity_id), each upsert body read LIVE from its read
// store, deletes / vanished-live-rows / poison entities handled exactly as before.

const BATCH = 500;

/** Serve the global reference-config delta after `fromSeq`: the ordered, deduped window of reference
 *  changes plus the `nextSeq` cursor to resume from. Returns ALL reference records (incl. terminology
 *  signals) — the HTTP route serves this verbatim; only the S5 pull-bundle exporter filters
 *  terminology out (it needs concept embedding, done in Task 4b). */
export async function servePull(ctx: AppContext, fromSeq: number): Promise<PullResponse> {
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
    let body: unknown | null;
    try {
      body = await fetchReferenceBody(ctx, entityType, r.entity_id);
    } catch (e) {
      // Poison-pill isolation (mirrors the push route's "one bad record must not 500 the whole
      // batch"): a store.get DB error or a malformed body (e.g. formSyncBody→JSON.parse on a corrupt
      // schema) must not 500 the pull and wedge the lab retrying this window forever. Skip this
      // entity — emit no record for it. nextSeq still advances past it (it's from the RAW window), so
      // a persistently-bad entity is quarantined, not a permanent wedge.
      ctx.logger.warn(
        { error: e instanceof Error ? e.message : String(e), entityType, entityId: r.entity_id, seq },
        'sync pull: fetchReferenceBody failed for entity, skipping',
      );
      continue;
    }
    if (body == null) {
      // The entity was deleted (or unpublished — see the form gate) since it was logged, so its live
      // body is gone → serve a delete so the lab converges rather than upserting a null body.
      records.push({ seq, entityType, entityId: r.entity_id, op: 'delete' });
      continue;
    }
    records.push({ seq, entityType, entityId: r.entity_id, op: 'upsert', contentHash: r.content_hash, body });
  }
  records.sort((a, b) => a.seq - b.seq);

  return { records, nextSeq };
}

// Live current body for a reference entity, read from its read store (NOT from the capture log, so a
// pull always serves the freshest config). The served upsert body MUST equal what the reference
// applier (reference-apply.ts) consumes: dashboards/reports serve the store RECORD shape; a form
// serves formSyncBody(rawRow) (the store's get() returns a camelCase FormDefinition, which
// formSyncBody can't consume, so read the raw form_definitions row exactly like capture does);
// publisher/coding_system/term_mapping read the raw internal row and serve a camelCase body (matching
// A2's capture hash field-sets, so the pulled body round-trips through the applier's row mappers); a
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
      const row = (await ctx.internalDb
        .selectFrom('form_definitions')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst()) as FormRow | undefined;
      // Labs may ONLY consume PUBLISHED forms. T4's forms capture does NOT log a published→draft
      // demotion, so the log's latest row can still be 'upsert' while the live row is now a draft;
      // serving that would leak a draft to labs. Gate on status: a non-published (draft/archived)
      // live row returns null → the handler downgrades it to a `delete`, removing it from labs (the
      // correct convergence). A missing row also returns null (formSyncBody handles undefined).
      if (!row || row.status !== 'published') return null;
      return formSyncBody(row);
    }
    case 'publisher': {
      const r = await ctx.internalDb
        .selectFrom('publishers')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!r) return null;
      const mp =
        r.match_prefixes == null
          ? []
          : typeof r.match_prefixes === 'string'
            ? JSON.parse(r.match_prefixes)
            : r.match_prefixes;
      return {
        id: r.id,
        name: r.name,
        role: r.role,
        icon: r.icon,
        matchPrefixes: mp,
        sortOrder: r.sort_order,
      };
    }
    case 'coding_system': {
      const r = await ctx.internalDb
        .selectFrom('coding_systems')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!r) return null;
      return {
        id: r.id,
        systemCode: r.system_code,
        systemName: r.system_name,
        url: r.url,
        systemVersion: r.system_version,
        description: r.description,
        active: r.active,
        publisherId: r.publisher_id,
      };
    }
    case 'term_mapping': {
      const r = await ctx.internalDb
        .selectFrom('term_mappings')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!r) return null;
      return {
        id: r.id,
        fromSystem: r.from_system,
        fromCode: r.from_code,
        toSystem: r.to_system,
        toCode: r.to_code,
        toDisplay: r.to_display,
        mapType: r.map_type,
        relationship: r.relationship,
        owner: r.owner,
        isActive: r.is_active,
      };
    }
    case 'terminology_system': {
      // The signal body is a small DESCRIPTOR (url/version/kind/resourceId/generation), NOT the
      // system's concepts — the lab drains those via POST /api/sync/terminology/concepts. A missing
      // row → null (the handler downgrades to a delete = "system removed", acceptable convergence).
      const r = await ctx.internalDb
        .selectFrom('terminology_systems')
        .selectAll()
        .where('url', '=', id)
        .executeTakeFirst();
      return r
        ? { url: r.url, version: r.version, kind: r.kind, resourceId: r.resource_id, generation: Number(r.generation) }
        : null;
    }
    case 'concept_map': {
      // Descriptor only ({ mapUrl, generation }); elements drain via /api/sync/terminology/map-elements.
      const r = await ctx.internalDb
        .selectFrom('concept_map_state')
        .selectAll()
        .where('map_url', '=', id)
        .executeTakeFirst();
      return r ? { mapUrl: r.map_url, generation: Number(r.generation) } : null;
    }
    case 'setting':
      return (await ctx.appSettings.get(id))?.value ?? null;
    default:
      return null;
  }
}
