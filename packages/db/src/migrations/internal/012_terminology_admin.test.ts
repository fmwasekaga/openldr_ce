import { describe, it, expect } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { internalMigrations } from './index';

// pg-mem does not support the regex operator (!~) used by Kysely's Migrator introspection.
// We run each migration's up() function directly in order — same structure used by
// packages/dashboards/src/store.test.ts and other pg-mem tests in this repo.
async function makeMigratedDb(): Promise<Kysely<any>> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<any>;
  for (const migration of Object.values(internalMigrations)) {
    await migration.up(db);
  }
  return db;
}

describe('012_terminology_admin', () => {
  it('creates publishers and coding_systems', async () => {
    const db = await makeMigratedDb();

    // match_prefixes is jsonb — must be JSON.stringify'd for pg-mem
    await db
      .insertInto('publishers')
      .values({ id: 'p1', name: 'X', role: 'local', match_prefixes: JSON.stringify([]) })
      .execute();

    await db
      .insertInto('coding_systems')
      .values({ id: 'c1', system_code: 'X', system_name: 'X' })
      .execute();

    expect(await db.selectFrom('publishers').selectAll().execute()).toHaveLength(1);
    expect(await db.selectFrom('coding_systems').selectAll().execute()).toHaveLength(1);

    await db.destroy();
  });

  it('enforces FK: publisher_id references publishers', async () => {
    const db = await makeMigratedDb();

    await db
      .insertInto('publishers')
      .values({ id: 'pub1', name: 'Local', role: 'local', match_prefixes: JSON.stringify(['http://local/']) })
      .execute();

    await db
      .insertInto('coding_systems')
      .values({ id: 'cs1', system_code: 'LOCAL', system_name: 'Local System', publisher_id: 'pub1' })
      .execute();

    const rows = await db.selectFrom('coding_systems').selectAll().execute();
    expect(rows[0].publisher_id).toBe('pub1');

    await db.destroy();
  });

  it('rejects a coding_system with an unknown publisher_id', async () => {
    const db = await makeMigratedDb();
    await expect(
      db.insertInto('coding_systems')
        .values({ id: 'x', system_code: 'X', system_name: 'X', publisher_id: 'no-such' })
        .execute(),
    ).rejects.toThrow();
    await db.destroy();
  });

  it('enforces unique url via index', async () => {
    const db = await makeMigratedDb();

    await db
      .insertInto('coding_systems')
      .values({ id: 'cs1', system_code: 'A', system_name: 'A', url: 'http://example.com' })
      .execute();

    await expect(
      db
        .insertInto('coding_systems')
        .values({ id: 'cs2', system_code: 'B', system_name: 'B', url: 'http://example.com' })
        .execute(),
    ).rejects.toThrow();

    await db.destroy();
  });
});
