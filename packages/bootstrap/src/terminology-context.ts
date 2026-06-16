import { Kysely } from 'kysely';
import type { Config } from '@openldr/config';
import { redact } from '@openldr/core';
import { createInternalDb, createFhirStore, createTerminologyStore, createTerminologyAdminStore, createOntologyStore, type TerminologyAdminStore, type InternalSchema, type OntologyStore, resolveSeedPublisherId, deriveSystemCode } from '@openldr/db';
import { buildOntologyDistribution, createOperations, type Operations, type LoaderStore, loadLoinc, loadWhonetAmr, importTerminologyResource, stalenessReason, type LoadResult, type OntologyBuildProgress, type OntologyManifest } from '@openldr/terminology';

function createOntologyApi(ontologyStore: OntologyStore) {
  return {
    listDistributions: () => ontologyStore.list(),
    async getDistribution(systemId: string) {
      const distribution = await ontologyStore.get(systemId);
      return distribution ? { ...distribution, stale: stalenessReason(distribution.manifest as OntologyManifest | null) !== null } : null;
    },
    build: (systemId: string, sourcePath: string, onProgress: (progress: OntologyBuildProgress) => void) =>
      buildOntologyDistribution(systemId, sourcePath, ontologyStore, onProgress),
    async rebuild(systemId: string, onProgress: (progress: OntologyBuildProgress) => void) {
      const distribution = await ontologyStore.get(systemId);
      if (!distribution) throw new Error('No distribution linked.');
      return buildOntologyDistribution(systemId, distribution.sourcePath, ontologyStore, onProgress);
    },
    unlink: (systemId: string) => ontologyStore.unlink(systemId),
    roots: (systemId: string) => ontologyStore.roots(systemId),
    children: (systemId: string, parent: string) => ontologyStore.children(systemId, parent),
    node: (systemId: string, code: string) => ontologyStore.node(systemId, code),
    search: (systemId: string, query: string) => ontologyStore.search(systemId, query),
    path: (systemId: string, code: string) => ontologyStore.path(systemId, code),
    panelMembers: (systemId: string, panel: string) => ontologyStore.panelMembers(systemId, panel),
    answerOptions: (systemId: string, loinc: string) => ontologyStore.answerOptions(systemId, loinc),
    specimenCodes: (systemId: string, loinc: string) => ontologyStore.specimenCodes(systemId, loinc),
  };
}

export interface TerminologyContext {
  ops: Operations;
  admin: TerminologyAdminStore;
  ontology: ReturnType<typeof createOntologyApi>;
  loaders: {
    loinc(dir: string, acceptLicense: boolean): Promise<LoadResult>;
    amr(sqlitePath: string): Promise<LoadResult[]>;
    resource(json: unknown): Promise<LoadResult>;
  };
  close(): Promise<void>;
}

export async function createTerminologyContext(cfg: Config): Promise<TerminologyContext> {
  const internal = createInternalDb(cfg.INTERNAL_DATABASE_URL);
  const db = internal.db as unknown as Kysely<InternalSchema>;
  const fhirStore = createFhirStore(db);
  const store = createTerminologyStore(db, fhirStore);
  const projection = {
    async saveValueSetResource(resource: Record<string, unknown>): Promise<string> {
      const saved = await fhirStore.save(resource as never);
      return (saved as { id?: string })?.id ?? String((resource as { id?: string }).id ?? '');
    },
    async registerSystem(url: string, version: string | null, kind: string, resourceId: string): Promise<void> {
      await store.saveSystem(url, version, kind, resourceId);
    },
    async deleteValueSetResource(url: string): Promise<void> {
      await db.deleteFrom('terminology_systems').where('url', '=', url).execute();
    },
  };
  const admin = createTerminologyAdminStore(db, projection);
  const ontology = createOntologyApi(createOntologyStore(db));
  const loaderStore: LoaderStore = {
    upsertConcepts: (r) => store.upsertConcepts(r),
    upsertMapElements: (r) => store.upsertMapElements(r),
    saveResource: (res) => fhirStore.save(res as never),
    saveSystem: async (url, version, kind, id) => {
      await store.saveSystem(url, version, kind, id);
      // Best-effort: project CodeSystems into coding_systems so they appear in the
      // admin UI under their resolved publisher. Never fail the import on this.
      if (kind === 'CodeSystem') {
        try {
          await admin.codingSystems.upsertByUrl({
            url,
            systemCode: deriveSystemCode(url),
            systemName: deriveSystemCode(url),
            systemVersion: version,
            publisherId: resolveSeedPublisherId(url),
          });
        } catch (e) {
          // Best-effort projection: the migration backfill also covers it on next
          // migrate. Log (redacted — the error may carry the DB connection string)
          // rather than swallow, so a real failure is observable.
          console.warn('[terminology] coding_systems projection failed:', redact(e instanceof Error ? e.message : String(e)));
        }
      }
    },
  };
  const ops = createOperations({
    getConcept: (s, c) => store.getConcept(s, c),
    findConcepts: (q) => store.findConcepts(q),
    countConcepts: (q) => store.countConcepts(q),
    getResourceByUrl: (u) => store.getResourceByUrl(u),
    translate: (q) => store.translate(q),
  });
  return {
    ops,
    admin,
    ontology,
    loaders: {
      loinc: (dir, acceptLicense) => loadLoinc(dir, { acceptLicense }, loaderStore),
      amr: (p) => loadWhonetAmr(p, loaderStore),
      resource: (json) => importTerminologyResource(json, loaderStore),
    },
    async close() { await internal.close(); },
  };
}
