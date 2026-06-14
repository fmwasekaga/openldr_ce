import { Kysely } from 'kysely';
import type { Config } from '@openldr/config';
import { createInternalDb, createFhirStore, createTerminologyStore, type InternalSchema } from '@openldr/db';
import { createOperations, type Operations, type LoaderStore, loadLoinc, loadWhonetAmr, importTerminologyResource, type LoadResult } from '@openldr/terminology';

export interface TerminologyContext {
  ops: Operations;
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
  const loaderStore: LoaderStore = {
    upsertConcepts: (r) => store.upsertConcepts(r),
    upsertMapElements: (r) => store.upsertMapElements(r),
    saveResource: (res) => fhirStore.save(res as never),
    saveSystem: (url, version, kind, id) => store.saveSystem(url, version, kind, id),
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
    loaders: {
      loinc: (dir, acceptLicense) => loadLoinc(dir, { acceptLicense }, loaderStore),
      amr: (p) => loadWhonetAmr(p, loaderStore),
      resource: (json) => importTerminologyResource(json, loaderStore),
    },
    async close() { await internal.close(); },
  };
}
