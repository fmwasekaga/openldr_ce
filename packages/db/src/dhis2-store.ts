import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export interface OrgUnitMapEntry { facilityId: string; orgUnitId: string; orgUnitName: string | null }
export interface Dhis2MappingRecord { id: string; name: string; definition: Record<string, unknown> }

export interface OrgUnitMapStore {
  upsert(entries: OrgUnitMapEntry[]): Promise<void>;
  list(): Promise<OrgUnitMapEntry[]>;
  getMap(): Promise<Map<string, string>>;
}

export interface MappingStore {
  upsert(m: Dhis2MappingRecord): Promise<void>;
  get(id: string): Promise<Dhis2MappingRecord | null>;
  list(): Promise<{ id: string; name: string }[]>;
}

export function createOrgUnitMapStore(db: Kysely<InternalSchema>): OrgUnitMapStore {
  return {
    async upsert(entries) {
      if (entries.length === 0) return;
      await db
        .insertInto('dhis2_orgunit_map')
        .values(entries.map((e) => ({ facility_id: e.facilityId, orgunit_id: e.orgUnitId, orgunit_name: e.orgUnitName })))
        .onConflict((oc) => oc.column('facility_id').doUpdateSet((eb) => ({ orgunit_id: eb.ref('excluded.orgunit_id'), orgunit_name: eb.ref('excluded.orgunit_name') })))
        .execute();
    },
    async list() {
      const rows = await db.selectFrom('dhis2_orgunit_map').selectAll().orderBy('facility_id').execute();
      return rows.map((r) => ({ facilityId: r.facility_id, orgUnitId: r.orgunit_id, orgUnitName: r.orgunit_name }));
    },
    async getMap() {
      const rows = await db.selectFrom('dhis2_orgunit_map').select(['facility_id', 'orgunit_id']).execute();
      return new Map(rows.map((r) => [r.facility_id, r.orgunit_id]));
    },
  };
}

export function createMappingStore(db: Kysely<InternalSchema>): MappingStore {
  return {
    async upsert(m) {
      await db
        .insertInto('dhis2_mappings')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values({ id: m.id, name: m.name, definition: JSON.stringify(m.definition) } as any)
        .onConflict((oc) => oc.column('id').doUpdateSet((eb) => ({ name: eb.ref('excluded.name'), definition: eb.ref('excluded.definition'), updated_at: sql`now()` })))
        .execute();
    },
    async get(id) {
      const row = await db.selectFrom('dhis2_mappings').select(['id', 'name', 'definition']).where('id', '=', id).executeTakeFirst();
      return row ? { id: row.id, name: row.name, definition: row.definition as Record<string, unknown> } : null;
    },
    async list() {
      return db.selectFrom('dhis2_mappings').select(['id', 'name']).orderBy('id').execute();
    },
  };
}
