import { describe, it, expect } from 'vitest';
import { type Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { internalMigrations, type InternalSchema } from '@openldr/db';
import { createUserProfileStore } from './profiles';

async function makeMigratedDb(): Promise<Kysely<InternalSchema>> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<InternalSchema>;
  for (const migration of Object.values(internalMigrations)) {
    await migration.up(db);
  }
  return db;
}

describe('user profile store', () => {
  it('upserts and reads extras keyed by user id', async () => {
    const db = await makeMigratedDb();
    const store = createUserProfileStore(db);
    await store.upsert('kc-1', { formSchemaId: 'f1', formVersion: 2, extras: { phone: { value: '123', fhirPath: null } } });
    const p = await store.get('kc-1');
    expect(p).toMatchObject({ userId: 'kc-1', formSchemaId: 'f1', formVersion: 2 });
    expect(p!.extras.phone.value).toBe('123');
    await store.upsert('kc-1', { extras: { phone: { value: '999', fhirPath: null } } });
    expect((await store.get('kc-1'))!.extras.phone.value).toBe('999');
    const map = await store.list(['kc-1', 'kc-2']);
    expect(map.get('kc-1')).toBeTruthy();
    expect(map.get('kc-2')).toBeUndefined();
  });
});
