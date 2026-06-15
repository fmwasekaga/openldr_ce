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
  };
}
