import type { Kysely } from 'kysely';
import type { InternalSchema, Logger } from '@openldr/db';
import type { ConceptsPage, MapElementsPage } from './batch';

// How many upsert rows per INSERT statement. The delete-not-in reconcile is a single statement; only
// the upsert is chunked (pg parameter-count safety for large systems).
const UPSERT_CHUNK = 1000;
// Defensive cap on the paging loop so a buggy/hostile endpoint that never returns a null cursor cannot
// spin forever. At UPSERT_CHUNK-sized pages this covers tens of millions of concepts.
const MAX_PAGES = 100000;

// Injected deps for the lab-side bulk terminology sync. Kept pure over its transport + db so the page
// fetchers are fakeable and the reconcile can run against a real (pg-mem) db in tests. B5's worker wires
// `fetchConceptsPage`/`fetchMapElementsPage` to the central bulk endpoints and `getToken` to the sync
// token provider; `labDb` is the lab's internal Kysely.
export interface TerminologyBulkDeps {
  labDb: Kysely<InternalSchema>;
  fetchConceptsPage: (systemUrl: string, afterCode: string | null, token: string) => Promise<ConceptsPage>;
  fetchMapElementsPage: (
    mapUrl: string,
    afterKey: { sourceSystem: string; sourceCode: string } | null,
    token: string,
  ) => Promise<MapElementsPage>;
  getToken: () => Promise<string>;
  logger: Logger;
}

export interface TerminologyBulkSync {
  syncSystem(systemUrl: string, signalBody: unknown): Promise<void>;
  syncConceptMap(mapUrl: string, signalBody: unknown): Promise<void>;
}

interface SystemDescriptor {
  version?: string | null;
  kind?: string;
  resourceId?: string;
  generation?: number;
}
interface MapDescriptor {
  generation?: number;
}

/** Lab-side whole-system / whole-map bulk reconcile. For a central-managed terminology system (or map),
 *  it drains ALL keyset pages from central FIRST — outside any transaction — then applies the pulled set
 *  to the lab copy in ONE transaction. Draining before the transaction is deliberate: a page-fetch
 *  failure mid-drain throws before the transaction is ever opened, so the lab copy is left completely
 *  untouched (no partial apply). B5's worker relies on that: a throw propagates and it holds the cursor
 *  so the whole reconcile retries next cycle. */
export function createTerminologyBulkSync(deps: TerminologyBulkDeps): TerminologyBulkSync {
  return {
    async syncSystem(systemUrl, signalBody) {
      const desc = (signalBody ?? {}) as SystemDescriptor;
      const token = await deps.getToken();

      // 1. Drain ALL concept pages BEFORE opening the reconcile transaction. A fetch failure here throws
      //    and the transaction below never runs → lab copy untouched (no partial apply).
      const concepts: ConceptsPage['concepts'] = [];
      let after: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const p: ConceptsPage = await deps.fetchConceptsPage(systemUrl, after, token);
        concepts.push(...p.concepts);
        after = p.nextCode;
        if (after === null) break;
        if (page === MAX_PAGES - 1) {
          throw new Error(`terminology system drain exceeded ${MAX_PAGES} pages for ${systemUrl}`);
        }
      }

      const codes = concepts.map((c) => c.code);

      // 2. Reconcile the whole system in ONE transaction: upsert the pulled concepts, delete any of THIS
      //    system's concepts no longer present, and stamp the system row central-managed.
      //
      //    KNOWN LIMITATION (accepted for S3): concepts inherit ownership from their system — there is no
      //    per-concept managed_origin. Only central-managed systems reach here (B5's worker routes them),
      //    so a blanket whole-system delete-not-in is correct for central-owned content. BUT if a lab has
      //    curated its own DRAFT concept under a system URL that is ALSO central-managed, that lab draft
      //    is treated as central-owned and WILL be deleted by this reconcile. This is a conscious choice
      //    of the system-level ownership model, not a silent surprise; it does not block S3. The S7 fix is
      //    a per-concept origin flag (or a separate lab-draft system URL).
      await deps.labDb.transaction().execute(async (trx) => {
        // Upsert in chunks. Mirrors db.upsertConcepts: ON CONFLICT (system,code) DO UPDATE the mutable
        // columns; properties is jsonb held as TEXT so JSON.stringify on write (null stays null).
        for (let i = 0; i < concepts.length; i += UPSERT_CHUNK) {
          const chunk = concepts.slice(i, i + UPSERT_CHUNK).map((c) => ({
            system: systemUrl,
            code: c.code,
            display: c.display,
            status: c.status,
            properties: c.properties == null ? null : JSON.stringify(c.properties),
          }));
          await trx
            .insertInto('terminology_concepts')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .values(chunk as any)
            .onConflict((oc) =>
              oc.columns(['system', 'code']).doUpdateSet((eb) => ({
                display: eb.ref('excluded.display'),
                status: eb.ref('excluded.status'),
                properties: eb.ref('excluded.properties'),
              })),
            )
            .execute();
        }

        // Whole-system delete-not-in: drop any concept of THIS system that the pull no longer contains.
        // An EMPTY pull (codes.length === 0) deliberately deletes ALL of the system's concepts — that is
        // the "central emptied the system" case, NOT a no-op. A large NOT IN list is fine for S3
        // (hundreds of concepts); the S7 optimization for 100k-row systems is a staging-table anti-join.
        let del = trx.deleteFrom('terminology_concepts').where('system', '=', systemUrl);
        if (codes.length) del = del.where('code', 'not in', codes);
        await del.execute();

        // Stamp the terminology_systems row central-managed with the descriptor's identity/generation.
        const row = {
          url: systemUrl,
          version: desc.version ?? null,
          kind: desc.kind ?? 'CodeSystem',
          resource_id: desc.resourceId ?? '',
          generation: desc.generation ?? 0,
          managed_origin: 'central',
        };
        await trx
          .insertInto('terminology_systems')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .values(row as any)
          .onConflict((oc) =>
            oc.column('url').doUpdateSet({
              version: row.version,
              kind: row.kind,
              resource_id: row.resource_id,
              generation: row.generation,
              managed_origin: row.managed_origin,
            }),
          )
          .execute();
      });

      deps.logger.info({ systemUrl, count: concepts.length }, 'terminology system synced');
    },

    async syncConceptMap(mapUrl, signalBody) {
      const desc = (signalBody ?? {}) as MapDescriptor;
      const token = await deps.getToken();

      // 1. Drain ALL element pages BEFORE the transaction (same no-partial-apply guarantee as syncSystem).
      const elements: MapElementsPage['elements'] = [];
      let after: { sourceSystem: string; sourceCode: string } | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const p: MapElementsPage = await deps.fetchMapElementsPage(mapUrl, after, token);
        elements.push(...p.elements);
        after = p.nextKey;
        if (after === null) break;
        if (page === MAX_PAGES - 1) {
          throw new Error(`concept map drain exceeded ${MAX_PAGES} pages for ${mapUrl}`);
        }
      }

      // 2. Whole-map replace in ONE transaction: delete this map's elements, reinsert the pulled set,
      //    stamp concept_map_state central-managed. Mirrors db.upsertMapElements' delete-then-reinsert.
      await deps.labDb.transaction().execute(async (trx) => {
        await trx.deleteFrom('concept_map_elements').where('map_url', '=', mapUrl).execute();
        for (let i = 0; i < elements.length; i += UPSERT_CHUNK) {
          const chunk = elements.slice(i, i + UPSERT_CHUNK).map((e) => ({
            map_url: mapUrl,
            source_system: e.sourceSystem,
            source_code: e.sourceCode,
            target_system: e.targetSystem,
            target_code: e.targetCode,
            equivalence: e.equivalence,
          }));
          await trx.insertInto('concept_map_elements').values(chunk).execute();
        }

        const state = { map_url: mapUrl, generation: desc.generation ?? 0, managed_origin: 'central' };
        await trx
          .insertInto('concept_map_state')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .values(state as any)
          .onConflict((oc) =>
            oc.column('map_url').doUpdateSet({ generation: state.generation, managed_origin: state.managed_origin }),
          )
          .execute();
      });

      deps.logger.info({ mapUrl, count: elements.length }, 'concept map synced');
    },
  };
}
