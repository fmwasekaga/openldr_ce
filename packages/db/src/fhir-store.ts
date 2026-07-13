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

export interface FhirStore {
  save(resource: FhirResource, provenance?: Provenance): Promise<SavedRef>;
  get(resourceType: string, id: string): Promise<FhirResource | null>;
  listByType(resourceType: string, limit?: number): Promise<{ id: string; resource: FhirResource }[]>;
  delete(resourceType: string, id: string): Promise<DeleteResult>;
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
    siteId = row?.value ?? process.env.OPENLDR_SITE_ID ?? null;
    return siteId;
  }

  return {
    async save(resource, provenance = {}) {
      const resourceType = resource.resourceType;
      const id = (resource as { id?: string }).id ?? randomUUID();
      const site = await resolveSiteId();
      return db.transaction().execute(async (trx) => {
        // bigint reads back as string on real pg, number on pg-mem — always coerce.
        const cur = await trx
          .selectFrom('fhir.fhir_resources')
          .select('version')
          .where('resource_type', '=', resourceType)
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        const next = (cur ? Number(cur.version) : 0) + 1;
        const nowIso = new Date().toISOString();
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
        await trx
          .insertInto('fhir.change_log')
          .values({ resource_type: resourceType, resource_id: id, version: next, op: 'upsert', content_hash: contentHash(serialized), site_id: site })
          .execute();
        return { resourceType, id, version: next };
      });
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
        const cur = await trx
          .selectFrom('fhir.fhir_resources')
          .select('version')
          .where('resource_type', '=', resourceType)
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!cur) return { deleted: false };
        const next = Number(cur.version) + 1;
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
  };
}
