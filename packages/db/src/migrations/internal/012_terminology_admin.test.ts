import { describe, it, expect } from 'vitest';
import { computeBackfill } from './012_terminology_admin';
import { deriveSystemCode } from '../../seed-publishers';
import { SEED_PUBLISHERS } from '../../seed-publishers';
import { makeMigratedDb } from './test-helpers';

export { makeMigratedDb };

describe('012_terminology_admin', () => {
  it('creates publishers and coding_systems', async () => {
    const db = await makeMigratedDb();

    // The migration now seeds 6 publishers. We verify the tables exist and accept
    // additional rows, rather than asserting an exact count of 1. The seeded publishers
    // are verified independently in the 'backfill projection (pure)' describe block.
    // match_prefixes is jsonb — must be JSON.stringify'd for pg-mem
    await db
      .insertInto('publishers')
      .values({ id: 'p1', name: 'X', role: 'local', match_prefixes: JSON.stringify([]) })
      .execute();

    await db
      .insertInto('coding_systems')
      .values({ id: 'c1', system_code: 'X', system_name: 'X' })
      .execute();

    const pubs = await db.selectFrom('publishers').selectAll().execute();
    const systems = await db.selectFrom('coding_systems').selectAll().execute();

    // 8 seeded publishers + 1 manually inserted = 9
    expect(pubs.some((p: any) => p.id === 'p1')).toBe(true);
    expect(pubs.length).toBeGreaterThanOrEqual(9);
    expect(systems.some((s: any) => s.id === 'c1')).toBe(true);

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

describe('012 backfill projection (pure)', () => {
  it('seeds the eight corlix publishers in order', () => {
    expect(SEED_PUBLISHERS.map((p) => p.name)).toEqual([
      'System', 'HL7 FHIR', 'LOINC', 'SNOMED CT', 'WHO · ICD-10', 'WHO · ICD-11', 'UCUM', 'RxNorm',
    ]);
  });
  it('derives a system code from a URL', () => {
    expect(deriveSystemCode('http://loinc.org')).toBe('LOINC'); // host fallback (no path segment)
    expect(deriveSystemCode('http://example.org/whonet/organisms')).toBe('ORGANISMS');
  });
  it('projects a loinc system under LOINC and an unknown url under System', () => {
    const rows = computeBackfill(['http://loinc.org', 'http://example.org/whonet/organisms']);
    const byUrl = Object.fromEntries(rows.map((r) => [r.url, r]));
    expect(byUrl['http://loinc.org'].publisherName).toBe('LOINC');
    expect(byUrl['http://example.org/whonet/organisms'].publisherName).toBe('System');
  });
});
