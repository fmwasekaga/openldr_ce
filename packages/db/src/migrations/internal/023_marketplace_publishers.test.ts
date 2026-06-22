import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('023_marketplace_publishers', () => {
  it('creates the marketplace_publishers table', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('marketplace_publishers')
      .values({ publisher_id: 'acme', key_fingerprint: 'a'.repeat(64), publisher_name: 'Acme', approved_by: 'admin' })
      .execute();
    const row = await db.selectFrom('marketplace_publishers').selectAll().where('publisher_id', '=', 'acme').executeTakeFirst();
    expect(row?.key_fingerprint).toBe('a'.repeat(64));
  });
});
