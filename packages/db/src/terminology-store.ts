import { type Kysely, sql } from 'kysely';
import type { FhirResource } from '@openldr/fhir';
import type { InternalSchema } from './schema/internal';
import type { FhirStore } from './fhir-store';
import { markConceptMapChanged } from './terminology-sync';
import { LOCAL_MAP_URL } from './terminology-admin-store';

export interface ConceptRecord {
  system: string;
  code: string;
  display: string | null;
  status: string | null;
  properties: Record<string, unknown> | null;
}

export interface ConceptQuery {
  system: string;
  codes?: string[];
  property?: { name: string; value: string };
  limit?: number;
  offset?: number;
}

export interface MapElement {
  mapUrl: string;
  sourceSystem: string;
  sourceCode: string;
  targetSystem: string;
  targetCode: string;
  equivalence: string | null;
}

export interface TranslateQuery {
  mapUrl?: string;
  system: string;
  code: string;
  targetSystem?: string;
}

export interface ConceptSearchQuery {
  systemUrl: string;
  query?: string;
  statuses?: string[];
  limit: number;
  offset: number;
}

export interface ConceptSearchCountQuery {
  systemUrl: string;
  query?: string;
  statuses?: string[];
}

export interface TerminologyStore {
  upsertConcepts(rows: ConceptRecord[]): Promise<void>;
  getConcept(system: string, code: string): Promise<ConceptRecord | null>;
  findConcepts(q: ConceptQuery): Promise<ConceptRecord[]>;
  countConcepts(q: Omit<ConceptQuery, 'limit' | 'offset'>): Promise<number>;
  searchConcepts(q: ConceptSearchQuery): Promise<ConceptRecord[]>;
  countConceptsSearch(q: ConceptSearchCountQuery): Promise<number>;
  saveSystem(url: string, version: string | null, kind: string, resourceId: string): Promise<void>;
  getResourceByUrl(url: string): Promise<FhirResource | null>;
  upsertMapElements(rows: MapElement[]): Promise<void>;
  translate(q: TranslateQuery): Promise<MapElement[]>;
}

export function createTerminologyStore(db: Kysely<InternalSchema>, fhirStore: FhirStore): TerminologyStore {
  function applySearch<T>(qb: T, q: ConceptSearchCountQuery): T {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let b = qb as any;
    b = b.where('system', '=', q.systemUrl);
    if (q.query && q.query.trim()) {
      const like = `%${q.query.trim().toLowerCase()}%`;
      b = b.where((eb: any) =>
        eb.or([
          eb(sql`lower(code)`, 'like', like),
          eb(sql`lower(display)`, 'like', like),
        ]),
      );
    }
    if (q.statuses && q.statuses.length) b = b.where('status', 'in', q.statuses);
    return b as T;
  }

  function applyConceptFilter<T>(qb: T, q: ConceptQuery | Omit<ConceptQuery, 'limit' | 'offset'>): T {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let b = qb as any;
    b = b.where('system', '=', q.system);
    if (q.codes) b = b.where('code', 'in', q.codes);
    if (q.property) b = b.where(sql`properties->>${q.property.name}`, '=', q.property.value);
    return b as T;
  }

  return {
    async upsertConcepts(rows) {
      if (rows.length === 0) return;
      const values = rows.map((r) => ({
        system: r.system,
        code: r.code,
        display: r.display,
        status: r.status,
        properties: r.properties === null ? null : JSON.stringify(r.properties),
      }));
      await db
        .insertInto('terminology_concepts')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values(values as any)
        .onConflict((oc) =>
          oc.columns(['system', 'code']).doUpdateSet((eb) => ({
            display: eb.ref('excluded.display'),
            status: eb.ref('excluded.status'),
            properties: eb.ref('excluded.properties'),
          })),
        )
        .execute();
    },
    async getConcept(system, code) {
      const row = await db
        .selectFrom('terminology_concepts')
        .selectAll()
        .where('system', '=', system)
        .where('code', '=', code)
        .executeTakeFirst();
      return row ? ({ ...row, properties: (row.properties as Record<string, unknown> | null) }) : null;
    },
    async findConcepts(q) {
      let qb = db.selectFrom('terminology_concepts').selectAll();
      qb = applyConceptFilter(qb, q);
      qb = qb.orderBy('code').limit(q.limit ?? 100).offset(q.offset ?? 0);
      const rows = await qb.execute();
      return rows.map((r) => ({ ...r, properties: r.properties as Record<string, unknown> | null }));
    },
    async countConcepts(q) {
      let qb = db.selectFrom('terminology_concepts').select((eb) => eb.fn.countAll<number>().as('n'));
      qb = applyConceptFilter(qb, q);
      const row = await qb.executeTakeFirst();
      return Number(row?.n ?? 0);
    },
    async searchConcepts(q) {
      let qb = db.selectFrom('terminology_concepts').selectAll();
      qb = applySearch(qb, q);
      const rows = await qb.orderBy('code').limit(q.limit).offset(q.offset).execute();
      return rows.map((r) => ({ ...r, properties: r.properties as Record<string, unknown> | null }));
    },
    async countConceptsSearch(q) {
      let qb = db.selectFrom('terminology_concepts').select((eb) => eb.fn.countAll<number>().as('n'));
      qb = applySearch(qb, q);
      const row = await qb.executeTakeFirst();
      return Number(row?.n ?? 0);
    },
    async saveSystem(url, version, kind, resourceId) {
      await db
        .insertInto('terminology_systems')
        .values({ url, version, kind, resource_id: resourceId })
        .onConflict((oc) => oc.column('url').doUpdateSet({ version, kind, resource_id: resourceId }))
        .execute();
    },
    async getResourceByUrl(url) {
      const sys = await db.selectFrom('terminology_systems').select(['kind', 'resource_id']).where('url', '=', url).executeTakeFirst();
      if (!sys) return null;
      return fhirStore.get(sys.kind, sys.resource_id);
    },
    async upsertMapElements(rows) {
      if (rows.length === 0) return;
      const mapUrls = [...new Set(rows.map((r) => r.mapUrl))];
      await db.deleteFrom('concept_map_elements').where('map_url', 'in', mapUrls).execute();
      await db
        .insertInto('concept_map_elements')
        .values(rows.map((r) => ({ map_url: r.mapUrl, source_system: r.sourceSystem, source_code: r.sourceCode, target_system: r.targetSystem, target_code: r.targetCode, equivalence: r.equivalence })))
        .execute();
      // Sync S3: this is the single choke point for ALL concept-map writes. Emit one concept_map signal
      // per distinct map_url AFTER the rewrite (each mark opens its own txn), EXCEPT the lab's curated
      // LOCAL_MAP_URL, which is lab-local and must never be pulled.
      for (const mapUrl of mapUrls) {
        if (mapUrl !== LOCAL_MAP_URL) await markConceptMapChanged(db, mapUrl);
      }
    },
    async translate(q) {
      let qb = db.selectFrom('concept_map_elements').selectAll().where('source_system', '=', q.system).where('source_code', '=', q.code);
      if (q.mapUrl) qb = qb.where('map_url', '=', q.mapUrl);
      if (q.targetSystem) qb = qb.where('target_system', '=', q.targetSystem);
      const rows = await qb.execute();
      return rows.map((r) => ({ mapUrl: r.map_url, sourceSystem: r.source_system, sourceCode: r.source_code, targetSystem: r.target_system, targetCode: r.target_code, equivalence: r.equivalence }));
    },
  };
}
