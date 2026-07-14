import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';
import { recordReferenceChange } from './reference-change-log';

// Distributed sync S3 (Layer B): terminology bulk change SIGNAL. A concept import touches thousands
// of rows per operation; logging one reference_change_log row per code would flood the log. Instead we
// keep a per-code-system (terminology_systems.generation) and per-concept-map (concept_map_state.generation)
// counter, bumped ONCE per import-operation. Each bump emits exactly ONE reference_change_log row whose
// content_hash IS the new generation — since generation always increments, recordReferenceChange's dedup
// never collapses a real bump (dedup only fires on an identical content_hash, which cannot recur).
//
// Call these at import-OPERATION completion (after all concept/element rows are written), NOT per batch.
// Task B2 wires the call sites; this module just builds + tests the primitives.

/** Bump a code-system's generation by 1 and emit one deduped reference_change_log signal
 *  (entity_type='terminology_system', entity_id=systemUrl, op='upsert', content_hash=<new generation>).
 *  Runs in its own transaction. If no terminology_systems row exists yet (a concept-only import with no
 *  prior saveSystem CodeSystem header), a minimal registry row is created so the signal has a home. */
export async function markTerminologyChanged(db: Kysely<InternalSchema>, systemUrl: string): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const cur = await trx
      .selectFrom('terminology_systems')
      .select('generation')
      .where('url', '=', systemUrl)
      .executeTakeFirst();
    const nextGen = (cur ? Number(cur.generation) : 0) + 1;
    if (cur) {
      await trx
        .updateTable('terminology_systems')
        .set({ generation: nextGen })
        .where('url', '=', systemUrl)
        .execute();
    } else {
      // Concept-only import with no prior saveSystem: create a minimal registry row so the signal has a
      // home. resource_id is NOT NULL (007_terminology) — '' is a pragmatic placeholder meaning "no
      // backing CodeSystem resource"; getResourceByUrl on such a system returns null (fhirStore.get('','')),
      // which is the correct "concepts exist but no header resource" answer.
      await trx
        .insertInto('terminology_systems')
        .values({ url: systemUrl, version: null, kind: 'CodeSystem', resource_id: '', generation: nextGen })
        .execute();
    }
    await recordReferenceChange(trx, 'terminology_system', systemUrl, 'upsert', String(nextGen));
  });
}

/** Bump a concept-map's generation by 1 (keyed by map_url in concept_map_state) and emit one deduped
 *  reference_change_log signal (entity_type='concept_map', op='upsert', content_hash=<new generation>).
 *  Runs in its own transaction. */
export async function markConceptMapChanged(db: Kysely<InternalSchema>, mapUrl: string): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const cur = await trx
      .selectFrom('concept_map_state')
      .select('generation')
      .where('map_url', '=', mapUrl)
      .executeTakeFirst();
    const nextGen = (cur ? Number(cur.generation) : 0) + 1;
    await trx
      .insertInto('concept_map_state')
      .values({ map_url: mapUrl, generation: nextGen })
      .onConflict((oc) => oc.column('map_url').doUpdateSet({ generation: nextGen }))
      .execute();
    await recordReferenceChange(trx, 'concept_map', mapUrl, 'upsert', String(nextGen));
  });
}
