import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { markTerminologyChanged, markConceptMapChanged } from './terminology-sync';

describe('markTerminologyChanged', () => {
  it('creates a registry row (generation 1) + one signal for a brand-new system url', async () => {
    const db = await makeMigratedDb();
    await markTerminologyChanged(db, 'http://example.org/cs');

    const sys = await db
      .selectFrom('terminology_systems')
      .selectAll()
      .where('url', '=', 'http://example.org/cs')
      .executeTakeFirstOrThrow();
    expect(Number(sys.generation)).toBe(1);
    expect(sys.kind).toBe('CodeSystem');
    expect(sys.resource_id).toBe('');

    const log = await db.selectFrom('reference_change_log').selectAll().execute();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      entity_type: 'terminology_system',
      entity_id: 'http://example.org/cs',
      op: 'upsert',
      content_hash: '1',
    });
    await db.destroy();
  });

  it('a second bump advances generation to 2 and appends a distinct signal (no dedup)', async () => {
    const db = await makeMigratedDb();
    await markTerminologyChanged(db, 'http://example.org/cs');
    await markTerminologyChanged(db, 'http://example.org/cs');

    const sys = await db
      .selectFrom('terminology_systems')
      .selectAll()
      .where('url', '=', 'http://example.org/cs')
      .executeTakeFirstOrThrow();
    expect(Number(sys.generation)).toBe(2);

    const log = await db.selectFrom('reference_change_log').selectAll().orderBy('seq').execute();
    expect(log).toHaveLength(2);
    expect(log.map((r) => r.content_hash)).toEqual(['1', '2']);
    await db.destroy();
  });

  it('bumps an existing system without disturbing its version/kind/resource_id', async () => {
    const db = await makeMigratedDb();
    // Pre-insert a saveSystem-shaped row (generation defaults to 0).
    await db
      .insertInto('terminology_systems')
      .values({ url: 'http://loinc.org', version: '2.77', kind: 'CodeSystem', resource_id: 'cs-loinc' })
      .execute();

    await markTerminologyChanged(db, 'http://loinc.org');

    const sys = await db
      .selectFrom('terminology_systems')
      .selectAll()
      .where('url', '=', 'http://loinc.org')
      .executeTakeFirstOrThrow();
    expect(Number(sys.generation)).toBe(1);
    expect(sys.version).toBe('2.77');
    expect(sys.kind).toBe('CodeSystem');
    expect(sys.resource_id).toBe('cs-loinc');

    // exactly one row for this url (bumped in place, not duplicate-inserted). Seed migrations populate
    // terminology_systems with reference rows, so filter to the url under test rather than count all.
    expect(
      await db.selectFrom('terminology_systems').selectAll().where('url', '=', 'http://loinc.org').execute(),
    ).toHaveLength(1);
    await db.destroy();
  });
});

describe('markConceptMapChanged', () => {
  it('creates a concept_map_state row (generation 1) + one signal, then advances on a second bump', async () => {
    const db = await makeMigratedDb();
    await markConceptMapChanged(db, 'http://example.org/cm');

    let state = await db
      .selectFrom('concept_map_state')
      .selectAll()
      .where('map_url', '=', 'http://example.org/cm')
      .executeTakeFirstOrThrow();
    expect(Number(state.generation)).toBe(1);

    let log = await db.selectFrom('reference_change_log').selectAll().execute();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      entity_type: 'concept_map',
      entity_id: 'http://example.org/cm',
      op: 'upsert',
      content_hash: '1',
    });

    await markConceptMapChanged(db, 'http://example.org/cm');
    state = await db
      .selectFrom('concept_map_state')
      .selectAll()
      .where('map_url', '=', 'http://example.org/cm')
      .executeTakeFirstOrThrow();
    expect(Number(state.generation)).toBe(2);

    log = await db.selectFrom('reference_change_log').selectAll().orderBy('seq').execute();
    expect(log).toHaveLength(2);
    expect(log.map((r) => r.content_hash)).toEqual(['1', '2']);
    await db.destroy();
  });
});
