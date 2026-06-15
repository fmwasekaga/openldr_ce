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
