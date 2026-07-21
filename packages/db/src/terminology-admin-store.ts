import { randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import { canonicalHash } from '@openldr/core';
import type { InternalSchema } from './schema/internal';
import type { ReferenceCapture } from './reference-capture';
import { fhirValueSetCatalogToInputs, fhirValueSetToInput, valueSetToFhirResource } from './fhir-value-set';
import { expandCompose, type ExpandedConcept, type ExpandDeps, type VsCompose } from './value-set-expander';
import { markTerminologyChanged } from './terminology-sync';

export type PublisherRole = 'local' | 'standard' | 'external';

export interface Publisher {
  id: string;
  name: string;
  role: PublisherRole;
  icon: string | null;
  seeded: boolean;
  sortOrder: number;
}
export interface PublisherInput { name: string; role: PublisherRole; icon?: string | null }

export interface CodingSystem {
  id: string;
  systemCode: string;
  systemName: string;
  url: string | null;
  systemVersion: string | null;
  description: string | null;
  active: boolean;
  publisherId: string | null;
  seeded: boolean;
}
export interface CodingSystemInput {
  systemCode: string;
  systemName: string;
  url?: string | null;
  systemVersion?: string | null;
  description?: string | null;
  active: boolean;
  publisherId?: string | null;
}

export type MapType = 'SAME-AS' | 'NARROWER-THAN' | 'BROADER-THAN' | 'RELATED-TO' | 'UNMAPPED-FROM';
export interface TermMapping {
  id: string; fromSystem: string; fromCode: string; toSystem: string; toCode: string;
  toDisplay: string | null; mapType: MapType; relationship: string | null; owner: string | null; isActive: boolean;
}
export interface TermMappingInput {
  fromSystem: string; fromCode: string; toSystem: string; toCode: string; toDisplay: string | null;
  mapType: MapType; relationship?: string | null; owner?: string | null; isActive: boolean;
}

export type TermStatus = 'ACTIVE' | 'DRAFT' | 'DEPRECATED' | 'DISABLED';
export interface Term {
  system: string; code: string; display: string | null; status: string;
  shortName: string | null; class: string | null; unit: string | null;
  replacedBy: string | null; metadata: Record<string, unknown> | null; mappingCount: number;
}
export interface TermInput {
  system: string; code: string; display: string; status: TermStatus;
  shortName?: string | null; class?: string | null; unit?: string | null;
  replacedBy?: string | null; metadata?: Record<string, unknown> | null;
}

export type { ExpandedConcept, VsCompose } from './value-set-expander';
export interface ValueSet {
  id: string; url: string; version: string | null; name: string | null; title: string | null;
  status: string; experimental: boolean; description: string | null; compose: VsCompose;
  immutable: boolean; category: string | null; publisherId: string | null;
}
export interface ValueSetSummary {
  id: string; url: string; name: string | null; title: string | null; version: string | null;
  status: string; immutable: boolean; publisherId: string | null; category: string | null;
  codeCount: number; primarySystem: string | null;
}
export interface ValueSetInput {
  url: string; version?: string | null; name?: string | null; title?: string | null;
  status: string; experimental?: boolean; description?: string | null; compose: VsCompose;
  publisherId?: string | null; category?: string | null;
}
export interface ValueSetProjection {
  saveValueSetResource(resource: Record<string, unknown>): Promise<string>;
  registerSystem(url: string, version: string | null, kind: string, resourceId: string): Promise<void>;
  deleteValueSetResource(url: string): Promise<void>;
}

export class TerminologyAdminError extends Error {
  constructor(message: string, public readonly kind: 'not-found' | 'conflict') {
    super(message);
    this.name = 'TerminologyAdminError';
  }
}

function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

// The lab's own curated concept map. Sync S3: this map is lab-LOCAL curation and must NEVER be
// signalled as a pullable concept_map change — upsertMapElements guards on this exact url, and the
// termMappings.* writers (which write LOCAL_MAP_URL rows directly) intentionally emit no map signal.
export const LOCAL_MAP_URL = 'urn:openldr:terminology:local-map';

// Reference-change content hashes (distributed sync S3): computed over the PERSISTED row's
// content fields (NOT id/seeded), stable against jsonb key reordering (canonicalHash sorts keys)
// so a lab pulling the change consumes exactly what the center serves.
function pubContentHash(r: { name: string; role: string; icon: string | null; match_prefixes: unknown; sort_order: number }): string {
  const mp = typeof r.match_prefixes === 'string' ? JSON.parse(r.match_prefixes) : (r.match_prefixes ?? []);
  return canonicalHash({ name: r.name, role: r.role, icon: r.icon, matchPrefixes: mp, sortOrder: r.sort_order });
}
function csContentHash(r: { system_code: string; system_name: string; url: string | null; system_version: string | null; description: string | null; active: boolean; publisher_id: string | null }): string {
  return canonicalHash({
    systemCode: r.system_code, systemName: r.system_name, url: r.url, systemVersion: r.system_version,
    description: r.description, active: r.active, publisherId: r.publisher_id,
  });
}
function tmContentHash(r: { from_system: string; from_code: string; to_system: string; to_code: string; to_display: string | null; map_type: string; relationship: string | null; is_active: boolean }): string {
  return canonicalHash({
    fromSystem: r.from_system, fromCode: r.from_code, toSystem: r.to_system, toCode: r.to_code,
    toDisplay: r.to_display, mapType: r.map_type, relationship: r.relationship, isActive: r.is_active,
  });
}

export interface TerminologyAdminStore {
  publishers: {
    list(): Promise<Publisher[]>;
    create(input: PublisherInput): Promise<Publisher>;
    update(id: string, input: PublisherInput): Promise<Publisher>;
    delete(id: string): Promise<void>;
    deletionImpact(id: string): Promise<{ systemCount: number; termCount: number }>;
  };
  codingSystems: {
    list(publisherId?: string): Promise<CodingSystem[]>;
    create(input: CodingSystemInput): Promise<CodingSystem>;
    update(id: string, input: CodingSystemInput): Promise<CodingSystem>;
    delete(id: string, opts?: { cascade?: boolean }): Promise<void>;
    deletionImpact(id: string): Promise<{ termCount: number; mappingCount: number }>;
    upsertByUrl(input: { url: string; systemCode: string; systemName: string; systemVersion?: string | null; publisherId: string | null }): Promise<void>;
    getByUrl(url: string): Promise<CodingSystem | null>;
  };
  terms: {
    search(systemUrl: string, q: { query?: string; statuses?: string[]; limit: number; offset: number }): Promise<{ rows: Term[]; total: number }>;
    create(input: TermInput): Promise<Term>;
    update(system: string, code: string, input: TermInput): Promise<Term>;
    delete(system: string, code: string): Promise<void>;
    importRows(rows: { system: string; code: string; display: string | null; status: string; properties: Record<string, unknown> | null }[]): Promise<{ imported: number }>;
  };
  termMappings: {
    listOutgoing(system: string, code: string): Promise<TermMapping[]>;
    listReverse(system: string, code: string): Promise<TermMapping[]>;
    create(input: TermMappingInput): Promise<{ mapping: TermMapping; draftCreated: boolean }>;
    update(id: string, input: TermMappingInput): Promise<TermMapping>;
    delete(id: string): Promise<void>;
  };
  valueSets: {
    list(publisherId?: string): Promise<ValueSetSummary[]>;
    get(id: string): Promise<ValueSet>;
    getByUrl(url: string): Promise<ValueSetSummary | null>;
    save(input: ValueSetInput): Promise<ValueSet>;
    duplicate(id: string): Promise<ValueSet>;
    delete(id: string): Promise<void>;
    expand(id: string, activeOnly?: boolean): Promise<{ codes: ExpandedConcept[]; total: number }>;
    importFhir(resource: unknown): Promise<ValueSet>;
    importFhirCatalog(resource: unknown): Promise<{ imported: number; skipped: number; valueSet: ValueSet | null }>;
    exportFhir(id: string): Promise<Record<string, unknown>>;
  };
}

export function createTerminologyAdminStore(db: Kysely<InternalSchema>, projection?: ValueSetProjection, capture?: ReferenceCapture): TerminologyAdminStore {
  const pubRow = (r: { id: string; name: string; role: string; icon: string | null; seeded: boolean; sort_order: number }): Publisher => ({
    id: r.id, name: r.name, role: r.role as PublisherRole, icon: r.icon, seeded: r.seeded, sortOrder: r.sort_order,
  });
  const csRow = (r: { id: string; system_code: string; system_name: string; url: string | null; system_version: string | null; description: string | null; active: boolean; publisher_id: string | null; seeded: boolean }): CodingSystem => ({
    id: r.id, systemCode: r.system_code, systemName: r.system_name, url: r.url, systemVersion: r.system_version,
    description: r.description, active: r.active, publisherId: r.publisher_id, seeded: r.seeded,
  });

  function packProps(i: TermInput): Record<string, unknown> | null {
    const p: Record<string, unknown> = {};
    if (i.shortName) p.shortName = i.shortName;
    if (i.class) p.class = i.class;
    if (i.unit) p.unit = i.unit;
    if (i.replacedBy) p.replacedBy = i.replacedBy;
    if (i.metadata && Object.keys(i.metadata).length) p.meta = i.metadata;
    return Object.keys(p).length ? p : null;
  }
  function termRow(r: { system: string; code: string; display: string | null; status: string | null; properties: unknown }, mappingCount: number): Term {
    const p = (r.properties ?? {}) as Record<string, unknown>;
    return {
      system: r.system, code: r.code, display: r.display, status: r.status ?? 'ACTIVE',
      shortName: (p.shortName as string) ?? null, class: (p.class as string) ?? null,
      unit: (p.unit as string) ?? null, replacedBy: (p.replacedBy as string) ?? null,
      metadata: (p.meta as Record<string, unknown>) ?? null, mappingCount,
    };
  }
  const tmRow = (r: { id: string; from_system: string; from_code: string; to_system: string; to_code: string; to_display: string | null; map_type: string; relationship: string | null; owner: string | null; is_active: boolean }): TermMapping => ({
    id: r.id, fromSystem: r.from_system, fromCode: r.from_code, toSystem: r.to_system, toCode: r.to_code,
    toDisplay: r.to_display, mapType: r.map_type as MapType, relationship: r.relationship, owner: r.owner, isActive: r.is_active,
  });

  async function mappingCountFor(system: string, code: string): Promise<number> {
    const r = await db.selectFrom('term_mappings').select((eb) => eb.fn.countAll<number>().as('n'))
      .where((eb) => eb.or([
        eb.and([eb('from_system', '=', system), eb('from_code', '=', code)]),
        eb.and([eb('to_system', '=', system), eb('to_code', '=', code)]),
      ])).executeTakeFirst();
    return Number(r?.n ?? 0);
  }

  const vsRow = (r: {
    id: string; url: string; version: string | null; name: string | null; title: string | null;
    status: string; experimental: boolean; description: string | null; compose: unknown;
    immutable: boolean; category: string | null; publisher_id: string | null;
  }): ValueSet => ({
    id: r.id, url: r.url, version: r.version, name: r.name, title: r.title, status: r.status,
    experimental: r.experimental, description: r.description,
    compose: (typeof r.compose === 'string' ? JSON.parse(r.compose) : (r.compose ?? { include: [] })) as VsCompose,
    immutable: r.immutable, category: r.category, publisherId: r.publisher_id,
  });

  const vsDeps: ExpandDeps = {
    async listSystemConcepts(systemUrl, activeOnly) {
      let qb = db.selectFrom('terminology_concepts').select(['system', 'code', 'display']).where('system', '=', systemUrl);
      if (activeOnly) qb = qb.where('status', '=', 'ACTIVE');
      const rows = await qb.orderBy('code').limit(10_000).execute();
      return rows.map((r) => ({ system: r.system, code: r.code, display: r.display }));
    },
    async filterConcepts(systemUrl, filters, activeOnly) {
      let qb = db.selectFrom('terminology_concepts').select(['system', 'code', 'display']).where('system', '=', systemUrl);
      if (activeOnly) qb = qb.where('status', '=', 'ACTIVE');
      for (const f of filters) {
        if (f.property === 'status') qb = qb.where('status', '=', f.value);
        else qb = qb.where(sql`properties->>${f.property}`, '=', f.value);
      }
      const rows = await qb.orderBy('code').limit(10_000).execute();
      return rows.map((r) => ({ system: r.system, code: r.code, display: r.display }));
    },
    async resolveDisplay(systemUrl, code) {
      const r = await db.selectFrom('terminology_concepts').select(['display']).where('system', '=', systemUrl).where('code', '=', code).executeTakeFirst();
      return r?.display ?? null;
    },
    async resolveValueSetCompose(url) {
      const r = await db.selectFrom('value_sets').select(['compose']).where('url', '=', url).executeTakeFirst();
      if (!r) return null;
      return (typeof r.compose === 'string' ? JSON.parse(r.compose) : r.compose) as VsCompose;
    },
  };

  function primarySystemOf(compose: VsCompose): string | null {
    return compose.include?.find((i) => i.system)?.system ?? null;
  }

  function summarizeValueSet(vs: ValueSet, codeCount: number): ValueSetSummary {
    return {
      id: vs.id, url: vs.url, name: vs.name, title: vs.title, version: vs.version, status: vs.status,
      immutable: vs.immutable, publisherId: vs.publisherId, category: vs.category,
      codeCount, primarySystem: primarySystemOf(vs.compose),
    };
  }

  async function getValueSet(id: string): Promise<ValueSet> {
    const r = await db.selectFrom('value_sets').selectAll().where('id', '=', id).executeTakeFirst();
    if (!r) throw new TerminologyAdminError(`value set not found: ${id}`, 'not-found');
    return vsRow(r);
  }

  async function writeExpansionCache(id: string, codes: ExpandedConcept[]): Promise<void> {
    await db.deleteFrom('valueset_expansions').where('value_set_id', '=', id).execute();
    if (codes.length) {
      await db.insertInto('valueset_expansions').values(codes.map((c) => ({
        value_set_id: id, system_url: c.system, code: c.code, display: c.display, inactive: false,
      }))).execute();
    }
    await db.updateTable('value_sets').set({ expanded_at: sql`now()` }).where('id', '=', id).execute();
  }

  async function insertExpansionRows(dbLike: Kysely<InternalSchema>, id: string, codes: ExpandedConcept[]): Promise<void> {
    const batchSize = 1000;
    for (let i = 0; i < codes.length; i += batchSize) {
      const batch = codes.slice(i, i + batchSize).map((c) => ({
        value_set_id: id, system_url: c.system, code: c.code, display: c.display, inactive: false,
      }));
      if (batch.length) {
        await dbLike.insertInto('valueset_expansions').values(batch as never)
          .onConflict((oc) => oc.columns(['value_set_id', 'system_url', 'code']).doNothing())
          .execute();
      }
    }
  }

  async function refreshCacheAndProject(vs: ValueSet): Promise<void> {
    const { codes } = await expandCompose(vs.compose, vsDeps, { seedUrls: [vs.url] });
    await writeExpansionCache(vs.id, codes);
    if (projection) {
      const resource = valueSetToFhirResource(
        { id: vs.id, url: vs.url, status: vs.status as never, experimental: vs.experimental, version: vs.version, name: vs.name, title: vs.title, description: vs.description, compose: vs.compose },
        codes,
      );
      const resourceId = await projection.saveValueSetResource(resource);
      await projection.registerSystem(vs.url, vs.version, 'ValueSet', resourceId);
    }
  }

  async function saveValueSet(input: ValueSetInput): Promise<ValueSet> {
    const url = input.url.trim();
    if (!url) throw new TerminologyAdminError('value set url required', 'conflict');
    const existing = await db.selectFrom('value_sets').select(['id', 'immutable']).where('url', '=', url).executeTakeFirst();
    if (existing?.immutable) throw new TerminologyAdminError('this value set is immutable - duplicate it to make changes', 'conflict');
    const id = existing?.id ?? newId('vs');
    const composeJson = JSON.stringify(input.compose ?? { include: [] });
    if (existing) {
      await db.updateTable('value_sets').set({
        version: input.version ?? null, name: input.name ?? null, title: input.title ?? null,
        status: input.status, experimental: input.experimental ?? false, description: input.description ?? null,
        compose: composeJson as never, category: input.category ?? null, publisher_id: input.publisherId ?? null,
        updated_at: sql`now()`,
      }).where('id', '=', id).execute();
    } else {
      await db.insertInto('value_sets').values({
        id, url, version: input.version ?? null, name: input.name ?? null, title: input.title ?? null,
        status: input.status, experimental: input.experimental ?? false, description: input.description ?? null,
        compose: composeJson as never, immutable: false, category: input.category ?? null, publisher_id: input.publisherId ?? null,
      } as never).execute();
    }
    const vs = await getValueSet(id);
    await refreshCacheAndProject(vs);
    return vs;
  }

  return {
    publishers: {
      async list() {
        const rows = await db.selectFrom('publishers').selectAll().orderBy('sort_order').orderBy('name').execute();
        return rows.map(pubRow);
      },
      async create(input) {
        const id = newId('pub');
        return db.transaction().execute(async (trx) => {
          await trx.insertInto('publishers').values({
            id, name: input.name, role: input.role, icon: input.icon ?? null,
            // pg-mem needs a JSON string for jsonb; real PG accepts the sql`` fragment.
            // Use JSON.stringify so pg-mem in tests accepts the value.
            match_prefixes: JSON.stringify([]) as never,
            seeded: false, sort_order: 100,
          }).execute();
          const row = await trx.selectFrom('publishers').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
          if (capture) await capture.record(trx, 'publisher', id, 'upsert', pubContentHash(row));
          return pubRow(row);
        });
      },
      async update(id, input) {
        const existing = await db.selectFrom('publishers').select(['seeded']).where('id', '=', id).executeTakeFirst();
        if (!existing) throw new TerminologyAdminError(`publisher not found: ${id}`, 'not-found');
        return db.transaction().execute(async (trx) => {
          await trx.updateTable('publishers').set({ name: input.name, role: input.role, icon: input.icon ?? null }).where('id', '=', id).execute();
          const row = await trx.selectFrom('publishers').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
          if (capture) await capture.record(trx, 'publisher', id, 'upsert', pubContentHash(row));
          return pubRow(row);
        });
      },
      async delete(id) {
        const row = await db.selectFrom('publishers').select(['seeded']).where('id', '=', id).executeTakeFirst();
        if (!row) throw new TerminologyAdminError(`publisher not found: ${id}`, 'not-found');
        if (row.seeded) throw new TerminologyAdminError('cannot delete a seeded publisher', 'conflict');
        await db.transaction().execute(async (trx) => {
          await trx.deleteFrom('publishers').where('id', '=', id).execute();
          if (capture) await capture.record(trx, 'publisher', id, 'delete', null);
        });
      },
      async deletionImpact(id) {
        const systems = await db.selectFrom('coding_systems').select(['url']).where('publisher_id', '=', id).execute();
        const urls = systems.map((s) => s.url).filter((u): u is string => !!u);
        let termCount = 0;
        if (urls.length) {
          const r = await db.selectFrom('terminology_concepts').select((eb) => eb.fn.countAll<number>().as('n')).where('system', 'in', urls).executeTakeFirst();
          termCount = Number(r?.n ?? 0);
        }
        return { systemCount: systems.length, termCount };
      },
    },
    codingSystems: {
      async list(publisherId) {
        let qb = db.selectFrom('coding_systems').selectAll().orderBy('system_code');
        if (publisherId) qb = qb.where('publisher_id', '=', publisherId);
        return (await qb.execute()).map(csRow);
      },
      async create(input) {
        const id = newId('cs');
        return db.transaction().execute(async (trx) => {
          try {
            await trx.insertInto('coding_systems').values({
              id, system_code: input.systemCode, system_name: input.systemName, url: input.url ?? null,
              system_version: input.systemVersion ?? null, description: input.description ?? null,
              active: input.active, publisher_id: input.publisherId ?? null, seeded: false,
            }).execute();
          } catch (err) {
            const e = err as { code?: string; message?: string };
            const isUnique = e.code === '23505' || /unique|duplicate/i.test(e.message ?? '');
            if (isUnique) throw new TerminologyAdminError(`duplicate code system url: ${input.url}`, 'conflict');
            throw err;
          }
          const row = await trx.selectFrom('coding_systems').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
          if (capture) await capture.record(trx, 'coding_system', id, 'upsert', csContentHash(row));
          return csRow(row);
        });
      },
      async update(id, input) {
        const existing = await db.selectFrom('coding_systems').select(['id']).where('id', '=', id).executeTakeFirst();
        if (!existing) throw new TerminologyAdminError(`coding system not found: ${id}`, 'not-found');
        return db.transaction().execute(async (trx) => {
          // system_code is immutable on update (the UI disables it).
          await trx.updateTable('coding_systems').set({
            system_name: input.systemName, url: input.url ?? null, system_version: input.systemVersion ?? null,
            description: input.description ?? null, active: input.active, publisher_id: input.publisherId ?? null,
          }).where('id', '=', id).execute();
          const row = await trx.selectFrom('coding_systems').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
          if (capture) await capture.record(trx, 'coding_system', id, 'upsert', csContentHash(row));
          return csRow(row);
        });
      },
      async delete(id, opts) {
        const row = await db.selectFrom('coding_systems').select(['seeded', 'url']).where('id', '=', id).executeTakeFirst();
        if (!row) throw new TerminologyAdminError(`coding system not found: ${id}`, 'not-found');
        const jobCount = Number(
          (await db.selectFrom('terminology_ingest_jobs').select((eb) => eb.fn.countAll<number>().as('n'))
            .where('coding_system_id', '=', id).executeTakeFirst())?.n ?? 0,
        );
        // A true system seed (seeded, no uploaded distribution) is never deletable. An upload-created
        // system (seeded but with an ingest job) is deletable via cascade.
        if (row.seeded && jobCount === 0) {
          throw new TerminologyAdminError('This is a system-managed coding system and cannot be deleted.', 'conflict');
        }
        await db.transaction().execute(async (trx) => {
          if (opts?.cascade) {
            if (row.url) await trx.deleteFrom('terminology_concepts').where('system', '=', row.url).execute();
            await trx.deleteFrom('terminology_ingest_jobs').where('coding_system_id', '=', id).execute();
          }
          await trx.deleteFrom('coding_systems').where('id', '=', id).execute();
          if (capture) await capture.record(trx, 'coding_system', id, 'delete', null);
        });
      },
      async deletionImpact(id) {
        const sys = await db.selectFrom('coding_systems').select(['url']).where('id', '=', id).executeTakeFirst();
        if (!sys) throw new TerminologyAdminError(`coding system not found: ${id}`, 'not-found');
        const url = sys.url;
        if (!url) return { termCount: 0, mappingCount: 0 };
        const t = await db.selectFrom('terminology_concepts').select((eb) => eb.fn.countAll<number>().as('n')).where('system', '=', url).executeTakeFirst();
        const m = await db.selectFrom('concept_map_elements').select((eb) => eb.fn.countAll<number>().as('n'))
          .where((eb) => eb.or([eb('source_system', '=', url), eb('target_system', '=', url)])).executeTakeFirst();
        return { termCount: Number(t?.n ?? 0), mappingCount: Number(m?.n ?? 0) };
      },
      async upsertByUrl(input) {
        // Idempotency key is `url` (ON CONFLICT), not id: a row seeded by the migration
        // backfill (id `cs-<CODE>-<pub>`) is updated in place here; only when upsertByUrl
        // inserts first does the `cs-url-<code>` id appear. Either way one row per url.
        await db.transaction().execute(async (trx) => {
          await trx.insertInto('coding_systems').values({
            id: `cs-url-${input.systemCode}`, system_code: input.systemCode, system_name: input.systemName,
            url: input.url, system_version: input.systemVersion ?? null, active: true, publisher_id: input.publisherId, seeded: true,
          }).onConflict((oc) => oc.column('url').doUpdateSet({
            system_name: input.systemName, system_version: input.systemVersion ?? null, publisher_id: input.publisherId,
          })).execute();
          // Idempotency key is `url`; read the resulting row to key the capture by its real id
          // (an ON CONFLICT update keeps the pre-existing id, so hash the persisted row).
          const row = await trx.selectFrom('coding_systems').selectAll().where('url', '=', input.url).executeTakeFirstOrThrow();
          if (capture) await capture.record(trx, 'coding_system', row.id, 'upsert', csContentHash(row));
        });
      },
      async getByUrl(url) {
        const r = await db.selectFrom('coding_systems').selectAll().where('url', '=', url).executeTakeFirst();
        return r ? csRow(r) : null;
      },
    },
    terms: {
      async search(systemUrl, q) {
        let base = db.selectFrom('terminology_concepts').where('system', '=', systemUrl);
        if (q.query && q.query.trim()) {
          const like = `%${q.query.trim().toLowerCase()}%`;
          base = base.where((eb) => eb.or([
            eb(sql`lower(code)`, 'like', like),
            eb(sql`lower(display)`, 'like', like),
          ]));
        }
        if (q.statuses && q.statuses.length) base = base.where('status', 'in', q.statuses);
        const rows = await base.selectAll().orderBy('code').limit(q.limit).offset(q.offset).execute();
        const totalRow = await base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
        // N+1 count per row (parallel, fine for a ~25-row page). TODO: lateral join if page sizes grow.
        const out = await Promise.all(rows.map(async (r) => termRow(r, await mappingCountFor(r.system, r.code))));
        return { rows: out, total: Number(totalRow?.n ?? 0) };
      },
      async create(input) {
        const props = packProps(input);
        await db.insertInto('terminology_concepts').values({
          system: input.system, code: input.code, display: input.display, status: input.status,
          properties: props === null ? null : (JSON.stringify(props) as never),
        }).onConflict((oc) => oc.columns(['system', 'code']).doUpdateSet((eb) => ({
          display: eb.ref('excluded.display'), status: eb.ref('excluded.status'), properties: eb.ref('excluded.properties'),
        }))).execute();
        const row = await db.selectFrom('terminology_concepts').selectAll()
          .where('system', '=', input.system).where('code', '=', input.code).executeTakeFirstOrThrow();
        // Sync S3: one terminology_system signal per concept edit (post-write, own txn).
        await markTerminologyChanged(db, input.system);
        return termRow(row, await mappingCountFor(input.system, input.code));
      },
      async update(system, code, input) {
        const existing = await db.selectFrom('terminology_concepts').select(['code'])
          .where('system', '=', system).where('code', '=', code).executeTakeFirst();
        if (!existing) throw new TerminologyAdminError(`term not found: ${system}|${code}`, 'not-found');
        const props = packProps(input);
        await db.updateTable('terminology_concepts').set({
          display: input.display, status: input.status,
          properties: props === null ? null : (JSON.stringify(props) as never),
        }).where('system', '=', system).where('code', '=', code).execute();
        const row = await db.selectFrom('terminology_concepts').selectAll()
          .where('system', '=', system).where('code', '=', code).executeTakeFirstOrThrow();
        // Sync S3: one terminology_system signal per concept edit (post-write, own txn).
        await markTerminologyChanged(db, system);
        return termRow(row, await mappingCountFor(system, code));
      },
      async delete(system, code) {
        const existing = await db.selectFrom('terminology_concepts').select(['code'])
          .where('system', '=', system).where('code', '=', code).executeTakeFirst();
        if (!existing) throw new TerminologyAdminError(`term not found: ${system}|${code}`, 'not-found');
        await db.deleteFrom('terminology_concepts').where('system', '=', system).where('code', '=', code).execute();
        // Sync S3: one terminology_system signal per concept edit (post-delete, own txn).
        await markTerminologyChanged(db, system);
      },
      async importRows(rows) {
        if (!rows.length) return { imported: 0 };
        // Batch the insert INTERNALLY (large imports can exceed statement/parameter limits) so this
        // method is the single import-OPERATION choke point. Sync S3: the per-system signal is emitted
        // ONCE here after all rows land — NOT per batch — so a multi-batch import produces one signal
        // per distinct system, not N. (Callers must pass the whole import in one call, not per-batch.)
        const batchSize = 1000;
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          await db.insertInto('terminology_concepts').values(batch.map((r) => ({
            system: r.system, code: r.code, display: r.display, status: r.status,
            properties: r.properties === null ? null : (JSON.stringify(r.properties) as never),
          }))).onConflict((oc) => oc.columns(['system', 'code']).doUpdateSet((eb) => ({
            display: eb.ref('excluded.display'), status: eb.ref('excluded.status'), properties: eb.ref('excluded.properties'),
          }))).execute();
        }
        // One signal per DISTINCT system, after the whole import commits (each mark opens its own txn).
        for (const system of new Set(rows.map((r) => r.system))) {
          await markTerminologyChanged(db, system);
        }
        return { imported: rows.length };
      },
    },
    termMappings: {
      async listOutgoing(system, code) {
        const rows = await db.selectFrom('term_mappings').selectAll().where('from_system', '=', system).where('from_code', '=', code).orderBy('created_at').execute();
        return rows.map(tmRow);
      },
      async listReverse(system, code) {
        const rows = await db.selectFrom('term_mappings').selectAll().where('to_system', '=', system).where('to_code', '=', code).orderBy('created_at').execute();
        return rows.map(tmRow);
      },
      async create(input) {
        const id = newId('tm');
        let draftCreated = false;
        await db.transaction().execute(async (trx) => {
          await trx.insertInto('term_mappings').values({
            id, from_system: input.fromSystem, from_code: input.fromCode, to_system: input.toSystem, to_code: input.toCode,
            to_display: input.toDisplay, map_type: input.mapType, relationship: input.relationship ?? null, owner: input.owner ?? null, is_active: input.isActive,
          }).execute();
          await trx.deleteFrom('concept_map_elements')
            .where('map_url', '=', LOCAL_MAP_URL).where('source_system', '=', input.fromSystem).where('source_code', '=', input.fromCode)
            .where('target_system', '=', input.toSystem).where('target_code', '=', input.toCode).execute();
          await trx.insertInto('concept_map_elements').values({
            map_url: LOCAL_MAP_URL, source_system: input.fromSystem, source_code: input.fromCode,
            target_system: input.toSystem, target_code: input.toCode, equivalence: input.mapType,
          }).execute();
          const existing = await trx.selectFrom('terminology_concepts').select(['code']).where('system', '=', input.toSystem).where('code', '=', input.toCode).executeTakeFirst();
          if (!existing) {
            await trx.insertInto('terminology_concepts').values({ system: input.toSystem, code: input.toCode, display: input.toDisplay, status: 'DRAFT', properties: null }).execute();
            draftCreated = true;
          }
          const persisted = await trx.selectFrom('term_mappings').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
          if (capture) await capture.record(trx, 'term_mapping', id, 'upsert', tmContentHash(persisted));
        });
        const row = await db.selectFrom('term_mappings').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
        return { mapping: tmRow(row), draftCreated };
      },
      async update(id, input) {
        const existing = await db.selectFrom('term_mappings').selectAll().where('id', '=', id).executeTakeFirst();
        if (!existing) throw new TerminologyAdminError(`mapping not found: ${id}`, 'not-found');
        await db.transaction().execute(async (trx) => {
          await trx.deleteFrom('concept_map_elements').where('map_url', '=', LOCAL_MAP_URL)
            .where('source_system', '=', existing.from_system).where('source_code', '=', existing.from_code)
            .where('target_system', '=', existing.to_system).where('target_code', '=', existing.to_code).execute();
          await trx.updateTable('term_mappings').set({
            to_system: input.toSystem, to_code: input.toCode, to_display: input.toDisplay, map_type: input.mapType,
            relationship: input.relationship ?? null, owner: input.owner ?? null, is_active: input.isActive,
            updated_at: sql`now()`,
          }).where('id', '=', id).execute();
          await trx.insertInto('concept_map_elements').values({
            map_url: LOCAL_MAP_URL, source_system: input.fromSystem, source_code: input.fromCode,
            target_system: input.toSystem, target_code: input.toCode, equivalence: input.mapType,
          }).execute();
          const persisted = await trx.selectFrom('term_mappings').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
          if (capture) await capture.record(trx, 'term_mapping', id, 'upsert', tmContentHash(persisted));
        });
        const row = await db.selectFrom('term_mappings').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
        return tmRow(row);
      },
      async delete(id) {
        const existing = await db.selectFrom('term_mappings').selectAll().where('id', '=', id).executeTakeFirst();
        if (!existing) throw new TerminologyAdminError(`mapping not found: ${id}`, 'not-found');
        await db.transaction().execute(async (trx) => {
          await trx.deleteFrom('concept_map_elements').where('map_url', '=', LOCAL_MAP_URL)
            .where('source_system', '=', existing.from_system).where('source_code', '=', existing.from_code)
            .where('target_system', '=', existing.to_system).where('target_code', '=', existing.to_code).execute();
          await trx.deleteFrom('term_mappings').where('id', '=', id).execute();
          if (capture) await capture.record(trx, 'term_mapping', id, 'delete', null);
        });
      },
    },
    valueSets: {
      async list(publisherId) {
        let qb = db.selectFrom('value_sets').selectAll();
        if (publisherId) qb = qb.where('publisher_id', '=', publisherId);
        const rows = await qb.orderBy('title').orderBy('url').execute();
        const counts = await db.selectFrom('valueset_expansions')
          .select((eb) => ['value_set_id', eb.fn.countAll<number>().as('n')])
          .groupBy('value_set_id').execute();
        const byId = new Map(counts.map((c) => [c.value_set_id, Number(c.n)]));
        return rows.map((r) => summarizeValueSet(vsRow(r), byId.get(r.id) ?? 0));
      },
      get: getValueSet,
      async getByUrl(url) {
        const r = await db.selectFrom('value_sets').selectAll().where('url', '=', url).executeTakeFirst();
        if (!r) return null;
        const vs = vsRow(r);
        const c = await db.selectFrom('valueset_expansions').select((eb) => eb.fn.countAll<number>().as('n')).where('value_set_id', '=', vs.id).executeTakeFirst();
        return summarizeValueSet(vs, Number(c?.n ?? 0));
      },
      save: saveValueSet,
      async duplicate(id) {
        const src = await getValueSet(id);
        let url = `${src.url}-copy`;
        let n = 2;
        while (await db.selectFrom('value_sets').select('id').where('url', '=', url).executeTakeFirst()) {
          url = `${src.url}-copy-${n++}`;
        }
        return saveValueSet({
          url, version: src.version, name: src.name, title: src.title ? `${src.title} (copy)` : null,
          status: 'draft', experimental: src.experimental, description: src.description, compose: src.compose,
          publisherId: src.publisherId, category: src.category,
        });
      },
      async delete(id) {
        const r = await db.selectFrom('value_sets').select(['url']).where('id', '=', id).executeTakeFirst();
        if (!r) throw new TerminologyAdminError(`value set not found: ${id}`, 'not-found');
        await db.deleteFrom('valueset_expansions').where('value_set_id', '=', id).execute();
        await db.deleteFrom('value_sets').where('id', '=', id).execute();
        if (projection) await projection.deleteValueSetResource(r.url);
      },
      async expand(id, activeOnly = true) {
        const vs = await getValueSet(id);
        const result = await expandCompose(vs.compose, vsDeps, { activeOnly, seedUrls: [vs.url] });
        await writeExpansionCache(id, result.codes);
        return result;
      },
      async importFhir(resource) {
        const input = fhirValueSetToInput(resource);
        const saved = await saveValueSet(input);
        await db.updateTable('value_sets').set({ source_json: JSON.stringify(resource) as never }).where('id', '=', saved.id).execute();
        return saved;
      },
      async importFhirCatalog(resource) {
        const catalog = fhirValueSetCatalogToInputs(resource);
        let imported = 0;
        let skipped = 0;
        let lastId: string | null = null;
        await db.transaction().execute(async (trx) => {
          for (const vs of catalog.valueSets) {
            const existing = await trx.selectFrom('value_sets').select(['id']).where('url', '=', vs.url).executeTakeFirst();
            if (existing) {
              skipped += 1;
              continue;
            }
            const id = newId('vs');
            await trx.insertInto('value_sets').values({
              id, url: vs.url, version: vs.version, name: vs.name, title: vs.title, status: vs.status,
              experimental: vs.experimental, description: vs.description,
              compose: JSON.stringify(vs.compose) as never,
              source_json: JSON.stringify(vs.sourceJson) as never,
              immutable: vs.immutable, category: vs.category ?? null, publisher_id: vs.publisherId ?? null,
              expanded_at: vs.expansion.length ? sql`now()` : null,
            } as never).execute();
            await insertExpansionRows(trx, id, vs.expansion);
            imported += 1;
            lastId = id;
          }
          for (const cs of catalog.codeSystems) {
            const existing = await trx.selectFrom('coding_systems').select(['id'])
              .where((eb) => eb.or([eb('url', '=', cs.url), eb('system_code', '=', cs.systemCode)]))
              .executeTakeFirst();
            if (existing) continue;
            await trx.insertInto('coding_systems').values({
              id: newId('cs'), system_code: cs.systemCode, system_name: cs.systemName,
              url: cs.url, system_version: `FHIR ${catalog.version}`,
              description: `FHIR ${catalog.version} reference system`, active: false,
              publisher_id: 'pub-hl7-fhir', seeded: true,
            } as never).execute();
          }
        });
        return { imported, skipped, valueSet: lastId ? await getValueSet(lastId) : null };
      },
      async exportFhir(id) {
        const vs = await getValueSet(id);
        const rows = await db.selectFrom('valueset_expansions').select(['system_url', 'code', 'display']).where('value_set_id', '=', id).execute();
        const codes: ExpandedConcept[] = rows.map((r) => ({ system: r.system_url, code: r.code, display: r.display }));
        return valueSetToFhirResource({ id: vs.id, url: vs.url, status: vs.status as never, experimental: vs.experimental, version: vs.version, name: vs.name, title: vs.title, description: vs.description, compose: vs.compose }, codes);
      },
    },
  };
}
