import { randomUUID, createHash } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import type { FhirResource } from '@openldr/fhir';
import type { InternalSchema } from './schema/internal';
import type { Provenance } from './provenance';
import { divergenceHash } from './divergence-hash';
import { recordDivergence } from './sync-divergence-store';

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

// 'diverged' (sync S7): a history row already exists at this (resource_type, id, version) but its
// content DIFFERS from the incoming record — two sides independently authored the same version. The
// incoming content is NOT applied (the local copy is kept); it is recorded in sync_divergences for an
// operator. Detect-and-surface only: there is no auto-heal, by design.
//
// Neither applyRemote call site checks this union exhaustively — both `sync-routes.ts` and
// `sync-bundle.ts` tally with if/else-if chains, not a switch — so WIDENING IT AGAIN WILL NOT PRODUCE
// A COMPILE ERROR at either one. A new variant will be silently absorbed by an existing branch (or by
// no branch at all) until you update both by hand. Correctness itself never depends on the callers:
// the row is written in applyRemote's OWN transaction, so a missed branch costs observability, not data.
export type ApplyResult = 'applied' | 'skipped' | 'diverged';

export interface AmendInput {
  resourceType: string;
  id: string;
  status: string; // e.g. 'amended' | 'corrected'
  patch?: Record<string, unknown>; // shallow-merged into the current resource body
  agent: string; // Provenance agent.who.display (who authored the amendment)
  reason?: string; // Provenance reason text
  activity?: string; // Provenance activity token (Sync S6c). Default 'amend' (result correction);
                     // an order status/metadata change passes 'update'. Mapped to the v3-DataOperation
                     // coding as { code: activity.toUpperCase(), display: activity.toLowerCase() }.
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
export class UnsupportedResourceTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedResourceTypeError';
  }
}
export class PatientNotFoundError extends Error {
  constructor(message: string) { super(message); this.name = 'PatientNotFoundError'; }
}
export class CrossSiteMergeError extends Error {
  constructor(message: string) { super(message); this.name = 'CrossSiteMergeError'; }
}
export class SamePatientError extends Error {
  constructor(message: string) { super(message); this.name = 'SamePatientError'; }
}

// Sync S6b: the referencing resource types a merge re-points. All carry the patient link in `subject`,
// so the re-point patch is uniform. A ref of any other type is skipped (never graft a spurious subject).
const MERGE_REF_TYPES: ReadonlySet<string> = new Set(['Observation', 'ServiceRequest', 'DiagnosticReport', 'Specimen']);

export interface MergeInput {
  survivorId: string;
  duplicateId: string;
  agent: string; // Provenance agent.who.display
  reason?: string;
  referencingRefs: { resourceType: string; id: string }[]; // enumerated by the caller (read-model reverse index)
}
export interface MergeResult {
  survivorId: string;
  duplicateId: string;
  repointed: number; // count of referencing resources actually re-pointed (stale ones skipped)
  provenanceId: string;
  siteId: string; // owning lab
}

// Sync S6c: the resource types a central operator may amend/co-edit. Results (Observation /
// DiagnosticReport) + lab orders (ServiceRequest). Anything else is rejected — amend must not inject a
// `status`/version onto an arbitrary lab-owned resource type.
export const AMENDABLE_TYPES: ReadonlySet<string> = new Set(['Observation', 'DiagnosticReport', 'ServiceRequest']);

export interface FhirStore {
  save(resource: FhirResource, provenance?: Provenance): Promise<SavedRef>;
  get(resourceType: string, id: string): Promise<FhirResource | null>;
  /** Like `get`, but also returns the row's stored provenance. The deferred projection
   *  needs it — `get` alone silently produced NULL source_system/batch_id in every
   *  projected row. Additive rather than a change to `get`, because
   *  terminology-store.ts:161 wants the bare resource. */
  getWithProvenance(resourceType: string, id: string): Promise<{ resource: FhirResource; provenance: Provenance } | null>;
  listByType(resourceType: string, limit?: number): Promise<{ id: string; resource: FhirResource }[]>;
  delete(resourceType: string, id: string): Promise<DeleteResult>;
  // Mirror-apply a remote change at its ORIGIN version/site. Idempotent on (resourceType,id,version):
  // a re-applied version is a no-op ('skipped'). Returns 'applied' when it wrote history/change_log.
  applyRemote(record: RemoteRecord): Promise<ApplyResult>;
  // Sync S6a: author a central amendment of a lab-owned resource — new version (keeping the owning
  // lab's site_id) + a Provenance resource + two sync_amendments outbox rows, all in one transaction.
  amend(input: AmendInput): Promise<AmendResult>;
  // Sync S6b: atomically author an intra-lab patient merge — mark the duplicate Patient replaced
  // (active:false + link replaced-by survivor), re-point each referencing resource's subject to the
  // survivor, write one merge Provenance, and emit sync_amendments outbox rows. One transaction.
  mergePatients(input: MergeInput): Promise<MergeResult>;
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

  // Sync S6b: the owning-lab site_id = the site on a resource's latest change_log row (same lookup amend
  // does inline). Empty string when unstamped (central-owned / unsynced).
  async function latestSite(trx: Kysely<InternalSchema>, resourceType: string, id: string): Promise<string> {
    const owner = await trx
      .selectFrom('fhir.change_log')
      .select('site_id')
      .where('resource_type', '=', resourceType)
      .where('resource_id', '=', id)
      .orderBy('version', 'desc')
      .limit(1)
      .executeTakeFirst();
    return owner?.site_id ?? '';
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

    async getWithProvenance(resourceType, id) {
      const row = await db
        .selectFrom('fhir.fhir_resources')
        .select(['resource', 'source_system', 'plugin_id', 'plugin_version', 'batch_id'])
        .where('resource_type', '=', resourceType)
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) return null;
      // Omit NULL columns rather than carrying nulls: Provenance's fields are
      // optional, and provColumns() maps absent -> NULL on the way back out.
      const provenance: Provenance = {};
      if (row.source_system !== null) provenance.sourceSystem = row.source_system;
      if (row.plugin_id !== null) provenance.pluginId = row.plugin_id;
      if (row.plugin_version !== null) provenance.pluginVersion = row.plugin_version;
      if (row.batch_id !== null) provenance.batchId = row.batch_id;
      return { resource: row.resource as FhirResource, provenance };
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
      // Mirror-store the origin content verbatim (id normalized). Null for a tombstone. Computed ONCE,
      // before the transaction, because it is BOTH what we would store AND (sync S7) what we hash to
      // compare against the stored copy — deriving them from one expression is what keeps the incoming
      // hash apples-to-apples with the local one. Pure JS: no DB access, so no write ordering is affected.
      const normalizedBody: Record<string, unknown> | null =
        op === 'upsert' && record.resource ? { ...record.resource, id } : null;
      const content = normalizedBody ? JSON.stringify(normalizedBody) : null;

      const result = await db.transaction().execute(async (trx): Promise<ApplyResult> => {
        // Idempotency + divergence detection (sync S7). The history PK is (resource_type,id,version):
        // a matching row answers "have we already applied this exact origin version?", and its body
        // tells a genuine re-drain (identical content → skip) from a same-version DIVERGENCE (different
        // content → the incoming edit is being dropped, which must not be silent).
        //
        // We use an explicit existence SELECT rather than ON CONFLICT DO NOTHING +
        // numInsertedOrUpdatedRows because that row-count is engine-dependent (pg-mem reports 1 even on
        // a conflict no-op), so it can't discriminate a real insert from a skip. This SELECT is
        // deterministic on real pg and pg-mem alike. (It is read-only — see the safe-frontier INVARIANT
        // on the writes below.) `op` is deliberately NOT selected: `resource IS NULL` already IS the
        // tombstone marker (a delete writes resource:null, an upsert is guarded to always carry a body),
        // so reading op would add a second, redundant source of truth for the same fact.
        const already = await trx
          .selectFrom('fhir.resource_history')
          .select(['version', 'resource'])
          .where('resource_type', '=', resourceType)
          .where('id', '=', id)
          .where('version', '=', version)
          .executeTakeFirst();
        if (already) {
          // NULL-aware: null == null means two tombstones, which AGREE (nothing was lost).
          // `already.resource` arrives as a parsed object on pg/pg-mem but as text on some drivers;
          // divergenceHash normalizes both. The incoming side is hashed from `normalizedBody` — the
          // SAME id-normalized shape the store path writes — so a wire body that merely omits the
          // redundant `id` cannot manufacture a phantom divergence.
          const localHash = divergenceHash(already.resource);
          const incomingHash = divergenceHash(normalizedBody);
          if (localHash === incomingHash) return 'skipped';

          // Same version, different content. Keep the local copy (no fhir_resources / change_log
          // writes on this path) and durably record what we dropped, in THIS transaction — the skip
          // and the record of why it happened commit together, so a crash can never leave a dropped
          // edit with no trace.
          await recordDivergence(trx, {
            resourceType,
            resourceId: id,
            version,
            localHash,
            incomingHash,
            incomingBody: normalizedBody,
            incomingSiteId: siteId,
          });
          return 'diverged';
        }

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
      const { resourceType, id, status, patch, agent, reason, activity } = input;
      if (!AMENDABLE_TYPES.has(resourceType)) {
        throw new UnsupportedResourceTypeError(`${resourceType} is not amendable (allowed: ${[...AMENDABLE_TYPES].join(', ')})`);
      }
      const activityCode = activity || 'amend';
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
          activity: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation', code: activityCode.toUpperCase(), display: activityCode.toLowerCase() }] },
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

    async mergePatients(input) {
      const { survivorId, duplicateId, agent, reason, referencingRefs } = input;
      if (survivorId === duplicateId) throw new SamePatientError('survivor and duplicate are the same patient');
      const provenanceId = randomUUID();
      const result = await db.transaction().execute(async (trx): Promise<MergeResult> => {
        const dupRow = await trx.selectFrom('fhir.fhir_resources').select('resource').where('resource_type', '=', 'Patient').where('id', '=', duplicateId).executeTakeFirst();
        if (!dupRow) throw new PatientNotFoundError(`Patient/${duplicateId} not found`);
        const survRow = await trx.selectFrom('fhir.fhir_resources').select('resource').where('resource_type', '=', 'Patient').where('id', '=', survivorId).executeTakeFirst();
        if (!survRow) throw new PatientNotFoundError(`Patient/${survivorId} not found`);

        const site = await latestSite(trx, 'Patient', duplicateId);
        const survSite = await latestSite(trx, 'Patient', survivorId);
        if (!site || !survSite || site !== survSite) throw new CrossSiteMergeError('patients are not owned by the same site');

        const nowIso = new Date().toISOString();
        const targets: { reference: string }[] = [];
        const outboxRows: { site_id: string; resource_type: string; resource_id: string; version: number }[] = [];

        // Idempotency: a re-run (to pick up late-projected refs) must not append another identical
        // replaced-by link or re-bump the already-merged duplicate. Skip the Patient re-write when it's
        // already inactive AND already links replaced-by → this survivor.
        const dupBody = dupRow.resource as Record<string, unknown>;
        const existingLinks = Array.isArray(dupBody['link']) ? (dupBody['link'] as unknown[]) : [];
        const alreadyReplaced = dupBody['active'] === false && existingLinks.some(
          (l) => (l as Record<string, unknown> | null)?.['type'] === 'replaced-by'
            && ((l as Record<string, unknown>)?.['other'] as Record<string, unknown> | undefined)?.['reference'] === `Patient/${survivorId}`,
        );
        let patientChanged = !alreadyReplaced;
        if (!alreadyReplaced) {
          const dupVersion = await nextVersion(trx, 'Patient', duplicateId);
          const dupNew: Record<string, unknown> = {
            ...dupBody, id: duplicateId, active: false,
            link: [...existingLinks, { type: 'replaced-by', other: { reference: `Patient/${survivorId}` } }],
            meta: { ...(dupBody['meta'] as Record<string, unknown> | undefined), versionId: String(dupVersion), lastUpdated: nowIso },
          };
          await writeVersion(trx, { resourceType: 'Patient', id: duplicateId, version: dupVersion, body: dupNew, siteId: site });
          targets.push({ reference: `Patient/${duplicateId}` });
          outboxRows.push({ site_id: site, resource_type: 'Patient', resource_id: duplicateId, version: dupVersion });
        }

        let repointed = 0;
        // Two guards enforce the intra-lab + subject-based invariant the primitive trusts the caller for:
        // (1) only re-point subject-bearing lab-data types, (2) never re-stamp a resource owned by a
        // different site. Anything failing either is skipped (uncounted) rather than trusted blindly.
        for (const ref of referencingRefs) {
          if (!MERGE_REF_TYPES.has(ref.resourceType)) continue; // only subject-bearing lab-data types
          const row = await trx.selectFrom('fhir.fhir_resources').select('resource').where('resource_type', '=', ref.resourceType).where('id', '=', ref.id).executeTakeFirst();
          if (!row) continue; // stale read-model entry
          const refSite = await latestSite(trx, ref.resourceType, ref.id);
          if (refSite !== site) continue; // defense: never re-stamp a cross-site resource (intra-lab only)
          const body = row.resource as Record<string, unknown>;
          // Idempotency: a ref already pointing at the survivor was re-pointed on a prior run — don't
          // re-bump it (uncounted).
          const curSubjectRef = (body['subject'] as Record<string, unknown> | undefined)?.['reference'];
          if (curSubjectRef === `Patient/${survivorId}`) continue;
          const v = await nextVersion(trx, ref.resourceType, ref.id);
          const newBody: Record<string, unknown> = {
            ...body, id: ref.id, subject: { reference: `Patient/${survivorId}` },
            meta: { ...(body['meta'] as Record<string, unknown> | undefined), versionId: String(v), lastUpdated: nowIso },
          };
          await writeVersion(trx, { resourceType: ref.resourceType, id: ref.id, version: v, body: newBody, siteId: site });
          targets.push({ reference: `${ref.resourceType}/${ref.id}` });
          outboxRows.push({ site_id: site, resource_type: ref.resourceType, resource_id: ref.id, version: v });
          repointed++;
        }

        // Only author the merge Provenance (and its outbox row) when the run actually changed something.
        // A full no-op re-run writes nothing and returns an empty provenanceId.
        let writtenProvenanceId = '';
        if (patientChanged || repointed > 0) {
          const provBody: Record<string, unknown> = {
            resourceType: 'Provenance', id: provenanceId, target: targets, recorded: nowIso,
            activity: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation', code: 'MERGE', display: 'merge' }] },
            agent: [{ who: { display: agent } }],
            ...(reason ? { reason: [{ text: reason }] } : {}),
            meta: { versionId: '1', lastUpdated: nowIso },
          };
          await writeVersion(trx, { resourceType: 'Provenance', id: provenanceId, version: 1, body: provBody, siteId: site });
          outboxRows.push({ site_id: site, resource_type: 'Provenance', resource_id: provenanceId, version: 1 });
          writtenProvenanceId = provenanceId;
        }

        if (outboxRows.length > 0) await trx.insertInto('sync_amendments').values(outboxRows).execute();

        return { survivorId, duplicateId, repointed, provenanceId: writtenProvenanceId, siteId: site };
      });
      try { await sql`select pg_notify('fhir_changes', '')`.execute(db); } catch { /* ignore */ }
      return result;
    },
  };
}
