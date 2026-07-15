import { randomUUID, createHash } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import type { FhirResource } from '@openldr/fhir';
import type { InternalSchema } from './schema/internal';
import type { Provenance } from './provenance';

export interface SavedRef {
  resourceType: string;
  id: string;
  version: number;
}

export interface DeleteResult {
  deleted: boolean;
  version?: number;
}

// A change replayed from a remote origin (e.g. a lab's change_log) to be mirror-applied here.
// Unlike save()/delete(), version and siteId are taken verbatim from the origin — NOT derived
// from local history (no max+1) and NOT stamped with the local site.
export interface RemoteRecord {
  resourceType: string;
  id: string;
  version: number; // origin version (from the lab's change_log)
  op: 'upsert' | 'delete';
  siteId: string; // origin site-id (ownership stamp)
  resource?: FhirResource; // present for op:'upsert'
}

export type ApplyResult = 'applied' | 'skipped';

export interface AmendInput {
  resourceType: string;
  id: string;
  status: string; // e.g. 'amended' | 'corrected'
  patch?: Record<string, unknown>; // shallow-merged into the current resource body
  agent: string; // Provenance agent.who.display (who authored the amendment)
  reason?: string; // Provenance reason text
}
export interface AmendResult {
  version: number; // new version of the amended resource
  provenanceId: string; // id of the created Provenance resource
  siteId: string; // owning lab (routing key)
}
export class ResourceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResourceNotFoundError';
  }
}
export class NotLabOwnedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotLabOwnedError';
  }
}

export interface FhirStore {
  save(resource: FhirResource, provenance?: Provenance): Promise<SavedRef>;
  get(resourceType: string, id: string): Promise<FhirResource | null>;
  listByType(resourceType: string, limit?: number): Promise<{ id: string; resource: FhirResource }[]>;
  delete(resourceType: string, id: string): Promise<DeleteResult>;
  // Mirror-apply a remote change at its ORIGIN version/site. Idempotent on (resourceType,id,version):
  // a re-applied version is a no-op ('skipped'). Returns 'applied' when it wrote history/change_log.
  applyRemote(record: RemoteRecord): Promise<ApplyResult>;
  // Sync S6a: author a central amendment of a lab-owned resource — new version (keeping the owning
  // lab's site_id) + a Provenance resource + two sync_amendments outbox rows, all in one transaction.
  amend(input: AmendInput): Promise<AmendResult>;
}

function contentHash(serialized: string): string {
  return createHash('sha256').update(serialized).digest('hex');
}

export function createFhirStore(db: Kysely<InternalSchema>): FhirStore {
  // site_id is process-stable; resolve once and memoize. undefined = not yet resolved.
  let siteId: string | null | undefined;
  async function resolveSiteId(): Promise<string | null> {
    if (siteId !== undefined) return siteId;
    const row = await db.selectFrom('app_settings').select('value').where('key', '=', 'sync.site_id').executeTakeFirst();
    // site_id is enrollment-stable; resolved once per store instance. A value configured after
    // process boot won't take effect until restart. `||` so an empty app_settings value falls through.
    siteId = row?.value || process.env.OPENLDR_SITE_ID || null;
    return siteId;
  }

  async function nextVersion(trx: Kysely<InternalSchema>, resourceType: string, id: string): Promise<number> {
    const hi = await trx
      .selectFrom('fhir.resource_history')
      .select(sql<number>`coalesce(max(version), 0)`.as('maxv'))
      .where('resource_type', '=', resourceType)
      .where('id', '=', id)
      .executeTakeFirst();
    return Number(hi?.maxv ?? 0) + 1;
  }
  // PRECONDITION: the fhir_resources ON CONFLICT doUpdateSet below is UNCONDITIONAL (no monotonic
  // guard, unlike applyRemote's `WHERE version < incoming`). It is therefore only safe for callers that
  // pass a version guaranteed >= the canonical row's — amend passes nextVersion() (max+1) for the
  // amended resource and a fresh randomUUID id at v1 for the Provenance, so it can never regress a row.
  async function writeVersion(
    trx: Kysely<InternalSchema>,
    v: { resourceType: string; id: string; version: number; body: Record<string, unknown>; siteId: string },
  ): Promise<void> {
    const serialized = JSON.stringify(v.body);
    const contentHashHex = contentHash(serialized);
    // INVARIANT (projection safe-frontier): change_log must NOT be the txn's first write — history is
    // inserted FIRST here so the txn's xid is assigned before nextval(seq) is drawn for change_log.
    // Do NOT reorder these inserts. (Mirrors save()/applyRemote().)
    await trx
      .insertInto('fhir.resource_history')
      .values({ resource_type: v.resourceType, id: v.id, version: v.version, op: 'upsert', resource: serialized })
      .execute();
    await trx
      .insertInto('fhir.fhir_resources')
      .values({ resource_type: v.resourceType, id: v.id, version: v.version, version_id: String(v.version), resource: serialized })
      .onConflict((oc) =>
        oc.columns(['resource_type', 'id']).doUpdateSet({
          version: v.version,
          version_id: String(v.version),
          resource: serialized,
          updated_at: sql`now()`,
        }),
      )
      .execute();
    await trx
      .insertInto('fhir.change_log')
      .values({ resource_type: v.resourceType, resource_id: v.id, version: v.version, op: 'upsert', content_hash: contentHashHex, site_id: v.siteId })
      .execute();
  }

  return {
    async save(resource, provenance = {}) {
      const resourceType = resource.resourceType;
      const id = (resource as { id?: string }).id ?? randomUUID();
      const site = await resolveSiteId();
      const ref = await db.transaction().execute(async (trx) => {
        // Next version = highest ever recorded in the append-only history + 1. Deriving from
        // history (not the canonical row) keeps versions monotonic across delete→recreate, since
        // delete() removes the canonical row but history retains every version. The history PK
        // (resource_type,id,version) also serializes concurrent same-key writes: a race loser
        // hits a duplicate-key and rolls back atomically, throwing to the caller (no data
        // corruption; a caller retry then reads the new max and advances). This means truly
        // concurrent same-id writes can now fail where a plain upsert would have last-writer-won.
        // (bigint reads back as string on real pg, number on pg-mem — always coerce.)
        const hi = await trx
          .selectFrom('fhir.resource_history')
          .select(sql<number>`coalesce(max(version), 0)`.as('maxv'))
          .where('resource_type', '=', resourceType)
          .where('id', '=', id)
          .executeTakeFirst();
        const next = Number(hi?.maxv ?? 0) + 1;
        const nowIso = new Date().toISOString();
        // Hash the pre-stamp content so identical content hashes stably (excludes the volatile
        // server-stamped meta.versionId / meta.lastUpdated we add below).
        const contentHashHex = contentHash(JSON.stringify({ ...resource, id }));
        const meta = { ...(resource as { meta?: Record<string, unknown> }).meta, versionId: String(next), lastUpdated: nowIso };
        const full = { ...resource, id, meta } as FhirResource;
        const serialized = JSON.stringify(full);
        const prov = {
          source_system: provenance.sourceSystem ?? null,
          plugin_id: provenance.pluginId ?? null,
          plugin_version: provenance.pluginVersion ?? null,
          batch_id: provenance.batchId ?? null,
        };
        await trx
          .insertInto('fhir.fhir_resources')
          .values({ resource_type: resourceType, id, version: next, version_id: String(next), resource: serialized, ...prov })
          .onConflict((oc) =>
            oc.columns(['resource_type', 'id']).doUpdateSet({
              version: next,
              version_id: String(next),
              resource: serialized,
              ...prov,
              updated_at: sql`now()`,
            }),
          )
          .execute();
        await trx
          .insertInto('fhir.resource_history')
          .values({ resource_type: resourceType, id, version: next, op: 'upsert', resource: serialized })
          .execute();
        // INVARIANT (load-bearing for the projection safe-frontier): the change_log insert must NOT be
        // this transaction's first write. The fhir_resources upsert + resource_history insert above run
        // first, so the txn's xid is assigned before nextval(seq) is drawn here. The R2 projection worker
        // relies on this: a gap's txn xid < the snapshot's xmax that stamps its x0. Inserting into
        // change_log as a transaction's first statement would reopen a permanent-skip window.
        await trx
          .insertInto('fhir.change_log')
          .values({ resource_type: resourceType, resource_id: id, version: next, op: 'upsert', content_hash: contentHashHex, site_id: site })
          .execute();
        return { resourceType, id, version: next };
      });
      // Best-effort wakeup for the projection worker; interval polling is the correctness-bearing
      // path, so a notify failure (e.g. pg-mem in tests) must never affect the save.
      try { await sql`select pg_notify('fhir_changes', '')`.execute(db); } catch { /* ignore */ }
      return ref;
    },

    async get(resourceType, id) {
      const row = await db
        .selectFrom('fhir.fhir_resources')
        .select('resource')
        .where('resource_type', '=', resourceType)
        .where('id', '=', id)
        .executeTakeFirst();
      return row ? (row.resource as FhirResource) : null;
    },

    async listByType(resourceType, limit = 500) {
      const rows = await db
        .selectFrom('fhir.fhir_resources')
        .select(['id', 'resource'])
        .where('resource_type', '=', resourceType)
        .orderBy('updated_at', 'desc')
        .limit(limit)
        .execute();
      return rows.map((r) => ({ id: r.id, resource: r.resource as FhirResource }));
    },

    async delete(resourceType, id) {
      const site = await resolveSiteId();
      return db.transaction().execute(async (trx) => {
        const existing = await trx
          .selectFrom('fhir.fhir_resources')
          .select('version')
          .where('resource_type', '=', resourceType)
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!existing) return { deleted: false };
        const hi = await trx
          .selectFrom('fhir.resource_history')
          .select(sql<number>`coalesce(max(version), 0)`.as('maxv'))
          .where('resource_type', '=', resourceType)
          .where('id', '=', id)
          .executeTakeFirst();
        const next = Number(hi?.maxv ?? 0) + 1;
        await trx
          .insertInto('fhir.resource_history')
          .values({ resource_type: resourceType, id, version: next, op: 'delete', resource: null })
          .execute();
        await trx
          .insertInto('fhir.change_log')
          .values({ resource_type: resourceType, resource_id: id, version: next, op: 'delete', content_hash: null, site_id: site })
          .execute();
        await trx.deleteFrom('fhir.fhir_resources').where('resource_type', '=', resourceType).where('id', '=', id).execute();
        return { deleted: true, version: next };
      });
    },

    async applyRemote(record) {
      const { resourceType, id, version, op, siteId } = record;
      // Validate BEFORE opening the transaction: an upsert must carry a resource. Guarding here means
      // the upsert branch's content is genuinely non-null (the `content!` below is sound) and we never
      // write a self-contradictory history row (op='upsert', resource=null) or hit an opaque NOT NULL
      // violation deep inside the tx.
      if (op === 'upsert' && !record.resource) throw new Error('applyRemote: upsert requires resource');
      const result = await db.transaction().execute(async (trx): Promise<ApplyResult> => {
        // Idempotency: the history PK is (resource_type,id,version). A matching row means this exact
        // origin version was already applied → no-op (no fhir_resources / change_log writes). We use an
        // explicit existence SELECT rather than ON CONFLICT DO NOTHING + numInsertedOrUpdatedRows because
        // that row-count is engine-dependent (pg-mem reports 1 even on a conflict no-op), so it can't
        // discriminate a real insert from a skip. This SELECT is deterministic on real pg and pg-mem alike.
        const already = await trx
          .selectFrom('fhir.resource_history')
          .select('version')
          .where('resource_type', '=', resourceType)
          .where('id', '=', id)
          .where('version', '=', version)
          .executeTakeFirst();
        if (already) return 'skipped';

        // Mirror-store the origin content verbatim (id normalized). Null for a tombstone.
        const content = op === 'upsert' && record.resource ? JSON.stringify({ ...record.resource, id }) : null;

        // INVARIANT (projection safe-frontier): the change_log insert must NOT be this transaction's first
        // write — the resource_history insert here (and the fhir_resources write below) precede it, so the
        // txn's xid is assigned before nextval(seq) is drawn for change_log. Do not reorder. The existence
        // SELECT above is read-only and does not assign an xid, so it does not affect this ordering.
        await trx
          .insertInto('fhir.resource_history')
          .values({ resource_type: resourceType, id, version, op, resource: content })
          .execute();

        if (op === 'upsert') {
          // Atomic monotonic guard: on a first apply the plain INSERT lands; on conflict we advance the
          // canonical row ONLY when the stored version is strictly less than the incoming version. The
          // WHERE qualifies the EXISTING (target) row — Postgres exposes it under the unqualified relation
          // name in ON CONFLICT DO UPDATE, so `sql.ref('fhir_resources.version')` renders that reference.
          // This replaces a read-then-branch (which could regress the row under concurrent same-id applies)
          // with a single race-free statement. History above stays unconditional (append-only); an
          // out-of-order OLDER version is recorded there but its WHERE fails, leaving the newer row intact.
          await trx
            .insertInto('fhir.fhir_resources')
            .values({ resource_type: resourceType, id, version, version_id: String(version), resource: content! })
            .onConflict((oc) =>
              oc
                .columns(['resource_type', 'id'])
                .doUpdateSet({
                  version,
                  version_id: String(version),
                  resource: content!,
                  updated_at: sql`now()`,
                })
                .where(sql.ref('fhir_resources.version'), '<', version),
            )
            .execute();
        } else {
          await trx.deleteFrom('fhir.fhir_resources').where('resource_type', '=', resourceType).where('id', '=', id).execute();
        }

        // change_log stamped with the ORIGIN site_id (ownership stamp) — NOT resolveSiteId(), which is the
        // local site. Hash mirrors save(): sha256 of the stored content; null for a tombstone.
        const contentHashHex = content ? contentHash(content) : null;
        await trx
          .insertInto('fhir.change_log')
          .values({ resource_type: resourceType, resource_id: id, version, op, content_hash: contentHashHex, site_id: siteId })
          .execute();
        return 'applied';
      });
      // Best-effort projection-worker wakeup; interval polling is the correctness path (matches save()).
      try { await sql`select pg_notify('fhir_changes', '')`.execute(db); } catch { /* ignore */ }
      return result;
    },

    async amend(input) {
      const { resourceType, id, status, patch, agent, reason } = input;
      const provenanceId = randomUUID();
      const result = await db.transaction().execute(async (trx): Promise<AmendResult> => {
        const cur = await trx
          .selectFrom('fhir.fhir_resources')
          .select('resource')
          .where('resource_type', '=', resourceType)
          .where('id', '=', id)
          .executeTakeFirst();
        if (!cur) throw new ResourceNotFoundError(`${resourceType}/${id} not found`);

        // Owning lab = the site_id on the resource's latest change_log row. A lab-owned resource
        // (pushed up from a lab via applyRemote) carries that lab's site_id; a central-owned /
        // unsynced resource (saved locally with no configured site) carries null → refuse to amend.
        const owner = await trx
          .selectFrom('fhir.change_log')
          .select('site_id')
          .where('resource_type', '=', resourceType)
          .where('resource_id', '=', id)
          .orderBy('version', 'desc')
          .limit(1)
          .executeTakeFirst();
        const siteId = owner?.site_id ?? '';
        if (!siteId) throw new NotLabOwnedError(`${resourceType}/${id} is not lab-owned`);

        const nowIso = new Date().toISOString();
        const base = cur.resource as Record<string, unknown>;

        const amendedVersion = await nextVersion(trx, resourceType, id);
        // Strip resourceType/id from the caller's patch before merging: those identify WHICH row this
        // is (the resource_type column + PK), so a patch must never change them or the stored JSON would
        // desync from the row it's filed under. id/status/meta are pinned after the merge regardless.
        const { resourceType: _pRt, id: _pId, ...safePatch } = (patch ?? {}) as Record<string, unknown>;
        const amendedBody: Record<string, unknown> = {
          ...base,
          ...safePatch,
          id,
          status,
          meta: { ...(base.meta as Record<string, unknown> | undefined), versionId: String(amendedVersion), lastUpdated: nowIso },
        };
        await writeVersion(trx, { resourceType, id, version: amendedVersion, body: amendedBody, siteId });

        const provBody: Record<string, unknown> = {
          resourceType: 'Provenance',
          id: provenanceId,
          target: [{ reference: `${resourceType}/${id}` }],
          recorded: nowIso,
          activity: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation', code: 'AMEND', display: 'amend' }] },
          agent: [{ who: { display: agent } }],
          ...(reason ? { reason: [{ text: reason }] } : {}),
          meta: { versionId: '1', lastUpdated: nowIso },
        };
        await writeVersion(trx, { resourceType: 'Provenance', id: provenanceId, version: 1, body: provBody, siteId });

        await trx
          .insertInto('sync_amendments')
          .values([
            { site_id: siteId, resource_type: resourceType, resource_id: id, version: amendedVersion },
            { site_id: siteId, resource_type: 'Provenance', resource_id: provenanceId, version: 1 },
          ])
          .execute();

        return { version: amendedVersion, provenanceId, siteId };
      });
      // Best-effort projection-worker wakeup; interval polling is the correctness path (matches save()).
      try { await sql`select pg_notify('fhir_changes', '')`.execute(db); } catch { /* ignore */ }
      return result;
    },
  };
}
