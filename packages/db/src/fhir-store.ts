import { randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import type { FhirResource } from '@openldr/fhir';
import type { InternalSchema } from './schema/internal';
import type { Provenance } from './provenance';

export interface SavedRef {
  resourceType: string;
  id: string;
}

export interface FhirStore {
  save(resource: FhirResource, provenance?: Provenance): Promise<SavedRef>;
  get(resourceType: string, id: string): Promise<FhirResource | null>;
}

export function createFhirStore(db: Kysely<InternalSchema>): FhirStore {
  return {
    async save(resource, provenance = {}) {
      const resourceType = resource.resourceType;
      const id = (resource as { id?: string }).id ?? randomUUID();
      const full = { ...resource, id } as FhirResource;
      const versionId = ((resource as { meta?: { versionId?: string } }).meta?.versionId) ?? null;
      const values = {
        resource_type: resourceType,
        id,
        version_id: versionId,
        resource: JSON.stringify(full),
        source_system: provenance.sourceSystem ?? null,
        plugin_id: provenance.pluginId ?? null,
        plugin_version: provenance.pluginVersion ?? null,
        batch_id: provenance.batchId ?? null,
      };
      await db
        .insertInto('fhir_resources')
        .values(values)
        .onConflict((oc) =>
          oc.columns(['resource_type', 'id']).doUpdateSet({
            version_id: versionId,
            resource: JSON.stringify(full),
            source_system: provenance.sourceSystem ?? null,
            plugin_id: provenance.pluginId ?? null,
            plugin_version: provenance.pluginVersion ?? null,
            batch_id: provenance.batchId ?? null,
            updated_at: sql`now()`,
          }),
        )
        .execute();
      return { resourceType, id };
    },

    async get(resourceType, id) {
      const row = await db
        .selectFrom('fhir_resources')
        .select('resource')
        .where('resource_type', '=', resourceType)
        .where('id', '=', id)
        .executeTakeFirst();
      return row ? (row.resource as FhirResource) : null;
    },
  };
}
