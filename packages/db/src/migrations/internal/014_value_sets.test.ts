import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('014_value_sets', () => {
  it('creates value_sets and valueset_expansions tables', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('value_sets').values({
      id: 'vs-test', url: 'urn:test:vs', status: 'draft', experimental: false,
      compose: JSON.stringify({ include: [] }), immutable: false,
    } as never).execute();
    const row = await db.selectFrom('value_sets').selectAll().where('id', '=', 'vs-test').executeTakeFirst();
    expect(row?.url).toBe('urn:test:vs');

    await db.insertInto('valueset_expansions').values({
      value_set_id: 'vs-test', system_url: 'urn:test:cs', code: 'A', display: 'Alpha', inactive: false,
    } as never).execute();
    const exp = await db.selectFrom('valueset_expansions').selectAll().where('value_set_id', '=', 'vs-test').execute();
    expect(exp).toHaveLength(1);
    await db.destroy();
  });
});

describe('014_value_sets seeds', () => {
  it('seeds the local code system, concepts, and six value sets with expansions', async () => {
    const db = await makeMigratedDb();
    const sets = await db.selectFrom('value_sets').select(['url', 'status']).execute();
    const urls = sets.map((s) => s.url);
    expect(urls).toContain('urn:openldr:valueset:yes-no');
    expect(urls).toContain('urn:openldr:valueset:hiv-result');
    expect(sets).toHaveLength(6);

    const yn = await db.selectFrom('value_sets').select('id').where('url', '=', 'urn:openldr:valueset:yes-no').executeTakeFirstOrThrow();
    const exp = await db.selectFrom('valueset_expansions').select(['code']).where('value_set_id', '=', yn.id).orderBy('code').execute();
    expect(exp.map((e) => e.code)).toEqual(['N', 'Y']);

    const sys = await db.selectFrom('terminology_systems').select(['kind']).where('url', '=', 'urn:openldr:valueset:yes-no').executeTakeFirst();
    expect(sys?.kind).toBe('ValueSet');
    await db.destroy();
  });
});
