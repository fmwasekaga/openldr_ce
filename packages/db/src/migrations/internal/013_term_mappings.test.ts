import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('013_term_mappings', () => {
  it('creates term_mappings with from/to rows', async () => {
    const db = await makeMigratedDb();
    await db
      .insertInto('term_mappings')
      .values({
        id: 'm1',
        from_system: 'http://a',
        from_code: 'x',
        to_system: 'http://b',
        to_code: 'y',
        map_type: 'SAME-AS',
      })
      .execute();
    const rows = await db.selectFrom('term_mappings').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].is_active).toBe(true); // default
    await db.destroy();
  });
});
