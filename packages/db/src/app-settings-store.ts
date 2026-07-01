import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export interface AppSettingRecord {
  key: string;
  value: string;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface AppSettingStore {
  get(key: string): Promise<AppSettingRecord | null>;
  getAll(): Promise<AppSettingRecord[]>;
  set(key: string, value: string, updatedBy: string | null): Promise<void>;
}

export function createAppSettingsStore(db: Kysely<InternalSchema>): AppSettingStore {
  const toRecord = (r: { key: string; value: string; updated_at: Date; updated_by: string | null }): AppSettingRecord => ({
    key: r.key,
    value: r.value,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  });
  return {
    async get(key) {
      const r = await db.selectFrom('app_settings').selectAll().where('key', '=', key).executeTakeFirst();
      return r ? toRecord(r) : null;
    },
    async getAll() {
      const rows = await db.selectFrom('app_settings').selectAll().orderBy('key').execute();
      return rows.map(toRecord);
    },
    async set(key, value, updatedBy) {
      await db
        .insertInto('app_settings')
        .values({ key, value, updated_by: updatedBy, updated_at: sql`now()` as never })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_by: updatedBy, updated_at: sql`now()` as never }))
        .execute();
    },
  };
}
