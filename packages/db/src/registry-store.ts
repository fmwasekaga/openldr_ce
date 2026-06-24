import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export interface RegistryRecord {
  id: string;
  name: string;
  kind: string;
  location: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewRegistry {
  id: string;
  name: string;
  kind: string;
  location: string;
  enabled?: boolean;
}

export interface RegistryPatch {
  name?: string;
  kind?: string;
  location?: string;
  enabled?: boolean;
}

export interface RegistryStore {
  create(input: NewRegistry): Promise<void>;
  get(id: string): Promise<RegistryRecord | null>;
  list(): Promise<RegistryRecord[]>;
  update(id: string, patch: RegistryPatch): Promise<void>;
  remove(id: string): Promise<void>;
}

const COLS = ['id', 'name', 'kind', 'location', 'enabled', 'created_at', 'updated_at'] as const;

function toRecord(r: {
  id: string;
  name: string;
  kind: string;
  location: string;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}): RegistryRecord {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    location: r.location,
    enabled: r.enabled,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createRegistryStore(db: Kysely<InternalSchema>): RegistryStore {
  return {
    async create(input) {
      await db
        .insertInto('registries')
        .values({
          id: input.id,
          name: input.name,
          kind: input.kind,
          location: input.location,
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        })
        .execute();
    },

    async get(id) {
      const r = await db
        .selectFrom('registries')
        .select(COLS)
        .where('id', '=', id)
        .executeTakeFirst();
      return r ? toRecord(r) : null;
    },

    async list() {
      const rows = await db.selectFrom('registries').select(COLS).orderBy('name').execute();
      return rows.map(toRecord);
    },

    async update(id, patch) {
      const set: Record<string, unknown> = { updated_at: sql`now()` };
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.kind !== undefined) set.kind = patch.kind;
      if (patch.location !== undefined) set.location = patch.location;
      if (patch.enabled !== undefined) set.enabled = patch.enabled;
      await db.updateTable('registries').set(set).where('id', '=', id).execute();
    },

    async remove(id) {
      await db.deleteFrom('registries').where('id', '=', id).execute();
    },
  };
}
