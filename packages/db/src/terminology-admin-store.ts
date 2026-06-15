import { randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

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

export class TerminologyAdminError extends Error {
  constructor(message: string, public readonly kind: 'not-found' | 'conflict') {
    super(message);
    this.name = 'TerminologyAdminError';
  }
}

function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

const LOCAL_MAP_URL = 'urn:openldr:terminology:local-map';

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
    delete(id: string): Promise<void>;
    deletionImpact(id: string): Promise<{ termCount: number; mappingCount: number }>;
    upsertByUrl(input: { url: string; systemCode: string; systemName: string; systemVersion?: string | null; publisherId: string | null }): Promise<void>;
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
}

export function createTerminologyAdminStore(db: Kysely<InternalSchema>): TerminologyAdminStore {
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

  return {
    publishers: {
      async list() {
        const rows = await db.selectFrom('publishers').selectAll().orderBy('sort_order').orderBy('name').execute();
        return rows.map(pubRow);
      },
      async create(input) {
        const id = newId('pub');
        await db.insertInto('publishers').values({
          id, name: input.name, role: input.role, icon: input.icon ?? null,
          // pg-mem needs a JSON string for jsonb; real PG accepts the sql`` fragment.
          // Use JSON.stringify so pg-mem in tests accepts the value.
          match_prefixes: JSON.stringify([]) as never,
          seeded: false, sort_order: 100,
        }).execute();
        return pubRow(await db.selectFrom('publishers').selectAll().where('id', '=', id).executeTakeFirstOrThrow());
      },
      async update(id, input) {
        const existing = await db.selectFrom('publishers').select(['seeded']).where('id', '=', id).executeTakeFirst();
        if (!existing) throw new TerminologyAdminError(`publisher not found: ${id}`, 'not-found');
        await db.updateTable('publishers').set({ name: input.name, role: input.role, icon: input.icon ?? null }).where('id', '=', id).execute();
        return pubRow(await db.selectFrom('publishers').selectAll().where('id', '=', id).executeTakeFirstOrThrow());
      },
      async delete(id) {
        const row = await db.selectFrom('publishers').select(['seeded']).where('id', '=', id).executeTakeFirst();
        if (!row) throw new TerminologyAdminError(`publisher not found: ${id}`, 'not-found');
        if (row.seeded) throw new TerminologyAdminError('cannot delete a seeded publisher', 'conflict');
        await db.deleteFrom('publishers').where('id', '=', id).execute();
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
        try {
          await db.insertInto('coding_systems').values({
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
        return csRow(await db.selectFrom('coding_systems').selectAll().where('id', '=', id).executeTakeFirstOrThrow());
      },
      async update(id, input) {
        const existing = await db.selectFrom('coding_systems').select(['id']).where('id', '=', id).executeTakeFirst();
        if (!existing) throw new TerminologyAdminError(`coding system not found: ${id}`, 'not-found');
        // system_code is immutable on update (the UI disables it).
        await db.updateTable('coding_systems').set({
          system_name: input.systemName, url: input.url ?? null, system_version: input.systemVersion ?? null,
          description: input.description ?? null, active: input.active, publisher_id: input.publisherId ?? null,
        }).where('id', '=', id).execute();
        return csRow(await db.selectFrom('coding_systems').selectAll().where('id', '=', id).executeTakeFirstOrThrow());
      },
      async delete(id) {
        const row = await db.selectFrom('coding_systems').select(['seeded']).where('id', '=', id).executeTakeFirst();
        if (!row) throw new TerminologyAdminError(`coding system not found: ${id}`, 'not-found');
        if (row.seeded) throw new TerminologyAdminError('cannot delete a seeded code system', 'conflict');
        await db.deleteFrom('coding_systems').where('id', '=', id).execute();
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
        await db.insertInto('coding_systems').values({
          id: `cs-url-${input.systemCode}`, system_code: input.systemCode, system_name: input.systemName,
          url: input.url, system_version: input.systemVersion ?? null, active: true, publisher_id: input.publisherId, seeded: true,
        }).onConflict((oc) => oc.column('url').doUpdateSet({
          system_name: input.systemName, system_version: input.systemVersion ?? null, publisher_id: input.publisherId,
        })).execute();
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
        return termRow(row, await mappingCountFor(system, code));
      },
      async delete(system, code) {
        const existing = await db.selectFrom('terminology_concepts').select(['code'])
          .where('system', '=', system).where('code', '=', code).executeTakeFirst();
        if (!existing) throw new TerminologyAdminError(`term not found: ${system}|${code}`, 'not-found');
        await db.deleteFrom('terminology_concepts').where('system', '=', system).where('code', '=', code).execute();
      },
      async importRows(rows) {
        if (!rows.length) return { imported: 0 };
        await db.insertInto('terminology_concepts').values(rows.map((r) => ({
          system: r.system, code: r.code, display: r.display, status: r.status,
          properties: r.properties === null ? null : (JSON.stringify(r.properties) as never),
        }))).onConflict((oc) => oc.columns(['system', 'code']).doUpdateSet((eb) => ({
          display: eb.ref('excluded.display'), status: eb.ref('excluded.status'), properties: eb.ref('excluded.properties'),
        }))).execute();
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
        });
      },
    },
  };
}
